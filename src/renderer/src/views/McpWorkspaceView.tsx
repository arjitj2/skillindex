import type {
  AddMcpServerRequest,
  DismissDriftRequest,
  McpIssueReason,
  McpRecord,
  RemoteMcpTransportKind,
  RemoveInventoryItemRequest,
  ResolveIssueRequest,
  SkillInventorySnapshot,
} from '@shared/contracts';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';

import { getMcpDisplayName, getMcpSections, hasSearchQuery } from '../inventory-view-model';
import {
  filterVisibleSections,
  getPillToneForMcp,
  getMcpStatusLabels,
  type McpStatusFilter,
} from '../lib/inventory-presentation';
import { getActiveIssueCountForAutoRepairScope } from '../lib/auto-repair';
import { getMcpResolveActionState } from '../lib/issue-resolution';
import type { InspectorModel, InspectorProvenanceSummaryRow } from '../lib/detail-inspector-model';
import { ScopedAutoRepairControl } from '../components/AutoRepairReview';
import { DetailInspectorPanel } from '../components/DetailInspectorPanel';
import {
  EmptyStatePanel,
  HeaderSearch,
  InventoryKeyboardHint,
  InventoryListRow,
  InventorySectionBlock,
  PageTopBar,
  PLUGIN_MCP_TOOLTIP,
  RescanToolbarButton,
  WorkspaceFilterBar,
} from '../components/ui';
import { scrollSelectedInventoryRowIntoView, useCloseOnEscape } from '../lib/inventory-workspace-dom';

