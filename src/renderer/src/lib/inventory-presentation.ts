import type {
  AgentRecord,
  McpPresentation,
  McpRecord,
  SkillDiffLine,
  SkillDriftPresentation,
  SkillInventorySnapshot,
  SkillIssueReason,
  SkillRecord,
  SubagentIssueReason,
  SubagentPresentation,
  SubagentRecord,
} from '@shared/contracts';

type InventoryStatusFilter = 'all';
export type SkillStatusFilter = InventoryStatusFilter | SkillDriftPresentation;
export type McpStatusFilter = InventoryStatusFilter | McpPresentation;
export type SubagentStatusFilter = InventoryStatusFilter | SubagentPresentation;

export function compareNewestCandidate(
  left: SkillRecord['detailDiagnostics']['duplicateCandidates'][number],
  right: SkillRecord['detailDiagnostics']['duplicateCandidates'][number],
): number {
  const timestampDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return timestampDifference || left.path.localeCompare(right.path);
}

export function filterVisibleSections<T extends { name: string }>(
  sections: Array<{ title: string; tone: 'attention' | 'healthy' | 'muted'; rows: T[] }>,
  rows: T[],
): Array<{ title: string; tone: 'attention' | 'healthy' | 'muted'; rows: T[] }> {
  const visibleNames = new Set(rows.map((row) => row.name));
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => visibleNames.has(row.name)),
    }))
    .filter((section) => section.rows.length > 0);
}

export function getPillToneForSkill(skill: SkillRecord): 'attention' | 'healthy' | 'muted' {
  switch (skill.driftPresentation) {
    case 'active':
      return 'attention';
    case 'dismissed':
      return 'muted';
    case 'none':
      return 'healthy';
  }
}

export function getPillToneForMcp(mcp: McpRecord): 'attention' | 'healthy' | 'muted' {
  if (mcp.presentation === 'dismissed') {
    return 'muted';
  }

  if (mcp.status === 'healthy') {
    return 'healthy';
  }

  return 'attention';
}

export function getPillToneForSubagent(subagent: SubagentRecord): 'attention' | 'healthy' | 'muted' {
  if (subagent.presentation === 'dismissed') {
    return 'muted';
  }

  if (subagent.status === 'healthy') {
    return 'healthy';
  }

  return 'attention';
}

export function getShortSkillStatusLabel(skill: SkillRecord): string {
  return getSkillStatusLabels(skill)[0] ?? 'Healthy';
}

export function getShortMcpStatusLabel(mcp: McpRecord): string {
  return getMcpStatusLabels(mcp)[0] ?? 'Healthy';
}

export function formatCompactDate(value: string | undefined): string {
  if (!value) {
    return 'recently';
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return 'recently';
  }

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsedValue);
}

