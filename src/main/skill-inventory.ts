import { createHash } from 'node:crypto';
import { readFileSync, type Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentLocationRecord,
  AgentInventoryCounts,
  AgentRecord,
  HomeSummary,
  McpConnectivityRecord,
  McpConfiguredTransportKind,
  McpInventoryCounts,
  McpExpectedLocationRecord,
  McpIssueReason,
  McpLocationRecord,
  McpRecord,
  McpTransportKind,
  PluginRecord,
  PluginSourceRef,
  SkillDetailDiagnostics,
  SkillDefinitionIssue,
  SkillDiffFileRecord,
  SkillDiffRecord,
  SkillDuplicateCandidate,
  SkillInstallKind,
  SkillFrontMatterRequiredField,
  SkillIssueReason,
  SkillInventoryCounts,
  SkillInventorySnapshot,
  SkillInstallSource,
  SkillLocationType,
  SkillLocationRecord,
  SkillPackageFileRecord,
  SkillProvenance,
  SkillRecord,
  SkillScanSource,
  SkillSourceKind,
  SkillStructuralState,
  SkillUniversalAlternate,
  SkillUniversalDecision,
  SubagentInventoryCounts,
  SubagentRecord,
} from '@shared/contracts';
import { buildTextDiffLines } from '@shared/text-diff';
import {
  ensureSkillIndexSandboxLayout,
  ensureSkillIndexLayout,
  readSkillIndexConfig,
  resolveSkillIndexPathsForScanOptions,
  writeSkillIndexConfig,
  type ResolveSkillIndexPathOptions,
} from '@shared/skill-index-paths';

import { applyDefaultInventoryMode, type ScanSkillInventoryOptions } from '@main/inventory-scan-options';
import {
  buildRegisteredInventorySources,
} from '@main/inventory-source-model';
import {
  applyDismissedMcpState,
  countMcps,
  emptyMcpInventoryCounts,
  reconcileCachedMcps,
} from '@main/mcp-inventory';
import { applyDismissedSubagentState, countSubagents } from '@main/subagent-inventory';

interface IndexedSkillLocation extends SkillLocationRecord {
  entrypointContent?: string;
  sourceKind: SkillSourceKind;
  sourceWritable: boolean;
}

interface SkillPackageEntry {
  name: string;
  installKind: SkillInstallKind;
  entrypointPath: string;
  rootPath: string;
}

interface SkillUniversalDecisionContext {
  decision: SkillUniversalDecision;
  acceptedAlternateOnly: boolean;
  resolvedUniversalPaths: string[];
}

const REQUIRED_FRONT_MATTER_FIELDS: SkillFrontMatterRequiredField[] = ['name', 'description'];
const SKILL_NAME_MAX_LENGTH = 64;
const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
type ParsedSkillFrontMatter = Partial<Record<SkillFrontMatterRequiredField, string>>;
type SkillFrontMatterCandidate = Pick<SkillLocationRecord, 'path' | 'modifiedAt' | 'fileType' | 'canonical'> & {
  definitionText?: string;
};
type CanonicalPathLocation = Pick<SkillLocationRecord, 'path' | 'sourceId'> & Partial<Pick<SkillLocationRecord, 'fileType' | 'provenance' | 'resolvedPath'>>;

export interface WatchedSkillInventoryEvent {
  source: SkillScanSource;
  filePath: string;
}

export interface CollectSkillInventoryRecordsOptions {
  sources: SkillScanSource[];
  registeredSources: SkillScanSource[];
  agents: AgentRecord[];
  config: {
    skillUniversalDecisions?: SkillUniversalDecision[];
    dismissedDriftSignatures: string[];
  };
}

export async function collectSkillInventoryRecords({
  sources,
  registeredSources,
  agents,
  config,
}: CollectSkillInventoryRecordsOptions): Promise<SkillRecord[]> {
  const groupedLocations = new Map<string, IndexedSkillLocation[]>();

  for (const source of sources) {
    const locations = await collectLocationsFromSource(source);
    for (const location of locations) {
      const normalizedSkillName = normalizeSelfQualifiedSkillName(location.name);
      const existing = groupedLocations.get(normalizedSkillName) ?? [];
      existing.push(location.record);
      groupedLocations.set(normalizedSkillName, existing);
    }
  }

  const allSkillLocations = [...groupedLocations.values()].flat();
  return [...groupedLocations.entries()]
    .map(([name, locations]) => applyDriftPresentation(
      classifySkillLocations(name, locations, registeredSources, agents, {
        installedSources: sources,
        universalDecisionContext: findSkillUniversalDecisionContext(
          name,
          locations,
          config.skillUniversalDecisions ?? [],
          allSkillLocations,
        ),
      }),
      config.dismissedDriftSignatures,
    ))
    .sort(compareSkillNames);
}

export async function reconcileWatchedSkillInventoryEvent(
  snapshot: SkillInventorySnapshot,
  event: WatchedSkillInventoryEvent,
  options: ScanSkillInventoryOptions = {},
): Promise<SkillInventorySnapshot> {
  const scanOptions = applyDefaultInventoryMode(options);
  const paths = resolveSkillIndexPathsForScanOptions(scanOptions);
  await ensureSkillIndexLayout(paths);
  if (scanOptions.includeSandboxSources === true) {
    await ensureSkillIndexSandboxLayout(paths);
  }
  const config = await readSkillIndexConfig(paths.configFile, scanOptions);
  const registeredSources = buildRegisteredInventorySources({
    ...scanOptions,
    paths,
    customScanPaths: config.customScanPaths,
    preferredCanonicalSourcePath: config.preferredCanonicalSourcePath,
  });

  if (isIgnoredSkillDiscoveryPath(event.source.skillsDir, event.filePath, event.source.ignoredSkillSubpaths)) {
    return snapshot;
  }

  const locationMatch = findSkillLocationByPath(snapshot, event.filePath);
  const watchedSkillEntry = await describeWatchedSkillPackageEntry(event.source.skillsDir, event.filePath);
  if (!watchedSkillEntry && !locationMatch) {
    return snapshot;
  }

  const skillName = locationMatch?.skill.name ?? watchedSkillEntry?.name;
  if (!skillName) {
    return snapshot;
  }
  const existingSkill = snapshot.skills.find((skill) => skill.name === skillName);
  const nextLocationPaths = new Set(existingSkill?.locations.map((location) => location.path) ?? []);

  if (watchedSkillEntry && await isWatchedSkillPackage(watchedSkillEntry)) {
    nextLocationPaths.add(watchedSkillEntry.rootPath);
  } else {
    nextLocationPaths.delete(watchedSkillEntry?.rootPath ?? event.filePath);
  }

  const nextLocations = await Promise.all(
    [...nextLocationPaths]
      .sort((left, right) => left.localeCompare(right))
      .map(async (filePath) => {
        const source = getLocationSource(snapshot, filePath, event.source);
        if (!source) {
          return null;
        }

        return safeReadSkillLocation(filePath, source);
      }),
  );

  const nextSkills = snapshot.skills.filter((skill) => skill.name !== skillName);
  const resolvedLocations = nextLocations.filter((location): location is IndexedSkillLocation => location !== null);

  if (resolvedLocations.length > 0) {
    const allSkillLocations = [
      ...nextSkills.flatMap((skill) => skill.locations),
      ...resolvedLocations,
    ];
    nextSkills.push(
      applyDriftPresentation(
        classifySkillLocations(skillName, resolvedLocations, registeredSources, snapshot.agents ?? [], {
          installedSources: snapshot.sources,
          universalDecisionContext: findSkillUniversalDecisionContext(
            skillName,
            resolvedLocations,
            config.skillUniversalDecisions ?? [],
            allSkillLocations,
          ),
        }),
        config.dismissedDriftSignatures,
      ),
    );
  }

  const sortedSkills = nextSkills.sort(compareSkillNames);
  const nextSnapshot: SkillInventorySnapshot = {
    ...snapshot,
    scannedAt: new Date().toISOString(),
    skills: sortedSkills,
    counts: countSkills(sortedSkills),
    homeSummary: buildHomeSummary(
      countSkills(sortedSkills),
      snapshot.mcpCounts ?? emptyMcpInventoryCounts(),
      snapshot.agentCounts ?? emptyAgentInventoryCounts(),
    ),
  };

  await persistDismissedDriftSignatures(paths.configFile, sortedSkills, scanOptions);
  await writeSkillInventoryCache(paths.cacheFile, nextSnapshot);

  return nextSnapshot;
}

function classifySkillLocations(
  name: string,
  locations: IndexedSkillLocation[],
  sources: SkillScanSource[],
  agents: AgentRecord[],
  options: {
    installedSources?: SkillScanSource[];
    skipDefinitionIssuesWithoutContent?: boolean;
    universalDecisionContext?: SkillUniversalDecisionContext;
  } = {},
): SkillRecord {
  const sortedLocations = [...locations].sort((left, right) => left.path.localeCompare(right.path));
  const scope = sortedLocations[0]?.sourceScope;
  const canonicalPaths = getCanonicalSkillRoots(name, sortedLocations, sources, scope, options.universalDecisionContext);
  const canonicalizedLocations = applySkillCanonicalState(sortedLocations, canonicalPaths);
  const publicLocations = canonicalizedLocations.map(stripLocationContent);
  const detailDiagnostics = buildSkillDetailDiagnostics(name, canonicalizedLocations, sources, agents, {
    canonicalPaths,
    installedSources: options.installedSources,
    universalDecisionContext: options.universalDecisionContext,
    skipDefinitionIssuesWithoutContent: options.skipDefinitionIssuesWithoutContent,
  });
  const displayName = getPreferredSkillDisplayName(canonicalizedLocations, name);
  const description = getPreferredSkillDescription(canonicalizedLocations);
  const issueLocations = getIssueRelevantSkillLocations(canonicalizedLocations, options.universalDecisionContext);
  const canonicalRealFileLocations = issueLocations.filter((location) =>
    location.fileType === 'real-file' && matchesCanonicalSkillPath(location, canonicalPaths));
  const hasExternalPluginSymlinkOrigin = hasPluginSymlinkCanonicalOrigin(issueLocations, canonicalPaths);
  const hasExternalUniversalOrigin = canonicalRealFileLocations.length === 0
    && (hasExternalPluginSymlinkOrigin
      || (options.universalDecisionContext?.acceptedAlternateOnly === false
        && options.universalDecisionContext.decision.universal.kind === 'plugin'
        && options.universalDecisionContext.resolvedUniversalPaths.length > 0));
  const canonicalTargets = new Set(canonicalRealFileLocations.length > 0
    ? canonicalRealFileLocations.map((location) => location.resolvedPath ?? location.path)
    : hasExternalUniversalOrigin
      ? canonicalPaths
      : []);
  const missingInstallSources = detailDiagnostics.missingInstallSources ?? [];
  const definitionIssues = detailDiagnostics.definitionIssues ?? [];
  const issueReasons = getSkillIssueReasons({
    canonicalPaths,
    definitionIssues,
    hasExternalUniversalOrigin,
    locations: issueLocations,
    missingInstallSources,
  });
  const structuralState = determineSkillStructuralState({
    issueReasons,
    locations: issueLocations,
    missingInstallSources,
  });
  const isHealthy = issueReasons.length === 0
    && canonicalTargets.size > 0
    && missingInstallSources.length === 0
    && issueLocations.every((location) => {
      if (location.fileType === 'real-file') {
        return location.canonical && canonicalTargets.has(location.resolvedPath ?? location.path);
      }

      return location.resolvedPath !== undefined && canonicalTargets.has(location.resolvedPath);
    });

  if (isHealthy) {
    return {
      name,
      displayName,
      description,
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      issueReasons: [],
      locations: publicLocations,
      detailDiagnostics,
    };
  }

  return {
    name,
    displayName,
    description,
    structuralState,
    isDrifted: issueReasons.length > 0,
    driftPresentation: 'active',
    issueReasons,
    locations: publicLocations,
    detailDiagnostics,
    driftSignature: issueReasons.length > 0 ? createDriftSignature(name, structuralState, publicLocations, issueReasons) : undefined,
    diff: issueReasons.includes('diverged-copies') ? buildSkillDiff(sortedLocations) : undefined,
  };
}

async function collectLocationsFromSource(
  source: SkillScanSource,
): Promise<Array<{ name: string; record: IndexedSkillLocation }>> {
  const filePaths = await collectSkillEntryFiles(source);
  const npxLockCache: NpxSkillLockCache = new Map();
  const locations = await Promise.all(
    filePaths.map(async ({ rootPath, name }) => {
      const record = await readSkillLocation(rootPath, source, npxLockCache);
      return {
        name: createInventorySkillName(name, source),
        record,
      };
    }),
  );

  return locations;
}

function createInventorySkillName(skillName: string, source: SkillScanSource): string {
  if (source.kind === 'plugin' && source.plugin) {
    if (source.plugin.pluginName === skillName) {
      return skillName;
    }

    return `${source.plugin.pluginName}:${skillName}`;
  }

  return skillName;
}

function normalizeSelfQualifiedSkillName(skillName: string): string {
  const qualifierEnd = skillName.indexOf(':');
  if (qualifierEnd <= 0) {
    return skillName;
  }

  const qualifier = skillName.slice(0, qualifierEnd);
  const unqualifiedName = skillName.slice(qualifierEnd + 1);
  return qualifier === unqualifiedName ? unqualifiedName : skillName;
}

async function collectSkillEntryFiles(source: SkillScanSource): Promise<SkillPackageEntry[]> {
  return collectNestedSkillEntryFiles(source, source.skillsDir, source.skillsDir, new Set());
}

