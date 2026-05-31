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
  SubagentRecord,
  SubagentResolvableIssue,
} from '@shared/contracts';
import {
  isMarkdownSubagentSymlinkCompatible,
  isSupportedSubagentDirectoryFormat,
} from '@shared/subagent-format-policy';

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
  'missing-universal',
  'definition-mismatch',
  'missing-from-agents',
] as const);

const SUBAGENT_RESOLVABLE_ISSUES = new Set([
  'missing-universal',
  'missing-from-agents',
  'definition-mismatch',
  'identical-copies',
  'broken-symlink',
  'wrong-symlink-target',
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

  const issue = activeProblem.key as McpResolvableIssue;
  const targetLocations = getMcpResolutionTargetsForAction(mcp, issue);
  const targetableLocations = targetLocations.filter((location) => isWritableSupportedMcpTarget(location, snapshot));
  const blockedTarget = targetLocations.length > 0 && targetableLocations.length === 0;

  if (blockedTarget) {
    return {
      disabledReason: 'This MCP can only be resolved when every target config is writable and uses a supported format.',
      request: null,
    };
  }

  const selectedVariantPath = getMcpSelectedVariantPath(mcp, inspectorModel?.selectedVariantPath ?? null, issue, snapshot);
  const requiresVariantSelection = issue === 'definition-mismatch'
    || issue === 'missing-universal';

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
      issue,
      mcpName: mcp.name,
      selectedVariantPath: selectedVariantPath ?? undefined,
    },
  };
}

export function getSubagentResolveActionState(
  subagent: SubagentRecord,
  inspectorModel: InspectorModel | null,
  snapshot: SkillInventorySnapshot | null,
): ResolveActionState {
  const activeProblem = inspectorModel?.activeProblem ?? null;
  if (!activeProblem || !activeProblem.primaryActionLabel || !isSubagentResolvableIssue(activeProblem.key)) {
    return {
      disabledReason: null,
      request: null,
    };
  }

  if (!snapshot) {
    return {
      disabledReason: 'Subagent inventory is still loading.',
      request: null,
    };
  }

  const selectedVariantPath = getSubagentSelectedVariantPath(
    subagent,
    inspectorModel?.selectedVariantPath ?? null,
  );
  if (!selectedVariantPath) {
    return {
      disabledReason: 'Choose a subagent definition before resolving this issue.',
      request: null,
    };
  }

  const targetabilityBlocker = getSubagentTargetabilityBlocker(subagent, activeProblem.key, selectedVariantPath, snapshot);
  if (targetabilityBlocker) {
    return {
      disabledReason: targetabilityBlocker,
      request: null,
    };
  }

  return {
    disabledReason: null,
    request: {
      entity: 'subagent',
      issue: activeProblem.key,
      subagentName: subagent.name,
      selectedVariantPath,
    },
  };
}

