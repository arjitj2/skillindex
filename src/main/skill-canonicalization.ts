import { cp, mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';

import type { SkillInventorySnapshot, SkillLocationRecord } from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPaths,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import { scanSkillInventory, type ScanSkillInventoryOptions } from '@main/skill-inventory';
import { persistSkillUniversalDecisionForSelection } from '@main/skill-universal-decisions';

export interface MakeSkillCanonicalRequest {
  skillName: string;
  selectedSourcePath?: string;
  selectedVariantPath?: string;
}

export interface MakeSkillCanonicalOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
  linkMissingAgentInstalls?: boolean;
}

export async function makeSkillCanonical(
  request: MakeSkillCanonicalRequest,
  options: MakeSkillCanonicalOptions = {},
): Promise<SkillInventorySnapshot> {
  const skillName = request.skillName.trim();
  if (!skillName) {
    throw new Error('Choose a skill before using it as Universal.');
  }

  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const beforeSnapshot = await scanSkillInventory({
    ...options,
    paths,
  });
  const sourceIndex = new Map(beforeSnapshot.sources.map((source) => [source.id, source]));
  const skill = beforeSnapshot.skills.find((entry) => entry.name === skillName);

  if (!skill) {
    throw new Error(`Skill "${skillName}" is no longer available to use as Universal.`);
  }

  if (!skill.isDrifted) {
    throw new Error('Use as Universal is only available for skills that need attention.');
  }

  const scopes = new Set(skill.locations.map((location) => location.sourceScope));
  if (scopes.size > 1) {
    throw new Error('Use as Universal currently requires every affected location to stay within one scope.');
  }

  const sources = skill.locations.map((location) => {
    const source = sourceIndex.get(location.sourceId);
    if (!source) {
      throw new Error(`Missing source metadata for ${location.path}.`);
    }

    return source;
  });

  assertAffectedSourcesWritableOrPlugin(sources);

  const mutationScope = resolveSkillMutationScope(skill, request);
  const canonicalPath = resolveCanonicalSkillInstallPath(beforeSnapshot, skill.name, mutationScope);
  const realFileCandidates = skill.locations
    .filter((location) => location.fileType === 'real-file')
    .sort(compareNewestRealFiles);
  const canRepairFromExistingCanonical = canRepairUsingExistingCanonicalFile({
    canonicalPath,
    realFileCandidates,
    locations: skill.locations,
  });

  if (realFileCandidates.length < 1 && !canRepairFromExistingCanonical) {
    throw new Error('Use as Universal requires at least one readable real-file source.');
  }

  const selectedSource = pickSelectedSource({
    canonicalPath,
    realFileCandidates,
    request,
    structuralState: skill.structuralState,
  });
  const canonicalSource = resolveCanonicalSkillSource(beforeSnapshot, mutationScope);
  const universalTargetPath = selectedSource.provenance?.kind === 'plugin'
    ? selectedSource.path
    : canonicalPath;
  const persistedUniversalLocation = selectedSource.provenance?.kind === 'plugin'
    ? selectedSource
    : createCanonicalDecisionLocation(selectedSource, canonicalPath, canonicalSource);
  const shouldLinkMissingAgentInstalls = options.linkMissingAgentInstalls !== false;
  const writableLinkedSkillsDirs = new Set(
    !shouldLinkMissingAgentInstalls
      ? []
      : (beforeSnapshot.agents ?? [])
          .filter((agent) =>
            agent.installState === 'installed'
            && agent.scope === mutationScope
            && agent.writable
            && agent.skillsLocation.path
            && path.normalize(agent.skillsLocation.path) !== path.normalize(path.dirname(universalTargetPath)))
          .map((agent) => getSkillInstallPath(agent.skillsLocation.path as string, skill.name)),
  );
  await materializeCanonicalFile({
    canonicalPath,
    selectedSource,
  });
  await persistSkillUniversalDecisionForSelection(skill, persistedUniversalLocation, {
    ...options,
    paths,
  });

  // Build a deduplicated set of paths to symlink: existing real-file copies (by location)
  // plus all writable agent dirs. The location-based set catches sources that aren't
  // represented as agents, which would otherwise be left as real-file duplicates.
  const symlinkTargets = new Map<string, string>();
  for (const location of skill.locations) {
    const source = sourceIndex.get(location.sourceId);
    if (
      location.fileType === 'real-file'
      && source?.writable === true
      && source.kind !== 'plugin'
      && path.normalize(location.path) !== path.normalize(universalTargetPath)
    ) {
      symlinkTargets.set(path.normalize(location.path), location.path);
    }
  }
  for (const targetPath of writableLinkedSkillsDirs) {
    symlinkTargets.set(path.normalize(targetPath), targetPath);
  }

  await Promise.all(
    [...symlinkTargets.values()].map((targetPath) => replaceWithCanonicalSymlink(targetPath, universalTargetPath)),
  );

  return scanSkillInventory({
    ...options,
    paths,
  });
}

