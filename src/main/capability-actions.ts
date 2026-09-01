import { createHash } from 'node:crypto';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  CapabilityActionRequest,
  SkillInventorySnapshot,
  SkillLocationRecord,
  SkillRecord,
  SkillResolvableIssue,
  SkillUniversalAlternate,
  SkillUniversalDecision,
  SkillUniversalOrigin,
} from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  readSkillIndexConfig,
  resolveSkillIndexPaths,
  writeSkillIndexConfig,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';
import { makeSkillCanonical } from '@main/skill-canonicalization';
import {
  resolveInventoryIssue,
  updateMcpUniversalFromPluginSource,
  updateSubagentUniversalFromPluginSource,
} from '@main/issue-resolution';

export interface CapabilityActionOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
}

const UNIVERSAL_CHOICE_AUTO_REPAIR_ISSUES: SkillResolvableIssue[] = [
  'broken-symlink',
  'wrong-symlink-target',
  'missing-symlinks',
  'diverged-copies',
  'identical-copies',
];

export async function applyCapabilityAction(
  request: CapabilityActionRequest,
  options: CapabilityActionOptions = {},
): Promise<SkillInventorySnapshot> {
  assertCapabilityActionRequest(request);
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);
  const snapshot = await scanInventory({
    ...options,
    paths,
  });

  switch (request.action) {
    case 'choose-universal-version': {
      const selectedLocation = selectRepresentativeLocation(findSkill(snapshot, request.skillName), request.selectedVariantPath);
      if (selectedLocation.provenance?.kind === 'plugin') {
        return makeSkillCanonical({
          skillName: request.skillName,
          selectedVariantPath: selectedLocation.path,
        }, {
          ...options,
          paths,
        });
      }
      await persistSkillUniversalDecision(request, snapshot, {
        ...options,
        paths,
      });
      break;
    }
    case 'update-universal-from-plugin': {
      switch (request.entity) {
        case 'skill': {
          const skill = findSkill(snapshot, request.capabilityName);
          assertSelectedManagedPluginCandidate(skill, request.selectedVariantPath);
          return makeSkillCanonical({
            skillName: skill.name,
            selectedVariantPath: request.selectedVariantPath,
          }, {
            ...options,
            paths,
          });
        }
        case 'mcp': {
          const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.capabilityName);
          if (!mcp) throw new Error(`MCP "${request.capabilityName}" is no longer available.`);
          assertSelectedManagedPluginCandidate(mcp, request.selectedVariantPath);
          await updateMcpUniversalFromPluginSource(snapshot, mcp, request.selectedVariantPath, {
            ...options,
            paths,
          });
          break;
        }
        case 'subagent': {
          const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === request.capabilityName);
          if (!subagent) throw new Error(`Subagent "${request.capabilityName}" is no longer available.`);
          assertSelectedManagedPluginCandidate(subagent, request.selectedVariantPath);
          await updateSubagentUniversalFromPluginSource(snapshot, subagent, request.selectedVariantPath, {
            ...options,
            paths,
          });
          break;
        }
      }
      break;
    }
    default: {
      const unsupported = request as { action?: string };
      throw new Error(`Unsupported capability action: ${unsupported.action ?? 'unknown'}`);
    }
  }

  const updatedSnapshot = await scanInventory({
    ...options,
    paths,
  });
  if (request.action === 'choose-universal-version') {
    return resolveSkillIssuesAfterUniversalChoice(
      request.skillName,
      request.selectedVariantPath,
      updatedSnapshot,
      {
        ...options,
        paths,
      },
    );
  }

  return updatedSnapshot;
}

export function assertCapabilityActionRequest(request: unknown): asserts request is CapabilityActionRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Invalid capability action request.');
  }
  const value = request as Record<string, unknown>;
  if (value.action === 'choose-universal-version') {
    if (value.entity !== 'skill'
      || !isNonBlankString(value.skillName)
      || !isNonBlankString(value.selectedVariantPath)) {
      throw new Error('Invalid choose Universal version request.');
    }
    return;
  }
  if (value.action === 'update-universal-from-plugin') {
    if ((value.entity !== 'skill' && value.entity !== 'mcp' && value.entity !== 'subagent')
      || !isNonBlankString(value.capabilityName)
      || !isNonBlankString(value.selectedVariantPath)) {
      throw new Error('Invalid plugin update request.');
    }
    return;
  }
  throw new Error(`Unsupported capability action: ${typeof value.action === 'string' ? value.action : 'unknown'}`);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSelectedManagedPluginCandidate(
  capability: Pick<SkillRecord, 'managedSourceCandidates'>,
  selectedVariantPath: string,
): void {
  const candidate = capability.managedSourceCandidates?.find((entry) =>
    entry.path === selectedVariantPath && entry.relationship === 'differs-from-universal');
  if (!candidate) {
    throw new Error('Choose a current readable plugin update candidate before updating Universal.');
  }
}

