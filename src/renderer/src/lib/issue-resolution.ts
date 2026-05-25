import type {
  McpResolvableIssue,
  McpRecord,
  ResolveIssueRequest,
  SkillInventorySnapshot,
  AgentMcpParserKind,
  SkillIssueReason,
  SkillRecord,
  SkillResolvableIssue,
  SkillScanSource,
} from '@shared/contracts';

import type { InspectorModel } from './detail-inspector-model';
import { getDisplaySkillIssueReasons } from './inventory-presentation';
import { getSkillAccessState } from '../inventory-view-model';

export interface ResolveActionState {
  disabledReason: string | null;
  request: ResolveIssueRequest | null;
}

const SKILL_RESOLVABLE_ISSUES = new Set([
  'missing-symlinks',
  'missing-canonical',
  'identical-copies',
  'diverged-copies',
  'broken-symlink',
  'wrong-symlink-target',
] as const);

const MCP_RESOLVABLE_ISSUES = new Set([
  'definition-mismatch',
  'missing-from-agents',
] as const);

export function getSkillResolveActionState(
  skill: SkillRecord,
  inspectorModel: InspectorModel | null,
  sourceIndex: Map<string, SkillScanSource>,
): ResolveActionState {
  const activeProblem = inspectorModel?.activeProblem ?? null;
  if (!activeProblem || !activeProblem.primaryActionLabel || !isSkillResolvableIssue(activeProblem.key)) {
    return {
      disabledReason: null,
      request: null,
    };
  }

  const accessState = getSkillAccessState(skill, sourceIndex);
  const readOnlyBlocker = getReadOnlyNonPluginSource(skill, sourceIndex);
  if (accessState && readOnlyBlocker) {
    return {
      disabledReason: readOnlyBlocker.detailMessage,
      request: null,
    };
  }

  const selectedVariantPath = getSkillSelectedVariantPath(skill, inspectorModel?.selectedVariantPath ?? null, activeProblem.key);
  const requiresVariantSelection = activeProblem.key === 'diverged-copies'
    || activeProblem.key === 'missing-canonical'
    || ((activeProblem.key === 'missing-symlinks'
      || activeProblem.key === 'broken-symlink'
      || activeProblem.key === 'wrong-symlink-target')
      && !hasCanonicalRealFile(skill));

  if (requiresVariantSelection && !selectedVariantPath) {
    return {
      disabledReason: 'Choose a skill version before resolving this issue.',
      request: null,
    };
  }

  return {
    disabledReason: null,
    request: {
      entity: 'skill',
      issue: activeProblem.key,
      skillName: skill.name,
      selectedVariantPath: selectedVariantPath ?? undefined,
    },
  };
}

export function getMcpResolveActionState(
  mcp: McpRecord,
  inspectorModel: InspectorModel | null,
  snapshot: SkillInventorySnapshot | null,
): ResolveActionState {
  const activeProblem = inspectorModel?.activeProblem ?? null;
  if (!activeProblem || !activeProblem.primaryActionLabel || !isMcpResolvableIssue(activeProblem.key)) {
    return {
      disabledReason: null,
      request: null,
    };
  }

  if (!snapshot) {
    return {
      disabledReason: 'MCP inventory is still loading.',
      request: null,
    };
  }

  const targetLocations = activeProblem.key === 'definition-mismatch'
    ? mcp.locations
    : mcp.missingLocations ?? [];
  const targetableLocations = targetLocations.filter((location) => isWritableSupportedMcpTarget(location, snapshot));
  const blockedTarget = activeProblem.key === 'definition-mismatch'
    ? targetableLocations.length === 0
    : targetableLocations.length !== targetLocations.length;

  if (blockedTarget) {
    return {
      disabledReason: 'This MCP can only be resolved when every target config is writable and uses a supported format.',
      request: null,
    };
  }

  const selectedVariantPath = getMcpSelectedVariantPath(mcp, inspectorModel?.selectedVariantPath ?? null);
  const requiresVariantSelection = activeProblem.key === 'definition-mismatch'
    || ((activeProblem.key === 'missing-from-agents') && getDistinctMcpVariantCount(mcp) > 1);

  if (requiresVariantSelection && !selectedVariantPath) {
    return {
      disabledReason: 'Choose an MCP definition before resolving this issue.',
      request: null,
    };
  }

  return {
    disabledReason: null,
    request: {
      entity: 'mcp',
      issue: activeProblem.key,
      mcpName: mcp.name,
      selectedVariantPath: selectedVariantPath ?? undefined,
    },
  };
}

function isWritableSupportedMcpTarget(
  location: McpRecord['locations'][number] | NonNullable<McpRecord['missingLocations']>[number],
  snapshot: SkillInventorySnapshot,
): boolean {
  if (!location.configPath) {
    return false;
  }

  const source = snapshot.sources.find((entry) => entry.id === location.agentId);
  if (source) {
    return source.writable;
  }

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === location.agentId);
  return Boolean(
    agent
    && agent.writable
    && agent.mcpConfigLocation.state === 'available'
    && SUPPORTED_MCP_PARSER_KINDS.has((agent.mcpParserKind ?? 'json-servers') as never),
  );
}

function hasCanonicalRealFile(skill: SkillRecord): boolean {
  return skill.locations.some((location) => location.canonical && location.fileType === 'real-file');
}

function getReadOnlyNonPluginSource(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
): { detailMessage: string } | null {
  const hasReadOnlyNonPluginSource = skill.locations.some((location) => {
    const source = sourceIndex.get(location.sourceId);
    return source !== undefined && !source.writable && source.kind !== 'plugin';
  });

  return hasReadOnlyNonPluginSource
    ? { detailMessage: 'This skill is read-only right now. You need writable non-plugin locations before using it as Universal.' }
    : null;
}