function getMcpResolutionTargetsForAction(
  mcp: McpRecord,
  issue: McpResolvableIssue,
): Array<McpRecord['locations'][number] | NonNullable<McpRecord['missingLocations']>[number]> {
  switch (issue) {
    case 'missing-universal':
      return [];
    case 'definition-mismatch':
      return mcp.locations;
    case 'missing-from-agents':
      return mcp.missingLocations ?? [];
  }
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

type SubagentResolutionTarget =
  | SubagentRecord['locations'][number]
  | NonNullable<SubagentRecord['missingLocations']>[number];

function getSubagentTargetabilityBlocker(
  subagent: SubagentRecord,
  issue: SubagentResolvableIssue,
  selectedVariantPath: string,
  snapshot: SkillInventorySnapshot,
): string | null {
  const targetLocations = getSubagentResolutionTargets(subagent, issue, selectedVariantPath, snapshot);
  if (targetLocations.length === 0) {
    return null;
  }

  const allTargetsWritable = targetLocations.every((location) =>
    isWritableSupportedSubagentTarget(location, snapshot));
  return allTargetsWritable
    ? null
    : 'This subagent can only be resolved when every target location is writable and uses a supported format.';
}

function getSubagentResolutionTargets(
  subagent: SubagentRecord,
  issue: SubagentResolvableIssue,
  selectedVariantPath: string,
  snapshot: SkillInventorySnapshot,
): SubagentResolutionTarget[] {
  const canonicalLocation = subagent.locations.find((location) =>
    location.canonical
    && location.fileType === 'real-file'
    && (location.invalidDetails?.length ?? 0) === 0);
  const selectedLocation = subagent.locations.find((location) => location.path === selectedVariantPath);

  switch (issue) {
    case 'missing-universal':
      return [];
    case 'missing-from-agents':
      return subagent.missingLocations ?? [];
    case 'identical-copies':
      return subagent.locations.filter((location) =>
        location.fileType === 'real-file'
        && !location.canonical
        && location.format === 'markdown-frontmatter'
        && isMarkdownSubagentSymlinkCompatible(findSubagentAgent(snapshot, location.agentId)?.family)
        && !hasSubagentLocalExtras(location)
        && location.definitionComparisonKey === canonicalLocation?.definitionComparisonKey);
    case 'broken-symlink':
      return subagent.locations.filter((location) =>
        location.fileType === 'symlink'
        && !location.canonical
        && location.resolvedPath === undefined);
    case 'wrong-symlink-target':
      return subagent.locations.filter((location) =>
        location.fileType === 'symlink'
        && !location.canonical
        && location.resolvedPath !== undefined
        && canonicalLocation
        && location.resolvedPath !== canonicalLocation.path);
    case 'definition-mismatch':
      return subagent.locations.filter((location) =>
        location.fileType === 'real-file'
        && !location.canonical
        && location.path !== selectedVariantPath
        && location.definitionComparisonKey !== selectedLocation?.definitionComparisonKey);
  }
}

function isWritableSupportedSubagentTarget(
  location: SubagentResolutionTarget,
  snapshot: SkillInventorySnapshot,
): boolean {
  if (!location.path) {
    return false;
  }

  const format = location.format ?? findSubagentAgent(snapshot, location.agentId)?.subagentParserKind ?? 'unknown';
  if (!isSupportedSubagentDirectoryFormat(format)) {
    return false;
  }

  if ('fileType' in location) {
    if (location.canonical) {
      return true;
    }
    return location.mutability === 'writable' && !location.agentId.startsWith('plugin:');
  }

  const agent = findSubagentAgent(snapshot, location.agentId);
  return Boolean(
    agent
    && agent.writable
    && agent.subagentsLocation?.state === 'available'
    && agent.subagentsLocation.path,
  );
}

function findSubagentAgent(snapshot: SkillInventorySnapshot, agentId: string) {
  return (snapshot.agents ?? []).find((entry) => entry.id === agentId);
}

function hasSubagentLocalExtras(location: { localExtrasKeys?: string[] }): boolean {
  return (location.localExtrasKeys?.length ?? 0) > 0;
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

function getMcpSelectedVariantPath(
  mcp: McpRecord,
  selectedVariantPath: string | null,
  issue: McpResolvableIssue,
  snapshot: SkillInventorySnapshot,
): string | null {
  if (issue === 'missing-from-agents') {
    const universalLocation = getUniversalMcpLocation(mcp, snapshot);
    if (universalLocation) {
      return universalLocation.configPath;
    }
  }

  if (selectedVariantPath && mcp.locations.some((location) => location.configPath === selectedVariantPath)) {
    return selectedVariantPath;
  }

  return getDistinctMcpVariantCount(mcp) === 1 ? mcp.locations[0]?.configPath ?? null : null;
}

function getUniversalMcpLocation(
  mcp: McpRecord,
  snapshot: SkillInventorySnapshot,
): McpRecord['locations'][number] | null {
  const canonicalSourceIds = new Set(
    snapshot.sources.filter((source) => source.canonical).map((source) => source.id),
  );

  return mcp.locations.find((location) =>
    location.provenance?.kind === 'universal'
    || canonicalSourceIds.has(location.agentId)
    || isAgentsMcpConfigPath(location.configPath)) ?? null;
}

function isAgentsMcpConfigPath(value: string): boolean {
  return value.replace(/\\/g, '/').includes('/.agents/');
}

function getSubagentSelectedVariantPath(subagent: SubagentRecord, selectedVariantPath: string | null): string | null {
  if (selectedVariantPath && subagent.locations.some((location) =>
    location.path === selectedVariantPath
    && location.fileType === 'real-file'
    && (location.invalidDetails?.length ?? 0) === 0)) {
    return selectedVariantPath;
  }

  const selectableLocations = subagent.locations.filter((location) =>
    location.fileType === 'real-file'
    && (location.invalidDetails?.length ?? 0) === 0);
  const canonicalLocation = selectableLocations.find((location) => location.canonical && location.fileType === 'real-file');
  if (canonicalLocation) {
    return canonicalLocation.path;
  }

  const groups = new Map<string, string[]>();
  for (const location of selectableLocations) {
    const key = location.definitionComparisonKey ?? location.definitionText ?? `path:${location.path}`;
    const existing = groups.get(key) ?? [];
    existing.push(location.path);
    groups.set(key, existing);
  }

  return groups.size === 1 ? selectableLocations[0]?.path ?? null : null;
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

function isSubagentResolvableIssue(value: string): value is SubagentResolvableIssue {
  return SUBAGENT_RESOLVABLE_ISSUES.has(value as SubagentResolvableIssue);
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
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));

  for (const mcp of snapshot.mcps ?? []) {
    if (mcp.presentation !== 'active' || !mcp.issueReasons.includes('missing-from-agents')) {
      continue;
    }

    if (hasPluginMcpLocation(mcp, sourceIndex)) {
      continue;
    }

    const targetLocations = mcp.missingLocations ?? [];
    if (targetLocations.length === 0) {
      continue;
    }

    const targetableLocations = targetLocations.filter((location) => isWritableSupportedMcpTarget(location, snapshot));
    if (targetableLocations.length === 0) {
      continue;
    }

    const selectedVariantPath = getMcpSelectedVariantPath(mcp, null, 'missing-from-agents', snapshot);
    if (!selectedVariantPath) {
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

const AUTO_RESOLVABLE_SUBAGENT_ISSUES: Set<SubagentResolvableIssue> = new Set([
  'missing-universal',
  'missing-from-agents',
  'identical-copies',
  'broken-symlink',
]);

export function getAutoResolvableSubagentRequests(
  snapshot: SkillInventorySnapshot,
): ResolveIssueRequest[] {
  const requests: ResolveIssueRequest[] = [];

  for (const subagent of snapshot.subagents ?? []) {
    if (subagent.presentation !== 'active' || hasPluginSubagentLocation(subagent)) {
      continue;
    }

    for (const reason of subagent.issueReasons) {
      if (!AUTO_RESOLVABLE_SUBAGENT_ISSUES.has(reason as SubagentResolvableIssue)) {
        continue;
      }

      const selectedVariantPath = getSubagentSelectedVariantPath(subagent, null);
      if (!selectedVariantPath) {
        continue;
      }

      if (getSubagentTargetabilityBlocker(subagent, reason as SubagentResolvableIssue, selectedVariantPath, snapshot)) {
        continue;
      }

      requests.push({
        entity: 'subagent',
        issue: reason as SubagentResolvableIssue,
        subagentName: subagent.name,
        selectedVariantPath,
      });
    }
  }

  return requests;
}

function hasPluginMcpLocation(
  mcp: McpRecord,
  sourceIndex: Map<string, SkillScanSource>,
): boolean {
  return mcp.locations.some((location) =>
    location.provenance?.kind === 'plugin'
    || sourceIndex.get(location.agentId)?.kind === 'plugin');
}

function hasPluginSubagentLocation(subagent: SubagentRecord): boolean {
  return subagent.locations.some((location) =>
    location.agentId.startsWith('plugin:')
    || location.provenance?.kind === 'plugin');
}
