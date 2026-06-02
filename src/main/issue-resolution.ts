import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
import { MCP_AGENT_LOCAL_KEY, buildPortableMcpDefinition, isMcpDefinitionObject, isMcpServerDefinitions, splitMcpDefinitionForComparison } from '@shared/mcp-definition';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPaths,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';
import {
  getSubagentFileNameForFormat,
  isMarkdownSubagentSymlinkCompatible,
} from '@shared/subagent-format-policy';
import {
  parseTomlMcpServerArray,
  parseTomlMcpServers,
  updateTomlMcpServerArray,
  updateTomlMcpServers,
} from '@shared/toml-mcp';

import { sanitizeJsonc, sortRecordValue } from '@main/json-utils';
import { makeSkillCanonical } from '@main/skill-canonicalization';
import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';
import {
  readPortableSubagentDefinitionFromFile,
  renderPortableSubagentDefinition,
  type PortableSubagentDefinition,
} from '@main/subagent-inventory';
import { persistSkillUniversalDecisionForSelection } from '@main/skill-universal-decisions';

export interface ResolveIssueOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
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

export async function resolveInventoryIssue(
  request: ResolveIssueRequest,
  options: ResolveIssueOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const snapshot = await scanInventory({
    ...options,
    paths,
  });

  assertResolutionIssueIsCurrent(snapshot, request);

  if (request.entity === 'skill') {
    await resolveSkillIssueIfCurrent(snapshot, request, {
      ...options,
      paths,
    });
  } else if (request.entity === 'mcp') {
    await resolveMcpIssueIfCurrent(snapshot, request, {
      ...options,
      paths,
    });
  } else {
    await resolveSubagentIssueIfCurrent(snapshot, request, {
      ...options,
      paths,
    });
  }

  const nextSnapshot = await scanInventory({
    ...options,
    paths,
  });
  assertResolutionIssueWasResolved(nextSnapshot, request);
  return nextSnapshot;
}

export async function addMcpServer(
  request: AddMcpServerRequest,
  options: ResolveIssueOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const snapshot = await scanInventory({
    ...options,
    paths,
  });
  const definition = buildMcpServerDefinition(request);
  const mutationTargets = getAddMcpServerTargets(snapshot, request.transport);

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

  await Promise.all(
    updates.map(async (target) => {
      target.definitions[request.name.trim()] = definition;
      await writeMcpDefinitions(target.configPath, target.parserKind, target.definitions, target.writeDialect);
    }),
  );

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
  try {
    return buildWritableMcpMutationTarget(snapshot, agentId, configPath) !== null;
  } catch {
    return false;
  }
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

  switch (request.issue) {
    case 'missing-canonical':
    case 'diverged-copies': {
      const selectedSourcePath = pickSkillRealFileSelectionPath(skill, request.selectedVariantPath);
      await makeSkillCanonical(
        {
          skillName: request.skillName,
          selectedSourcePath,
        },
        {
          ...options,
          linkMissingAgentInstalls: false,
        },
      );
      return;
    }
    case 'identical-copies': {
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath);
      const canonicalPath = canonicalPackage.path;
      const duplicatePaths = skill.locations
        .filter((location) =>
          location.fileType === 'real-file'
          && location.path !== canonicalPath
          && location.provenance?.kind !== 'plugin')
        .map((location) => location.path);
      await Promise.all(dedupeNormalizedPaths(duplicatePaths).map((locationPath) => replaceWritableWithCanonicalSymlink(locationPath, canonicalPath, snapshot)));
      await persistSkillUniversalDecisionForSelection(skill, canonicalPackage.location, options);
      return;
    }
    case 'missing-symlinks': {
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath);
      const canonicalPath = canonicalPackage.path;
      const missingPaths = (skill.detailDiagnostics.missingInstallSources ?? [])
        .map((source) => resolveMissingSkillInstallPath(skill.name, source.sourceId, snapshot))
        .filter((locationPath): locationPath is string => Boolean(locationPath))
        .filter((locationPath) => path.normalize(locationPath) !== path.normalize(canonicalPath));
      await Promise.all(dedupeNormalizedPaths(missingPaths).map((locationPath) => replaceWritableWithCanonicalSymlink(locationPath, canonicalPath, snapshot)));
      await persistSkillUniversalDecisionForSelection(skill, canonicalPackage.location, options);
      return;
    }
    case 'broken-symlink': {
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath);
      const canonicalPath = canonicalPackage.path;
      const brokenPaths = skill.locations
        .filter((location) => location.fileType === 'symlink' && location.resolvedPath === undefined)
        .map((location) => location.path);
      await Promise.all(dedupeNormalizedPaths(brokenPaths).map((locationPath) => replaceWritableWithCanonicalSymlink(locationPath, canonicalPath, snapshot)));
      await persistSkillUniversalDecisionForSelection(skill, canonicalPackage.location, options);
      return;
    }
    case 'wrong-symlink-target': {
      const canonicalPackage = await ensureCanonicalSkillPackage(skill, snapshot, request.selectedVariantPath);
      const canonicalPath = canonicalPackage.path;
      const wrongTargetPaths = skill.locations
        .filter((location) =>
          location.fileType === 'symlink'
          && location.resolvedPath !== undefined
          && path.normalize(location.resolvedPath) !== path.normalize(canonicalPath))
        .map((location) => location.path);
      await Promise.all(dedupeNormalizedPaths(wrongTargetPaths).map((locationPath) => replaceWritableWithCanonicalSymlink(locationPath, canonicalPath, snapshot)));
      await persistSkillUniversalDecisionForSelection(skill, canonicalPackage.location, options);
      return;
    }
  }
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

  const selectedVariant = pickMcpSelection(mcp.locations, request.selectedVariantPath, {
    preferUniversal: request.issue === 'missing-from-agents',
  });
  const selectedDefinition = parseSelectedMcpDefinition(selectedVariant);
  const agentLocalDefinitions = collectAgentLocalDefinitionsForMcp(mcp, selectedDefinition);
  const mutationTargets = collectMcpResolutionTargets(snapshot, request.issue, mcp, selectedVariant, options);

  if (mutationTargets.length === 0) {
    throw new Error(`MCP "${request.mcpName}" has no writable supported targets for ${request.issue}.`);
  }

  const updates = await Promise.all(
    mutationTargets.map(async (target) => ({
      ...target,
      definitions: await readWritableMcpDefinitions(target),
    })),
  );

  await Promise.all(
    updates.map(async (target) => {
      const definitionName = getMcpDefinitionNameForWrite(request.mcpName, selectedVariant);
      if (definitionName !== request.mcpName) {
        delete target.definitions[request.mcpName];
      }
      target.definitions[definitionName] = buildMcpDefinitionForTarget(
        snapshot,
        target,
        target.definitions[definitionName],
        selectedDefinition,
        agentLocalDefinitions,
      );
      await writeMcpDefinitions(target.configPath, target.parserKind, target.definitions, target.writeDialect);
    }),
  );
}

