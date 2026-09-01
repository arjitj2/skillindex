import { cp, lstat, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  AddMcpServerRequest,
  AgentRecord,
  AgentMcpWriteDialect,
  AgentSubagentParserKind,
  McpConfiguredTransportKind,
  McpDefinitionObject,
  McpDefinitionValue,
  McpLocationRecord,
  McpServerDefinition,
  McpServerDefinitions,
  ResolveIssueRequest,
  SkillInventorySnapshot,
  SkillLocationRecord,
  SkillRecord,
  SubagentExpectedLocationRecord,
  SubagentLocationRecord,
  SubagentRecord,
} from '@shared/contracts';
import {
  MCP_AGENT_LOCAL_KEY,
  buildPortableMcpDefinition,
  getMcpDefinitionArgs,
  isMcpDefinitionObject,
  isMcpServerDefinitions,
  splitMcpDefinitionForComparison,
} from '@shared/mcp-definition';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPathsForScanOptions,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';
import {
  getSubagentFileNameForFormat,
  isMarkdownSubagentSymlinkCompatible,
  isSubagentFormatRenderableFromUniversal,
} from '@shared/subagent-format-policy';
import {
  parseTomlMcpServerArray,
  parseTomlMcpServers,
  updateTomlMcpServerArray,
  updateTomlMcpServers,
} from '@shared/toml-mcp';

import { sanitizeJsonc, sortRecordValue } from '@main/json-utils';
import { makeSkillCanonical } from '@main/skill-canonicalization';
import {
  assertSafeSkillPackageName,
  assertPluginManagedSkillPackageSymlinksContained,
  assertSkillSourceAndDestinationDoNotOverlap,
  assertSafeUniversalSkillMutation,
  assertSafeWritableSkillLinkMutation,
  isAgentSatisfiedByNativePlugin,
  isPluginManagedTargetThroughRealpath,
  isPluginManagedTarget,
} from '@main/plugin-managed-sources';
import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';
import {
  readPortableSubagentDefinitionFromFile,
  renderPortableSubagentDefinition,
  type PortableSubagentDefinition,
} from '@main/subagent-inventory';
import { persistSkillUniversalDecisionForSelection } from '@main/skill-universal-decisions';
import { replaceSkillLinksTransaction } from '@main/skill-link-transaction';

export interface ResolveIssueOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
  /** Snapshot freshly prepared by the runtime for audit and mutation planning. */
  preparedSnapshot?: SkillInventorySnapshot;
  /** Test-only deterministic failure point for skill link transactions. */
  testFailSkillLinkAt?: number;
  /** Test-only deterministic failure point for skill Universal decision persistence. */
  testFailSkillDecisionPersist?: boolean;
  /** Test-only deterministic failure point for staged subagent mutations. */
  testFailSubagentMutationAt?: number;
  /** Test-only deterministic failure point for subagent rendering. */
  testFailSubagentRenderAt?: number;
  /** Test-only deterministic failure point while staging subagent mutations. */
  testFailSubagentStageAt?: number;
  /** Test-only failure after a subagent stage entry has been created. */
  testFailSubagentStageAfterCreateAt?: number;
  /** Test-only deterministic failure point for staged MCP config mutations. */
  testFailMcpMutationAt?: number;
  /** Test-only failure immediately before an MCP config's atomic commit. */
  testFailMcpCommitAt?: number;
}

export interface McpMutationTarget {
  agentId: string;
  configPath: string;
  parserKind:
    | 'json-servers'
    | 'json-mcpServers'
    | 'json-mcp'
    | 'jsonc-mcpServers'
    | 'jsonc-mcp'
    | 'jsonc-dotted-amp-mcpServers'
    | 'jsonc-dotted-zencoder-mcpServers'
    | 'jsonc-mcp-servers'
    | 'jsonc-opencode-mcp'
    | 'toml'
    | 'toml-mcpServers-array';
  universal?: boolean;
  writeDialect: AgentMcpWriteDialect;
}

interface SelectedMcpDefinition {
  agentLocal: Record<string, McpDefinitionObject>;
  agentLocalKey?: string;
  core: McpDefinitionObject;
  native: McpDefinitionObject;
}

interface CanonicalSkillPackage {
  path: string;
  location: SkillLocationRecord;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface CanonicalSubagentPackage {
  allowInvalid?: boolean;
  path: string;
  definition: PortableSubagentDefinition;
}

interface SubagentWriteTarget {
  agentId: string;
  family?: string;
  format: AgentSubagentParserKind;
  localExtrasKeys?: string[];
  path: string;
}

interface SubagentMutationSafetyContext {
  canonicalPath: string;
  scope: SubagentLocationRecord['scope'];
  snapshot: SkillInventorySnapshot;
}

interface StagedSubagentMutation {
  path: string;
  rendered?: string;
  symlinkTarget?: string;
}

export async function resolveInventoryIssue(
  request: ResolveIssueRequest,
  options: ResolveIssueOptions = {},
): Promise<SkillInventorySnapshot> {
  const { preparedSnapshot, ...scanOptions } = options;
  const paths = scanOptions.paths ?? resolveSkillIndexPathsForScanOptions(scanOptions);
  await ensureSkillIndexLayout(paths);

  const snapshot = preparedSnapshot ?? await scanInventory({
    ...scanOptions,
    paths,
  });

  assertResolutionIssueIsCurrent(snapshot, request);
  assertExplicitPluginPromotionSelection(snapshot, request);

  if (request.entity === 'skill') {
    await resolveSkillIssueIfCurrent(snapshot, request, {
      ...scanOptions,
      paths,
    });
  } else if (request.entity === 'mcp') {
    await resolveMcpIssueIfCurrent(snapshot, request, {
      ...scanOptions,
      paths,
    });
  } else {
    await resolveSubagentIssueIfCurrent(snapshot, request, {
      ...scanOptions,
      paths,
    });
  }

  const nextSnapshot = await scanInventory({
    ...scanOptions,
    paths,
  });
  assertResolutionIssueWasResolved(nextSnapshot, request);
  return nextSnapshot;
}

function assertExplicitPluginPromotionSelection(
  snapshot: SkillInventorySnapshot,
  request: ResolveIssueRequest,
): void {
  if (request.entity === 'skill') {
    const skill = snapshot.skills.find((entry) => entry.name === request.skillName);
    if (!skill || !isPluginOnlySkillPromotion(skill)) return;
    assertCurrentManagedSourcePath(skill.managedSourceCandidates, request.selectedVariantPath);
    return;
  }

  if (request.entity === 'mcp') {
    const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
    if (!mcp || request.issue !== 'missing-universal' || !isPluginOnlyMcpPromotion(mcp)) return;
    assertCurrentManagedSourcePath(mcp.managedSourceCandidates, request.selectedVariantPath);
    return;
  }

  const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === request.subagentName);
  if (!subagent || request.issue !== 'missing-universal' || !isPluginOnlySubagentPromotion(subagent)) return;
  assertCurrentManagedSourcePath(subagent.managedSourceCandidates, request.selectedVariantPath);
}

function assertCurrentManagedSourcePath(
  candidates: SkillRecord['managedSourceCandidates'],
  selectedVariantPath: string | undefined,
): void {
  if (!selectedVariantPath || !(candidates ?? []).some((candidate) =>
    candidate.relationship === 'universal-missing' && candidate.path === selectedVariantPath)) {
    throw new Error('Select a current plugin candidate before promoting it to Universal.');
  }
}

function isPluginOnlySkillPromotion(skill: SkillRecord): boolean {
  return (skill.managedSourceCandidates?.some((candidate) => candidate.relationship === 'universal-missing') ?? false)
    && !skill.locations.some((location) =>
      location.fileType === 'real-file' && location.canonicalRole !== 'managed-source');
}

function isPluginOnlyMcpPromotion(mcp: NonNullable<SkillInventorySnapshot['mcps']>[number]): boolean {
  return (mcp.managedSourceCandidates?.some((candidate) => candidate.relationship === 'universal-missing') ?? false)
    && !mcp.locations.some((location) => location.canonicalRole !== 'managed-source');
}

function isPluginOnlySubagentPromotion(subagent: SubagentRecord): boolean {
  return (subagent.managedSourceCandidates?.some((candidate) => candidate.relationship === 'universal-missing') ?? false)
    && !subagent.locations.some((location) =>
      location.fileType === 'real-file' && location.canonicalRole !== 'managed-source');
}

export async function addMcpServer(
  request: AddMcpServerRequest,
  options: ResolveIssueOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPathsForScanOptions(options);
  await ensureSkillIndexLayout(paths);

  const snapshot = await scanInventory({
    ...options,
    paths,
  });
  const definition = buildMcpServerDefinition(request);
  const mutationTargets = await coalesceMcpMutationTargets(getAddMcpServerTargets(snapshot, request.transport));

  if (mutationTargets.length === 0) {
    throw new Error('No writable MCP config targets are available for adding a server.');
  }

  const updates = await Promise.all(
    mutationTargets.map(async (target) => ({
      ...target,
      definitions: await readWritableMcpDefinitions(target),
    })),
  );
  const existingTargets = updates.filter((target) => Object.prototype.hasOwnProperty.call(target.definitions, request.name.trim()));
  if (existingTargets.length > 0) {
    throw new Error(`MCP Server "${request.name.trim()}" already exists in ${existingTargets.length} writable config${existingTargets.length === 1 ? '' : 's'}.`);
  }

  for (const target of updates) {
    target.definitions[request.name.trim()] = definition;
  }
  await writeMcpDefinitionsTransaction(updates, options);

  return scanInventory({
    ...options,
    paths,
  });
}

