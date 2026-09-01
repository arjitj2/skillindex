import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  CanonicalRole,
  McpLocationRecord,
  RemoveInventoryItemRequest,
  SkillInventorySnapshot,
} from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPathsForScanOptions,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import {
  getDefaultMcpWriteDialect,
  isSupportedWritableMcpParser,
  readWritableMcpDefinitions,
  writeMcpDefinitionsTransaction,
  type McpMutationTarget,
} from '@main/issue-resolution';
import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';

export interface RemoveInventoryItemOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
  preparedSnapshot?: SkillInventorySnapshot;
  trashItem?: TrashItem;
  /** Test-only deterministic failure point for staged MCP config mutations. */
  testFailMcpMutationAt?: number;
  /** Test-only failure immediately before an MCP config's atomic commit. */
  testFailMcpCommitAt?: number;
}

interface McpRemovalTarget extends McpMutationTarget {
  definitionNames: Set<string>;
}

type TrashItem = (targetPath: string) => Promise<void>;

export async function removeInventoryItem(
  request: RemoveInventoryItemRequest,
  options: RemoveInventoryItemOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPathsForScanOptions(options);
  await ensureSkillIndexLayout(paths);

  const scanOptions = { ...options };
  delete scanOptions.preparedSnapshot;
  delete scanOptions.trashItem;
  delete scanOptions.testFailMcpMutationAt;
  delete scanOptions.testFailMcpCommitAt;
  const snapshot = options.preparedSnapshot ?? await scanInventory({
    ...scanOptions,
    paths,
  });

  if (request.entity === 'skill') {
    await removeSkillFromAllLocations(snapshot, request.skillName, paths, options.trashItem ?? trashPathWithElectron);
  } else if (request.entity === 'mcp') {
    await removeMcpFromAllLocations(snapshot, request.mcpName, options);
  } else {
    await removeSubagentFromAllLocations(snapshot, request.subagentName, paths, options.trashItem ?? trashPathWithElectron);
  }

  return scanInventory({
    ...scanOptions,
    paths,
  });
}