function collectMcpResolutionTargets(
  snapshot: SkillInventorySnapshot,
  issue: Extract<ResolveIssueRequest, { entity: 'mcp' }>['issue'],
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  selectedVariant: McpLocationRecord,
  options: ResolveIssueOptions & { paths: SkillIndexPaths },
): McpMutationTarget[] {
  const targets = issue === 'missing-universal'
    ? buildWritableUniversalMcpTargets(snapshot, selectedVariant.scope, options)
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

  switch (request.issue) {
    case 'missing-universal': {
      const selectedLocation = pickSubagentSelection(subagent, request.selectedVariantPath, {
        allowInvalid: true,
      });
      const canonicalPath = isInvalidSubagentLocation(selectedLocation)
        ? await copySubagentLocationToCanonicalPath(subagent, selectedLocation, options.paths)
        : (await ensureCanonicalSubagentPackage(subagent, snapshot, request.selectedVariantPath, options, {
            preferExisting: false,
          })).path;
      const duplicateTargets = collectIdenticalMarkdownSubagentCopyTargets(subagent, snapshot, selectedLocation.definitionComparisonKey);
      await Promise.all(dedupeSubagentTargets(duplicateTargets).map((target) =>
        replaceWithCanonicalSymlink(target.path, canonicalPath)));
      return;
    }
    case 'missing-from-agents': {
      const canonicalPackage = await ensureCanonicalSubagentPackage(subagent, snapshot, request.selectedVariantPath, options, {
        allowInvalid: true,
        preferExisting: true,
      });
      const targets = collectWritableMissingSubagentTargets(snapshot, subagent.missingLocations ?? []);
      await Promise.all(dedupeSubagentTargets(targets).map((target) =>
        writeSubagentTarget(target, canonicalPackage, canonicalPackage.definition, snapshot)));
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
        replaceWithCanonicalSymlink(target.path, canonicalPath)));
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
        writeSubagentTarget(target, canonicalPackage, canonicalPackage.definition, snapshot)));
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
        writeSubagentTarget(target, canonicalPackage, selectedDefinition, snapshot)));
      return;
    }
  }
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
  await writeSubagentDefinitionFile(canonicalPath, 'markdown-frontmatter', definition, {
    allowInvalid: behavior.allowInvalid && isInvalidSubagentLocation(selectedLocation),
  });
  return {
    allowInvalid: isInvalidSubagentLocation(selectedLocation),
    path: canonicalPath,
    definition,
  };
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
  paths: SkillIndexPaths,
): Promise<string> {
  const canonicalPath = resolveCanonicalSubagentPath(subagent, selectedLocation, paths);
  if (path.normalize(canonicalPath) === path.normalize(selectedLocation.path)) {
    return canonicalPath;
  }

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
): Promise<void> {
  if (path.normalize(target.path) === path.normalize(canonicalPackage.path)) {
    await writeSubagentDefinitionFile(target.path, 'markdown-frontmatter', stripSubagentLocalExtras(definition), {
      allowInvalid: canonicalPackage.allowInvalid,
    });
    return;
  }

  const family = target.family ?? findSubagentLocationFamily(snapshot, target.agentId);
  if (
    target.format === 'markdown-frontmatter'
    && isMarkdownSubagentSymlinkCompatible(family)
    && !hasSubagentLocalExtras(target)
  ) {
    await replaceWithCanonicalSymlink(target.path, canonicalPackage.path);
    return;
  }

  await writeSubagentDefinitionFile(
    target.path,
    target.format,
    mergeExistingSubagentTargetExtras(target, stripSubagentLocalExtras(definition)),
    { allowInvalid: canonicalPackage.allowInvalid, family },
  );
}

