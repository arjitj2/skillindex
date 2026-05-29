import { createRef } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { McpRecord } from '@shared/contracts';

import { representativeInventorySnapshot } from '../representative-preview-data';
import { buildMcpInspectorModel, buildSkillInspectorModel, buildSubagentInspectorModel } from '../lib/detail-inspector-model';
import { McpWorkspaceView } from './McpWorkspaceView';
import { PluginsWorkspaceView } from './PluginsWorkspaceView';
import { SkillsWorkspaceView } from './SkillsWorkspaceView';
import { SubagentsWorkspaceView } from './SubagentsWorkspaceView';

function renderSkillsWorkspaceView({
  inventorySnapshot = representativeInventorySnapshot,
  isRescanning = false,
  rows = representativeInventorySnapshot.skills,
  searchQuery = '',
  statusFilter = 'all',
}: {
  inventorySnapshot?: typeof representativeInventorySnapshot;
  isRescanning?: boolean;
  rows?: typeof representativeInventorySnapshot.skills;
  searchQuery?: string;
  statusFilter?: 'all' | 'active' | 'dismissed' | 'none';
} = {}) {
  return render(
    <SkillsWorkspaceView
      isAddingSkill={false}
      inventorySnapshot={inventorySnapshot}
      isDismissingDrift={false}
      isApplyingCapabilityAction={false}
      isResolvingIssue={false}
      isRescanning={isRescanning}
      onAddSkill={vi.fn(() => Promise.resolve())}
      onClearSelection={vi.fn()}
      onDismissDrift={vi.fn(() => Promise.resolve())}
      onApplyCapabilityAction={vi.fn(() => Promise.resolve())}
      onOpenPluginSource={vi.fn()}
      onResolveIssue={vi.fn(() => Promise.resolve())}
      onRescan={vi.fn(() => Promise.resolve())}
      rows={rows}
      sandboxRoot={null}
      searchInputRef={createRef<HTMLInputElement>()}
      searchQuery={searchQuery}
      selectedSkill={null}
      selectedSkillInspectorModel={null}
      selectedSkillProblemKey={null}
      setSearchQuery={vi.fn()}
      setSelectedSkillProblemKey={vi.fn()}
      setSelectedSkillName={vi.fn()}
      setSelectedSkillVariantPath={vi.fn()}
      setSelectionOverrideSkillName={vi.fn()}
      setStatusFilter={vi.fn()}
      sourceIndex={new Map(inventorySnapshot.sources.map((source) => [source.id, source]))}
      statusFilter={statusFilter}
    />,
  );
}

function renderMcpWorkspaceView({
  inventorySnapshot = representativeInventorySnapshot,
  isRescanning = false,
  onSelectMcp = vi.fn(),
  rows = representativeInventorySnapshot.mcps ?? [],
  searchQuery = '',
  statusFilter = 'all',
}: {
  inventorySnapshot?: typeof representativeInventorySnapshot;
  isRescanning?: boolean;
  onSelectMcp?: (name: string | null) => void;
  rows?: NonNullable<typeof representativeInventorySnapshot.mcps>;
  searchQuery?: string;
  statusFilter?: 'all' | 'active' | 'dismissed' | 'none';
} = {}) {
  render(
    <McpWorkspaceView
      inventorySnapshot={inventorySnapshot}
      isAddingMcpServer={false}
      isDismissingDrift={false}
      isResolvingIssue={false}
      isRescanning={isRescanning}
      mcp={null}
      mcpInspectorModel={null}
      sandboxRoot={null}
      onAddMcpServer={vi.fn(() => Promise.resolve())}
      onClearSelection={vi.fn()}
      onDismissDrift={vi.fn(() => Promise.resolve())}
      onResolveIssue={vi.fn(() => Promise.resolve())}
      onRescan={vi.fn(() => Promise.resolve())}
      onSearchQueryChange={vi.fn()}
      onSelectMcp={onSelectMcp}
      onSelectProblem={vi.fn()}
      onSelectVariant={vi.fn()}
      onStatusFilterChange={vi.fn()}
      rows={rows}
      searchInputRef={createRef<HTMLInputElement>()}
      searchQuery={searchQuery}
      statusFilter={statusFilter}
    />,
  );
}

