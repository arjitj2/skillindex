import { accessSync, constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentMcpParserKind,
  AgentMcpSupportedTransport,
  AgentRecord,
  McpConfiguredTransportKind,
  McpConnectivityRecord,
  McpDefinitionObject,
  McpDefinitionValue,
  McpExpectedLocationRecord,
  McpInventoryCounts,
  McpIssueReason,
  McpLocationRecord,
  McpRecord,
  McpServerDefinitions,
  McpTransportKind,
  PluginRecord,
  PluginSourceRef,
  RemoteMcpTransportKind,
  SkillScanSource,
} from '@shared/contracts';
import {
  getMcpDefinitionArgs,
  getMcpDefinitionCommand,
  getMcpDefinitionRemoteUrl,
  isMcpDefinitionObject,
  isMcpServerDefinitions,
  normalizeMcpDefinitionForParser,
  splitMcpDefinitionForComparison,
} from '@shared/mcp-definition';
import { parseTomlMcpServerArray, parseTomlMcpServers } from '@shared/toml-mcp';

import { sanitizeJsonc, stableStringify } from '@main/json-utils';
import { verifyMcpConnection } from '@main/mcp-connectivity';
import {
  annotateComparableVersionEvidence,
  buildPluginManagedSourceCandidate,
  detectPluginDependencyWarnings,
  getOperationalLocations,
  isAgentSatisfiedByNativePlugin,
} from '@main/plugin-managed-sources';

export interface McpConnectivityProbeTarget {
  name: string;
  location: McpLocationRecord;
  definition: McpDefinitionObject;
}

export interface McpConnectivityVerifierContext {
  signal?: AbortSignal;
}

export type McpConnectivityVerifier = (
  target: McpConnectivityProbeTarget,
  context?: McpConnectivityVerifierContext,
) => Promise<McpConnectivityRecord>;

export interface CollectMcpRecordsOptions {
  verifyMcpConnectivity?: boolean | McpConnectivityVerifier;
  mcpConnectivityAbortSignal?: AbortSignal;
  mcpConnectivityTimeoutMs?: number;
  mcpConnectivityConcurrency?: number;
}

interface McpOwnerRecord extends McpExpectedLocationRecord {
  configExists: boolean;
  family?: string;
  parseable: boolean;
  parserKind: AgentMcpParserKind;
  mcpSupportedTransports?: AgentMcpSupportedTransport[];
  plugin?: PluginSourceRef;
  universal?: boolean;
}

interface ParsedMcpEntry {
  name: string;
  location: McpLocationRecord;
  definition: McpDefinitionObject;
}

interface ParsedMcpConfigResult {
  entries: ParsedMcpEntry[];
  configIssue: McpRecord | null;
  owner: McpOwnerRecord;
}

interface PluginMcpIndexEntry {
  inventoryName: string;
  coreDefinitionComparisonKey?: string;
}

type PluginMcpSourcesByLocation = Map<string, PluginSourceRef>;

interface ResolvedMcpConnection {
  command?: string;
  url?: string;
  transport?: McpConfiguredTransportKind;
  invalidDetails: string[];
}

interface NormalizedExplicitMcpTransport {
  transport?: McpConfiguredTransportKind;
  invalidDetail?: string;
}

export async function collectMcpRecords(
  agents: AgentRecord[],
  sources: SkillScanSource[],
  plugins: PluginRecord[],
  options: CollectMcpRecordsOptions = {},
): Promise<McpRecord[]> {
  const owners = collectMcpOwners(agents, sources, plugins);
  const groupedLocations = new Map<string, McpLocationRecord[]>();
  const probeTargets: McpConnectivityProbeTarget[] = [];
  const configIssueRecords: McpRecord[] = [];
  const scannedOwners: McpOwnerRecord[] = [];
  const parsedConfigs: ParsedMcpConfigResult[] = [];

  for (const owner of owners) {
    const result = await readMcpConfig(owner);
    scannedOwners.push(result.owner);

    if (result.configIssue) {
      configIssueRecords.push(result.configIssue);
      continue;
    }

    parsedConfigs.push(result);
  }

  const pluginMcpIndex = buildPluginMcpIndex(parsedConfigs);
  const pluginSourcesByLocation = buildPluginMcpSourcesByLocation(parsedConfigs);
  for (const result of parsedConfigs) {
    for (const entry of result.entries) {
      const inventoryMcpName = createInventoryMcpName(entry, result.owner, pluginMcpIndex);
      const existing = groupedLocations.get(inventoryMcpName) ?? [];
      existing.push(entry.location);
      groupedLocations.set(inventoryMcpName, existing);

      if (entry.location.canonicalRole !== 'managed-source' && (entry.location.invalidDetails?.length ?? 0) === 0) {
        probeTargets.push({
          name: inventoryMcpName,
          location: entry.location,
          definition: entry.definition,
        });
      }
    }
  }

  await verifyMcpProbeTargets(probeTargets, options);

  const parsedOwners = scannedOwners.filter((owner) => owner.parseable);
  const records = [...groupedLocations.entries()].map(([name, locations]) =>
    classifyMcpLocations(name, locations, parsedOwners, pluginSourcesByLocation));

  return [...configIssueRecords, ...records];
}

