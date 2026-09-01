import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { SkillInventorySnapshot, SkillLocationRecord } from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPathsForScanOptions,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';
import {
  assertSafeSkillPackageName,
  assertSkillSourceAndDestinationDoNotOverlap,
  assertSafeUniversalSkillMutation,
  assertSafeWritableSkillLinkMutation,
  isAgentSatisfiedByNativePlugin,
} from '@main/plugin-managed-sources';
import { persistSkillUniversalDecisionForSelection } from '@main/skill-universal-decisions';
import { replaceSkillLinksTransaction } from '@main/skill-link-transaction';

export interface MakeSkillCanonicalRequest {
  skillName: string;
  selectedSourcePath?: string;
  selectedVariantPath?: string;
}

export interface MakeSkillCanonicalOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
  /** Snapshot prepared by a caller that has already planned an audited action. */
  preparedSnapshot?: SkillInventorySnapshot;
  linkMissingAgentInstalls?: boolean;
  testFailSkillLinkAt?: number;
  testFailSkillDecisionPersist?: boolean;
}

export async function makeSkillCanonical(
  request: MakeSkillCanonicalRequest,
  options: MakeSkillCanonicalOptions = {},
): Promise<SkillInventorySnapshot> {
  const skillName = request.skillName.trim();
  if (!skillName) {
    throw new Error('Choose a skill before using it as Universal.');
  }
  assertSafeSkillPackageName(skillName);

  const { preparedSnapshot, ...scanOptions } = options;
  const paths = scanOptions.paths ?? resolveSkillIndexPathsForScanOptions(scanOptions);
  await ensureSkillIndexLayout(paths);

  const beforeSnapshot = preparedSnapshot ?? await scanInventory({
    ...scanOptions,
    paths,
  });
  const sourceIndex = new Map(beforeSnapshot.sources.map((source) => [source.id, source]));
  const skill = beforeSnapshot.skills.find((entry) => entry.name === skillName);

  if (!skill) {
    throw new Error(`Skill "${skillName}" is no longer available to use as Universal.`);
  }

  const requestedVariantPath = request.selectedSourcePath ?? request.selectedVariantPath;
  const requestedPluginSource = requestedVariantPath
    ? skill.locations.find((location) => location.path === requestedVariantPath)?.provenance?.kind === 'plugin'
    : false;
  if (!skill.isDrifted && !requestedPluginSource) {
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
  const canonicalPath = resolveCanonicalSkillInstallPath(beforeSnapshot, skill.name, mutationScope, paths);
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
  const canonicalSource = resolveCanonicalSkillSource(beforeSnapshot, mutationScope, undefined, paths);
  const universalTargetPath = canonicalPath;
  const persistedUniversalLocation = createCanonicalDecisionLocation(selectedSource, canonicalPath, canonicalSource);
  if (path.normalize(selectedSource.path) !== path.normalize(canonicalPath)) {
    await assertSkillSourceAndDestinationDoNotOverlap(selectedSource.path, canonicalPath);
  }
  await assertSafeUniversalSkillMutation({
    destinationPath: universalTargetPath,
    universalRoot: canonicalSource.skillsDir,
    skillName: skill.name,
    scope: mutationScope,
    sources: beforeSnapshot.sources,
    allowDefaultUniversalRoot: selectedSource.provenance?.kind === 'plugin',
  });
  const shouldLinkMissingAgentInstalls = options.linkMissingAgentInstalls !== false;
  const selectedSkillPluginCandidates = (skill.managedSourceCandidates ?? [])
    .filter((candidate) => candidate.plugin.enabled === true)
    .map((candidate) => candidate.plugin);
  const writableLinkedSkillsDirs = new Set(
    !shouldLinkMissingAgentInstalls
      ? []
      : (beforeSnapshot.agents ?? [])
          .filter((agent) =>
            agent.installState === 'installed'
            && agent.scope === mutationScope
            && agent.writable
            && agent.skillsLocation.path
            && !(selectedSource.provenance?.kind === 'plugin' && isAgentSatisfiedByNativePlugin(
              agent.family,
              selectedSkillPluginCandidates,
            ))
            && path.normalize(agent.skillsLocation.path) !== path.normalize(path.dirname(universalTargetPath)))
          .map((agent) => getSkillInstallPath(agent.skillsLocation.path as string, skill.name)),
  );
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

  const linkPaths = [...symlinkTargets.values()];
  await Promise.all(linkPaths.map((targetPath) => assertSafeWritableSkillLinkMutation(
    targetPath,
    beforeSnapshot.sources,
    (beforeSnapshot.agents ?? []).flatMap((agent) => agent.writable && agent.skillsLocation.path ? [agent.skillsLocation.path] : []),
  )));
  const materializedPackage = await materializeCanonicalFile({
    canonicalPath,
    skillName: skill.name,
    selectedSource,
    sources: beforeSnapshot.sources,
    universalRoot: canonicalSource.skillsDir,
    scope: mutationScope,
    allowDefaultUniversalRoot: selectedSource.provenance?.kind === 'plugin',
  });
  let linkTransaction: Awaited<ReturnType<typeof replaceSkillLinksTransaction>> | undefined;
  try {
    linkTransaction = await replaceSkillLinksTransaction(linkPaths, universalTargetPath, beforeSnapshot.sources, {
      failAt: options.testFailSkillLinkAt,
      validateDestination: (targetPath) => assertSafeWritableSkillLinkMutation(
        targetPath,
        beforeSnapshot.sources,
        (beforeSnapshot.agents ?? []).flatMap((agent) => agent.writable && agent.skillsLocation.path ? [agent.skillsLocation.path] : []),
      ),
    });
    await persistSkillUniversalDecisionForSelection(skill, persistedUniversalLocation, {
      ...scanOptions,
      paths,
    });
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    try { await linkTransaction?.rollback(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
    try { await materializedPackage.rollback(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
    if (rollbackFailures.length > 0) throw new AggregateError([error, ...rollbackFailures], 'Skill canonicalization failed and rollback was incomplete.');
    throw error;
  }
  await linkTransaction.commit();
  await materializedPackage.commit();

  return scanInventory({
    ...scanOptions,
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
  skillName,
  selectedSource,
  sources,
  universalRoot,
  scope,
  allowDefaultUniversalRoot,
}: {
  canonicalPath: string;
  skillName: string;
  selectedSource: SkillLocationRecord;
  sources: SkillInventorySnapshot['sources'];
  universalRoot: string;
  scope: SkillLocationRecord['sourceScope'];
  allowDefaultUniversalRoot: boolean;
}): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> {
  if (selectedSource.path === canonicalPath && selectedSource.fileType === 'real-file') {
    return { commit: () => Promise.resolve(), rollback: () => Promise.resolve() };
  }

  await assertSafeUniversalSkillMutation({ destinationPath: canonicalPath, universalRoot, skillName, scope, sources, allowDefaultUniversalRoot });
  const parentPath = path.dirname(canonicalPath);
  const stagePath = path.join(parentPath, `.${path.basename(canonicalPath)}.stage-${randomUUID()}`);
  const backupPath = path.join(parentPath, `.${path.basename(canonicalPath)}.backup-${randomUUID()}`);
  await mkdir(parentPath, { recursive: true });
  try {
    await cp(selectedSource.path, stagePath, { recursive: true, dereference: true, force: true });
    await readFile(path.join(stagePath, 'SKILL.md'), 'utf8');
    await rename(canonicalPath, backupPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    try {
      await rename(stagePath, canonicalPath);
    } catch (error) {
      await rename(backupPath, canonicalPath).catch(() => undefined);
      throw error;
    }
    return {
      commit: async () => { await rm(backupPath, { recursive: true, force: true }).catch(() => undefined); },
      rollback: async () => {
        await rm(canonicalPath, { recursive: true, force: true });
        await rename(backupPath, canonicalPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      },
    };
  } catch (error) {
    await rm(stagePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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
  paths: SkillIndexPaths,
): string {
  return getSkillInstallPath(resolveCanonicalSkillSource(snapshot, scope, skillName, paths).skillsDir, skillName);
}

function resolveCanonicalSkillSource(
  snapshot: SkillInventorySnapshot,
  scope: SkillLocationRecord['sourceScope'],
  skillName?: string,
  paths?: SkillIndexPaths,
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

  if (paths && (scope === 'live' || scope === 'sandbox')) {
    const skillsDir = scope === 'sandbox'
      ? paths.sandboxCanonicalUserSkillsDir
      : paths.liveCanonicalUserSkillsDir;
    return {
      id: `${scope}-agents`,
      label: `${scope === 'sandbox' ? 'Sandbox' : 'Live'} .agents`,
      canonical: true,
      kind: 'canonical',
      writable: true,
      scope,
      skillsDir,
      preferredCanonical: false,
      compatibleAgentFamilies: [],
    };
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