function renderSubagentsWorkspaceView({
  inventorySnapshot = representativeInventorySnapshot,
  isRescanning = false,
  rows = representativeInventorySnapshot.subagents ?? [],
  searchQuery = '',
  selectedSubagent = null,
  selectedSubagentInspectorModel = null,
  selectedSubagentProblemKey = null,
  statusFilter = 'all',
}: {
  inventorySnapshot?: typeof representativeInventorySnapshot;
  isRescanning?: boolean;
  rows?: NonNullable<typeof representativeInventorySnapshot.subagents>;
  searchQuery?: string;
  selectedSubagent?: NonNullable<typeof representativeInventorySnapshot.subagents>[number] | null;
  selectedSubagentInspectorModel?: ReturnType<typeof buildSubagentInspectorModel> | null;
  selectedSubagentProblemKey?: NonNullable<typeof representativeInventorySnapshot.subagents>[number]['issueReasons'][number] | null;
  statusFilter?: 'all' | 'active' | 'dismissed' | 'none';
} = {}) {
  render(
    <SubagentsWorkspaceView
      inventorySnapshot={inventorySnapshot}
      isDismissingDrift={false}
      isResolvingIssue={false}
      isRescanning={isRescanning}
      onClearSelection={vi.fn()}
      onDismissDrift={vi.fn(() => Promise.resolve())}
      onResolveIssue={vi.fn(() => Promise.resolve())}
      onRescan={vi.fn(() => Promise.resolve())}
      onSearchQueryChange={vi.fn()}
      onSelectProblem={vi.fn()}
      onSelectSubagent={vi.fn()}
      onSelectVariant={vi.fn()}
      onStatusFilterChange={vi.fn()}
      rows={rows}
      sandboxRoot={null}
      searchInputRef={createRef<HTMLInputElement>()}
      searchQuery={searchQuery}
      selectedSubagent={selectedSubagent}
      selectedSubagentInspectorModel={selectedSubagentInspectorModel}
      selectedSubagentProblemKey={selectedSubagentProblemKey}
      statusFilter={statusFilter}
    />,
  );
}

function renderPluginsWorkspaceView({
  onSelectMcpAsset = vi.fn(),
  onSelectSkillAsset = vi.fn(),
  onSelectSubagentAsset = vi.fn(),
  sandboxRoot = null,
}: {
  onSelectMcpAsset?: (mcpName: string) => void;
  onSelectSkillAsset?: (skillName: string) => void;
  onSelectSubagentAsset?: (subagentName: string) => void;
  sandboxRoot?: string | null;
} = {}) {
  const selectedPlugin = representativeInventorySnapshot.plugins?.[0] ?? null;

  return render(
    <PluginsWorkspaceView
      inventorySnapshot={representativeInventorySnapshot}
      isRescanning={false}
      onClearSelection={vi.fn()}
      onRescan={vi.fn(() => Promise.resolve())}
      onSearchQueryChange={vi.fn()}
      onSelectMcpAsset={onSelectMcpAsset}
      onSelectPlugin={vi.fn()}
      onSelectSkillAsset={onSelectSkillAsset}
      onSelectSubagentAsset={onSelectSubagentAsset}
      rows={representativeInventorySnapshot.plugins ?? []}
      sandboxRoot={sandboxRoot}
      searchInputRef={createRef<HTMLInputElement>()}
      searchQuery=""
      selectedPlugin={selectedPlugin}
      selectedPluginKey={selectedPlugin ? [
        selectedPlugin.host,
        selectedPlugin.scope ?? '',
        selectedPlugin.pluginId,
        selectedPlugin.version ?? '',
        selectedPlugin.rootPath,
      ].join(':') : null}
    />,
  );
}

