import type {
  AddSubagentRequest,
  DismissDriftRequest,
  RemoveInventoryItemRequest,
  ResolveIssueRequest,
  SkillInventorySnapshot,
  SubagentIssueReason,
  SubagentRecord,
} from '@shared/contracts';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';

import {
  getSubagentDisplayName,
  getSubagentSections,
  hasSearchQuery,
} from '../inventory-view-model';
import {
  filterVisibleSections,
  getPillToneForSubagent,
  getSubagentStatusLabels,
  type SubagentStatusFilter,
} from '../lib/inventory-presentation';
import type { InspectorModel, InspectorProvenanceSummaryRow } from '../lib/detail-inspector-model';
import { getSubagentResolveActionState } from '../lib/issue-resolution';
import { DetailInspectorPanel } from '../components/DetailInspectorPanel';
import {
  EmptyStatePanel,
  HeaderSearch,
  InventoryKeyboardHint,
  InventoryListRow,
  InventorySectionBlock,
  PageTopBar,
  PLUGIN_SUBAGENT_TOOLTIP,
  RescanToolbarButton,
  WorkspaceFilterBar,
} from '../components/ui';

export function SubagentsWorkspaceView({
  addActionControl,
  inventorySnapshot,
  isDismissingDrift,
  isResolvingIssue,
  isRemovingInventoryItem = false,
  isRescanning,
  onCancelMcpConnectivityTest,
  onClearSelection,
  onDismissDrift,
  onOpenPluginSource,
  onRequestRemove = () => undefined,
  onResolveIssue,
  onRescan,
  onSearchQueryChange,
  onSelectProblem,
  onSelectSubagent,
  onSelectVariant,
  onStatusFilterChange,
  rows,
  sandboxRoot,
  searchInputRef,
  searchQuery,
  selectedSubagent,
  selectedSubagentInspectorModel,
  selectedSubagentProblemKey,
  statusFilter,
}: {
  addActionControl?: ReactNode;
  inventorySnapshot: SkillInventorySnapshot | null;
  isDismissingDrift: boolean;
  isResolvingIssue: boolean;
  isRemovingInventoryItem?: boolean;
  isRescanning: boolean;
  onCancelMcpConnectivityTest?: () => void;
  onClearSelection: () => void;
  onDismissDrift: (request: DismissDriftRequest) => Promise<void>;
  onOpenPluginSource: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onRequestRemove?: (request: RemoveInventoryItemRequest, label: string) => void;
  onResolveIssue: (request: ResolveIssueRequest) => Promise<void>;
  onRescan: () => Promise<void>;
  onSearchQueryChange: (query: string) => void;
  onSelectProblem: (problemKey: SubagentIssueReason | null) => void;
  onSelectSubagent: (name: string | null) => void;
  onSelectVariant: (path: string | null) => void;
  onStatusFilterChange: (filter: SubagentStatusFilter) => void;
  rows: SubagentRecord[];
  sandboxRoot: string | null;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedSubagent: SubagentRecord | null;
  selectedSubagentInspectorModel: InspectorModel | null;
  selectedSubagentProblemKey: SubagentIssueReason | null;
  statusFilter: SubagentStatusFilter;
}) {
  const sections = filterVisibleSections(inventorySnapshot ? getSubagentSections(inventorySnapshot) : [], rows);
  const filters = inventorySnapshot?.subagentCounts
    ? [
        { label: 'All', count: inventorySnapshot.subagentCounts.totalSubagents, value: 'all' as const, tone: 'neutral' as const },
        { label: 'Needs attention', count: inventorySnapshot.subagentCounts.attentionSubagents, value: 'active' as const, tone: 'attention' as const },
        { label: 'Dismissed', count: inventorySnapshot.subagentCounts.dismissedAttentionSubagents, value: 'dismissed' as const, tone: 'muted' as const },
        { label: 'Healthy', count: inventorySnapshot.subagentCounts.healthySubagents, value: 'none' as const, tone: 'healthy' as const },
      ]
    : [];
  const emptyStateMessage = inventorySnapshot?.subagentCounts
    ? getSubagentEmptyStateMessage({
        searchQuery,
        statusFilter,
        totalSubagents: inventorySnapshot.subagentCounts.totalSubagents,
      })
    : 'Scanning your subagent inventory...';

  useEffect(() => {
    if (!selectedSubagent) {
      return;
    }

    scrollSelectedInventoryRowIntoView('Subagent list');
  }, [selectedSubagent]);

  return (
    <main className="workspace-view">
      <PageTopBar
        actions={(
          <div className="header-action-cluster">
            <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
            {addActionControl}
          </div>
        )}
        search={(
          <HeaderSearch
            inputRef={searchInputRef}
            label="Search subagents"
            onChange={onSearchQueryChange}
            placeholder="Search subagents..."
            query={searchQuery}
          />
        )}
        title="Subagents"
      />

      <div className="page-scroll page-scroll--split">
        <WorkspaceFilterBar
          activeFilter={statusFilter}
          ariaLabel="Subagent filters"
          filters={filters}
          onFilterChange={onStatusFilterChange}
          trailing={<InventoryKeyboardHint />}
        />

        <div className={`split-workspace split-workspace--detail${selectedSubagent ? '' : ' split-workspace--detail-collapsed'}`}>
          <section className="master-list-panel" aria-label="Subagent list">
            {inventorySnapshot ? (
              sections.length > 0 ? (
                sections.map((section) => (
                  <InventorySectionBlock
                    key={section.title}
                    count={section.rows.length}
                    title={section.title.toUpperCase()}
                  >
                    {section.rows.map((row) => (
                      <InventoryListRow
                        badges={getSubagentStatusLabels(row).map((label) => ({
                          label,
                          tone: getPillToneForSubagent(row),
                        }))}
                        description={row.description ?? undefined}
                        isLocked={hasPluginSubagentLocation(row)}
                        isSelected={selectedSubagent?.name === row.name}
                        lockedTooltip={PLUGIN_SUBAGENT_TOOLTIP}
                        key={row.name}
                        name={getSubagentDisplayName(row)}
                        onClick={() => onSelectSubagent(row.name)}
                      />
                    ))}
                  </InventorySectionBlock>
                ))
              ) : (
                <EmptyStatePanel message={emptyStateMessage} />
              )
            ) : (
              <EmptyStatePanel message="Scanning your subagent inventory..." />
            )}
          </section>

          {selectedSubagent ? (
            <SubagentDetailPanel
              isDismissingDrift={isDismissingDrift}
              isResolvingIssue={isResolvingIssue}
              isRemovingInventoryItem={isRemovingInventoryItem}
              inventorySnapshot={inventorySnapshot}
              onClearSelection={onClearSelection}
              onDismissDrift={onDismissDrift}
              onOpenPluginSource={onOpenPluginSource}
              onRequestRemove={onRequestRemove}
              onSelectProblem={onSelectProblem}
              onSelectVariant={onSelectVariant}
              onResolveIssue={onResolveIssue}
              sandboxRoot={sandboxRoot}
              selectedSubagentInspectorModel={selectedSubagentInspectorModel}
              selectedSubagentProblemKey={selectedSubagentProblemKey}
              subagent={selectedSubagent}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SubagentDetailPanel({
  isDismissingDrift,
  isResolvingIssue,
  isRemovingInventoryItem,
  inventorySnapshot,
  onClearSelection,
  onDismissDrift,
  onOpenPluginSource,
  onRequestRemove,
  onSelectProblem,
  onSelectVariant,
  onResolveIssue,
  sandboxRoot,
  selectedSubagentInspectorModel,
  selectedSubagentProblemKey,
  subagent,
}: {
  isDismissingDrift: boolean;
  isResolvingIssue: boolean;
  isRemovingInventoryItem: boolean;
  inventorySnapshot: SkillInventorySnapshot | null;
  onClearSelection: () => void;
  onDismissDrift: (request: DismissDriftRequest) => Promise<void>;
  onOpenPluginSource: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onRequestRemove: (request: RemoveInventoryItemRequest, label: string) => void;
  onSelectProblem: (problemKey: SubagentIssueReason | null) => void;
  onSelectVariant: (path: string | null) => void;
  onResolveIssue: (request: ResolveIssueRequest) => Promise<void>;
  sandboxRoot: string | null;
  selectedSubagentInspectorModel: InspectorModel | null;
  selectedSubagentProblemKey: SubagentIssueReason | null;
  subagent: SubagentRecord;
}) {
  if (!selectedSubagentInspectorModel) {
    return null;
  }

  const resolveAction = getSubagentResolveActionState(subagent, selectedSubagentInspectorModel, inventorySnapshot);

  return (
    <DetailInspectorPanel
      entityKind="subagent"
      footerActions={[
        ...(selectedSubagentInspectorModel.activeProblem.primaryActionLabel
          ? [{
            disabled: !resolveAction.request || isResolvingIssue,
            label: isResolvingIssue ? 'Applying…' : selectedSubagentInspectorModel.activeProblem.primaryActionLabel,
            onClick: () => {
              if (!resolveAction.request) {
                return;
              }

              void onResolveIssue(resolveAction.request);
            },
            shortcut: 'F',
            title: resolveAction.disabledReason ?? undefined,
            variant: 'strong' as const,
          }]
          : []),
        ...(selectedSubagentInspectorModel.activeProblem.key === 'invalid-definition'
          ? [{
            label: 'Click a file name above to open it, then fix the definition.',
            variant: 'note' as const,
          }]
          : []),
        ...(subagent.status === 'needs-attention'
          ? [{
            disabled: isDismissingDrift,
            label: getSubagentDismissActionLabel(subagent, isDismissingDrift),
            onClick: () => {
              void onDismissDrift({ subagentName: subagent.name });
            },
            shortcut: 'D',
            variant: 'subtle' as const,
          }]
          : []),
        {
          disabled: isRemovingInventoryItem,
          label: isRemovingInventoryItem ? 'Removing...' : 'Remove',
          onClick: () => {
            onRequestRemove({
              entity: 'subagent',
              subagentName: subagent.name,
            }, subagent.displayName ?? subagent.name);
          },
          shortcut: 'R',
          variant: 'danger' as const,
        },
      ]}
      model={selectedSubagentInspectorModel}
      ariaLabel="Subagent detail"
      paneClassName={`subagent-inspector-panel${selectedSubagentProblemKey ? ' subagent-inspector-panel--problem-selected' : ''}`}
      sandboxRoot={sandboxRoot}
      onClose={onClearSelection}
      onProvenanceAction={onOpenPluginSource}
      onProblemSelect={(problemKey: InspectorModel['problems'][number]['key']) => {
        onSelectProblem(problemKey as SubagentIssueReason);
      }}
      onVariantSelect={(path: string) => {
        onSelectVariant(path);
      }}
    />
  );
}

function getSubagentEmptyStateMessage({
  searchQuery,
  statusFilter,
  totalSubagents,
}: {
  searchQuery: string;
  statusFilter: SubagentStatusFilter;
  totalSubagents: number;
}): string {
  if (hasSearchQuery(searchQuery)) {
    return `No subagents match "${searchQuery.trim()}".`;
  }

  if (totalSubagents === 0) {
    return 'No subagents were found in the agent folders Skill Index scanned.';
  }

  switch (statusFilter) {
    case 'active':
      return 'No subagents needing attention found.';
    case 'none':
      return 'No healthy subagents found.';
    case 'dismissed':
      return 'No dismissed subagents found.';
    default:
      return 'No subagents found.';
  }
}

export function AddSubagentModal({
  isSubmitting,
  onClose,
  onSubmit,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (request: AddSubagentRequest) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSubmitting, onClose]);

  useEffect(() => {
    setSubmitError(null);
  }, [markdown, name]);

  const canSubmit = name.trim().length > 0 && markdown.trim().length > 0;

  return (
    <div className="add-skill-modal-root" role="presentation">
      <div className="add-skill-modal-backdrop" />
      <section aria-label="Add Subagent" aria-modal="true" className="add-skill-modal add-subagent-modal" role="dialog">
        <div className="add-skill-modal__header">
          <h3>Add Subagent</h3>
          <button
            aria-label="Close Add Subagent modal"
            className="add-skill-modal__close"
            disabled={isSubmitting}
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <form
          className="add-skill-modal__body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || isSubmitting) {
              return;
            }

            const request: AddSubagentRequest = {
              sourceType: 'definition',
              name,
              format: 'markdown-frontmatter',
              definition: markdown,
            };

            void onSubmit(request).catch((error) => {
              setSubmitError(error instanceof Error ? error.message : 'Unable to add Subagent.');
            });
          }}
        >
          <label className="add-skill-modal__field">
            <span>Subagent name</span>
            <input
              className="add-skill-modal__input add-skill-modal__input--mono"
              placeholder="reviewer"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>

          <label className="add-skill-modal__field">
            <span>Markdown contents</span>
            <textarea
              className="add-skill-modal__textarea add-skill-modal__input--mono"
              placeholder={'---\nname: reviewer\ndescription: Reviews implementation changes.\n---\nReview the diff and call out correctness risks.'}
              value={markdown}
              onChange={(event) => {
                setMarkdown(event.target.value);
              }}
            />
          </label>

          {submitError ? <p className="add-skill-modal__error">{submitError}</p> : null}

          <div className="add-skill-modal__actions">
            <button
              className="add-skill-modal__button add-skill-modal__button--secondary"
              disabled={isSubmitting}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="add-skill-modal__button add-skill-modal__button--primary"
              disabled={!canSubmit || isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Adding Subagent…' : 'Add Subagent'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function getSubagentDismissActionLabel(subagent: SubagentRecord, isDismissingDrift: boolean): string {
  const isDismissed = subagent.presentation === 'dismissed';

  if (isDismissingDrift) {
    return isDismissed ? 'Undismissing issues with this subagent…' : 'Dismissing issues with this subagent…';
  }

  return isDismissed ? 'Undismiss issues with this subagent' : 'Dismiss issues with this subagent';
}

function hasPluginSubagentLocation(subagent: SubagentRecord): boolean {
  return subagent.locations.some((location) =>
    location.agentId.startsWith('plugin:')
    || location.provenance?.kind === 'plugin');
}

function scrollSelectedInventoryRowIntoView(ariaLabel: string) {
  window.requestAnimationFrame(() => {
    const list = document.querySelector<HTMLElement>(`[aria-label="${ariaLabel}"]`);
    const selectedRow = list?.querySelector<HTMLElement>('.master-list-row--selected');
    selectedRow?.scrollIntoView?.({ block: 'nearest' });
  });
}