export function applyMcpPresentation(mcp: McpRecord, dismissedMcpSignatures: string[]): McpRecord {
  if (mcp.status !== 'needs-attention' || !mcp.signature) {
    return mcp;
  }

  return {
    ...mcp,
    presentation: dismissedMcpSignatures.includes(mcp.signature) ? 'dismissed' : 'active',
  };
}

export function applyDismissedMcpState(mcps: McpRecord[], dismissedMcpSignatures: string[]): McpRecord[] {
  return mcps.map((mcp) => applyMcpPresentation(mcp, dismissedMcpSignatures));
}

export function countMcps(mcps: McpRecord[]): McpInventoryCounts {
  return mcps.reduce<McpInventoryCounts>(
    (counts, mcp) => {
      counts.totalMcps += 1;

      if (mcp.status === 'healthy') {
        counts.healthyMcps += 1;
      } else if (mcp.presentation === 'dismissed') {
        counts.dismissedAttentionMcps += 1;
      } else {
        counts.attentionMcps += 1;
      }

      return counts;
    },
    emptyMcpInventoryCounts(),
  );
}

export function emptyMcpInventoryCounts(): McpInventoryCounts {
  return {
    totalMcps: 0,
    attentionMcps: 0,
    healthyMcps: 0,
    dismissedAttentionMcps: 0,
  };
}

export function reconcileCachedMcps(
  cachedMcps: McpRecord[],
  agents: AgentRecord[],
  sources: SkillScanSource[],
  plugins: PluginRecord[],
): McpRecord[] {
  const activeOwners = collectMcpOwners(agents, sources, plugins);
  const activeOwnerIds = new Set(activeOwners.map((owner) => owner.agentId));
  const parseableOwners = activeOwners.filter((owner) => owner.parseable);
  const pluginSourcesByLocation = buildPluginMcpSourcesByOwner(activeOwners);

  return cachedMcps
    .map((mcp) => {
      const locations = mcp.locations.filter((location) => activeOwnerIds.has(location.agentId));
      // Expected owners are derived metadata, never evidence that an MCP still
      // exists. In particular a plugin-only entry must disappear as soon as its
      // current managed source is removed.
      if (locations.length === 0) {
        return null;
      }

      return classifyMcpLocations(mcp.name, locations, parseableOwners, pluginSourcesByLocation);
    })
    .filter((mcp): mcp is McpRecord => mcp !== null)
    .sort(compareMcps);
}

function buildPluginMcpSourcesByLocation(results: ParsedMcpConfigResult[]): PluginMcpSourcesByLocation {
  const sources = new Map<string, PluginSourceRef>();
  for (const result of results) {
    if (!result.owner.plugin) continue;
    for (const entry of result.entries) {
      sources.set(getPluginMcpLocationKey(entry.location), result.owner.plugin);
    }
  }
  return sources;
}

function buildPluginMcpSourcesByOwner(owners: McpOwnerRecord[]): PluginMcpSourcesByLocation {
  const sources = new Map<string, PluginSourceRef>();
  for (const owner of owners) {
    if (owner.plugin && owner.configPath) {
      sources.set(getPluginMcpLocationKey({ agentId: owner.agentId, configPath: owner.configPath }), owner.plugin);
    }
  }
  return sources;
}

function getPluginMcpLocationKey(location: Pick<McpLocationRecord, 'agentId' | 'configPath'>): string {
  return `${location.agentId}\u0000${path.normalize(location.configPath)}`;
}

