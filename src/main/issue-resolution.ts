import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AddMcpServerRequest,
  AgentRecord,
  AgentMcpWriteDialect,
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
} from '@shared/contracts';
import { buildPortableMcpDefinition, isMcpDefinitionObject, isMcpServerDefinitions } from '@shared/mcp-definition';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPaths,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';
import {
  parseTomlMcpServerArray,
  parseTomlMcpServers,
  updateTomlMcpServerArray,
  updateTomlMcpServers,
} from '@shared/toml-mcp';

import { sanitizeJsonc, sortRecordValue } from '@main/json-utils';
import { makeSkillCanonical } from '@main/skill-canonicalization';
import { scanSkillInventory, type ScanSkillInventoryOptions } from '@main/skill-inventory';
import { persistSkillUniversalDecisionForSelection } from '@main/skill-universal-decisions';

export interface ResolveIssueOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
}

interface McpMutationTarget {
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
  writeDialect: AgentMcpWriteDialect;
}

interface CanonicalSkillPackage {
  path: string;
  location: SkillLocationRecord;
}

export async function resolveInventoryIssue(
  request: ResolveIssueRequest,
  options: ResolveIssueOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const snapshot = await scanSkillInventory({
    ...options,
    paths,
  });

  assertResolutionIssueIsCurrent(snapshot, request);

  if (request.entity === 'skill') {
    await resolveSkillIssueIfCurrent(snapshot, request, {
      ...options,
      paths,
    });
  } else {
    await resolveMcpIssueIfCurrent(snapshot, request);
  }

  const nextSnapshot = await scanSkillInventory({
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

  const snapshot = await scanSkillInventory({
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

  return scanSkillInventory({
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

  const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
  if (!mcp) {
    throw new Error(`MCP "${request.mcpName}" was not found in the current inventory.`);
  }

  if (!mcp.issueReasons.includes(request.issue)) {
    throw new Error(`MCP "${request.mcpName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
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

  const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
  if (mcp && mcp.issueReasons.includes(request.issue)) {
    throw new Error(`MCP "${request.mcpName}" still has ${formatIssueLabel(request.issue)} after resolution.`);
  }
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
      const selectedSourcePath = pickSkillRealFileSelectionPath(skill, request.selectedVariantPath, {
        requireSelectionOnAmbiguous: true,
      });
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
): Promise<void> {
  const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
  if (!mcp) {
    throw new Error(`MCP "${request.mcpName}" was not found in the current inventory.`);
  }

  if (!mcp.issueReasons.includes(request.issue)) {
    throw new Error(`MCP "${request.mcpName}" no longer has ${formatIssueLabel(request.issue)}. Refresh inventory and try again if it still needs attention.`);
  }

  const selectedVariant = pickMcpSelection(mcp.locations, request.selectedVariantPath, {
    requireSelectionOnAmbiguous: request.issue === 'definition-mismatch',
  });
  const selectedDefinition = parseSelectedMcpDefinition(selectedVariant);
  const targetLocations = request.issue === 'definition-mismatch'
    ? mcp.locations
    : mcp.missingLocations ?? [];
  const mutationTargets = targetLocations
    .map((location) => buildWritableMcpMutationTarget(snapshot, location.agentId, location.configPath))
    .filter((target): target is McpMutationTarget => target !== null);

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
      target.definitions[definitionName] = selectedDefinition;
      await writeMcpDefinitions(target.configPath, target.parserKind, target.definitions, target.writeDialect);
    }),
  );
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

  const selectedSourcePath = pickSkillRealFileSelectionPath(skill, selectedVariantPath, {
    requireSelectionOnAmbiguous: true,
  });
  const selectedLocation = skill.locations.find((location) => location.path === selectedSourcePath && location.fileType === 'real-file');
  if (!selectedLocation) {
    throw new Error('Choose a real-file skill version before repairing links.');
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
  options: { requireSelectionOnAmbiguous: boolean },
): string {
  const realFileLocations = skill.locations.filter((location) => location.fileType === 'real-file');
  if (realFileLocations.length === 0) {
    throw new Error(`Skill "${skill.name}" has no readable real-file definitions to use for resolution.`);
  }

  if (selectedVariantPath) {
    const selectedLocation = realFileLocations.find((location) => location.path === selectedVariantPath);
    if (!selectedLocation) {
      throw new Error('Choose one of the available real-file skill versions before resolving this issue.');
    }

    return selectedLocation.path;
  }

  const groups = groupSkillRealFiles(realFileLocations);
  if (groups.length === 1) {
    return groups[0][0].path;
  }

  if (options.requireSelectionOnAmbiguous) {
    throw new Error('Choose a skill version before resolving this issue.');
  }

  return realFileLocations[0].path;
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
  options: { requireSelectionOnAmbiguous: boolean },
): McpLocationRecord {
  if (locations.length === 0) {
    throw new Error('Choose an MCP definition before resolving this issue.');
  }

  if (selectedVariantPath) {
    const selectedLocation = locations.find((location) => location.configPath === selectedVariantPath);
    if (!selectedLocation) {
      throw new Error('Choose one of the available MCP definitions before resolving this issue.');
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

  if (options.requireSelectionOnAmbiguous) {
    throw new Error('Choose an MCP definition before resolving this issue.');
  }

  return locations[0];
}

function parseSelectedMcpDefinition(location: McpLocationRecord): McpServerDefinition {
  if (!location.definitionText) {
    return buildPortableMcpDefinition({
      ...(location.command ? { command: location.command } : {}),
      ...(location.args.length > 0 ? { args: location.args } : {}),
    }, location);
  }

  const parsed = JSON.parse(location.definitionText) as unknown;
  if (!isMcpDefinitionObject(parsed)) {
    throw new Error('Choose an MCP definition with a supported object structure before resolving this issue.');
  }

  return buildPortableMcpDefinition(parsed, location);
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

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === agentId);
  if (agent && !agent.writable) {
    return null;
  }

  const source = snapshot.sources.find((entry) => entry.id === agentId);
  if (source && !source.writable) {
    return null;
  }

  return buildMcpMutationTarget(snapshot, agentId, configPath);
}

async function readWritableMcpDefinitions(target: McpMutationTarget): Promise<McpServerDefinitions> {
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

async function writeMcpDefinitions(
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

function isSupportedWritableMcpParser(parserKind: string): parserKind is McpMutationTarget['parserKind'] {
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

function getDefaultMcpWriteDialect(parserKind: McpMutationTarget['parserKind']): AgentMcpWriteDialect {
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
