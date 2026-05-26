import { AlertCircle, ArrowRight, Check, ChevronUp, Wrench } from 'lucide-react';
import { useState } from 'react';

import type { McpRecord, ResolveIssueRequest, SkillInventorySnapshot, SkillRecord, SkillScanSource } from '@shared/contracts';

import { getHomeSummary, getMcpDisplayName, getMcpSections, getSkillDisplayName, getSkillSections } from '../inventory-view-model';
import {
  getPillToneForMcp,
  getPillToneForSkill,
  getMcpStatusLabels,
  getSkillStatusLabels,
  getSkillRowDescription,
  getDisplaySkillIssueReasons,
  formatLastScanLabel,
} from '../lib/inventory-presentation';
import {
  AttentionGroupCard,
  EmptyStatePanel,
  PageTopBar,
  PLUGIN_MCP_TOOLTIP,
  PLUGIN_SKILL_TOOLTIP,
  RescanToolbarButton,
} from '../components/ui';

const FIX_ACTION_LABELS: Record<string, string> = {
  'missing-symlinks': 'Create missing symlinks',
  'identical-copies': 'Convert copies to symlinks',
  'missing-canonical': 'Promote to universal',
  'broken-symlink': 'Relink to canonical',
  'missing-from-agents': 'Add to missing agents',
};

const FIX_TYPE_LABELS: Record<string, string> = {
  'missing-symlinks': 'Missing Symlinks',
  'identical-copies': 'Identical Copies',
  'missing-canonical': 'Missing Universal',
  'broken-symlink': 'Broken Symlink',
  'missing-from-agents': 'Missing From Agents',
};

interface PlannedFixRow {
  key: string;
  name: string;
}

function getResolveRequestDisplayName(
  request: ResolveIssueRequest,
  inventorySnapshot: SkillInventorySnapshot | null,
): string {
  if (request.entity === 'skill') {
    const skill = inventorySnapshot?.skills.find((entry) => entry.name === request.skillName);
    return skill ? getSkillDisplayName(skill) : request.skillName;
  }

  const mcp = inventorySnapshot?.mcps?.find((entry) => entry.name === request.mcpName);
  return mcp ? getMcpDisplayName(mcp) : request.mcpName;
}