export function compareMcps(left: McpRecord, right: McpRecord): number {
  if (left.status !== right.status) {
    return left.status === 'needs-attention' ? -1 : 1;
  }

  if (left.presentation !== right.presentation) {
    return left.presentation === 'active' ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function buildPluginMcpIndex(results: ParsedMcpConfigResult[]): Map<string, PluginMcpIndexEntry[]> {
  const pluginMcpIndex = new Map<string, PluginMcpIndexEntry[]>();

  for (const result of results) {
    if (!result.owner.plugin) {
      continue;
    }

    for (const entry of result.entries) {
      const existing = pluginMcpIndex.get(entry.name) ?? [];
      existing.push({
        inventoryName: `${result.owner.plugin.pluginName}:${entry.name}`,
        coreDefinitionComparisonKey: getMcpCoreDefinitionComparisonKey(entry.location),
      });
      pluginMcpIndex.set(entry.name, existing);
    }
  }

  return pluginMcpIndex;
}

function createInventoryMcpName(
  entry: ParsedMcpEntry,
  owner: McpOwnerRecord,
  pluginMcpIndex: Map<string, PluginMcpIndexEntry[]>,
): string {
  if (owner.plugin) {
    return `${owner.plugin.pluginName}:${entry.name}`;
  }

  const pluginCandidates = pluginMcpIndex.get(entry.name) ?? [];
  const matchingDefinitionCandidates = pluginCandidates.filter((candidate) =>
    candidate.coreDefinitionComparisonKey === getMcpCoreDefinitionComparisonKey(entry.location));

  if (matchingDefinitionCandidates.length === 1) {
    return matchingDefinitionCandidates[0].inventoryName;
  }

  if (pluginCandidates.length === 1) {
    return pluginCandidates[0].inventoryName;
  }

  return entry.name;
}

async function verifyMcpProbeTargets(
  targets: McpConnectivityProbeTarget[],
  options: CollectMcpRecordsOptions,
): Promise<void> {
  const verifier = resolveMcpConnectivityVerifier(options);
  if (!verifier || targets.length === 0 || options.mcpConnectivityAbortSignal?.aborted) {
    return;
  }

  await mapWithConcurrency(
    targets,
    Math.max(1, options.mcpConnectivityConcurrency ?? 3),
    async (target) => {
      if (options.mcpConnectivityAbortSignal?.aborted) {
        return;
      }

      target.location.connectivity = await verifier(target, {
        signal: options.mcpConnectivityAbortSignal,
      });
    },
    () => !options.mcpConnectivityAbortSignal?.aborted,
  );
}

function resolveMcpConnectivityVerifier(options: CollectMcpRecordsOptions): McpConnectivityVerifier | null {
  if (typeof options.verifyMcpConnectivity === 'function') {
    return options.verifyMcpConnectivity;
  }

  if (!options.verifyMcpConnectivity) {
    return null;
  }

  return async (target, context) => {
    if (target.location.scope === 'sandbox') {
      return {
        status: 'skipped',
        checkedAt: new Date().toISOString(),
        error: 'Sandbox MCP connectivity is not verified from the live process.',
      };
    }

    return verifyMcpConnection(target.location, {
      definition: target.definition,
      signal: context?.signal,
      timeoutMs: options.mcpConnectivityTimeoutMs,
    });
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (shouldContinue() && nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) {
        await run(item);
      }
    }
  }));
}