async function collectNestedSkillEntryFiles(
  source: SkillScanSource,
  rootDir: string,
  currentDir: string,
  activeDirectories: Set<string>,
): Promise<SkillPackageEntry[]> {
  const visitKey = await getDirectoryVisitKey(currentDir);
  if (visitKey && activeDirectories.has(visitKey)) {
    return [];
  }
  if (visitKey) {
    activeDirectories.add(visitKey);
  }

  try {
    let entries: Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: SkillPackageEntry[] = [];

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (
        (!entry.isDirectory() && !entry.isSymbolicLink())
        || shouldIgnoreSkillDiscoveryEntry(source, rootDir, entryPath, entry.name)
      ) {
        continue;
      }

      const skillPackage = await describeExistingSkillPackage(rootDir, entryPath);
      if (skillPackage) {
        files.push(skillPackage);
        continue;
      }

      if (await isDirectoryLikePath(entryPath)) {
        files.push(...(await collectNestedSkillEntryFiles(source, rootDir, entryPath, activeDirectories)));
      }
    }

    return files.sort((left, right) => left.rootPath.localeCompare(right.rootPath));
  } finally {
    if (visitKey) {
      activeDirectories.delete(visitKey);
    }
  }
}

async function readSkillLocation(
  rootPath: string,
  source: SkillScanSource,
  npxLockCache: NpxSkillLockCache = new Map(),
): Promise<IndexedSkillLocation> {
  const packageEntry = await describeExistingSkillPackage(source.skillsDir, rootPath);
  if (!packageEntry) {
    throw new Error(`Skill package no longer exists at ${rootPath}`);
  }

  const fileStats = await lstat(rootPath);
  const fileType: SkillLocationType = fileStats.isSymbolicLink() ? 'symlink' : 'real-file';
  const resolvedPath = await safeRealpath(rootPath);
  const symlinkTarget = fileType === 'symlink' ? resolvedPath : undefined;
  const modifiedAt = await getLocationModifiedAt(rootPath, packageEntry.entrypointPath, fileType, resolvedPath);
  const packageFiles = fileType === 'symlink' && resolvedPath === undefined
    ? []
    : await readPackageFiles(rootPath);
  const entrypointText = packageFiles.find((file) => file.relativePath === 'SKILL.md')?.text;
  const contentHash = createPackageContentHash(packageFiles);

  return {
    path: rootPath,
    entrypointPath: packageEntry.entrypointPath,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceScope: source.scope,
    sourceKind: source.kind,
    sourceWritable: source.writable,
    installKind: packageEntry.installKind,
    fileType,
    modifiedAt,
    canonical: source.canonical,
    fileCount: packageFiles.length,
    resolvedPath,
    symlinkTarget,
    contentHash,
    definitionText: entrypointText,
    packageFiles,
    entrypointContent: entrypointText,
    provenance: createSkillLocationProvenance(rootPath, source, modifiedAt, npxLockCache),
    canonicalRole: source.canonical ? 'canonical' : 'materialized-copy',
    mutability: source.writable ? 'writable' : source.kind === 'plugin' ? 'read-only-managed' : 'unknown',
  };
}

function createSkillLocationProvenance(
  rootPath: string,
  source: SkillScanSource,
  discoveredAt: string,
  npxLockCache: NpxSkillLockCache,
): SkillProvenance {
  if (source.plugin) {
    return {
      kind: 'plugin' as const,
      plugin: {
        host: source.plugin.host,
        pluginId: source.plugin.pluginId,
        version: source.plugin.version,
      },
      sourcePath: rootPath,
      discoveredAt,
    };
  }

  const npxLockEntry = findNpxSkillLockEntry(rootPath, source, npxLockCache);
  if (npxLockEntry) {
    return {
      kind: 'npx',
      npx: {
        packageName: npxLockEntry.packageName,
        source: npxLockEntry.source,
        sourceType: npxLockEntry.sourceType,
        sourceUrl: npxLockEntry.sourceUrl,
        skillPath: npxLockEntry.skillPath,
        lockFilePath: npxLockEntry.lockFilePath,
      },
      sourcePath: rootPath,
      discoveredAt,
    };
  }

  const kind = source.kind === 'canonical'
    ? 'universal'
    : source.kind === 'agent'
      ? 'agent-local'
      : source.kind === 'custom'
        ? 'manual'
        : 'unknown';

  return {
    kind,
    sourcePath: rootPath,
    discoveredAt,
  };
}

interface NpxSkillLockEntry {
  packageName: string;
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
  lockFilePath: string;
}

const NPX_SKILL_LOCK_PARSE_FAILED = Symbol('npx-skill-lock-parse-failed');

type NpxSkillLockCache = Map<string, unknown>;

function findNpxSkillLockEntry(
  rootPath: string,
  source: SkillScanSource,
  npxLockCache: NpxSkillLockCache,
): NpxSkillLockEntry | null {
  const skillDirName = path.basename(rootPath);
  for (const lockFilePath of getCandidateSkillLockPaths(source.skillsDir)) {
    const entry = readNpxSkillLockEntry(lockFilePath, skillDirName, npxLockCache);
    if (entry) {
      return entry;
    }
  }

  return null;
}

function getCandidateSkillLockPaths(skillsDir: string): string[] {
  const candidatePaths = [
    path.join(path.dirname(skillsDir), '.skill-lock.json'),
  ];
  const parentDir = path.dirname(skillsDir);
  if (path.basename(parentDir) === '.agents') {
    candidatePaths.push(path.join(path.dirname(parentDir), 'skills-lock.json'));
  }

  return [...new Set(candidatePaths.map((candidatePath) => path.normalize(candidatePath)))];
}

function readNpxSkillLockEntry(
  lockFilePath: string,
  skillDirName: string,
  npxLockCache: NpxSkillLockCache,
): NpxSkillLockEntry | null {
  const parsed = readNpxSkillLockFile(lockFilePath, npxLockCache);
  if (parsed === NPX_SKILL_LOCK_PARSE_FAILED) {
    return null;
  }

  const entry = getSkillLockEntries(parsed).find(([lockedSkillName, candidate]) =>
    lockedSkillName === skillDirName || getLockEntrySkillDirName(candidate) === skillDirName)?.[1];
  if (!entry) {
    return null;
  }

  const source = getOptionalString(entry.source);
  const sourceType = getOptionalString(entry.sourceType);
  const sourceUrl = getOptionalString(entry.sourceUrl);
  const skillPath = getOptionalString(entry.skillPath);
  const packageName = getOptionalString(entry.pluginName)
    ?? (sourceType === 'node_modules' ? source : null)
    ?? source
    ?? 'skills';

  return {
    packageName,
    source,
    sourceType,
    sourceUrl,
    skillPath,
    lockFilePath,
  };
}

function readNpxSkillLockFile(lockFilePath: string, npxLockCache: NpxSkillLockCache): unknown {
  if (npxLockCache.has(lockFilePath)) {
    return npxLockCache.get(lockFilePath);
  }

  try {
    const parsed = JSON.parse(readFileSync(lockFilePath, 'utf8')) as unknown;
    npxLockCache.set(lockFilePath, parsed);
    return parsed;
  } catch {
    npxLockCache.set(lockFilePath, NPX_SKILL_LOCK_PARSE_FAILED);
    return NPX_SKILL_LOCK_PARSE_FAILED;
  }
}

function getSkillLockEntries(parsed: unknown): Array<[string, Record<string, unknown>]> {
  if (!isRecord(parsed) || !isRecord(parsed.skills)) {
    return [];
  }

  return Object.entries(parsed.skills).filter((entry): entry is [string, Record<string, unknown>] =>
    isRecord(entry[1]));
}

function getLockEntrySkillDirName(entry: Record<string, unknown>): string | null {
  const skillPath = getOptionalString(entry.skillPath);
  if (!skillPath) {
    return null;
  }

  return path.basename(path.dirname(skillPath));
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function safeReadSkillLocation(filePath: string, source: SkillScanSource): Promise<IndexedSkillLocation | null> {
  try {
    return await readSkillLocation(filePath, source);
  } catch {
    return null;
  }
}

export function countSkills(skills: SkillRecord[]): SkillInventoryCounts {
  return skills.reduce<SkillInventoryCounts>(
    (counts, skill) => {
      counts.totalSkills += 1;

      switch (skill.structuralState) {
        case 'healthy':
          if ((skill.issueReasons ?? []).length === 0) {
            counts.healthySkills += 1;
          }
          break;
        case 'missing-symlinks':
          counts.missingSymlinkSkills = (counts.missingSymlinkSkills ?? 0) + 1;
          break;
        case 'single-source-noncanonical':
          counts.singleSourceSkills += 1;
          break;
        case 'identical-drift':
          counts.identicalDriftSkills += 1;
          break;
        case 'diverged-drift':
          counts.divergedDriftSkills += 1;
          break;
      }

      if (skill.driftPresentation === 'active') {
        counts.driftedSkills += 1;
      }

      if (skill.driftPresentation === 'dismissed') {
        counts.dismissedDriftSkills += 1;
      }

      return counts;
    },
    {
      totalSkills: 0,
      driftedSkills: 0,
      healthySkills: 0,
      missingSymlinkSkills: 0,
      singleSourceSkills: 0,
      identicalDriftSkills: 0,
      divergedDriftSkills: 0,
      dismissedDriftSkills: 0,
    },
  );
}

export function countAgents(agents: AgentRecord[]): AgentInventoryCounts {
  return agents.reduce<AgentInventoryCounts>(
    (counts, agent) => {
      counts.totalAgents += 1;
      if (agent.installState === 'installed') {
        counts.installedAgents += 1;
      } else {
        counts.notInstalledAgents += 1;
      }

      return counts;
    },
    {
      totalAgents: 0,
      installedAgents: 0,
      notInstalledAgents: 0,
    },
  );
}

export function emptyAgentInventoryCounts(): AgentInventoryCounts {
  return {
    totalAgents: 0,
    installedAgents: 0,
    notInstalledAgents: 0,
  };
}

export function buildHomeSummary(
  skillCounts: SkillInventoryCounts,
  mcpCounts: McpInventoryCounts,
  agentCounts: AgentInventoryCounts,
): HomeSummary {
  return {
    skills: {
      total: skillCounts.totalSkills,
      healthy: skillCounts.healthySkills,
      needsAttention: skillCounts.driftedSkills,
    },
    mcps: {
      total: mcpCounts.totalMcps,
      healthy: mcpCounts.healthyMcps,
      needsAttention: mcpCounts.attentionMcps,
    },
    installedAgents: agentCounts.installedAgents,
  };
}

function applyDriftPresentation(skill: SkillRecord, dismissedDriftSignatures: string[]): SkillRecord {
  if (!skill.isDrifted || !skill.driftSignature) {
    return skill;
  }

  return {
    ...skill,
    driftPresentation: dismissedDriftSignatures.some((signature) =>
      isDismissedDriftSignatureMatch(skill, signature)) ? 'dismissed' : 'active',
  };
}

export function applyDismissedDriftState(
  snapshot: SkillInventorySnapshot,
  dismissedDriftSignatures: string[],
  sources: SkillScanSource[] = snapshot.sources,
): SkillInventorySnapshot {
  const skills = snapshot.skills.map((skill) =>
    applyDriftPresentation(withHydratedSkillDisplayName(skill), dismissedDriftSignatures));
  const sourceIds = sources.map((source) => source.id);
  const counts = countSkills(skills);

  return {
    ...snapshot,
    sourceIds,
    sources,
    skills,
    counts,
    homeSummary: buildHomeSummary(
      counts,
      snapshot.mcpCounts ?? emptyMcpInventoryCounts(),
      snapshot.agentCounts ?? emptyAgentInventoryCounts(),
    ),
  };
}

function findSkillUniversalDecision(
  skillName: string,
  decisions: SkillUniversalDecision[],
): SkillUniversalDecision | undefined {
  return decisions.find((decision) => decision.skillName === skillName);
}

function findSkillUniversalDecisionContext(
  skillName: string,
  locations: SkillLocationRecord[],
  decisions: SkillUniversalDecision[],
  allLocations: SkillLocationRecord[] = locations,
): SkillUniversalDecisionContext | undefined {
  const directDecision = findSkillUniversalDecision(skillName, decisions);
  if (directDecision) {
    return {
      decision: directDecision,
      acceptedAlternateOnly: false,
      resolvedUniversalPaths: resolveUniversalDecisionCanonicalPaths(directDecision, allLocations),
    };
  }

  const pluginLocations = locations.filter((location) => location.provenance?.kind === 'plugin');
  const alternateDecision = decisions.find((decision) =>
    decision.acceptedAlternates.some((alternate) =>
      alternate.kind === 'plugin'
      && pluginLocations.some((location) => {
        const plugin = location.provenance?.plugin;
        if (!plugin) {
          return false;
        }

        return plugin.host === alternate.host
          && plugin.pluginId === alternate.pluginId
          && (alternate.pluginVersion === undefined || plugin.version === alternate.pluginVersion)
          && path.basename(location.path) === alternate.pluginSkillName;
      })));
  if (!alternateDecision) {
    return undefined;
  }

  return {
    decision: alternateDecision,
    acceptedAlternateOnly: true,
    resolvedUniversalPaths: resolveUniversalDecisionCanonicalPaths(alternateDecision, allLocations),
  };
}

export async function persistDismissedDriftSignatures(
  configFile: string,
  skills: SkillRecord[],
  options: ResolveSkillIndexPathOptions = {},
): Promise<void> {
  const latestConfig = await readSkillIndexConfig(configFile, options);
  const nextDismissedDriftSignatures = pruneDismissedDriftSignatures(latestConfig.dismissedDriftSignatures, skills);
  if (haveSameStringEntries(latestConfig.dismissedDriftSignatures, nextDismissedDriftSignatures)) {
    return;
  }

  await writeSkillIndexConfig(configFile, {
    ...latestConfig,
    dismissedDriftSignatures: nextDismissedDriftSignatures,
  });
}

function pruneDismissedDriftSignatures(
  dismissedDriftSignatures: string[],
  skills: SkillRecord[],
): string[] {
  const activeDismissedSignatures = new Set<string>();
  for (const skill of skills) {
    if (skill.driftPresentation !== 'dismissed' || !skill.driftSignature) {
      continue;
    }

    activeDismissedSignatures.add(skill.driftSignature);
    for (const dismissedSignature of dismissedDriftSignatures) {
      if (isDismissedDriftSignatureMatch(skill, dismissedSignature)) {
        activeDismissedSignatures.add(dismissedSignature);
      }
    }
  }
  const visibleSkillLocations = new Map<string, Set<string>>();
  for (const skill of skills) {
    visibleSkillLocations.set(skill.name, collectSkillLocationIdentityKeys(skill.locations));
  }

  return dismissedDriftSignatures.filter((signature) => {
    if (activeDismissedSignatures.has(signature)) {
      return true;
    }

    const dismissedIdentity = parseDismissedDriftSignatureIdentity(signature);
    if (!dismissedIdentity) {
      return false;
    }

    const visibleLocations = visibleSkillLocations.get(dismissedIdentity.name);
    if (!visibleLocations) {
      return true;
    }

    return !hasOverlappingStringEntry(visibleLocations, dismissedIdentity.locationKeys);
  });
}

function haveSameStringEntries(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function collectSkillLocationIdentityKeys(locations: SkillLocationRecord[]): Set<string> {
  const identityKeys = new Set<string>();
  for (const location of locations) {
    identityKeys.add(location.path);
    if (location.resolvedPath) {
      identityKeys.add(location.resolvedPath);
    }
  }

  return identityKeys;
}

function isDismissedDriftSignatureMatch(skill: SkillRecord, signature: string): boolean {
  if (skill.driftSignature === signature) {
    return true;
  }

  if (!isStableMissingSymlinkDismissalCandidate(skill)) {
    return false;
  }

  const dismissedIdentity = parseDismissedDriftSignatureIdentity(signature);
  if (!dismissedIdentity || dismissedIdentity.name !== skill.name) {
    return false;
  }

  if (!dismissedIdentity.issueReasons.includes('missing-symlinks')) {
    return false;
  }

  return hasOverlappingStringEntry(
    collectSkillLocationIdentityKeys(skill.locations),
    dismissedIdentity.locationKeys,
  );
}

function isStableMissingSymlinkDismissalCandidate(skill: SkillRecord): boolean {
  return skill.structuralState === 'missing-symlinks'
    && (skill.issueReasons ?? []).length === 1
    && skill.issueReasons?.[0] === 'missing-symlinks';
}

function parseDismissedDriftSignatureIdentity(signature: string): { name: string; issueReasons: SkillIssueReason[]; locationKeys: Set<string> } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signature);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.name !== 'string' || !Array.isArray(parsed.locations)) {
    return null;
  }
  const issueReasons = Array.isArray(parsed.issueReasons)
    ? parsed.issueReasons.filter(isSkillIssueReason)
    : [];

  const locationKeys = new Set<string>();
  for (const location of parsed.locations) {
    if (!isRecord(location)) {
      continue;
    }
    if (typeof location.path === 'string') {
      locationKeys.add(location.path);
    }
    if (typeof location.resolvedPath === 'string') {
      locationKeys.add(location.resolvedPath);
    }
  }

  if (locationKeys.size === 0) {
    return null;
  }

  return {
    name: parsed.name,
    issueReasons,
    locationKeys,
  };
}