async function writeSubagentDefinitionFile(
  filePath: string,
  format: AgentSubagentParserKind,
  definition: PortableSubagentDefinition,
  options: { allowInvalid?: boolean; family?: string } = {},
): Promise<void> {
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
): Promise<CanonicalSkillPackage> {
  const pluginCanonicalLocation = resolvePluginCanonicalSkillLocation(skill, selectedVariantPath);
  if (pluginCanonicalLocation) {
    return {
      path: pluginCanonicalLocation.path,
      location: pluginCanonicalLocation,
    };
  }

  const canonicalPath = resolveCanonicalSkillPath(skill, snapshot, selectedVariantPath);
  const canonicalRealFile = skill.locations.find((location) =>
    location.path === canonicalPath && location.fileType === 'real-file');
  if (canonicalRealFile) {
    return {
      path: canonicalPath,
      location: canonicalRealFile,
    };
  }

  const selectedSourcePath = pickSkillRealFileSelectionPath(skill, selectedVariantPath);
  const selectedLocation = skill.locations.find((location) => location.path === selectedSourcePath && location.fileType === 'real-file');
  if (!selectedLocation) {
    throw new Error('The selected skill version must be a real file before repairing links.');
  }

  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await rm(canonicalPath, { recursive: true, force: true });
  await cp(selectedLocation.path, canonicalPath, {
    recursive: true,
    dereference: true,
    force: true,
  });
  return {
    path: canonicalPath,
    location: {
      ...selectedLocation,
      path: canonicalPath,
    },
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
): Promise<void> {
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
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      updateTomlMcpServers(raw, tomlDefinitions),
      'utf8',
    );
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

    await mkdir(path.dirname(configPath), { recursive: true });
    const tomlDefinitions = mapRecordValue(definitions, (definition) => toTomlMcpDefinition(definition, writeDialect === 'toml-codex' ? 'codex' : 'transport-array'));
    const sortedDefinitions = sortRecordValue(tomlDefinitions);
    await writeFile(
      configPath,
      updateTomlMcpServerArray(raw, isMcpServerDefinitions(sortedDefinitions) ? sortedDefinitions : tomlDefinitions),
      'utf8',
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
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({
        ...preservedConfig,
        mcp: sortRecordValue(mapRecordValue(definitions, (definition) => mapMcpDefinitionForWriteDialect(definition, 'json-opencode'))),
      }, null, 2)}\n`,
      'utf8',
    );
    return;
  }

  if (parserKind === 'jsonc-dotted-amp-mcpServers' || parserKind === 'jsonc-dotted-zencoder-mcpServers') {
    await writeJsoncMcpDefinitions(configPath, mapMcpDefinitionsForWriteDialect(definitions, writeDialect), {
      field: parserKind === 'jsonc-dotted-amp-mcpServers' ? 'amp.mcpServers' : 'zencoder.mcpServers',
    });
    return;
  }

  if (parserKind === 'jsonc-mcp-servers') {
    await writeJsoncMcpDefinitions(configPath, mapMcpDefinitionsForWriteDialect(definitions, writeDialect), {
      fieldPath: ['mcp', 'servers'],
    });
    return;
  }

  const jsonTarget = getJsonMcpDefinitionTarget(parserKind);
  await writeJsonMcpDefinitions(configPath, mapMcpDefinitionsForWriteDialect(definitions, writeDialect), {
    field: jsonTarget.field,
    jsonc: isJsoncMcpParserKind(parserKind),
    removeFields: jsonTarget.removeFields,
  });
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
): Promise<void> {
  const parsedConfig = await readJsonConfigObject(configPath, { jsonc: true });

  if (target.field) {
    parsedConfig[target.field] = sortRecordValue(definitions);
  } else if (target.fieldPath) {
    setNestedRecordValue(parsedConfig, target.fieldPath, sortRecordValue(definitions));
  }

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(parsedConfig, null, 2)}\n`, 'utf8');
}