async function removeSkillFromAllLocations(
  snapshot: SkillInventorySnapshot,
  skillName: string,
  paths: SkillIndexPaths,
  trashItem: TrashItem,
): Promise<void> {
  const skill = snapshot.skills.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Skill "${skillName}" was not found in the current inventory.`);
  }

  await removePaths(snapshot, paths, skill.locations, `Skill "${skillName}"`, trashItem);
}

async function removeSubagentFromAllLocations(
  snapshot: SkillInventorySnapshot,
  subagentName: string,
  paths: SkillIndexPaths,
  trashItem: TrashItem,
): Promise<void> {
  const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === subagentName);
  if (!subagent) {
    throw new Error(`Subagent "${subagentName}" was not found in the current inventory.`);
  }

  await removePaths(snapshot, paths, subagent.locations, `Subagent "${subagentName}"`, trashItem);
}

interface RemovablePathLocation {
  canonicalRole?: CanonicalRole;
  mutability?: string;
  path: string;
  provenance?: { kind?: string };
}

export function isPluginManagedRemovalLocation(location: RemovablePathLocation): boolean {
  return location.canonicalRole === 'managed-source'
    || location.provenance?.kind === 'plugin'
    || location.mutability === 'read-only-managed'
    || isConventionalPluginCachePath(location.path);
}

async function removePaths(
  snapshot: SkillInventorySnapshot,
  paths: SkillIndexPaths,
  locations: RemovablePathLocation[],
  entityLabel: string,
  trashItem: TrashItem,
): Promise<void> {
  const uniquePaths = dedupePaths(locations
    .filter((location) => !isPluginManagedRemovalLocation(location))
    .map((location) => location.path));
  if (uniquePaths.length === 0) {
    throw new Error(`${entityLabel} has no removable locations.`);
  }

  const removablePaths = (await Promise.all(uniquePaths.map(async (targetPath) =>
    await isSafeRemovalTarget(targetPath, snapshot, paths) ? targetPath : null))).filter((targetPath): targetPath is string => targetPath !== null);
  if (removablePaths.length === 0) {
    throw new Error(`${entityLabel} has no removable locations.`);
  }

  await Promise.all(removablePaths.map((targetPath) => trashExistingPath(targetPath, trashItem)));
}

async function isSafeRemovalTarget(
  targetPath: string,
  snapshot: SkillInventorySnapshot,
  paths: SkillIndexPaths,
): Promise<boolean> {
  const lexicalPath = path.normalize(targetPath);
  const pluginRoots = getPluginRemovalRoots(snapshot, paths);
  if (pluginRoots.some((root) => isPathWithin(root, lexicalPath)) || isConventionalPluginCachePath(lexicalPath)) {
    return false;
  }

  const resolvedPath = await resolvePathThroughNearestExistingParent(lexicalPath);
  const resolvedPluginRoots = await Promise.all(pluginRoots.map(resolvePathThroughNearestExistingParent));
  return !isConventionalPluginCachePath(resolvedPath)
    && !pluginRoots.concat(resolvedPluginRoots).some((root) => isPathWithin(root, resolvedPath));
}

function getPluginRemovalRoots(snapshot: SkillInventorySnapshot, paths: SkillIndexPaths): string[] {
  return [...new Set([
    ...(snapshot.plugins ?? []).map((plugin) => plugin.rootPath),
    ...snapshot.sources.filter((source) => source.kind === 'plugin').map((source) => source.skillsDir),
    path.join(paths.sandboxRoot, '.codex', 'plugins'),
    path.join(paths.sandboxRoot, '.claude', 'plugins'),
    path.join(paths.liveAgentsDir, '..', '.codex', 'plugins'),
    path.join(paths.liveAgentsDir, '..', '.claude', 'plugins'),
  ].map(path.normalize))];
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

async function trashExistingPath(targetPath: string, trashItem: TrashItem): Promise<void> {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }

  await trashItem(targetPath);
}

async function trashPathWithElectron(targetPath: string): Promise<void> {
  const { shell } = await import('electron');
  await shell.trashItem(targetPath);
}

async function removeMcpFromAllLocations(
  snapshot: SkillInventorySnapshot,
  mcpName: string,
  options: Pick<RemoveInventoryItemOptions, 'testFailMcpMutationAt' | 'testFailMcpCommitAt'>,
): Promise<void> {
  const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === mcpName);
  if (!mcp) {
    throw new Error(`MCP "${mcpName}" was not found in the current inventory.`);
  }

  const targets = collectMcpRemovalTargets(snapshot, mcp.locations, mcpName);
  if (targets.length === 0) {
    throw new Error(`MCP "${mcpName}" has no removable config locations.`);
  }

  const updates = await Promise.all(targets.map(async (target) => {
    const definitions = await readWritableMcpDefinitions(target);
    let changed = false;

    for (const definitionName of target.definitionNames) {
      if (Object.prototype.hasOwnProperty.call(definitions, definitionName)) {
        delete definitions[definitionName];
        changed = true;
      }
    }

    return changed ? { ...target, definitions } : null;
  }));
  const mutationUpdates = updates.filter((target) => target !== null);
  await writeMcpDefinitionsTransaction(mutationUpdates, options);
}

function collectMcpRemovalTargets(
  snapshot: SkillInventorySnapshot,
  locations: McpLocationRecord[],
  inventoryMcpName: string,
): McpRemovalTarget[] {
  const targetsByKey = new Map<string, McpRemovalTarget>();

  for (const location of locations) {
    const target = buildMcpRemovalTarget(snapshot, location);
    if (!target) {
      continue;
    }

    const key = [
      path.normalize(target.configPath),
      target.parserKind,
      target.writeDialect,
    ].join('\0');
    const existing = targetsByKey.get(key) ?? {
      ...target,
      definitionNames: new Set<string>(),
    };
    existing.definitionNames.add(getMcpDefinitionNameForRemoval(inventoryMcpName, location));
    targetsByKey.set(key, existing);
  }

  return [...targetsByKey.values()];
}

function buildMcpRemovalTarget(
  snapshot: SkillInventorySnapshot,
  location: McpLocationRecord,
): Omit<McpRemovalTarget, 'definitionNames'> | null {
  if (location.canonicalRole === 'managed-source'
    || location.agentId.startsWith('plugin:')
    || location.provenance?.kind === 'plugin') {
    return null;
  }

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === location.agentId);
  if (agent) {
    const parserKind = agent.mcpParserKind ?? 'json-servers';
    if (!agent.writable || !isSupportedWritableMcpParser(parserKind)) {
      return null;
    }

    return {
      agentId: location.agentId,
      configPath: location.configPath,
      parserKind,
      writeDialect: agent.mcpWriteDialect ?? getDefaultMcpWriteDialect(parserKind),
    };
  }

  const source = snapshot.sources.find((entry) => entry.id === location.agentId);
  if (!source?.writable) {
    return null;
  }

  return {
    agentId: location.agentId,
    configPath: location.configPath,
    parserKind: 'json-servers',
    writeDialect: 'json-type-url',
  };
}

function getMcpDefinitionNameForRemoval(inventoryMcpName: string, location: McpLocationRecord): string {
  if (location.configName) {
    return location.configName;
  }

  if (location.agentId.startsWith('plugin:') && inventoryMcpName.includes(':')) {
    return inventoryMcpName.slice(inventoryMcpName.indexOf(':') + 1);
  }

  return inventoryMcpName;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((targetPath) => {
    const normalizedPath = path.normalize(targetPath);
    if (seen.has(normalizedPath)) {
      return false;
    }

    seen.add(normalizedPath);
    return true;
  });
}
