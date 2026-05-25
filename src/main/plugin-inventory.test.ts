// @vitest-environment node

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPluginSkillScanSources, scanPluginInventory } from '@main/plugin-inventory';
import { applyCapabilityAction } from '@main/capability-actions';
import { scanSkillInventory } from '@main/skill-inventory';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeSkill(rootPath: string, name: string, description: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `Use ${name}.`,
  ].join('\n'), 'utf8');
}

describe('plugin inventory', () => {
  it('discovers installed Codex and Claude plugin bundles with skills and MCPs', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-plugins-home-'));
    const codexRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'github-tools', 'abc123');
    const claudeRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'anthropic', 'jira-tools', '1.0.0');

    await writeJson(path.join(codexRoot, '.codex-plugin', 'plugin.json'), {
      name: 'github-tools',
      version: 'abc123',
      repository: 'https://github.com/example/github-tools',
    });
    await writeSkill(path.join(codexRoot, 'skills', 'github'), 'github', 'GitHub workflow helpers');
    await writeJson(path.join(codexRoot, '.mcp.json'), {
      mcpServers: {
        github: {
          command: 'node',
          args: ['${CODEX_PLUGIN_ROOT}/server.js'],
        },
      },
    });
    await writeJson(path.join(codexRoot, 'hooks', 'hooks.json'), {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node hook.js' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }],
      },
    });

    await writeJson(path.join(claudeRoot, '.claude-plugin', 'plugin.json'), {
      name: 'jira-tools',
      version: '1.0.0',
      repository: 'https://github.com/example/jira-tools',
    });
    await writeSkill(path.join(claudeRoot, 'skills', 'jira'), 'jira', 'Jira workflow helpers');
    await writeJson(path.join(claudeRoot, '.mcp.json'), {
      mcpServers: {
        jira: {
          command: 'node',
          args: ['${CLAUDE_PLUGIN_ROOT}/server.js'],
        },
      },
    });

    const plugins = await scanPluginInventory({ homeDir });

    expect(plugins).toHaveLength(2);
    expect(plugins.find((plugin) => plugin.pluginId === 'github-tools@openai-curated')).toMatchObject({
      host: 'codex',
      pluginName: 'github-tools',
      version: 'abc123',
      enabled: 'unknown',
      source: {
        marketplace: 'openai-curated',
        repository: 'https://github.com/example/github-tools',
      },
      bundledSkills: [
        expect.objectContaining({
          name: 'github',
          entrypointPath: path.join(codexRoot, 'skills', 'github', 'SKILL.md'),
        }),
      ],
      bundledMcps: [
        expect.objectContaining({
          name: 'github',
          configPath: path.join(codexRoot, '.mcp.json'),
        }),
      ],
      unsupportedAssets: [
        expect.objectContaining({
          kind: 'hook',
          name: 'session-start',
          path: path.join(codexRoot, 'hooks', 'hooks.json'),
        }),
        expect.objectContaining({
          kind: 'hook',
          name: 'stop',
          path: path.join(codexRoot, 'hooks', 'hooks.json'),
        }),
      ],
      unsupportedHooksCount: 2,
    });
    expect(plugins.find((plugin) => plugin.pluginId === 'jira-tools@anthropic')).toMatchObject({
      host: 'claude',
      pluginName: 'jira-tools',
      bundledSkills: [expect.objectContaining({ name: 'jira' })],
      bundledMcps: [expect.objectContaining({ name: 'jira' })],
    });
  });

  it('uses Claude marketplace metadata when installed plugin manifests omit source URLs and versions', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-plugins-claude-marketplace-'));
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'frontend-design', 'unknown');
    const lspPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'swift-lsp', '1.0.0');

    await writeJson(path.join(homeDir, '.claude', 'plugins', 'known_marketplaces.json'), {
      'claude-plugins-official': {
        source: {
          source: 'github',
          repo: 'anthropics/claude-plugins-official',
        },
      },
    });
    await writeJson(path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json'), {
      name: 'claude-plugins-official',
      plugins: [
        {
          name: 'frontend-design',
          homepage: 'https://github.com/anthropics/claude-plugins-public/tree/main/plugins/frontend-design',
          source: './plugins/frontend-design',
        },
        {
          name: 'swift-lsp',
          source: './plugins/swift-lsp',
        },
      ],
    });
    await writeJson(path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'feature-dev', '.claude-plugin', 'plugin.json'), {
      name: 'feature-dev',
      version: '1.0.0',
    });
    await writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'frontend-design',
      description: 'Frontend design skill for UI/UX implementation',
      author: {
        name: 'Anthropic',
      },
    });
    await writeSkill(path.join(pluginRoot, 'skills', 'frontend-design'), 'frontend-design', 'Frontend design helpers');
    await writeJson(path.join(lspPluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'swift-lsp',
      version: '1.0.0',
    });

    const plugins = await scanPluginInventory({ homeDir });

    expect(plugins).toHaveLength(2);
    expect(plugins.find((plugin) => plugin.pluginName === 'frontend-design')).toMatchObject({
      host: 'claude',
      pluginId: 'frontend-design@claude-plugins-official',
      pluginName: 'frontend-design',
      version: undefined,
      source: {
        marketplace: 'claude-plugins-official',
        repository: 'https://github.com/anthropics/claude-plugins-public/tree/main/plugins/frontend-design',
      },
    });
    expect(plugins.find((plugin) => plugin.pluginName === 'swift-lsp')).toMatchObject({
      host: 'claude',
      pluginId: 'swift-lsp@claude-plugins-official',
      pluginName: 'swift-lsp',
      version: '1.0.0',
      source: {
        marketplace: 'claude-plugins-official',
        repository: 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/swift-lsp',
      },
    });
  });

  it('uses plugin homepage as a source URL when repository metadata is absent', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-plugins-homepage-'));
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-bundled', 'computer-use', '1.0.770');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'computer-use',
      version: '1.0.770',
      homepage: 'https://openai.com/',
    });

    const plugins = await scanPluginInventory({ homeDir });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      host: 'codex',
      pluginId: 'computer-use@openai-bundled',
      source: {
        marketplace: 'openai-bundled',
        repository: 'https://openai.com/',
      },
    });
  });

  it('reads Claude plugin enabled state from user settings', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-plugins-claude-state-'));
    const enabledRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'anthropic', 'jira-tools', '1.0.0');
    const disabledRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'anthropic', 'slack-tools', '1.0.0');
    const unknownRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'anthropic', 'linear-tools', '1.0.0');

    await writeJson(path.join(homeDir, '.claude', 'settings.json'), {
      enabledPlugins: {
        'jira-tools@anthropic': true,
        'slack-tools@anthropic': false,
      },
    });
    await writeJson(path.join(enabledRoot, '.claude-plugin', 'plugin.json'), {
      name: 'jira-tools',
      version: '1.0.0',
    });
    await writeJson(path.join(disabledRoot, '.claude-plugin', 'plugin.json'), {
      name: 'slack-tools',
      version: '1.0.0',
    });
    await writeJson(path.join(unknownRoot, '.claude-plugin', 'plugin.json'), {
      name: 'linear-tools',
      version: '1.0.0',
    });

    const plugins = await scanPluginInventory({ homeDir });

    expect(plugins.find((plugin) => plugin.pluginId === 'jira-tools@anthropic')?.enabled).toBe(true);
    expect(plugins.find((plugin) => plugin.pluginId === 'slack-tools@anthropic')?.enabled).toBe(false);
    expect(plugins.find((plugin) => plugin.pluginId === 'linear-tools@anthropic')?.enabled).toBe('unknown');
  });

  it('builds plugin skill scan sources from manifest skill roots', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-plugins-skill-roots-'));
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'multi-root', 'abc123');
    const moreSkillsRoot = path.join(pluginRoot, 'more', 'skills');
    const toolingSkillsRoot = path.join(pluginRoot, 'tooling', 'skills');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'multi-root',
      version: 'abc123',
      skills: ['tooling/skills', 'more/skills'],
    });
    await writeSkill(path.join(toolingSkillsRoot, 'alpha'), 'alpha', 'Alpha helpers');
    await writeSkill(path.join(moreSkillsRoot, 'beta'), 'beta', 'Beta helpers');

    const plugins = await scanPluginInventory({ homeDir });
    const sources = buildPluginSkillScanSources(plugins);

    expect(plugins[0].skillRoots).toEqual([moreSkillsRoot, toolingSkillsRoot]);
    expect(sources.map((source) => source.skillsDir)).toEqual([moreSkillsRoot, toolingSkillsRoot]);
    expect(plugins[0].bundledSkills).toEqual([
      expect.objectContaining({
        name: 'alpha',
        sourceId: 'plugin:codex:multi-root@openai-curated:abc123:skill-root:2',
      }),
      expect.objectContaining({
        name: 'beta',
        sourceId: 'plugin:codex:multi-root@openai-curated:abc123',
      }),
    ]);
  });

  it('includes plugin-owned skills and MCPs as read-only provenance records in scans', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-scan-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'github-tools', 'abc123');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'github-tools',
      version: 'abc123',
      repository: 'https://github.com/example/github-tools',
    });
    await writeSkill(path.join(pluginRoot, 'skills', 'github'), 'github', 'GitHub workflow helpers');
    await writeJson(path.join(pluginRoot, '.mcp.json'), {
      mcpServers: {
        github: {
          command: 'node',
          args: ['${CODEX_PLUGIN_ROOT}/server.js'],
        },
      },
    });

    const inventory = await scanSkillInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.plugins).toHaveLength(1);
    expect(inventory.sources).toContainEqual(expect.objectContaining({
      id: 'plugin:codex:github-tools@openai-curated:abc123',
      kind: 'plugin',
      writable: false,
      canonical: true,
      skillsDir: path.join(pluginRoot, 'skills'),
    }));
    const pluginSkill = inventory.skills.find((skill) => skill.name === 'github-tools:github');
    expect(pluginSkill).toMatchObject({
      displayName: 'github',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
    });
    expect(pluginSkill?.locations[0]).toMatchObject({
      canonical: true,
      mutability: 'read-only-managed',
      canonicalRole: 'canonical',
      provenance: {
        kind: 'plugin',
        plugin: {
          host: 'codex',
          pluginId: 'github-tools@openai-curated',
          version: 'abc123',
        },
        sourcePath: path.join(pluginRoot, 'skills', 'github'),
      },
    });
    const pluginMcp = inventory.mcps?.find((mcp) => mcp.name === 'github-tools:github');
    expect(pluginMcp).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
    });
    expect(pluginMcp?.locations[0]).toMatchObject({
      agentId: 'plugin:codex:github-tools@openai-curated:abc123',
      mutability: 'read-only-managed',
      canonicalRole: 'canonical',
      provenance: {
        kind: 'plugin',
        plugin: {
          host: 'codex',
          pluginId: 'github-tools@openai-curated',
          version: 'abc123',
        },
      },
    });
    expect(pluginMcp?.missingLocations?.every((location) => !location.agentId.startsWith('plugin:'))).toBe(true);
  });

  it('reads plugin MCP configs that use top-level server definitions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-top-level-mcp-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'context7', 'unknown');

    await writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'context7',
      description: 'Upstash Context7 MCP server.',
    });
    await writeJson(path.join(pluginRoot, '.mcp.json'), {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
      },
    });

    const inventory = await scanSkillInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'Claude Plugin context7 MCP config')).toBeUndefined();
    const pluginMcp = inventory.mcps?.find((mcp) => mcp.name === 'context7:context7');
    expect(pluginMcp).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      locations: [
        expect.objectContaining({
          agentId: 'plugin:claude:context7@claude-plugins-official:unknown',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        }),
      ],
    });
    expect(pluginMcp?.locations[0]?.definitionText).toContain('@upstash/context7-mcp');
  });

  it('groups plugin MCPs with same-name agent config entries without requiring normal MCPs in plugin configs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-mcp-expectations-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'openai-bundled', 'computer-use', '1.0.770');

    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), [
      'model = "gpt-5"',
      '',
      '[mcp_servers.healthyMcp]',
      'command = "node"',
      'args = ["healthy-mcp.js"]',
      '',
    ].join('\n'), 'utf8');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'computer-use',
      version: '1.0.770',
    });
    await writeJson(path.join(pluginRoot, '.mcp.json'), {
      mcpServers: {
        healthyMcp: {
          command: 'node',
          args: ['healthy-mcp.js'],
        },
      },
    });

    const inventory = await scanSkillInventory({
      paths,
      homeDir,
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    const pluginMcp = inventory.mcps?.find((mcp) => mcp.name === 'computer-use:healthyMcp');
    expect(pluginMcp).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      missingLocations: [],
    });
    expect(pluginMcp?.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: 'sandbox-codex',
        configName: 'healthyMcp',
      }),
      expect.objectContaining({
        agentId: 'plugin:sandbox:codex:computer-use@openai-bundled:1.0.770',
        configName: 'healthyMcp',
      }),
    ]));
    expect(inventory.mcps?.find((mcp) => mcp.name === 'healthyMcp')).toBeUndefined();
    expect(pluginMcp?.missingLocations?.every((location) => !location.agentId.startsWith('plugin:'))).toBe(true);
  });

  it('does not mark mirrored Codex and Claude plugin skills as diverged for Codex-only agent metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-mirror-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const codexRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'sandbox-curated', 'example-workflow-kit', '5.1.0');
    const claudeRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'sandbox-gallery', 'example-workflow-kit', '5.1.0');

    await writeJson(path.join(codexRoot, '.codex-plugin', 'plugin.json'), {
      name: 'example-workflow-kit',
      version: '5.1.0',
    });
    await writeJson(path.join(claudeRoot, '.claude-plugin', 'plugin.json'), {
      name: 'example-workflow-kit',
      version: '5.1.0',
    });
    await writeSkill(path.join(codexRoot, 'skills', 'idea-shaping'), 'idea-shaping', 'Structure product ideas');
    await writeSkill(path.join(claudeRoot, 'skills', 'idea-shaping'), 'idea-shaping', 'Structure product ideas');
    await mkdir(path.join(codexRoot, 'skills', 'idea-shaping', 'agents'), { recursive: true });
    await writeFile(path.join(codexRoot, 'skills', 'idea-shaping', 'agents', 'sandbox-runner.yaml'), 'name: sandbox-runner\n', 'utf8');

    const inventory = await scanSkillInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    const skill = inventory.skills.find((candidate) => candidate.name === 'example-workflow-kit:idea-shaping');
    expect(skill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
    });
    expect(skill?.locations).toHaveLength(2);
    expect(skill?.diff).toBeUndefined();
  });

  it('scans plugin bundles copied into the sandbox home when live sources are disabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-sandbox-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-curated', 'signal-tools', 'abc123');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'signal-tools',
      version: 'abc123',
    });
    await writeSkill(path.join(pluginRoot, 'skills', 'signal-map'), 'signal-map', 'Synthetic workflow helpers');
    await writeJson(path.join(pluginRoot, '.mcp.json'), {
      mcpServers: {
        signalMap: {
          command: 'node',
          args: ['${CODEX_PLUGIN_ROOT}/server.js'],
        },
      },
    });

    const inventory = await scanSkillInventory({
      paths,
      homeDir,
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    expect(inventory.plugins).toContainEqual(expect.objectContaining({
      host: 'codex',
      scope: 'sandbox',
      pluginId: 'signal-tools@sandbox-curated',
      rootPath: pluginRoot,
    }));
    expect(inventory.sources).toContainEqual(expect.objectContaining({
      id: 'plugin:sandbox:codex:signal-tools@sandbox-curated:abc123',
      kind: 'plugin',
      scope: 'sandbox',
      writable: false,
      canonical: true,
      skillsDir: path.join(pluginRoot, 'skills'),
    }));
    expect(inventory.skills.find((skill) => skill.name === 'signal-tools:signal-map')?.locations[0]).toMatchObject({
      sourceId: 'plugin:sandbox:codex:signal-tools@sandbox-curated:abc123',
      sourceScope: 'sandbox',
      mutability: 'read-only-managed',
      canonicalRole: 'canonical',
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'signal-tools:signalMap')?.locations[0]).toMatchObject({
      agentId: 'plugin:sandbox:codex:signal-tools@sandbox-curated:abc123',
      scope: 'sandbox',
      mutability: 'read-only-managed',
      canonicalRole: 'canonical',
    });
  });

  it('resolves Claude plugin source URLs from sandbox marketplace metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-sandbox-claude-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(paths.sandboxRoot, '.claude', 'plugins', 'cache', 'sandbox-gallery', 'signal-index', '1.0.0');

    await writeJson(path.join(paths.sandboxRoot, '.claude', 'plugins', 'known_marketplaces.json'), {
      'sandbox-gallery': {
        source: {
          source: 'github',
          repo: 'example/sandbox-gallery',
        },
      },
    });
    await writeJson(path.join(paths.sandboxRoot, '.claude', 'plugins', 'marketplaces', 'sandbox-gallery', '.claude-plugin', 'marketplace.json'), {
      name: 'sandbox-gallery',
      plugins: [
        {
          name: 'signal-index',
          source: './plugins/signal-index',
        },
      ],
    });
    await writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'signal-index',
      version: '1.0.0',
    });

    const inventory = await scanSkillInventory({
      paths,
      homeDir,
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    expect(inventory.plugins).toContainEqual(expect.objectContaining({
      host: 'claude',
      scope: 'sandbox',
      pluginId: 'signal-index@sandbox-gallery',
      source: {
        marketplace: 'sandbox-gallery',
        repository: 'https://github.com/example/sandbox-gallery/tree/main/plugins/signal-index',
      },
    }));
  });

  it('does not expose detached plugin export as a capability action', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-no-detached-export-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'github-tools', 'abc123');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'github-tools',
      version: 'abc123',
    });
    await writeSkill(path.join(pluginRoot, 'skills', 'github'), 'github', 'GitHub workflow helpers');

    await expect(applyCapabilityAction({
      entity: 'skill',
      action: 'export-detached-copy',
      skillName: 'github-tools:github',
    } as never, {
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    })).rejects.toThrow('Unsupported capability action: export-detached-copy');
  });

  it('does not accept plugin overlap classification capability actions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-no-classify-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'github-tools', 'abc123');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'github-tools',
      version: 'abc123',
    });
    await writeSkill(path.join(pluginRoot, 'skills', 'github'), 'github', 'GitHub workflow helpers');
    await writeSkill(path.join(homeDir, '.agents', 'skills', 'github'), 'github', 'Local GitHub workflow helpers');

    await expect(applyCapabilityAction({
      entity: 'skill',
      action: 'mark-equivalent',
      skillName: 'github-tools:github',
      equivalentSkillName: 'github',
    } as never, {
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    })).rejects.toThrow('Unsupported capability action: mark-equivalent');

    await expect(applyCapabilityAction({
      entity: 'skill',
      action: 'ignore-overlap',
      skillName: 'github-tools:github',
      equivalentSkillName: 'github',
    } as never, {
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    })).rejects.toThrow('Unsupported capability action: ignore-overlap');
  });

  it('persists a local Universal choice with the plugin version kept separate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-universal-choice-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: dataDir },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'github-tools', 'abc123');
    const localSkillPath = path.join(homeDir, '.agents', 'skills', 'github');

    await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: 'github-tools',
      version: 'abc123',
    });
    await writeSkill(path.join(pluginRoot, 'skills', 'github'), 'github', 'GitHub workflow helpers from plugin');
    await writeSkill(localSkillPath, 'github', 'Local GitHub workflow helpers');

    const inventory = await applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'github',
      selectedVariantPath: localSkillPath,
    }, {
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    const localSkill = inventory.skills.find((skill) => skill.name === 'github');
    expect(localSkill?.detailDiagnostics.universalDecision).toMatchObject({
      state: 'user-confirmed',
      universal: {
        kind: 'path',
        sourceId: 'live-agents',
        path: localSkillPath,
      },
    });
    expect(localSkill?.detailDiagnostics.acceptedAlternates?.[0]).toMatchObject({
      kind: 'plugin',
      pluginId: 'github-tools@openai-curated',
      pluginSkillName: 'github',
      reason: 'kept-separate',
    });
    expect(inventory.skills.find((skill) => skill.name === 'github-tools:github')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });
  });
});