function pickSelectedSource({
  canonicalPath,
  realFileCandidates,
  request,
  structuralState,
}: {
  canonicalPath: string;
  realFileCandidates: SkillLocationRecord[];
  request: MakeSkillCanonicalRequest;
  structuralState: SkillInventorySnapshot['skills'][number]['structuralState'];
}): SkillLocationRecord {
  const requestedVariantPath = request.selectedSourcePath ?? request.selectedVariantPath;
  if (requestedVariantPath) {
    const requestedSource = realFileCandidates.find((location) => location.path === requestedVariantPath);
    if (!requestedSource) {
      throw new Error('Choose one of the available real-file sources before using as Universal.');
    }

    return requestedSource;
  }

  const canonicalCandidate = realFileCandidates.find((location) => location.path === canonicalPath);
  if (realFileCandidates.length === 1 && canonicalCandidate) {
    return canonicalCandidate;
  }

  if (structuralState === 'diverged-drift' && realFileCandidates.length > 1) {
    throw new Error('Choose a skill version before using as Universal on diverged copies.');
  }

  return canonicalCandidate ?? realFileCandidates[0];
}

async function materializeCanonicalFile({
  canonicalPath,
  selectedSource,
}: {
  canonicalPath: string;
  selectedSource: SkillLocationRecord;
}) {
  if (selectedSource.provenance?.kind === 'plugin') {
    return;
  }

  if (selectedSource.path === canonicalPath && selectedSource.fileType === 'real-file') {
    return;
  }

  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await rm(canonicalPath, { recursive: true, force: true });
  await cp(selectedSource.path, canonicalPath, {
    recursive: true,
    dereference: true,
    force: true,
  });
}

async function replaceWithCanonicalSymlink(locationPath: string, canonicalPath: string): Promise<void> {
  await mkdir(path.dirname(locationPath), { recursive: true });
  await rm(locationPath, { recursive: true, force: true });
  await symlink(canonicalPath, locationPath);
}

function compareNewestRealFiles(left: SkillLocationRecord, right: SkillLocationRecord): number {
  const timestampDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return timestampDifference || left.path.localeCompare(right.path);
}

function assertAffectedSourcesWritableOrPlugin(sources: SkillInventorySnapshot['sources']): void {
  const readOnlyNonPluginSource = sources.find((source) => !source.writable && source.kind !== 'plugin');
  if (readOnlyNonPluginSource) {
    throw new Error('Use as Universal is blocked until every affected non-plugin location is writable.');
  }
}

function canRepairUsingExistingCanonicalFile({
  canonicalPath,
  realFileCandidates,
  locations,
}: {
  canonicalPath: string;
  realFileCandidates: SkillLocationRecord[];
  locations: SkillLocationRecord[];
}): boolean {
  return realFileCandidates.length === 1
    && realFileCandidates[0]?.path === canonicalPath
    && locations.some((location) => location.path !== canonicalPath && location.fileType === 'symlink');
}

function resolveCanonicalSkillInstallPath(
  snapshot: SkillInventorySnapshot,
  skillName: string,
  scope: SkillLocationRecord['sourceScope'],
): string {
  return getSkillInstallPath(resolveCanonicalSkillSource(snapshot, scope, skillName).skillsDir, skillName);
}

function resolveCanonicalSkillSource(
  snapshot: SkillInventorySnapshot,
  scope: SkillLocationRecord['sourceScope'],
  skillName?: string,
): SkillInventorySnapshot['sources'][number] {
  const preferredCanonicalSource = snapshot.sources.find((source) =>
    source.preferredCanonical === true && source.scope === scope);
  if (preferredCanonicalSource) {
    return preferredCanonicalSource;
  }

  const canonicalSource = snapshot.sources.find((source) => source.canonical && source.scope === scope);
  if (canonicalSource) {
    return canonicalSource;
  }

  throw new Error(skillName
    ? `Unable to locate the canonical ${scope} skills directory for "${skillName}".`
    : `Unable to locate the canonical ${scope} skills directory.`);
}

function getSkillInstallPath(skillsDir: string, skillName: string): string {
  return path.join(skillsDir, skillName);
}

function createCanonicalDecisionLocation(
  selectedSource: SkillLocationRecord,
  canonicalPath: string,
  canonicalSource: SkillInventorySnapshot['sources'][number],
): SkillLocationRecord {
  return {
    ...selectedSource,
    path: canonicalPath,
    entrypointPath: selectedSource.installKind === 'directory'
      ? path.join(canonicalPath, 'SKILL.md')
      : canonicalPath,
    sourceId: canonicalSource.id,
    sourceLabel: canonicalSource.label,
    sourceScope: canonicalSource.scope,
    fileType: 'real-file',
    canonical: true,
    resolvedPath: canonicalPath,
    symlinkTarget: undefined,
    provenance: undefined,
    canonicalRole: 'canonical',
    mutability: canonicalSource.writable ? 'writable' : selectedSource.mutability,
  };
}

function resolveSkillMutationScope(
  skill: SkillInventorySnapshot['skills'][number],
  request: MakeSkillCanonicalRequest,
): SkillLocationRecord['sourceScope'] {
  const requestedVariantPath = request.selectedSourcePath ?? request.selectedVariantPath;
  if (requestedVariantPath) {
    const selectedLocation = skill.locations.find((location) => location.path === requestedVariantPath);
    if (selectedLocation) {
      return selectedLocation.sourceScope;
    }
  }

  const derivedScope = skill.locations.find((location) => location.canonical)?.sourceScope
    ?? skill.locations[0]?.sourceScope;
  if (!derivedScope) {
    throw new Error(`Unable to determine mutation scope for "${skill.name}".`);
  }

  return derivedScope;
}