function assertResolutionIssueIsCurrent(snapshot: SkillInventorySnapshot, request: ResolveIssueRequest): void {
  if (request.entity === 'skill') {
    const skill = snapshot.skills.find((entry) => entry.name === request.skillName);
    if (!skill) {
      throw new Error(`Skill "${request.skillName}" was not found in the current inventory.`);
    }

    if (!(skill.issueReasons ?? []).includes(request.issue) && !canResolveSkillIssueWithoutListedReason(skill, request.issue)) {
      throw new Error(`Skill "${request.skillName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
    }
    return;
  }

  if (request.entity === 'mcp') {
    const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
    if (!mcp) {
      throw new Error(`MCP "${request.mcpName}" was not found in the current inventory.`);
    }

    if (!mcp.issueReasons.includes(request.issue)) {
      throw new Error(`MCP "${request.mcpName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
    }
    return;
  }

  const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === request.subagentName);
  if (!subagent) {
    throw new Error(`Subagent "${request.subagentName}" was not found in the current inventory.`);
  }

  if (!subagent.issueReasons.includes(request.issue)) {
    throw new Error(`Subagent "${request.subagentName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
  }
}

function assertResolutionIssueWasResolved(snapshot: SkillInventorySnapshot, request: ResolveIssueRequest): void {
  if (request.entity === 'skill') {
    const skill = snapshot.skills.find((entry) => entry.name === request.skillName);
    if (skill && (skill.issueReasons ?? []).includes(request.issue)) {
      throw new Error(`Skill "${request.skillName}" still has ${formatIssueLabel(request.issue)} after resolution.`);
    }
    return;
  }

  if (request.entity === 'mcp') {
    const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
    if (mcp && mcp.issueReasons.includes(request.issue) && hasWritableMcpResolutionWorkRemaining(snapshot, request, mcp)) {
      throw new Error(`MCP "${request.mcpName}" still has ${formatIssueLabel(request.issue)} after resolution.`);
    }
    return;
  }

  const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === request.subagentName);
  if (subagent && subagent.issueReasons.includes(request.issue)) {
    throw new Error(`Subagent "${request.subagentName}" still has ${formatIssueLabel(request.issue)} after resolution.`);
  }
}

function hasWritableMcpResolutionWorkRemaining(
  snapshot: SkillInventorySnapshot,
  request: Extract<ResolveIssueRequest, { entity: 'mcp' }>,
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
): boolean {
  switch (request.issue) {
    case 'missing-universal':
      return true;
    case 'missing-from-agents':
      return (mcp.missingLocations ?? []).some((location) =>
        canBuildWritableMcpMutationTarget(snapshot, location.agentId, location.configPath));
    case 'definition-mismatch': {
      const selectedLocation = request.selectedVariantPath
        ? mcp.locations.find((location) => location.configPath === request.selectedVariantPath)
        : null;
      const selectedKey = selectedLocation ? getMcpResolutionComparisonKey(selectedLocation) : null;
      return mcp.locations.some((location) =>
        canBuildWritableMcpMutationTarget(snapshot, location.agentId, location.configPath)
        && (!selectedKey || getMcpResolutionComparisonKey(location) !== selectedKey));
    }
  }
}

function canBuildWritableMcpMutationTarget(
  snapshot: SkillInventorySnapshot,
  agentId: string,
  configPath: string | undefined,
): boolean {
  return buildWritableMcpMutationTarget(snapshot, agentId, configPath) !== null;
}

function getMcpResolutionComparisonKey(location: McpLocationRecord): string {
  return location.definitionComparisonKey
    ?? location.coreDefinitionComparisonKey
    ?? location.definitionText
    ?? `path:${location.configPath}`;
}

function formatIssueLabel(issue: ResolveIssueRequest['issue']): string {
  return issue
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function canResolveSkillIssueWithoutListedReason(skill: SkillRecord, issue: ResolveIssueRequest['issue']): boolean {
  if (issue !== 'missing-symlinks') {
    return false;
  }

  return Boolean(skill.detailDiagnostics.universalDecision)
    && (skill.detailDiagnostics.missingInstallSources?.length ?? 0) > 0;
}

async function resolveSkillIssueIfCurrent(
  snapshot: SkillInventorySnapshot,
  request: Extract<ResolveIssueRequest, { entity: 'skill' }>,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  const skill = snapshot.skills.find((entry) => entry.name === request.skillName);
  if (!skill) {
    throw new Error(`Skill "${request.skillName}" was not found in the current inventory.`);
  }

  if (!(skill.issueReasons ?? []).includes(request.issue) && !canResolveSkillIssueWithoutListedReason(skill, request.issue)) {
    throw new Error(`Skill "${request.skillName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
  }

  assertSkillResolutionScopeAllowed(skill);

  const selectedManagedPluginSource = request.selectedVariantPath
    ? skill.locations.find((location) =>
        location.path === request.selectedVariantPath
        && location.fileType === 'real-file'
        && location.provenance?.kind === 'plugin')
    : undefined;
  const hasUniversalPackage = skill.locations.some((location) =>
    location.canonical && location.fileType === 'real-file');
  if (selectedManagedPluginSource
    && !hasUniversalPackage
    && (request.issue === 'broken-symlink'
      || request.issue === 'wrong-symlink-target'
      || request.issue === 'missing-symlinks')) {
    await makeSkillCanonical({
      skillName: request.skillName,
      selectedSourcePath: selectedManagedPluginSource.path,
    }, { ...options, preparedSnapshot: snapshot });
    return;
  }

  switch (request.issue) {
    case 'missing-canonical':
    case 'diverged-copies': {
      const selectedSourcePath = pickSkillRealFileSelectionPath(skill, request.selectedVariantPath);
      const selectedSourceIsPluginManaged = skill.locations.some((location) =>
        location.path === selectedSourcePath && location.provenance?.kind === 'plugin');
      await makeSkillCanonical(
        {
          skillName: request.skillName,
          selectedSourcePath,
        },
        {
          ...options,
          preparedSnapshot: snapshot,
          // Non-plugin canonicalization keeps the existing two-step behavior.
          // Promoting a managed plugin source is one explicit export operation:
          // create Universal and distribute it to every compatible writable host.
          linkMissingAgentInstalls: selectedSourceIsPluginManaged,
        },
      );
      return;
    }
    case 'identical-copies': {
      const canonicalPath = resolveCanonicalSkillPath(skill, snapshot, request.selectedVariantPath, options.paths);
      const duplicatePaths = skill.locations
        .filter((location) =>
          location.fileType === 'real-file'
          && location.path !== canonicalPath
          && location.provenance?.kind !== 'plugin'
          && location.mutability === 'writable')
        .map((location) => location.path);
      if (duplicatePaths.length === 0) {
        throw new Error(`Skill "${request.skillName}" has no writable copies to convert.`);
      }
      await assertWritableSkillLinkMutationPlan(duplicatePaths, snapshot);
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath, options.paths);
      await completeCanonicalSkillResolution(skill, canonicalPackage, duplicatePaths, snapshot, options);
      return;
    }
    case 'missing-symlinks': {
      const canonicalPath = resolveCanonicalSkillPath(skill, snapshot, request.selectedVariantPath, options.paths);
      const missingPaths = (skill.detailDiagnostics.missingInstallSources ?? [])
        .map((source) => resolveMissingSkillInstallPath(skill.name, source.sourceId, snapshot))
        .filter((locationPath): locationPath is string => Boolean(locationPath))
        .filter((locationPath) => path.normalize(locationPath) !== path.normalize(canonicalPath));
      await assertWritableSkillLinkMutationPlan(missingPaths, snapshot);
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath, options.paths);
      await completeCanonicalSkillResolution(skill, canonicalPackage, missingPaths, snapshot, options);
      return;
    }
    case 'broken-symlink': {
      const canonicalPath = resolveCanonicalSkillPath(skill, snapshot, request.selectedVariantPath, options.paths);
      const repairPaths = (await Promise.all(skill.locations
        .filter((location) =>
          location.fileType === 'symlink'
          && path.normalize(location.path) !== path.normalize(canonicalPath))
        .map(async (location) => ({
          path: location.path,
          broken: location.resolvedPath === undefined,
          targetsPluginCache: location.resolvedPath
            ? await isPluginManagedResolvedTarget(location.resolvedPath, snapshot)
            : false,
        }))))
        .filter((location) => location.broken || location.targetsPluginCache)
        .map((location) => location.path);
      await assertWritableSkillLinkMutationPlan(repairPaths, snapshot);
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath, options.paths);
      await completeCanonicalSkillResolution(skill, canonicalPackage, repairPaths, snapshot, options);
      return;
    }
    case 'wrong-symlink-target': {
      const canonicalPath = resolveCanonicalSkillPath(skill, snapshot, request.selectedVariantPath, options.paths);
      const wrongTargetPaths = skill.locations
        .filter((location) =>
          location.fileType === 'symlink'
          && location.resolvedPath !== undefined
          && path.normalize(location.resolvedPath) !== path.normalize(canonicalPath)
          && path.normalize(location.path) !== path.normalize(canonicalPath))
        .map((location) => location.path);
      await assertWritableSkillLinkMutationPlan(wrongTargetPaths, snapshot);
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath, options.paths);
      await completeCanonicalSkillResolution(skill, canonicalPackage, wrongTargetPaths, snapshot, options);
      return;
    }
  }
}

