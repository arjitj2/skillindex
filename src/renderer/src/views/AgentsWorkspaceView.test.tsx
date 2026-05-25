import { createRef } from 'react';

import type { AgentLocationRecord, AgentRecord, SkillInventorySnapshot } from '@shared/contracts';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentsWorkspaceView } from './AgentsWorkspaceView';

function createAvailableLocation(path: string): AgentLocationRecord {
  return {
    state: 'available',
    exists: true,
    path,
  };
}

function createAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'sandbox-codex',
    family: 'codex',
    label: 'Codex',
    writable: true,
    scope: 'sandbox',
    installState: 'installed',
    defaultProjectSkillsDir: '~/.agents/skills',
    defaultGlobalSkillsDir: '~/.agents/skills',
    defaultHomeDir: '~/.agents',
    skillsLocation: createAvailableLocation('~/.agents/skills'),
    mcpConfigLocation: createAvailableLocation('~/.agents/mcp.json'),
    configLocation: createAvailableLocation('~/.agents/config.json'),
    executableLocation: createAvailableLocation('~/.local/bin/codex'),
    ...overrides,
  };
}

function renderAgentsView(rows: AgentRecord[], options: { isRescanning?: boolean } = {}) {
  return render(
    <AgentsWorkspaceView
      errorMessage={null}
      inventorySnapshot={{} as SkillInventorySnapshot}
      isRescanning={options.isRescanning ?? false}
      onRescan={vi.fn(() => Promise.resolve())}
      onSearchQueryChange={vi.fn()}
      rows={rows}
      searchInputRef={createRef<HTMLInputElement>()}
      searchQuery=""
    />,
  );
}