async function writeJsonMcpDefinitions(
  configPath: string,
  definitions: McpServerDefinitions,
  target: { field: 'servers' | 'mcpServers' | 'mcp'; jsonc: boolean; removeFields: Array<'servers' | 'mcpServers' | 'mcp'> },
): Promise<void> {
  const parsedConfig = await readJsonConfigObject(configPath, { jsonc: target.jsonc });
  for (const field of target.removeFields) {
    delete parsedConfig[field];
  }
  parsedConfig[target.field] = sortRecordValue(definitions);

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(parsedConfig, null, 2)}\n`, 'utf8');
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

async function replaceWithCanonicalSymlink(locationPath: string, canonicalPath: string): Promise<void> {
  await mkdir(path.dirname(locationPath), { recursive: true });
  await rm(locationPath, { recursive: true, force: true });
  await symlink(canonicalPath, locationPath);
}

async function replaceWritableWithCanonicalSymlink(
  locationPath: string,
  canonicalPath: string,
  snapshot: SkillInventorySnapshot,
): Promise<void> {
  assertSkillSymlinkTargetWritable(locationPath, snapshot);
  await replaceWithCanonicalSymlink(locationPath, canonicalPath);
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

function resolvePluginCanonicalSkillLocation(
  skill: SkillRecord,
  selectedVariantPath: string | undefined,
): SkillLocationRecord | null {
  if (selectedVariantPath) {
    const selectedLocation = skill.locations.find((location) =>
      location.path === selectedVariantPath
      && location.fileType === 'real-file'
      && location.provenance?.kind === 'plugin');
    return selectedLocation ?? null;
  }

  const pluginCanonicalLocations = skill.locations
    .filter((location) =>
      location.fileType === 'real-file'
      && location.provenance?.kind === 'plugin'
      && location.canonical)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (pluginCanonicalLocations.length === 0) {
    return null;
  }

  const decision = skill.detailDiagnostics.universalDecision;
  if (decision?.universal.kind === 'plugin') {
    const universal = decision.universal;
    const decisionMatches = pluginCanonicalLocations.filter((location) => {
      const plugin = location.provenance?.plugin;
      return plugin?.host === universal.host
        && plugin.pluginId === universal.pluginId
        && path.basename(location.path) === universal.pluginSkillName;
    });
    const decisionMatch = decisionMatches.find((location) =>
      universal.pluginVersion === undefined
      || location.provenance?.plugin?.version === universal.pluginVersion)
      ?? decisionMatches[0];
    if (decisionMatch) {
      return decisionMatch;
    }
  }

  const realFileGroups = groupSkillRealFiles(skill.locations.filter((location) => location.fileType === 'real-file'));
  return realFileGroups.length === 1 ? pluginCanonicalLocations[0] : null;
}

function resolveCanonicalSkillPath(
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
  selectedVariantPath: string | undefined,
): string {
  const canonicalScope = resolveSkillMutationScope(skill, selectedVariantPath);
  const decisionCanonicalPath = resolveUserConfirmedPathDecisionSkillPath(skill);
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

  throw new Error(`Unable to locate the canonical ${canonicalScope} skills directory for "${skill.name}".`);
}

function resolveUserConfirmedPathDecisionSkillPath(skill: SkillRecord): string | null {
  const decision = skill.detailDiagnostics.universalDecision;
  if (
    decision?.state !== 'user-confirmed'
    || decision.skillName !== skill.name
    || decision.universal.kind !== 'path'
  ) {
    return null;
  }

  return decision.universal.path;
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
    if (isMcpDefinitionObject(normalizedDefinition.headers)) {
      remoteDefinition.headers = normalizedDefinition.headers;
    }
    copyOptionalOpenCodeFields(normalizedDefinition, remoteDefinition, ['enabled', 'oauth', 'timeout']);
    return remoteDefinition;
  }

  const localDefinition: McpDefinitionObject = {
    type: 'local',
  };
  const command = getMcpCommand(normalizedDefinition);
  if (command) {
    localDefinition.command = [command, ...getMcpArgs(normalizedDefinition)];
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

function getMcpArgs(definition: McpDefinitionObject): string[] {
  if (Array.isArray(definition.command)) {
    return definition.command.slice(1).filter((value): value is string => typeof value === 'string');
  }

  return Array.isArray(definition.args)
    ? definition.args.filter((value): value is string => typeof value === 'string')
    : [];
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
