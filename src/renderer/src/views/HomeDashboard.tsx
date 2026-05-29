import { ArrowRight, Check, ChevronRight, ChevronUp, Wrench } from 'lucide-react';
import { useState } from 'react';

import type { McpRecord, ResolveIssueRequest, SkillInventorySnapshot, SkillRecord, SkillScanSource, SubagentRecord } from '@shared/contracts';

import {
  getHomeSummary,
  getMcpDisplayName,
  getMcpSections,
  getSkillDisplayName,
  getSkillSections,
  getSubagentDisplayName,
  getSubagentSections,
} from '../inventory-view-model';
import {
  getMcpStatusLabels,
  getSkillStatusLabels,
  getSubagentStatusLabels,
  getSkillRowDescription,
  getDisplaySkillIssueReasons,
  formatLastScanLabel,
} from '../lib/inventory-presentation';
import {
  EmptyStatePanel,
  PageTopBar,
  PLUGIN_MCP_TOOLTIP,
  PLUGIN_SKILL_TOOLTIP,
  PLUGIN_SUBAGENT_TOOLTIP,
  PluginTooltipIndicator,
  RescanToolbarButton,
} from '../components/ui';

const FIX_ACTION_LABELS: Record<string, string> = {
  'missing-symlinks': 'Create missing symlinks',
  'identical-copies': 'Convert copies to symlinks',
  'missing-canonical': 'Promote to universal',
  'missing-universal': 'Promote to universal',
  'broken-symlink': 'Relink to canonical',
  'wrong-symlink-target': 'Relink to canonical',
  'missing-from-agents': 'Add to missing agents',
};

const FIX_TYPE_LABELS: Record<string, string> = {
  'missing-symlinks': 'Missing Symlinks',
  'identical-copies': 'Identical Copies',
  'missing-canonical': 'Missing Universal',
  'missing-universal': 'Missing Universal',
  'broken-symlink': 'Broken Symlink',
  'wrong-symlink-target': 'Wrong Symlink Target',
  'missing-from-agents': 'Missing From Agents',
};

const FIX_ENTITY_LABELS: Record<ResolveIssueRequest['entity'], string> = {
  skill: 'Skills',
  mcp: 'MCPs',
  subagent: 'Subagents',
};

interface PlannedFixRow {
  key: string;
  name: string;
}

interface PlannedFixGroup {
  entity: ResolveIssueRequest['entity'];
  issue: ResolveIssueRequest['issue'];
  rows: PlannedFixRow[];
}

interface HomeMetric {
  key: string;
  label: string;
  needsAttention: number;
  severity: 'alert' | 'warn';
  total: number;
  unit: string;
}

interface AttentionBadge {
  label: string;
  tone: 'attention' | 'warning' | 'healthy' | 'muted';
}

interface HomeAttentionItem {
  badges: AttentionBadge[];
  description?: string;
  isLocked?: boolean;
  key: string;
  label: string;
  lockedTooltip?: string;
  onClick: () => void;
}

interface HomeAttentionGroup {
  actionLabel: string;
  count: number;
  items: HomeAttentionItem[];
  key: string;
  label: string;
  onAction: () => void;
}

const EMPTY_HOME_METRIC = { total: 0, healthy: 0, needsAttention: 0 };

function getResolveRequestDisplayName(
  request: ResolveIssueRequest,
  inventorySnapshot: SkillInventorySnapshot | null,
): string {
  if (request.entity === 'skill') {
    const skill = inventorySnapshot?.skills.find((entry) => entry.name === request.skillName);
    return skill ? getSkillDisplayName(skill) : request.skillName;
  }

  if (request.entity === 'subagent') {
    return request.subagentName;
  }

  const mcp = inventorySnapshot?.mcps?.find((entry) => entry.name === request.mcpName);
  return mcp ? getMcpDisplayName(mcp) : request.mcpName;
}

function getResolveRequestKey(request: ResolveIssueRequest): string {
  return [
    request.entity,
    request.skillName ?? request.mcpName ?? request.subagentName,
    request.issue,
    request.selectedVariantPath ?? '',
  ].join(':');
}