function classifyMcpLocations(
  name: string,
  locations: McpLocationRecord[],
  expectedOwners: McpOwnerRecord[],
  pluginSourcesByLocation: PluginMcpSourcesByLocation,
): McpRecord {
  const sortedLocations = [...locations].sort((left, right) =>
    left.configPath.localeCompare(right.configPath) || left.agentId.localeCompare(right.agentId));
  const operationalLocations = getOperationalLocations(sortedLocations);
  const ownersByAgentId = new Map(expectedOwners.map((owner) => [owner.agentId, owner]));
  const supportedLocations = operationalLocations.filter((location) => {
    const owner = ownersByAgentId.get(location.agentId);
    return !owner || isMcpTransportSupportedByOwner(owner, location.transport);
  });
  const issueLocations = supportedLocations.length > 0 ? supportedLocations : operationalLocations;
  const universalLocation = issueLocations.find(isUniversalMcpLocation) ?? null;
  const invalidDefinition = issueLocations.some((location) => (location.invalidDetails?.length ?? 0) > 0);
  const connectionFailed = issueLocations.some((location) => location.connectivity?.status === 'failed');
  const pluginConfigName = getPluginConfigNameForRecord(name, sortedLocations);
  const presentAgentIds = new Set(operationalLocations
    .filter((location) =>
      !pluginConfigName
      || location.agentId.startsWith('plugin:')
      || location.configName === pluginConfigName)
    .map((location) => location.agentId));
  const enabledPluginSources = sortedLocations.flatMap((location) => {
    const plugin = pluginSourcesByLocation.get(getPluginMcpLocationKey(location));
    return plugin ? [plugin] : [];
  });
  const expectedOwnersForRecord = expectedOwners.filter((owner) =>
    !owner.plugin && !owner.universal && !isAgentSatisfiedByNativePlugin(owner.family, enabledPluginSources));
  const recordTransport = getMcpRecordTransport(issueLocations);
  const expectedLocations = expectedOwnersForRecord.map((owner) => buildMcpExpectedLocation(owner, recordTransport));
  const missingLocations = universalLocation
    ? expectedLocations.filter((location) =>
        location.supportStatus !== 'unsupported' && !presentAgentIds.has(location.agentId))
    : [];
  const issueReasons: McpIssueReason[] = [];

  if (invalidDefinition) {
    issueReasons.push('invalid-definition');
  }

  if (connectionFailed) {
    issueReasons.push('connection-failed');
  }

  if (!universalLocation) {
    issueReasons.push('missing-universal');
  }

  if (hasMcpDefinitionMismatch(issueLocations, universalLocation)) {
    issueReasons.push('definition-mismatch');
  }

  if (missingLocations.length > 0) {
    issueReasons.push('missing-from-agents');
  }

  const status = issueReasons.length > 0 ? 'needs-attention' : 'healthy';
  const managedSourceCandidates = buildMcpManagedSourceCandidates(
    sortedLocations,
    pluginSourcesByLocation,
    universalLocation ? getMcpCoreDefinitionComparisonKey(universalLocation) : null,
  );

  return {
    name,
    status,
    presentation: status === 'needs-attention' ? 'active' : 'none',
    locations: sortedLocations,
    expectedLocations,
    missingLocations,
    issueReasons,
    managedSourceCandidates,
    signature: status === 'needs-attention'
      ? createMcpSignature(
        name,
        sortedLocations,
        expectedLocations,
        missingLocations,
      )
      : undefined,
  };
}

function buildMcpManagedSourceCandidates(
  locations: McpLocationRecord[],
  pluginSourcesByLocation: PluginMcpSourcesByLocation,
  universalComparisonKey: string | null,
): McpRecord['managedSourceCandidates'] {
  const candidates = locations.flatMap((location) => {
    if (location.canonicalRole !== 'managed-source') return [];
    const plugin = pluginSourcesByLocation.get(getPluginMcpLocationKey(location));
    const comparisonKey = getMcpCoreDefinitionComparisonKey(location);
    if (!plugin || !comparisonKey) return [];
    return [buildPluginManagedSourceCandidate({
      path: location.configPath,
      plugin,
      comparisonKey,
      universalComparisonKey,
      dependencyWarnings: detectPluginDependencyWarnings({
        text: location.definitionText ?? '',
        pluginRoot: plugin.rootPath,
        providerSpecificFields: Object.keys(location.nativeDefinition ?? {}),
      }),
    })];
  });
  if (candidates.length === 0) return undefined;

  const annotatedCandidates = [...candidates];
  const candidateIndexesByPlugin = new Map<string, number[]>();
  for (const [index, candidate] of candidates.entries()) {
    const key = `${candidate.plugin.host}\u0000${candidate.plugin.pluginId}`;
    const indexes = candidateIndexesByPlugin.get(key) ?? [];
    indexes.push(index);
    candidateIndexesByPlugin.set(key, indexes);
  }
  for (const indexes of candidateIndexesByPlugin.values()) {
    const annotated = annotateComparableVersionEvidence(
      indexes.map((index) => candidates[index]),
      (candidate) => candidate.plugin.version,
    );
    for (const [groupIndex, candidateIndex] of indexes.entries()) {
      annotatedCandidates[candidateIndex] = annotated[groupIndex]!;
    }
  }
  return annotatedCandidates;
}