async function persistSkillUniversalDecision(
  request: Extract<CapabilityActionRequest, { action: 'choose-universal-version' }>,
  snapshot: SkillInventorySnapshot,
  options: CapabilityActionOptions & { paths: SkillIndexPaths },
): Promise<void> {
  const skill = findSkill(snapshot, request.skillName);
  const selectedLocation = selectRepresentativeLocation(skill, request.selectedVariantPath);
  if (!isSelectableUniversalVersion(selectedLocation)) {
    throw new Error('Choose a readable skill version before making it Universal.');
  }

  const capabilityName = getCapabilityName(skill, selectedLocation);
  const acceptedAlternates = findUniversalDecisionAlternates(snapshot, skill, selectedLocation, capabilityName);
  await materializeSelectedSymlinkUniversal(selectedLocation, snapshot);
  const decision: SkillUniversalDecision = {
    id: createSkillUniversalDecisionId(skill.name, selectedLocation),
    skillName: skill.name,
    state: 'user-confirmed',
    universal: buildSkillUniversalOrigin(selectedLocation),
    acceptedAlternates,
    updatedAt: new Date().toISOString(),
  };
  const config = await readSkillIndexConfig(options.paths.configFile, options);
  const affectedPluginIds = new Set(acceptedAlternates
    .filter((alternate) => alternate.kind === 'plugin' && alternate.pluginId)
    .map((alternate) => `${alternate.host ?? ''}:${alternate.pluginId ?? ''}:${alternate.pluginSkillName ?? ''}`));

  await writeSkillIndexConfig(options.paths.configFile, {
    ...config,
    skillUniversalDecisions: [
      ...(config.skillUniversalDecisions ?? []).filter((candidate) =>
        candidate.skillName !== skill.name
        && !candidate.acceptedAlternates.some((alternate) =>
          alternate.kind === 'plugin'
          && affectedPluginIds.has(`${alternate.host ?? ''}:${alternate.pluginId ?? ''}:${alternate.pluginSkillName ?? ''}`))),
      decision,
    ],
  });
}

function isSelectableUniversalVersion(location: SkillLocationRecord): boolean {
  return location.fileType === 'real-file'
    || (location.fileType === 'symlink' && Boolean(location.resolvedPath));
}

async function materializeSelectedSymlinkUniversal(
  selectedLocation: SkillLocationRecord,
  snapshot: SkillInventorySnapshot,
): Promise<void> {
  if (selectedLocation.fileType !== 'symlink') {
    return;
  }

  if (!selectedLocation.resolvedPath) {
    throw new Error('Choose a readable skill version before making it Universal.');
  }

  assertWritableUniversalMaterializationTarget(selectedLocation, snapshot);
  await mkdir(path.dirname(selectedLocation.path), { recursive: true });
  await rm(selectedLocation.path, { recursive: true, force: true });
  await cp(selectedLocation.resolvedPath, selectedLocation.path, {
    recursive: true,
    dereference: true,
    force: true,
  });
}

function assertWritableUniversalMaterializationTarget(
  selectedLocation: SkillLocationRecord,
  snapshot: SkillInventorySnapshot,
): void {
  const selectedSource = snapshot.sources.find((source) => source.id === selectedLocation.sourceId);
  if (selectedSource?.writable && selectedSource.kind !== 'plugin') {
    return;
  }

  throw new Error('Make Universal can only replace symlinks in writable skill locations.');
}

