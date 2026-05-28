import type {
  AddSkillRequest,
  CapabilityActionRequest,
  DismissDriftRequest,
  ResolveIssueRequest,
  SkillIssueReason,
  SkillInventorySnapshot,
  SkillRecord,
  SkillScanSource,
} from '@shared/contracts';
import { useEffect, useState, type RefObject } from 'react';

import { getSkillDisplayName, getSkillSections, hasSearchQuery } from '../inventory-view-model';
import {
  filterVisibleSections,
  getPillToneForSkill,
  getSkillStatusLabels,
  getSkillRowDescription,
  type SkillStatusFilter,
} from '../lib/inventory-presentation';
import { getSkillResolveActionState } from '../lib/issue-resolution';
import type { InspectorLocationAction, InspectorModel, InspectorProvenanceSummaryRow } from '../lib/detail-inspector-model';
import { DetailInspectorPanel } from '../components/DetailInspectorPanel';
import {
  EmptyStatePanel,
  HeaderSearch,
  InventoryKeyboardHint,
  InventoryListRow,
  InventorySectionBlock,
  PageTopBar,
  PLUGIN_SKILL_TOOLTIP,
  RescanToolbarButton,
  ToolbarButton,
  WorkspaceFilterBar,
} from '../components/ui';

export function SkillsWorkspaceView({
  isAddingSkill,
  errorMessage,
  inventorySnapshot,
  isDismissingDrift,
  isApplyingCapabilityAction,
  isResolvingIssue,
  isRescanning,
  onAddSkill,
  onCancelMcpConnectivityTest,
  onClearSelection,
  onDismissDrift,
  onApplyCapabilityAction,
  onOpenPluginSource,
  onResolveIssue,
  onRescan,
  rows,
  sandboxRoot,
  searchInputRef,
  searchQuery,
  selectedSkill,
  selectedSkillInspectorModel,
  selectedSkillProblemKey,
  setSearchQuery,
  setSelectedSkillProblemKey,
  setSelectedSkillName,
  setSelectedSkillVariantPath,
  setSelectionOverrideSkillName,
  setStatusFilter,
  sourceIndex,
  statusFilter,
}: {
  isAddingSkill: boolean;
  errorMessage: string | null;
  inventorySnapshot: SkillInventorySnapshot | null;
  isDismissingDrift: boolean;
  isApplyingCapabilityAction: boolean;
  isResolvingIssue: boolean;
  isRescanning: boolean;
  onAddSkill: (request: AddSkillRequest) => Promise<void>;
  onCancelMcpConnectivityTest?: () => void;
  onClearSelection: () => void;
  onDismissDrift: (request: DismissDriftRequest) => Promise<void>;
  onApplyCapabilityAction: (request: CapabilityActionRequest) => Promise<void>;
  onOpenPluginSource: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onResolveIssue: (request: ResolveIssueRequest) => Promise<void>;
  onRescan: () => Promise<void>;
  rows: SkillRecord[];
  sandboxRoot: string | null;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedSkill: SkillRecord | null;
  selectedSkillInspectorModel: InspectorModel | null;
  selectedSkillProblemKey: SkillIssueReason | null;
  setSearchQuery: (query: string) => void;
  setSelectedSkillProblemKey: (problemKey: SkillIssueReason | null) => void;
  setSelectedSkillName: (name: string | null) => void;
  setSelectedSkillVariantPath: (path: string | null) => void;
  setSelectionOverrideSkillName: (name: string | null) => void;
  setStatusFilter: (filter: SkillStatusFilter) => void;
  sourceIndex: Map<string, SkillScanSource>;
  statusFilter: SkillStatusFilter;
}) {
  const sections = filterVisibleSections(inventorySnapshot ? getSkillSections(inventorySnapshot) : [], rows);
  const filters = inventorySnapshot
    ? [
        { label: 'All', count: inventorySnapshot.counts.totalSkills, value: 'all' as const, tone: 'neutral' as const },
        { label: 'Needs attention', count: inventorySnapshot.counts.driftedSkills, value: 'active' as const, tone: 'attention' as const },
        { label: 'Healthy', count: inventorySnapshot.counts.healthySkills, value: 'none' as const, tone: 'healthy' as const },
        { label: 'Dismissed', count: inventorySnapshot.counts.dismissedDriftSkills, value: 'dismissed' as const, tone: 'muted' as const },
      ]
    : [];
  const emptyStateMessage = inventorySnapshot
    ? getSkillsEmptyStateMessage({
        searchQuery,
        statusFilter,
        totalSkills: inventorySnapshot.counts.totalSkills,
      })
    : 'Scanning your skill inventory…';
  const [isAddSkillModalOpen, setIsAddSkillModalOpen] = useState(false);

  useEffect(() => {
    if (!selectedSkill) {
      return;
    }

    scrollSelectedInventoryRowIntoView('Skills list');
  }, [selectedSkill]);

  return (
    <>
      <main className="workspace-view">
        <PageTopBar
          actions={(
            <div className="header-action-cluster">
              <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
              <ToolbarButton
                label="Add Skill"
                variant="strong"
                onClick={() => {
                  setIsAddSkillModalOpen(true);
                }}
              />
            </div>
          )}
          search={(
            <HeaderSearch
              inputRef={searchInputRef}
              label="Search skills"
              onChange={(query) => {
                setSelectionOverrideSkillName(null);
                setSearchQuery(query);
              }}
              placeholder="Search by name or description..."
              query={searchQuery}
            />
          )}
          title="Skills"
        />

        <div className="page-scroll page-scroll--split">
          <WorkspaceFilterBar
            activeFilter={statusFilter}
            ariaLabel="Skill filters"
            filters={filters}
            onFilterChange={(value) => {
              setSelectionOverrideSkillName(null);
              setStatusFilter(value);
            }}
            trailing={<InventoryKeyboardHint />}
          />

          <div className={`split-workspace split-workspace--detail${selectedSkill ? '' : ' split-workspace--detail-collapsed'}`}>
            <section className="master-list-panel" aria-label="Skills list">
              {errorMessage ? <p className="inline-error-banner">{errorMessage}</p> : null}
              {inventorySnapshot ? (
                sections.length > 0 ? (
                  sections.map((section) => (
                    <InventorySectionBlock
                      key={section.title}
                      count={section.rows.length}
                      title={section.title.toUpperCase()}
                    >
                      {section.rows.map((skill) => (
                        <InventoryListRow
                          badges={getSkillStatusLabels(skill).map((label) => ({
                            label,
                            tone: getPillToneForSkill(skill),
                          }))}
                          description={getSkillRowDescription(skill)}
                          isSelected={selectedSkill?.name === skill.name}
                          isLocked={hasPluginSkillLocation(skill, sourceIndex)}
                          lockedTooltip={PLUGIN_SKILL_TOOLTIP}
                          key={skill.name}
                          name={getSkillDisplayName(skill)}
                          onClick={() => {
                            setSelectionOverrideSkillName(null);
                            setSelectedSkillName(skill.name);
                          }}
                        />
                      ))}
                    </InventorySectionBlock>
                  ))
                ) : (
                  <EmptyStatePanel message={emptyStateMessage} />
                )
              ) : (
                <EmptyStatePanel message="Scanning your skill inventory…" />
              )}
            </section>

            {selectedSkill ? (
              <SkillDetailPanel
                errorMessage={errorMessage}
                isDismissingDrift={isDismissingDrift}
                isApplyingCapabilityAction={isApplyingCapabilityAction}
                isResolvingIssue={isResolvingIssue}
                onClearSelection={onClearSelection}
                onDismissDrift={onDismissDrift}
                onApplyCapabilityAction={onApplyCapabilityAction}
                onResolveIssue={onResolveIssue}
                onOpenPluginSource={onOpenPluginSource}
                sandboxRoot={sandboxRoot}
                selectedSkill={selectedSkill}
                selectedSkillInspectorModel={selectedSkillInspectorModel}
                selectedSkillProblemKey={selectedSkillProblemKey}
                setSelectedSkillProblemKey={setSelectedSkillProblemKey}
                setSelectedSkillVariantPath={setSelectedSkillVariantPath}
                sourceIndex={sourceIndex}
              />
            ) : null}
          </div>
        </div>
      </main>

      {isAddSkillModalOpen ? (
        <AddSkillModal
          isSubmitting={isAddingSkill}
          onClose={() => {
            if (!isAddingSkill) {
              setIsAddSkillModalOpen(false);
            }
          }}
          onSubmit={async (request) => {
            await onAddSkill(request);
            setIsAddSkillModalOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function getSkillsEmptyStateMessage({
  searchQuery,
  statusFilter,
  totalSkills,
}: {
  searchQuery: string;
  statusFilter: SkillStatusFilter;
  totalSkills: number;
}): string {
  if (hasSearchQuery(searchQuery)) {
    return `No skills match "${searchQuery.trim()}".`;
  }

  if (totalSkills === 0) {
    return 'No skills were found in the locations Skill Index scanned.';
  }

  switch (statusFilter) {
    case 'active':
      return 'No skills needing attention found.';
    case 'dismissed':
      return 'No dismissed skills found.';
    case 'none':
      return 'No healthy skills found.';
    default:
      return 'No skills found.';
  }
}

function SkillDetailPanel({
  errorMessage,
  isDismissingDrift,
  isApplyingCapabilityAction,
  isResolvingIssue,
  onClearSelection,
  onDismissDrift,
  onApplyCapabilityAction,
  onOpenPluginSource,
  onResolveIssue,
  sandboxRoot,
  selectedSkill,
  selectedSkillInspectorModel,
  selectedSkillProblemKey,
  setSelectedSkillProblemKey,
  setSelectedSkillVariantPath,
  sourceIndex,
}: {
  errorMessage: string | null;
  isDismissingDrift: boolean;
  isApplyingCapabilityAction: boolean;
  isResolvingIssue: boolean;
  onClearSelection: () => void;
  onDismissDrift: (request: DismissDriftRequest) => Promise<void>;
  onApplyCapabilityAction: (request: CapabilityActionRequest) => Promise<void>;
  onOpenPluginSource: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onResolveIssue: (request: ResolveIssueRequest) => Promise<void>;
  sandboxRoot: string | null;
  selectedSkill: SkillRecord;
  selectedSkillInspectorModel: InspectorModel | null;
  selectedSkillProblemKey: SkillIssueReason | null;
  setSelectedSkillProblemKey: (problemKey: SkillIssueReason | null) => void;
  setSelectedSkillVariantPath: (path: string | null) => void;
  sourceIndex: Map<string, SkillScanSource>;
}) {
  const inspectorModel = selectedSkillInspectorModel;
  const resolveAction = getSkillResolveActionState(selectedSkill, inspectorModel, sourceIndex);
  const activeProblem = inspectorModel?.activeProblem ?? null;

  if (!inspectorModel) {
    return null;
  }

  return (
    <DetailInspectorPanel
      entityKind="skill"
      errorMessage={errorMessage}
      footerActions={[
        ...(activeProblem?.primaryActionLabel
          ? [{
            disabled: !resolveAction.request || isResolvingIssue,
            label: isResolvingIssue ? 'Applying…' : activeProblem.primaryActionLabel,
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
        ...(activeProblem?.key === 'invalid-definition'
          ? [{
            label: 'Click a file name above to open it, then fix the definition.',
            variant: 'note' as const,
          }]
          : []),
        ...(selectedSkill.driftPresentation === 'active'
          || selectedSkill.driftPresentation === 'dismissed'
          ? [{
            disabled: isDismissingDrift,
            label: isDismissingDrift
              ? (selectedSkill.driftPresentation === 'dismissed' ? 'Undismissing issues with this skill…' : 'Dismissing issues with this skill…')
              : (selectedSkill.driftPresentation === 'dismissed' ? 'Undismiss issues with this skill' : 'Dismiss issues with this skill'),
            onClick: () => {
              void onDismissDrift({ skillName: selectedSkill.name });
            },
            shortcut: 'D',
            variant: 'subtle' as const,
          }]
          : []),
      ]}
      model={inspectorModel}
      ariaLabel="Skill detail"
      paneClassName={`skill-inspector-panel${selectedSkillProblemKey ? ' skill-inspector-panel--problem-selected' : ''}`}
      sandboxRoot={sandboxRoot}
      isLocationActionPending={isApplyingCapabilityAction}
      onClose={onClearSelection}
      onLocationAction={(action: InspectorLocationAction) => {
        if (action.kind === 'choose-skill-universal-version') {
          void onApplyCapabilityAction({
            entity: 'skill',
            action: 'choose-universal-version',
            skillName: selectedSkill.name,
            selectedVariantPath: action.path,
          });
        }
      }}
      onProvenanceAction={onOpenPluginSource}
      onProblemSelect={(problemKey: InspectorModel['problems'][number]['key']) => {
        setSelectedSkillProblemKey(problemKey as SkillIssueReason);
      }}
      onVariantSelect={(path: string) => {
        setSelectedSkillVariantPath(path);
      }}
    />
  );
}

function scrollSelectedInventoryRowIntoView(ariaLabel: string) {
  window.requestAnimationFrame(() => {
    const list = document.querySelector<HTMLElement>(`[aria-label="${ariaLabel}"]`);
    const selectedRow = list?.querySelector<HTMLElement>('.master-list-row--selected');
    selectedRow?.scrollIntoView?.({ block: 'nearest' });
  });
}

function hasPluginSkillLocation(skill: SkillRecord, sourceIndex: Map<string, SkillScanSource>): boolean {
  return skill.locations.some((location) =>
    location.provenance?.kind === 'plugin' || sourceIndex.get(location.sourceId)?.kind === 'plugin');
}

function AddSkillModal({
  isSubmitting,
  onClose,
  onSubmit,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (request: AddSkillRequest) => Promise<void>;
}) {
  const [sourceType, setSourceType] = useState<AddSkillRequest['sourceType']>('url');
  const [source, setSource] = useState('');
  const [skillName, setSkillName] = useState('');
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
  }, [markdown, skillName, source, sourceType]);

  const canSubmit = sourceType === 'url'
    ? source.trim().length > 0
    : skillName.trim().length > 0 && markdown.trim().length > 0;

  return (
    <div className="add-skill-modal-root" role="presentation">
      <div className="add-skill-modal-backdrop" />
      <section aria-label="Add skill" aria-modal="true" className="add-skill-modal" role="dialog">
        <div className="add-skill-modal__header">
          <h3>Add skill</h3>
          <button
            aria-label="Close add skill modal"
            className="add-skill-modal__close"
            disabled={isSubmitting}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="add-skill-modal__tabs" role="tablist" aria-label="Add skill source">
          <button
            aria-selected={sourceType === 'url'}
            className={`add-skill-modal__tab${sourceType === 'url' ? ' add-skill-modal__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => {
              setSourceType('url');
            }}
          >
            From a URL
          </button>
          <button
            aria-selected={sourceType === 'markdown'}
            className={`add-skill-modal__tab${sourceType === 'markdown' ? ' add-skill-modal__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => {
              setSourceType('markdown');
            }}
          >
            Paste Markdown
          </button>
        </div>

        <form
          className="add-skill-modal__body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || isSubmitting) {
              return;
            }

            const request: AddSkillRequest = sourceType === 'url'
              ? {
                  sourceType: 'url',
                  source,
                }
              : {
                  sourceType: 'markdown',
                  skillName,
                  markdown,
                };

            void onSubmit(request).catch((error) => {
              setSubmitError(error instanceof Error ? error.message : 'Unable to add skill.');
            });
          }}
        >
          {sourceType === 'url' ? (
            <>
              <label className="add-skill-modal__field">
                <span>Repository or skill URL</span>
                <input
                  className="add-skill-modal__input add-skill-modal__input--mono"
                  placeholder="https://github.com/owner/repo or …/repo/tree/main/skills/my-skill"
                  type="text"
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                  }}
                />
              </label>
              <p className="add-skill-modal__note">
                Paste a GitHub repo URL to install all skills, or a path to a specific skill folder.
              </p>
            </>
          ) : (
            <>
              <label className="add-skill-modal__field">
                <span>Skill name</span>
                <input
                  className="add-skill-modal__input add-skill-modal__input--mono"
                  placeholder="my-skill-name"
                  type="text"
                  value={skillName}
                  onChange={(event) => {
                    setSkillName(event.target.value);
                  }}
                />
              </label>
              <label className="add-skill-modal__field">
                <span>SKILL.md contents</span>
                <textarea
                  className="add-skill-modal__textarea add-skill-modal__input--mono"
                  placeholder="# my-skill&#10;&#10;Paste your skill Markdown here…"
                  value={markdown}
                  onChange={(event) => {
                    setMarkdown(event.target.value);
                  }}
                />
              </label>
            </>
          )}

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
              {isSubmitting ? 'Adding skill…' : 'Add skill'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