function hasMcpDefinitionMismatch(
  locations: McpLocationRecord[],
  universalLocation: McpLocationRecord | null,
): boolean {
  if (universalLocation) {
    const universalCoreKey = getMcpCoreDefinitionComparisonKey(universalLocation);
    return locations.some((location) => getMcpCoreDefinitionComparisonKey(location) !== universalCoreKey);
  }

  return new Set(locations.map(getMcpCoreDefinitionComparisonKey)).size > 1;
}

function isUniversalMcpLocation(location: McpLocationRecord): boolean {
  return location.provenance?.kind === 'universal';
}

function getMcpCoreDefinitionComparisonKey(location: McpLocationRecord): string {
  return location.coreDefinitionComparisonKey ?? location.definitionComparisonKey ?? location.definitionText ?? 'null';
}

function buildMcpExpectedLocation(
  owner: McpOwnerRecord,
  transport: McpConfiguredTransportKind | undefined,
): McpExpectedLocationRecord {
  const unsupportedTransport = transport && !isMcpTransportSupportedByOwner(owner, transport)
    ? transport
    : undefined;

  return {
    agentId: owner.agentId,
    agentLabel: owner.agentLabel,
    scope: owner.scope,
    configPath: owner.configPath,
    ...(unsupportedTransport
      ? {
          supportStatus: 'unsupported' as const,
          unsupportedReason: getMcpUnsupportedReason(owner, unsupportedTransport),
          unsupportedTransport,
        }
      : {}),
  };
}

function getMcpUnsupportedReason(
  owner: Pick<McpOwnerRecord, 'mcpSupportedTransports'>,
  unsupportedTransport: McpConfiguredTransportKind,
): NonNullable<McpExpectedLocationRecord['unsupportedReason']> {
  const supportedTransports = owner.mcpSupportedTransports ?? [];
  const supportsAnyRemoteTransport = supportedTransports.some(isRemoteMcpTransport);

  return isRemoteMcpTransport(unsupportedTransport) && !supportsAnyRemoteTransport
    ? 'remote-mcp-not-supported'
    : 'transport-not-supported';
}

function getMcpRecordTransport(locations: McpLocationRecord[]): McpConfiguredTransportKind | undefined {
  const transports = [...new Set(locations
    .map((location) => location.transport)
    .filter((transport): transport is McpConfiguredTransportKind => isMcpConfiguredTransportKind(transport)))];

  if (transports.length === 1) {
    return transports[0];
  }

  const remoteTransports = transports.filter(isRemoteMcpTransport);
  return remoteTransports.length === transports.length && remoteTransports.length > 0
    ? remoteTransports[0]
    : undefined;
}

function isMcpTransportSupportedByOwner(
  owner: Pick<McpOwnerRecord, 'mcpSupportedTransports'>,
  transport: McpTransportKind | undefined,
): boolean {
  if (!isMcpConfiguredTransportKind(transport)) {
    return true;
  }

  return !owner.mcpSupportedTransports || owner.mcpSupportedTransports.includes(transport);
}

function collectMcpOwners(agents: AgentRecord[], sources: SkillScanSource[], plugins: PluginRecord[] = []): McpOwnerRecord[] {
  const owners: McpOwnerRecord[] = [];

  for (const source of sources) {
    const configPath = getSharedMcpConfigPath(source);
    if (!configPath) {
      continue;
    }
    const configExists = fileExistsSync(configPath);
    if (!configExists) {
      continue;
    }

    owners.push({
      agentId: source.id,
      agentLabel: source.label,
      scope: source.scope,
      configPath,
      configExists,
      parseable: true,
      parserKind: 'json-servers',
      universal: true,
    });
  }

  for (const agent of agents) {
    if (agent.installState !== 'installed' || agent.mcpConfigLocation.state !== 'available' || !agent.mcpConfigLocation.path) {
      continue;
    }

    owners.push({
      agentId: agent.id,
      agentLabel: agent.label,
      family: agent.family,
      scope: agent.scope,
      configPath: agent.mcpConfigLocation.path,
      configExists: agent.mcpConfigLocation.exists,
      parseable: isSupportedMcpParserKind(agent.mcpParserKind ?? 'json-servers'),
      parserKind: agent.mcpParserKind ?? 'json-servers',
      mcpSupportedTransports: agent.mcpSupportedTransports,
    });
  }

  for (const plugin of plugins) {
    const sourceId = createPluginMcpOwnerId(plugin);
    const pluginSource: PluginSourceRef = {
      host: plugin.host,
      pluginId: plugin.pluginId,
      pluginName: plugin.pluginName,
      version: plugin.version,
      rootPath: plugin.rootPath,
      manifestPath: plugin.manifestPath,
      enabled: plugin.enabled,
    };
    const configPaths = [...new Set(plugin.bundledMcps.map((mcp) => mcp.configPath))];

    for (const configPath of configPaths) {
      owners.push({
        agentId: sourceId,
        agentLabel: `${plugin.host === 'codex' ? 'Codex' : 'Claude'} Plugin ${plugin.pluginName}`,
        scope: plugin.scope ?? 'live',
        configPath,
        configExists: fileExistsSync(configPath),
        parseable: true,
        parserKind: 'jsonc-mcpServers',
        plugin: pluginSource,
      });
    }
  }

  return owners.sort((left, right) => left.agentLabel.localeCompare(right.agentLabel, undefined, { sensitivity: 'base' }));
}