function hasOverlappingStringEntry(left: Set<string>, right: Set<string>): boolean {
  for (const entry of right) {
    if (left.has(entry)) {
      return true;
    }
  }

  return false;
}

function haveSameOptionalStringEntries(left: string[] | undefined, right: string[] | undefined): boolean {
  return haveSameStringEntries(left ?? [], right ?? []);
}

function haveSameSkillScanSources(left: SkillScanSource[], right: SkillScanSource[]): boolean {
  return left.length === right.length
    && left.every((source, index) => {
      const other = right[index];
      return source.id === other?.id
        && source.label === other.label
        && source.canonical === other.canonical
        && source.kind === other.kind
        && source.writable === other.writable
        && source.scope === other.scope
        && source.skillsDir === other.skillsDir
        && haveSameOptionalStringEntries(source.compatibleAgentFamilies, other.compatibleAgentFamilies)
        && haveSameOptionalStringEntries(source.ignoredSkillSubpaths, other.ignoredSkillSubpaths);
    });
}

export function reconcileSkillInventorySnapshot(
  snapshot: SkillInventorySnapshot,
  registeredSources: SkillScanSource[],
  sources: SkillScanSource[],
  agents: AgentRecord[],
  plugins: PluginRecord[],
  universalDecisions: SkillUniversalDecision[],
  dismissedDriftSignatures: string[],
  dismissedMcpSignatures: string[],
  dismissedSubagentSignatures: string[],
): SkillInventorySnapshot {
  const activeSources = sources ?? registeredSources;
  const activeAgents = agents ?? [];
  const nextSourceIds = activeSources.map((source) => source.id);
  if (
    haveSameStringEntries(snapshot.sourceIds, nextSourceIds)
    && haveSameSkillScanSources(snapshot.sources, activeSources)
  ) {
    const mcps = applyDismissedMcpState(snapshot.mcps ?? [], dismissedMcpSignatures);
    const mcpCounts = countMcps(mcps);
    const subagents = applyDismissedSubagentState(snapshot.subagents ?? [], dismissedSubagentSignatures);
    const subagentCounts = countSubagents(subagents);
    const agentCounts = countAgents(activeAgents);

    return applyDismissedDriftState({
      ...snapshot,
      mcps,
      mcpCounts,
      subagents,
      subagentCounts,
      agents: activeAgents,
      plugins,
      agentCounts,
      homeSummary: buildHomeSummary(snapshot.counts, mcpCounts, agentCounts),
    }, dismissedDriftSignatures, activeSources);
  }

  const sourceIds = new Set(activeSources.map((source) => source.id));
  const allActiveSkillLocations = snapshot.skills
    .flatMap((skill) => skill.locations)
    .filter((location) => {
      if (!sourceIds.has(location.sourceId)) {
        return false;
      }

      const source = activeSources.find((entry) => entry.id === location.sourceId);
      if (!source) {
        return false;
      }

      return !isIgnoredSkillDiscoveryPath(source.skillsDir, location.path, source.ignoredSkillSubpaths);
    });
  const skills = snapshot.skills
    .map((skill) => reconcileCachedSkill(
      skill,
      activeSources,
      activeAgents,
      sourceIds,
      universalDecisions,
      allActiveSkillLocations,
    ))
    .filter((skill): skill is SkillRecord => skill !== null)
    .sort(compareSkillNames);
  const reconciledMcps = applyDismissedMcpState(
    reconcileCachedMcps(snapshot.mcps ?? [], activeAgents, activeSources, plugins),
    dismissedMcpSignatures,
  );
  const mcpCounts = countMcps(reconciledMcps);
  const subagents = applyDismissedSubagentState(snapshot.subagents ?? [], dismissedSubagentSignatures);
  const subagentCounts = countSubagents(subagents);
  const agentCounts = countAgents(activeAgents);
  const counts = countSkills(skills);

  return applyDismissedDriftState({
    scannedAt: snapshot.scannedAt,
    sourceIds: nextSourceIds,
    sources: activeSources,
    plugins,
    skills,
    counts,
    mcps: reconciledMcps,
    mcpCounts,
    subagents,
    subagentCounts,
    agents: activeAgents,
    agentCounts,
    homeSummary: buildHomeSummary(counts, mcpCounts, agentCounts),
  }, dismissedDriftSignatures, activeSources);
}

