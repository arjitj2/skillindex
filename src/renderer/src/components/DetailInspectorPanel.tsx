import type { SkillDiffLine } from '@shared/contracts';
import { type ReactNode, useEffect, useState } from 'react';

import type {
  InspectorDefinitionBreakdown,
  InspectorDefinitionFieldComparison,
  InspectorDefinitionFileModel,
  InspectorLocationAction,
  InspectorModel,
  InspectorProvenanceSummaryRow,
  InspectorVariantModel,
} from '../lib/detail-inspector-model';
import { formatDiffLine, formatInspectorDisplayPath, truncateMiddle } from '../lib/inventory-presentation';
import { PLUGIN_MCP_TOOLTIP, PLUGIN_SKILL_TOOLTIP, PLUGIN_SUBAGENT_TOOLTIP, PluginTooltipIndicator } from './ui';

export interface DetailInspectorFooterAction {
  detail?: string;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  shortcut?: string;
  title?: string;
  variant?: 'danger' | 'default' | 'strong' | 'subtle' | 'note';
}

export function DetailInspectorPanel({
  ariaLabel = 'Detail inspector',
  closeLabel = 'Close',
  entityKind = 'skill',
  footerActions,
  model,
  onClose,
  onLocationAction,
  onProvenanceAction,
  onProblemSelect,
  onVariantSelect,
  paneClassName,
  sandboxRoot = null,
  isLocationActionPending = false,
}: {
  ariaLabel?: string;
  closeLabel?: string;
  entityKind?: 'skill' | 'mcp' | 'subagent';
  footerActions?: DetailInspectorFooterAction[];
  model: InspectorModel;
  onClose: () => void;
  onLocationAction?: (action: InspectorLocationAction) => void;
  onProvenanceAction?: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onProblemSelect?: (problemKey: InspectorModel['problems'][number]['key']) => void;
  onVariantSelect?: (path: string) => void;
  paneClassName?: string;
  sandboxRoot?: string | null;
  isLocationActionPending?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'problems' | 'locations' | 'definition'>('problems');
  const formatPath = (value: string, maxLength: number) => truncateMiddle(formatInspectorDisplayPath(value, { sandboxRoot }), maxLength);
  const formatDisplayPath = (value: string) => formatInspectorDisplayPath(value, { sandboxRoot });
  const handleOpenPath = (value: string) => {
    const openPathPromise = window.skillIndex?.openPathInEditor(value);
    void openPathPromise?.catch((error) => {
      console.error('Failed to open file in the default editor.', error);
    });
  };
  useEffect(() => {
    setActiveTab('problems');
  }, [entityKind, model.header.title]);
  const renderCodeBlockHeader = (value: string, maxLength: number, trailingContent?: ReactNode) => (
    <div className="detail-inspector-panel__diff-file-header">
      <button
        aria-label={`Open ${formatInspectorDisplayPath(value, { sandboxRoot })} in the default editor`}
        className="detail-inspector-panel__diff-file-path-button"
        title={`Open ${formatInspectorDisplayPath(value, { sandboxRoot })} in the default editor`}
        type="button"
        onClick={() => handleOpenPath(value)}
      >
        {formatPath(value, maxLength)}
      </button>
      <span className="detail-inspector-panel__diff-file-actions">
        {trailingContent}
      </span>
    </div>
  );
  const activeProblem = model.activeProblem;
  const diffStats = activeProblem.kind === 'variant-resolution'
    ? getDiffStats(activeProblem.diffLines)
    : null;
  const showVariantPreviewHeader = activeProblem.kind === 'variant-resolution'
    ? !((activeProblem.key === 'missing-canonical' || activeProblem.key === 'missing-universal') && !activeProblem.baselineVariant)
    : false;
  const shouldRenderPlainPath = (problemKey: InspectorModel['problems'][number]['key']) =>
    problemKey === 'missing-symlinks' || problemKey === 'broken-symlink';
  const shouldRenderClickablePath = (
    problemKey: InspectorModel['problems'][number]['key'],
    hasSnippet: boolean,
  ) => problemKey === 'wrong-symlink-target'
    || problemKey === 'identical-copies'
    || problemKey === 'missing-from-agents'
    || (problemKey === 'invalid-definition' && !hasSnippet);
  const rootClassName = [
    'inspector-panel',
    'detail-inspector-panel',
    `detail-inspector-panel--${entityKind}`,
    paneClassName,
  ].filter(Boolean).join(' ');
  const pluginTooltip = entityKind === 'mcp'
    ? PLUGIN_MCP_TOOLTIP
    : entityKind === 'subagent'
      ? PLUGIN_SUBAGENT_TOOLTIP
      : PLUGIN_SKILL_TOOLTIP;
  const hasRemoveAction = footerActions?.some((action) => action.variant === 'danger') ?? false;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        activeTab !== 'problems'
        || event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || isKeyboardEventFromEditableElement(event)
      ) {
        return;
      }

      const action = footerActions?.find((candidate) =>
        candidate.shortcut?.toLowerCase() === event.key.toLowerCase());

      if (!action?.onClick || action.disabled) {
        return;
      }

      event.preventDefault();
      action.onClick();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTab, footerActions]);

  return (
    <aside aria-label={ariaLabel} className={rootClassName}>
      <section className="detail-inspector-panel__header-block">
        <div className="detail-inspector-panel__title-row">
          <div className="detail-inspector-panel__title-wrap">
            <h3>
              <span>{model.header.title}</span>
              {model.header.isLocked ? (
                <PluginTooltipIndicator
                  className="detail-inspector-panel__plugin-indicator"
                  focusable
                  tooltip={pluginTooltip}
                />
              ) : null}
            </h3>
          </div>
          <button className="detail-inspector-panel__close-button" type="button" onClick={onClose}>
            {closeLabel}
          </button>
        </div>

        {model.header.description ? (
          <p className="detail-inspector-panel__description">{model.header.description}</p>
        ) : null}

        <div className="detail-inspector-panel__updated-row" aria-label={`${ariaLabel} metadata`}>
          <span className="detail-inspector-panel__updated-copy">{model.header.updatedLabel}</span>
        </div>
      </section>

      {model.provenanceSummary.length > 0 ? (
        <section className="detail-inspector-panel__provenance-block" aria-label={`${ariaLabel} provenance`}>
          {renderProvenanceSummaryRows(model.provenanceSummary, onProvenanceAction)}
        </section>
      ) : null}

      <section className="detail-inspector-panel__tab-block" aria-label={`${ariaLabel} views`}>
        <div className="detail-inspector-panel__tab-list" role="tablist" aria-label={`${ariaLabel} views`}>
          <button
            aria-selected={activeTab === 'problems'}
            className={`detail-inspector-panel__tab${activeTab === 'problems' ? ' detail-inspector-panel__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setActiveTab('problems')}
          >
            <span>Problems</span>
            {model.problems.length > 0 ? (
              <span className="detail-inspector-panel__tab-count">{model.problems.length}</span>
            ) : null}
          </button>
          <button
            aria-selected={activeTab === 'locations'}
            className={`detail-inspector-panel__tab${activeTab === 'locations' ? ' detail-inspector-panel__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setActiveTab('locations')}
          >
            <span>Locations</span>
          </button>
          <button
            aria-selected={activeTab === 'definition'}
            className={`detail-inspector-panel__tab${activeTab === 'definition' ? ' detail-inspector-panel__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => setActiveTab('definition')}
          >
            <span>Definition</span>
          </button>
        </div>
      </section>

      {activeTab === 'problems' && model.problems.length > 0 ? (
        <>
          <section className="detail-inspector-panel__problem-summary-block" aria-label="Problems">
            <div className="detail-inspector-panel__problem-summary">
              <strong>{model.problemCountLabel}</strong>
              <span>Select one to inspect</span>
            </div>
          </section>
          <section aria-label="Problems" className="detail-inspector-panel__problem-list" role="list">
            {model.problems.map((problem) => (
              <div key={problem.key} role="listitem">
                <button
                  aria-label={`${problem.label} ${problem.summary}`}
                  aria-pressed={problem.isActive}
                  className={`detail-inspector-panel__problem-row${problem.isActive ? ' detail-inspector-panel__problem-row--selected' : ''}`}
                  type="button"
                  onClick={() => onProblemSelect?.(problem.key)}
                >
                  <span className="detail-inspector-panel__problem-rail" aria-hidden="true" />
                  <span className="detail-inspector-panel__problem-content">
                    <span className="detail-inspector-panel__problem-copy">
                      <strong>{problem.label}</strong>
                      <span>{problem.detail}</span>
                    </span>
                    <span className="detail-inspector-panel__problem-summary-value">{problem.summary}</span>
                  </span>
                </button>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {activeTab === 'problems' && model.problems.length > 0 ? (
        <section className="detail-inspector-panel__detail-block" aria-label="Selected detail">
          {activeProblem.kind === 'variant-resolution' ? (
            <>
              <div className="detail-inspector-panel__section-header">
                <span className="detail-inspector-panel__section-label">{activeProblem.listTitle}</span>
                <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
              </div>

              <div aria-label={activeProblem.listTitle} className="detail-inspector-panel__variant-stack" role="list">
                {activeProblem.variants.map((variant) => (
                  (() => {
                    const isSelected = variant.path === model.selectedVariantPath;
                    const isCanonical = variant.path === activeProblem.baselineVariant?.path;
                    const isCanonicalComparison = isCanonical && !isSelected && activeProblem.selectedVariant?.path !== activeProblem.baselineVariant?.path;

                    return (
                      <div key={variant.id} role="listitem">
                        <button
                          aria-label={`${variant.label} ${variant.path}`}
                          aria-pressed={isSelected}
                          className={[
                            'detail-inspector-panel__variant-card',
                            entityKind === 'mcp' ? 'detail-inspector-panel__variant-card--mcp' : 'detail-inspector-panel__variant-card--skill',
                            isSelected ? 'detail-inspector-panel__variant-card--selected' : '',
                            isCanonicalComparison ? 'detail-inspector-panel__variant-card--canonical-compare' : '',
                            isCanonical && !isCanonicalComparison && !isSelected ? 'detail-inspector-panel__variant-card--canonical' : '',
                          ].filter(Boolean).join(' ')}
                          type="button"
                          onClick={() => onVariantSelect?.(variant.path)}
                        >
                          <>
                            <span className="detail-inspector-panel__variant-path">{formatPath(variant.path, 62)}</span>
                            {isCanonical ? (
                              <span className="detail-inspector-panel__variant-badges">
                                <span
                                  className={[
                                    'detail-inspector-panel__badge',
                                    isCanonicalComparison ? 'detail-inspector-panel__badge--canonical-compare' : 'detail-inspector-panel__badge--canonical',
                                  ].filter(Boolean).join(' ')}
                                >
                                  Universal
                                </span>
                              </span>
                            ) : null}
                          </>
                        </button>
                      </div>
                    );
                  })()
                ))}
              </div>

              {activeProblem.definitionBreakdown ? (
                <McpDefinitionBreakdownView
                  breakdown={activeProblem.definitionBreakdown}
                  renderCodeBlockHeader={renderCodeBlockHeader}
                />
              ) : activeProblem.changedFiles.length > 0 ? (
                <>
                  {showVariantPreviewHeader ? (
                    <div className="detail-inspector-panel__section-header detail-inspector-panel__section-header--diff">
                      <span className="detail-inspector-panel__section-label">{activeProblem.diffTitle}</span>
                      <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
                    </div>
                  ) : null}

                  {activeProblem.changedFiles.map((file) => (
                    <div className="detail-inspector-panel__diff-block" key={file.path}>
                      {renderCodeBlockHeader(
                        file.absolutePath,
                        64,
                        file.diffLines.length > 0 ? <span>{getDiffStats(file.diffLines)}</span> : null,
                      )}
                      {file.diffLines.length > 0 ? (
                        <div className="detail-inspector-panel__diff-lines">
                          {file.diffLines.map((line, index) => (
                            <div className={`detail-inspector-panel__diff-line detail-inspector-panel__diff-line--${line.type}`} key={`${file.path}-${line.type}-${index}`}>
                              <span className="detail-inspector-panel__diff-line-number">{index + 1}</span>
                              <code className="detail-inspector-panel__diff-line-text">{formatDiffLine(line)}</code>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="detail-inspector-panel__structural-item">
                          <div className="detail-inspector-panel__structural-row">
                            <span className="detail-inspector-panel__structural-copy">
                              <strong>{getDiffFileEmptyStateTitle(file.displayKind)}</strong>
                              <span>{getDiffFileEmptyStateBody(file.displayKind)}</span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              ) : activeProblem.diffLines.length > 0 ? (
                <>
                  {showVariantPreviewHeader ? (
                    <div className="detail-inspector-panel__section-header detail-inspector-panel__section-header--diff">
                      <span className="detail-inspector-panel__section-label">{activeProblem.diffTitle}</span>
                      <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
                    </div>
                  ) : null}

                  <div className="detail-inspector-panel__diff-block">
                    {activeProblem.selectedVariant?.path
                      ? renderCodeBlockHeader(
                        activeProblem.selectedVariant.path,
                        64,
                        diffStats ? <span>{diffStats}</span> : null,
                      )
                      : null}
                    <div className="detail-inspector-panel__diff-lines">
                      {activeProblem.diffLines.map((line, index) => (
                        <div className={`detail-inspector-panel__diff-line detail-inspector-panel__diff-line--${line.type}`} key={`${line.type}-${index}`}>
                          <span className="detail-inspector-panel__diff-line-number">{index + 1}</span>
                          <code className="detail-inspector-panel__diff-line-text">{formatDiffLine(line)}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="detail-inspector-panel__section-header">
                <span className="detail-inspector-panel__section-label">{activeProblem.listTitle}</span>
                <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
              </div>

              <div aria-label={activeProblem.listTitle} className="detail-inspector-panel__structural-list" role="list">
                {activeProblem.items.map((item) => {
                  const wantsPlainStructuralPath = shouldRenderPlainPath(activeProblem.key);
                  const wantsClickableStructuralPath = shouldRenderClickablePath(activeProblem.key, Boolean(item.snippet));
                  const shouldRenderClickableStructuralPath = wantsClickableStructuralPath && item.pathExists !== false;
                  const shouldRenderPlainStructuralPath = wantsPlainStructuralPath || (wantsClickableStructuralPath && !shouldRenderClickableStructuralPath);

                  return (
                    <div className="detail-inspector-panel__structural-item" key={item.id} role="listitem">
                      <div
                        className={[
                          'detail-inspector-panel__structural-row',
                          item.snippet ? 'detail-inspector-panel__structural-row--with-snippet' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <span className="detail-inspector-panel__structural-copy">
                          <span className="detail-inspector-panel__structural-heading">
                            <strong>{item.label}</strong>
                            {item.detail && activeProblem.key !== 'wrong-symlink-target' ? <span className="detail-inspector-panel__structural-detail">{item.detail}</span> : null}
                          </span>
                          {shouldRenderPlainStructuralPath ? (
                            <span
                              className={[
                                'detail-inspector-panel__structural-path',
                                item.pathExists === false ? 'detail-inspector-panel__structural-path--missing' : '',
                              ].filter(Boolean).join(' ')}
                              title={formatInspectorDisplayPath(item.path, { sandboxRoot })}
                            >
                              {formatPath(item.path, 48)}
                            </span>
                          ) : null}
                          {shouldRenderClickableStructuralPath ? (
                            <button
                              aria-label={`Open ${formatInspectorDisplayPath(item.path, { sandboxRoot })} in the default editor`}
                              className="detail-inspector-panel__structural-path-button"
                              title={formatInspectorDisplayPath(item.path, { sandboxRoot })}
                              type="button"
                              onClick={() => handleOpenPath(item.path)}
                            >
                              {formatPath(item.path, 48)}
                            </button>
                          ) : null}
                          {activeProblem.key === 'wrong-symlink-target' && item.detail
                          ? item.detail === 'Missing target'
                            ? (
                              <span
                                className="detail-inspector-panel__structural-subpath"
                                title="Points to Missing target"
                              >
                                {truncateMiddle('Points to Missing target', 64)}
                              </span>
                              )
                            : (
                              <span className="detail-inspector-panel__structural-subpath">
                                <span>Points to </span>
                                <button
                                  aria-label={`Open ${formatInspectorDisplayPath(item.detail, { sandboxRoot })} in the default editor`}
                                  className="detail-inspector-panel__structural-subpath-button"
                                  title={formatInspectorDisplayPath(item.detail, { sandboxRoot })}
                                  type="button"
                                  onClick={() => handleOpenPath(item.detail as string)}
                                >
                                  {truncateMiddle(formatInspectorDisplayPath(item.detail, { sandboxRoot }), 54)}
                                </button>
                              </span>
                              )
                          : null}
                        </span>
                      </div>

                      {item.snippet ? (
                        <div className="detail-inspector-panel__inline-snippet">
                          <div className="detail-inspector-panel__diff-block">
                            {renderCodeBlockHeader(item.path, 64)}
                            <pre className="detail-inspector-panel__snippet-block">
                              <code className="detail-inspector-panel__snippet-text">{item.snippet.text}</code>
                            </pre>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      ) : activeTab === 'problems' && activeProblem.kind === 'structural-repair' && activeProblem.healthySummary ? (
        <section className="detail-inspector-panel__detail-block detail-inspector-panel__detail-block--healthy" aria-label="Selected detail">
          <div className="detail-inspector-panel__healthy-state">
            <div className="detail-inspector-panel__healthy-icon" aria-hidden="true">
              <span>✓</span>
            </div>
            <strong className="detail-inspector-panel__healthy-title">No problems</strong>
            <p className="detail-inspector-panel__healthy-copy">{activeProblem.healthySummary}</p>
          </div>
        </section>
      ) : activeTab === 'definition' ? (
        <section className="detail-inspector-panel__detail-block detail-inspector-panel__detail-block--definition" aria-label="Definition">
          {model.definition.variants.length > 1 ? (
            <>
              <div className="detail-inspector-panel__section-header">
                <span className="detail-inspector-panel__section-label">{model.definition.listTitle}</span>
                <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
              </div>

              <InspectorVariantPicker
                entityKind={entityKind}
                formatPath={formatPath}
                listTitle={model.definition.listTitle}
                onVariantSelect={onVariantSelect}
                selectedPath={model.definition.selectedVariantPath}
                variants={model.definition.variants}
              />
            </>
          ) : null}

          {model.definition.files.length > 0 ? (
            <div className="detail-inspector-panel__definition-file-stack">
              {model.definition.files.map((file) => (
                <DefinitionFileBlock
                  file={file}
                  key={`${file.absolutePath}:${file.relativePath}`}
                  renderCodeBlockHeader={renderCodeBlockHeader}
                />
              ))}
            </div>
          ) : (
            <div className="detail-inspector-panel__healthy-state detail-inspector-panel__healthy-state--compact">
              <strong className="detail-inspector-panel__healthy-title">No definition available</strong>
              <p className="detail-inspector-panel__healthy-copy">{model.definition.emptySummary}</p>
            </div>
          )}
        </section>
      ) : activeTab === 'locations' ? (
        <section className="detail-inspector-panel__detail-block detail-inspector-panel__detail-block--locations" aria-label="Locations">
          {model.locations.map((section) => (
            <div className="detail-inspector-panel__location-section" key={section.id}>
              <div className="detail-inspector-panel__section-header">
                <span className="detail-inspector-panel__section-label">{section.title}</span>
                <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
              </div>

              <div aria-label={section.title} className="detail-inspector-panel__location-list" role="list">
                {section.rows.map((row) => {
                  const locationAction = row.action;

                  return (
                    <div
                      className={[
                        'detail-inspector-panel__location-row',
                        row.label ? '' : 'detail-inspector-panel__location-row--path-only',
                      ].filter(Boolean).join(' ')}
                      key={row.id}
                      role="listitem"
                    >
                      <span className="detail-inspector-panel__location-leading">
                        <span className={`detail-inspector-panel__location-dot detail-inspector-panel__location-dot--${row.tone}`} aria-hidden="true" />
                        {row.label ? (
                          <strong className="detail-inspector-panel__location-label">{renderLocationLabel(row.label)}</strong>
                        ) : null}
                      </span>
                      {row.path ? (
                        <button
                          aria-label={`Open ${formatDisplayPath(row.path)} in the default editor`}
                          className="detail-inspector-panel__location-path-button"
                          title={formatDisplayPath(row.path)}
                          type="button"
                          onClick={() => handleOpenPath(row.path as string)}
                        >
                          {formatDisplayPath(row.path)}
                        </button>
                      ) : (
                        <span className={`detail-inspector-panel__location-path detail-inspector-panel__location-path--${row.tone}`}>
                          {row.pathText}
                        </span>
                      )}
                      <span className="detail-inspector-panel__location-status-cell">
                        <span
                          className={[
                            'detail-inspector-panel__location-status',
                            `detail-inspector-panel__location-status--${row.tone}`,
                            row.statusLabel ? 'detail-inspector-panel__location-status--visible' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {row.statusLabel ?? ''}
                        </span>
                        {locationAction ? (
                          <button
                            className="detail-inspector-panel__location-action"
                            disabled={isLocationActionPending}
                            type="button"
                            onClick={() => onLocationAction?.(locationAction)}
                          >
                            {isLocationActionPending ? 'Applying...' : locationAction.label}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {activeTab === 'problems' && footerActions && footerActions.length > 0 ? (
        <section className={`detail-inspector-panel__footer-block${hasRemoveAction ? ' detail-inspector-panel__footer-block--with-remove' : ''}`}>
          {activeProblem.actionSummary ? (
            <p className="detail-inspector-panel__action-summary">{activeProblem.actionSummary}</p>
          ) : null}
          {footerActions.map((action, actionIndex) => {
            const disabledReasonId = `detail-inspector-footer-action-${actionIndex}-disabled-reason`;
            const visibleDetail = action.variant === 'note' ? null : action.disabled && action.title ? action.title : action.detail;
            if (action.variant === 'note') {
              return (
                <p className="detail-inspector-panel__footer-note" key={action.label} role="note">
                  {action.label}
                </p>
              );
            }

            return (
              <div
                className={[
                  'detail-inspector-panel__footer-action-group',
                  action.variant === 'strong' ? 'detail-inspector-panel__footer-action-group--primary' : '',
                  action.variant === 'subtle' ? 'detail-inspector-panel__footer-action-group--secondary' : '',
                  action.variant === 'danger' ? 'detail-inspector-panel__footer-action-group--danger' : '',
                ].filter(Boolean).join(' ')}
                key={action.label}
              >
                <button
                  aria-keyshortcuts={action.shortcut ? action.shortcut.toUpperCase() : undefined}
                  aria-describedby={visibleDetail ? disabledReasonId : undefined}
                  className={[
                    'detail-inspector-panel__footer-action',
                    action.variant === 'strong' ? 'detail-inspector-panel__footer-action--primary' : '',
                    action.variant === 'subtle' ? 'detail-inspector-panel__footer-action--secondary' : '',
                    action.variant === 'danger' ? 'detail-inspector-panel__footer-action--danger' : '',
                  ].filter(Boolean).join(' ')}
                  disabled={action.disabled}
                  title={action.title}
                  type="button"
                  onClick={action.onClick}
                >
                  <span>{action.label}</span>
                  {action.shortcut ? (
                    <kbd aria-hidden="true" className="detail-inspector-panel__footer-shortcut">
                      {action.shortcut.toUpperCase()}
                    </kbd>
                  ) : null}
                </button>
                {visibleDetail ? (
                  <p className="detail-inspector-panel__footer-action-reason" id={disabledReasonId}>
                    {visibleDetail}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </aside>
  );
}

function isKeyboardEventFromEditableElement(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

function InspectorVariantPicker({
  entityKind,
  formatPath,
  listTitle,
  onVariantSelect,
  selectedPath,
  variants,
}: {
  entityKind: 'skill' | 'mcp' | 'subagent';
  formatPath: (value: string, maxLength: number) => string;
  listTitle: string;
  onVariantSelect?: (path: string) => void;
  selectedPath: string | null;
  variants: InspectorVariantModel[];
}) {
  return (
    <div aria-label={listTitle} className="detail-inspector-panel__variant-stack" role="list">
      {variants.map((variant) => {
        const isSelected = variant.path === selectedPath;
        const isBaseline = variant.isBaseline;
        const variantPrimaryLabel = entityKind === 'mcp' ? variant.label : formatPath(variant.path, 62);
        const variantSecondaryLabel = entityKind === 'mcp' ? variant.secondaryLabel : null;
        const ariaLabel = entityKind === 'mcp'
          ? `${variant.label} ${variant.secondaryLabel} ${variant.path}`
          : `${variant.label} ${variant.path}`;

        return (
          <div key={variant.id} role="listitem">
            <button
              aria-label={ariaLabel}
              aria-pressed={isSelected}
              className={[
                'detail-inspector-panel__variant-card',
                entityKind === 'mcp' ? 'detail-inspector-panel__variant-card--mcp' : 'detail-inspector-panel__variant-card--skill',
                isSelected ? 'detail-inspector-panel__variant-card--selected' : '',
                isBaseline && !isSelected ? 'detail-inspector-panel__variant-card--canonical' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              onClick={() => onVariantSelect?.(variant.path)}
            >
              <>
                {entityKind === 'mcp' ? (
                  <span className="detail-inspector-panel__variant-copy">
                    <strong className="detail-inspector-panel__variant-primary">{variantPrimaryLabel}</strong>
                    {variantSecondaryLabel ? <span>{variantSecondaryLabel}</span> : null}
                  </span>
                ) : (
                  <span className="detail-inspector-panel__variant-path">{variantPrimaryLabel}</span>
                )}
                {variant.badge ? (
                  <span className="detail-inspector-panel__variant-badges">
                    <span className={`detail-inspector-panel__badge${isBaseline ? ' detail-inspector-panel__badge--canonical' : ' detail-inspector-panel__badge--selected'}`}>
                      {variant.badge}
                    </span>
                  </span>
                ) : null}
              </>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DefinitionFileBlock({
  file,
  renderCodeBlockHeader,
}: {
  file: InspectorDefinitionFileModel;
  renderCodeBlockHeader: (value: string, maxLength: number, trailingContent?: ReactNode) => ReactNode;
}) {
  const lines = splitDefinitionFileLines(file.text);
  const trailingContent = file.kind === 'binary'
    ? <span>Binary</span>
    : <span>{formatDefinitionLineCount(lines.length)}</span>;

  return (
    <div className="detail-inspector-panel__diff-block">
      {file.openPath === null ? (
        <StaticDefinitionFileHeader
          displayPath={file.displayPath ?? file.relativePath}
          trailingContent={trailingContent}
        />
      ) : renderCodeBlockHeader(
        file.openPath ?? file.absolutePath,
        64,
        trailingContent,
      )}
      {file.kind === 'text' && lines.length > 0 ? (
        <div className="detail-inspector-panel__diff-lines">
          {lines.map((line, index) => (
            <div className="detail-inspector-panel__diff-line" key={`${file.absolutePath}-${index}`}>
              <span className="detail-inspector-panel__diff-line-number">{index + 1}</span>
              <code className="detail-inspector-panel__diff-line-text">{line}</code>
            </div>
          ))}
        </div>
      ) : (
        <div className="detail-inspector-panel__structural-item">
          <div className="detail-inspector-panel__structural-row">
            <span className="detail-inspector-panel__structural-copy">
              <strong>{file.kind === 'binary' ? 'Binary file' : 'No text content'}</strong>
              <span>{file.kind === 'binary' ? 'This definition file is not renderable as text.' : 'This definition file is empty.'}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StaticDefinitionFileHeader({
  displayPath,
  trailingContent,
}: {
  displayPath: string;
  trailingContent?: ReactNode;
}) {
  return (
    <div className="detail-inspector-panel__diff-file-header">
      <span className="detail-inspector-panel__diff-file-path-label">{displayPath}</span>
      <span className="detail-inspector-panel__diff-file-actions">
        {trailingContent}
      </span>
    </div>
  );
}

function McpDefinitionBreakdownView({
  breakdown,
  renderCodeBlockHeader,
}: {
  breakdown: InspectorDefinitionBreakdown;
  renderCodeBlockHeader: (value: string, maxLength: number, trailingContent?: ReactNode) => ReactNode;
}) {
  return (
    <>
      <div className="detail-inspector-panel__section-header detail-inspector-panel__section-header--diff">
        <span className="detail-inspector-panel__section-label">Definition Breakdown</span>
        <span className="detail-inspector-panel__section-rule" aria-hidden="true" />
      </div>

      <div className="detail-inspector-panel__definition-breakdown">
        <div className="detail-inspector-panel__definition-subsection">
          <div className="detail-inspector-panel__definition-subsection-header">
            <strong>Compared Fields</strong>
            <span>Only these fields decide whether agents agree.</span>
          </div>
          <div className="detail-inspector-panel__definition-field-list">
            {breakdown.comparedFields.map((field) => (
              <DefinitionFieldRow field={field} key={field.key} />
            ))}
          </div>
        </div>

        <div className="detail-inspector-panel__definition-subsection">
          <div className="detail-inspector-panel__definition-subsection-header">
            <strong>Agent-specific settings</strong>
            <span>These settings are preserved during repair.</span>
          </div>
          {breakdown.ignoredSettings.length > 0 ? (
            <div className="detail-inspector-panel__ignored-setting-list">
              {breakdown.ignoredSettings.map((setting) => (
                <div className="detail-inspector-panel__ignored-setting" key={setting.key}>
                  <span className="detail-inspector-panel__ignored-setting-name">{setting.label}</span>
                  <span className="detail-inspector-panel__ignored-setting-source">{setting.sources.join(', ')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="detail-inspector-panel__definition-empty-copy">No agent-specific settings are present for this selection.</p>
          )}
        </div>

        <div className="detail-inspector-panel__definition-subsection">
          <div className="detail-inspector-panel__definition-subsection-header">
            <strong>Raw Configs</strong>
            <span>Source snippets are shown for audit and debugging.</span>
          </div>
          <div className="detail-inspector-panel__raw-config-stack">
            {breakdown.rawConfigs.map((config) => (
              <div className="detail-inspector-panel__diff-block" key={`${config.label}:${config.path}`}>
                {renderCodeBlockHeader(config.path, 64, <span>{config.label}</span>)}
                <pre className="detail-inspector-panel__snippet-block">
                  <code className="detail-inspector-panel__snippet-text">{config.text}</code>
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function DefinitionFieldRow({ field }: { field: InspectorDefinitionFieldComparison }) {
  return (
    <div className={`detail-inspector-panel__definition-field detail-inspector-panel__definition-field--${field.status}`}>
      <div className="detail-inspector-panel__definition-field-heading">
        <strong>{field.label}</strong>
        <span>{formatDefinitionFieldStatus(field.status)}</span>
      </div>
      <div className="detail-inspector-panel__definition-field-values">
        <DefinitionFieldValue label="Reference" values={field.referenceValue} />
        <DefinitionFieldValue label="Selected" values={field.selectedValue} />
      </div>
    </div>
  );
}

function renderProvenanceSummaryRows(
  rows: InspectorModel['provenanceSummary'],
  onProvenanceAction: ((action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void) | undefined,
) {
  const sourceTypeRow = rows.find((row) => row.id === 'source-type');
  const sourceRow = rows.find((row) => row.id === 'source');

  if (sourceTypeRow && sourceRow) {
    return [
      <div className="detail-inspector-panel__provenance-row detail-inspector-panel__provenance-row--combined" key="source-summary">
        <div className="detail-inspector-panel__provenance-pair">
          <span>{sourceTypeRow.label}</span>
          {renderProvenanceSummaryValue(sourceTypeRow, onProvenanceAction)}
        </div>
        <div className="detail-inspector-panel__provenance-pair">
          <span>{sourceRow.label}</span>
          {renderProvenanceSummaryValue(sourceRow, onProvenanceAction)}
        </div>
      </div>,
      ...rows
        .filter((row) => row.id !== sourceTypeRow.id && row.id !== sourceRow.id)
        .map((row) => renderProvenanceSummaryRow(row, onProvenanceAction)),
    ];
  }

  return rows.map((row) => renderProvenanceSummaryRow(row, onProvenanceAction));
}

function renderProvenanceSummaryRow(
  row: InspectorModel['provenanceSummary'][number],
  onProvenanceAction: ((action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void) | undefined,
) {
  return (
    <div className="detail-inspector-panel__provenance-row" key={row.id}>
      <span>{row.label}</span>
      {renderProvenanceSummaryValue(row, onProvenanceAction)}
    </div>
  );
}

function renderProvenanceSummaryValue(
  row: InspectorModel['provenanceSummary'][number],
  onProvenanceAction: ((action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void) | undefined,
) {
  const action = row.action;

  if (action && onProvenanceAction) {
    return (
      <button
        className="detail-inspector-panel__source-link"
        type="button"
        onClick={() => onProvenanceAction?.(action)}
      >
        {row.value}
      </button>
    );
  }

  if (row.href) {
    return (
      <a
        className="detail-inspector-panel__source-link"
        href={row.href}
        rel="noreferrer"
        target="_blank"
      >
        {row.value}
      </a>
    );
  }

  return <strong>{row.value}</strong>;
}

function DefinitionFieldValue({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="detail-inspector-panel__definition-value">
      <span className="detail-inspector-panel__definition-value-label">{label}</span>
      <span className="detail-inspector-panel__definition-value-items">
        {values.map((value) => (
          <code className="detail-inspector-panel__definition-value-chip" key={`${label}:${value}`}>
            {value}
          </code>
        ))}
      </span>
    </div>
  );
}

function renderLocationLabel(label: string): ReactNode {
  const pluginLabel = splitPluginLocationLabel(label);
  if (!pluginLabel) {
    return label;
  }

  return (
    <>
      <span className="detail-inspector-panel__location-label-line detail-inspector-panel__location-label-line--plugin-host">
        {pluginLabel.hostLabel}
      </span>
      <span className="detail-inspector-panel__location-label-line">{pluginLabel.pluginName}</span>
    </>
  );
}

function splitPluginLocationLabel(label: string): { hostLabel: string; pluginName: string } | null {
  const match = /^(.+ Plugin)\s+(.+)$/u.exec(label);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    hostLabel: match[1],
    pluginName: match[2],
  };
}

function formatDefinitionFieldStatus(status: InspectorDefinitionFieldComparison['status']): string {
  switch (status) {
    case 'different':
      return 'Differs';
    case 'selected-only':
      return 'Selected only';
    case 'reference-only':
      return 'Reference only';
    case 'same':
    default:
      return 'Same';
  }
}

function getDiffStats(diffLines: SkillDiffLine[]): string | null {
  let added = 0;
  let removed = 0;
  for (const line of diffLines) {
    if (line.type === 'added') {
      added += 1;
    } else if (line.type === 'removed') {
      removed += 1;
    }
  }
  return added > 0 || removed > 0 ? `+${added} / -${removed}` : null;
}

function splitDefinitionFileLines(text: string | null): string[] {
  if (text === null || text.length === 0) {
    return [];
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function formatDefinitionLineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

function getDiffFileEmptyStateTitle(displayKind: 'diff' | 'preview' | 'unchanged'): string {
  switch (displayKind) {
    case 'unchanged':
      return 'No change in selected version';
    case 'preview':
    case 'diff':
    default:
      return 'No inline diff available';
  }
}

function getDiffFileEmptyStateBody(displayKind: 'diff' | 'preview' | 'unchanged'): string {
  switch (displayKind) {
    case 'unchanged':
      return 'This file is part of the affected package set, but it does not change for the currently selected version.';
    case 'preview':
    case 'diff':
    default:
      return 'Skill Index detected a package change here, but this file is binary or not renderable as text.';
  }
}