function createPluginMcpOwnerId(plugin: Pick<PluginRecord, 'host' | 'pluginId' | 'version' | 'scope'>): string {
  const scopePrefix = plugin.scope === 'sandbox' ? 'sandbox:' : '';
  return `plugin:${scopePrefix}${plugin.host}:${plugin.pluginId}:${plugin.version ?? 'unknown'}`;
}

async function readMcpConfig(owner: McpOwnerRecord): Promise<ParsedMcpConfigResult> {
  if (!isSupportedMcpParserKind(owner.parserKind)) {
    return {
      entries: [],
      configIssue: null,
      owner: {
        ...owner,
        parseable: false,
      },
    };
  }

  if (!owner.configExists) {
    return {
      entries: [],
      configIssue: null,
      owner: {
        ...owner,
        parseable: true,
      },
    };
  }

  try {
    const raw = await readFile(owner.configPath as string, 'utf8');
    const definitions = parseMcpDefinitions(raw, owner.parserKind, {
      allowPluginRootDefinitions: Boolean(owner.plugin),
    });
    if (!isRecord(definitions)) {
      return {
        entries: [],
        owner: {
          ...owner,
          parseable: false,
        },
        configIssue: buildInvalidMcpConfigRecord(
          owner,
          `Unsupported MCP config structure for parser "${owner.parserKind}".`,
        ),
      };
    }

    const entries = Object.entries(definitions)
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([name, definition]) => buildMcpEntry(name, definition, owner));

    return {
      entries,
      configIssue: null,
      owner: {
        ...owner,
        parseable: true,
      },
    };
  } catch (error) {
    return {
      entries: [],
      owner: {
        ...owner,
        parseable: false,
      },
      configIssue: buildInvalidMcpConfigRecord(
        owner,
        error instanceof Error ? error.message : 'Skill Index could not parse this MCP config.',
      ),
    };
  }
}

function isSupportedMcpParserKind(parserKind: AgentMcpParserKind): boolean {
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

function parseMcpDefinitions(
  raw: string,
  parserKind: AgentMcpParserKind,
  options: { allowPluginRootDefinitions?: boolean } = {},
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
      return getMcpDefinitionsField(parsed, 'servers');
    case 'json-mcpServers':
    case 'jsonc-mcpServers':
      return getMcpDefinitionsField(parsed, 'mcpServers')
        ?? (options.allowPluginRootDefinitions ? getPluginMcpDefinitions(parsed) : null);
    case 'json-mcp':
    case 'jsonc-mcp':
    case 'jsonc-opencode-mcp':
      return getMcpDefinitionsField(parsed, 'mcp');
    case 'jsonc-dotted-amp-mcpServers':
      return getMcpDefinitionsField(parsed, 'amp.mcpServers');
    case 'jsonc-dotted-zencoder-mcpServers':
      return getMcpDefinitionsField(parsed, 'zencoder.mcpServers');
    case 'jsonc-mcp-servers':
      return getNestedMcpDefinitionsField(parsed, ['mcp', 'servers']);
    default:
      return null;
  }
}

function isJsoncMcpParserKind(parserKind: AgentMcpParserKind): boolean {
  return parserKind === 'jsonc-mcpServers'
    || parserKind === 'jsonc-mcp'
    || parserKind === 'jsonc-dotted-amp-mcpServers'
    || parserKind === 'jsonc-dotted-zencoder-mcpServers'
    || parserKind === 'jsonc-mcp-servers'
    || parserKind === 'jsonc-opencode-mcp';
}