function canRepairReadOnlyPluginLinks(skill: SkillRecord, issue: SkillIssueReason): boolean {
  if (issue !== 'missing-symlinks' && issue !== 'broken-symlink' && issue !== 'wrong-symlink-target') {
    return false;
  }

  return skill.locations.some((location) =>
    location.provenance?.kind === 'plugin'
    && location.fileType === 'real-file'
    && location.canonical);
}

function getSkillSelectedVariantPath(
  skill: SkillRecord,
  selectedVariantPath: string | null,
  issue: SkillIssueReason,
): string | null {
  if (selectedVariantPath && skill.locations.some((location) => location.path === selectedVariantPath)) {
    return selectedVariantPath;
  }

  if (canRepairReadOnlyPluginLinks(skill, issue)) {
    const pluginCanonicalLocation = skill.locations
      .filter((location) =>
        location.fileType === 'real-file'
        && location.provenance?.kind === 'plugin'
        && location.canonical)
      .sort((left, right) => left.path.localeCompare(right.path))[0];
    if (pluginCanonicalLocation) {
      return pluginCanonicalLocation.path;
    }
  }

  const realFileLocations = skill.locations.filter((location) => location.fileType === 'real-file');
  const groups = new Map<string, string[]>();
  for (const location of realFileLocations) {
    const key = location.contentHash
      ? `hash:${location.contentHash}`
      : location.definitionText
        ? `text:${location.definitionText}`
        : `path:${location.path}`;
    const existing = groups.get(key) ?? [];
    existing.push(location.path);
    groups.set(key, existing);
  }

  return groups.size === 1 ? realFileLocations[0]?.path ?? null : null;
}

function getMcpSelectedVariantPath(mcp: McpRecord, selectedVariantPath: string | null): string | null {
  if (selectedVariantPath && mcp.locations.some((location) => location.configPath === selectedVariantPath)) {
    return selectedVariantPath;
  }

  return getDistinctMcpVariantCount(mcp) === 1 ? mcp.locations[0]?.configPath ?? null : null;
}

function getDistinctMcpVariantCount(mcp: McpRecord): number {
  return new Set(mcp.locations.map((location) =>
    location.definitionComparisonKey ?? location.definitionText ?? `path:${location.configPath}`)).size;
}

const SUPPORTED_MCP_PARSER_KINDS = new Set([
  'json-servers',
  'json-mcpServers',
  'json-mcp',
  'jsonc-mcpServers',
  'jsonc-mcp',
  'jsonc-dotted-amp-mcpServers',
  'jsonc-dotted-zencoder-mcpServers',
  'jsonc-mcp-servers',
  'jsonc-opencode-mcp',
  'toml',
  'toml-mcpServers-array',
] satisfies AgentMcpParserKind[]);

function isSkillResolvableIssue(value: string): value is SkillResolvableIssue {
  return SKILL_RESOLVABLE_ISSUES.has(value as SkillResolvableIssue);
}

function isMcpResolvableIssue(value: string): value is McpResolvableIssue {
  return MCP_RESOLVABLE_ISSUES.has(value as McpResolvableIssue);
}

const AUTO_RESOLVABLE_ISSUES: Set<SkillIssueReason> = new Set([
  'missing-symlinks',
  'identical-copies',
  'missing-canonical',
  'broken-symlink',
]);

export function getAutoResolvableSkillRequests(
  snapshot: SkillInventorySnapshot,
  sourceIndex: Map<string, SkillScanSource>,
): ResolveIssueRequest[] {
  const requests: ResolveIssueRequest[] = [];

  for (const skill of snapshot.skills) {
    if (skill.driftPresentation !== 'active') {
      continue;
    }

    const accessState = getSkillAccessState(skill, sourceIndex);
    if (accessState) {
      continue;
    }

    const issueReasons = getDisplaySkillIssueReasons(skill);

    for (const reason of issueReasons) {
      if (!AUTO_RESOLVABLE_ISSUES.has(reason)) {
        continue;
      }

      const requiresVariantSelection = reason === 'missing-canonical'
        || ((reason === 'missing-symlinks' || reason === 'broken-symlink') && !hasCanonicalRealFile(skill));

      const selectedVariantPath = getSkillSelectedVariantPath(skill, null, reason);

      if (requiresVariantSelection && !selectedVariantPath) {
        continue;
      }

      requests.push({
        entity: 'skill',
        issue: reason as SkillResolvableIssue,
        skillName: skill.name,
        selectedVariantPath: selectedVariantPath ?? undefined,
      });
    }
  }

  return requests;
}

export function getAutoResolvableMcpRequests(
  snapshot: SkillInventorySnapshot,
): ResolveIssueRequest[] {
  const requests: ResolveIssueRequest[] = [];

  for (const mcp of snapshot.mcps ?? []) {
    if (mcp.presentation !== 'active' || !mcp.issueReasons.includes('missing-from-agents')) {
      continue;
    }

    const targetLocations = mcp.missingLocations ?? [];
    if (targetLocations.length === 0) {
      continue;
    }

    const targetableLocations = targetLocations.filter((location) => isWritableSupportedMcpTarget(location, snapshot));
    if (targetableLocations.length !== targetLocations.length) {
      continue;
    }

    const selectedVariantPath = getMcpSelectedVariantPath(mcp, null);
    if (getDistinctMcpVariantCount(mcp) > 1 && !selectedVariantPath) {
      continue;
    }

    requests.push({
      entity: 'mcp',
      issue: 'missing-from-agents',
      mcpName: mcp.name,
      selectedVariantPath: selectedVariantPath ?? undefined,
    });
  }

  return requests;
}