function getActiveIssueCount(inventorySnapshot: SkillInventorySnapshot | null): number {
  if (!inventorySnapshot) {
    return 0;
  }

  const skillIssueCount = inventorySnapshot.skills
    .filter((skill) => skill.driftPresentation === 'active')
    .reduce((count, skill) => count + getDisplaySkillIssueReasons(skill).length, 0);
  const mcpIssueCount = (inventorySnapshot.mcps ?? [])
    .filter((mcp) => mcp.presentation === 'active' && mcp.status === 'needs-attention')
    .reduce((count, mcp) => count + mcp.issueReasons.length, 0);
  const subagentIssueCount = (inventorySnapshot.subagents ?? [])
    .filter((subagent) => subagent.presentation === 'active' && subagent.status === 'needs-attention')
    .reduce((count, subagent) => count + subagent.issueReasons.length, 0);
  return skillIssueCount + mcpIssueCount + subagentIssueCount;
}

function getFixGroupKey(request: ResolveIssueRequest): string {
  return `${request.entity}:${request.issue}`;
}

function formatFixGroupLabel(group: Pick<PlannedFixGroup, 'entity' | 'issue'>): string {
  return `${FIX_ENTITY_LABELS[group.entity]} • ${FIX_TYPE_LABELS[group.issue] ?? group.issue}`;
}