export function McpWorkspaceView({
  addActionControl,
  autoResolvableRequests = [],
  inventorySnapshot,
  isAutoResolving = false,
  isDismissingDrift,
  isResolvingIssue,
  isRemovingInventoryItem = false,
  isRescanning,
  mcp,
  mcpInspectorModel,
  sandboxRoot,
  onAutoResolve = () => undefined,
  onCancelMcpConnectivityTest,
  onClearSelection,
  onDismissDrift,
  onOpenPluginSource,
  onRequestRemove = () => undefined,
  onResolveIssue,
  onRescan,
  onSearchQueryChange,
  onSelectMcp,
  onSelectProblem,
  onSelectVariant,
  onStatusFilterChange,
  rows,
  searchInputRef,
  searchQuery,
  statusFilter,
}: {
  addActionControl?: ReactNode;
  autoResolvableRequests?: ResolveIssueRequest[];
  inventorySnapshot: SkillInventorySnapshot | null;
  isAutoResolving?: boolean;
  isDismissingDrift: boolean;
  isResolvingIssue: boolean;
  isRemovingInventoryItem?: boolean;
  isRescanning: boolean;
  mcp: McpRecord | null;
  mcpInspectorModel: InspectorModel | null;
  sandboxRoot: string | null;
  onAutoResolve?: () => void;
  onCancelMcpConnectivityTest?: () => void;
  onClearSelection: () => void;
  onDismissDrift: (request: DismissDriftRequest) => Promise<void>;
  onOpenPluginSource: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onRequestRemove?: (request: RemoveInventoryItemRequest, label: string) => void;
  onResolveIssue: (request: ResolveIssueRequest) => Promise<void>;
  onRescan: () => Promise<void>;
  onSearchQueryChange: (query: string) => void;
  onSelectMcp: (name: string | null) => void;
  onSelectProblem: (problemKey: McpIssueReason | null) => void;
  onSelectVariant: (path: string | null) => void;
  onStatusFilterChange: (filter: McpStatusFilter) => void;
  rows: McpRecord[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  statusFilter: McpStatusFilter;
}) {
  const sections = filterVisibleSections(inventorySnapshot ? getMcpSections(inventorySnapshot) : [], rows);
  const filters = inventorySnapshot?.mcpCounts
    ? [
        { label: 'All', count: inventorySnapshot.mcpCounts.totalMcps, value: 'all' as const, tone: 'neutral' as const },
        { label: 'Needs attention', count: inventorySnapshot.mcpCounts.attentionMcps, value: 'active' as const, tone: 'attention' as const },
        { label: 'Healthy', count: inventorySnapshot.mcpCounts.healthyMcps, value: 'none' as const, tone: 'healthy' as const },
      ]
    : [];
  const emptyStateMessage = inventorySnapshot?.mcpCounts
    ? getMcpEmptyStateMessage({
        searchQuery,
        statusFilter,
        totalMcps: inventorySnapshot.mcpCounts.totalMcps,
      })
    : 'Scanning your MCP inventory…';

  useEffect(() => {
    if (!mcp) {
      return;
    }

    scrollSelectedInventoryRowIntoView('MCP list');
  }, [mcp]);

  return (
    <>
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
              label="Search MCPs"
              onChange={onSearchQueryChange}
              placeholder="Search servers..."
              query={searchQuery}
            />
          )}
          title="MCPs"
        />

        <div className="page-scroll page-scroll--split">
          <WorkspaceFilterBar
            activeFilter={statusFilter}
            ariaLabel="MCP filters"
            filters={filters}
            onFilterChange={onStatusFilterChange}
            trailing={(
              <>
                <ScopedAutoRepairControl
                  activeIssueCount={getActiveIssueCountForAutoRepairScope(inventorySnapshot, 'mcp')}
                  autoResolvableRequests={autoResolvableRequests}
                  inventorySnapshot={inventorySnapshot}
                  isAutoResolving={isAutoResolving}
                  onAutoResolve={onAutoResolve}
                />
                <InventoryKeyboardHint />
              </>
            )}
          />

          <div className={`split-workspace split-workspace--detail${mcp ? '' : ' split-workspace--detail-collapsed'}`}>
            <section className="master-list-panel" aria-label="MCP list">
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
                          badges={getMcpStatusLabels(row).map((label) => ({
                            label,
                            tone: getPillToneForMcp(row),
                          }))}
                          isSelected={mcp?.name === row.name}
                          isLocked={hasPluginMcpLocation(row)}
                          lockedTooltip={PLUGIN_MCP_TOOLTIP}
                          key={row.name}
                          name={getMcpDisplayName(row)}
                          onClick={() => onSelectMcp(row.name)}
                        />
                      ))}
                    </InventorySectionBlock>
                  ))
                ) : (
                  <EmptyStatePanel message={emptyStateMessage} />
                )
              ) : (
                <EmptyStatePanel message="Scanning your MCP inventory…" />
              )}
            </section>

            {mcp ? (
              <McpDetailPanel
                isDismissingDrift={isDismissingDrift}
                isResolvingIssue={isResolvingIssue}
                isRemovingInventoryItem={isRemovingInventoryItem}
                inventorySnapshot={inventorySnapshot}
                mcp={mcp}
                mcpInspectorModel={mcpInspectorModel}
                sandboxRoot={sandboxRoot}
                onClearSelection={onClearSelection}
                onDismissDrift={onDismissDrift}
                onOpenPluginSource={onOpenPluginSource}
                onRequestRemove={onRequestRemove}
                onResolveIssue={onResolveIssue}
                onSelectProblem={onSelectProblem}
                onSelectVariant={onSelectVariant}
              />
            ) : null}
          </div>
        </div>
      </main>

    </>
  );
}

function hasPluginMcpLocation(mcp: McpRecord): boolean {
  return mcp.locations.some((location) => location.provenance?.kind === 'plugin');
}

function getMcpEmptyStateMessage({
  searchQuery,
  statusFilter,
  totalMcps,
}: {
  searchQuery: string;
  statusFilter: McpStatusFilter;
  totalMcps: number;
}): string {
  if (hasSearchQuery(searchQuery)) {
    return `No MCPs match "${searchQuery.trim()}".`;
  }

  if (totalMcps === 0) {
    return 'No MCPs were found in the agent configs Skill Index scanned.';
  }

  switch (statusFilter) {
    case 'active':
      return 'No MCPs needing attention found.';
    case 'none':
      return 'No healthy MCPs found.';
    default:
      return 'No MCPs found.';
  }
}

type AddServerMode = 'stdio' | 'remote';