describe('AgentsWorkspaceView', () => {
  it('uses MCP connectivity loading copy for the global rescan action', () => {
    renderAgentsView([createAgent()], { isRescanning: true });

    expect(screen.getByRole('button', { name: 'Testing MCP connectivity…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rescanning…' })).not.toBeInTheDocument();
  });

  it('groups agents by installed state and shows location headers in the section header', () => {
    const installedAgent = createAgent();
    const missingAgent = createAgent({
      id: 'sandbox-adal',
      family: 'adal',
      label: 'AdaL',
      installState: 'not-installed',
      defaultHomeDir: '~/.adal',
      defaultGlobalSkillsDir: '~/.config/agents/skills',
      mcpConfigLocation: {
        state: 'available',
        exists: false,
        path: '~/.config/agents/mcp.json',
      },
    });

    const { container } = render(
      <AgentsWorkspaceView
        errorMessage={null}
        inventorySnapshot={{} as SkillInventorySnapshot}
        isRescanning={false}
        onRescan={vi.fn(() => Promise.resolve())}
        onSearchQueryChange={vi.fn()}
        rows={[installedAgent, missingAgent]}
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
      />,
    );

    expect(container.querySelector('.not-installed-agent-row')).toBeNull();
    expect(container.querySelector('.not-installed-pill')).toBeNull();
    expect(container.querySelector('.page-scroll')).toHaveClass('page-scroll--agents');
    expect(screen.getByRole('searchbox', { name: /Search agents/i })).toBeInTheDocument();
    expect(screen.getByText('⌘F')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rescan$/i }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Agents list' })).toHaveClass('agent-group-stack--scroll');
    expect(screen.getByRole('toolbar', { name: 'Agent filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Installed1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not installed1' })).toBeInTheDocument();
    expect(screen.getAllByText('Skills source')).toHaveLength(2);
    expect(screen.getAllByText('MCP / config')).toHaveLength(2);
    expect(screen.queryByText('Installed agents on this machine.')).not.toBeInTheDocument();
    expect(screen.queryByText('Detected in the registry but not on this machine.')).not.toBeInTheDocument();

    const missingRow = screen.getByText('AdaL').closest('.agent-status-row');
    expect(missingRow).not.toBeNull();
    expect(within(missingRow as HTMLElement).getByText('~/.config/agents/skills')).toBeInTheDocument();
    expect(within(missingRow as HTMLElement).getByText('~/.config/agents/mcp.json')).toBeInTheDocument();
    expect(within(missingRow as HTMLElement).queryByText('Skills source')).not.toBeInTheDocument();
    expect(within(missingRow as HTMLElement).queryByText('MCP / config')).not.toBeInTheDocument();
    expect(within(missingRow as HTMLElement).queryByText('Not installed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not installed1' }));
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
    expect(screen.getByText('AdaL')).toBeInTheDocument();
  });

  it('prefers collapsed display paths over absolute MCP config paths when available', () => {
    const installedAgent = createAgent({
      mcpConfigLocation: {
        ...createAvailableLocation('/Users/tester/.claude.json'),
        displayPath: '~/.claude.json',
      } as AgentLocationRecord,
    });

    const { container } = renderAgentsView([installedAgent]);

    const installedRow = container.querySelector('.agent-status-row');
    expect(installedRow).not.toBeNull();
    expect(within(installedRow as HTMLElement).getByText('~/.claude.json')).toBeInTheDocument();
    expect(within(installedRow as HTMLElement).queryByText('/Users/tester/.claude.json')).not.toBeInTheDocument();
  });

  it('explains agents whose skills are managed outside the local filesystem', () => {
    const installedAgent = createAgent({
      id: 'sandbox-claude-desktop',
      family: 'claude-desktop',
      label: 'Claude Desktop',
      defaultGlobalSkillsDir: 'claude.ai Customize > Skills',
      skillsLocation: {
        state: 'unavailable',
        exists: false,
        reason: 'account-managed',
      },
    });

    const { container } = renderAgentsView([installedAgent]);

    const installedRow = container.querySelector('.agent-status-row');
    expect(installedRow).not.toBeNull();
    expect(within(installedRow as HTMLElement).getByText('Cloud account managed')).toHaveClass(
      'agent-location-path--account-managed',
    );
    expect(within(installedRow as HTMLElement).queryByText('No local skills folder to install into')).not.toBeInTheDocument();
    expect(within(installedRow as HTMLElement).getByTitle(
      "Skills are managed through this agent's cloud account; Skill Index cannot scan or install local skill files for it.",
    )).toBeInTheDocument();
    expect(within(installedRow as HTMLElement).queryByText('claude.ai Customize > Skills')).not.toBeInTheDocument();
  });

  it('renders a real icon image when the agent provides a usable image asset', () => {
    const { container } = renderAgentsView([createAgent({
      icon: {
        assetUrl: 'https://example.com/codex-icon.png',
        format: 'png',
      },
    })]);

    const image = container.querySelector('.agent-avatar-image');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', 'https://example.com/codex-icon.png');
    expect(image).toHaveAttribute('alt', '');
  });

  it('falls back to the letter avatar when the icon metadata is not directly renderable', () => {
    const { container } = renderAgentsView([createAgent({
      icon: {
        assetUrl: 'https://example.com/brand.zip',
        format: 'zip',
      },
    })]);

    expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
    expect(container.querySelector('.agent-avatar')?.textContent).toBe('C');
  });

  it('recovers from a previous image error when a new icon URL arrives', () => {
    const { container, rerender } = renderAgentsView([createAgent({
      icon: {
        assetUrl: 'https://example.com/bad-icon.png',
        format: 'png',
      },
    })]);

    const image = container.querySelector('.agent-avatar-image');
    expect(image).not.toBeNull();
    fireEvent.error(image as Element);
    expect(container.querySelector('.agent-avatar-image')).toBeNull();
    expect(container.querySelector('.agent-avatar')?.textContent).toBe('C');

    rerender(
      <AgentsWorkspaceView
        errorMessage={null}
        inventorySnapshot={{} as SkillInventorySnapshot}
        isRescanning={false}
        onRescan={vi.fn(() => Promise.resolve())}
        onSearchQueryChange={vi.fn()}
        rows={[createAgent({
          icon: {
            assetUrl: 'https://example.com/good-icon.png',
            format: 'png',
          },
        })]}
        searchInputRef={createRef<HTMLInputElement>()}
        searchQuery=""
      />,
    );

    expect(container.querySelector('.agent-avatar-image')).toHaveAttribute('src', 'https://example.com/good-icon.png');
  });
});