function getMcpDefinitionsField(parsed: McpDefinitionObject, field: string): McpServerDefinitions | null {
  const definitions = parsed[field];
  return isMcpServerDefinitions(definitions) ? definitions : null;
}

function getPluginMcpDefinitions(parsed: McpDefinitionObject): McpServerDefinitions | null {
  return getMcpDefinitionsField(parsed, 'servers')
    ?? getMcpDefinitionsField(parsed, 'mcp')
    ?? (isMcpServerDefinitions(parsed) ? parsed : null);
}

function getNestedMcpDefinitionsField(parsed: McpDefinitionObject, pathSegments: string[]): McpServerDefinitions | null {
  let current: McpDefinitionValue | undefined = parsed;

  for (const segment of pathSegments) {
    if (!isMcpDefinitionObject(current)) {
      return null;
    }
    current = current[segment];
  }

  return isMcpServerDefinitions(current) ? current : null;
}

function buildMcpEntry(name: string, definition: McpDefinitionValue, owner: McpOwnerRecord): ParsedMcpEntry {
  const invalidDetails: string[] = [];
  const normalizedDefinition: McpDefinitionObject = isMcpDefinitionObject(definition) ? definition : {};
  const comparableDefinition = normalizeMcpDefinitionForParser(normalizedDefinition, owner.parserKind);
  const definitionText = stableStringify(normalizedDefinition, true);

  if (!isMcpDefinitionObject(definition)) {
    invalidDetails.push('Unsupported server definition. Expected an object.');
  }

  const connection = resolveMcpConnection(normalizedDefinition);
  invalidDetails.push(...connection.invalidDetails);

  const args = getMcpDefinitionArgs(normalizedDefinition);
  const splitDefinition = splitMcpDefinitionForComparison(comparableDefinition, connection);
  const coreComparisonKey = stableStringify(splitDefinition.core);
  const nativeComparisonKey = stableStringify(splitDefinition.native);

  const invalidText = invalidDetails.length > 0 ? invalidDetails.join(' ') : undefined;

  return {
    name,
    definition: normalizedDefinition,
    location: {
      agentId: owner.agentId,
      agentLabel: owner.agentLabel,
      scope: owner.scope,
      configPath: owner.configPath as string,
      configName: name,
      transport: connection.transport,
      command: connection.command,
      url: connection.url,
      args,
      definitionText,
      definitionComparisonKey: stableStringify({
        agentLocal: splitDefinition.agentLocal,
        core: splitDefinition.core,
        native: splitDefinition.native,
      }),
      coreDefinitionComparisonKey: coreComparisonKey,
      nativeDefinitionComparisonKey: nativeComparisonKey,
      portableDefinition: splitDefinition.core,
      nativeDefinition: splitDefinition.native,
      agentLocal: splitDefinition.agentLocal,
      agentLocalKey: owner.family,
      invalidDetails: invalidText ? [invalidText] : undefined,
      provenance: owner.plugin
        ? {
            kind: 'plugin',
            plugin: {
              host: owner.plugin.host,
              pluginId: owner.plugin.pluginId,
              version: owner.plugin.version,
            },
            sourcePath: owner.configPath,
            discoveredAt: new Date().toISOString(),
          }
        : {
            kind: owner.universal ? 'universal' : 'agent-local',
            sourcePath: owner.configPath,
            discoveredAt: new Date().toISOString(),
          },
      canonicalRole: owner.plugin ? 'managed-source' : owner.universal ? 'canonical' : 'materialized-copy',
      mutability: owner.plugin ? 'read-only-managed' : 'writable',
    },
  };
}

function getPluginConfigNameForRecord(name: string, locations: McpLocationRecord[]): string | null {
  const pluginLocation = locations.find((location) =>
    location.agentId.startsWith('plugin:') && location.configName);
  if (!pluginLocation?.configName) {
    return null;
  }

  return name.includes(':') ? pluginLocation.configName : null;
}

