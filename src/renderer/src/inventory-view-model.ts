import type {
  AgentRecord,
  HomeSummary,
  McpRecord,
  PluginRecord,
  SkillInventorySnapshot,
  SkillRecord,
  SkillScanSource,
} from '@shared/contracts';

export type PrimaryTab = 'home' | 'skills' | 'mcps' | 'agents' | 'plugins' | 'audit' | 'settings';

export interface InventorySection<T> {
  title: string;
  tone: 'attention' | 'healthy' | 'muted';
  rows: T[];
  emptyMessage: string;
}

export interface SkillAccessState {
  kind: 'plugin' | 'read-only';
  label: 'Managed by plugin' | 'View only';
  detailMessage: string;
}

export function getSkillSections(snapshot: SkillInventorySnapshot): InventorySection<SkillRecord>[] {
  const driftedRows = snapshot.skills.filter((skill) => skill.driftPresentation === 'active').sort(compareIssueDenseSkillRows);
  const dismissedRows = snapshot.skills.filter((skill) => skill.driftPresentation === 'dismissed').sort(compareIssueDenseSkillRows);
  const healthyRows = snapshot.skills
    .filter((skill) => skill.driftPresentation === 'none')
    .sort(compareStableRows);

  const sections: InventorySection<SkillRecord>[] = [
    {
      title: 'Needs attention',
      tone: 'attention',
      rows: driftedRows,
      emptyMessage: 'Nothing needs attention right now.',
    },
  ];

  if (dismissedRows.length > 0) {
    sections.push({
      title: 'Dismissed issues',
      tone: 'muted',
      rows: dismissedRows,
      emptyMessage: 'Items you hid stay here so you can come back to them later.',
    });
  }

  sections.push({
    title: 'Healthy',
    tone: 'healthy',
    rows: healthyRows,
    emptyMessage: 'Healthy skills show up here.',
  });

  return sections;
}

export function getSkillTableRows(snapshot: SkillInventorySnapshot): SkillRecord[] {
  return [...snapshot.skills].sort(compareSkillTableRows);
}

export function getMcpTableRows(snapshot: SkillInventorySnapshot): McpRecord[] {
  return [...(snapshot.mcps ?? [])].sort(compareMcpTableRows);
}

export function getMcpSections(snapshot: SkillInventorySnapshot): InventorySection<McpRecord>[] {
  const mcps = snapshot.mcps ?? [];
  const attentionRows = mcps
    .filter((mcp) => mcp.status === 'needs-attention' && mcp.presentation === 'active')
    .sort(compareIssueDenseMcpRows);
  const mutedRows = mcps
    .filter((mcp) => mcp.status === 'needs-attention' && mcp.presentation === 'dismissed')
    .sort(compareIssueDenseMcpRows);
  const healthyRows = mcps
    .filter((mcp) => mcp.status === 'healthy')
    .sort(compareAlphabeticallyByName);

  const sections: InventorySection<McpRecord>[] = [
    {
      title: 'Needs attention',
      tone: 'attention',
      rows: attentionRows,
      emptyMessage: 'No MCP setup issues need attention right now.',
    },
  ];

  if (mutedRows.length > 0) {
    sections.push({
      title: 'Dismissed issues',
      tone: 'muted',
      rows: mutedRows,
      emptyMessage: 'Hidden MCP issues stay here so you can review them later.',
    });
  }

  sections.push({
    title: 'Healthy',
    tone: 'healthy',
    rows: healthyRows,
    emptyMessage: 'MCP servers with matching setup show up here.',
  });

  return sections;
}

export function getHomeSummary(snapshot: SkillInventorySnapshot | null): HomeSummary {
  const skills = snapshot?.counts
    ? {
        total: snapshot.counts.totalSkills,
        healthy: snapshot.counts.healthySkills,
        needsAttention: snapshot.counts.driftedSkills,
      }
    : snapshot?.homeSummary?.skills ?? { total: 0, healthy: 0, needsAttention: 0 };

  const mcps = snapshot?.mcpCounts
    ? {
        total: snapshot.mcpCounts.totalMcps,
        healthy: snapshot.mcpCounts.healthyMcps,
        needsAttention: snapshot.mcpCounts.attentionMcps,
      }
    : snapshot?.homeSummary?.mcps ?? { total: 0, healthy: 0, needsAttention: 0 };

  return {
    skills,
    mcps,
    installedAgents: snapshot?.agentCounts?.installedAgents ?? snapshot?.homeSummary?.installedAgents ?? 0,
  };
}