export function formatAgeLabel(value: string): string {
  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return value;
  }

  const days = Math.max(0, Math.round((Date.now() - parsedValue.getTime()) / (1000 * 60 * 60 * 24)));
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return '1d ago';
  }
  return `${days}d ago`;
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sliceLength = Math.max(6, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, sliceLength)}…${value.slice(-sliceLength)}`;
}

export function formatInspectorDisplayPath(value: string, options: { sandboxRoot?: string | null } = {}): string {
  const collapsedPath = collapseUserHomePath(value);
  const collapsedSandboxRoot = options.sandboxRoot ? collapseUserHomePath(options.sandboxRoot) : null;

  if (collapsedSandboxRoot) {
    if (collapsedPath === collapsedSandboxRoot) {
      return '~';
    }

    const sandboxPrefix = `${collapsedSandboxRoot}/`;
    if (collapsedPath.startsWith(sandboxPrefix)) {
      return `~/${collapsedPath.slice(sandboxPrefix.length)}`;
    }
  }

  return collapsedPath;
}

function collapseUserHomePath(value: string): string {
  const normalizedValue = value.replace(/\\/gu, '/');
  const homePrefixes = [
    /^\/Users\/[^/]+/u,
    /^\/home\/[^/]+/u,
    /^[A-Za-z]:\/Users\/[^/]+/u,
  ];

  for (const pattern of homePrefixes) {
    const match = normalizedValue.match(pattern);
    if (!match) {
      continue;
    }

    const suffix = normalizedValue.slice(match[0].length);
    return suffix.length > 0 ? `~${suffix}` : '~';
  }

  return normalizedValue;
}

export function formatLastScanLabel(value: string | undefined): string {
  if (!value) {
    return 'Never';
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return 'Just now';
  }

  const seconds = Math.max(1, Math.round((Date.now() - parsedValue.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function formatSidebarInventorySummary(snapshot: SkillInventorySnapshot): string {
  const directoryCount = snapshot.sources.length;
  return `${directoryCount} ${directoryCount === 1 ? 'directory' : 'directories'}`;
}

export function formatDiffLine(line: SkillDiffLine): string {
  switch (line.type) {
    case 'context':
      return line.text;
    case 'added':
      return `+ ${line.text}`;
    case 'removed':
      return `- ${line.text}`;
  }
}

export function formatMcpIssueReason(reason: McpRecord['issueReasons'][number]): string {
  switch (reason) {
    case 'missing-universal':
      return 'Missing Universal';
    case 'definition-mismatch':
      return 'Definition Mismatch';
    case 'missing-from-agents':
      return 'Missing From Agents';
    case 'invalid-definition':
      return 'Invalid Definition';
    case 'connection-failed':
      return 'Connection Failed';
  }
}

export function formatMcpSupportingCopy(mcp: McpRecord): string | null {
  if (mcp.issueReasons.length > 0) {
    return mcp.issueReasons.map(formatMcpIssueReason).join(' · ');
  }

  return null;
}

export function compareAgentsForTable(left: AgentRecord, right: AgentRecord): number {
  if (left.installState !== right.installState) {
    return left.installState === 'installed' ? -1 : 1;
  }

  return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
}

export function getDisplaySkillIssueReasons(skill: SkillRecord): SkillIssueReason[] {
  const reasons = new Set<SkillIssueReason>(skill.issueReasons ?? []);

  if ((skill.issueReasons?.length ?? 0) === 0) {
    switch (skill.structuralState) {
      case 'missing-symlinks':
        reasons.add('missing-symlinks');
        break;
      case 'single-source-noncanonical':
        reasons.add('missing-canonical');
        break;
      case 'identical-drift':
        reasons.add('identical-copies');
        break;
      case 'diverged-drift':
        reasons.add('diverged-copies');
        break;
      case 'healthy':
        break;
    }
  }

  if ((skill.detailDiagnostics.definitionIssues?.length ?? 0) > 0) {
    reasons.add('invalid-definition');
  }

  if ((skill.detailDiagnostics.missingInstallSources?.length ?? 0) > 0) {
    reasons.add('missing-symlinks');
  }

  return [...reasons].sort(compareSkillIssueReasons);
}

export function formatSkillIssueReason(reason: SkillIssueReason): string {
  switch (reason) {
    case 'missing-symlinks':
      return 'Missing Symlinks';
    case 'missing-canonical':
      return 'Missing Universal';
    case 'identical-copies':
      return 'Identical Copies';
    case 'diverged-copies':
      return 'Diverged Copies';
    case 'broken-symlink':
      return 'Broken Symlink';
    case 'wrong-symlink-target':
      return 'Wrong Symlink Target';
    case 'invalid-definition':
      return 'Invalid Definition';
  }
}

export function getSkillStatusLabels(skill: SkillRecord): string[] {
  const reasons = getDisplaySkillIssueReasons(skill);
  return reasons.length > 0 ? reasons.map(formatSkillIssueReason) : ['Healthy'];
}

export function getMcpStatusLabels(mcp: McpRecord): string[] {
  if (mcp.issueReasons.length > 0) {
    return mcp.issueReasons.map(formatMcpIssueReason);
  }

  return ['Healthy'];
}

export function getSubagentStatusLabels(subagent: SubagentRecord): string[] {
  if (subagent.issueReasons.length > 0) {
    return subagent.issueReasons.map(formatSubagentIssueReason);
  }

  return ['Healthy'];
}

export function formatSubagentIssueReason(reason: SubagentIssueReason): string {
  switch (reason) {
    case 'missing-universal':
      return 'Missing Universal';
    case 'missing-from-agents':
      return 'Missing From Agents';
    case 'definition-mismatch':
      return 'Definition Mismatch';
    case 'identical-copies':
      return 'Identical Copies';
    case 'broken-symlink':
      return 'Broken Symlink';
    case 'wrong-symlink-target':
      return 'Wrong Symlink Target';
    case 'invalid-definition':
      return 'Invalid Definition';
  }
}

function compareSkillIssueReasons(left: SkillIssueReason, right: SkillIssueReason): number {
  return getSkillIssueRank(left) - getSkillIssueRank(right);
}

function getSkillIssueRank(reason: SkillIssueReason): number {
  switch (reason) {
    case 'missing-canonical':
      return 0;
    case 'diverged-copies':
      return 1;
    case 'wrong-symlink-target':
      return 2;
    case 'broken-symlink':
      return 3;
    case 'identical-copies':
      return 4;
    case 'missing-symlinks':
      return 5;
    case 'invalid-definition':
      return 6;
  }
}

export function filterSkillRowsByStatus(rows: SkillRecord[], filter: SkillStatusFilter): SkillRecord[] {
  if (filter === 'all') {
    return rows;
  }

  return rows.filter((row) => row.driftPresentation === filter);
}

export function getSkillRowDescription(skill: SkillRecord): string {
  if (typeof skill.description === 'string' && skill.description.trim().length > 0) {
    return skill.description.trim();
  }

  return 'No frontmatter description found.';
}

export function filterMcpRowsByStatus(rows: McpRecord[], filter: McpStatusFilter): McpRecord[] {
  if (filter === 'all') {
    return rows;
  }

  return rows.filter((row) => row.presentation === filter);
}

export function filterSubagentRowsByStatus(rows: SubagentRecord[], filter: SubagentStatusFilter): SubagentRecord[] {
  if (filter === 'all') {
    return rows;
  }

  return rows.filter((row) => row.presentation === filter);
}