describe('inventory view chrome', () => {
  it('shows only the status filter pills for the Skills workspace', () => {
    renderSkillsWorkspaceView();

    expect(screen.getByRole('toolbar', { name: 'Skill filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs attention5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Healthy2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismissed1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Severity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument();
  });

  it('shows only the status filter pills for the MCP workspace', () => {
    renderMcpWorkspaceView();

    expect(screen.getByRole('toolbar', { name: 'MCP filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs attention3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Healthy5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Severity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /broken-mcp/i }).querySelector('p')).toBeNull();
    expect(screen.getByRole('button', { name: /healthy-mcp/i }).querySelector('p')).toBeNull();
  });

  it('renders Subagent details with the shared inspector chrome used by Skills', () => {
    const selectedSubagent = representativeInventorySnapshot.subagents?.find((subagent) => subagent.name === 'reviewer');
    expect(selectedSubagent).toBeDefined();
    const agentIndex = new Map((representativeInventorySnapshot.agents ?? []).map((agent) => [agent.id, agent]));

    renderSubagentsWorkspaceView({
      selectedSubagent: selectedSubagent ?? null,
      selectedSubagentInspectorModel: selectedSubagent
        ? buildSubagentInspectorModel(selectedSubagent, {
          selectedProblemKey: 'missing-from-agents',
          selectedVariantPath: null,
        }, agentIndex)
        : null,
      selectedSubagentProblemKey: 'missing-from-agents',
    });

    const detail = screen.getByRole('complementary', { name: 'Subagent detail' });
    expect(detail).toHaveClass('detail-inspector-panel', 'detail-inspector-panel--subagent');
    expect(detail).not.toHaveClass('plugin-detail-panel');
    expect(within(detail).getByRole('tab', { name: /Problems/i })).toBeInTheDocument();
    expect(within(detail).getByRole('tab', { name: /Locations/i })).toBeInTheDocument();
    expect(within(detail).getByRole('tab', { name: /Definition/i })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: /Add to Agents/i })).toBeInTheDocument();
  });

  it('uses MCP-specific rescan loading copy while connectivity checks run', () => {
    renderMcpWorkspaceView({ isRescanning: true });

    expect(screen.getByRole('button', { name: 'Testing MCP connectivity…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rescanning…' })).not.toBeInTheDocument();
  });

  it('shows the plugin indicator for MCP rows with mixed plugin and manual locations', () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const sourceMcp = inventorySnapshot.mcps?.find((mcp) => mcp.name === 'healthy-mcp');
    if (!sourceMcp) {
      throw new Error('Missing representative MCP fixture: healthy-mcp');
    }
    const mixedMcp: McpRecord = {
      ...sourceMcp,
      name: 'signal-tools:signalMap',
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['signal-map.js'],
          provenance: {
            kind: 'manual',
            sourcePath: '~/.skillindex/sandbox/.agents/mcp.json',
            discoveredAt: '2026-05-15T12:01:00.000Z',
          },
          mutability: 'writable',
        },
        {
          agentId: 'plugin:sandbox:codex:signal-tools@sandbox-curated:2.0.0',
          agentLabel: 'Codex Plugin signal-tools',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json',
          command: 'node',
          args: ['signal-map.js'],
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'codex',
              pluginId: 'signal-tools@sandbox-curated',
              version: '2.0.0',
            },
            sourcePath: '~/.skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json',
            discoveredAt: '2026-05-15T12:00:00.000Z',
          },
          mutability: 'read-only-managed',
        },
      ],
    };
    inventorySnapshot.mcps = [mixedMcp];

    renderMcpWorkspaceView({
      inventorySnapshot,
      rows: inventorySnapshot.mcps,
    });

    const pluginMcpRow = screen.getByRole('button', { name: /signalMap/i });
    expect(pluginMcpRow).not.toHaveTextContent('signal-tools:');
    expect(pluginMcpRow).toHaveAccessibleName(/This skill was installed via one or more plugins/i);
  });

  it('shows the plugin indicator for skill rows with mixed plugin and manual locations', () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const mixedSkill = inventorySnapshot.skills.find((skill) => skill.name === 'mixed-plugin-skill');
    if (!mixedSkill) {
      throw new Error('Missing representative skill fixture: mixed-plugin-skill');
    }
    const pluginLocation = mixedSkill.locations.find((location) => location.provenance?.kind === 'plugin');
    if (!pluginLocation) {
      throw new Error('Expected mixed-plugin-skill to include a plugin-backed location.');
    }
    delete pluginLocation.mutability;

    renderSkillsWorkspaceView({
      inventorySnapshot,
      rows: inventorySnapshot.skills,
    });

    const pluginSkillRow = screen.getByRole('button', { name: /mixed-plugin-skill/i });
    expect(pluginSkillRow).toHaveAccessibleName(/This skill was installed via one or more plugins/i);
  });

  it('uses MCP connectivity loading copy in the Skills workspace', () => {
    renderSkillsWorkspaceView({ isRescanning: true });

    expect(screen.getByRole('button', { name: 'Testing MCP connectivity…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rescanning…' })).not.toBeInTheDocument();
  });

  it('keeps the Plugins list inside the shared split scroll container', () => {
    const { container } = renderPluginsWorkspaceView();

    const pageScroll = container.querySelector('.page-scroll');
    expect(pageScroll).toHaveClass('page-scroll--split');
    expect(pageScroll).not.toHaveClass('page-scroll--plugins');

    const splitWorkspace = container.querySelector('.split-workspace');
    expect(splitWorkspace).toHaveClass('split-workspace--detail');
    expect(splitWorkspace).not.toHaveClass('split-workspace--plugin-detail');

    const pluginList = screen.getByRole('region', { name: /^Plugins list$/i });
    expect(pluginList).toHaveClass('master-list-panel');
    expect(pluginList).not.toHaveClass('plugin-group-stack--scroll');

    const selectedPluginRow = screen.getByRole('button', { name: /sandbox-plugin-pack/i });
    expect(selectedPluginRow).toHaveClass('master-list-row', 'master-list-row--selected');
    expect(selectedPluginRow).not.toHaveClass('plugin-inventory-row--selected');
  });

  it('lets plugin bundled assets jump to their inventory detail and renders unsupported hooks as inert rows', () => {
    const selectedPlugin = representativeInventorySnapshot.plugins?.[0];
    if (!selectedPlugin) {
      throw new Error('Expected representative plugin fixture to include a plugin.');
    }
    const onSelectSkillAsset = vi.fn();
    const onSelectSubagentAsset = vi.fn();
    renderPluginsWorkspaceView({ onSelectSkillAsset, onSelectSubagentAsset });

    const tabs = within(screen.getByRole('tablist', { name: /sandbox-plugin-pack detail sections/i })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Bundled Assets3', 'Metadata']);
    expect(screen.getByRole('tab', { name: /Bundled Assets/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: /Overview/i })).not.toBeInTheDocument();
    expect(screen.queryByText(selectedPlugin.bundledSkills[0].path)).not.toBeInTheDocument();
    const unsupportedHookPath = selectedPlugin.unsupportedAssets?.[0]?.path;
    if (!unsupportedHookPath) {
      throw new Error('Expected representative plugin fixture to include an unsupported hook path.');
    }
    expect(screen.queryByText(unsupportedHookPath)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^mixed-plugin-skill$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^deployment-expert$/i }));

    expect(onSelectSkillAsset).toHaveBeenCalledWith('mixed-plugin-skill');
    expect(onSelectSubagentAsset).toHaveBeenCalledWith('sandbox-plugin-pack:deployment-expert');
    const unsupportedSection = screen.getByText('Unsupported assets').closest('.plugin-detail-panel__asset-section');
    expect(unsupportedSection).not.toBeNull();
    expect(within(unsupportedSection as HTMLElement).getByText('session-start')).toBeInTheDocument();
    expect(within(unsupportedSection as HTMLElement).getByText('Hook')).toBeInTheDocument();
    expect(within(unsupportedSection as HTMLElement).getByText('Inert')).toBeInTheDocument();
    expect(within(unsupportedSection as HTMLElement).getByText('Hook execution not yet supported by Skill Index')).toBeInTheDocument();
  });

  it('opens plugin overview paths directly from the displayed path text', () => {
    const selectedPlugin = representativeInventorySnapshot.plugins?.[0];
    if (!selectedPlugin?.manifestPath) {
      throw new Error('Expected representative plugin fixture to include a manifest path.');
    }
    const revealPathInFinder = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: { revealPathInFinder },
      writable: true,
    });
    const onSelectSkillAsset = vi.fn();
    renderPluginsWorkspaceView({ onSelectSkillAsset, sandboxRoot: '~/.skillindex/sandbox' });

    expect(screen.queryByRole('button', { name: /Reveal in folder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '~/plugins' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Metadata/i }));
    fireEvent.click(screen.getByRole('button', { name: selectedPlugin.rootPath }));
    fireEvent.click(screen.getByRole('button', { name: selectedPlugin.manifestPath }));

    fireEvent.click(screen.getByRole('tab', { name: /Bundled Assets/i }));
    const skillPath = selectedPlugin.bundledSkills[0].path;
    expect(screen.queryByRole('button', { name: skillPath })).not.toBeInTheDocument();

    expect(revealPathInFinder).toHaveBeenCalledTimes(2);
    expect(revealPathInFinder).toHaveBeenNthCalledWith(1, selectedPlugin.rootPath);
    expect(revealPathInFinder).toHaveBeenNthCalledWith(2, selectedPlugin.manifestPath);
    expect(onSelectSkillAsset).not.toHaveBeenCalled();
  });

  it('renders the plugin detail Source as a clickable repository link', () => {
    renderPluginsWorkspaceView();
    fireEvent.click(screen.getByRole('tab', { name: /Metadata/i }));

    const sourceLink = screen.getByRole('link', { name: 'https://github.com/example/sandbox-plugin-pack' });

    expect(sourceLink).toHaveAttribute('href', 'https://github.com/example/sandbox-plugin-pack');
    expect(sourceLink).toHaveClass('plugin-detail-panel__metadata-link');
  });

  it('renders one status pill per issue and orders active rows by issue count', () => {
    render(
      <McpWorkspaceView
        inventorySnapshot={representativeInventorySnapshot}
        isAddingMcpServer={false}
        isDismissingDrift={false}
        isResolvingIssue={false}
        isRescanning={false}
        mcp={null}
        mcpInspectorModel={null}
        sandboxRoot={null}
        onAddMcpServer={vi.fn(() => Promise.resolve())}
        onClearSelection={vi.fn()}
        onDismissDrift={vi.fn(() => Promise.resolve())}
        onResolveIssue={vi.fn(() => Promise.resolve())}
        onRescan={vi.fn(() => Promise.resolve())}
        onSearchQueryChange={vi.fn()}
        onSelectMcp={vi.fn()}
        onSelectProblem={vi.fn()}
        onSelectVariant={vi.fn()}
        onStatusFilterChange={vi.fn()}
        rows={representativeInventorySnapshot.mcps ?? []}
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
        statusFilter="all"
      />,
    );

    const needsAttention = screen.getByRole('heading', { name: /^NEEDS ATTENTION/i }).closest('section');
    expect(needsAttention).not.toBeNull();
    const rows = needsAttention!.querySelectorAll('.master-list-row');
    expect(rows.item(0)).toHaveTextContent('broken-mcp');
    expect(rows.item(0)).toHaveTextContent('Definition Mismatch');
    expect(rows.item(0)).toHaveTextContent('Invalid Definition');
  });

  it('shows filter-specific empty states for Skills when a non-empty inventory has no matches for the active filter', () => {
    renderSkillsWorkspaceView({ rows: [], statusFilter: 'dismissed' });

    expect(screen.getByText('No dismissed skills found.')).toBeInTheDocument();
    expect(screen.queryByText('No skills were found in the locations Skill Index scanned.')).not.toBeInTheDocument();
  });

  it('renders the frontmatter-backed skill display name in the skills list', () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const targetSkill = inventorySnapshot.skills.find((skill) => skill.name === 'diverged-drift-skill');
    expect(targetSkill).toBeDefined();
    targetSkill!.displayName = 'PowerPoint';

    renderSkillsWorkspaceView({
      inventorySnapshot,
      rows: inventorySnapshot.skills,
    });

    expect(screen.getByRole('button', { name: /PowerPoint/i })).toBeInTheDocument();
  });

  it('renders plugin-managed MCPs without plugin-name qualifiers in the MCP list', () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const sourceMcp = inventorySnapshot.mcps?.find((mcp) => mcp.name === 'missing-from-agents-mcp');
    if (!sourceMcp) {
      throw new Error('Missing representative MCP fixture: missing-from-agents-mcp');
    }

    const pluginMcp: McpRecord = {
      ...structuredClone(sourceMcp),
      name: 'signal-tools:signalMap',
      locations: [
        {
          agentId: 'plugin:sandbox:codex:signal-tools@sandbox-curated:2.0.0',
          agentLabel: 'Codex Plugin signal-tools',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json',
          command: 'node',
          args: ['signal-map.js'],
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'codex',
              pluginId: 'signal-tools@sandbox-curated',
              version: '2.0.0',
            },
            sourcePath: '~/.skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json',
            discoveredAt: '2026-05-15T12:00:00.000Z',
          },
          mutability: 'read-only-managed',
        },
      ],
    };
    inventorySnapshot.mcps = [pluginMcp];
    const onSelectMcp = vi.fn();

    renderMcpWorkspaceView({
      inventorySnapshot,
      onSelectMcp,
      rows: inventorySnapshot.mcps,
    });

    const row = screen.getByRole('button', { name: /signalMap/i });
    expect(row).toBeInTheDocument();
    expect(row).not.toHaveTextContent('signal-tools:');

    fireEvent.click(row);

    expect(onSelectMcp).toHaveBeenCalledWith('signal-tools:signalMap');
  });

  it('keeps the search empty state ahead of filter-specific copy for Skills', () => {
    renderSkillsWorkspaceView({ rows: [], searchQuery: 'ghost', statusFilter: 'dismissed' });

    expect(screen.getByText('No skills match "ghost".')).toBeInTheDocument();
  });

  it('shows filter-specific empty states for MCPs when a non-empty inventory has no matches for the active filter', () => {
    renderMcpWorkspaceView({ rows: [], statusFilter: 'none' });

    expect(screen.getByText('No healthy MCPs found.')).toBeInTheDocument();
    expect(screen.queryByText('No MCPs were found in the agent configs Skill Index scanned.')).not.toBeInTheDocument();
  });

  it('shows filter-specific empty states for subagents when a non-empty inventory has no matches for the active filter', () => {
    renderSubagentsWorkspaceView({ rows: [], statusFilter: 'dismissed' });

    expect(screen.getByText('No dismissed subagents found.')).toBeInTheDocument();
    expect(screen.queryByText('No subagents were found in the agent folders Skill Index scanned.')).not.toBeInTheDocument();
  });

  it('shows undismiss actions in dismissed detail panes for skills, MCPs, and subagents', () => {
    const sourceIndex = new Map(representativeInventorySnapshot.sources.map((source) => [source.id, source]));
    const agentIndex = new Map((representativeInventorySnapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const dismissedSkill = representativeInventorySnapshot.skills.find((skill) => skill.name === 'dismissed-drift-skill');
    const dismissedMcp = representativeInventorySnapshot.mcps?.find((mcp) => mcp.name === 'muted-mcp');
    const activeSubagent = representativeInventorySnapshot.subagents?.find((subagent) => subagent.name === 'reviewer');
    const dismissedSubagent = activeSubagent
      ? {
        ...activeSubagent,
        presentation: 'dismissed' as const,
      }
      : null;
    expect(dismissedSkill).toBeDefined();
    expect(dismissedMcp).toBeDefined();
    expect(dismissedSubagent).toBeDefined();

    const { rerender } = render(
      <SkillsWorkspaceView
        isAddingSkill={false}
        inventorySnapshot={representativeInventorySnapshot}
        isDismissingDrift={false}
        isApplyingCapabilityAction={false}
        isResolvingIssue={false}
        isRescanning={false}
        onAddSkill={vi.fn(() => Promise.resolve())}
        onClearSelection={vi.fn()}
        onDismissDrift={vi.fn(() => Promise.resolve())}
        onApplyCapabilityAction={vi.fn(() => Promise.resolve())}
        onOpenPluginSource={vi.fn()}
        onResolveIssue={vi.fn(() => Promise.resolve())}
        onRescan={vi.fn(() => Promise.resolve())}
        rows={representativeInventorySnapshot.skills}
        sandboxRoot={null}
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
        selectedSkill={dismissedSkill ?? null}
        selectedSkillInspectorModel={dismissedSkill ? buildSkillInspectorModel(dismissedSkill, sourceIndex, {
          selectedProblemKey: 'identical-copies',
          selectedVariantPath: null,
        }, agentIndex) : null}
        selectedSkillProblemKey="identical-copies"
        setSearchQuery={vi.fn()}
        setSelectedSkillProblemKey={vi.fn()}
        setSelectedSkillName={vi.fn()}
        setSelectedSkillVariantPath={vi.fn()}
        setSelectionOverrideSkillName={vi.fn()}
        setStatusFilter={vi.fn()}
        sourceIndex={sourceIndex}
        statusFilter="all"
      />,
    );

    expect(screen.getByRole('button', { name: 'Undismiss issues with this skill' })).toBeInTheDocument();

    rerender(
      <McpWorkspaceView
        inventorySnapshot={representativeInventorySnapshot}
        isAddingMcpServer={false}
        isDismissingDrift={false}
        isResolvingIssue={false}
        isRescanning={false}
        mcp={dismissedMcp ?? null}
        mcpInspectorModel={dismissedMcp ? buildMcpInspectorModel(dismissedMcp, {
          selectedProblemKey: 'definition-mismatch',
          selectedVariantPath: '~/.skillindex/sandbox/.agents/mcp.json',
        }, agentIndex) : null}
        sandboxRoot={null}
        onAddMcpServer={vi.fn(() => Promise.resolve())}
        onClearSelection={vi.fn()}
        onDismissDrift={vi.fn(() => Promise.resolve())}
        onResolveIssue={vi.fn(() => Promise.resolve())}
        onRescan={vi.fn(() => Promise.resolve())}
        onSearchQueryChange={vi.fn()}
        onSelectMcp={vi.fn()}
        onSelectProblem={vi.fn()}
        onSelectVariant={vi.fn()}
        onStatusFilterChange={vi.fn()}
        rows={representativeInventorySnapshot.mcps ?? []}
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
        statusFilter="all"
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Undismiss issues with this MCP' }).length).toBeGreaterThan(0);

    rerender(
      <SubagentsWorkspaceView
        inventorySnapshot={representativeInventorySnapshot}
        isDismissingDrift={false}
        isResolvingIssue={false}
        isRescanning={false}
        selectedSubagent={dismissedSubagent}
        selectedSubagentInspectorModel={dismissedSubagent ? buildSubagentInspectorModel(dismissedSubagent, {
          selectedProblemKey: 'missing-from-agents',
          selectedVariantPath: null,
        }, agentIndex) : null}
        selectedSubagentProblemKey="missing-from-agents"
        sandboxRoot={null}
        onClearSelection={vi.fn()}
        onDismissDrift={vi.fn(() => Promise.resolve())}
        onResolveIssue={vi.fn(() => Promise.resolve())}
        onRescan={vi.fn(() => Promise.resolve())}
        onSearchQueryChange={vi.fn()}
        onSelectProblem={vi.fn()}
        onSelectSubagent={vi.fn()}
        onSelectVariant={vi.fn()}
        onStatusFilterChange={vi.fn()}
        rows={representativeInventorySnapshot.subagents ?? []}
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
        statusFilter="all"
      />,
    );

    expect(screen.getByRole('button', { name: 'Undismiss issues with this subagent' })).toBeInTheDocument();
  });
});