function getResolveRequestKey(request: ResolveIssueRequest): string {
  return [
    request.entity,
    request.skillName ?? request.mcpName,
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

  return skillIssueCount + mcpIssueCount;
}

function RepairError({ errorMessage }: { errorMessage: string | null }) {
  if (!errorMessage) {
    return null;
  }

  return (
    <div className="repair-error">
      <AlertCircle />
      {errorMessage}
    </div>
  );
}

function RepairSurface({
  autoResolvableRequests,
  errorMessage,
  hasAttentionIssues,
  inventorySnapshot,
  isAutoResolving,
  onAutoResolve,
  onViewSkills,
}: {
  autoResolvableRequests: ResolveIssueRequest[];
  errorMessage: string | null;
  hasAttentionIssues: boolean;
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving: boolean;
  onAutoResolve: () => void;
  onViewSkills: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewPanelId = 'home-auto-repair-review-panel';

  const fixesByType = autoResolvableRequests.reduce<Map<string, PlannedFixRow[]>>((acc, req) => {
    const names = acc.get(req.issue) ?? [];
    names.push({
      key: getResolveRequestKey(req),
      name: getResolveRequestDisplayName(req, inventorySnapshot),
    });
    acc.set(req.issue, names);
    return acc;
  }, new Map());

  const totalIssues = autoResolvableRequests.length;
  const totalItems = new Set(autoResolvableRequests.map((r) => r.skillName ?? r.mcpName)).size;
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
            <p>All skills and MCPs are healthy — nothing needs attention right now.</p>
          </div>
        </div>
        <RepairError errorMessage={errorMessage} />
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
            <button className="repair-surface-link" type="button" onClick={onViewSkills}>
              Skills tab
            </button>
            .
          </div>
        </div>
        <RepairError errorMessage={errorMessage} />
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

      <RepairError errorMessage={errorMessage} />

      {reviewOpen ? (
        <div className="review-panel review-panel--open" id={reviewPanelId}>
          <div className="review-header">
            <span className="review-header-title">Review planned fixes</span>
          </div>
          <div className="review-body">
            {[...fixesByType.entries()].map(([issueType, fixRows]) => (
              <div className="issue-bucket" key={issueType}>
                <div className="issue-bucket-header">
                  <span className="issue-bucket-label">{FIX_TYPE_LABELS[issueType] ?? issueType}</span>
                  <span className="issue-bucket-count">{fixRows.length} {fixRows.length === 1 ? 'item' : 'items'}</span>
                </div>
                <div className="issue-bucket-rows">
                  {fixRows.map((row) => (
                    <div className="skill-fix-row" key={row.key}>
                      <span className="skill-fix-name">{row.name}</span>
                      <span className="skill-fix-action">{FIX_ACTION_LABELS[issueType] ?? issueType}</span>
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
  errorMessage,
  homeSummary,
  inventorySnapshot,
  isAutoResolving,
  isRescanning,
  onAutoResolve,
  onNavigateToSkills,
  onRescan,
  onSelectMcp,
  onSelectSkill,
}: {
  autoResolvableRequests: ResolveIssueRequest[];
  errorMessage: string | null;
  homeSummary: ReturnType<typeof getHomeSummary>;
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving: boolean;
  isRescanning: boolean;
  onAutoResolve: () => void;
  onNavigateToSkills: () => void;
  onRescan: () => Promise<void>;
  onSelectMcp: (mcpName: string) => void;
  onSelectSkill: (skillName: string) => void;
}) {
  const skillSections = inventorySnapshot ? getSkillSections(inventorySnapshot) : [];
  const mcpSections = inventorySnapshot ? getMcpSections(inventorySnapshot) : [];
  const skillAttentionRows = skillSections.find((section) => section.tone === 'attention')?.rows ?? [];
  const mcpAttentionRows = mcpSections.find((section) => section.tone === 'attention')?.rows ?? [];
  const lastCheckedLabel = formatLastScanLabel(inventorySnapshot?.scannedAt);
  const sourceIndex = inventorySnapshot
    ? new Map(inventorySnapshot.sources.map((source) => [source.id, source]))
    : new Map<string, SkillScanSource>();


  return (
    <main className="workspace-view">
      <PageTopBar
        actions={(
          <RescanToolbarButton isRescanning={isRescanning} onRescan={onRescan} />
        )}
        title="Home"
      />

      <div className="page-scroll page-scroll--dashboard">
        {inventorySnapshot ? (
          <>
            <section aria-label="Home summary metrics" className="stat-card-grid">
              <div className="stat-card">
                <div className="stat-card-label">Skills</div>
                <div className="stat-card-row">
                  <div className="stat-item">
                    <div className="stat-num">{homeSummary.skills.total}</div>
                    <div className="stat-sub">on disk</div>
                  </div>
                  <div className="stat-divider" />
                  <div className="stat-item">
                    <div className={`stat-num${homeSummary.skills.needsAttention > 0 ? ' stat-num--alert' : ' stat-num--muted'}`}>
                      {homeSummary.skills.needsAttention}
                    </div>
                    <div className="stat-sub">need attention</div>
                  </div>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-card-label">MCPs</div>
                <div className="stat-card-row">
                  <div className="stat-item">
                    <div className="stat-num">{homeSummary.mcps.total}</div>
                    <div className="stat-sub">servers</div>
                  </div>
                  <div className="stat-divider" />
                  <div className="stat-item">
                    <div className={`stat-num${homeSummary.mcps.needsAttention > 0 ? ' stat-num--warn' : ' stat-num--muted'}`}>
                      {homeSummary.mcps.needsAttention}
                    </div>
                    <div className="stat-sub">need attention</div>
                  </div>
                </div>
              </div>
            </section>

            <RepairSurface
              autoResolvableRequests={autoResolvableRequests}
              errorMessage={errorMessage}
              hasAttentionIssues={skillAttentionRows.length > 0 || mcpAttentionRows.length > 0}
              inventorySnapshot={inventorySnapshot}
              isAutoResolving={isAutoResolving}
              onAutoResolve={onAutoResolve}
              onViewSkills={onNavigateToSkills}
            />

            <AttentionGroupCard
              actionLabel="View all skills"
              count={skillAttentionRows.length}
              emptyState={{
                title: `All ${homeSummary.skills.total} ${homeSummary.skills.total === 1 ? 'skill is' : 'skills are'} in their expected state`,
                description: `Canonical sources present, symlinks resolved, no version drift. Last checked ${lastCheckedLabel}.`,
              }}
              emptyMessage="Nothing needs attention right now."
              items={skillAttentionRows.map((skill) => ({
                badges: getSkillStatusLabels(skill).map((label) => ({
                  label,
                  tone: getPillToneForSkill(skill),
                })),
                description: getSkillRowDescription(skill),
                isLocked: hasPluginSkillLocation(skill, sourceIndex),
                key: skill.name,
                label: getSkillDisplayName(skill),
                lockedTooltip: PLUGIN_SKILL_TOOLTIP,
                onClick: () => onSelectSkill(skill.name),
              }))}
              onAction={() => onSelectSkill(skillAttentionRows[0]?.name ?? '')}
              title="Skills needing attention"
            />

            <AttentionGroupCard
              actionLabel="View all MCPs"
              count={mcpAttentionRows.length}
              emptyState={{
                title: `All ${homeSummary.mcps.total} MCP ${homeSummary.mcps.total === 1 ? 'server is' : 'servers are'} healthy`,
                description: `Configs match across all agents, versions aligned, no args drift. Last checked ${lastCheckedLabel}.`,
              }}
              emptyMessage="No MCPs need attention right now."
              items={mcpAttentionRows.map((mcp) => ({
                badges: getMcpStatusLabels(mcp).map((label) => ({
                  label,
                  tone: getPillToneForMcp(mcp),
                })),
                isLocked: hasPluginMcpLocation(mcp),
                key: mcp.name,
                label: getMcpDisplayName(mcp),
                lockedTooltip: PLUGIN_MCP_TOOLTIP,
                onClick: () => onSelectMcp(mcp.name),
              }))}
              onAction={() => onSelectMcp(mcpAttentionRows[0]?.name ?? '')}
              title="MCPs needing attention"
            />
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