function createDriftSignature(
  name: string,
  structuralState: SkillStructuralState,
  locations: SkillLocationRecord[],
  issueReasons: SkillIssueReason[] = [],
): string {
  return JSON.stringify({
    name,
    structuralState,
    issueReasons,
    locations: locations
      .map((location) => ({
        path: location.path,
        fileType: location.fileType,
        resolvedPath: location.resolvedPath ?? null,
        contentHash: location.contentHash ?? null,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

function buildSkillDiff(locations: IndexedSkillLocation[]) {
  const realFileLocations = locations
    .filter((location) => location.fileType === 'real-file')
    .sort(compareByNewestModifiedAt);

  if (realFileLocations.length < 2) {
    return undefined;
  }

  const [primaryLocation, ...comparisonLocations] = realFileLocations;
  const comparisons = comparisonLocations
    .map((location) => buildDiffComparison(primaryLocation, location))
    .filter((comparison): comparison is NonNullable<ReturnType<typeof buildDiffComparison>> => comparison !== null);

  if (comparisons.length === 0) {
    return undefined;
  }

  return comparisons[0] ?? undefined;
}

function buildDiffComparison(primaryLocation: IndexedSkillLocation, comparisonLocation: IndexedSkillLocation) {
  const files = buildPackageDiffFiles(comparisonLocation, primaryLocation);
  if (files.length === 0) {
    return null;
  }

  return {
    baselinePath: comparisonLocation.path,
    baselineSourceLabel: comparisonLocation.sourceLabel,
    selectedPath: primaryLocation.path,
    selectedSourceLabel: primaryLocation.sourceLabel,
    files,
  };
}

function compareByNewestModifiedAt(left: SkillLocationRecord, right: SkillLocationRecord): number {
  const timestampDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return timestampDifference || left.path.localeCompare(right.path);
}

function compareSkillNames(left: SkillRecord, right: SkillRecord): number {
  return getSkillDisplaySortName(left).localeCompare(getSkillDisplaySortName(right), undefined, { sensitivity: 'base' })
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function getSkillDisplaySortName(skill: Pick<SkillRecord, 'name' | 'displayName'>): string {
  return skill.displayName?.trim() || skill.name;
}

function buildSkillDetailDiagnostics(
  name: string,
  locations: IndexedSkillLocation[],
  sources: SkillScanSource[],
  agents: AgentRecord[],
  options: {
    canonicalPaths?: string[];
    installedSources?: SkillScanSource[];
    skipDefinitionIssuesWithoutContent?: boolean;
    universalDecisionContext?: SkillUniversalDecisionContext;
  } = {},
): SkillDetailDiagnostics {
  const universalDecision = options.universalDecisionContext?.decision;
  const acceptedAlternates = universalDecision?.acceptedAlternates ?? [];
  return {
    duplicateCandidates: buildDuplicateCandidates(locations),
    installSources: buildInstallSources(locations),
    missingInstallSources: options.universalDecisionContext?.acceptedAlternateOnly === true
      ? []
      : buildMissingInstallSources(
        name,
        locations,
        options.installedSources ?? sources,
        agents,
        options.canonicalPaths ?? getCanonicalSkillRoots(name, locations, sources, locations[0]?.sourceScope),
      ),
    definitionIssues: locations.flatMap((location) =>
      buildDefinitionIssues(location, {
        skipWhenContentUnavailable: options.skipDefinitionIssuesWithoutContent,
      })),
    ...(universalDecision ? { universalDecision } : {}),
    ...(acceptedAlternates.length > 0 ? { acceptedAlternates } : {}),
  };
}

function buildDuplicateCandidate(location: IndexedSkillLocation): SkillDuplicateCandidate {
  return {
    ...stripLocationContent(location),
    installSource: createInstallSource(location),
  };
}

function buildDuplicateCandidates(locations: IndexedSkillLocation[]): SkillDuplicateCandidate[] {
  const realFileLocations = locations.filter((location) => location.fileType === 'real-file');
  return realFileLocations.length > 1 ? realFileLocations.map(buildDuplicateCandidate) : [];
}

function buildInstallSources(locations: IndexedSkillLocation[]): SkillInstallSource[] {
  const installSourceById = new Map<string, SkillInstallSource>();

  for (const location of locations) {
    if (!installSourceById.has(location.sourceId)) {
      installSourceById.set(location.sourceId, createInstallSource(location));
    }
  }

  return [...installSourceById.values()];
}

function buildMissingInstallSources(
  name: string,
  locations: IndexedSkillLocation[],
  sources: SkillScanSource[],
  agents: AgentRecord[],
  canonicalPaths: string[],
): SkillInstallSource[] {
  const hasCanonicalRealFile = locations.some((location) =>
    location.fileType === 'real-file'
    && matchesCanonicalSkillPath(location, canonicalPaths));
  if (!hasCanonicalRealFile) {
    return [];
  }

  return getExpectedLinkedSkillSources(name, locations, sources, agents, locations[0]?.sourceScope, canonicalPaths);
}

function buildDefinitionIssues(
  location: IndexedSkillLocation,
  options: {
    skipWhenContentUnavailable?: boolean;
  } = {},
): SkillDefinitionIssue[] {
  const installSource = createInstallSource(location);
  const issues: SkillDefinitionIssue[] = [];

  if (location.fileType === 'symlink') {
    return issues;
  }

  if (location.entrypointContent === undefined) {
    if (options.skipWhenContentUnavailable) {
      return issues;
    }

    issues.push({
      type: 'unreadable-file',
      path: location.path,
      entrypointPath: location.entrypointPath,
      sourceId: location.sourceId,
      sourceLabel: location.sourceLabel,
      sourceScope: location.sourceScope,
      installSource,
      detail: 'Skill Index could not read this file from disk.',
    });
    return issues;
  }

  const frontMatterAnalysis = analyzeFrontMatter(location.entrypointContent);
  if (frontMatterAnalysis.malformed) {
    issues.push({
      type: 'malformed-front-matter',
      path: location.path,
      entrypointPath: location.entrypointPath,
      sourceId: location.sourceId,
      sourceLabel: location.sourceLabel,
      sourceScope: location.sourceScope,
      installSource,
      detail: 'The front matter opens with --- but does not close cleanly.',
    });
  }

  issues.push(...getMissingRequiredFrontMatterFields(location.entrypointContent).map((field) => ({
    type: 'missing-required-field' as const,
    field,
    path: location.path,
    entrypointPath: location.entrypointPath,
    sourceId: location.sourceId,
    sourceLabel: location.sourceLabel,
    sourceScope: location.sourceScope,
    installSource,
  })));

  issues.push(...getInvalidFrontMatterFieldIssues(location.entrypointContent).map((issue) => ({
    ...issue,
    path: location.path,
    entrypointPath: location.entrypointPath,
    sourceId: location.sourceId,
    sourceLabel: location.sourceLabel,
    sourceScope: location.sourceScope,
    installSource,
  })));

  return issues;
}

function createInstallSource(location: IndexedSkillLocation): SkillInstallSource {
  return {
    sourceId: location.sourceId,
    label: location.sourceLabel,
    kind: location.sourceKind,
    scope: location.sourceScope,
    writable: location.sourceWritable,
    canonical: location.canonical,
  };
}

function getMissingRequiredFrontMatterFields(content?: string): SkillFrontMatterRequiredField[] {
  const parsedFrontMatter = analyzeFrontMatter(content).parsed;

  return REQUIRED_FRONT_MATTER_FIELDS.filter((field) => {
    const value = parsedFrontMatter?.[field];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

function getInvalidFrontMatterFieldIssues(
  content?: string,
): Array<Pick<SkillDefinitionIssue, 'type' | 'field' | 'detail'>> {
  const parsedFrontMatter = analyzeFrontMatter(content).parsed;
  const issues: Array<Pick<SkillDefinitionIssue, 'type' | 'field' | 'detail'>> = [];

  const name = parsedFrontMatter?.name;
  if (typeof name === 'string' && name.trim().length > 0) {
    if (name.length > SKILL_NAME_MAX_LENGTH) {
      issues.push({
        type: 'invalid-field-value',
        field: 'name',
        detail: `Invalid field: name must be at most ${SKILL_NAME_MAX_LENGTH} characters`,
      });
    }

    if (name.trim() !== name) {
      issues.push({
        type: 'invalid-field-value',
        field: 'name',
        detail: 'Invalid field: name must not start or end with whitespace',
      });
    }
  }

  const description = parsedFrontMatter?.description;
  if (typeof description === 'string' && description.trim().length > 0 && description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    issues.push({
      type: 'invalid-field-value',
      field: 'description',
      detail: `Invalid field: description must be at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters`,
    });
  }

  return issues;
}

function getPreferredSkillDescription(locations: IndexedSkillLocation[]): string | null {
  const rankedLocations = [...locations].sort(compareLocationsByFrontMatterPriority);

  for (const location of rankedLocations) {
    const description = analyzeFrontMatter(location.entrypointContent).parsed?.description;
    if (typeof description === 'string' && description.trim().length > 0) {
      return description.trim();
    }
  }

  return null;
}

function getPreferredSkillDisplayName(
  locations: SkillFrontMatterCandidate[],
  fallbackName: string,
): string {
  const rankedLocations = [...locations].sort(compareLocationsByFrontMatterPriority);

  for (const location of rankedLocations) {
    const parsedName = analyzeFrontMatter(location.definitionText).parsed?.name;
    if (typeof parsedName === 'string' && parsedName.trim().length > 0) {
      return parsedName.trim();
    }
  }

  return getUnqualifiedSkillDisplayName(fallbackName);
}

function getUnqualifiedSkillDisplayName(fallbackName: string): string {
  const qualifierEnd = fallbackName.lastIndexOf(':');
  if (qualifierEnd <= 0 || qualifierEnd === fallbackName.length - 1) {
    return fallbackName;
  }

  return fallbackName.slice(qualifierEnd + 1);
}

function compareLocationsByFrontMatterPriority<T extends SkillFrontMatterCandidate>(left: T, right: T): number {
  if (left.canonical !== right.canonical) {
    return left.canonical ? -1 : 1;
  }

  if (left.fileType !== right.fileType) {
    return left.fileType === 'real-file' ? -1 : 1;
  }

  const modifiedAtDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return modifiedAtDifference || left.path.localeCompare(right.path);
}

function analyzeFrontMatter(content?: string): { parsed: ParsedSkillFrontMatter | null; malformed: boolean } {
  if (content === undefined) {
    return { parsed: null, malformed: false };
  }

  const normalizedContent = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const lines = normalizedContent.split(/\r?\n/);

  if (lines[0] !== '---') {
    return { parsed: null, malformed: false };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  if (closingIndex === -1) {
    return { parsed: null, malformed: true };
  }

  const fields: ParsedSkillFrontMatter = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):(?:\s*(.*))?$/);
    if (!match) {
      continue;
    }

    const [, rawKey, rawValue = ''] = match;
    if (rawKey === 'name' || rawKey === 'description') {
      fields[rawKey] = normalizeFrontMatterValue(rawValue);
    }
  }

  return { parsed: fields, malformed: false };
}

function normalizeFrontMatterValue(rawValue: string): string {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length < 2) {
    return trimmedValue;
  }

  const startsWithQuote = trimmedValue.startsWith('"') || trimmedValue.startsWith('\'');
  const matchingQuote = trimmedValue[0];

  if (!startsWithQuote || !trimmedValue.endsWith(matchingQuote)) {
    return trimmedValue;
  }

  const innerValue = trimmedValue.slice(1, -1);
  if (matchingQuote === '"') {
    return innerValue.replace(/\\"/g, '"');
  }

  return innerValue.replace(/\\'/g, '\'');
}

function getCanonicalSkillRoots(
  name: string,
  locations: CanonicalPathLocation[],
  sources: SkillScanSource[],
  scope: SkillScanSource['scope'] | undefined,
  universalDecisionContext?: SkillUniversalDecisionContext,
): string[] {
  if (universalDecisionContext && !universalDecisionContext.acceptedAlternateOnly) {
    const decisionCanonicalPaths = resolveUniversalDecisionCanonicalPaths(
      universalDecisionContext.decision,
      locations,
    );
    const resolvedCanonicalPaths = decisionCanonicalPaths.length > 0
      ? decisionCanonicalPaths
      : universalDecisionContext.resolvedUniversalPaths;
    if (resolvedCanonicalPaths.length > 0) {
      return resolvedCanonicalPaths;
    }
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const preferredCanonicalSourceIds = new Set(
    sources
      .filter((source) => source.preferredCanonical === true && source.scope === (scope ?? source.scope))
      .map((source) => source.id),
  );
  const preferredCanonicalPaths = locations
    .filter((location) => preferredCanonicalSourceIds.has(location.sourceId))
    .map((location) => location.path)
    .sort((left, right) => left.localeCompare(right));
  if (preferredCanonicalPaths.length > 0) {
    return [...new Set(preferredCanonicalPaths)];
  }

  const pluginCanonicalPaths = locations
    .filter((location) => {
      const source = sourceById.get(location.sourceId);
      return source?.kind === 'plugin' && source.canonical && source.scope === (scope ?? source.scope);
    })
    .map((location) => location.path)
    .sort((left, right) => left.localeCompare(right));
  if (pluginCanonicalPaths.length > 0) {
    return [...new Set(pluginCanonicalPaths)];
  }

  const pluginSymlinkCanonicalPaths = getPluginSymlinkCanonicalPaths(locations);
  if (pluginSymlinkCanonicalPaths.length > 0) {
    return pluginSymlinkCanonicalPaths;
  }

  const canonicalSource = sources.find((source) =>
    source.canonical && source.scope === (scope ?? source.scope));
  if (!canonicalSource) {
    return [name];
  }

  return [path.join(canonicalSource.skillsDir, name)];
}

function resolveUniversalDecisionCanonicalPaths(
  decision: SkillUniversalDecision,
  locations: CanonicalPathLocation[],
): string[] {
  if (decision.universal.kind === 'path') {
    const universal = decision.universal;
    const pathLocation = locations.find((location) =>
      location.sourceId === universal.sourceId
      && normalizePath(location.path) === normalizePath(universal.path));
    if (pathLocation?.fileType === 'symlink' && pathLocation.resolvedPath) {
      const resolvedPath = normalizePath(pathLocation.resolvedPath);
      const resolvedLocation = locations.find((location) =>
        location.fileType === 'real-file'
        && (normalizePath(location.path) === resolvedPath
          || (location.resolvedPath !== undefined && normalizePath(location.resolvedPath) === resolvedPath)));
      return [resolvedLocation?.path ?? pathLocation.resolvedPath];
    }

    return [pathLocation?.path ?? universal.path];
  }

  const universal = decision.universal;
  const matchingPluginLocations = locations.filter((location) => {
    const plugin = location.provenance?.plugin;
    return plugin?.host === universal.host
      && plugin.pluginId === universal.pluginId
      && path.basename(location.path) === universal.pluginSkillName;
  });
  const exactVersionLocations = matchingPluginLocations.filter((location) =>
    universal.pluginVersion === undefined
    || location.provenance?.plugin?.version === universal.pluginVersion);
  const resolvedLocations = exactVersionLocations.length > 0
    ? exactVersionLocations
    : matchingPluginLocations;
  if (resolvedLocations.length === 0) {
    return [...new Set(locations
      .map((location) => location.resolvedPath)
      .filter((resolvedPath): resolvedPath is string =>
        resolvedPath !== undefined
        && path.basename(resolvedPath) === universal.pluginSkillName)
      .sort((left, right) => left.localeCompare(right)))];
  }

  return [...new Set(resolvedLocations
    .map((location) => location.path)
    .sort((left, right) => left.localeCompare(right)))];
}

function getIssueRelevantSkillLocations<T extends SkillLocationRecord>(
  locations: T[],
  universalDecisionContext?: SkillUniversalDecisionContext,
): T[] {
  if (!universalDecisionContext || universalDecisionContext.acceptedAlternateOnly) {
    return locations;
  }

  const universalPaths = resolveUniversalDecisionCanonicalPaths(
    universalDecisionContext.decision,
    locations,
  );
  const universalComparisonKeys = new Set(locations
    .filter((location) => matchesCachedCanonicalSkillPath(location, universalPaths))
    .map((location) => getSkillComparisonContentHash(location, false)));

  return locations.filter((location) =>
    !universalDecisionContext.decision.acceptedAlternates.some((alternate) =>
      locationMatchesAcceptedAlternate(location, alternate))
    && !isEquivalentReadOnlyPluginMirror(location, universalPaths, universalComparisonKeys));
}

function isEquivalentReadOnlyPluginMirror(
  location: SkillLocationRecord,
  universalPaths: string[],
  universalComparisonKeys: Set<string>,
): boolean {
  return location.provenance?.kind === 'plugin'
    && location.mutability === 'read-only-managed'
    && !matchesCachedCanonicalSkillPath(location, universalPaths)
    && universalComparisonKeys.has(getSkillComparisonContentHash(location, false));
}

function locationMatchesAcceptedAlternate(
  location: SkillLocationRecord,
  alternate: SkillUniversalAlternate,
): boolean {
  if (alternate.kind === 'path') {
    return alternate.path !== undefined
      && normalizePath(location.path) === normalizePath(alternate.path);
  }

  const plugin = location.provenance?.plugin;
  return plugin !== undefined
    && plugin.host === alternate.host
    && plugin.pluginId === alternate.pluginId
    && (alternate.pluginVersion === undefined || plugin.version === alternate.pluginVersion)
    && path.basename(location.path) === alternate.pluginSkillName;
}

function getPluginSymlinkCanonicalPaths(locations: CanonicalPathLocation[]): string[] {
  const pluginSymlinkTargets = locations
    .filter((location) =>
      location.fileType === 'symlink'
      && location.resolvedPath !== undefined
      && isLikelyPluginSkillPath(location.resolvedPath))
    .map((location) => location.resolvedPath as string)
    .sort((left, right) => left.localeCompare(right));
  const uniqueTargets = [...new Set(pluginSymlinkTargets)];
  return uniqueTargets.length === 1 ? uniqueTargets : [];
}

function hasPluginSymlinkCanonicalOrigin(
  locations: SkillLocationRecord[],
  canonicalPaths: string[],
): boolean {
  const normalizedCanonicalPaths = new Set(canonicalPaths.map(normalizePath));
  return canonicalPaths.some(isLikelyPluginSkillPath)
    && locations.some((location) =>
      location.fileType === 'symlink'
      && location.resolvedPath !== undefined
      && normalizedCanonicalPaths.has(normalizePath(location.resolvedPath)));
}

function isLikelyPluginSkillPath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, '/');
  return normalized.includes('/plugins/cache/') && normalized.includes('/skills/');
}

function matchesCanonicalSkillPath(location: IndexedSkillLocation, canonicalPaths: string[]): boolean {
  const normalizedCanonicalPaths = new Set(canonicalPaths.map(normalizePath));
  return normalizedCanonicalPaths.has(normalizePath(location.path))
    || normalizedCanonicalPaths.has(normalizePath(location.resolvedPath ?? location.path));
}

function getExpectedLinkedSkillSources(
  skillName: string,
  locations: Array<Pick<SkillLocationRecord, 'path' | 'sourceId'> & Partial<Pick<SkillLocationRecord, 'resolvedPath'>>>,
  sources: SkillScanSource[],
  agents: AgentRecord[] = [],
  scope: SkillScanSource['scope'] | undefined,
  canonicalPaths: string[],
): SkillInstallSource[] {
  const expectedSourcesById = new Map<string, SkillInstallSource>();
  const canonicalSkillPaths = new Set(canonicalPaths.map(normalizePath));
  const presentSkillPaths = new Set(locations.map((location) => normalizePath(location.path)));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const hasPluginUniversalOrigin = locations.some((location) => {
    const source = sourceById.get(location.sourceId);
    return source?.kind === 'plugin'
      && (canonicalSkillPaths.has(normalizePath(location.path))
        || (location.resolvedPath !== undefined && canonicalSkillPaths.has(normalizePath(location.resolvedPath))));
  });

  if (hasPluginUniversalOrigin) {
    for (const source of sources) {
      if (!source.canonical || !source.writable || source.scope !== (scope ?? source.scope)) {
        continue;
      }

      const canonicalSourceSkillPath = normalizePath(path.join(source.skillsDir, skillName));
      if (canonicalSkillPaths.has(canonicalSourceSkillPath) || presentSkillPaths.has(canonicalSourceSkillPath)) {
        continue;
      }

      expectedSourcesById.set(source.id, {
        sourceId: source.id,
        label: source.label,
        kind: source.kind,
        scope: source.scope,
        writable: source.writable,
        canonical: false,
      });
    }
  }

  for (const agent of agents) {
    if (agent.installState !== 'installed') {
      continue;
    }

    if (scope !== undefined && agent.scope !== scope) {
      continue;
    }

    const agentSkillsPath = agent.skillsLocation.path;
    if (!agentSkillsPath) {
      continue;
    }

    const agentSkillPath = normalizePath(path.join(agentSkillsPath, skillName));
    if (canonicalSkillPaths.has(agentSkillPath) || presentSkillPaths.has(agentSkillPath)) {
      continue;
    }

    const matchingSource = sources.find((source) =>
      source.kind === 'agent'
      && source.scope === agent.scope
      && normalizePath(source.skillsDir) === normalizePath(agentSkillsPath));
    const installedAgentsForPath = agents.filter((candidate) =>
      candidate.installState === 'installed'
      && candidate.scope === agent.scope
      && candidate.skillsLocation.path
      && normalizePath(candidate.skillsLocation.path) === normalizePath(agentSkillsPath));
    const installSource: SkillInstallSource = installedAgentsForPath.length === 1
      ? createAgentInstallSource(agent)
      : matchingSource
        ? createScanSourceInstallSource(matchingSource)
        : createAgentInstallSource(agent);

    expectedSourcesById.set(installSource.sourceId, installSource);
  }

  return [...expectedSourcesById.values()];
}

function createScanSourceInstallSource(source: SkillScanSource): SkillInstallSource {
  return {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    scope: source.scope,
    writable: source.writable,
    canonical: false,
  };
}

function createAgentInstallSource(agent: AgentRecord): SkillInstallSource {
  return {
    sourceId: agent.id,
    label: agent.label,
    kind: 'agent',
    scope: agent.scope,
    writable: agent.writable,
    canonical: false,
  };
}

function getSkillIssueReasons({
  canonicalPaths,
  definitionIssues,
  hasExternalUniversalOrigin = false,
  locations,
  missingInstallSources,
}: {
  canonicalPaths: string[];
  definitionIssues: SkillDefinitionIssue[];
  hasExternalUniversalOrigin?: boolean;
  locations: SkillLocationRecord[];
  missingInstallSources: SkillInstallSource[];
}): SkillIssueReason[] {
  const reasons = new Set<SkillIssueReason>();
  const canonicalRealFiles = locations.filter((location) =>
    location.fileType === 'real-file' && matchesCachedCanonicalSkillPath(location, canonicalPaths));
  const canonicalTargets = new Set(
    canonicalRealFiles.length > 0
      ? canonicalRealFiles.map((location) => normalizePath(location.resolvedPath ?? location.path))
      : canonicalPaths.map(normalizePath),
  );
  const realFileLocations = locations.filter((location) => location.fileType === 'real-file');
  const hasBrokenSymlink = locations.some((location) => location.fileType === 'symlink' && location.resolvedPath === undefined);
  const hasWrongSymlinkTarget = locations.some((location) =>
    location.fileType === 'symlink'
    && location.resolvedPath !== undefined
    && !canonicalTargets.has(normalizePath(location.resolvedPath)));

  if (definitionIssues.length > 0) {
    reasons.add('invalid-definition');
  }

  if (canonicalRealFiles.length === 0 && !hasExternalUniversalOrigin) {
    reasons.add('missing-canonical');
  }

  if (missingInstallSources.length > 0) {
    reasons.add('missing-symlinks');
  }

  if (hasBrokenSymlink) {
    reasons.add('broken-symlink');
  }

  if (hasWrongSymlinkTarget) {
    reasons.add('wrong-symlink-target');
  }

  if (realFileLocations.length > 1) {
    const usePluginMirrorComparison = isCrossHostPluginMirror(realFileLocations);
    const contentHashes = new Set(realFileLocations.map((location) =>
      getSkillComparisonContentHash(location, usePluginMirrorComparison)));
    if (contentHashes.size > 1) {
      reasons.add('diverged-copies');
    } else if (!usePluginMirrorComparison) {
      reasons.add('identical-copies');
    }
  }

  return [...reasons].sort(compareSkillIssueReasons);
}

function isCrossHostPluginMirror(locations: SkillLocationRecord[]): boolean {
  if (locations.length < 2 || !locations.every((location) => location.provenance?.kind === 'plugin')) {
    return false;
  }

  const plugins = locations.map((location) => location.provenance?.plugin);
  if (plugins.some((plugin) => plugin === undefined)) {
    return false;
  }

  const hosts = new Set(plugins.map((plugin) => plugin?.host));
  const versions = new Set(plugins.map((plugin) => plugin?.version ?? 'unknown'));
  return hosts.size > 1 && versions.size <= 1;
}

function getSkillComparisonContentHash(location: SkillLocationRecord, usePluginMirrorComparison: boolean): string {
  if (!usePluginMirrorComparison) {
    return location.contentHash ?? `missing:${location.path}`;
  }

  const packageFiles = location.packageFiles ?? [];
  return createPackageContentHash(packageFiles.filter((file) =>
    !isProviderSpecificPluginAgentMetadata(file.relativePath)));
}

function isProviderSpecificPluginAgentMetadata(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return /^agents\/[^/]+\.ya?ml$/u.test(normalizedPath);
}

function determineSkillStructuralState({
  issueReasons,
  locations,
  missingInstallSources,
}: {
  issueReasons: SkillIssueReason[];
  locations: SkillLocationRecord[];
  missingInstallSources: SkillInstallSource[];
}): SkillStructuralState {
  if (issueReasons.includes('diverged-copies')) {
    return 'diverged-drift';
  }

  if (issueReasons.includes('identical-copies')) {
    return 'identical-drift';
  }

  if (issueReasons.includes('missing-symlinks')) {
    return 'missing-symlinks';
  }

  if (issueReasons.includes('missing-canonical')) {
    return 'single-source-noncanonical';
  }

  return locations.length === 1 && missingInstallSources.length === 0 ? 'healthy' : 'missing-symlinks';
}

function compareSkillIssueReasons(left: SkillIssueReason, right: SkillIssueReason): number {
  return getSkillIssueRank(left) - getSkillIssueRank(right);
}

function getSkillIssueRank(reason: SkillIssueReason): number {
  switch (reason) {
    case 'diverged-copies':
      return 0;
    case 'wrong-symlink-target':
      return 1;
    case 'broken-symlink':
      return 2;
    case 'identical-copies':
      return 3;
    case 'missing-canonical':
      return 4;
    case 'missing-symlinks':
      return 5;
    case 'invalid-definition':
      return 6;
  }
}

function normalizePath(targetPath: string): string {
  return path.normalize(targetPath);
}

function reconcileCachedSkill(
  skill: SkillRecord,
  sources: SkillScanSource[],
  agents: AgentRecord[],
  activeSourceIds: Set<string>,
  universalDecisions: SkillUniversalDecision[] = [],
  allActiveSkillLocations: SkillLocationRecord[] = [],
): SkillRecord | null {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const locations = skill.locations
    .filter((location) => {
      if (!activeSourceIds.has(location.sourceId)) {
        return false;
      }

      const source = sourceById.get(location.sourceId);
      if (!source) {
        return false;
      }

      return !isIgnoredSkillDiscoveryPath(source.skillsDir, location.path, source.ignoredSkillSubpaths);
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (locations.length === 0) {
    return null;
  }

  const realFileLocationKeys = new Set(
    locations
      .filter((location) => location.fileType === 'real-file')
      .map((location) => createLocationCacheKey(location.path, location.sourceId)),
  );
  const definitionIssues = (skill.detailDiagnostics.definitionIssues ?? [])
    .filter((issue) => realFileLocationKeys.has(createLocationCacheKey(issue.path, issue.sourceId)));
  const universalDecisionContext = findSkillUniversalDecisionContext(
    skill.name,
    locations,
    universalDecisions,
    allActiveSkillLocations.length > 0 ? allActiveSkillLocations : locations,
  );
  const canonicalPaths = getCanonicalSkillRoots(skill.name, locations, sources, locations[0]?.sourceScope, universalDecisionContext);
  const canonicalizedLocations = applySkillCanonicalState(locations, canonicalPaths);
  const issueLocations = getIssueRelevantSkillLocations(canonicalizedLocations, universalDecisionContext);
  const missingInstallSources = universalDecisionContext?.acceptedAlternateOnly === true
    ? []
    : computeMissingInstallSourcesFromCachedLocations(
      skill.name,
      canonicalizedLocations,
      sources,
      agents,
      canonicalPaths,
    );
  const installSources = buildCachedInstallSources(canonicalizedLocations, skill.detailDiagnostics.installSources ?? []);
  const canonicalLocationKeys = new Set(canonicalizedLocations.map((location) => createLocationCacheKey(location.path, location.sourceId)));
  const duplicateCandidates = canonicalizedLocations.length > 1
    ? (skill.detailDiagnostics.duplicateCandidates ?? [])
      .filter((candidate) => canonicalLocationKeys.has(createLocationCacheKey(candidate.path, candidate.sourceId)))
      .map((candidate) => applyCanonicalStateToDuplicateCandidate(candidate, canonicalPaths))
    : [];
  const canonicalizedDefinitionIssues = definitionIssues.map((issue) => applyCanonicalStateToDefinitionIssue(issue, canonicalPaths));
  const canonicalRealFileLocations = issueLocations.filter((location) =>
    location.fileType === 'real-file' && matchesCachedCanonicalSkillPath(location, canonicalPaths));
  const hasExternalPluginSymlinkOrigin = hasPluginSymlinkCanonicalOrigin(issueLocations, canonicalPaths);
  const hasExternalUniversalOrigin = canonicalRealFileLocations.length === 0
    && (hasExternalPluginSymlinkOrigin
      || (universalDecisionContext?.acceptedAlternateOnly === false
        && universalDecisionContext.decision.universal.kind === 'plugin'
        && universalDecisionContext.resolvedUniversalPaths.length > 0));
  const issueReasons = getSkillIssueReasons({
    canonicalPaths,
    definitionIssues: canonicalizedDefinitionIssues,
    hasExternalUniversalOrigin,
    locations: issueLocations,
    missingInstallSources,
  });
  const structuralState = determineSkillStructuralState({
    issueReasons,
    locations: issueLocations,
    missingInstallSources,
  });
  const detailDiagnostics: SkillDetailDiagnostics = {
    duplicateCandidates,
    installSources,
    missingInstallSources,
    definitionIssues: canonicalizedDefinitionIssues,
    ...(universalDecisionContext?.decision ? { universalDecision: universalDecisionContext.decision } : {}),
    ...((universalDecisionContext?.decision.acceptedAlternates ?? []).length > 0
      ? { acceptedAlternates: universalDecisionContext?.decision.acceptedAlternates ?? [] }
      : {}),
  };
  const diff = issueReasons.includes('diverged-copies')
    ? pruneCachedSkillDiff(skill.diff, new Set(canonicalizedLocations.map((location) => location.path)))
    : undefined;

  if (isHealthyCachedSkill(canonicalizedLocations, canonicalPaths, missingInstallSources, issueReasons)) {
    return {
      ...skill,
      displayName: getPreferredSkillDisplayName(canonicalizedLocations, skill.name),
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      issueReasons: [],
      locations: canonicalizedLocations,
      detailDiagnostics,
      driftSignature: undefined,
      diff: undefined,
    };
  }

  return {
    ...skill,
    displayName: getPreferredSkillDisplayName(canonicalizedLocations, skill.name),
    structuralState,
    isDrifted: issueReasons.length > 0,
    issueReasons,
    locations: canonicalizedLocations,
    detailDiagnostics,
    driftSignature: issueReasons.length > 0
      ? createDriftSignature(skill.name, structuralState, canonicalizedLocations, issueReasons)
      : undefined,
    diff,
  };
}

function stripLocationContent(location: IndexedSkillLocation): SkillLocationRecord {
  const publicLocation = {
    ...location,
    definitionText: location.fileType === 'real-file' ? location.entrypointContent : undefined,
  } as Partial<IndexedSkillLocation>;
  delete publicLocation.entrypointContent;
  delete publicLocation.sourceKind;
  delete publicLocation.sourceWritable;
  return publicLocation as SkillLocationRecord;
}

function withHydratedSkillDisplayName(skill: SkillRecord): SkillRecord {
  return {
    ...skill,
    displayName: getPreferredSkillDisplayName(skill.locations, skill.name),
  };
}

function applySkillCanonicalState<T extends SkillLocationRecord>(locations: T[], canonicalPaths: string[]): T[] {
  return locations.map((location) => applyCanonicalStateToCachedLocation(location, canonicalPaths));
}

function applyCanonicalStateToCachedLocation<T extends SkillLocationRecord>(location: T, canonicalPaths: string[]): T {
  const isCanonicalPath = matchesCanonicalLocationPath(location.path, canonicalPaths);
  return {
    ...location,
    canonical: isCanonicalPath,
  };
}

function applyCanonicalStateToDuplicateCandidate(
  candidate: SkillDuplicateCandidate,
  canonicalPaths: string[],
): SkillDuplicateCandidate {
  const canonicalizedCandidate = applyCanonicalStateToCachedLocation(candidate, canonicalPaths);
  return {
    ...canonicalizedCandidate,
    installSource: {
      ...candidate.installSource,
      canonical: canonicalizedCandidate.canonical,
    },
  };
}

function applyCanonicalStateToDefinitionIssue(
  issue: SkillDefinitionIssue,
  canonicalPaths: string[],
): SkillDefinitionIssue {
  const isCanonicalPath = matchesCanonicalLocationPath(issue.path, canonicalPaths);
  return {
    ...issue,
    installSource: {
      ...issue.installSource,
      canonical: isCanonicalPath,
    },
  };
}

function buildCachedInstallSources(
  locations: SkillLocationRecord[],
  existingInstallSources: SkillInstallSource[],
): SkillInstallSource[] {
  const installSourceById = new Map<string, SkillInstallSource>();
  const existingInstallSourceById = new Map(existingInstallSources.map((installSource) => [installSource.sourceId, installSource]));

  for (const location of locations) {
    if (!installSourceById.has(location.sourceId)) {
      const existingInstallSource = existingInstallSourceById.get(location.sourceId);
      installSourceById.set(location.sourceId, {
        sourceId: location.sourceId,
        label: existingInstallSource?.label ?? location.sourceLabel,
        kind: existingInstallSource?.kind ?? inferInstallSourceKind(location.sourceId),
        scope: location.sourceScope,
        writable: existingInstallSource?.writable ?? false,
        canonical: location.canonical,
      });
    }
  }

  return [...installSourceById.values()];
}

function inferInstallSourceKind(sourceId: string): SkillSourceKind {
  if (sourceId === 'sandbox-agents' || sourceId === 'live-agents') {
    return 'canonical';
  }

  if (sourceId.startsWith('custom:') || sourceId.startsWith('preferred-canonical:')) {
    return 'custom';
  }

  if (sourceId.includes('plugin')) {
    return 'plugin';
  }

  return 'agent';
}

function isHealthyCachedSkill(
  locations: SkillLocationRecord[],
  canonicalPaths: string[],
  missingInstallSources: SkillInstallSource[],
  issueReasons: SkillIssueReason[],
): boolean {
  const canonicalRealFileLocations = locations.filter((location) =>
    location.canonical
    && location.fileType === 'real-file'
    && matchesCachedCanonicalSkillPath(location, canonicalPaths));
  const canonicalTargets = new Set(canonicalRealFileLocations.map((location) => location.resolvedPath ?? location.path));

  return issueReasons.length === 0
    && canonicalTargets.size > 0
    && missingInstallSources.length === 0
    && locations.every((location) => {
      if (location.fileType === 'real-file') {
        return location.canonical && canonicalTargets.has(location.resolvedPath ?? location.path);
      }

      return location.resolvedPath !== undefined && canonicalTargets.has(location.resolvedPath);
    });
}

function computeMissingInstallSourcesFromCachedLocations(
  name: string,
  locations: SkillLocationRecord[],
  sources: SkillScanSource[],
  agents: AgentRecord[],
  canonicalPaths: string[],
): SkillInstallSource[] {
  const hasCanonicalRealFile = locations.some((location) =>
    location.fileType === 'real-file'
    && matchesCachedCanonicalSkillPath(location, canonicalPaths));
  if (!hasCanonicalRealFile) {
    return [];
  }

  const presentSourceIds = new Set(locations.map((location) => location.sourceId));
  return getExpectedLinkedSkillSources(name, locations, sources, agents, locations[0]?.sourceScope, canonicalPaths)
    .filter((source) => !presentSourceIds.has(source.sourceId));
}

function matchesCachedCanonicalSkillPath(
  location: Pick<SkillLocationRecord, 'path'> & Partial<Pick<SkillLocationRecord, 'resolvedPath'>>,
  canonicalPaths: string[],
): boolean {
  if (matchesCanonicalLocationPath(location.path, canonicalPaths)) {
    return true;
  }

  if (!location.resolvedPath) {
    return false;
  }

  return matchesCanonicalLocationPath(location.resolvedPath, canonicalPaths);
}

function matchesCanonicalLocationPath(locationPath: string, canonicalPaths: string[]): boolean {
  const normalizedCanonicalPaths = new Set(canonicalPaths.map(normalizePath));
  return normalizedCanonicalPaths.has(normalizePath(locationPath));
}

function createLocationCacheKey(filePath: string, sourceId: string): string {
  return `${sourceId}:${filePath}`;
}

function pruneCachedSkillDiff(
  diff: SkillDiffRecord | undefined,
  activePaths: Set<string>,
): SkillDiffRecord | undefined {
  if (!diff) {
    return undefined;
  }

  if (diff.selectedPath || diff.baselinePath || diff.files) {
    if (!diff.selectedPath || !diff.baselinePath) {
      return undefined;
    }
    if (!activePaths.has(diff.selectedPath) || !activePaths.has(diff.baselinePath)) {
      return undefined;
    }

    return {
      ...diff,
      files: diff.files ?? [],
    };
  }

  if (!diff.primaryPath || !activePaths.has(diff.primaryPath)) {
    return undefined;
  }

  const comparisons = (diff.comparisons ?? []).filter((comparison) => activePaths.has(comparison.path));
  if (comparisons.length === 0) {
    return undefined;
  }

  return {
    ...diff,
    comparisons,
  };
}

function findSkillLocationByPath(
  snapshot: SkillInventorySnapshot,
  filePath: string,
): { skill: SkillRecord; location: SkillLocationRecord } | null {
  for (const skill of snapshot.skills) {
    const location = skill.locations.find((entry) =>
      entry.path === filePath
      || entry.entrypointPath === filePath
      || filePath.startsWith(`${entry.path}${path.sep}`));
    if (location) {
      return { skill, location };
    }
  }

  return null;
}

function getLocationSource(
  snapshot: SkillInventorySnapshot,
  filePath: string,
  fallbackSource: SkillScanSource,
): SkillScanSource | null {
  const locationMatch = findSkillLocationByPath(snapshot, filePath);

  if (fallbackSource.id === locationMatch?.location.sourceId || filePath.startsWith(fallbackSource.skillsDir)) {
    return fallbackSource;
  }

  const locationSourceId = locationMatch?.location.sourceId;
  if (!locationSourceId) {
    return null;
  }

  return snapshot.sources.find((source) => source.id === locationSourceId) ?? null;
}

async function describeSkillPackageFromEntrypoint(rootDir: string, entrypointPath: string): Promise<SkillPackageEntry | null> {
  const relativePath = path.relative(rootDir, entrypointPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  if (segments.length >= 2 && segments.at(-1) === 'SKILL.md' && await isFileOrSymlink(entrypointPath)) {
    const rootPath = path.dirname(entrypointPath);
    return {
      name: path.basename(rootPath),
      installKind: 'directory',
      entrypointPath,
      rootPath,
    };
  }

  return null;
}

async function describeExistingSkillPackage(rootDir: string, rootPath: string): Promise<SkillPackageEntry | null> {
  const relativeRootPath = path.relative(rootDir, rootPath);
  if (!relativeRootPath || relativeRootPath.startsWith('..') || path.isAbsolute(relativeRootPath)) {
    return null;
  }

  const directEntrypoint = await describeSkillPackageFromEntrypoint(rootDir, path.join(rootPath, 'SKILL.md'));
  if (directEntrypoint) {
    return directEntrypoint;
  }

  if (await isBrokenTopLevelSkillSymlink(rootDir, rootPath)) {
    return {
      name: path.basename(rootPath),
      installKind: 'directory',
      entrypointPath: path.join(rootPath, 'SKILL.md'),
      rootPath,
    };
  }

  return null;
}

async function describeWatchedSkillPackageEntry(rootDir: string, filePath: string): Promise<SkillPackageEntry | null> {
  const directEntry = await describeSkillPackageFromEntrypoint(rootDir, filePath);
  if (directEntry) {
    return directEntry;
  }

  let currentPath = filePath;
  while (true) {
    const candidateRoot = path.basename(currentPath).toLowerCase() === 'skill.md'
      ? path.dirname(currentPath)
      : currentPath;
    const relativeCandidatePath = path.relative(rootDir, candidateRoot);
    if (!relativeCandidatePath || relativeCandidatePath.startsWith('..') || path.isAbsolute(relativeCandidatePath)) {
      return null;
    }

    const entry = await describeExistingSkillPackage(rootDir, candidateRoot);
    if (entry) {
      return entry;
    }

    const parentPath = path.dirname(candidateRoot);
    if (parentPath === candidateRoot) {
      return null;
    }
    currentPath = parentPath;
  }
}

async function isWatchedSkillPackage(entry: SkillPackageEntry): Promise<boolean> {
  if (await isFileOrSymlink(entry.entrypointPath)) {
    return true;
  }

  try {
    const stats = await lstat(entry.rootPath);
    return stats.isSymbolicLink() && (await safeStat(entry.rootPath)) === null;
  } catch {
    return false;
  }
}

async function isFileOrSymlink(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function isDirectoryPackageRoot(rootPath: string): Promise<boolean> {
  const baseName = path.basename(rootPath);
  if (baseName.toLowerCase().endsWith('.md')) {
    return false;
  }

  try {
    const stats = await lstat(rootPath);
    if (stats.isDirectory()) {
      return true;
    }

    if (!stats.isSymbolicLink()) {
      return false;
    }

    const resolvedStats = await safeStat(rootPath);
    return resolvedStats ? resolvedStats.isDirectory() : false;
  } catch {
    return false;
  }
}

async function isDirectoryLikePath(rootPath: string): Promise<boolean> {
  return isDirectoryPackageRoot(rootPath);
}

function shouldIgnoreSkillDiscoveryEntry(
  source: SkillScanSource,
  rootDir: string,
  entryPath: string,
  name: string,
): boolean {
  return name === 'node_modules'
    || name === '__pycache__'
    || name === 'dist'
    || name === 'build'
    || isIgnoredSkillDiscoveryPath(rootDir, entryPath, source.ignoredSkillSubpaths);
}

function isIgnoredSkillDiscoveryPath(
  rootDir: string,
  targetPath: string,
  ignoredSkillSubpaths: readonly string[] | undefined,
): boolean {
  if (!ignoredSkillSubpaths || ignoredSkillSubpaths.length === 0) {
    return false;
  }

  const relativePath = normalizeIgnoredSkillDiscoveryPath(path.relative(rootDir, targetPath));
  if (!relativePath || relativePath.startsWith('..')) {
    return false;
  }

  return ignoredSkillSubpaths.some((ignoredSubpath) =>
    relativePath === ignoredSubpath || relativePath.startsWith(`${ignoredSubpath}/`));
}

function normalizeIgnoredSkillDiscoveryPath(targetPath: string): string {
  return targetPath.replace(/[\\/]+/gu, '/').replace(/^\.\/+/u, '').replace(/\/+$/u, '');
}

async function isBrokenTopLevelSkillSymlink(rootDir: string, rootPath: string): Promise<boolean> {
  const relativeRootPath = path.relative(rootDir, rootPath);
  if (!relativeRootPath || relativeRootPath.startsWith('..') || path.isAbsolute(relativeRootPath)) {
    return false;
  }

  const segments = relativeRootPath.split(path.sep).filter(Boolean);
  if (segments.length !== 1) {
    return false;
  }

  const baseName = path.basename(rootPath);
  if (baseName.toLowerCase().endsWith('.md')) {
    return false;
  }

  try {
    const stats = await lstat(rootPath);
    if (!stats.isSymbolicLink()) {
      return false;
    }

    return (await safeStat(rootPath)) === null;
  } catch {
    return false;
  }
}

async function readPackageFiles(rootPath: string): Promise<SkillPackageFileRecord[]> {
  const files = await walkPackageFiles(rootPath, rootPath, new Set());
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkPackageFiles(
  rootDir: string,
  currentDir: string,
  activeDirectories: Set<string>,
): Promise<SkillPackageFileRecord[]> {
  const visitKey = await getDirectoryVisitKey(currentDir);
  if (visitKey && activeDirectories.has(visitKey)) {
    return [];
  }
  if (visitKey) {
    activeDirectories.add(visitKey);
  }

  try {
    let entries: Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: SkillPackageFileRecord[] = [];

    for (const entry of entries) {
      if (shouldIgnorePackageEntry(entry.name, entry.isDirectory())) {
        continue;
      }

      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkPackageFiles(rootDir, entryPath, activeDirectories)));
        continue;
      }

      if (entry.isSymbolicLink()) {
        const stats = await safeStat(entryPath);
        if (stats?.isDirectory()) {
          files.push(...(await walkPackageFiles(rootDir, entryPath, activeDirectories)));
          continue;
        }
      }

      const file = await readPackageFile(entryPath, path.relative(rootDir, entryPath));
      if (file) {
        files.push(file);
      }
    }

    return files;
  } finally {
    if (visitKey) {
      activeDirectories.delete(visitKey);
    }
  }
}

function shouldIgnorePackageEntry(name: string, isDirectoryEntry: boolean): boolean {
  if (name.startsWith('.')) {
    return true;
  }

  if (!isDirectoryEntry) {
    return false;
  }

  return name === 'node_modules'
    || name === '__pycache__'
    || name === 'dist'
    || name === 'build';
}

async function readPackageFile(filePath: string, relativePath: string): Promise<SkillPackageFileRecord | null> {
  try {
    const buffer = await readFile(filePath);
    const kind = isProbablyTextFile(buffer, relativePath) ? 'text' : 'binary';
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');

    return {
      relativePath: normalizedRelativePath,
      kind,
      size: buffer.byteLength,
      contentHash: createHash('sha256').update(buffer).digest('hex'),
      text: kind === 'text' ? buffer.toString('utf8') : undefined,
    };
  } catch {
    return null;
  }
}

function isProbablyTextFile(buffer: Buffer, relativePath: string): boolean {
  const textExtensions = new Set([
    '.md',
    '.mdx',
    '.txt',
    '.py',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.json',
    '.jsonc',
    '.yaml',
    '.yml',
    '.toml',
    '.sh',
    '.bash',
    '.zsh',
    '.html',
    '.css',
    '.scss',
    '.sql',
    '.xml',
    '.csv',
  ]);

  if (textExtensions.has(path.extname(relativePath).toLowerCase())) {
    return true;
  }

  for (const byte of buffer.subarray(0, Math.min(buffer.length, 1024))) {
    if (byte === 0) {
      return false;
    }
  }

  return true;
}

function createPackageContentHash(files: SkillPackageFileRecord[]): string {
  const hash = createHash('sha256');
  for (const file of files.slice().sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.kind);
    hash.update('\0');
    hash.update(file.contentHash ?? '');
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function getLocationModifiedAt(
  locationPath: string,
  entrypointPath: string,
  fileType: SkillLocationType,
  resolvedPath?: string,
): Promise<string> {
  if (fileType === 'symlink' && resolvedPath === undefined) {
    const stats = await lstat(locationPath);
    return stats.mtime.toISOString();
  }

  const resolvedEntrypointStats = await safeStat(entrypointPath);
  if (resolvedEntrypointStats) {
    return resolvedEntrypointStats.mtime.toISOString();
  }

  const entrypointStats = await lstat(entrypointPath);
  return entrypointStats.mtime.toISOString();
}

function buildPackageDiffFiles(
  baselineLocation: IndexedSkillLocation,
  selectedLocation: IndexedSkillLocation,
): SkillDiffFileRecord[] {
  const baselineFiles = new Map((baselineLocation.packageFiles ?? []).map((file) => [file.relativePath, file]));
  const selectedFiles = new Map((selectedLocation.packageFiles ?? []).map((file) => [file.relativePath, file]));
  const allRelativePaths = [...new Set([...baselineFiles.keys(), ...selectedFiles.keys()])].sort((left, right) => left.localeCompare(right));
  const diffFiles: SkillDiffFileRecord[] = [];

  for (const relativePath of allRelativePaths) {
    const baselineFile = baselineFiles.get(relativePath);
    const selectedFile = selectedFiles.get(relativePath);

    if (!baselineFile && selectedFile) {
      diffFiles.push({
        relativePath,
        status: selectedFile.kind === 'binary' ? 'binary' : 'added',
        kind: selectedFile.kind,
        lines: selectedFile.kind === 'text' ? buildTextDiffLines(selectedFile.text ?? '', undefined) : undefined,
      });
      continue;
    }

    if (baselineFile && !selectedFile) {
      diffFiles.push({
        relativePath,
        status: baselineFile.kind === 'binary' ? 'binary' : 'removed',
        kind: baselineFile.kind,
        lines: baselineFile.kind === 'text' ? buildTextDiffLines(undefined, baselineFile.text ?? '') : undefined,
      });
      continue;
    }

    if (!baselineFile || !selectedFile || baselineFile.contentHash === selectedFile.contentHash) {
      continue;
    }

    if (baselineFile.kind === 'binary' || selectedFile.kind === 'binary') {
      diffFiles.push({
        relativePath,
        status: 'binary',
        kind: baselineFile.kind === 'binary' ? baselineFile.kind : selectedFile.kind,
      });
      continue;
    }

    diffFiles.push({
      relativePath,
      status: 'changed',
      kind: 'text',
      lines: buildTextDiffLines(selectedFile.text, baselineFile.text),
    });
  }

  return diffFiles;
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function safeRealpath(filePath: string): Promise<string | undefined> {
  try {
    return await realpath(filePath);
  } catch {
    return undefined;
  }
}

async function getDirectoryVisitKey(directoryPath: string): Promise<string | null> {
  return normalizePath(await safeRealpath(directoryPath) ?? directoryPath);
}

export async function readSkillInventoryCache(cacheFile: string): Promise<SkillInventorySnapshot | null> {
  try {
    const raw = await readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isSkillInventorySnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readSkillInventoryCacheSync(cacheFile: string): SkillInventorySnapshot | null {
  try {
    const raw = readFileSync(cacheFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isSkillInventorySnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeSkillInventoryCache(cacheFile: string, snapshot: SkillInventorySnapshot): Promise<void> {
  await writeFile(cacheFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function isSkillInventorySnapshot(value: unknown): value is SkillInventorySnapshot {
  if (!isRecord(value) || !Array.isArray(value.sourceIds) || !Array.isArray(value.sources) || !Array.isArray(value.skills)) {
    return false;
  }

  return typeof value.scannedAt === 'string'
    && value.sourceIds.every(isString)
    && value.sources.every(isSkillScanSource)
    && (value.plugins === undefined || (Array.isArray(value.plugins) && value.plugins.every(isPluginRecord)))
    && value.skills.every(isSkillRecord)
    && isSkillInventoryCounts(value.counts)
    && (value.mcps === undefined || (Array.isArray(value.mcps) && value.mcps.every(isMcpRecord)))
    && (value.mcpCounts === undefined || isMcpInventoryCounts(value.mcpCounts))
    && (value.subagents === undefined || (Array.isArray(value.subagents) && value.subagents.every(isSubagentRecord)))
    && (value.subagentCounts === undefined || isSubagentInventoryCounts(value.subagentCounts))
    && (value.agents === undefined || (Array.isArray(value.agents) && value.agents.every(isAgentRecord)))
    && (value.agentCounts === undefined || isAgentInventoryCounts(value.agentCounts))
    && (value.homeSummary === undefined || isHomeSummary(value.homeSummary));
}

function isSkillScanSource(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isString(value.label)
    && typeof value.canonical === 'boolean'
    && (value.kind === 'canonical' || value.kind === 'agent' || value.kind === 'plugin' || value.kind === 'custom')
    && typeof value.writable === 'boolean'
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && isString(value.skillsDir)
    && (value.compatibleAgentFamilies === undefined
      || (Array.isArray(value.compatibleAgentFamilies) && value.compatibleAgentFamilies.every(isString)))
    && (value.ignoredSkillSubpaths === undefined
      || (Array.isArray(value.ignoredSkillSubpaths) && value.ignoredSkillSubpaths.every(isString)))
    && (value.plugin === undefined || isPluginSourceRef(value.plugin))
    && (value.mcpConfigPath === undefined || isString(value.mcpConfigPath));
}

function isPluginRecord(value: unknown): value is PluginRecord {
  return isRecord(value)
    && isPluginHost(value.host)
    && (value.scope === undefined || value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && isString(value.pluginId)
    && isString(value.pluginName)
    && (value.version === undefined || isString(value.version))
    && isString(value.rootPath)
    && (value.manifestPath === undefined || isString(value.manifestPath))
    && (value.enabled === 'unknown' || typeof value.enabled === 'boolean')
    && Array.isArray(value.bundledSkills)
    && value.bundledSkills.every((skill) =>
      isRecord(skill)
      && isString(skill.name)
      && isString(skill.path)
      && isString(skill.entrypointPath)
      && isString(skill.sourceId))
    && Array.isArray(value.bundledMcps)
    && value.bundledMcps.every((mcp) =>
      isRecord(mcp)
      && isString(mcp.name)
      && isString(mcp.configPath)
      && isString(mcp.sourceId))
    && (value.bundledSubagents === undefined
      || (Array.isArray(value.bundledSubagents)
        && value.bundledSubagents.every((subagent) =>
          isRecord(subagent)
          && isString(subagent.name)
          && isString(subagent.path)
          && isString(subagent.sourceId))))
    && (value.unsupportedHooksCount === undefined || isNumber(value.unsupportedHooksCount))
    && (value.source === undefined
      || (isRecord(value.source)
        && (value.source.marketplace === undefined || isString(value.source.marketplace))
        && (value.source.repository === undefined || isString(value.source.repository))));
}

function isPluginSourceRef(value: unknown): value is PluginSourceRef {
  return isRecord(value)
    && isPluginHost(value.host)
    && isString(value.pluginId)
    && isString(value.pluginName)
    && (value.version === undefined || isString(value.version))
    && isString(value.rootPath)
    && (value.manifestPath === undefined || isString(value.manifestPath));
}

function isSkillProvenance(value: unknown): boolean {
  return isRecord(value)
    && isProvenanceKind(value.kind)
    && (value.plugin === undefined
      || (isRecord(value.plugin)
        && isPluginHost(value.plugin.host)
        && isString(value.plugin.pluginId)
        && (value.plugin.version === undefined || isString(value.plugin.version))))
    && (value.npx === undefined
      || (isRecord(value.npx)
        && isString(value.npx.packageName)
        && (value.npx.source === undefined || isString(value.npx.source))
        && (value.npx.sourceType === undefined || isString(value.npx.sourceType))
        && (value.npx.sourceUrl === undefined || isString(value.npx.sourceUrl))
        && (value.npx.skillPath === undefined || isString(value.npx.skillPath))
        && (value.npx.lockFilePath === undefined || isString(value.npx.lockFilePath))))
    && (value.sourcePath === undefined || isString(value.sourcePath))
    && isString(value.discoveredAt);
}

function isPluginHost(value: unknown): value is 'claude' | 'codex' {
  return value === 'claude' || value === 'codex';
}

function isProvenanceKind(value: unknown): boolean {
  return value === 'plugin'
    || value === 'npx'
    || value === 'manual'
    || value === 'universal'
    || value === 'agent-local'
    || value === 'symlink'
    || value === 'git'
    || value === 'unknown';
}

function isCanonicalRole(value: unknown): boolean {
  return value === 'canonical'
    || value === 'materialized-copy';
}

function isMutability(value: unknown): boolean {
  return value === 'writable'
    || value === 'read-only-managed'
    || value === 'unknown';
}

function isSkillRecord(value: unknown): boolean {
  return isRecord(value)
    && isString(value.name)
    && (value.displayName === undefined || value.displayName === null || isString(value.displayName))
    && (value.description === undefined || value.description === null || isString(value.description))
    && isSkillStructuralState(value.structuralState)
    && typeof value.isDrifted === 'boolean'
    && (value.driftPresentation === 'none' || value.driftPresentation === 'active' || value.driftPresentation === 'dismissed')
    && (value.issueReasons === undefined || (Array.isArray(value.issueReasons) && value.issueReasons.every(isSkillIssueReason)))
    && Array.isArray(value.locations)
    && value.locations.every(isSkillLocationRecord)
    && isSkillDetailDiagnostics(value.detailDiagnostics)
    && (value.diff === undefined || isSkillDiffRecord(value.diff));
}

function isSkillLocationRecord(value: unknown): boolean {
  return isRecord(value)
    && isString(value.path)
    && (value.entrypointPath === undefined || isString(value.entrypointPath))
    && isString(value.sourceId)
    && isString(value.sourceLabel)
    && (value.sourceScope === 'sandbox' || value.sourceScope === 'live' || value.sourceScope === 'custom')
    && (value.installKind === undefined || value.installKind === 'directory')
    && (value.fileType === 'real-file' || value.fileType === 'symlink')
    && isString(value.modifiedAt)
    && typeof value.canonical === 'boolean'
    && (value.fileCount === undefined || isNumber(value.fileCount))
    && (value.resolvedPath === undefined || isString(value.resolvedPath))
    && (value.symlinkTarget === undefined || isString(value.symlinkTarget))
    && (value.contentHash === undefined || isString(value.contentHash))
    && (value.definitionText === undefined || isString(value.definitionText))
    && (value.packageFiles === undefined || (Array.isArray(value.packageFiles) && value.packageFiles.every(isSkillPackageFileRecord)))
    && (value.provenance === undefined || isSkillProvenance(value.provenance))
    && (value.canonicalRole === undefined || isCanonicalRole(value.canonicalRole))
    && (value.mutability === undefined || isMutability(value.mutability));
}

function isSkillInventoryCounts(value: unknown): boolean {
  return isRecord(value)
    && isNumber(value.totalSkills)
    && isNumber(value.driftedSkills)
    && isNumber(value.healthySkills)
    && (value.missingSymlinkSkills === undefined || isNumber(value.missingSymlinkSkills))
    && isNumber(value.singleSourceSkills)
    && isNumber(value.identicalDriftSkills)
    && isNumber(value.divergedDriftSkills)
    && isNumber(value.dismissedDriftSkills);
}

function isAgentLocationRecord(value: unknown): value is AgentLocationRecord {
  return isRecord(value)
    && (value.state === 'available' || value.state === 'unavailable')
    && typeof value.exists === 'boolean'
    && (value.path === undefined || isString(value.path))
    && (value.displayPath === undefined || isString(value.displayPath))
    && (value.reason === undefined || value.reason === 'account-managed' || value.reason === 'not-supported');
}

function isAgentRecord(value: unknown): value is AgentRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.family)
    && isString(value.label)
    && typeof value.writable === 'boolean'
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && (value.installState === 'installed' || value.installState === 'not-installed')
    && (value.mcpConfigKind === undefined
      || value.mcpConfigKind === 'dedicated-file'
      || value.mcpConfigKind === 'agent-config'
      || value.mcpConfigKind === 'directory'
      || value.mcpConfigKind === 'mixed'
      || value.mcpConfigKind === 'none'
      || value.mcpConfigKind === 'unknown')
    && (value.mcpParserKind === undefined
      || value.mcpParserKind === 'json-servers'
      || value.mcpParserKind === 'json-mcpServers'
      || value.mcpParserKind === 'json-mcp'
      || value.mcpParserKind === 'jsonc-mcpServers'
      || value.mcpParserKind === 'jsonc-mcp'
      || value.mcpParserKind === 'jsonc-dotted-amp-mcpServers'
      || value.mcpParserKind === 'jsonc-dotted-zencoder-mcpServers'
      || value.mcpParserKind === 'jsonc-mcp-servers'
      || value.mcpParserKind === 'jsonc-opencode-mcp'
      || value.mcpParserKind === 'yaml'
      || value.mcpParserKind === 'toml'
      || value.mcpParserKind === 'toml-mcpServers-array'
      || value.mcpParserKind === 'none'
      || value.mcpParserKind === 'unknown')
    && (value.mcpSupportedTransports === undefined
      || (Array.isArray(value.mcpSupportedTransports) && value.mcpSupportedTransports.every(isMcpConfiguredTransportKind)))
    && (value.mcpWriteDialect === undefined
      || value.mcpWriteDialect === 'json-url'
      || value.mcpWriteDialect === 'json-type-url'
      || value.mcpWriteDialect === 'json-http-url'
      || value.mcpWriteDialect === 'json-opencode'
      || value.mcpWriteDialect === 'json-openclaw'
      || value.mcpWriteDialect === 'toml-codex'
      || value.mcpWriteDialect === 'toml-transport-array'
      || value.mcpWriteDialect === 'yaml-typed'
      || value.mcpWriteDialect === 'none'
      || value.mcpWriteDialect === 'unknown')
    && (value.subagentConfigKind === undefined
      || value.subagentConfigKind === 'directory'
      || value.subagentConfigKind === 'agent-config'
      || value.subagentConfigKind === 'plugin-only'
      || value.subagentConfigKind === 'account-managed'
      || value.subagentConfigKind === 'none'
      || value.subagentConfigKind === 'unknown')
    && (value.subagentParserKind === undefined
      || value.subagentParserKind === 'markdown-frontmatter'
      || value.subagentParserKind === 'codex-toml'
      || value.subagentParserKind === 'json'
      || value.subagentParserKind === 'jsonc'
      || value.subagentParserKind === 'toml'
      || value.subagentParserKind === 'yaml'
      || value.subagentParserKind === 'none'
      || value.subagentParserKind === 'unknown')
    && (value.subagentWriteDialect === undefined
      || value.subagentWriteDialect === 'markdown-frontmatter'
      || value.subagentWriteDialect === 'codex-toml'
      || value.subagentWriteDialect === 'json'
      || value.subagentWriteDialect === 'jsonc'
      || value.subagentWriteDialect === 'toml'
      || value.subagentWriteDialect === 'yaml'
      || value.subagentWriteDialect === 'none'
      || value.subagentWriteDialect === 'unknown')
    && (value.metadataSources === undefined
      || (Array.isArray(value.metadataSources)
        && value.metadataSources.every((source) => isRecord(source) && isString(source.url) && (source.note === undefined || isString(source.note)))))
    && (value.icon === undefined
      || (isRecord(value.icon)
        && (value.icon.assetUrl === undefined || isString(value.icon.assetUrl))
        && (value.icon.format === undefined || isString(value.icon.format))
        && (value.icon.assetPathInArchive === undefined || isString(value.icon.assetPathInArchive))
        && (value.icon.note === undefined || isString(value.icon.note))))
    && isAgentLocationRecord(value.skillsLocation)
    && isAgentLocationRecord(value.mcpConfigLocation)
    && (value.subagentsLocation === undefined || isAgentLocationRecord(value.subagentsLocation))
    && (value.configLocation === undefined || isAgentLocationRecord(value.configLocation))
    && (value.executableLocation === undefined || isAgentLocationRecord(value.executableLocation));
}

function isAgentInventoryCounts(value: unknown): value is AgentInventoryCounts {
  return isRecord(value)
    && isNumber(value.totalAgents)
    && isNumber(value.installedAgents)
    && isNumber(value.notInstalledAgents);
}

function isMcpLocationRecord(value: unknown): value is McpLocationRecord {
  return isRecord(value)
    && isString(value.agentId)
    && isString(value.agentLabel)
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && isString(value.configPath)
    && (value.transport === undefined || isMcpTransportKind(value.transport))
    && (value.command === undefined || isString(value.command))
    && (value.url === undefined || isString(value.url))
    && Array.isArray(value.args)
    && value.args.every(isString)
    && (value.definitionText === undefined || isString(value.definitionText))
    && (value.definitionComparisonKey === undefined || isString(value.definitionComparisonKey))
    && (value.invalidDetails === undefined || (Array.isArray(value.invalidDetails) && value.invalidDetails.every(isString)))
    && (value.connectivity === undefined || isMcpConnectivityRecord(value.connectivity))
    && (value.provenance === undefined || isSkillProvenance(value.provenance))
    && (value.canonicalRole === undefined || isCanonicalRole(value.canonicalRole))
    && (value.mutability === undefined || isMutability(value.mutability));
}

function isMcpConnectivityRecord(value: unknown): value is McpConnectivityRecord {
  return isRecord(value)
    && isMcpConnectivityStatus(value.status)
    && (value.checkedAt === undefined || isString(value.checkedAt))
    && (value.latencyMs === undefined || isNumber(value.latencyMs))
    && (value.error === undefined || isString(value.error))
    && (value.capabilities === undefined
      || (isRecord(value.capabilities)
        && (value.capabilities.tools === undefined || isNumber(value.capabilities.tools))
        && (value.capabilities.resources === undefined || isNumber(value.capabilities.resources))
        && (value.capabilities.prompts === undefined || isNumber(value.capabilities.prompts))));
}

function isMcpConnectivityStatus(value: unknown): boolean {
  return value === 'verified'
    || value === 'failed'
    || value === 'skipped'
    || value === 'unknown';
}

function isMcpExpectedLocationRecord(value: unknown): value is McpExpectedLocationRecord {
  return isRecord(value)
    && isString(value.agentId)
    && isString(value.agentLabel)
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && (value.configPath === undefined || isString(value.configPath))
    && (value.supportStatus === undefined || value.supportStatus === 'supported' || value.supportStatus === 'unsupported')
    && (value.unsupportedReason === undefined
      || value.unsupportedReason === 'remote-mcp-not-supported'
      || value.unsupportedReason === 'transport-not-supported')
    && (value.unsupportedTransport === undefined || isMcpConfiguredTransportKind(value.unsupportedTransport));
}

function isMcpRecord(value: unknown): value is McpRecord {
  return isRecord(value)
    && isString(value.name)
    && (value.status === 'healthy' || value.status === 'needs-attention')
    && (value.presentation === 'none' || value.presentation === 'active' || value.presentation === 'dismissed')
    && Array.isArray(value.locations)
    && value.locations.every(isMcpLocationRecord)
    && (value.expectedLocations === undefined || (Array.isArray(value.expectedLocations) && value.expectedLocations.every(isMcpExpectedLocationRecord)))
    && (value.missingLocations === undefined || (Array.isArray(value.missingLocations) && value.missingLocations.every(isMcpExpectedLocationRecord)))
    && Array.isArray(value.issueReasons)
    && value.issueReasons.every(isMcpIssueReason)
    && (value.signature === undefined || isString(value.signature));
}

function isMcpInventoryCounts(value: unknown): value is McpInventoryCounts {
  return isRecord(value)
    && isNumber(value.totalMcps)
    && isNumber(value.attentionMcps)
    && isNumber(value.healthyMcps)
    && isNumber(value.dismissedAttentionMcps);
}

function isSubagentLocationRecord(value: unknown): value is SubagentRecord['locations'][number] {
  return isRecord(value)
    && isString(value.agentId)
    && isString(value.agentLabel)
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && isString(value.path)
    && isString(value.directoryPath)
    && (value.fileType === 'real-file' || value.fileType === 'symlink')
    && isString(value.modifiedAt)
    && typeof value.canonical === 'boolean'
    && isSubagentParserKind(value.format)
    && (value.definitionText === undefined || isString(value.definitionText))
    && (value.definitionComparisonKey === undefined || isString(value.definitionComparisonKey))
    && (value.invalidDetails === undefined || (Array.isArray(value.invalidDetails) && value.invalidDetails.every(isString)))
    && (value.resolvedPath === undefined || isString(value.resolvedPath))
    && (value.symlinkTarget === undefined || isString(value.symlinkTarget))
    && (value.provenance === undefined || isSkillProvenance(value.provenance))
    && (value.canonicalRole === undefined || isCanonicalRole(value.canonicalRole))
    && (value.mutability === undefined || isMutability(value.mutability));
}

function isSubagentExpectedLocationRecord(value: unknown): value is NonNullable<SubagentRecord['expectedLocations']>[number] {
  return isRecord(value)
    && isString(value.agentId)
    && isString(value.agentLabel)
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && (value.directoryPath === undefined || isString(value.directoryPath))
    && (value.path === undefined || isString(value.path))
    && (value.format === undefined || isSubagentParserKind(value.format))
    && (value.supportStatus === undefined || value.supportStatus === 'supported' || value.supportStatus === 'unsupported')
    && (value.unsupportedReason === undefined
      || value.unsupportedReason === 'not-documented'
      || value.unsupportedReason === 'unsupported-format'
      || value.unsupportedReason === 'account-managed');
}

function isSubagentRecord(value: unknown): value is SubagentRecord {
  return isRecord(value)
    && isString(value.name)
    && (value.displayName === undefined || value.displayName === null || isString(value.displayName))
    && (value.description === undefined || value.description === null || isString(value.description))
    && (value.status === 'healthy' || value.status === 'needs-attention')
    && (value.presentation === 'none' || value.presentation === 'active' || value.presentation === 'dismissed')
    && Array.isArray(value.locations)
    && value.locations.every(isSubagentLocationRecord)
    && (value.expectedLocations === undefined || (Array.isArray(value.expectedLocations) && value.expectedLocations.every(isSubagentExpectedLocationRecord)))
    && (value.missingLocations === undefined || (Array.isArray(value.missingLocations) && value.missingLocations.every(isSubagentExpectedLocationRecord)))
    && Array.isArray(value.issueReasons)
    && value.issueReasons.every(isSubagentIssueReason)
    && (value.signature === undefined || isString(value.signature));
}

function isSubagentInventoryCounts(value: unknown): value is SubagentInventoryCounts {
  return isRecord(value)
    && isNumber(value.totalSubagents)
    && isNumber(value.attentionSubagents)
    && isNumber(value.healthySubagents)
    && isNumber(value.dismissedAttentionSubagents);
}

function isSubagentParserKind(value: unknown): boolean {
  return value === 'markdown-frontmatter'
    || value === 'codex-toml'
    || value === 'json'
    || value === 'jsonc'
    || value === 'toml'
    || value === 'yaml'
    || value === 'none'
    || value === 'unknown';
}

function isSubagentIssueReason(value: unknown): boolean {
  return value === 'missing-universal'
    || value === 'missing-from-agents'
    || value === 'definition-mismatch'
    || value === 'identical-copies'
    || value === 'broken-symlink'
    || value === 'wrong-symlink-target'
    || value === 'invalid-definition';
}

function isHomeSummaryMetric(value: unknown): boolean {
  return isRecord(value)
    && isNumber(value.total)
    && isNumber(value.healthy)
    && isNumber(value.needsAttention);
}

function isHomeSummary(value: unknown): value is HomeSummary {
  return isRecord(value)
    && isHomeSummaryMetric(value.skills)
    && isHomeSummaryMetric(value.mcps)
    && isNumber(value.installedAgents);
}

function isSkillDetailDiagnostics(value: unknown): value is SkillDetailDiagnostics {
  return isRecord(value)
    && Array.isArray(value.duplicateCandidates)
    && value.duplicateCandidates.every(isSkillDuplicateCandidate)
    && Array.isArray(value.installSources)
    && value.installSources.every(isSkillInstallSource)
    && (value.missingInstallSources === undefined || (Array.isArray(value.missingInstallSources) && value.missingInstallSources.every(isSkillInstallSource)))
    && (value.definitionIssues === undefined || (Array.isArray(value.definitionIssues) && value.definitionIssues.every(isSkillDefinitionIssue)));
}

function isSkillPackageFileRecord(value: unknown): value is SkillPackageFileRecord {
  return isRecord(value)
    && isString(value.relativePath)
    && (value.kind === 'text' || value.kind === 'binary')
    && isNumber(value.size)
    && (value.contentHash === undefined || isString(value.contentHash))
    && (value.text === undefined || isString(value.text));
}

function isSkillDiffLineRecord(value: unknown): boolean {
  return isRecord(value)
    && (value.type === 'context' || value.type === 'added' || value.type === 'removed')
    && isString(value.text);
}

function isLegacySkillDiffComparison(value: unknown): boolean {
  return isRecord(value)
    && isString(value.path)
    && isString(value.sourceLabel)
    && Array.isArray(value.lines)
    && value.lines.every(isSkillDiffLineRecord);
}

function isSkillDiffFileRecord(value: unknown): value is SkillDiffFileRecord {
  return isRecord(value)
    && isString(value.relativePath)
    && (value.status === 'changed' || value.status === 'added' || value.status === 'removed' || value.status === 'binary')
    && (value.kind === 'text' || value.kind === 'binary')
    && (value.lines === undefined || (Array.isArray(value.lines) && value.lines.every(isSkillDiffLineRecord)));
}

function isSkillDiffRecord(value: unknown): boolean {
  return isRecord(value)
    && (value.baselinePath === undefined || isString(value.baselinePath))
    && (value.baselineSourceLabel === undefined || isString(value.baselineSourceLabel))
    && (value.selectedPath === undefined || isString(value.selectedPath))
    && (value.selectedSourceLabel === undefined || isString(value.selectedSourceLabel))
    && (value.files === undefined || (Array.isArray(value.files) && value.files.every(isSkillDiffFileRecord)))
    && (value.primaryPath === undefined || isString(value.primaryPath))
    && (value.primarySourceLabel === undefined || isString(value.primarySourceLabel))
    && (value.comparisons === undefined || (Array.isArray(value.comparisons) && value.comparisons.every(isLegacySkillDiffComparison)));
}

function isSkillDuplicateCandidate(value: unknown): value is SkillDuplicateCandidate {
  return isRecord(value)
    && isSkillLocationRecord(value)
    && (value.definitionText === undefined || isString(value.definitionText))
    && isSkillInstallSource(value.installSource);
}

function isSkillInstallSource(value: unknown): value is SkillInstallSource {
  return isRecord(value)
    && isString(value.sourceId)
    && isString(value.label)
    && (value.kind === 'canonical' || value.kind === 'agent' || value.kind === 'plugin' || value.kind === 'custom')
    && (value.scope === 'sandbox' || value.scope === 'live' || value.scope === 'custom')
    && typeof value.writable === 'boolean'
    && typeof value.canonical === 'boolean';
}

function isSkillDefinitionIssue(value: unknown): value is SkillDefinitionIssue {
  return isRecord(value)
    && (
      value.type === 'missing-required-field'
      || value.type === 'invalid-field-value'
      || value.type === 'malformed-front-matter'
      || value.type === 'unreadable-file'
    )
    && (value.field === undefined || value.field === 'name' || value.field === 'description')
    && isString(value.path)
    && (value.entrypointPath === undefined || isString(value.entrypointPath))
    && isString(value.sourceId)
    && isString(value.sourceLabel)
    && (value.sourceScope === 'sandbox' || value.sourceScope === 'live' || value.sourceScope === 'custom')
    && isSkillInstallSource(value.installSource)
    && (value.detail === undefined || isString(value.detail));
}

function isSkillStructuralState(value: unknown): value is SkillStructuralState {
  return value === 'healthy'
    || value === 'missing-symlinks'
    || value === 'single-source-noncanonical'
    || value === 'identical-drift'
    || value === 'diverged-drift';
}

function isSkillIssueReason(value: unknown): value is SkillIssueReason {
  return value === 'missing-symlinks'
    || value === 'missing-canonical'
    || value === 'identical-copies'
    || value === 'diverged-copies'
    || value === 'broken-symlink'
    || value === 'wrong-symlink-target'
    || value === 'invalid-definition';
}

function isMcpIssueReason(value: unknown): value is McpIssueReason {
  return value === 'missing-universal'
    || value === 'definition-mismatch'
    || value === 'missing-from-agents'
    || value === 'invalid-definition'
    || value === 'connection-failed';
}

function isMcpTransportKind(value: unknown): value is McpTransportKind {
  return value === 'stdio'
    || value === 'streamable-http'
    || value === 'sse'
    || value === 'http'
    || value === 'unknown';
}

function isMcpConfiguredTransportKind(value: unknown): value is McpConfiguredTransportKind {
  return value === 'stdio'
    || value === 'streamable-http'
    || value === 'sse'
    || value === 'http';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}
