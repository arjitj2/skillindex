// @vitest-environment node

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { buildInventoryAgents, buildRegisteredInventorySources } from '@main/inventory-source-model';
import { KNOWN_AGENT_FAMILIES } from '@shared/known-agent-catalog';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

function arrayContaining(values: Parameters<typeof expect.arrayContaining>[0]): unknown {
  return expect.arrayContaining(values);
}

describe('buildRegisteredInventorySources', () => {
  it('builds deduped live and sandbox scan sources from compatible global dirs', () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex-data',
      },
    });

    const sources = buildRegisteredInventorySources({
      paths,
      homeDir: '/Users/tester',
      includeSandboxSources: true,
      includeLiveSources: true,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'opencode',
      },
    });

    expect(sources.map((source) => source.id)).toEqual([
      'sandbox-agents',
      'sandbox-config-opencode',
      'sandbox-claude',
      'live-agents',
      'live-config-opencode',
      'live-claude',
      'sandbox-plugin-pack',
    ]);
    expect(sources.find((source) => source.id === 'live-agents')).toMatchObject({
      canonical: true,
      kind: 'canonical',
      skillsDir: '/Users/tester/.agents/skills',
      compatibleAgentFamilies: [],
    });
    expect(sources.find((source) => source.id === 'live-config-opencode')).toMatchObject({
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'live',
      skillsDir: '/Users/tester/.config/opencode/skills',
      compatibleAgentFamilies: ['opencode'],
    });
    expect(sources.find((source) => source.id === 'sandbox-config-opencode')).toMatchObject({
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'sandbox',
      skillsDir: '/tmp/skillindex-data/sandbox/.config/opencode/skills',
      compatibleAgentFamilies: ['opencode'],
    });
  });

  it('dedupes shared global skills dirs and records compatible agent families', () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex-data',
      },
    });

    const sources = buildRegisteredInventorySources({
      paths,
      includeSandboxSources: true,
      includeLiveSources: true,
      env: { SKILL_INDEX_AGENT_SUBSET: 'amp,opencode' },
    });

    expect(sources.some((source) => source.id === 'sandbox-agents')).toBe(true);
    expect(sources.some((source) => source.id === 'live-agents')).toBe(true);
    expect(sources.some((source) => source.id === 'sandbox-plugin-pack')).toBe(true);
    expect(sources.find((source) => source.id === 'sandbox-agents')).toMatchObject({
      compatibleAgentFamilies: [],
      skillsDir: '/tmp/skillindex-data/sandbox/.agents/skills',
    });
    expect(sources.find((source) => source.id === 'sandbox-claude')).toMatchObject({
      compatibleAgentFamilies: arrayContaining(['amp', 'opencode']),
      skillsDir: '/tmp/skillindex-data/sandbox/.claude/skills',
    });
  });

  it('does not create a scan source for Claude Desktop account-managed skills', () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex-data',
      },
    });

    const sources = buildRegisteredInventorySources({
      paths,
      homeDir: '/Users/tester',
      includeSandboxSources: true,
      includeLiveSources: true,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'claude-desktop',
      },
    });

    expect(sources.map((source) => source.id)).toEqual([
      'sandbox-agents',
      'live-agents',
      'sandbox-plugin-pack',
    ]);
  });

  it('uses Windsurf documented global skills dir instead of the workspace skills dir under home', () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex-data',
      },
    });

    const sources = buildRegisteredInventorySources({
      paths,
      homeDir: '/Users/tester',
      includeSandboxSources: true,
      includeLiveSources: true,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'windsurf',
      },
    });

    expect(sources.map((source) => source.skillsDir)).toEqual(expect.arrayContaining([
      '/tmp/skillindex-data/sandbox/.codeium/windsurf/skills',
      '/Users/tester/.codeium/windsurf/skills',
    ]));
    expect(sources.map((source) => source.skillsDir)).not.toEqual(expect.arrayContaining([
      '/tmp/skillindex-data/sandbox/.windsurf/skills',
      '/Users/tester/.windsurf/skills',
    ]));
  });

  it('carries display-path-specific ignored skill subpaths onto agent-owned sources', () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex-data',
      },
    });

    const sources = buildRegisteredInventorySources({
      paths,
      homeDir: '/Users/tester',
      includeSandboxSources: true,
      includeLiveSources: true,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'codex',
      },
    });

    expect(sources.find((source) => source.id === 'sandbox-codex')).toMatchObject({
      skillsDir: '/tmp/skillindex-data/sandbox/.codex/skills',
      ignoredSkillSubpaths: ['.system'],
    });
    expect(sources.find((source) => source.id === 'live-codex')).toMatchObject({
      skillsDir: '/Users/tester/.codex/skills',
      ignoredSkillSubpaths: ['.system'],
    });
    expect(sources.find((source) => source.id === 'sandbox-agents')?.ignoredSkillSubpaths).toBeUndefined();
  });

  it('exposes supported agents with install state plus skills and MCP config locations', async () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex-data',
      },
    });

    const agents = await buildInventoryAgents({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(agents).toHaveLength(KNOWN_AGENT_FAMILIES.length);
    expect(agents.find((agent) => agent.id === 'sandbox-codex')).toMatchObject({
      label: 'Codex',
      writable: true,
      scope: 'sandbox',
      installState: 'not-installed',
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.agents/skills',
      defaultHomeDir: '~/.agents',
      skillsLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.agents/skills',
        displayPath: '/tmp/skillindex-data/sandbox/.agents/skills',
        exists: false,
      },
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.codex/config.toml',
        displayPath: '/tmp/skillindex-data/sandbox/.codex/config.toml',
        exists: false,
      },
      configLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.codex/config.toml',
        displayPath: '/tmp/skillindex-data/sandbox/.codex/config.toml',
        exists: false,
      },
      executableLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/bin/codex',
        exists: false,
      },
    });
    expect(agents.find((agent) => agent.id === 'sandbox-claude')).toMatchObject({
      label: 'Claude Code',
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.claude.json',
        exists: false,
      },
      configLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.claude/settings.json',
        exists: false,
      },
      executableLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/bin/claude',
        exists: false,
      },
    });
    expect(agents.find((agent) => agent.id === 'sandbox-claude-desktop')).toMatchObject({
      label: 'Claude Desktop',
      defaultGlobalSkillsDir: 'claude.ai Customize > Skills',
      skillsLocation: {
        state: 'unavailable',
        reason: 'account-managed',
      },
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/Library/Application Support/Claude/claude_desktop_config.json',
        exists: false,
      },
      configLocation: {
        state: 'unavailable',
        reason: 'not-supported',
      },
      executableLocation: {
        state: 'unavailable',
        reason: 'not-supported',
      },
    });
    expect(agents.find((agent) => agent.id === 'sandbox-factory')).toMatchObject({
      label: 'Factory',
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.factory/mcp.json',
        exists: false,
      },
      configLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.factory/settings.json',
        exists: false,
      },
      executableLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/bin/factory',
        exists: false,
      },
    });
    expect(agents.find((agent) => agent.id === 'sandbox-windsurf')).toMatchObject({
      label: 'Windsurf',
      defaultGlobalSkillsDir: '~/.codeium/windsurf/skills',
      skillsLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.codeium/windsurf/skills',
        exists: false,
      },
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.codeium/windsurf/mcp_config.json',
        exists: false,
      },
    });
    expect(agents.find((agent) => agent.id === 'sandbox-opencode')).toMatchObject({
      label: 'OpenCode',
      defaultGlobalSkillsDir: '~/.agents/skills',
      skillsLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.agents/skills',
        exists: false,
      },
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.config/opencode/opencode.json',
        exists: false,
      },
    });
    expect(agents.find((agent) => agent.id === 'sandbox-cursor')).toMatchObject({
      label: 'Cursor',
      mcpConfigLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.cursor/mcp.json',
        exists: false,
      },
      configLocation: {
        state: 'available',
        path: '/tmp/skillindex-data/sandbox/.cursor/cli-config.json',
        exists: false,
      },
    });
  });

  it('uses vendored upstream install detection while keeping live skills on verified default dirs', async () => {
    const homeDir = path.join(tmpdir(), `skillindex-agent-home-${Date.now()}`);
    const codexHome = path.join(homeDir, '.codex-custom');
    const claudeConfigDir = path.join(homeDir, '.claude-custom');

    await Promise.all([
      mkdir(path.join(codexHome, 'skills'), { recursive: true }),
      mkdir(path.join(claudeConfigDir, 'skills'), { recursive: true }),
    ]);

    const paths = resolveSkillIndexPaths({
      homeDir,
      env: {
        SKILL_INDEX_DATA_DIR: path.join(homeDir, '.skillindex-data'),
      },
    });

    const agents = await buildInventoryAgents({
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
      env: {
        CODEX_HOME: codexHome,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        PATH: '',
      },
    });

    expect(agents.find((agent) => agent.id === 'live-codex')).toMatchObject({
      label: 'Codex',
      installState: 'installed',
      defaultGlobalSkillsDir: '~/.agents/skills',
      skillsLocation: {
        path: path.join(homeDir, '.agents', 'skills'),
        displayPath: '~/.agents/skills',
        exists: false,
      },
      executableLocation: {
        exists: false,
      },
    });
    expect(agents.find((agent) => agent.id === 'live-claude')).toMatchObject({
      label: 'Claude Code',
      installState: 'installed',
      defaultGlobalSkillsDir: '~/.claude/skills',
      skillsLocation: {
        path: path.join(claudeConfigDir, 'skills'),
        displayPath: '~/.claude-custom/skills',
        exists: true,
      },
      executableLocation: {
        exists: false,
      },
    });
  });

  it('does not mark sandbox universal agents installed just because the shared skills dir exists', async () => {
    const root = path.join(tmpdir(), `skillindex-sandbox-install-${Date.now()}`);
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(paths.sandboxAgentsSkillsDir, { recursive: true });

    const agents = await buildInventoryAgents({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(agents.find((agent) => agent.id === 'sandbox-cline')).toMatchObject({
      installState: 'not-installed',
      skillsLocation: {
        path: path.join(paths.sandboxRoot, '.agents', 'skills'),
        exists: true,
      },
    });
  });

  it('collapses live display paths under a Windows-style home dir even when resolved paths use forward slashes', async () => {
    const homeDir = 'C:\\Users\\tester';
    const claudeConfigDir = 'C:\\Users\\tester\\.claude-custom';
    const paths = resolveSkillIndexPaths({
      homeDir,
      env: {
        SKILL_INDEX_DATA_DIR: 'C:\\skillindex-data',
      },
    });

    const agents = await buildInventoryAgents({
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
      env: {
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        PATH: '',
      },
    });

    expect(agents.find((agent) => agent.id === 'live-claude')).toMatchObject({
      skillsLocation: {
        path: 'C:/Users/tester/.claude-custom/skills',
        displayPath: '~/.claude-custom/skills',
      },
      mcpConfigLocation: {
        path: 'C:/Users/tester/.claude.json',
        displayPath: '~/.claude.json',
      },
    });
  });
});