async function completeCanonicalSkillResolution(
  skill: SkillRecord,
  canonicalPackage: CanonicalSkillPackage,
  locationPaths: string[],
  snapshot: SkillInventorySnapshot,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  let linkTransaction: Awaited<ReturnType<typeof replaceSkillLinksTransaction>> | undefined;
  try {
    linkTransaction = await replaceWritableWithCanonicalSymlinks(locationPaths, canonicalPackage.path, snapshot, options);
    await persistSkillUniversalDecisionForSelection(skill, canonicalPackage.location, options);
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    try { await linkTransaction?.rollback(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
    try { await canonicalPackage.rollback(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
    if (rollbackFailures.length > 0) throw new AggregateError([error, ...rollbackFailures], 'Skill issue resolution failed and rollback was incomplete.');
    throw error;
  }
  await linkTransaction.commit();
  await canonicalPackage.commit();
}

async function assertWritableSkillLinkMutationPlan(
  locationPaths: string[],
  snapshot: SkillInventorySnapshot,
): Promise<void> {
  const uniquePaths = dedupeNormalizedPaths(locationPaths);
  const writableRoots = (snapshot.agents ?? [])
    .flatMap((agent) => agent.writable && agent.skillsLocation.path ? [agent.skillsLocation.path] : []);
  await Promise.all(uniquePaths.map(async (locationPath) => {
    assertSkillSymlinkTargetWritable(locationPath, snapshot);
    await assertSafeWritableSkillLinkMutation(locationPath, snapshot.sources, writableRoots);
  }));
}

async function isPluginManagedResolvedTarget(
  targetPath: string,
  snapshot: SkillInventorySnapshot,
): Promise<boolean> {
  return isPluginManagedTarget(targetPath, snapshot.sources)
    || await isPluginManagedTargetThroughRealpath(targetPath, snapshot.sources);
}

function dedupeNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    const normalizedPath = path.normalize(candidate);
    if (seen.has(normalizedPath)) {
      return false;
    }

    seen.add(normalizedPath);
    return true;
  });
}

function buildMcpServerDefinition(request: AddMcpServerRequest): McpServerDefinition {
  const serverName = request.name.trim();
  if (!serverName) {
    throw new Error('MCP Server name is required.');
  }

  if (request.transport === 'stdio') {
    const command = request.command.trim();
    if (!command) {
      throw new Error('Command is required for stdio MCP Servers.');
    }

    return {
      command,
      ...(request.args && request.args.length > 0 ? { args: request.args } : {}),
      ...(request.env && Object.keys(request.env).length > 0 ? { env: sortStringRecord(request.env) } : {}),
    };
  }

  const url = request.url.trim();
  if (!url) {
    throw new Error('URL is required for remote MCP Servers.');
  }

  return {
    type: request.transport,
    url,
    ...(request.headers && Object.keys(request.headers).length > 0 ? { headers: sortStringRecord(request.headers) } : {}),
  };
}

function sortStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

function getAddMcpServerTargets(
  snapshot: SkillInventorySnapshot,
  transport: McpConfiguredTransportKind,
): McpMutationTarget[] {
  const agents = (snapshot.agents ?? []).filter((agent) => {
    return agent.installState === 'installed'
      && agent.writable
      && agent.mcpConfigLocation.state === 'available'
      && Boolean(agent.mcpConfigLocation.path)
      && isSupportedWritableMcpParser(agent.mcpParserKind ?? 'json-servers')
      && isMcpTransportSupportedByAgent(agent, transport);
  });
  const sources = snapshot.sources.filter((source) => {
    return source.canonical && source.writable;
  });

  return [
    ...sources.map((source) => buildMcpMutationTarget(snapshot, source.id, path.join(path.dirname(source.skillsDir), 'mcp.json'))),
    ...agents.map((agent) => buildMcpMutationTarget(snapshot, agent.id, agent.mcpConfigLocation.path)),
  ];
}

function isMcpTransportSupportedByAgent(
  agent: Pick<AgentRecord, 'mcpSupportedTransports'>,
  transport: McpConfiguredTransportKind,
): boolean {
  return !agent.mcpSupportedTransports || agent.mcpSupportedTransports.includes(transport);
}

async function resolveMcpIssueIfCurrent(
  snapshot: SkillInventorySnapshot,
  request: Extract<ResolveIssueRequest, { entity: 'mcp' }>,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
  if (!mcp) {
    throw new Error(`MCP "${request.mcpName}" was not found in the current inventory.`);
  }

  if (!mcp.issueReasons.includes(request.issue)) {
    throw new Error(`MCP "${request.mcpName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
  }

  assertMcpResolutionScopeAllowed(mcp);

  await applyMcpResolution(snapshot, mcp, request.issue, request.selectedVariantPath, options);
}

export async function updateMcpUniversalFromPluginSource(
  snapshot: SkillInventorySnapshot,
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  selectedVariantPath: string,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  assertMcpResolutionScopeAllowed(mcp);
  const selected = pickMcpSelection(mcp.locations, selectedVariantPath);
  if (selected.canonicalRole !== 'managed-source') {
    throw new Error('Choose a current readable managed plugin source before updating Universal.');
  }
  await applyMcpResolution(snapshot, mcp, 'missing-universal', selectedVariantPath, options);
}

async function applyMcpResolution(
  snapshot: SkillInventorySnapshot,
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  issue: Extract<ResolveIssueRequest, { entity: 'mcp' }>['issue'],
  selectedVariantPath: string | undefined,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {

  const selectedVariant = pickMcpSelection(mcp.locations, selectedVariantPath, {
    preferUniversal: issue === 'missing-from-agents',
  });
  const selectedDefinition = parseSelectedMcpDefinition(selectedVariant);
  const agentLocalDefinitions = collectAgentLocalDefinitionsForMcp(mcp, selectedDefinition);
  const mutationTargets = await coalesceMcpMutationTargets(
    collectMcpResolutionTargets(snapshot, issue, mcp, selectedVariant, options),
  );

  if (mutationTargets.length === 0) {
    throw new Error(`MCP "${mcp.name}" has no writable supported targets for ${issue}.`);
  }

  await assertSafeMcpMutationTargets(mutationTargets, snapshot);
  const updates = await Promise.all(mutationTargets.map(async (target) => ({
    ...target,
    definitions: await readWritableMcpDefinitions(target),
    originalContents: await readMcpConfigContents(target.configPath),
  })));
  const definitionName = getMcpDefinitionNameForWrite(mcp.name, selectedVariant);
  for (const target of updates) {
    if (definitionName !== mcp.name) {
      delete target.definitions[mcp.name];
    }
    target.definitions[definitionName] = buildMcpDefinitionForTarget(
      snapshot,
      target,
      target.definitions[definitionName],
      selectedDefinition,
      agentLocalDefinitions,
    );
  }
  await writeMcpResolutionTransaction(updates, options);
}

function collectMcpResolutionTargets(
  snapshot: SkillInventorySnapshot,
  issue: Extract<ResolveIssueRequest, { entity: 'mcp' }>['issue'],
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  selectedVariant: McpLocationRecord,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): McpMutationTarget[] {
  const targets = issue === 'missing-universal'
    ? [
        ...buildWritableUniversalMcpTargets(snapshot, selectedVariant.scope, options),
        ...(selectedVariant.canonicalRole === 'managed-source'
          ? (mcp.expectedLocations ?? [])
            .filter((location) => location.supportStatus !== 'unsupported')
            .map((location) => buildWritableMcpMutationTarget(snapshot, location.agentId, location.configPath))
            .filter((target): target is McpMutationTarget => target !== null)
          : []),
      ]
    : issue === 'definition-mismatch'
      ? [
          ...mcp.locations
            .map((location) => buildWritableMcpMutationTarget(snapshot, location.agentId, location.configPath))
            .filter((target): target is McpMutationTarget => target !== null),
          ...(mcp.locations.some((location) => isUniversalMcpTarget(snapshot, location.agentId))
            ? []
            : buildWritableUniversalMcpTargets(snapshot, selectedVariant.scope, options)),
        ]
      : (mcp.missingLocations ?? [])
          .map((location) => buildWritableMcpMutationTarget(snapshot, location.agentId, location.configPath))
          .filter((target): target is McpMutationTarget => target !== null);

  return dedupeMcpMutationTargets(targets);
}

function assertMcpResolutionScopeAllowed(mcp: NonNullable<SkillInventorySnapshot['mcps']>[number]): void {
  const scopes = new Set([
    ...mcp.locations.map((location) => location.scope),
    ...(mcp.missingLocations ?? []).map((location) => location.scope),
  ]);
  if (scopes.size > 1) {
    throw new Error('MCP resolution currently requires every affected location to stay within one scope.');
  }
}

function buildWritableUniversalMcpTargets(
  snapshot: SkillInventorySnapshot,
  scope: McpLocationRecord['scope'],
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): McpMutationTarget[] {
  const sourceTargets = snapshot.sources
    .filter((source) => source.canonical && source.writable && source.scope === scope)
    .map((source) => ({
      ...buildMcpMutationTarget(snapshot, source.id, path.join(path.dirname(source.skillsDir), 'mcp.json')),
      universal: true,
    }));
  if (sourceTargets.length > 0) {
    return sourceTargets;
  }

  const fallbackPath = getFallbackUniversalMcpConfigPath(options.paths, scope);
  return fallbackPath
    ? [{
        agentId: `universal:${scope}`,
        configPath: fallbackPath,
        parserKind: 'json-servers',
        universal: true,
        writeDialect: 'json-type-url',
      }]
    : [];
}

function dedupeMcpMutationTargets(targets: McpMutationTarget[]): McpMutationTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.agentId}:${path.normalize(target.configPath)}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function coalesceMcpMutationTargets<T extends McpMutationTarget>(targets: T[]): Promise<T[]> {
  const byPhysicalPath = new Map<string, T>();
  for (const target of targets) {
    const physicalPath = await resolveSafeMcpConfigWritePath(target.configPath);
    const existing = byPhysicalPath.get(physicalPath);
    if (existing) {
      if (existing.parserKind !== target.parserKind || existing.writeDialect !== target.writeDialect) {
        throw new Error('MCP resolution cannot combine aliases with incompatible config dialects.');
      }
      continue;
    }
    byPhysicalPath.set(physicalPath, { ...target, configPath: physicalPath });
  }
  return [...byPhysicalPath.values()];
}

async function assertSafeMcpMutationTargets(
  targets: McpMutationTarget[],
  snapshot: SkillInventorySnapshot,
): Promise<void> {
  const pluginRoots = (snapshot.plugins ?? []).map((plugin) => plugin.rootPath);
  const resolvedPluginRoots = await Promise.all(pluginRoots.map((root) =>
    resolvePathThroughNearestExistingParent(root)));
  await Promise.all(targets.map(async (target) => {
    const lexicalPath = path.normalize(target.configPath);
    if (pluginRoots.some((root) => isPathWithin(root, lexicalPath))) {
      throw new Error('MCP mutations cannot write into a plugin-managed cache path.');
    }
    const resolvedPath = await resolvePathThroughNearestExistingParent(lexicalPath);
    if (pluginRoots.some((root) => isPathWithin(root, resolvedPath))
      || resolvedPluginRoots.some((root) => isPathWithin(root, resolvedPath))) {
      throw new Error('MCP mutations cannot write into a plugin-managed cache path.');
    }
  }));
}

async function readMcpConfigContents(configPath: string): Promise<string | undefined> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) return undefined;
    throw error;
  }
}

export async function writeMcpDefinitionsTransaction(
  updates: Array<McpMutationTarget & { definitions: McpServerDefinitions }>,
  options: Pick<ResolveIssueOptions, 'testFailMcpMutationAt' | 'testFailMcpCommitAt'> = {},
): Promise<void> {
  const targets = await coalesceMcpMutationTargets(updates);
  await writeMcpResolutionTransaction(
    await Promise.all(targets.map(async (target) => ({
      ...target,
      originalContents: await readMcpConfigContents(target.configPath),
    }))),
    options,
  );
}

async function writeMcpResolutionTransaction(
  updates: Array<McpMutationTarget & { definitions: McpServerDefinitions; originalContents: string | undefined }>,
  options: Pick<ResolveIssueOptions, 'testFailMcpMutationAt' | 'testFailMcpCommitAt'>,
): Promise<void> {
  const written: Array<McpMutationTarget & { originalContents: string | undefined }> = [];
  try {
    for (const [index, target] of updates.entries()) {
      if (options.testFailMcpMutationAt === index) {
        throw new Error(`MCP mutation failed at staged target ${index}.`);
      }
      await writeMcpDefinitions(target.configPath, target.parserKind, target.definitions, target.writeDialect, {
        failBeforeCommit: options.testFailMcpCommitAt === index,
      });
      written.push(target);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const target of written.reverse()) {
      try {
        if (target.originalContents === undefined) {
          await rm(target.configPath, { force: true });
        } else {
          await writeMcpConfigAtomically(target.configPath, target.originalContents);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'MCP resolution failed and rollback was incomplete.');
    }
    throw error;
  }
}

function collectAgentLocalDefinitionsForMcp(
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  selectedDefinition: SelectedMcpDefinition,
): Record<string, McpDefinitionObject> {
  const agentLocal: Record<string, McpDefinitionObject> = {};
  const activeAgentLocalKeys = getActiveMcpAgentLocalKeys(mcp, selectedDefinition);

  mergeAgentLocalDefinitions(agentLocal, selectedDefinition.agentLocal, activeAgentLocalKeys);

  for (const location of mcp.locations) {
    mergeAgentLocalDefinitions(agentLocal, location.agentLocal ?? {}, activeAgentLocalKeys);
  }

  for (const location of mcp.locations) {
    if (location.agentLocalKey && isNonEmptyMcpDefinitionObject(location.nativeDefinition)) {
      agentLocal[location.agentLocalKey] = location.nativeDefinition;
    }
  }

  if (selectedDefinition.agentLocalKey && isNonEmptyMcpDefinitionObject(selectedDefinition.native)) {
    agentLocal[selectedDefinition.agentLocalKey] = selectedDefinition.native;
  }

  return agentLocal;
}

function getActiveMcpAgentLocalKeys(
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  selectedDefinition: SelectedMcpDefinition,
): Set<string> {
  const keys = new Set<string>();
  for (const location of mcp.locations) {
    if (location.agentLocalKey) {
      keys.add(location.agentLocalKey);
    }
  }

  if (selectedDefinition.agentLocalKey) {
    keys.add(selectedDefinition.agentLocalKey);
  }

  return keys;
}

function mergeAgentLocalDefinitions(
  target: Record<string, McpDefinitionObject>,
  source: Record<string, McpDefinitionObject>,
  allowedKeys: Set<string>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (allowedKeys.has(key) && isNonEmptyMcpDefinitionObject(value)) {
      target[key] = value;
    }
  }
}

function buildMcpDefinitionForTarget(
  snapshot: SkillInventorySnapshot,
  target: McpMutationTarget,
  existingDefinition: McpDefinitionValue | undefined,
  selectedDefinition: SelectedMcpDefinition,
  agentLocalDefinitions: Record<string, McpDefinitionObject>,
): McpDefinitionObject {
  if (target.universal || isUniversalMcpTarget(snapshot, target.agentId)) {
    return buildUniversalMcpDefinition(selectedDefinition.core, agentLocalDefinitions);
  }

  const family = findMcpTargetFamily(snapshot, target.agentId);
  const existingNative = isMcpDefinitionObject(existingDefinition)
    ? splitMcpDefinitionForComparison(existingDefinition).native
    : {};
  const native = isNonEmptyMcpDefinitionObject(existingNative)
    ? existingNative
    : family
      ? agentLocalDefinitions[family] ?? {}
      : {};

  return {
    ...selectedDefinition.core,
    ...native,
  };
}

function buildUniversalMcpDefinition(
  core: McpDefinitionObject,
  agentLocalDefinitions: Record<string, McpDefinitionObject>,
): McpDefinitionObject {
  const definition: McpDefinitionObject = { ...core };
  if (Object.keys(agentLocalDefinitions).length > 0) {
    definition[MCP_AGENT_LOCAL_KEY] = sortRecordValue(agentLocalDefinitions) as McpDefinitionObject;
  }
  return definition;
}

function isUniversalMcpTarget(snapshot: SkillInventorySnapshot, agentId: string): boolean {
  return snapshot.sources.some((source) => source.id === agentId && source.canonical);
}

function findMcpTargetFamily(snapshot: SkillInventorySnapshot, agentId: string): string | undefined {
  return (snapshot.agents ?? []).find((agent) => agent.id === agentId)?.family;
}

function getFallbackUniversalMcpConfigPath(
  paths: SkillIndexPaths,
  scope: McpLocationRecord['scope'],
): string | null {
  if (scope === 'sandbox') {
    return path.join(paths.sandboxAgentsDir, 'mcp.json');
  }

  if (scope === 'live') {
    return path.join(paths.liveAgentsDir, 'mcp.json');
  }

  return null;
}

function isNonEmptyMcpDefinitionObject(value: McpDefinitionObject | undefined): value is McpDefinitionObject {
  return isMcpDefinitionObject(value) && Object.keys(value).length > 0;
}

async function resolveSubagentIssueIfCurrent(
  snapshot: SkillInventorySnapshot,
  request: Extract<ResolveIssueRequest, { entity: 'subagent' }>,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === request.subagentName);
  if (!subagent) {
    throw new Error(`Subagent "${request.subagentName}" was not found in the current inventory.`);
  }

  if (!subagent.issueReasons.includes(request.issue)) {
    throw new Error(`Subagent "${request.subagentName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
  }

  assertSubagentResolutionScopeAllowed(subagent);
  const scope = getSubagentMutationScope(subagent);

  switch (request.issue) {
    case 'missing-universal': {
      const selectedLocation = pickSubagentSelection(subagent, request.selectedVariantPath, {
        allowInvalid: true,
      });
      if (selectedLocation.canonicalRole === 'managed-source') {
        await promoteManagedSubagentToUniversal(snapshot, subagent, selectedLocation, options);
      } else {
        const canonicalPath = isInvalidSubagentLocation(selectedLocation)
          ? await copySubagentLocationToCanonicalPath(subagent, selectedLocation, snapshot, scope, options.paths)
          : (await ensureCanonicalSubagentPackage(subagent, snapshot, request.selectedVariantPath, options, {
            preferExisting: false,
          })).path;
        const duplicateTargets = collectIdenticalMarkdownSubagentCopyTargets(subagent, snapshot, selectedLocation.definitionComparisonKey);
        await Promise.all(dedupeSubagentTargets(duplicateTargets).map((target) =>
          replaceWithCanonicalSymlink(target.path, canonicalPath, { canonicalPath, scope, snapshot })));
      }
      return;
    }
    case 'missing-from-agents': {
      const canonicalPackage = await ensureCanonicalSubagentPackage(subagent, snapshot, request.selectedVariantPath, options, {
        allowInvalid: true,
        preferExisting: true,
      });
      const targets = collectWritableMissingSubagentTargets(snapshot, subagent.missingLocations ?? []);
      await Promise.all(dedupeSubagentTargets(targets).map((target) =>
        writeSubagentTarget(target, canonicalPackage, canonicalPackage.definition, snapshot, scope)));
      return;
    }
    case 'identical-copies': {
      const canonicalLocation = findCanonicalSubagentLocation(subagent, { allowInvalid: true });
      const canonicalPath = canonicalLocation?.path
        ?? (await ensureCanonicalSubagentPackage(subagent, snapshot, request.selectedVariantPath, options, {
          preferExisting: true,
        })).path;
      const duplicateTargets = collectIdenticalMarkdownSubagentCopyTargets(
        subagent,
        snapshot,
        canonicalLocation?.definitionComparisonKey,
      );
      await Promise.all(dedupeSubagentTargets(duplicateTargets).map((target) =>
        replaceWithCanonicalSymlink(target.path, canonicalPath, { canonicalPath, scope, snapshot })));
      return;
    }
    case 'broken-symlink':
    case 'wrong-symlink-target': {
      const canonicalPackage = await ensureCanonicalSubagentPackage(subagent, snapshot, request.selectedVariantPath, options, {
        allowInvalid: true,
        preferExisting: true,
      });
      const targets = subagent.locations
        .filter((location) =>
          location.fileType === 'symlink'
          && !location.canonical
          && location.mutability === 'writable'
          && (request.issue === 'broken-symlink'
            ? location.resolvedPath === undefined
            : location.resolvedPath !== undefined && path.normalize(location.resolvedPath) !== path.normalize(canonicalPackage.path)))
        .map((location) => locationToSubagentWriteTarget(location, snapshot));
      await Promise.all(dedupeSubagentTargets(targets).map((target) =>
        writeSubagentTarget(target, canonicalPackage, canonicalPackage.definition, snapshot, scope)));
      return;
    }
    case 'definition-mismatch': {
      const selectedLocation = pickSubagentSelection(subagent, request.selectedVariantPath);
      const selectedDefinition = readPortableDefinitionForSubagentLocation(snapshot, subagent.name, selectedLocation);
      const canonicalPath = resolveCanonicalSubagentPath(subagent, selectedLocation, options.paths);
      const canonicalPackage: CanonicalSubagentPackage = {
        path: canonicalPath,
        definition: selectedDefinition,
      };
      const canonicalLocation = findCanonicalSubagentLocation(subagent);
      const targets = [
        ...(!canonicalLocation || canonicalLocation.definitionComparisonKey !== selectedLocation.definitionComparisonKey
          ? [{
              agentId: 'universal-subagents',
              path: canonicalPath,
              format: 'markdown-frontmatter' as const,
            }]
          : []),
        ...subagent.locations
          .filter((location) =>
            !location.canonical
            && location.fileType === 'real-file'
            && isWritableSubagentLocation(location)
            && location.definitionComparisonKey !== selectedLocation.definitionComparisonKey)
          .map((location) => locationToSubagentWriteTarget(location, snapshot)),
      ];
      await Promise.all(dedupeSubagentTargets(targets).map((target) =>
        writeSubagentTarget(target, canonicalPackage, selectedDefinition, snapshot, scope)));
      return;
    }
  }
}

export async function updateSubagentUniversalFromPluginSource(
  snapshot: SkillInventorySnapshot,
  subagent: SubagentRecord,
  selectedVariantPath: string,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  assertSubagentResolutionScopeAllowed(subagent);
  const selectedLocation = pickSubagentSelection(subagent, selectedVariantPath, { allowInvalid: true });
  if (selectedLocation.canonicalRole !== 'managed-source') {
    throw new Error('Choose a current readable managed plugin source before updating Universal.');
  }
  await promoteManagedSubagentToUniversal(snapshot, subagent, selectedLocation, options);
}

async function promoteManagedSubagentToUniversal(
  snapshot: SkillInventorySnapshot,
  subagent: SubagentRecord,
  selectedLocation: SubagentLocationRecord,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): Promise<void> {
  const canonicalPackage = isInvalidSubagentLocation(selectedLocation)
    ? createInvalidCanonicalSubagentPackage(subagent, selectedLocation, options.paths)
    : createCanonicalSubagentPackageForPromotion(subagent, snapshot, selectedLocation, options.paths);
  const targets = collectWritableSubagentTargetsForNewCanonical(
    snapshot,
    subagent,
    canonicalPackage,
    selectedLocation.scope,
  );
  await executeSubagentPromotionTransaction({
    canonicalPackage,
    selectedLocation,
    snapshot,
    subagent,
    targets: isInvalidSubagentLocation(selectedLocation) ? [] : dedupeSubagentTargets(targets),
    options,
    rawCanonicalContent: isInvalidSubagentLocation(selectedLocation)
      ? await readFile(selectedLocation.path, 'utf8')
      : undefined,
  });
}

function assertSubagentResolutionScopeAllowed(subagent: SubagentRecord): void {
  const scopes = new Set([
    ...subagent.locations.map((location) => location.scope),
    ...(subagent.missingLocations ?? []).map((location) => location.scope),
  ]);
  if (scopes.size > 1) {
    throw new Error('Subagent resolution currently requires every affected location to stay within one scope.');
  }
}

function getSubagentMutationScope(subagent: SubagentRecord): SubagentLocationRecord['scope'] {
  return subagent.locations[0]?.scope ?? subagent.missingLocations?.[0]?.scope ?? 'live';
}

async function ensureCanonicalSubagentPackage(
  subagent: SubagentRecord,
  snapshot: SkillInventorySnapshot,
  selectedVariantPath: string | undefined,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
  behavior: {
    allowInvalid?: boolean;
    preferExisting: boolean;
  },
): Promise<CanonicalSubagentPackage> {
  const canonicalLocation = behavior.preferExisting
    ? findCanonicalSubagentLocation(subagent, { allowInvalid: behavior.allowInvalid })
    : null;
  if (canonicalLocation) {
    await assertSafeSubagentMutationDestination(canonicalLocation.path, canonicalLocation.scope, snapshot, canonicalLocation.path);
    const definition = stripSubagentLocalExtras(
      readPortableDefinitionForSubagentLocation(snapshot, subagent.name, canonicalLocation, {
        allowInvalid: behavior.allowInvalid,
      }),
    );
    return {
      allowInvalid: isInvalidSubagentLocation(canonicalLocation),
      path: canonicalLocation.path,
      definition,
    };
  }

  const selectedLocation = pickSubagentSelection(subagent, selectedVariantPath, {
    allowInvalid: behavior.allowInvalid,
  });
  const definition = stripSubagentLocalExtras(
    readPortableDefinitionForSubagentLocation(snapshot, subagent.name, selectedLocation, {
      allowInvalid: behavior.allowInvalid,
    }),
  );
  const canonicalPath = resolveCanonicalSubagentPath(subagent, selectedLocation, options.paths);
  const safety = { canonicalPath, scope: selectedLocation.scope, snapshot };
  await writeSubagentDefinitionFile(canonicalPath, 'markdown-frontmatter', definition, {
    allowInvalid: behavior.allowInvalid && isInvalidSubagentLocation(selectedLocation),
  }, safety);
  return {
    allowInvalid: isInvalidSubagentLocation(selectedLocation),
    path: canonicalPath,
    definition,
  };
}

function createCanonicalSubagentPackageForPromotion(
  subagent: SubagentRecord,
  snapshot: SkillInventorySnapshot,
  selectedLocation: SubagentLocationRecord,
  paths: SkillIndexPaths,
): CanonicalSubagentPackage {
  return {
    path: resolveCanonicalSubagentPath(subagent, selectedLocation, paths),
    definition: stripSubagentLocalExtras(readPortableDefinitionForSubagentLocation(
      snapshot,
      subagent.name,
      selectedLocation,
    )),
  };
}

function createInvalidCanonicalSubagentPackage(
  subagent: SubagentRecord,
  selectedLocation: SubagentLocationRecord,
  paths: SkillIndexPaths,
): CanonicalSubagentPackage {
  return {
    path: resolveCanonicalSubagentPath(subagent, selectedLocation, paths),
    definition: { name: '', description: null, prompt: '', extras: {} },
    allowInvalid: true,
  };
}

async function executeSubagentPromotionTransaction({
  canonicalPackage,
  selectedLocation,
  snapshot,
  subagent,
  targets,
  options,
  rawCanonicalContent,
}: {
  canonicalPackage: CanonicalSubagentPackage;
  selectedLocation: SubagentLocationRecord;
  snapshot: SkillInventorySnapshot;
  subagent: SubagentRecord;
  targets: SubagentWriteTarget[];
  options: ResolveIssueOptions & { paths: SkillIndexPaths };
  rawCanonicalContent?: string;
}): Promise<void> {
  const mutations = buildSubagentPromotionMutations(
    canonicalPackage,
    snapshot,
    targets,
    options,
    rawCanonicalContent,
  );
  await assertSubagentPromotionMutationPlan(mutations, canonicalPackage, selectedLocation, snapshot, subagent);
  await applyStagedSubagentMutations(mutations, options);
}

function buildSubagentPromotionMutations(
  canonicalPackage: CanonicalSubagentPackage,
  snapshot: SkillInventorySnapshot,
  targets: SubagentWriteTarget[],
  options: ResolveIssueOptions,
  rawCanonicalContent?: string,
): StagedSubagentMutation[] {
  const mutations: StagedSubagentMutation[] = [{
    path: canonicalPackage.path,
    rendered: rawCanonicalContent ?? renderPortableSubagentDefinition(canonicalPackage.definition, 'markdown-frontmatter'),
  }];
  for (const [index, target] of targets.entries()) {
    if (options.testFailSubagentRenderAt === index + 1) {
      throw new Error(`Injected subagent render failure at ${index + 1}.`);
    }
    const family = target.family ?? findSubagentLocationFamily(snapshot, target.agentId);
    if (target.format === 'markdown-frontmatter'
      && isMarkdownSubagentSymlinkCompatible(family)
      && !hasSubagentLocalExtras(target)) {
      mutations.push({ path: target.path, symlinkTarget: canonicalPackage.path });
      continue;
    }
    const definition = mergeExistingSubagentTargetExtras(target, stripSubagentLocalExtras(canonicalPackage.definition));
    mutations.push({
      path: target.path,
      rendered: renderPortableSubagentDefinition(definition, target.format, { family }),
    });
  }
  return dedupeSubagentMutations(mutations);
}

function dedupeSubagentMutations(mutations: StagedSubagentMutation[]): StagedSubagentMutation[] {
  const seen = new Set<string>();
  return mutations.filter((mutation) => {
    const key = path.normalize(mutation.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function assertSubagentPromotionMutationPlan(
  mutations: StagedSubagentMutation[],
  canonicalPackage: CanonicalSubagentPackage,
  selectedLocation: SubagentLocationRecord,
  snapshot: SkillInventorySnapshot,
  subagent: SubagentRecord,
): Promise<void> {
  const allowedExistingPaths = new Set(subagent.locations.map((location) => path.normalize(location.path)));
  const resolvedDestinations = new Set<string>();
  for (const mutation of mutations) {
    await assertSafeSubagentMutationDestination(mutation.path, selectedLocation.scope, snapshot, canonicalPackage.path);
    const exists = await lstat(mutation.path).then(() => true).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists && !allowedExistingPaths.has(path.normalize(mutation.path))) {
      throw new Error(`Subagent destination collision: ${mutation.path} belongs to a different subagent.`);
    }
    const resolvedDestination = path.join(
      await resolveSubagentNearestExistingParent(path.dirname(mutation.path)),
      path.basename(mutation.path),
    );
    if (resolvedDestinations.has(path.normalize(resolvedDestination))) {
      throw new Error('Subagent mutation plan contains overlapping destination aliases.');
    }
    resolvedDestinations.add(path.normalize(resolvedDestination));
  }
}

async function assertSafeSubagentMutationDestination(
  destinationPath: string,
  scope: SubagentLocationRecord['scope'],
  snapshot: SkillInventorySnapshot,
  canonicalPath: string,
): Promise<void> {
  const roots = [path.dirname(canonicalPath), ...(snapshot.agents ?? [])
    .filter((agent) => agent.scope === scope && agent.writable && agent.subagentsLocation?.path)
    .map((agent) => agent.subagentsLocation?.path ?? '')]
    .filter((root) => root.length > 0);
  if (!roots.some((root) => isExactSubagentChild(root, destinationPath))) {
    throw new Error('Subagent mutation requires an exact writable Universal or agent subagent destination in the selected scope.');
  }
  const destinationParent = path.dirname(destinationPath);
  const resolvedParent = await resolveSubagentNearestExistingParent(destinationParent);
  const resolvedRoots = await Promise.all(roots.map(resolveSubagentNearestExistingParent));
  if (!resolvedRoots.some((root) => isExactSubagentChild(root, path.join(resolvedParent, path.basename(destinationPath))))) {
    throw new Error('Subagent mutation destination escapes its writable root through a path alias.');
  }
  const pluginRoots = (snapshot.plugins ?? []).map((plugin) => plugin.rootPath);
  const workspaceRoot = path.dirname(path.dirname(path.dirname(canonicalPath)));
  const pluginCacheRoots = [
    path.join(workspaceRoot, '.codex', 'plugins'),
    path.join(workspaceRoot, '.codex', 'plugins', 'cache'),
    path.join(workspaceRoot, '.claude', 'plugins'),
  ];
  const allPluginRoots = [...new Set([...pluginRoots, ...pluginCacheRoots])];
  const resolvedPluginRoots = await Promise.all(allPluginRoots.map(resolveSubagentNearestExistingParent));
  const resolvedCanonicalPath = await resolveSubagentNearestExistingParent(canonicalPath);
  if (allPluginRoots.concat(resolvedPluginRoots).some((root) => isSubagentPathContainedBy(root, destinationPath)
    || isSubagentPathContainedBy(root, resolvedParent)
    || isSubagentPathContainedBy(root, canonicalPath)
    || isSubagentPathContainedBy(root, resolvedCanonicalPath))) {
    throw new Error('Subagent mutations cannot write into a plugin-managed cache path.');
  }
}

function isExactSubagentChild(root: string, target: string): boolean {
  const relative = path.relative(path.normalize(root), path.normalize(target));
  return relative !== '' && !relative.includes(path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function isSubagentPathContainedBy(root: string, target: string): boolean {
  const relative = path.relative(path.normalize(root), path.normalize(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveSubagentNearestExistingParent(targetPath: string): Promise<string> {
  let candidate = path.normalize(targetPath);
  const missing: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(candidate), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return candidate;
    missing.push(path.basename(candidate));
    candidate = parent;
  }
}

async function applyStagedSubagentMutations(
  mutations: StagedSubagentMutation[],
  options: ResolveIssueOptions,
): Promise<void> {
  const staged: Array<StagedSubagentMutation & { stagePath: string; backupPath: string; installed: boolean; backedUp: boolean }> = [];
  try {
    for (const [index, mutation] of mutations.entries()) {
      const parent = path.dirname(mutation.path);
      await mkdir(parent, { recursive: true });
      const stagePath = path.join(parent, `.${path.basename(mutation.path)}.stage-${randomUUID()}`);
      const stagedMutation = { ...mutation, stagePath, backupPath: path.join(parent, `.${path.basename(mutation.path)}.backup-${randomUUID()}`), installed: false, backedUp: false };
      staged.push(stagedMutation);
      if (options.testFailSubagentStageAt === index + 1) {
        throw new Error(`Injected subagent stage failure at ${index + 1}.`);
      }
      if (mutation.symlinkTarget) await symlink(mutation.symlinkTarget, stagePath);
      else await writeFile(stagePath, mutation.rendered ?? '', 'utf8');
      if (options.testFailSubagentStageAfterCreateAt === index + 1) {
        throw new Error(`Injected subagent post-create stage failure at ${index + 1}.`);
      }
    }
  } catch (error) {
    await Promise.all(staged.map((mutation) => rm(mutation.stagePath, { recursive: true, force: true }).catch(() => undefined)));
    throw error;
  }
  try {
    for (const [index, mutation] of staged.entries()) {
      mutation.backedUp = await rename(mutation.path, mutation.backupPath).then(() => true).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (options.testFailSubagentMutationAt === index + 1) {
        throw new Error(`Injected subagent mutation failure at ${index + 1}.`);
      }
      await rename(mutation.stagePath, mutation.path);
      mutation.installed = true;
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const mutation of staged.slice().reverse()) {
      try {
        if (mutation.installed) await rm(mutation.path, { recursive: true, force: true });
        if (mutation.backedUp) await rename(mutation.backupPath, mutation.path);
      } catch (rollbackError) { failures.push(rollbackError); }
    }
    await Promise.all(staged.map((mutation) => rm(mutation.stagePath, { recursive: true, force: true }).catch(() => undefined)));
    if (failures.length > 0) throw new AggregateError([error, ...failures], 'Subagent promotion failed and rollback was incomplete.');
    throw error;
  }
  await Promise.all(staged.map((mutation) => mutation.backedUp
    ? rm(mutation.backupPath, { recursive: true, force: true })
    : Promise.resolve()));
}

function findCanonicalSubagentLocation(
  subagent: SubagentRecord,
  options: { allowInvalid?: boolean } = {},
): SubagentLocationRecord | null {
  return subagent.locations.find((location) =>
    location.canonical
    && location.fileType === 'real-file'
    && (options.allowInvalid || (location.invalidDetails?.length ?? 0) === 0)) ?? null;
}

async function copySubagentLocationToCanonicalPath(
  subagent: SubagentRecord,
  selectedLocation: SubagentLocationRecord,
  snapshot: SkillInventorySnapshot,
  scope: SubagentLocationRecord['scope'],
  paths: SkillIndexPaths,
): Promise<string> {
  const canonicalPath = resolveCanonicalSubagentPath(subagent, selectedLocation, paths);
  if (path.normalize(canonicalPath) === path.normalize(selectedLocation.path)) {
    return canonicalPath;
  }

  await assertSafeSubagentMutationDestination(canonicalPath, scope, snapshot, canonicalPath);
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await rm(canonicalPath, { recursive: true, force: true });
  await cp(selectedLocation.path, canonicalPath);
  return canonicalPath;
}

function isInvalidSubagentLocation(location: SubagentLocationRecord): boolean {
  return (location.invalidDetails?.length ?? 0) > 0;
}

function pickSubagentSelection(
  subagent: SubagentRecord,
  selectedVariantPath: string | undefined,
  options: { allowInvalid?: boolean } = {},
): SubagentLocationRecord {
  const selectableLocations = subagent.locations.filter((location) =>
    location.fileType === 'real-file'
    && (options.allowInvalid || (location.invalidDetails?.length ?? 0) === 0));
  if (selectableLocations.length === 0) {
    throw new Error(`Subagent "${subagent.name}" has no valid definition to use for resolution.`);
  }

  if (selectedVariantPath) {
    const selectedLocation = selectableLocations.find((location) => location.path === selectedVariantPath);
    if (!selectedLocation) {
      throw new Error('The selected subagent definition is no longer available for resolution.');
    }

    return selectedLocation;
  }

  const groups = new Map<string, SubagentLocationRecord[]>();
  for (const location of selectableLocations) {
    const key = location.definitionComparisonKey ?? location.definitionText ?? `path:${location.path}`;
    const existing = groups.get(key) ?? [];
    existing.push(location);
    groups.set(key, existing);
  }

  if (groups.size === 1) {
    return [...groups.values()][0][0];
  }

  return pickPreferredSubagentSelection(selectableLocations);
}

function pickPreferredSubagentSelection(locations: SubagentLocationRecord[]): SubagentLocationRecord {
  const selectedLocation = locations.slice().sort(compareSubagentSelectionLocations)[0];
  if (!selectedLocation) {
    throw new Error('No valid subagent definition is available for resolution.');
  }

  return selectedLocation;
}

function compareSubagentSelectionLocations(left: SubagentLocationRecord, right: SubagentLocationRecord): number {
  if (left.canonical !== right.canonical) {
    return left.canonical ? -1 : 1;
  }

  const leftIsAgentsPath = isAgentsPath(left.path);
  const rightIsAgentsPath = isAgentsPath(right.path);
  if (leftIsAgentsPath !== rightIsAgentsPath) {
    return leftIsAgentsPath ? -1 : 1;
  }

  const modifiedDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return modifiedDifference || left.path.localeCompare(right.path);
}

function readPortableDefinitionForSubagentLocation(
  snapshot: SkillInventorySnapshot,
  fallbackName: string,
  location: SubagentLocationRecord,
  options: { allowInvalid?: boolean } = {},
): PortableSubagentDefinition {
  return readPortableSubagentDefinitionFromFile({
    allowInvalid: options.allowInvalid,
    family: findSubagentLocationFamily(snapshot, location.agentId),
    filePath: location.path,
    format: location.format,
    fallbackName: getSubagentDefinitionFallbackName(fallbackName, location),
  });
}

function getSubagentDefinitionFallbackName(
  fallbackName: string,
  location: Pick<SubagentLocationRecord, 'agentId'>,
): string {
  if (location.agentId.startsWith('plugin:') && fallbackName.includes(':')) {
    return fallbackName.slice(fallbackName.indexOf(':') + 1);
  }

  return fallbackName;
}

function findSubagentLocationFamily(snapshot: SkillInventorySnapshot, agentId: string): string | undefined {
  return (snapshot.agents ?? []).find((agent) => agent.id === agentId)?.family;
}

function resolveCanonicalSubagentPath(
  subagent: SubagentRecord,
  selectedLocation: SubagentLocationRecord,
  paths: SkillIndexPaths,
): string {
  const existingCanonicalLocation = findCanonicalSubagentLocation(subagent);
  if (existingCanonicalLocation) {
    return existingCanonicalLocation.path;
  }

  const canonicalSkillsDir = selectedLocation.scope === 'sandbox'
    ? paths.sandboxCanonicalUserSkillsDir
    : paths.liveCanonicalUserSkillsDir;
  return path.join(
    path.dirname(canonicalSkillsDir),
    'agents',
    getSubagentFileName(subagent.name, 'markdown-frontmatter'),
  );
}

function collectWritableMissingSubagentTargets(
  snapshot: SkillInventorySnapshot,
  locations: SubagentExpectedLocationRecord[],
): SubagentWriteTarget[] {
  return locations
    .filter((location) =>
      location.path
      && location.format
      && location.supportStatus !== 'unsupported'
      && isWritableSubagentAgent(snapshot, location.agentId))
    .map((location) => ({
      agentId: location.agentId,
      family: findSubagentLocationFamily(snapshot, location.agentId),
      format: location.format ?? 'markdown-frontmatter',
      path: location.path ?? '',
    }))
    .filter((target) => target.path.length > 0);
}

function collectWritableSubagentTargetsForNewCanonical(
  snapshot: SkillInventorySnapshot,
  subagent: SubagentRecord,
  canonicalPackage: CanonicalSubagentPackage,
  scope: SubagentLocationRecord['scope'],
): SubagentWriteTarget[] {
  const enabledPluginSources = (subagent.managedSourceCandidates ?? [])
    .filter((candidate) => candidate.plugin.enabled === true)
    .map((candidate) => candidate.plugin);

  return (snapshot.agents ?? [])
    .filter((agent) => {
      const format = agent.subagentParserKind ?? 'unknown';
      return agent.installState === 'installed'
        && agent.writable
        && agent.scope === scope
        && agent.subagentsLocation?.state === 'available'
        && Boolean(agent.subagentsLocation.path)
        && isSubagentFormatRenderableFromUniversal(format, 'markdown-frontmatter')
        && !isAgentSatisfiedByNativePlugin(agent.family, enabledPluginSources);
    })
    .map((agent) => {
      const format = agent.subagentParserKind ?? 'markdown-frontmatter';
      const directoryPath = agent.subagentsLocation?.path ?? '';
      const existingLocation = subagent.locations.find((location) =>
        location.agentId === agent.id && location.canonicalRole !== 'managed-source');
      return {
        agentId: agent.id,
        family: agent.family,
        format,
        localExtrasKeys: existingLocation?.localExtrasKeys,
        path: existingLocation?.path ?? path.join(directoryPath, getSubagentFileNameForFormat({
          name: subagent.name,
          format,
          family: agent.family,
          canonicalPath: canonicalPackage.path,
        })),
      };
    })
    .filter((target) => target.path.length > 0);
}

function isWritableSubagentAgent(snapshot: SkillInventorySnapshot, agentId: string): boolean {
  const agent = (snapshot.agents ?? []).find((entry) => entry.id === agentId);
  return Boolean(agent?.writable && agent.subagentsLocation?.state === 'available' && agent.subagentsLocation.path);
}

function isWritableSubagentLocation(location: SubagentLocationRecord): boolean {
  return !location.agentId.startsWith('plugin:')
    && (location.canonical || location.mutability === 'writable')
    && (location.invalidDetails?.length ?? 0) === 0;
}

function locationToSubagentWriteTarget(
  location: SubagentLocationRecord,
  snapshot: SkillInventorySnapshot,
): SubagentWriteTarget {
  return {
    agentId: location.agentId,
    family: findSubagentLocationFamily(snapshot, location.agentId),
    format: location.format,
    localExtrasKeys: location.localExtrasKeys,
    path: location.path,
  };
}

function collectIdenticalMarkdownSubagentCopyTargets(
  subagent: SubagentRecord,
  snapshot: SkillInventorySnapshot,
  definitionComparisonKey: string | undefined,
): SubagentWriteTarget[] {
  if (!definitionComparisonKey) {
    return [];
  }

  return subagent.locations
    .filter((location) => {
      const family = findSubagentLocationFamily(snapshot, location.agentId);
      return location.fileType === 'real-file'
        && !location.canonical
        && location.mutability === 'writable'
        && location.format === 'markdown-frontmatter'
        && isMarkdownSubagentSymlinkCompatible(family)
        && !hasSubagentLocalExtras(location)
        && location.definitionComparisonKey === definitionComparisonKey;
    })
    .map((location) => locationToSubagentWriteTarget(location, snapshot));
}

function dedupeSubagentTargets(targets: SubagentWriteTarget[]): SubagentWriteTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = path.normalize(target.path);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function writeSubagentTarget(
  target: SubagentWriteTarget,
  canonicalPackage: CanonicalSubagentPackage,
  definition: PortableSubagentDefinition,
  snapshot: SkillInventorySnapshot,
  scope: SubagentLocationRecord['scope'],
): Promise<void> {
  const safety = { canonicalPath: canonicalPackage.path, scope, snapshot };
  if (path.normalize(target.path) === path.normalize(canonicalPackage.path)) {
    await writeSubagentDefinitionFile(target.path, 'markdown-frontmatter', stripSubagentLocalExtras(definition), {
      allowInvalid: canonicalPackage.allowInvalid,
    }, safety);
    return;
  }

  const family = target.family ?? findSubagentLocationFamily(snapshot, target.agentId);
  if (
    target.format === 'markdown-frontmatter'
    && isMarkdownSubagentSymlinkCompatible(family)
    && !hasSubagentLocalExtras(target)
  ) {
    await replaceWithCanonicalSymlink(target.path, canonicalPackage.path, safety);
    return;
  }

  await writeSubagentDefinitionFile(
    target.path,
    target.format,
    mergeExistingSubagentTargetExtras(target, stripSubagentLocalExtras(definition)),
    { allowInvalid: canonicalPackage.allowInvalid, family },
    safety,
  );
}

async function writeSubagentDefinitionFile(
  filePath: string,
  format: AgentSubagentParserKind,
  definition: PortableSubagentDefinition,
  options: { allowInvalid?: boolean; family?: string } = {},
  safety: SubagentMutationSafetyContext,
): Promise<void> {
  await assertSafeSubagentMutationDestination(filePath, safety.scope, safety.snapshot, safety.canonicalPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await rm(filePath, { recursive: true, force: true });
  await writeFile(filePath, renderPortableSubagentDefinition(definition, format, options), 'utf8');
}

function stripSubagentLocalExtras(definition: PortableSubagentDefinition): PortableSubagentDefinition {
  return {
    ...definition,
    extras: {},
  };
}

function mergeExistingSubagentTargetExtras(
  target: SubagentWriteTarget,
  definition: PortableSubagentDefinition,
): PortableSubagentDefinition {
  try {
    const existing = readPortableSubagentDefinitionFromFile({
      family: target.family,
      filePath: target.path,
      format: target.format,
      fallbackName: definition.name,
    });
    return {
      ...definition,
      extras: existing.extras,
    };
  } catch {
    return definition;
  }
}

function getSubagentFileName(name: string, format: AgentSubagentParserKind): string {
  return getSubagentFileNameForFormat({ name, format });
}

function hasSubagentLocalExtras(location: Pick<SubagentLocationRecord | SubagentWriteTarget, 'localExtrasKeys'>): boolean {
  return (location.localExtrasKeys?.length ?? 0) > 0;
}

function getMcpDefinitionNameForWrite(requestedMcpName: string, selectedVariant: McpLocationRecord): string {
  if (selectedVariant.configName) {
    return selectedVariant.configName;
  }

  if (selectedVariant.agentId.startsWith('plugin:') && requestedMcpName.includes(':')) {
    return requestedMcpName.slice(requestedMcpName.indexOf(':') + 1);
  }

  return requestedMcpName;
}

function assertSkillResolutionScopeAllowed(skill: SkillRecord): void {
  const scopes = new Set(skill.locations.map((location) => location.sourceScope));
  if (scopes.size > 1) {
    throw new Error('Skill resolution currently requires every affected location to stay within one scope.');
  }
}

async function ensureCanonicalSkillPackage(
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
  selectedVariantPath: string | undefined,
  paths: SkillIndexPaths,
): Promise<CanonicalSkillPackage> {
  assertSafeSkillPackageName(skill.name);
  const canonicalPath = resolveCanonicalSkillPath(skill, snapshot, selectedVariantPath, paths);
  const selectedSourcePath = pickSkillRealFileSelectionPath(skill, selectedVariantPath);
  const selectedLocation = skill.locations.find((location) => location.path === selectedSourcePath && location.fileType === 'real-file');
  if (!selectedLocation) {
    throw new Error('The selected skill version must be a real file before repairing links.');
  }
  const canonicalRoot = snapshot.sources.find((source) =>
    source.scope === selectedLocation.sourceScope
    && path.normalize(source.skillsDir) === path.normalize(path.dirname(canonicalPath))
    && source.writable
    && source.kind !== 'plugin')?.skillsDir
    ?? (selectedLocation.sourceScope === 'sandbox' ? paths.sandboxCanonicalUserSkillsDir : paths.liveCanonicalUserSkillsDir);
  if (path.normalize(selectedLocation.path) !== path.normalize(canonicalPath)) {
    await assertSkillSourceAndDestinationDoNotOverlap(selectedLocation.path, canonicalPath);
  }
  await assertSafeUniversalSkillMutation({
    destinationPath: canonicalPath,
    universalRoot: canonicalRoot,
    skillName: skill.name,
    scope: selectedLocation.sourceScope,
    sources: snapshot.sources,
    allowDefaultUniversalRoot: selectedLocation.provenance?.kind === 'plugin',
  });
  const canonicalRealFile = skill.locations.find((location) =>
    location.path === canonicalPath && location.fileType === 'real-file');
  if (canonicalRealFile) {
    return {
      path: canonicalPath,
      location: canonicalRealFile,
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
  }

  await assertSafeUniversalSkillMutation({
    destinationPath: canonicalPath,
    universalRoot: canonicalRoot,
    skillName: skill.name,
    scope: selectedLocation.sourceScope,
    sources: snapshot.sources,
    allowDefaultUniversalRoot: selectedLocation.provenance?.kind === 'plugin',
  });
  const parentPath = path.dirname(canonicalPath);
  const stagePath = path.join(parentPath, `.${path.basename(canonicalPath)}.stage-${randomUUID()}`);
  const backupPath = path.join(parentPath, `.${path.basename(canonicalPath)}.backup-${randomUUID()}`);
  const selectedSourceIsPluginManaged = selectedLocation.provenance?.kind === 'plugin';
  if (selectedSourceIsPluginManaged) {
    await assertPluginManagedSkillPackageSymlinksContained(selectedLocation.path);
  }
  await mkdir(parentPath, { recursive: true });
  try {
    await cp(selectedLocation.path, stagePath, {
      recursive: true,
      dereference: !selectedSourceIsPluginManaged,
      force: true,
      verbatimSymlinks: selectedSourceIsPluginManaged,
    });
    if (selectedSourceIsPluginManaged) {
      await assertPluginManagedSkillPackageSymlinksContained(stagePath);
    }
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
  } catch (error) {
    await rm(stagePath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    path: canonicalPath,
    location: createCanonicalSkillLocation(selectedLocation, canonicalPath, snapshot, paths),
    commit: async () => {
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
    },
    rollback: async () => {
      await rm(canonicalPath, { recursive: true, force: true });
      await rename(backupPath, canonicalPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
  };
}

function createCanonicalSkillLocation(
  selectedLocation: SkillLocationRecord,
  canonicalPath: string,
  snapshot: SkillInventorySnapshot,
  paths: SkillIndexPaths,
): SkillLocationRecord {
  const source = snapshot.sources.find((candidate) =>
    path.normalize(candidate.skillsDir) === path.normalize(path.dirname(canonicalPath))
    && candidate.writable
    && candidate.kind !== 'plugin');
  const fallbackSource = selectedLocation.sourceScope === 'sandbox' || selectedLocation.sourceScope === 'live'
    ? {
      id: `${selectedLocation.sourceScope}-agents`,
      label: `${selectedLocation.sourceScope === 'sandbox' ? 'Sandbox' : 'Live'} .agents`,
      scope: selectedLocation.sourceScope,
      skillsDir: selectedLocation.sourceScope === 'sandbox'
        ? paths.sandboxCanonicalUserSkillsDir
        : paths.liveCanonicalUserSkillsDir,
    }
    : null;
  const universalSource = source ?? fallbackSource;
  if (!universalSource || path.normalize(universalSource.skillsDir) !== path.normalize(path.dirname(canonicalPath))) {
    throw new Error(`Unable to locate a writable Universal skills directory for "${canonicalPath}".`);
  }

  return {
    ...selectedLocation,
    path: canonicalPath,
    entrypointPath: selectedLocation.installKind === 'directory'
      ? path.join(canonicalPath, 'SKILL.md')
      : canonicalPath,
    sourceId: universalSource.id,
    sourceLabel: universalSource.label,
    sourceScope: universalSource.scope,
    fileType: 'real-file',
    canonical: true,
    canonicalRole: 'canonical',
    mutability: 'writable',
    provenance: undefined,
    resolvedPath: canonicalPath,
    symlinkTarget: undefined,
  };
}

function pickSkillRealFileSelectionPath(
  skill: SkillRecord,
  selectedVariantPath: string | undefined,
): string {
  const realFileLocations = skill.locations.filter((location) => location.fileType === 'real-file');
  if (realFileLocations.length === 0) {
    throw new Error(`Skill "${skill.name}" has no readable real-file definitions to use for resolution.`);
  }

  if (selectedVariantPath) {
    const selectedLocation = realFileLocations.find((location) => location.path === selectedVariantPath);
    if (!selectedLocation) {
      throw new Error('The selected skill version is no longer available for resolution.');
    }

    return selectedLocation.path;
  }

  const groups = groupSkillRealFiles(realFileLocations);
  if (groups.length === 1) {
    return groups[0][0].path;
  }

  return pickPreferredSkillRealFileSelection(realFileLocations).path;
}

function pickPreferredSkillRealFileSelection(locations: SkillLocationRecord[]): SkillLocationRecord {
  const selectedLocation = locations.slice().sort(compareSkillSelectionLocations)[0];
  if (!selectedLocation) {
    throw new Error('No valid skill version is available for resolution.');
  }

  return selectedLocation;
}

function compareSkillSelectionLocations(left: SkillLocationRecord, right: SkillLocationRecord): number {
  if (left.canonical !== right.canonical) {
    return left.canonical ? -1 : 1;
  }

  const leftIsAgentsPath = isAgentsPath(left.path);
  const rightIsAgentsPath = isAgentsPath(right.path);
  if (leftIsAgentsPath !== rightIsAgentsPath) {
    return leftIsAgentsPath ? -1 : 1;
  }

  const modifiedDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return modifiedDifference || left.path.localeCompare(right.path);
}

function groupSkillRealFiles(locations: SkillLocationRecord[]): SkillLocationRecord[][] {
  const groups = new Map<string, SkillLocationRecord[]>();

  for (const location of locations) {
    const key = location.contentHash
      ? `hash:${location.contentHash}`
      : location.definitionText
        ? `text:${location.definitionText}`
        : `path:${location.path}`;
    const existing = groups.get(key) ?? [];
    existing.push(location);
    groups.set(key, existing);
  }

  return [...groups.values()];
}

function resolveMissingSkillInstallPath(
  skillName: string,
  sourceId: string,
  snapshot: SkillInventorySnapshot,
): string | null {
  const source = snapshot.sources.find((entry) => entry.id === sourceId);
  if (source) {
    if (!source.writable) {
      throw new Error('Skill resolution can only create symlinks in writable locations.');
    }

    return path.join(source.skillsDir, skillName);
  }

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === sourceId);
  if (!agent || agent.installState !== 'installed' || agent.skillsLocation.state !== 'available' || !agent.skillsLocation.path) {
    return null;
  }

  if (!agent.writable) {
    throw new Error('Skill resolution can only create symlinks in writable locations.');
  }

  return path.join(agent.skillsLocation.path, skillName);
}

function pickMcpSelection(
  locations: McpLocationRecord[],
  selectedVariantPath: string | undefined,
  options: { preferUniversal?: boolean } = {},
): McpLocationRecord {
  if (locations.length === 0) {
    throw new Error('No MCP definition is available for resolution.');
  }

  if (options.preferUniversal) {
    const universalLocation = locations.find(isUniversalMcpSelectionLocation);
    if (universalLocation) {
      return universalLocation;
    }
  }

  if (selectedVariantPath) {
    const selectedLocation = locations.find((location) => location.configPath === selectedVariantPath);
    if (!selectedLocation) {
      throw new Error('The selected MCP definition is no longer available for resolution.');
    }

    return selectedLocation;
  }

  const groups = new Map<string, McpLocationRecord[]>();
  for (const location of locations) {
    const key = location.definitionComparisonKey ?? location.definitionText ?? `path:${location.configPath}`;
    const existing = groups.get(key) ?? [];
    existing.push(location);
    groups.set(key, existing);
  }

  if (groups.size === 1) {
    return [...groups.values()][0][0];
  }

  return pickPreferredMcpSelection(locations);
}

function pickPreferredMcpSelection(locations: McpLocationRecord[]): McpLocationRecord {
  const selectedLocation = locations.slice().sort(compareMcpSelectionLocations)[0];
  if (!selectedLocation) {
    throw new Error('No MCP definition is available for resolution.');
  }

  return selectedLocation;
}

function compareMcpSelectionLocations(left: McpLocationRecord, right: McpLocationRecord): number {
  const leftIsUniversal = isUniversalMcpSelectionLocation(left);
  const rightIsUniversal = isUniversalMcpSelectionLocation(right);
  if (leftIsUniversal !== rightIsUniversal) {
    return leftIsUniversal ? -1 : 1;
  }

  return left.configPath.localeCompare(right.configPath);
}

function isUniversalMcpSelectionLocation(location: McpLocationRecord): boolean {
  return location.provenance?.kind === 'universal'
    || isAgentsMcpConfigPath(location.configPath);
}

function isAgentsPath(value: string | undefined | null): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return value.replace(/\\/g, '/').includes('/.agents/');
}

function isAgentsMcpConfigPath(value: string): boolean {
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) === 'mcp.json' && parts.at(-2) === '.agents';
}

function parseSelectedMcpDefinition(location: McpLocationRecord): SelectedMcpDefinition {
  if (location.portableDefinition) {
    return {
      agentLocal: location.agentLocal ?? {},
      agentLocalKey: location.agentLocalKey,
      core: buildPortableMcpDefinition(location.portableDefinition, location),
      native: location.nativeDefinition ?? {},
    };
  }

  if (!location.definitionText) {
    const fallbackDefinition = {
      ...(location.command ? { command: location.command } : {}),
      ...(location.args.length > 0 ? { args: location.args } : {}),
    };
    const splitDefinition = splitMcpDefinitionForComparison(fallbackDefinition, location);
    return {
      agentLocal: splitDefinition.agentLocal,
      agentLocalKey: location.agentLocalKey,
      core: buildPortableMcpDefinition(fallbackDefinition, location),
      native: splitDefinition.native,
    };
  }

  const parsed = JSON.parse(location.definitionText) as unknown;
  if (!isMcpDefinitionObject(parsed)) {
    throw new Error('The selected MCP definition must use a supported object structure.');
  }

  const splitDefinition = splitMcpDefinitionForComparison(parsed, location);
  return {
    agentLocal: splitDefinition.agentLocal,
    agentLocalKey: location.agentLocalKey,
    core: buildPortableMcpDefinition(parsed, location),
    native: splitDefinition.native,
  };
}

function buildMcpMutationTarget(
  snapshot: SkillInventorySnapshot,
  agentId: string,
  configPath: string | undefined,
): McpMutationTarget {
  if (!configPath) {
    throw new Error('MCP resolution requires a writable config path for every target agent.');
  }

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === agentId);
  if (agent?.mcpConfigLocation.state === 'available' && agent.mcpConfigLocation.path === configPath) {
    const parserKind = agent.mcpParserKind ?? 'json-servers';
    if (!isSupportedWritableMcpParser(parserKind)) {
      throw new Error(`MCP resolution is not supported yet for ${agent.label}.`);
    }

    if (!agent.writable) {
      throw new Error('MCP resolution can only mutate writable configs.');
    }

    return {
      agentId,
      configPath,
      parserKind,
      writeDialect: agent.mcpWriteDialect ?? getDefaultMcpWriteDialect(parserKind),
    };
  }

  const source = snapshot.sources.find((entry) => entry.id === agentId);
  if (source) {
    if (!source.writable) {
      throw new Error('MCP resolution can only mutate writable configs.');
    }

    return {
      agentId,
      configPath,
      parserKind: 'json-servers',
      writeDialect: 'json-type-url',
    };
  }

  throw new Error(`Missing writable MCP config metadata for ${agentId}.`);
}

function buildWritableMcpMutationTarget(
  snapshot: SkillInventorySnapshot,
  agentId: string,
  configPath: string | undefined,
): McpMutationTarget | null {
  if (agentId.startsWith('plugin:')) {
    return null;
  }

  if (!configPath) {
    return null;
  }

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === agentId);
  if (agent) {
    if (!agent.writable || agent.mcpConfigLocation.state !== 'available' || agent.mcpConfigLocation.path !== configPath) {
      return null;
    }

    if (!isSupportedWritableMcpParser(agent.mcpParserKind ?? 'json-servers')) {
      return null;
    }
  }

  const source = snapshot.sources.find((entry) => entry.id === agentId);
  if (source && !source.writable) {
    return null;
  }

  if (!agent && !source) {
    return null;
  }

  return buildMcpMutationTarget(snapshot, agentId, configPath);
}

export async function readWritableMcpDefinitions(target: McpMutationTarget): Promise<McpServerDefinitions> {
  let raw: string;
  try {
    raw = await readFile(target.configPath, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw error;
  }

  const definitions = parseMcpDefinitions(raw, target.parserKind);
  if (!definitions) {
    throw new Error(`Unsupported MCP config structure in ${target.configPath}.`);
  }

  return definitions;
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

export async function writeMcpDefinitions(
  configPath: string,
  parserKind: McpMutationTarget['parserKind'],
  definitions: McpServerDefinitions,
  writeDialect: AgentMcpWriteDialect,
  writeOptions: { failBeforeCommit?: boolean } = {},
): Promise<void> {
  configPath = await resolveSafeMcpConfigWritePath(configPath);
  if (parserKind === 'toml') {
    let raw = '';
    try {
      raw = await readFile(configPath, 'utf8');
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }

    const tomlDefinitions = mapRecordValue(definitions, (definition) => toTomlMcpDefinition(definition, writeDialect === 'toml-transport-array' ? 'transport-array' : 'codex'));
    await writeMcpConfigAtomically(configPath, updateTomlMcpServers(raw, tomlDefinitions), writeOptions);
    return;
  }

  if (parserKind === 'toml-mcpServers-array') {
    let raw = '';
    try {
      raw = await readFile(configPath, 'utf8');
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }

    const tomlDefinitions = mapRecordValue(definitions, (definition) => toTomlMcpDefinition(definition, writeDialect === 'toml-codex' ? 'codex' : 'transport-array'));
    const sortedDefinitions = sortRecordValue(tomlDefinitions);
    await writeMcpConfigAtomically(
      configPath,
      updateTomlMcpServerArray(raw, isMcpServerDefinitions(sortedDefinitions) ? sortedDefinitions : tomlDefinitions),
      writeOptions,
    );
    return;
  }

  if (writeDialect === 'json-opencode' || parserKind === 'jsonc-opencode-mcp') {
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = JSON.parse(sanitizeJsonc(await readFile(configPath, 'utf8'))) as Record<string, unknown>;
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }

    const preservedConfig = { ...parsedConfig };
    delete preservedConfig.mcp;
    delete preservedConfig.mcpServers;
    await writeMcpConfigAtomically(
      configPath,
      `${JSON.stringify({
        ...preservedConfig,
        mcp: sortRecordValue(mapRecordValue(definitions, (definition) => mapMcpDefinitionForWriteDialect(definition, 'json-opencode'))),
      }, null, 2)}\n`,
      writeOptions,
    );
    return;
  }

  if (parserKind === 'jsonc-dotted-amp-mcpServers' || parserKind === 'jsonc-dotted-zencoder-mcpServers') {
    await writeJsoncMcpDefinitions(configPath, mapMcpDefinitionsForWriteDialect(definitions, writeDialect), {
      field: parserKind === 'jsonc-dotted-amp-mcpServers' ? 'amp.mcpServers' : 'zencoder.mcpServers',
    }, writeOptions);
    return;
  }

  if (parserKind === 'jsonc-mcp-servers') {
    await writeJsoncMcpDefinitions(configPath, mapMcpDefinitionsForWriteDialect(definitions, writeDialect), {
      fieldPath: ['mcp', 'servers'],
    }, writeOptions);
    return;
  }

  const jsonTarget = getJsonMcpDefinitionTarget(parserKind);
  await writeJsonMcpDefinitions(configPath, mapMcpDefinitionsForWriteDialect(definitions, writeDialect), {
    field: jsonTarget.field,
    jsonc: isJsoncMcpParserKind(parserKind),
    removeFields: jsonTarget.removeFields,
  }, writeOptions);
}

function parseMcpDefinitions(
  raw: string,
  parserKind: McpMutationTarget['parserKind'],
): McpServerDefinitions | null {
  if (parserKind === 'toml') {
    return parseTomlMcpServers(raw);
  }
  if (parserKind === 'toml-mcpServers-array') {
    return parseTomlMcpServerArray(raw);
  }

  const normalizedRaw = isJsoncMcpParserKind(parserKind)
    ? sanitizeJsonc(raw)
    : raw;
  const parsed = JSON.parse(normalizedRaw) as unknown;
  if (!isMcpDefinitionObject(parsed)) {
    return null;
  }

  switch (parserKind) {
    case 'json-servers':
      return extractMcpDefinitions(parsed, ['servers', 'mcpServers', 'mcp']);
    case 'json-mcpServers':
    case 'jsonc-mcpServers':
      return extractMcpDefinitions(parsed, ['mcpServers', 'servers', 'mcp']);
    case 'json-mcp':
    case 'jsonc-mcp':
    case 'jsonc-opencode-mcp':
      return extractMcpDefinitions(parsed, ['mcp', 'mcpServers', 'servers']);
    case 'jsonc-dotted-amp-mcpServers':
      return extractMcpDefinitions(parsed, ['amp.mcpServers']);
    case 'jsonc-dotted-zencoder-mcpServers':
      return extractMcpDefinitions(parsed, ['zencoder.mcpServers']);
    case 'jsonc-mcp-servers':
      return extractNestedMcpDefinitions(parsed, ['mcp', 'servers']);
  }
}

function isJsoncMcpParserKind(parserKind: McpMutationTarget['parserKind']): boolean {
  return parserKind === 'jsonc-mcpServers'
    || parserKind === 'jsonc-mcp'
    || parserKind === 'jsonc-dotted-amp-mcpServers'
    || parserKind === 'jsonc-dotted-zencoder-mcpServers'
    || parserKind === 'jsonc-mcp-servers'
    || parserKind === 'jsonc-opencode-mcp';
}

async function writeJsoncMcpDefinitions(
  configPath: string,
  definitions: Record<string, unknown>,
  target: { field?: string; fieldPath?: string[] },
  writeOptions: { failBeforeCommit?: boolean },
): Promise<void> {
  const parsedConfig = await readJsonConfigObject(configPath, { jsonc: true });

  if (target.field) {
    parsedConfig[target.field] = sortRecordValue(definitions);
  } else if (target.fieldPath) {
    setNestedRecordValue(parsedConfig, target.fieldPath, sortRecordValue(definitions));
  }

  await writeMcpConfigAtomically(configPath, `${JSON.stringify(parsedConfig, null, 2)}\n`, writeOptions);
}

async function writeJsonMcpDefinitions(
  configPath: string,
  definitions: McpServerDefinitions,
  target: { field: 'servers' | 'mcpServers' | 'mcp'; jsonc: boolean; removeFields: Array<'servers' | 'mcpServers' | 'mcp'> },
  writeOptions: { failBeforeCommit?: boolean },
): Promise<void> {
  const parsedConfig = await readJsonConfigObject(configPath, { jsonc: target.jsonc });
  for (const field of target.removeFields) {
    delete parsedConfig[field];
  }
  parsedConfig[target.field] = sortRecordValue(definitions);

  await writeMcpConfigAtomically(configPath, `${JSON.stringify(parsedConfig, null, 2)}\n`, writeOptions);
}

async function writeMcpConfigAtomically(
  configPath: string,
  contents: string,
  options: { failBeforeCommit?: boolean } = {},
): Promise<void> {
  configPath = await resolveSafeMcpConfigWritePath(configPath);
  await mkdir(path.dirname(configPath), { recursive: true });
  const stagedPath = `${configPath}.skillindex-${randomUUID()}.tmp`;
  try {
    await writeFile(stagedPath, contents, 'utf8');
    try {
      const existing = await stat(configPath);
      await chmodMcpConfig(stagedPath, existing.mode & 0o777);
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
    }
    if (options.failBeforeCommit) {
      throw new Error('MCP config commit failed before atomic rename.');
    }
    await rename(stagedPath, configPath);
  } finally {
    await rm(stagedPath, { force: true });
  }
}

async function chmodMcpConfig(configPath: string, mode: number): Promise<void> {
  const { chmod } = await import('node:fs/promises');
  await chmod(configPath, mode);
}

export async function resolveSafeMcpConfigWritePath(configPath: string): Promise<string> {
  const lexicalPath = path.normalize(configPath);
  if (isConventionalPluginCachePath(lexicalPath)) {
    throw new Error('MCP mutations cannot write into a plugin-managed cache path.');
  }
  const physicalPath = await resolvePathThroughNearestExistingParent(lexicalPath);
  if (isConventionalPluginCachePath(physicalPath)) {
    throw new Error('MCP mutations cannot write into a plugin-managed cache path.');
  }
  try {
    if ((await stat(physicalPath)).nlink > 1) {
      throw new Error('MCP mutations cannot replace a hard-linked config file.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('hard-linked config')) throw error;
    if (!isFileNotFoundError(error)) throw error;
  }
  return physicalPath;
}

function isConventionalPluginCachePath(targetPath: string): boolean {
  const segments = path.normalize(targetPath).split(path.sep).map((segment) => segment.toLowerCase());
  return segments.some((segment, index) =>
    (segment === '.codex' || segment === '.claude') && segments[index + 1] === 'plugins');
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(path.normalize(rootPath), path.normalize(targetPath));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolvePathThroughNearestExistingParent(targetPath: string): Promise<string> {
  const normalizedTarget = path.normalize(targetPath);
  let candidate = normalizedTarget;
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(candidate), ...missingSegments.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Unable to verify filesystem safety for ${normalizedTarget}.`);
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return normalizedTarget;
    missingSegments.push(path.basename(candidate));
    candidate = parent;
  }
}

function getJsonMcpDefinitionTarget(
  parserKind: McpMutationTarget['parserKind'],
): { field: 'servers' | 'mcpServers' | 'mcp'; removeFields: Array<'servers' | 'mcpServers' | 'mcp'> } {
  if (parserKind === 'json-mcpServers' || parserKind === 'jsonc-mcpServers') {
    return { field: 'mcpServers', removeFields: ['servers', 'mcp'] };
  }

  if (parserKind === 'json-mcp' || parserKind === 'jsonc-mcp') {
    return { field: 'mcp', removeFields: ['servers', 'mcpServers'] };
  }

  return { field: 'servers', removeFields: ['mcpServers', 'mcp'] };
}

async function readJsonConfigObject(configPath: string, options: { jsonc: boolean }): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {};
    }

    throw error;
  }

  const parsed = JSON.parse(options.jsonc ? sanitizeJsonc(raw) : raw) as unknown;
  if (!isMcpDefinitionObject(parsed)) {
    throw new Error(`Unsupported MCP config structure in ${configPath}.`);
  }

  return { ...parsed };
}

function setNestedRecordValue(target: Record<string, unknown>, pathSegments: string[], value: unknown): void {
  let current = target;

  for (const [index, segment] of pathSegments.entries()) {
    if (index === pathSegments.length - 1) {
      current[segment] = value;
      return;
    }

    const existing = current[segment];
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
}

async function replaceWithCanonicalSymlink(
  locationPath: string,
  canonicalPath: string,
  safety: SubagentMutationSafetyContext,
): Promise<void> {
  await assertSafeSubagentMutationDestination(locationPath, safety.scope, safety.snapshot, canonicalPath);
  await mkdir(path.dirname(locationPath), { recursive: true });
  await rm(locationPath, { recursive: true, force: true });
  await symlink(canonicalPath, locationPath);
}

async function replaceWritableWithCanonicalSymlinks(
  locationPaths: string[],
  canonicalPath: string,
  snapshot: SkillInventorySnapshot,
  options: Pick<ResolveIssueOptions, 'testFailSkillLinkAt'>,
): ReturnType<typeof replaceSkillLinksTransaction> {
  const uniquePaths = dedupeNormalizedPaths(locationPaths);
  await assertWritableSkillLinkMutationPlan(uniquePaths, snapshot);
  return replaceSkillLinksTransaction(uniquePaths, canonicalPath, snapshot.sources, {
    failAt: options.testFailSkillLinkAt,
    validateDestination: (targetPath) => assertSafeWritableSkillLinkMutation(
      targetPath,
      snapshot.sources,
      (snapshot.agents ?? []).flatMap((agent) => agent.writable && agent.skillsLocation.path ? [agent.skillsLocation.path] : []),
    ),
  });
}

function assertSkillSymlinkTargetWritable(locationPath: string, snapshot: SkillInventorySnapshot): void {
  const normalizedLocationPath = path.normalize(locationPath);
  const writableSource = snapshot.sources.find((source) => {
    if (!source.writable || source.kind === 'plugin') {
      return false;
    }

    const normalizedSkillsDir = path.normalize(source.skillsDir);
    return normalizedLocationPath === normalizedSkillsDir
      || normalizedLocationPath.startsWith(`${normalizedSkillsDir}${path.sep}`);
  });

  if (writableSource) {
    return;
  }

  const writableAgent = (snapshot.agents ?? []).find((agent) => {
    if (!agent.writable || agent.skillsLocation.state !== 'available' || !agent.skillsLocation.path) {
      return false;
    }

    const normalizedSkillsDir = path.normalize(agent.skillsLocation.path);
    return normalizedLocationPath === normalizedSkillsDir
      || normalizedLocationPath.startsWith(`${normalizedSkillsDir}${path.sep}`);
  });

  if (!writableAgent) {
    throw new Error('Skill resolution can only create symlinks in writable locations.');
  }
}

function resolveCanonicalSkillPath(
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
  selectedVariantPath: string | undefined,
  paths: SkillIndexPaths,
): string {
  const canonicalScope = resolveSkillMutationScope(skill, selectedVariantPath);
  const decisionCanonicalPath = resolveUserConfirmedPathDecisionSkillPath(skill, snapshot);
  if (decisionCanonicalPath) {
    return decisionCanonicalPath;
  }

  const preferredCanonicalPath = resolvePreferredCanonicalSkillPath(skill, snapshot, canonicalScope);
  if (preferredCanonicalPath) {
    return preferredCanonicalPath;
  }

  const canonicalSource = snapshot.sources.find((source) =>
    source.canonical && source.scope === canonicalScope);
  if (canonicalSource) {
    return path.join(canonicalSource.skillsDir, skill.name);
  }

  if (canonicalScope === 'sandbox' || canonicalScope === 'live') {
    return path.join(
      canonicalScope === 'sandbox' ? paths.sandboxCanonicalUserSkillsDir : paths.liveCanonicalUserSkillsDir,
      skill.name,
    );
  }

  throw new Error(`Unable to locate the canonical ${canonicalScope} skills directory for "${skill.name}".`);
}

function resolveUserConfirmedPathDecisionSkillPath(
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
): string | null {
  const decision = skill.detailDiagnostics.universalDecision;
  if (
    decision?.state !== 'user-confirmed'
    || decision.skillName !== skill.name
    || decision.universal.kind !== 'path'
  ) {
    return null;
  }

  return isPluginManagedTarget(decision.universal.path, snapshot.sources)
    ? null
    : decision.universal.path;
}

function resolvePreferredCanonicalSkillPath(
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
  scope: SkillLocationRecord['sourceScope'],
): string | null {
  const preferredSourceIds = new Set(
    snapshot.sources
      .filter((source) => source.preferredCanonical === true && source.scope === scope)
      .map((source) => source.id),
  );
  const preferredLocations = skill.locations
    .filter((location) => preferredSourceIds.has(location.sourceId))
    .sort((left, right) => left.path.localeCompare(right.path));

  return preferredLocations[0]?.path ?? null;
}

function resolveSkillMutationScope(
  skill: SkillRecord,
  selectedVariantPath: string | undefined,
): SkillLocationRecord['sourceScope'] {
  if (selectedVariantPath) {
    const selectedLocation = skill.locations.find((location) => location.path === selectedVariantPath);
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

export function isSupportedWritableMcpParser(parserKind: string): parserKind is McpMutationTarget['parserKind'] {
  return parserKind === 'json-servers'
    || parserKind === 'json-mcpServers'
    || parserKind === 'json-mcp'
    || parserKind === 'jsonc-mcpServers'
    || parserKind === 'jsonc-mcp'
    || parserKind === 'jsonc-dotted-amp-mcpServers'
    || parserKind === 'jsonc-dotted-zencoder-mcpServers'
    || parserKind === 'jsonc-mcp-servers'
    || parserKind === 'jsonc-opencode-mcp'
    || parserKind === 'toml'
    || parserKind === 'toml-mcpServers-array';
}

export function getDefaultMcpWriteDialect(parserKind: McpMutationTarget['parserKind']): AgentMcpWriteDialect {
  switch (parserKind) {
    case 'jsonc-opencode-mcp':
      return 'json-opencode';
    case 'jsonc-mcp-servers':
      return 'json-openclaw';
    case 'toml':
      return 'toml-codex';
    case 'toml-mcpServers-array':
      return 'toml-transport-array';
    default:
      return 'json-type-url';
  }
}

function mapMcpDefinitionsForWriteDialect(
  definitions: McpServerDefinitions,
  writeDialect: AgentMcpWriteDialect,
): McpServerDefinitions {
  return mapRecordValue(definitions, (definition) => mapMcpDefinitionForWriteDialect(definition, writeDialect));
}

function mapMcpDefinitionForWriteDialect(
  definition: McpDefinitionValue,
  writeDialect: AgentMcpWriteDialect,
): McpDefinitionObject {
  const normalizedDefinition = isMcpDefinitionObject(definition) ? definition : {};

  switch (writeDialect) {
    case 'json-url':
      return stripJsonTransportMarker(normalizedDefinition);
    case 'json-http-url':
      return toHttpUrlMcpDefinition(normalizedDefinition);
    case 'json-opencode':
      return toOpenCodeMcpDefinition(normalizedDefinition);
    case 'json-openclaw':
      return toOpenClawMcpDefinition(normalizedDefinition);
    case 'json-type-url':
    case 'toml-codex':
    case 'toml-transport-array':
    case 'yaml-typed':
    case 'none':
    case 'unknown':
      return { ...normalizedDefinition };
  }
}

function stripJsonTransportMarker(definition: McpDefinitionObject): McpDefinitionObject {
  const stripped: McpDefinitionObject = { ...definition };
  delete stripped.type;
  delete stripped.transport;
  return stripped;
}

function toHttpUrlMcpDefinition(definition: McpDefinitionObject): McpDefinitionObject {
  const transport = getJsonMcpTransport(definition);
  const mapped = stripJsonTransportMarker(definition);
  const url = getMcpRemoteUrl(mapped);
  if (!url || transport === 'stdio') {
    return mapped;
  }

  delete mapped.httpUrl;
  delete mapped.url;
  if (transport === 'streamable-http') {
    mapped.httpUrl = url;
  } else if (transport === 'http' || transport === 'sse') {
    mapped.url = url;
  }
  return mapped;
}

function toOpenClawMcpDefinition(definition: McpDefinitionObject): McpDefinitionObject {
  const transport = getJsonMcpTransport(definition);
  const mapped = stripJsonTransportMarker(definition);
  if (transport === 'http' || transport === 'streamable-http') {
    mapped.transport = 'streamable-http';
  }
  return mapped;
}

function toTomlMcpDefinition(
  definition: McpDefinitionValue,
  dialect: 'codex' | 'transport-array',
): McpDefinitionObject {
  const normalizedDefinition = isMcpDefinitionObject(definition) ? definition : {};
  const transport = getJsonMcpTransport(normalizedDefinition);
  const tomlDefinition: McpDefinitionObject = { ...normalizedDefinition };

  if (!transport) {
    return tomlDefinition;
  }

  delete tomlDefinition.type;
  delete tomlDefinition.transport;
  if (dialect === 'transport-array' || transport === 'sse') {
    tomlDefinition.transport = transport;
  }
  return tomlDefinition;
}

function toOpenCodeMcpDefinition(definition: McpDefinitionValue): McpDefinitionObject {
  const normalizedDefinition = isMcpDefinitionObject(definition) ? definition : {};
  const transport = getOpenCodeTransport(normalizedDefinition);

  if (transport === 'remote') {
    const remoteDefinition: McpDefinitionObject = {
      type: 'remote',
    };
    const url = getNonEmptyString(normalizedDefinition.url);
    if (url) {
      remoteDefinition.url = url;
    }
    const headers: McpDefinitionObject = isMcpDefinitionObject(normalizedDefinition.headers)
      ? { ...normalizedDefinition.headers }
      : {};
    if (isMcpDefinitionObject(normalizedDefinition.env_http_headers)) {
      for (const [header, rawEnvironmentVariable] of Object.entries(normalizedDefinition.env_http_headers)) {
        const environmentVariable = getNonEmptyString(rawEnvironmentVariable);
        if (environmentVariable) {
          headers[header] = `{env:${environmentVariable}}`;
        }
      }
    }
    const bearerTokenEnvVar = getNonEmptyString(normalizedDefinition.bearer_token_env_var);
    if (bearerTokenEnvVar) {
      headers.Authorization = `Bearer {env:${bearerTokenEnvVar}}`;
    }
    if (Object.keys(headers).length > 0) {
      remoteDefinition.headers = headers;
    }
    copyOptionalOpenCodeFields(normalizedDefinition, remoteDefinition, ['enabled', 'oauth', 'timeout']);
    return remoteDefinition;
  }

  const localDefinition: McpDefinitionObject = {
    type: 'local',
  };
  const command = getMcpCommand(normalizedDefinition);
  if (command) {
    localDefinition.command = [command, ...getMcpDefinitionArgs(normalizedDefinition)];
  }
  const environment = isMcpDefinitionObject(normalizedDefinition.environment)
    ? normalizedDefinition.environment
    : isMcpDefinitionObject(normalizedDefinition.env)
      ? normalizedDefinition.env
      : undefined;
  if (environment) {
    localDefinition.environment = environment;
  }
  const cwd = getNonEmptyString(normalizedDefinition.cwd);
  if (cwd) {
    localDefinition.cwd = cwd;
  }
  copyOptionalOpenCodeFields(normalizedDefinition, localDefinition, ['enabled', 'timeout']);
  return localDefinition;
}

function getOpenCodeTransport(definition: McpDefinitionObject): 'local' | 'remote' {
  const type = getNonEmptyString(definition.type)?.toLowerCase();
  if (type === 'remote') {
    return 'remote';
  }
  if (type === 'local') {
    return 'local';
  }

  const transport = getNonEmptyString(definition.transport)?.toLowerCase();
  if (transport === 'http' || transport === 'streamable-http' || transport === 'streamable_http' || transport === 'sse') {
    return 'remote';
  }

  return getNonEmptyString(definition.url) ? 'remote' : 'local';
}

function getJsonMcpTransport(definition: McpDefinitionObject): McpConfiguredTransportKind | undefined {
  const type = getNonEmptyString(definition.type)?.toLowerCase();
  switch (type) {
    case 'local':
    case 'stdio':
      return 'stdio';
    case 'remote':
    case 'http':
      return 'http';
    case 'streamable-http':
    case 'streamable_http':
      return 'streamable-http';
    case 'sse':
      return 'sse';
  }

  const transport = getNonEmptyString(definition.transport)?.toLowerCase();
  switch (transport) {
    case 'local':
    case 'stdio':
      return 'stdio';
    case 'remote':
    case 'http':
      return 'http';
    case 'streamable-http':
    case 'streamable_http':
      return 'streamable-http';
    case 'sse':
      return 'sse';
  }

  if (getNonEmptyString(definition.httpUrl)) {
    return 'streamable-http';
  }
  if (getNonEmptyString(definition.url)) {
    return 'http';
  }
  if (getMcpCommand(definition)) {
    return 'stdio';
  }
  return undefined;
}

function getMcpRemoteUrl(definition: McpDefinitionObject): string | undefined {
  return getNonEmptyString(definition.httpUrl) ?? getNonEmptyString(definition.url);
}

function getMcpCommand(definition: McpDefinitionObject): string | undefined {
  const command = definition.command;
  if (Array.isArray(command)) {
    return getNonEmptyString(command[0]);
  }

  return getNonEmptyString(command);
}

function getNonEmptyString(value: McpDefinitionValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function copyOptionalOpenCodeFields(source: McpDefinitionObject, target: McpDefinitionObject, keys: string[]): void {
  for (const key of keys) {
    if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
}

function mapRecordValue(
  value: McpServerDefinitions,
  mapValue: (nestedValue: McpDefinitionValue) => McpDefinitionObject,
): McpServerDefinitions {
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, mapValue(nestedValue)]),
  );
}
function extractMcpDefinitions(
  parsed: McpDefinitionObject,
  fields: string[],
): McpServerDefinitions | null {
  for (const field of fields) {
    const definitions = parsed[field];
    if (isMcpServerDefinitions(definitions)) {
      return definitions;
    }
  }

  return null;
}

function extractNestedMcpDefinitions(
  parsed: McpDefinitionObject,
  pathSegments: string[],
): McpServerDefinitions | null {
  let current: McpDefinitionValue | undefined = parsed;

  for (const segment of pathSegments) {
    if (!isMcpDefinitionObject(current)) {
      return null;
    }
    current = current[segment];
  }

  return isMcpServerDefinitions(current) ? current : null;
}