export function getSkillDisplayName(
  skill: Pick<SkillRecord, 'name' | 'displayName'> & Partial<Pick<SkillRecord, 'locations'>>,
): string {
  const displayName = skill.displayName?.trim() || skill.name;
  return stripPluginQualifierFromSkillDisplayName(displayName, skill);
}

export function getMcpDisplayName(mcp: Pick<McpRecord, 'name' | 'locations'>): string {
  return stripPluginQualifierFromName(mcp.name, mcp);
}

export function filterSkillRows(rows: SkillRecord[], query: string): SkillRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => matchesSearchFields(normalizedQuery, [getSkillDisplayName(row), row.name, row.description]));
}

export function filterNamedRows<T extends { name: string }>(rows: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => row.name.toLocaleLowerCase().includes(normalizedQuery));
}

export function filterMcpRows(rows: McpRecord[], query: string): McpRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => matchesSearchFields(normalizedQuery, [getMcpDisplayName(row), row.name]));
}

export function filterAgentRows(rows: AgentRecord[], query: string): AgentRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => {
    return matchesSearchFields(normalizedQuery, [
      row.label,
      row.family,
      row.defaultProjectSkillsDir,
      row.defaultGlobalSkillsDir,
      row.defaultHomeDir,
      row.skillsLocation.path,
      row.skillsLocation.displayPath,
      row.mcpConfigLocation.path,
      row.mcpConfigLocation.displayPath,
      row.configLocation?.path,
      row.configLocation?.displayPath,
      row.executableLocation?.path,
      row.executableLocation?.displayPath,
    ]);
  });
}

export function filterPluginRows(rows: PluginRecord[], query: string): PluginRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => matchesSearchFields(normalizedQuery, [
    row.pluginName,
    row.pluginId,
    row.host,
    row.version,
    row.rootPath,
    row.manifestPath,
    row.source?.marketplace,
    row.source?.repository,
    ...row.bundledSkills.map((skill) => skill.name),
    ...row.bundledMcps.map((mcp) => mcp.name),
  ]));
}

function matchesSearchFields(query: string, fields: Array<string | null | undefined>): boolean {
  return fields.some((field) => field?.toLocaleLowerCase().includes(query));
}

export function hasSearchQuery(query: string): boolean {
  return query.trim().length > 0;
}

export function getSkillAccessState(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource> | Record<string, SkillScanSource>,
): SkillAccessState | null {
  const sources = skill.locations
    .map((location) => getSourceById(location.sourceId, sourceIndex))
    .filter((source): source is SkillScanSource => source !== undefined);

  const readOnlySources = sources.filter((source) => !source.writable);

  if (readOnlySources.length === 0) {
    return null;
  }

  if (readOnlySources.some((source) => source.kind === 'plugin')) {
    return {
      kind: 'plugin',
      label: 'Managed by plugin',
      detailMessage: 'This skill comes from a plugin. Skill Index can use it as Universal, but cannot edit the plugin copy.',
    };
  }

  return {
    kind: 'read-only',
    label: 'View only',
    detailMessage: 'This skill is read-only right now. You can review it here, but you need an editable copy before you can make it universal.',
  };
}

function compareIssueDenseSkillRows(left: SkillRecord, right: SkillRecord): number {
  const issueCountDifference = getSkillIssueCount(right) - getSkillIssueCount(left);
  if (issueCountDifference !== 0) {
    return issueCountDifference;
  }

  return compareAlphabeticallyBySkillName(left, right);
}