function HomeInventoryMetrics({ metrics }: { metrics: HomeMetric[] }) {
  return (
    <section aria-label="Home inventory metrics" className="home-inventory-bar">
      {metrics.map((metric) => {
        const isClean = metric.needsAttention === 0;
        const attentionTone = isClean ? 'clean' : metric.severity;

        return (
          <div className="home-inventory-cell" key={metric.key}>
            <div className="home-inventory-label">{metric.label}</div>
            <div className="home-inventory-total">
              {metric.total}
              <span className="home-inventory-unit">{metric.unit}</span>
            </div>
            <div className={`home-inventory-attention home-inventory-attention--${attentionTone}`}>
              {isClean ? (
                <>
                  <Check aria-hidden="true" />
                  All clean
                </>
              ) : (
                <>
                  <span className="home-inventory-dot" aria-hidden="true" />
                  {metric.needsAttention} {metric.needsAttention === 1 ? 'needs' : 'need'} attention
                </>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function HomeNeedsAttentionCard({
  groups,
  lastCheckedLabel,
}: {
  groups: HomeAttentionGroup[];
  lastCheckedLabel: string;
}) {
  const attentionGroups = groups.filter((group) => group.items.length > 0);
  const cleanGroups = groups.filter((group) => group.items.length === 0);
  const totalAttention = attentionGroups.reduce((total, group) => total + group.items.length, 0);
  const cleanCopy = formatCleanGroupCopy(cleanGroups.map((group) => group.label));

  return (
    <section
      aria-labelledby="home-needs-attention-title"
      className={`home-attention-card${totalAttention === 0 ? ' home-attention-card--clean' : ''}`}
      role="region"
    >
      <div className="home-attention-header">
        <h3 id="home-needs-attention-title">Needs attention</h3>
      </div>

      <div className="home-attention-body">
        {totalAttention === 0 ? (
          <div className="home-attention-all-clean">
            <div className="home-attention-clean-icon" aria-hidden="true">
              <Check />
            </div>
            <div>
              <div className="home-attention-clean-title">Everything is in its expected state</div>
              <div className="home-attention-clean-copy">
                Canonical sources present, symlinks resolved, no drift across all 3 content types. Last checked {lastCheckedLabel}.
              </div>
            </div>
          </div>
        ) : (
          <>
            {attentionGroups.map((group, index) => (
              <div className="home-attention-group" key={group.key}>
                <div className={`home-attention-group-header${index > 0 ? ' home-attention-group-header--separated' : ''}`}>
                  <span className="home-attention-group-label">{group.label}</span>
                  <span className="home-attention-group-count">· {group.count}</span>
                  <span className="home-attention-group-spacer" />
                  <button className="home-attention-group-link" type="button" onClick={group.onAction}>
                    {group.actionLabel}
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>

                {group.items.map((item) => (
                  <button className="home-attention-row" key={item.key} type="button" onClick={item.onClick}>
                    <div className="home-attention-row-main">
                      <div className="home-attention-row-title">
                        <span>{item.label}</span>
                        {item.isLocked ? (
                          <PluginTooltipIndicator
                            className="home-attention-row__plugin-indicator"
                            tooltip={item.lockedTooltip ?? PLUGIN_SKILL_TOOLTIP}
                          />
                        ) : null}
                      </div>
                      {item.description ? <div className="home-attention-row-description">{item.description}</div> : null}
                    </div>
                    <div className="home-attention-row-statuses">
                      {item.badges.map((badge) => (
                        <span className={`home-attention-status-pill home-attention-status-pill--${badge.tone}`} key={badge.label}>
                          <span className="home-attention-status-dot" aria-hidden="true" />
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            ))}

            {cleanCopy ? (
              <div className="home-attention-clean-foot">
                <div className="home-attention-clean-foot-icon" aria-hidden="true">
                  <Check />
                </div>
                <div>
                  <strong>{cleanCopy.label}</strong> {cleanCopy.verb} fully in sync - no action needed.
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function formatCleanGroupCopy(labels: string[]): { label: string; verb: 'is' | 'are' } | null {
  if (labels.length === 0) {
    return null;
  }

  return {
    label: labels.join(' & '),
    verb: labels.length === 1 ? 'is' : 'are',
  };
}

function getHomeAttentionBadgeTone(label: string): AttentionBadge['tone'] {
  if (label === 'Healthy') {
    return 'healthy';
  }

  if (label === 'Dismissed') {
    return 'muted';
  }

  if (label.includes('Diverged') || label.includes('Definition Mismatch')) {
    return 'attention';
  }

  return 'warning';
}

function toHomeAttentionBadges(labels: string[]): AttentionBadge[] {
  return labels.map((label) => ({
    label,
    tone: getHomeAttentionBadgeTone(label),
  }));
}

function RepairSurface({
  autoResolvableRequests,
  hasAttentionIssues,
  inventorySnapshot,
  isAutoResolving,
  onAutoResolve,
  onViewManualIssues,
  manualReviewTargetLabel,
}: {
  autoResolvableRequests: ResolveIssueRequest[];
  hasAttentionIssues: boolean;
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving: boolean;
  manualReviewTargetLabel: string;
  onAutoResolve: () => void;
  onViewManualIssues: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewPanelId = 'home-auto-repair-review-panel';

  const fixesByType = autoResolvableRequests.reduce<Map<string, PlannedFixGroup>>((acc, req) => {
    const groupKey = getFixGroupKey(req);
    const group = acc.get(groupKey) ?? {
      entity: req.entity,
      issue: req.issue,
      rows: [],
    };
    group.rows.push({
      key: getResolveRequestKey(req),
      name: getResolveRequestDisplayName(req, inventorySnapshot),
    });
    acc.set(groupKey, group);
    return acc;
  }, new Map());

  const totalIssues = autoResolvableRequests.length;
  const totalItems = new Set(autoResolvableRequests.map((r) => r.skillName ?? r.mcpName ?? r.subagentName)).size;
  const manualIssueCount = Math.max(0, getActiveIssueCount(inventorySnapshot) - totalIssues);

  if (autoResolvableRequests.length === 0 && !hasAttentionIssues) {
    return (
      <div className="repair-surface repair-surface--healthy">
        <div className="repair-surface-status-row">
          <div className="repair-surface-icon repair-surface-icon--healthy">
            <Check />
          </div>
          <div className="repair-surface-copy">
            <strong>Everything looks good</strong>
            <p>All skills, MCPs, and subagents are healthy — nothing needs attention right now.</p>
          </div>
        </div>
      </div>
    );
  }

  if (autoResolvableRequests.length === 0) {
    return (
      <div className="repair-surface repair-surface--calm">
        <div className="repair-surface-status-row">
          <div className="repair-surface-icon repair-surface-icon--calm">
            <Check />
          </div>
          <div className="repair-surface-copy">
            <strong>No safe auto-fixes available.</strong>{' '}
            Remaining issues require a manual choice — review them in the{' '}
            <button className="repair-surface-link" type="button" onClick={onViewManualIssues}>
              {manualReviewTargetLabel}
            </button>
            .
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="repair-surface">
      <div className="repair-banner">
        <Wrench aria-hidden className="repair-banner-wrench" />
        <div className="repair-banner-copy">
          <div className="repair-banner-title">Auto-resolve issues with safe resolutions</div>
          <div className="repair-banner-sub">
            {manualIssueCount === 0
              ? '0 issues should need manual review after these safe repairs.'
              : `${manualIssueCount} ${manualIssueCount === 1 ? 'issue' : 'issues'} will still need manual review. Some issues require explicit choices; plugin-managed contents stay manual.`}
          </div>
        </div>
        <button
          aria-controls={reviewPanelId}
          aria-expanded={reviewOpen}
          className={`repair-cta${isAutoResolving ? ' repair-cta--busy' : ''}`}
          disabled={isAutoResolving}
          type="button"
          onClick={() => setReviewOpen((o) => !o)}
        >
          {reviewOpen ? (
            <ChevronUp />
          ) : (
            <>
              Review {totalIssues} safe {totalIssues === 1 ? 'repair' : 'repairs'} for {totalItems} {totalItems === 1 ? 'item' : 'items'}
              <ArrowRight />
            </>
          )}
        </button>
      </div>

      {reviewOpen ? (
        <div className="review-panel review-panel--open" id={reviewPanelId}>
          <div className="review-header">
            <span className="review-header-title">Review planned fixes</span>
          </div>
          <div className="review-body">
            {[...fixesByType.values()].map((fixGroup) => (
              <div className="issue-bucket" key={`${fixGroup.entity}:${fixGroup.issue}`}>
                <div className="issue-bucket-header">
                  <span className="issue-bucket-label">{formatFixGroupLabel(fixGroup)}</span>
                  <span className="issue-bucket-count">{fixGroup.rows.length} {fixGroup.rows.length === 1 ? 'item' : 'items'}</span>
                </div>
                <div className="issue-bucket-rows">
                  {fixGroup.rows.map((row) => (
                    <div className="skill-fix-row" key={row.key}>
                      <span className="skill-fix-name">{row.name}</span>
                      <span className="skill-fix-action">{FIX_ACTION_LABELS[fixGroup.issue] ?? fixGroup.issue}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="review-footer">
            <span className="review-footer-summary">{totalIssues} {totalIssues === 1 ? 'repair' : 'repairs'} · {totalItems} {totalItems === 1 ? 'item' : 'items'} affected</span>
            <button className="review-footer-cancel" type="button" onClick={() => setReviewOpen(false)}>
              Cancel
            </button>
            <button
              className={`review-footer-confirm${isAutoResolving ? ' review-footer-confirm--busy' : ''}`}
              disabled={isAutoResolving}
              type="button"
              onClick={onAutoResolve}
            >
              {isAutoResolving ? (
                'Applying…'
              ) : (
                <>
                  <Check />
                  Apply {totalIssues} {totalIssues === 1 ? 'repair' : 'repairs'}
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function HomeDashboard({
  autoResolvableRequests,
  homeSummary,
  inventorySnapshot,
  isAutoResolving,
  isRescanning,
  onAutoResolve,
  onCancelMcpConnectivityTest,
  onNavigateToSkills,
  onRescan,
  onSelectMcp,
  onSelectSkill,
  onSelectSubagent,
}: {
  autoResolvableRequests: ResolveIssueRequest[];
  homeSummary: ReturnType<typeof getHomeSummary>;
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving: boolean;
  isRescanning: boolean;
  onAutoResolve: () => void;
  onCancelMcpConnectivityTest?: () => void;
  onNavigateToSkills: () => void;
  onRescan: () => Promise<void>;
  onSelectMcp: (mcpName: string) => void;
  onSelectSkill: (skillName: string) => void;
  onSelectSubagent: (subagentName: string) => void;
}) {
  const skillSections = inventorySnapshot ? getSkillSections(inventorySnapshot) : [];
  const mcpSections = inventorySnapshot ? getMcpSections(inventorySnapshot) : [];
  const subagentSections = inventorySnapshot ? getSubagentSections(inventorySnapshot) : [];
  const skillAttentionRows = skillSections.find((section) => section.tone === 'attention')?.rows ?? [];
  const mcpAttentionRows = mcpSections.find((section) => section.tone === 'attention')?.rows ?? [];
  const subagentAttentionRows = subagentSections.find((section) => section.tone === 'attention')?.rows ?? [];
  const lastCheckedLabel = formatLastScanLabel(inventorySnapshot?.scannedAt);
  const subagentSummary = homeSummary.subagents ?? EMPTY_HOME_METRIC;
  const sourceIndex = inventorySnapshot
    ? new Map(inventorySnapshot.sources.map((source) => [source.id, source]))
    : new Map<string, SkillScanSource>();
  const homeMetrics: HomeMetric[] = [
    {
      key: 'skills',
      label: 'Skills',
      total: homeSummary.skills.total,
      unit: 'on disk',
      needsAttention: homeSummary.skills.needsAttention,
      severity: 'alert',
    },
    {
      key: 'subagents',
      label: 'Subagents',
      total: subagentSummary.total,
      unit: 'on disk',
      needsAttention: subagentSummary.needsAttention,
      severity: 'warn',
    },
    {
      key: 'mcps',
      label: 'MCPs',
      total: homeSummary.mcps.total,
      unit: 'servers',
      needsAttention: homeSummary.mcps.needsAttention,
      severity: 'warn',
    },
  ];
  const attentionGroups: HomeAttentionGroup[] = [
    {
      key: 'skills',
      label: 'Skills',
      count: skillAttentionRows.length,
      actionLabel: 'View all skills',
      onAction: onNavigateToSkills,
      items: skillAttentionRows.map((skill) => ({
        badges: toHomeAttentionBadges(getSkillStatusLabels(skill)),
        description: getSkillRowDescription(skill),
        isLocked: hasPluginSkillLocation(skill, sourceIndex),
        key: skill.name,
        label: getSkillDisplayName(skill),
        lockedTooltip: PLUGIN_SKILL_TOOLTIP,
        onClick: () => onSelectSkill(skill.name),
      })),
    },
    {
      key: 'subagents',
      label: 'Subagents',
      count: subagentAttentionRows.length,
      actionLabel: 'View all subagents',
      onAction: () => onSelectSubagent(subagentAttentionRows[0]?.name ?? ''),
      items: subagentAttentionRows.map((subagent) => ({
        badges: toHomeAttentionBadges(getSubagentStatusLabels(subagent)),
        description: subagent.description,
        isLocked: hasPluginSubagentLocation(subagent),
        key: subagent.name,
        label: getSubagentDisplayName(subagent),
        lockedTooltip: PLUGIN_SUBAGENT_TOOLTIP,
        onClick: () => onSelectSubagent(subagent.name),
      })),
    },
    {
      key: 'mcps',
      label: 'MCPs',
      count: mcpAttentionRows.length,
      actionLabel: 'View all MCPs',
      onAction: () => onSelectMcp(mcpAttentionRows[0]?.name ?? ''),
      items: mcpAttentionRows.map((mcp) => ({
        badges: toHomeAttentionBadges(getMcpStatusLabels(mcp)),
        isLocked: hasPluginMcpLocation(mcp),
        key: mcp.name,
        label: getMcpDisplayName(mcp),
        lockedTooltip: PLUGIN_MCP_TOOLTIP,
        onClick: () => onSelectMcp(mcp.name),
      })),
    },
  ];
  const manualReviewTarget = skillAttentionRows.length > 0
    ? {
        label: 'Skills tab',
        onClick: onNavigateToSkills,
      }
    : mcpAttentionRows.length > 0
      ? {
          label: 'MCPs tab',
          onClick: () => onSelectMcp(mcpAttentionRows[0]?.name ?? ''),
        }
      : {
          label: 'Subagents tab',
          onClick: () => onSelectSubagent(subagentAttentionRows[0]?.name ?? ''),
        };

  return (
    <main className="workspace-view">
      <PageTopBar
        actions={(
          <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
        )}
        title="Home"
      />

      <div className="page-scroll page-scroll--dashboard">
        {inventorySnapshot ? (
          <>
            <HomeInventoryMetrics metrics={homeMetrics} />

            <RepairSurface
              autoResolvableRequests={autoResolvableRequests}
              hasAttentionIssues={
                skillAttentionRows.length > 0
                || mcpAttentionRows.length > 0
                || subagentAttentionRows.length > 0
              }
              inventorySnapshot={inventorySnapshot}
              isAutoResolving={isAutoResolving}
              manualReviewTargetLabel={manualReviewTarget.label}
              onAutoResolve={onAutoResolve}
              onViewManualIssues={manualReviewTarget.onClick}
            />

            <HomeNeedsAttentionCard groups={attentionGroups} lastCheckedLabel={lastCheckedLabel} />
          </>
        ) : (
          <EmptyStatePanel message="Loading your inventory summary…" />
        )}
      </div>
    </main>
  );
}

function hasPluginSkillLocation(skill: SkillRecord, sourceIndex: Map<string, SkillScanSource>): boolean {
  return skill.locations.some((location) =>
    location.provenance?.kind === 'plugin' || sourceIndex.get(location.sourceId)?.kind === 'plugin');
}

function hasPluginMcpLocation(mcp: McpRecord): boolean {
  return mcp.locations.some((location) => location.provenance?.kind === 'plugin');
}

function hasPluginSubagentLocation(subagent: SubagentRecord): boolean {
  return subagent.locations.some((location) => location.provenance?.kind === 'plugin');
}
