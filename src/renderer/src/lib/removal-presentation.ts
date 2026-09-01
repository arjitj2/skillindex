import type { RemoveInventoryItemRequest, SkillInventorySnapshot } from '@shared/contracts';

export interface InventoryRemovalPresentation {
  canRemove: boolean;
  preservesPluginSource: boolean;
}

interface RemovalLocation {
  agentId?: string;
  canonical?: boolean;
  canonicalRole?: string;
  configPath?: string;
  mutability?: string;
  path?: string;
  provenance?: { kind?: string };
  sourceId?: string;
}

export function getInventoryRemovalPresentation(
  snapshot: SkillInventorySnapshot | null,
  request: RemoveInventoryItemRequest,
): InventoryRemovalPresentation {
  const locations = getLocations(snapshot, request);
  return {
    canRemove: locations.some((location) => isWritableOperationalLocation(snapshot, location)),
    preservesPluginSource: locations.some(isPluginManagedLocation),
  };
}

export function hasInventoryItem(snapshot: SkillInventorySnapshot, request: RemoveInventoryItemRequest): boolean {
  if (request.entity === 'skill') return snapshot.skills.some((skill) => skill.name === request.skillName);
  if (request.entity === 'mcp') return (snapshot.mcps ?? []).some((mcp) => mcp.name === request.mcpName);
  return (snapshot.subagents ?? []).some((subagent) => subagent.name === request.subagentName);
}

function getLocations(snapshot: SkillInventorySnapshot | null, request: RemoveInventoryItemRequest): RemovalLocation[] {
  if (!snapshot) return [];
  if (request.entity === 'skill') {
    return snapshot.skills.find((skill) => skill.name === request.skillName)?.locations ?? [];
  }
  if (request.entity === 'mcp') {
    return (snapshot.mcps ?? []).find((mcp) => mcp.name === request.mcpName)?.locations ?? [];
  }
  return (snapshot.subagents ?? []).find((subagent) => subagent.name === request.subagentName)?.locations ?? [];
}

function isWritableOperationalLocation(snapshot: SkillInventorySnapshot | null, location: RemovalLocation): boolean {
  if (isPluginManagedLocation(location)) return false;
  if (location.canonical || location.mutability === 'writable') return true;
  if (snapshot?.sources.find((source) => source.id === location.sourceId)?.writable) return true;
  return snapshot?.agents?.find((agent) => agent.id === location.agentId)?.writable === true;
}

function isPluginManagedLocation(location: RemovalLocation): boolean {
  const targetPath = location.path ?? location.configPath ?? '';
  return location.canonicalRole === 'managed-source'
    || location.provenance?.kind === 'plugin'
    || location.mutability === 'read-only-managed'
    || /(?:^|[/\\])\.(?:codex|claude)[/\\]plugins(?:[/\\]|$)/i.test(targetPath);
}