function createMcpSignature(
  name: string,
  locations: McpLocationRecord[],
  expectedLocations: McpExpectedLocationRecord[] = [],
  missingLocations: McpExpectedLocationRecord[] = [],
): string {
  return JSON.stringify({
    name,
    locations: locations.map((location) => ({
      agentId: location.agentId,
      configPath: location.configPath,
      command: location.command ?? null,
      args: location.args,
      definitionComparisonKey: getMcpDefinitionComparisonKey(location),
      invalidDetails: location.invalidDetails ?? [],
    })),
    expectedLocations,
    missingLocations,
  });
}

function getMcpDefinitionComparisonKey(location: McpLocationRecord): string {
  return getMcpCoreDefinitionComparisonKey(location);
}

function resolveMcpConnection(definition: McpDefinitionObject): ResolvedMcpConnection {
  const command = getMcpDefinitionCommand(definition);
  const url = getMcpDefinitionRemoteUrl(definition);
  const explicitTransport = getExplicitMcpTransport(definition);
  const inferredTransport = explicitTransport.transport ?? inferMcpTransport({
    command,
    url: getNonEmptyString(definition.url),
    httpUrl: getNonEmptyString(definition.httpUrl),
  });
  const invalidDetails: string[] = [];

  if (explicitTransport.invalidDetail) {
    invalidDetails.push(explicitTransport.invalidDetail);
  }

  if (explicitTransport.transport === 'stdio' && !command) {
    invalidDetails.push('Missing command for stdio server.');
  } else if (isRemoteMcpTransport(explicitTransport.transport) && !url) {
    invalidDetails.push('Missing url for remote server.');
  } else if (!command && !url) {
    invalidDetails.push('Missing connection target.');
  }

  return {
    command,
    url,
    transport: inferredTransport,
    invalidDetails,
  };
}

function getNonEmptyString(value: McpDefinitionValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getExplicitMcpTransport(definition: McpDefinitionObject): NormalizedExplicitMcpTransport {
  return normalizeMcpTransport(definition.transport) ?? normalizeMcpTransport(definition.type) ?? {};
}

function inferMcpTransport({
  command,
  url,
  httpUrl,
}: {
  command?: string;
  url?: string;
  httpUrl?: string;
}): McpConfiguredTransportKind | undefined {
  if (command) {
    return 'stdio';
  }

  if (httpUrl) {
    return 'streamable-http';
  }

  if (url) {
    return 'http';
  }

  return undefined;
}

function normalizeMcpTransport(value: McpDefinitionValue | undefined): NormalizedExplicitMcpTransport | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case 'local':
    case 'stdio':
      return { transport: 'stdio' };
    case 'remote':
    case 'http':
      return { transport: 'http' };
    case 'streamable-http':
    case 'streamable_http':
      return { transport: 'streamable-http' };
    case 'sse':
      return { transport: 'sse' };
    default:
      return { invalidDetail: `Unsupported transport "${value.trim()}".` };
  }
}

function isRemoteMcpTransport(transport: McpConfiguredTransportKind | undefined): transport is RemoteMcpTransportKind {
  return transport === 'http' || transport === 'streamable-http' || transport === 'sse';
}

function buildInvalidMcpConfigRecord(owner: McpOwnerRecord, detail: string): McpRecord {
  const location: McpLocationRecord = {
    agentId: owner.agentId,
    agentLabel: owner.agentLabel,
    scope: owner.scope,
    configPath: owner.configPath as string,
    args: [],
    invalidDetails: [detail],
  };

  return {
    name: `${owner.agentLabel} MCP config`,
    status: 'needs-attention',
    presentation: 'active',
    locations: [location],
    expectedLocations: [
      {
        agentId: owner.agentId,
        agentLabel: owner.agentLabel,
        scope: owner.scope,
        configPath: owner.configPath,
      },
    ],
    missingLocations: [],
    issueReasons: ['invalid-definition'],
    signature: createMcpSignature(
      `${owner.agentLabel} MCP config`,
      [location],
      [
        {
          agentId: owner.agentId,
          agentLabel: owner.agentLabel,
          scope: owner.scope,
          configPath: owner.configPath,
        },
      ],
      [],
    ),
  };
}

function getSharedMcpConfigPath(source: SkillScanSource): string | undefined {
  if (!source.canonical) {
    return undefined;
  }

  return path.join(path.dirname(source.skillsDir), 'mcp.json');
}

function fileExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isMcpConfiguredTransportKind(value: unknown): value is McpConfiguredTransportKind {
  return value === 'stdio' || value === 'streamable-http' || value === 'sse' || value === 'http';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