function compareAlphabeticallyByName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function compareAlphabeticallyByMcpName(left: McpRecord, right: McpRecord): number {
  return getMcpDisplayName(left).localeCompare(getMcpDisplayName(right), undefined, { sensitivity: 'base' })
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function compareAlphabeticallyBySkillName(left: SkillRecord, right: SkillRecord): number {
  return getSkillDisplayName(left).localeCompare(getSkillDisplayName(right), undefined, { sensitivity: 'base' })
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function stripPluginQualifierFromSkillDisplayName(
  displayName: string,
  skill: Pick<SkillRecord, 'name'> & Partial<Pick<SkillRecord, 'locations'>>,
): string {
  return stripPluginQualifierFromName(displayName, skill);
}

function stripPluginQualifierFromName(
  displayName: string,
  record: Pick<SkillRecord | McpRecord, 'name'> & Partial<Pick<SkillRecord | McpRecord, 'locations'>>,
): string {
  const qualifierEnd = record.name.indexOf(':');
  if (qualifierEnd <= 0) {
    return displayName;
  }

  const hasPluginLocation = record.locations?.some((location) =>
    location.provenance?.kind === 'plugin' && location.mutability === 'read-only-managed') ?? false;
  if (!hasPluginLocation) {
    return displayName;
  }

  const qualifier = record.name.slice(0, qualifierEnd);
  const qualifiedPrefix = `${qualifier}:`;
  return displayName.startsWith(qualifiedPrefix)
    ? displayName.slice(qualifiedPrefix.length)
    : displayName;
}

function compareStableRows(left: SkillRecord, right: SkillRecord): number {
  return getStableRank(left) - getStableRank(right) || compareAlphabeticallyBySkillName(left, right);
}

function compareSkillTableRows(left: SkillRecord, right: SkillRecord): number {
  const presentationRank = getSkillTablePresentationRank(left) - getSkillTablePresentationRank(right);
  if (presentationRank !== 0) {
    return presentationRank;
  }

  if (left.driftPresentation !== 'none') {
    return compareIssueDenseSkillRows(left, right);
  }

  return compareStableRows(left, right);
}

function compareMcpTableRows(left: McpRecord, right: McpRecord): number {
  const presentationRank = getMcpTablePresentationRank(left) - getMcpTablePresentationRank(right);
  if (presentationRank !== 0) {
    return presentationRank;
  }

  if (left.presentation === 'active' && right.presentation === 'active') {
    return compareIssueDenseMcpRows(left, right);
  }

  if (left.presentation === 'dismissed' && right.presentation === 'dismissed') {
    return compareIssueDenseMcpRows(left, right);
  }

  return compareAlphabeticallyByMcpName(left, right);
}

function compareIssueDenseMcpRows(left: McpRecord, right: McpRecord): number {
  const issueCountDifference = getMcpIssueCount(right) - getMcpIssueCount(left);
  if (issueCountDifference !== 0) {
    return issueCountDifference;
  }

  return compareAlphabeticallyByMcpName(left, right);
}

function getSkillTablePresentationRank(skill: SkillRecord): number {
  switch (skill.driftPresentation) {
    case 'active':
      return 0;
    case 'dismissed':
      return 1;
    case 'none':
      return 2;
  }
}

function getMcpTablePresentationRank(mcp: McpRecord): number {
  switch (mcp.presentation) {
    case 'active':
      return 0;
    case 'dismissed':
      return 1;
    case 'none':
      return 2;
  }
}

function getStableRank(skill: SkillRecord): number {
  if (skill.driftPresentation === 'dismissed') {
    return 2;
  }

  if (skill.structuralState === 'single-source-noncanonical') {
    return 1;
  }

  if (skill.structuralState === 'missing-symlinks') {
    return 1;
  }

  return 0;
}

function getSkillIssueCount(skill: SkillRecord): number {
  const reasons = new Set(skill.issueReasons ?? []);

  if ((skill.detailDiagnostics.definitionIssues?.length ?? 0) > 0) {
    reasons.add('invalid-definition');
  }

  if ((skill.detailDiagnostics.missingInstallSources?.length ?? 0) > 0) {
    reasons.add('missing-symlinks');
  }

  if (reasons.size === 0) {
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

  return reasons.size;
}

function getMcpIssueCount(mcp: McpRecord): number {
  return mcp.issueReasons.length;
}

function getSourceById(
  sourceId: string,
  sourceIndex: Map<string, SkillScanSource> | Record<string, SkillScanSource>,
): SkillScanSource | undefined {
  if (sourceIndex instanceof Map) {
    return sourceIndex.get(sourceId);
  }

  return sourceIndex[sourceId];
}
