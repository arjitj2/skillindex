import { Check, ChevronDown, Info, Wrench } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { ResolveIssueRequest, SkillInventorySnapshot } from '@shared/contracts';

import { getAutoRepairSummary } from '../lib/auto-repair';
import { getMcpDisplayName, getSkillDisplayName } from '../inventory-view-model';

const FIX_ACTION_LABELS: Record<string, string> = {
  'missing-symlinks': 'Create missing symlinks',
  'identical-copies': 'Convert copies to symlinks',
  'missing-canonical': 'Promote to universal',
  'missing-universal': 'Add to Universal',
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

export function AutoRepairReviewPanel({
  autoResolvableRequests,
  id,
  inventorySnapshot,
  isAutoResolving,
  onAutoResolve,
  onCancel,
}: {
  autoResolvableRequests: ResolveIssueRequest[];
  id: string;
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving: boolean;
  onAutoResolve: () => void;
  onCancel: () => void;
}) {
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
  const { totalIssues, totalItems } = getAutoRepairSummary(autoResolvableRequests);

  return (
    <div className="review-panel review-panel--open" id={id}>
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
        <button className="review-footer-cancel" type="button" onClick={onCancel}>
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
  );
}

export function ScopedAutoRepairControl({
  activeIssueCount,
  autoResolvableRequests,
  inventorySnapshot,
  isAutoResolving,
  onAutoResolve,
}: {
  activeIssueCount: number;
  autoResolvableRequests: ResolveIssueRequest[];
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving: boolean;
  onAutoResolve: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const reviewPanelId = useId();
  const { totalIssues } = getAutoRepairSummary(autoResolvableRequests);

  useEffect(() => {
    if (!reviewOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setReviewOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setReviewOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [reviewOpen]);

  useEffect(() => {
    if (autoResolvableRequests.length === 0) {
      setReviewOpen(false);
    }
  }, [autoResolvableRequests.length]);

  if (totalIssues === 0 && activeIssueCount > 0) {
    return (
      <div className="scoped-repair-control">
        <div
          aria-label={`${activeIssueCount} ${activeIssueCount === 1 ? 'issue needs' : 'issues need'} manual review. No safe auto-resolutions available.`}
          className="scoped-repair-empty"
          title={`${activeIssueCount} ${activeIssueCount === 1 ? 'issue needs' : 'issues need'} manual review.`}
        >
          <Info aria-hidden="true" />
          <span>No safe auto-resolutions</span>
        </div>
      </div>
    );
  }

  if (totalIssues === 0) {
    return null;
  }

  return (
    <div className="scoped-repair-control" ref={rootRef}>
      <button
        aria-controls={reviewPanelId}
        aria-expanded={reviewOpen}
        className="scoped-repair-trigger"
        disabled={isAutoResolving}
        type="button"
        onClick={() => setReviewOpen((current) => !current)}
      >
        <Wrench aria-hidden="true" />
        <span>
          Review {totalIssues} safe{' '}
          {totalIssues === 1 ? 'auto-resolution' : 'auto-resolutions'}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>

      {reviewOpen ? (
        <div className="scoped-repair-popover">
          <AutoRepairReviewPanel
            autoResolvableRequests={autoResolvableRequests}
            id={reviewPanelId}
            inventorySnapshot={inventorySnapshot}
            isAutoResolving={isAutoResolving}
            onAutoResolve={onAutoResolve}
            onCancel={() => setReviewOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function getResolveRequestDisplayName(
  request: ResolveIssueRequest,
  inventorySnapshot: SkillInventorySnapshot | null,
): string {
  if (request.entity === 'skill') {
    const skill = inventorySnapshot?.skills.find((entry) => entry.name === request.skillName);
    return skill ? getSkillDisplayName(skill) : request.skillName;
  }

  if (request.entity === 'subagent') {
    const subagent = inventorySnapshot?.subagents?.find((entry) => entry.name === request.subagentName);
    return subagent?.displayName ?? request.subagentName;
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

function getFixGroupKey(request: ResolveIssueRequest): string {
  return `${request.entity}:${request.issue}`;
}

function formatFixGroupLabel(group: Pick<PlannedFixGroup, 'entity' | 'issue'>): string {
  return `${FIX_ENTITY_LABELS[group.entity]} • ${FIX_TYPE_LABELS[group.issue] ?? group.issue}`;
}
