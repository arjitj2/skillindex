import { useMemo, useState, type RefObject } from 'react';

import type { AgentInstallState, AgentRecord, SkillInventorySnapshot } from '@shared/contracts';

import { hasSearchQuery } from '../inventory-view-model';
import { AgentStatusRow, EmptyStatePanel, HeaderSearch, InventorySectionBlock, PageTopBar, RescanToolbarButton, WorkspaceFilterBar } from '../components/ui';

type AgentStatusFilter = 'all' | AgentInstallState;

export function AgentsWorkspaceView({
  inventorySnapshot,
  isRescanning,
  onCancelMcpConnectivityTest,
  onRescan,
  onSearchQueryChange,
  rows,
  searchInputRef,
  searchQuery,
}: {
  inventorySnapshot: SkillInventorySnapshot | null;
  isRescanning: boolean;
  onCancelMcpConnectivityTest?: () => void;
  onRescan: () => Promise<void>;
  onSearchQueryChange: (query: string) => void;
  rows: AgentRecord[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
}) {
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const installedAgents = rows.filter((agent) => agent.installState === 'installed');
  const missingAgents = rows.filter((agent) => agent.installState === 'not-installed');
  const sections = useMemo(() => [
    {
      filterValue: 'installed' as const,
      title: 'INSTALLED',
      metaLabel: (
        <div className="agent-section-columns" aria-hidden="true">
          <span className="agent-section-column-label">Skills source</span>
          <span className="agent-section-column-label">MCP / config</span>
          <span className="agent-section-column-label">Subagents</span>
        </div>
      ),
      rows: installedAgents,
      tone: 'healthy' as const,
    },
    {
      filterValue: 'not-installed' as const,
      title: 'NOT INSTALLED',
      metaLabel: (
        <div className="agent-section-columns" aria-hidden="true">
          <span className="agent-section-column-label">Skills source</span>
          <span className="agent-section-column-label">MCP / config</span>
          <span className="agent-section-column-label">Subagents</span>
        </div>
      ),
      rows: missingAgents,
      tone: 'muted' as const,
    },
  ], [installedAgents, missingAgents]);
  const visibleSections = sections.filter((section) => (statusFilter === 'all' || section.filterValue === statusFilter) && section.rows.length > 0);
  const filters = [
    { label: 'All', count: rows.length, value: 'all' as const, tone: 'neutral' as const },
    { label: 'Installed', count: installedAgents.length, value: 'installed' as const, tone: 'healthy' as const },
    { label: 'Not installed', count: missingAgents.length, value: 'not-installed' as const, tone: 'muted' as const },
  ];

  return (
    <main className="workspace-view">
      <PageTopBar
        actions={(
          <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
        )}
        search={(
          <HeaderSearch
            inputRef={searchInputRef}
            label="Search agents"
            onChange={onSearchQueryChange}
            placeholder="Search agents by name or path..."
            query={searchQuery}
          />
        )}
        title="Agents"
      />

      <div className="page-scroll page-scroll--agents">
        <WorkspaceFilterBar
          activeFilter={statusFilter}
          ariaLabel="Agent filters"
          filters={filters}
          onFilterChange={setStatusFilter}
        />
        <section aria-label="Agents list" className="master-list-panel agent-group-stack--scroll">
          {inventorySnapshot ? (
            visibleSections.length > 0 ? (
              visibleSections.map((section) => (
                <InventorySectionBlock
                  className="inventory-section-block--agents"
                  key={section.title}
                  count={section.rows.length}
                  sortLabel={section.metaLabel}
                  title={section.title}
                >
                  {section.rows.map((agent) => (
                    <AgentStatusRow
                      agent={agent}
                      key={agent.id}
                    />
                  ))}
                </InventorySectionBlock>
              ))
            ) : (
              <EmptyStatePanel
                message={hasSearchQuery(searchQuery) ? `No agents match "${searchQuery.trim()}".` : 'No supported agents were found in this inventory.'}
              />
            )
          ) : (
            <EmptyStatePanel message="Scanning your supported agents…" />
          )}
        </section>
      </div>
    </main>
  );
}
