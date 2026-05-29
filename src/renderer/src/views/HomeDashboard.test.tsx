import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { McpRecord, ResolveIssueRequest, SkillInventorySnapshot, SubagentRecord } from '@shared/contracts';

import { getHomeSummary } from '../inventory-view-model';
import { representativeInventorySnapshot } from '../representative-preview-data';
import { HomeDashboard } from './HomeDashboard';

const safeRepairRequest: ResolveIssueRequest = {
  entity: 'skill',
  issue: 'identical-copies',
  skillName: 'identical-drift-skill',
};

describe('HomeDashboard', () => {
  it('uses rescan loading copy for the global rescan action', () => {
    renderDashboard({ isRescanning: true });

    expect(screen.getByRole('button', { name: 'Rescanning…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Testing MCP connectivity…' })).not.toBeInTheDocument();
  });

  it('renders the Home header without a home directory subtitle', () => {
    renderDashboard();

    const heading = screen.getByRole('heading', { name: /^Home$/i, level: 2 });
    expect(heading.parentElement).toHaveTextContent(/^Home$/);
  });

  it('renders MCP attention rows without a subtitle under the title', () => {
    renderDashboard();

    const brokenMcpRow = screen.getByRole('button', { name: /broken-mcp/i });
    expect(brokenMcpRow.querySelector('p')).toBeNull();
    expect(brokenMcpRow).toHaveTextContent('Definition Mismatch');
    expect(brokenMcpRow).toHaveTextContent('Invalid Definition');
  });

  it('renders the healthy repair state without inline error banners', () => {
    renderDashboard({
      inventorySnapshot: createNoAttentionSnapshot(),
    });

    expect(screen.getByText('Everything looks good')).toBeInTheDocument();
    expect(screen.queryByText('Rescan failed')).not.toBeInTheDocument();
  });

  it('renders clean attention table states when skills and MCPs are healthy', () => {
    const inventorySnapshot = createNoAttentionSnapshot();
    inventorySnapshot.scannedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    inventorySnapshot.counts = {
      ...inventorySnapshot.counts,
      totalSkills: 53,
      healthySkills: 53,
      driftedSkills: 0,
      dismissedDriftSkills: 0,
    };
    inventorySnapshot.mcpCounts = {
      totalMcps: 5,
      healthyMcps: 5,
      attentionMcps: 0,
      dismissedAttentionMcps: 0,
    };

    renderDashboard({
      homeSummary: getHomeSummary(inventorySnapshot),
      inventorySnapshot,
    });

    expect(screen.getByText('All 53 skills are in their expected state')).toBeInTheDocument();
    expect(screen.getByText('Canonical sources present, symlinks resolved, no version drift. Last checked 2m ago.')).toBeInTheDocument();
    expect(screen.getByText('All 5 MCP servers are healthy')).toBeInTheDocument();
    expect(screen.getByText('Configs match across all agents, versions aligned, no args drift. Last checked 2m ago.')).toBeInTheDocument();
  });

  it('renders the no-safe-fixes state and routes users to skills', () => {
    const onNavigateToSkills = vi.fn();
    renderDashboard({
      autoResolvableRequests: [],
      onNavigateToSkills,
    });

    expect(screen.getByText(/No safe auto-fixes available/i)).toBeInTheDocument();
    expect(screen.queryByText('Repair failed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Skills tab$/i }));
    expect(onNavigateToSkills).toHaveBeenCalledTimes(1);
  });

  it('does not treat subagent-only manual attention as healthy', () => {
    const inventorySnapshot = createNoAttentionSnapshot();
    const onSelectSubagent = vi.fn();
    const subagent: SubagentRecord = {
      name: 'manual-subagent',
      displayName: 'manual-subagent',
      description: 'Requires a manual definition choice.',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch'],
      locations: [
        {
          agentId: 'sandbox-agents-subagents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          path: '/tmp/.agents/agents/manual-subagent.md',
          directoryPath: '/tmp/.agents/agents',
          fileType: 'real-file',
          modifiedAt: '2026-05-29T00:00:00.000Z',
          canonical: true,
          format: 'markdown-frontmatter',
          definitionComparisonKey: 'canonical',
          definitionText: '---\nname: manual-subagent\n---\nCanonical prompt.',
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Claude Code',
          scope: 'sandbox',
          path: '/tmp/.claude/agents/manual-subagent.md',
          directoryPath: '/tmp/.claude/agents',
          fileType: 'real-file',
          modifiedAt: '2026-05-29T00:00:00.000Z',
          canonical: false,
          format: 'markdown-frontmatter',
          definitionComparisonKey: 'claude',
          definitionText: '---\nname: manual-subagent\n---\nClaude prompt.',
        },
      ],
    };
    inventorySnapshot.subagents = [subagent];
    inventorySnapshot.subagentCounts = {
      totalSubagents: 1,
      healthySubagents: 0,
      attentionSubagents: 1,
      dismissedAttentionSubagents: 0,
    };
    inventorySnapshot.homeSummary = getHomeSummary(inventorySnapshot);

    renderDashboard({
      autoResolvableRequests: [],
      homeSummary: getHomeSummary(inventorySnapshot),
      inventorySnapshot,
      onSelectSubagent,
    });

    expect(screen.getByText(/No safe auto-fixes available/i)).toBeInTheDocument();
    expect(screen.queryByText('Everything looks good')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Subagents tab$/i }));
    expect(onSelectSubagent).toHaveBeenCalledWith('manual-subagent');
  });

  it('expands, collapses, and applies safe repair requests accessibly', () => {
    const onAutoResolve = vi.fn();
    renderDashboard({
      autoResolvableRequests: [safeRepairRequest],
      onAutoResolve,
    });

    const toggle = screen.getByRole('button', { name: /Review 1 safe repair/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Review planned fixes')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Auto-resolve issues with safe resolutions')).toBeInTheDocument();
    expect(screen.getByText('Review planned fixes')).toBeInTheDocument();
    expect(screen.queryByText(/1 issue across 1 item/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Apply 1 repair/i }));
    expect(onAutoResolve).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Review planned fixes')).not.toBeInTheDocument();
  });

  it('describes mixed skill, MCP, and subagent safe repairs by entity and issue', () => {
    renderDashboard({
      autoResolvableRequests: [
        safeRepairRequest,
        {
          entity: 'mcp',
          issue: 'missing-from-agents',
          mcpName: 'missing-from-agents-mcp',
        },
        {
          entity: 'subagent',
          issue: 'broken-symlink',
          subagentName: 'broken-symlink-subagent',
        },
      ],
    });

    const toggle = screen.getByRole('button', { name: /Review 3 safe repairs for 3 items/i });
    fireEvent.click(toggle);

    expect(screen.getByText('Skills • Identical Copies')).toBeInTheDocument();
    expect(screen.getByText('MCPs • Missing From Agents')).toBeInTheDocument();
    expect(screen.getByText('Subagents • Broken Symlink')).toBeInTheDocument();
    expect(screen.getByText('Add to missing agents')).toBeInTheDocument();
    expect(screen.getByText('Relink to canonical')).toBeInTheDocument();
    expect(screen.getByText(/3 repairs · 3 items affected/i)).toBeInTheDocument();
  });

  it('shows how many active issues will still need manual review', () => {
    const inventorySnapshot = createNoAttentionSnapshot();
    const safeSkill = structuredClone(representativeInventorySnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')!);
    safeSkill.driftPresentation = 'active';
    safeSkill.isDrifted = true;
    safeSkill.issueReasons = ['identical-copies'];
    const manualSkill = structuredClone(representativeInventorySnapshot.skills.find((skill) => skill.name === 'diagnostic-rich-skill')!);
    manualSkill.name = 'manual-choice-skill';
    manualSkill.driftPresentation = 'active';
    manualSkill.isDrifted = true;
    manualSkill.issueReasons = ['diverged-copies', 'invalid-definition'];
    inventorySnapshot.skills = [safeSkill, manualSkill];
    inventorySnapshot.counts = {
      ...inventorySnapshot.counts,
      totalSkills: 2,
      healthySkills: 0,
      driftedSkills: 2,
    };
    inventorySnapshot.homeSummary = getHomeSummary(inventorySnapshot);

    renderDashboard({
      autoResolvableRequests: [safeRepairRequest],
      homeSummary: getHomeSummary(inventorySnapshot),
      inventorySnapshot,
    });

    expect(screen.getByText(/2 issues will still need manual review/i)).toBeInTheDocument();
    expect(screen.getByText(/explicit choices/i)).toBeInTheDocument();
    expect(screen.getByText(/plugin-managed contents/i)).toBeInTheDocument();
  });

  it('uses skill and MCP display names in planned safe repairs', () => {
    const inventorySnapshot = createNoAttentionSnapshot();
    const pluginSkill = structuredClone(representativeInventorySnapshot.skills.find((skill) => skill.name === 'mixed-plugin-skill')!);
    pluginSkill.name = 'toolkit:sync-workflow';
    pluginSkill.displayName = 'toolkit:sync-workflow';
    const pluginMcp: McpRecord = {
      name: 'toolkit:syncServer',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['missing-from-agents'],
      locations: [
        {
          agentId: 'sandbox-plugin-pack',
          agentLabel: 'Sandbox Plugin bundle',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/plugins/.mcp.json',
          command: 'node',
          args: ['server.js'],
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'claude',
              pluginId: 'sandbox-plugin-pack',
              version: '0.1.0',
            },
            sourcePath: '~/.skillindex/sandbox/plugins/.mcp.json',
            discoveredAt: '2026-01-06T00:00:31.000Z',
          },
          mutability: 'read-only-managed',
        },
      ],
    };
    inventorySnapshot.skills = [pluginSkill];
    inventorySnapshot.mcps = [pluginMcp];

    renderDashboard({
      autoResolvableRequests: [
        {
          entity: 'skill',
          issue: 'identical-copies',
          skillName: 'toolkit:sync-workflow',
        },
        {
          entity: 'mcp',
          issue: 'missing-from-agents',
          mcpName: 'toolkit:syncServer',
        },
      ],
      homeSummary: getHomeSummary(inventorySnapshot),
      inventorySnapshot,
    });

    fireEvent.click(screen.getByRole('button', { name: /Review 2 safe repairs/i }));
    const reviewPanel = document.getElementById('home-auto-repair-review-panel');
    expect(reviewPanel).not.toBeNull();

    expect(within(reviewPanel!).getByText('sync-workflow')).toBeInTheDocument();
    expect(within(reviewPanel!).getByText('syncServer')).toBeInTheDocument();
    expect(within(reviewPanel!).queryByText('toolkit:sync-workflow')).not.toBeInTheDocument();
    expect(within(reviewPanel!).queryByText('toolkit:syncServer')).not.toBeInTheDocument();
  });

  it('shows busy auto-resolve controls as disabled', () => {
    const { rerender } = renderDashboard({
      autoResolvableRequests: [safeRepairRequest],
    });

    fireEvent.click(screen.getByRole('button', { name: /Review 1 safe repair/i }));

    rerenderDashboard(rerender, {
      autoResolvableRequests: [safeRepairRequest],
      isAutoResolving: true,
    });

    expect(screen.getByRole('button', { name: /^Applying…$/i })).toBeDisabled();
  });

  it('uses the skill display name in the attention list', () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const targetSkill = inventorySnapshot.skills.find((skill) => skill.name === 'diverged-drift-skill');
    expect(targetSkill).toBeDefined();
    targetSkill!.displayName = 'PowerPoint';

    renderDashboard({
      homeSummary: getHomeSummary(inventorySnapshot),
      inventorySnapshot,
    });

    expect(screen.getByRole('button', { name: /PowerPoint/i })).toBeInTheDocument();
  });

  it('shows plugin indicators on Home attention rows for skills and MCPs', () => {
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
    delete inventorySnapshot.homeSummary;

    renderDashboard({
      homeSummary: getHomeSummary(inventorySnapshot),
      inventorySnapshot,
    });

    const pluginSkillRow = screen.getByRole('button', { name: /mixed-plugin-skill/i });
    expect(pluginSkillRow).toHaveTextContent('mixed-plugin-skill');
    expect(pluginSkillRow).toHaveAccessibleName(/This skill was installed via one or more plugins/i);

    const pluginMcpRow = screen.getByRole('button', { name: /signalMap/i });
    expect(pluginMcpRow).not.toHaveTextContent('signal-tools:');
    expect(pluginMcpRow).toHaveAccessibleName(/This skill was installed via one or more plugins/i);
  });
});