function findUniversalDecisionAlternates(
  snapshot: SkillInventorySnapshot,
  selectedSkill: SkillRecord,
  selectedLocation: SkillLocationRecord,
  capabilityName: string,
): SkillUniversalAlternate[] {
  const selectedPath = normalizePath(selectedLocation.path);
  const selectedCapabilityNames = getSelectedCapabilityNames(selectedSkill, selectedLocation, capabilityName);
  const equivalentLocations = snapshot.skills
    .filter((skill) =>
      skill.name === selectedSkill.name
      || isPotentialSplitPluginAlternate(skill, selectedCapabilityNames))
    .flatMap((skill) => skill.locations)
    .filter((location) =>
      location.fileType === 'real-file'
      && normalizePath(location.path) !== selectedPath);

  const seen = new Set<string>();
  return equivalentLocations
    .map((location) => buildSkillUniversalAlternate(location))
    .filter((alternate): alternate is SkillUniversalAlternate => alternate !== null)
    .filter((alternate) => {
      const key = alternate.kind === 'plugin'
        ? `plugin:${alternate.host ?? ''}:${alternate.pluginId ?? ''}:${alternate.pluginVersion ?? ''}:${alternate.pluginSkillName ?? ''}`
        : `path:${alternate.sourceId ?? ''}:${alternate.path ?? ''}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getSelectedCapabilityNames(
  skill: SkillRecord,
  selectedLocation: SkillLocationRecord,
  capabilityName: string,
): Set<string> {
  return new Set([
    capabilityName,
    skill.displayName ?? undefined,
    getUnqualifiedSkillName(skill.name),
    path.basename(selectedLocation.path),
    selectedLocation.resolvedPath ? path.basename(selectedLocation.resolvedPath) : undefined,
  ].filter(isNonEmptyString));
}

function isPotentialSplitPluginAlternate(
  skill: SkillRecord,
  selectedCapabilityNames: Set<string>,
): boolean {
  const candidateNames = getPluginCapabilityCandidateNames(skill);
  return candidateNames.some((name) => selectedCapabilityNames.has(name));
}

function getPluginCapabilityCandidateNames(skill: SkillRecord): string[] {
  const pluginLocations = skill.locations.filter((location) =>
    location.fileType === 'real-file'
    && location.provenance?.kind === 'plugin');

  if (pluginLocations.length === 0) {
    return [];
  }

  return [
    skill.displayName ?? undefined,
    getUnqualifiedSkillName(skill.name),
    ...pluginLocations.flatMap((location) => [
      getCapabilityName(skill, location),
      path.basename(location.path),
      location.resolvedPath ? path.basename(location.resolvedPath) : undefined,
    ]),
  ].filter(isNonEmptyString);
}

function getUnqualifiedSkillName(skillName: string): string {
  return skillName.split(':').pop() ?? skillName;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildSkillUniversalOrigin(location: SkillLocationRecord): SkillUniversalOrigin {
  if (location.provenance?.kind === 'plugin' && location.provenance.plugin) {
    return {
      kind: 'plugin',
      host: location.provenance.plugin.host,
      pluginId: location.provenance.plugin.pluginId,
      pluginVersion: location.provenance.plugin.version,
      pluginSkillName: path.basename(location.path),
    };
  }

  return {
    kind: 'path',
    sourceId: location.sourceId,
    path: location.path,
  };
}

function buildSkillUniversalAlternate(location: SkillLocationRecord): SkillUniversalAlternate | null {
  if (location.provenance?.kind === 'plugin' && location.provenance.plugin) {
    return {
      kind: 'plugin',
      host: location.provenance.plugin.host,
      pluginId: location.provenance.plugin.pluginId,
      pluginVersion: location.provenance.plugin.version,
      pluginSkillName: path.basename(location.path),
      reason: 'kept-separate',
    };
  }

  return null;
}

function createSkillUniversalDecisionId(skillName: string, location: SkillLocationRecord): string {
  const hash = createHash('sha256');
  hash.update(skillName);
  hash.update('\0');
  hash.update(location.sourceId);
  hash.update('\0');
  hash.update(normalizePath(location.path));
  return `skill:${hash.digest('hex').slice(0, 12)}`;
}

function findSkill(snapshot: SkillInventorySnapshot, skillName: string): SkillRecord {
  const skill = snapshot.skills.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Skill "${skillName}" is no longer available.`);
  }

  return skill;
}

async function resolveSkillIssuesAfterUniversalChoice(
  skillName: string,
  selectedVariantPath: string,
  snapshot: SkillInventorySnapshot,
  options: CapabilityActionOptions & { paths: SkillIndexPaths },
): Promise<SkillInventorySnapshot> {
  let currentSnapshot = snapshot;

  for (const issue of UNIVERSAL_CHOICE_AUTO_REPAIR_ISSUES) {
    const skill = currentSnapshot.skills.find((entry) => entry.name === skillName);
    if (!(skill?.issueReasons ?? []).includes(issue)) {
      continue;
    }

    currentSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue,
        skillName,
        selectedVariantPath,
      },
      options,
    );
  }

  return currentSnapshot;
}

function selectRepresentativeLocation(skill: SkillRecord, selectedVariantPath?: string): SkillLocationRecord {
  if (selectedVariantPath) {
    const selectedLocation = skill.locations.find((location) => location.path === selectedVariantPath);
    if (!selectedLocation) {
      throw new Error(`Selected variant is no longer available for "${skill.name}".`);
    }

    return selectedLocation;
  }

  const canonicalLocation = skill.locations.find((location) => location.canonical && location.fileType === 'real-file');
  if (canonicalLocation) {
    return canonicalLocation;
  }

  const realFileLocation = skill.locations.find((location) => location.fileType === 'real-file');
  if (realFileLocation) {
    return realFileLocation;
  }

  throw new Error(`Skill "${skill.name}" has no exportable real-file location.`);
}

function getCapabilityName(skill: SkillRecord, location: SkillLocationRecord): string {
  const displayName = skill.displayName?.trim();
  if (displayName) {
    return displayName;
  }

  return path.basename(location.path) || skill.name;
}

function normalizePath(targetPath: string): string {
  return path.normalize(targetPath);
}
