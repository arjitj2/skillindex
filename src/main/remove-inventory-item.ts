import { lstat } from 'node:fs/promises';
import path from 'node:path';

import type {
  McpLocationRecord,
  RemoveInventoryItemRequest,
  SkillInventorySnapshot,
} from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPaths,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import {
  getDefaultMcpWriteDialect,
  isSupportedWritableMcpParser,
  readWritableMcpDefinitions,
  writeMcpDefinitions,
  type McpMutationTarget,
} from '@main/issue-resolution';
import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';

export interface RemoveInventoryItemOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
  trashItem?: TrashItem;
}

interface McpRemovalTarget extends McpMutationTarget {
  definitionNames: Set<string>;
}

type TrashItem = (targetPath: string) => Promise<void>;

export async function removeInventoryItem(
  request: RemoveInventoryItemRequest,
  options: RemoveInventoryItemOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const snapshot = await scanInventory({
    ...options,
    paths,
  });

  if (request.entity === 'skill') {
    await removeSkillFromAllLocations(snapshot, request.skillName, options.trashItem ?? trashPathWithElectron);
  } else if (request.entity === 'mcp') {
    await removeMcpFromAllLocations(snapshot, request.mcpName);
  } else {
    await removeSubagentFromAllLocations(snapshot, request.subagentName, options.trashItem ?? trashPathWithElectron);
  }

  return scanInventory({
    ...options,
    paths,
  });
}

async function removeSkillFromAllLocations(
  snapshot: SkillInventorySnapshot,
  skillName: string,
  trashItem: TrashItem,
): Promise<void> {
  const skill = snapshot.skills.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Skill "${skillName}" was not found in the current inventory.`);
  }

  await removePaths(skill.locations.map((location) => location.path), `Skill "${skillName}"`, trashItem);
}

async function removeSubagentFromAllLocations(
  snapshot: SkillInventorySnapshot,
  subagentName: string,
  trashItem: TrashItem,
): Promise<void> {
  const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === subagentName);
  if (!subagent) {
    throw new Error(`Subagent "${subagentName}" was not found in the current inventory.`);
  }

  await removePaths(subagent.locations.map((location) => location.path), `Subagent "${subagentName}"`, trashItem);
}

async function removePaths(paths: string[], entityLabel: string, trashItem: TrashItem): Promise<void> {
  const uniquePaths = dedupePaths(paths);
  if (uniquePaths.length === 0) {
    throw new Error(`${entityLabel} has no removable locations.`);
  }

  await Promise.all(uniquePaths.map((targetPath) => trashExistingPath(targetPath, trashItem)));
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

async function removeMcpFromAllLocations(snapshot: SkillInventorySnapshot, mcpName: string): Promise<void> {
  const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === mcpName);
  if (!mcp) {
    throw new Error(`MCP "${mcpName}" was not found in the current inventory.`);
  }

  const targets = collectMcpRemovalTargets(snapshot, mcp.locations, mcpName);
  if (targets.length === 0) {
    throw new Error(`MCP "${mcpName}" has no removable config locations.`);
  }

  await Promise.all(targets.map(async (target) => {
    const definitions = await readWritableMcpDefinitions(target);
    let changed = false;

    for (const definitionName of target.definitionNames) {
      if (Object.prototype.hasOwnProperty.call(definitions, definitionName)) {
        delete definitions[definitionName];
        changed = true;
      }
    }

    if (changed) {
      await writeMcpDefinitions(target.configPath, target.parserKind, definitions, target.writeDialect);
    }
  }));
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
  if (location.agentId.startsWith('plugin:') || location.provenance?.kind === 'plugin') {
    return {
      agentId: location.agentId,
      configPath: location.configPath,
      parserKind: 'jsonc-mcpServers',
      writeDialect: 'json-type-url',
    };
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