function renderDashboard(overrides: Partial<ComponentProps<typeof HomeDashboard>> = {}) {
  const props: ComponentProps<typeof HomeDashboard> = {
    autoResolvableRequests: [],
    homeSummary: getHomeSummary(overrides.inventorySnapshot ?? representativeInventorySnapshot),
    inventorySnapshot: representativeInventorySnapshot,
    isAutoResolving: false,
    isRescanning: false,
    onAutoResolve: vi.fn(),
    onNavigateToSkills: vi.fn(),
    onRescan: vi.fn(() => Promise.resolve()),
    onSelectMcp: vi.fn(),
    onSelectSkill: vi.fn(),
    onSelectSubagent: vi.fn(),
    ...overrides,
  };

  return render(<HomeDashboard {...props} />);
}

function rerenderDashboard(
  rerender: ReturnType<typeof render>['rerender'],
  overrides: Partial<ComponentProps<typeof HomeDashboard>>,
) {
  const props: ComponentProps<typeof HomeDashboard> = {
    autoResolvableRequests: [],
    homeSummary: getHomeSummary(overrides.inventorySnapshot ?? representativeInventorySnapshot),
    inventorySnapshot: representativeInventorySnapshot,
    isAutoResolving: false,
    isRescanning: false,
    onAutoResolve: vi.fn(),
    onNavigateToSkills: vi.fn(),
    onRescan: vi.fn(() => Promise.resolve()),
    onSelectMcp: vi.fn(),
    onSelectSkill: vi.fn(),
    onSelectSubagent: vi.fn(),
    ...overrides,
  };

  rerender(<HomeDashboard {...props} />);
}

function createNoAttentionSnapshot(): SkillInventorySnapshot {
  const snapshot = structuredClone(representativeInventorySnapshot);
  snapshot.skills = snapshot.skills.map((skill) => ({
    ...skill,
    driftPresentation: 'none',
    isDrifted: false,
  }));
  snapshot.mcps = [];
  snapshot.subagents = [];
  snapshot.counts = {
    ...snapshot.counts,
    driftedSkills: 0,
    dismissedDriftSkills: 0,
    healthySkills: snapshot.counts.totalSkills,
  };
  snapshot.mcpCounts = {
    totalMcps: 0,
    healthyMcps: 0,
    attentionMcps: 0,
    dismissedAttentionMcps: 0,
  };
  snapshot.subagentCounts = {
    totalSubagents: 0,
    healthySubagents: 0,
    attentionSubagents: 0,
    dismissedAttentionSubagents: 0,
  };
  delete snapshot.homeSummary;
  snapshot.homeSummary = getHomeSummary(snapshot);

  return snapshot;
}
