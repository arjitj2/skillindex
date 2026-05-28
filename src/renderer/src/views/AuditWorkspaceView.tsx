import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';

import type { AuditAction, AuditOperation, AuditStateSummary } from '@shared/contracts';

import { HeaderSearch, PageTopBar, RescanToolbarButton } from '../components/ui';

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

interface AuditEventRow {
  action: AuditAction | null;
  id: string;
  operation: AuditOperation;
}

export function AuditWorkspaceView({
  auditOperations,
  isRescanning,
  isUndoingOperation,
  onCancelMcpConnectivityTest,
  onUndoOperation,
  onRescan,
  searchInputRef,
  searchQuery,
  setSearchQuery,
}: {
  auditOperations: AuditOperation[];
  isRescanning: boolean;
  isUndoingOperation: boolean;
  onCancelMcpConnectivityTest?: () => void;
  onUndoOperation: (operationId: string) => void;
  onRescan: () => Promise<void>;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}) {
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);
  const eventRows = useMemo(() => flattenAuditOperations(auditOperations), [auditOperations]);
  const filteredRows = useMemo(
    () => filterAuditRows(eventRows, searchQuery),
    [eventRows, searchQuery],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePageIndex * pageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);
  const visibleRange = filteredRows.length === 0
    ? '0 of 0'
    : `${pageStart + 1}-${pageStart + pageRows.length} of ${filteredRows.length}`;

  useEffect(() => {
    setPageIndex(0);
    setExpandedRowIds(new Set());
  }, [pageSize, searchQuery]);

  useEffect(() => {
    if (pageIndex !== safePageIndex) {
      setPageIndex(safePageIndex);
    }
  }, [pageIndex, safePageIndex]);

  const toggleRow = (rowId: string) => {
    setExpandedRowIds((currentRows) => {
      const nextRows = new Set(currentRows);
      if (nextRows.has(rowId)) {
        nextRows.delete(rowId);
      } else {
        nextRows.add(rowId);
      }
      return nextRows;
    });
  };

  return (
    <main className="workspace-view workspace-view--audit">
      <PageTopBar
        actions={(
          <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
        )}
        title="Audit Log"
        search={(
          <HeaderSearch
            inputRef={searchInputRef}
            label="Search audit log"
            onChange={setSearchQuery}
            placeholder="Search operations or paths..."
            query={searchQuery}
          />
        )}
      />

      <section className="audit-table-shell" aria-label="Audit events panel">
        <div className="audit-table-toolbar">
          <div className="audit-table-toolbar__summary">
            <strong>{visibleRange}</strong>
            <span>Newest first</span>
          </div>
          <div className="audit-table-toolbar__actions">
            <label className="audit-page-size">
              <span>Rows</span>
              <select
                aria-label="Audit rows per page"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <button
              className="audit-page-button"
              disabled={safePageIndex === 0}
              type="button"
              onClick={() => setPageIndex((currentPage) => Math.max(0, currentPage - 1))}
            >
              Previous page
            </button>
            <span className="audit-page-indicator">Page {safePageIndex + 1} of {pageCount}</span>
            <button
              className="audit-page-button"
              disabled={safePageIndex >= pageCount - 1}
              type="button"
              onClick={() => setPageIndex((currentPage) => Math.min(pageCount - 1, currentPage + 1))}
            >
              Next page
            </button>
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="audit-empty-state">
            <strong>{auditOperations.length === 0 ? 'No audit entries' : 'No matching audit entries'}</strong>
            <p>{auditOperations.length === 0 ? 'App-made changes will appear here.' : 'Try a different audit search.'}</p>
          </div>
        ) : (
          <div className="audit-event-table" role="table" aria-label="Audit events">
            <div className="audit-event-table__header" role="row">
              <span role="columnheader">Time</span>
              <span role="columnheader">Change</span>
              <span role="columnheader">Entity</span>
              <span role="columnheader">Path</span>
            </div>
            {pageRows.map((row) => (
              <AuditEventTableRow
                isExpanded={expandedRowIds.has(row.id)}
                isUndoingOperation={isUndoingOperation}
                key={row.id}
                row={row}
                onUndoOperation={onUndoOperation}
                onToggle={() => toggleRow(row.id)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function AuditEventTableRow({
  isExpanded,
  isUndoingOperation,
  onUndoOperation,
  onToggle,
  row,
}: {
  isExpanded: boolean;
  isUndoingOperation: boolean;
  onUndoOperation: (operationId: string) => void;
  onToggle: () => void;
  row: AuditEventRow;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const action = row.action;
  const title = action?.title ?? row.operation.title;
  const path = action?.path ?? row.operation.summary;
  const eventTime = action?.completedAt ?? row.operation.completedAt ?? row.operation.startedAt;
  const failure = row.operation.failure;
  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState('idle');
    }, copyState === 'copied' ? 1800 : 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyState]);

  const handleCopyFailureTrace = () => {
    if (!failure?.trace) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      return;
    }

    void navigator.clipboard.writeText(failure.trace)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'));
  };

  return (
    <>
      <div className="audit-event-row" role="row">
        <span className="audit-event-row__time" role="cell">{formatDateTime(eventTime)}</span>
        <span className="audit-event-row__event" role="cell">
          <button
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} audit row ${title}`}
            className="audit-row-expander"
            type="button"
            onClick={onToggle}
          >
            <span aria-hidden="true">{isExpanded ? '-' : '+'}</span>
          </button>
          <span className="audit-event-row__copy">
            <strong>{title}</strong>
          </span>
        </span>
        <span className="audit-event-row__entity" role="cell">
          {formatAuditEntity(row.operation)}
        </span>
        <code className="audit-event-row__path" role="cell">{path}</code>
      </div>
      {isExpanded ? (
        <div className="audit-expanded-row" role="row">
          <div className="audit-expanded-row__content" role="cell">
            <div className="audit-expanded-row__details">
              <DetailItem label="Parent operation" value={row.operation.title} variant="wide" />
              <DetailItem label="Change" value={action ? formatAuditKind(action.kind) : formatAuditKind(row.operation.kind)} />
              <DetailItem label="Before" value={formatStateSummary(action?.before)} variant="wide" />
              <DetailItem label="After" value={formatStateSummary(action?.after)} variant="wide" />
              {failure ? (
                <DetailItem
                  action={failure.trace ? (
                    <button
                      aria-label={copyState === 'copied'
                        ? 'Failure trace copied'
                        : copyState === 'failed'
                          ? 'Copy failure trace failed'
                          : 'Copy failure trace'}
                      className={[
                        'audit-copy-trace-button',
                        copyState === 'copied' ? 'audit-copy-trace-button--copied' : '',
                        copyState === 'failed' ? 'audit-copy-trace-button--failed' : '',
                      ].filter(Boolean).join(' ')}
                      title="Copy failure trace"
                      type="button"
                      onClick={handleCopyFailureTrace}
                    >
                      <span className="audit-copy-trace-button__icon" aria-hidden="true">
                        <Copy className="audit-copy-trace-button__glyph audit-copy-trace-button__glyph--copy" strokeWidth={2} />
                        <Check className="audit-copy-trace-button__glyph audit-copy-trace-button__glyph--check" strokeWidth={2.3} />
                      </span>
                      <span>{copyState === 'failed' ? 'Copy failed' : 'Copy trace'}</span>
                    </button>
                  ) : null}
                  label="Failure"
                  value={failure.message}
                  variant="wide"
                />
              ) : null}
              <DetailItem label="Path" value={path} variant="wide" />
            </div>
            <div className="audit-undo-panel">
              {row.operation.undoState === 'available' ? (
                <button
                  className="audit-undo-button"
                  disabled={isUndoingOperation}
                  type="button"
                  onClick={() => onUndoOperation(row.operation.id)}
                >
                  {isUndoingOperation ? 'Undoing...' : 'Undo operation'}
                </button>
              ) : (
                <button className="audit-undo-button" disabled type="button">
                  {formatAuditUndoHeading(row.operation.undoState)}
                </button>
              )}
              <p>{formatAuditUndoDescription(row.operation.undoState)}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DetailItem({
  action,
  label,
  value,
  variant = 'normal',
}: {
  action?: ReactNode;
  label: string;
  value: string;
  variant?: 'normal' | 'wide';
}) {
  return (
    <div className={`audit-detail-item audit-detail-item--${variant}`}>
      <span className="audit-detail-item__label-row">
        <span className="audit-detail-item__label">{label}</span>
        {action ? <span className="audit-detail-item__action">{action}</span> : null}
      </span>
      <code>{value}</code>
    </div>
  );
}

function flattenAuditOperations(operations: AuditOperation[]): AuditEventRow[] {
  return operations.flatMap<AuditEventRow>((operation) => {
    if (operation.actions.length === 0) {
      return [{
        id: `${operation.id}:operation`,
        operation,
        action: null,
      }];
    }

    return operation.actions.map((action) => ({
      id: `${operation.id}:${action.id}`,
      operation,
      action,
    }));
  });
}

function filterAuditRows(rows: AuditEventRow[], query: string): AuditEventRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return rows;
  }

  return rows.filter((row) => [
    row.operation.title,
    row.operation.summary,
    row.operation.entity?.name,
    row.action?.title,
    row.action?.summary,
    row.action?.path,
    row.action?.targetPath,
    row.action?.kind,
    row.operation.failure?.message,
    row.operation.failure?.trace,
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
}

function formatAuditKind(kind: string): string {
  return kind.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatAuditUndoHeading(undoState: AuditOperation['undoState']): string {
  switch (undoState) {
    case 'available':
      return 'Undo available';
    case 'blocked':
      return 'Undo blocked';
    case 'expired':
      return 'Undo expired';
    case 'used':
      return 'Undone';
    case 'not-undoable':
      return 'Not undoable';
  }
}

function formatAuditUndoDescription(undoState: AuditOperation['undoState']): string {
  switch (undoState) {
    case 'available':
      return 'This will restore the operation to its previous recorded state.';
    case 'blocked':
      return 'The current filesystem state no longer matches the recorded after-state.';
    case 'expired':
      return 'Only the latest completed change from this app session can be undone.';
    case 'used':
      return 'This operation has already been undone.';
    case 'not-undoable':
      return 'This operation did not record a reversible before-state.';
  }
}

function formatAuditEntity(operation: AuditOperation): string {
  if (!operation.entity) {
    return 'App';
  }
  return operation.entity.name
    ? `${formatAuditKind(operation.entity.type)}: ${operation.entity.name}`
    : formatAuditKind(operation.entity.type);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatStateSummary(state: AuditStateSummary | undefined): string {
  if (!state) {
    return 'Not captured';
  }
  if (state.kind === 'symlink' && state.symlinkTarget) {
    return `symlink -> ${state.symlinkTarget}`;
  }
  if (state.kind === 'directory' && typeof state.itemCount === 'number') {
    return `directory - ${state.itemCount} items`;
  }
  if ((state.kind === 'file' || state.kind === 'config') && typeof state.size === 'number') {
    return `${state.kind} - ${state.size} bytes`;
  }
  return state.kind;
}