export function AddServerModal({
  isSubmitting,
  onClose,
  onSubmit,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (request: AddMcpServerRequest) => Promise<void>;
}) {
  const [mode, setMode] = useState<AddServerMode>('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [remoteTransport, setRemoteTransport] = useState<RemoteMcpTransportKind>('streamable-http');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useCloseOnEscape({ disabled: isSubmitting, onClose });

  useEffect(() => {
    setSubmitError(null);
  }, [argsText, command, envText, headersText, mode, name, remoteTransport, url]);

  const canSubmit = name.trim().length > 0
    && (mode === 'stdio' ? command.trim().length > 0 : url.trim().length > 0);

  return (
    <div className="add-skill-modal-root" role="presentation">
      <div className="add-skill-modal-backdrop" />
      <section aria-label="Add Server" aria-modal="true" className="add-skill-modal add-server-modal" role="dialog">
        <div className="add-skill-modal__header">
          <h3>Add Server</h3>
          <button
            aria-label="Close Add Server modal"
            className="add-skill-modal__close"
            disabled={isSubmitting}
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="add-skill-modal__tabs" role="tablist" aria-label="Add Server source">
          <button
            aria-selected={mode === 'stdio'}
            className={`add-skill-modal__tab${mode === 'stdio' ? ' add-skill-modal__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => {
              setMode('stdio');
            }}
          >
            Command
          </button>
          <button
            aria-selected={mode === 'remote'}
            className={`add-skill-modal__tab${mode === 'remote' ? ' add-skill-modal__tab--active' : ''}`}
            role="tab"
            type="button"
            onClick={() => {
              setMode('remote');
            }}
          >
            URL
          </button>
        </div>

        <form
          className="add-skill-modal__body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || isSubmitting) {
              return;
            }

            let request: AddMcpServerRequest;
            try {
              request = mode === 'stdio'
                ? {
                    name: name.trim(),
                    transport: 'stdio',
                    command: command.trim(),
                    args: parseListLines(argsText),
                    env: parseKeyValueLines(envText),
                  }
                : {
                    name: name.trim(),
                    transport: remoteTransport,
                    url: url.trim(),
                    headers: parseKeyValueLines(headersText),
                  };
            } catch (error) {
              setSubmitError(error instanceof Error ? error.message : 'Unable to read the Server fields.');
              return;
            }

            void onSubmit(request).catch((error) => {
              setSubmitError(error instanceof Error ? error.message : 'Unable to add Server.');
            });
          }}
        >
          <label className="add-skill-modal__field">
            <span>Server name</span>
            <input
              className="add-skill-modal__input add-skill-modal__input--mono"
              placeholder="github"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>

          {mode === 'stdio' ? (
            <>
              <label className="add-skill-modal__field">
                <span>Command</span>
                <input
                  className="add-skill-modal__input add-skill-modal__input--mono"
                  placeholder="npx"
                  type="text"
                  value={command}
                  onChange={(event) => {
                    setCommand(event.target.value);
                  }}
                />
              </label>
              <label className="add-skill-modal__field">
                <span>Arguments</span>
                <textarea
                  className="add-skill-modal__textarea add-skill-modal__textarea--compact add-skill-modal__input--mono"
                  placeholder="One argument per line&#10;-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/root"
                  value={argsText}
                  onChange={(event) => {
                    setArgsText(event.target.value);
                  }}
                />
              </label>
              <label className="add-skill-modal__field">
                <span>Environment</span>
                <textarea
                  className="add-skill-modal__textarea add-skill-modal__textarea--compact add-skill-modal__input--mono"
                  placeholder="API_TOKEN=...&#10;BASE_URL=https://api.example.com"
                  value={envText}
                  onChange={(event) => {
                    setEnvText(event.target.value);
                  }}
                />
              </label>
            </>
          ) : (
            <>
              <label className="add-skill-modal__field">
                <span>Transport type</span>
                <select
                  className="add-skill-modal__input"
                  value={remoteTransport}
                  onChange={(event) => {
                    setRemoteTransport(event.target.value as RemoteMcpTransportKind);
                  }}
                >
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="sse">SSE</option>
                  <option value="http">HTTP</option>
                </select>
              </label>
              <label className="add-skill-modal__field">
                <span>URL</span>
                <input
                  className="add-skill-modal__input add-skill-modal__input--mono"
                  placeholder="https://example.com/mcp"
                  type="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                  }}
                />
              </label>
              <label className="add-skill-modal__field">
                <span>Headers</span>
                <textarea
                  className="add-skill-modal__textarea add-skill-modal__textarea--compact add-skill-modal__input--mono"
                  placeholder="Authorization: Bearer ...&#10;X-API-Key: ..."
                  value={headersText}
                  onChange={(event) => {
                    setHeadersText(event.target.value);
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
              {isSubmitting ? 'Adding Server…' : 'Add Server'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function parseListLines(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueLines(raw: string): Record<string, string> | undefined {
  const entries: Array<[string, string]> = [];

  for (const line of raw.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
    const separatorIndex = line.includes('=') ? line.indexOf('=') : line.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error('Use KEY=value or Header: value entries.');
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      throw new Error('Key/value entries must include both a key and a value.');
    }

    entries.push([key, value]);
  }

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function McpDetailPanel({
  isDismissingDrift,
  isResolvingIssue,
  isRemovingInventoryItem,
  inventorySnapshot,
  mcp,
  mcpInspectorModel,
  sandboxRoot,
  onClearSelection,
  onDismissDrift,
  onOpenPluginSource,
  onRequestRemove,
  onResolveIssue,
  onSelectProblem,
  onSelectVariant,
}: {
  isDismissingDrift: boolean;
  isResolvingIssue: boolean;
  isRemovingInventoryItem: boolean;
  inventorySnapshot: SkillInventorySnapshot | null;
  mcp: McpRecord;
  mcpInspectorModel: InspectorModel | null;
  sandboxRoot: string | null;
  onClearSelection: () => void;
  onDismissDrift: (request: DismissDriftRequest) => Promise<void>;
  onOpenPluginSource: (action: NonNullable<InspectorProvenanceSummaryRow['action']>) => void;
  onRequestRemove: (request: RemoveInventoryItemRequest, label: string) => void;
  onResolveIssue: (request: ResolveIssueRequest) => Promise<void>;
  onSelectProblem: (problemKey: McpIssueReason | null) => void;
  onSelectVariant: (path: string | null) => void;
}) {
  if (!mcpInspectorModel) {
    return null;
  }

  const resolveAction = getMcpResolveActionState(mcp, mcpInspectorModel, inventorySnapshot);

  return (
    <DetailInspectorPanel
      ariaLabel="MCP detail"
      entityKind="mcp"
      footerActions={[
        ...(mcpInspectorModel.activeProblem.primaryActionLabel
          ? [{
            disabled: !resolveAction.request || isResolvingIssue,
            label: isResolvingIssue ? 'Applying…' : mcpInspectorModel.activeProblem.primaryActionLabel,
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
        ...(mcpInspectorModel.activeProblem.key === 'invalid-definition'
          ? [{
            label: 'Click a file name above to open it, then fix the definition.',
            variant: 'note' as const,
          }]
          : []),
        ...(mcp.status === 'needs-attention'
          ? [{
            disabled: isDismissingDrift,
            label: isDismissingDrift
              ? (mcp.presentation === 'dismissed' ? 'Undismissing issues with this MCP…' : 'Dismissing issues with this MCP…')
              : (mcp.presentation === 'dismissed' ? 'Undismiss issues with this MCP' : 'Dismiss issues with this MCP'),
            onClick: () => {
              void onDismissDrift({ mcpName: mcp.name });
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
              entity: 'mcp',
              mcpName: mcp.name,
            }, mcp.name);
          },
          shortcut: 'R',
          variant: 'danger' as const,
        },
      ]}
      model={mcpInspectorModel}
      paneClassName="mcp-inspector-panel"
      sandboxRoot={sandboxRoot}
      onClose={onClearSelection}
      onProvenanceAction={onOpenPluginSource}
      onProblemSelect={(problemKey: InspectorModel['problems'][number]['key']) => onSelectProblem(problemKey as McpIssueReason)}
      onVariantSelect={(path: string) => onSelectVariant(path)}
    />
  );
}
