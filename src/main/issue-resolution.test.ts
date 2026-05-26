// @vitest-environment node

import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyCapabilityAction } from '@main/capability-actions';
import { addMcpServer, resolveInventoryIssue } from '@main/issue-resolution';
import { verifyMcpConnection } from '@main/mcp-connectivity';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { dismissSkillDrift, readCachedSkillInventory, scanSkillInventory, type McpConnectivityProbeTarget } from '@main/skill-inventory';
import type { McpConnectivityRecord } from '@shared/contracts';
import { readSkillIndexConfig, resolveSkillIndexPaths, writeSkillIndexConfig } from '@shared/skill-index-paths';

describe('resolveInventoryIssue', () => {
  it('rejects stale skill and MCP resolution requests instead of silently no-oping', async () => {
    const paths = await createPaths('skillindex-resolve-stale-request-');
    const skillDir = path.join(paths.sandboxAgentsSkillsDir, 'healthy-skill');
    await writeSkillFile(path.join(skillDir, 'SKILL.md'), '# Healthy skill\n');

    await expect(resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'healthy-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    )).rejects.toThrow('Skill "healthy-skill" no longer has Missing Symlinks.');

    await expect(resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-mcp',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    )).rejects.toThrow('MCP "missing-mcp" was not found in the current inventory.');
  });

  it('writes missing MCP definitions into Codex config.toml while preserving existing settings', async () => {
    const paths = await createPaths('skillindex-resolve-codex-mcp-');
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');

    await mkdir(path.dirname(agentsConfigPath), { recursive: true });
    await mkdir(path.dirname(codexConfigPath), { recursive: true });
    await writeFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        sharedOnly: {
          command: 'node',
          args: ['shared-only.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(codexConfigPath, 'model = "gpt-5"\n', 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'sharedOnly',
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(codexConfigPath, 'utf8')).toBe([
      'model = "gpt-5"',
      '',
      '[mcp_servers.sharedOnly]',
      'args = ["shared-only.js"]',
      'command = "node"',
      '',
    ].join('\n'));
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'sharedOnly')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
    });
  });

  it('adds a new MCP Server definition to selected writable configs', async () => {
    const paths = await createPaths('skillindex-add-mcp-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const codexConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-codex')?.mcpConfigLocation.path;
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    const claudeDesktopConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude-desktop')?.mcpConfigLocation.path;
    const factoryConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(codexConfigPath).toBeDefined();
    expect(claudeConfigPath).toBeDefined();
    expect(claudeDesktopConfigPath).toBeDefined();
    expect(factoryConfigPath).toBeDefined();

    await writeFile(agentsConfigPath, `${JSON.stringify({
      profile: 'sandbox',
      mcp: {
        staleAlias: { command: 'stale-mcp' },
      },
      mcpServers: {
        staleAlias: { command: 'stale-mcpServers' },
      },
      servers: {},
    }, null, 2)}\n`, 'utf8');
    await writeFile(claudeConfigPath as string, `${JSON.stringify({
      globalShortcut: 'Control+Space',
      mcp: {
        staleAlias: { command: 'stale-mcp' },
      },
      mcpServers: {},
      servers: {
        staleAlias: { command: 'stale-servers' },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(factoryConfigPath as string, `${JSON.stringify({
      mcp: {
        staleAlias: { command: 'stale-mcp' },
      },
      mcpServers: {},
      servers: {
        staleAlias: { command: 'stale-servers' },
      },
      telemetry: { enabled: false },
    }, null, 2)}\n`, 'utf8');

    const resolvedSnapshot = await addMcpServer(
      {
        name: 'new-http-server',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: {
          Authorization: 'Bearer token',
        },
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const agentsConfig = await readFileJson(agentsConfigPath) as { profile?: string; servers?: Record<string, unknown> };
    const claudeConfig = await readFileJson(claudeConfigPath as string) as { globalShortcut?: string; mcpServers?: Record<string, unknown> };
    const claudeDesktopConfig = await readFileJson(claudeDesktopConfigPath as string) as { mcpServers?: Record<string, unknown> };
    const factoryConfig = await readFileJson(factoryConfigPath as string) as { mcpServers?: Record<string, unknown>; telemetry?: { enabled?: boolean } };
    const codexConfig = await readFile(codexConfigPath as string, 'utf8');
    expect(agentsConfig.servers?.['new-http-server']).toMatchObject({ type: 'streamable-http', url: 'https://example.com/mcp' });
    expect(codexConfig).toContain('[mcp_servers.new-http-server]');
    expect(codexConfig).toContain('url = "https://example.com/mcp"');
    expect(codexConfig).not.toContain('type = "streamable-http"');
    expect(codexConfig).not.toContain('transport = "streamable-http"');
    expect(agentsConfig.profile).toBe('sandbox');
    expect(agentsConfig).not.toHaveProperty('mcp');
    expect(agentsConfig).not.toHaveProperty('mcpServers');
    expect(claudeConfig.mcpServers?.['new-http-server']).toMatchObject({ type: 'streamable-http', url: 'https://example.com/mcp' });
    expect(claudeConfig.globalShortcut).toBe('Control+Space');
    expect(claudeConfig).not.toHaveProperty('mcp');
    expect(claudeConfig).not.toHaveProperty('servers');
    expect(claudeDesktopConfig.mcpServers?.['new-http-server']).toBeUndefined();
    expect(factoryConfig.mcpServers?.['new-http-server']).toMatchObject({ type: 'streamable-http', url: 'https://example.com/mcp' });
    expect(factoryConfig.telemetry?.enabled).toBe(false);
    expect(factoryConfig).not.toHaveProperty('mcp');
    expect(factoryConfig).not.toHaveProperty('servers');
    const resolvedMcp = resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'new-http-server');
    expect(resolvedMcp).toMatchObject({ name: 'new-http-server' });
    expect(resolvedMcp?.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: 'sandbox-agents', url: 'https://example.com/mcp' }),
      expect.objectContaining({ agentId: 'sandbox-claude', url: 'https://example.com/mcp' }),
      expect.objectContaining({ agentId: 'sandbox-factory', url: 'https://example.com/mcp' }),
    ]));
  });

  it('writes remote MCP transports into Mistral Vibe TOML arrays', async () => {
    const paths = await createPaths('skillindex-resolve-vibe-remote-mcp-');
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const vibeConfigPath = path.join(paths.sandboxRoot, '.vibe', 'config.toml');

    await writeSkillFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        vibeRemote: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
        },
      },
    }, null, 2)}\n`);
    await writeSkillFile(vibeConfigPath, 'model = "codestral"\n');

    await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'vibeRemote',
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: {
          SKILL_INDEX_AGENT_SUBSET: 'mistral-vibe',
        },
      },
    );

    const vibeConfig = await readFile(vibeConfigPath, 'utf8');
    expect(vibeConfig).toContain('[[mcp_servers]]\nname = "vibeRemote"');
    expect(vibeConfig).toContain('transport = "streamable-http"');
    expect(vibeConfig).toContain('url = "https://example.com/mcp"');
  });

  it('writes remote MCP definitions through each agent write dialect', async () => {
    const paths = await createPaths('skillindex-resolve-mcp-write-dialects-');
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const ampConfigPath = path.join(paths.sandboxRoot, '.config', 'amp', 'settings.json');
    const claudeConfigPath = path.join(paths.sandboxRoot, '.claude.json');
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const geminiConfigPath = path.join(paths.sandboxRoot, '.gemini', 'settings.json');
    const openclawConfigPath = path.join(paths.sandboxRoot, '.openclaw', 'openclaw.json');
    const opencodeConfigPath = path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json');
    const qwenConfigPath = path.join(paths.sandboxRoot, '.qwen', 'settings.json');
    const vibeConfigPath = path.join(paths.sandboxRoot, '.vibe', 'config.toml');
    const zencoderConfigPath = path.join(paths.sandboxRoot, '.zencoder', 'settings.json');

    await Promise.all([
      writeSkillFile(agentsConfigPath, `${JSON.stringify({
        servers: {
          remoteDocs: {
            type: 'streamable-http',
            url: 'https://example.com/mcp',
            headers: {
              Authorization: 'Bearer token',
            },
          },
          plainHttpDocs: {
            type: 'http',
            url: 'https://example.com/http',
          },
        },
      }, null, 2)}\n`),
      writeSkillFile(ampConfigPath, `${JSON.stringify({ 'amp.mcpServers': {}, theme: 'dark' }, null, 2)}\n`),
      writeSkillFile(claudeConfigPath, `${JSON.stringify({ mcpServers: {}, globalShortcut: 'Control+Space' }, null, 2)}\n`),
      writeSkillFile(path.join(paths.sandboxRoot, '.claude', 'settings.json'), '{}\n'),
      writeSkillFile(codexConfigPath, 'model = "gpt-5"\n'),
      writeSkillFile(geminiConfigPath, `${JSON.stringify({ mcpServers: {}, ui: { theme: 'dark' } }, null, 2)}\n`),
      writeSkillFile(openclawConfigPath, `${JSON.stringify({ mcp: { servers: {} }, theme: 'dark' }, null, 2)}\n`),
      writeSkillFile(opencodeConfigPath, `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: {} }, null, 2)}\n`),
      writeSkillFile(qwenConfigPath, `${JSON.stringify({ mcpServers: {}, ui: { theme: 'dark' } }, null, 2)}\n`),
      writeSkillFile(vibeConfigPath, 'model = "codestral"\n'),
      writeSkillFile(zencoderConfigPath, `${JSON.stringify({ 'zencoder.mcpServers': {}, theme: 'dark' }, null, 2)}\n`),
    ]);

    await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'remoteDocs',
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: {
          SKILL_INDEX_AGENT_SUBSET: 'amp,claude,codex,gemini-cli,mistral-vibe,openclaw,opencode,qwen-code,zencoder',
        },
      },
    );

    await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'plainHttpDocs',
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: {
          SKILL_INDEX_AGENT_SUBSET: 'amp,claude,codex,gemini-cli,mistral-vibe,openclaw,opencode,qwen-code,zencoder',
        },
      },
    );

    const ampConfig = await readFileJson(ampConfigPath) as Record<string, Record<string, Record<string, unknown>>>;
    const claudeConfig = await readFileJson(claudeConfigPath) as { mcpServers?: Record<string, Record<string, unknown>> };
    const geminiConfig = await readFileJson(geminiConfigPath) as { mcpServers?: Record<string, Record<string, unknown>> };
    const openclawConfig = await readFileJson(openclawConfigPath) as { mcp?: { servers?: Record<string, Record<string, unknown>> } };
    const opencodeConfig = await readFileJson(opencodeConfigPath) as { mcp?: Record<string, Record<string, unknown>> };
    const qwenConfig = await readFileJson(qwenConfigPath) as { mcpServers?: Record<string, Record<string, unknown>> };
    const zencoderConfig = await readFileJson(zencoderConfigPath) as Record<string, Record<string, Record<string, unknown>>>;
    const codexConfig = await readFile(codexConfigPath, 'utf8');
    const vibeConfig = await readFile(vibeConfigPath, 'utf8');

    expect(ampConfig['amp.mcpServers']?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      url: 'https://example.com/mcp',
    });
    expect(claudeConfig.mcpServers?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    });
    expect(codexConfig).toContain('[mcp_servers.remoteDocs]');
    expect(codexConfig).toContain('url = "https://example.com/mcp"');
    expect(codexConfig).not.toContain('type = "streamable-http"');
    expect(codexConfig).not.toContain('transport = "streamable-http"');
    expect(geminiConfig.mcpServers?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      httpUrl: 'https://example.com/mcp',
    });
    expect(geminiConfig.mcpServers?.plainHttpDocs).toEqual({
      url: 'https://example.com/http',
    });
    expect(openclawConfig.mcp?.servers?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    });
    expect(opencodeConfig.mcp?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      type: 'remote',
      url: 'https://example.com/mcp',
    });
    expect(qwenConfig.mcpServers?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      httpUrl: 'https://example.com/mcp',
    });
    expect(qwenConfig.mcpServers?.plainHttpDocs).toEqual({
      url: 'https://example.com/http',
    });
    expect(vibeConfig).toContain('[[mcp_servers]]\nname = "remoteDocs"');
    expect(vibeConfig).toContain('transport = "streamable-http"');
    expect(vibeConfig).toContain('url = "https://example.com/mcp"');
    expect(zencoderConfig['zencoder.mcpServers']?.remoteDocs).toEqual({
      headers: {
        Authorization: 'Bearer token',
      },
      url: 'https://example.com/mcp',
    });
  });

  it('adds explicit remote MCP types when copying inferred HTTP definitions into Claude Code', async () => {
    const paths = await createPaths('skillindex-resolve-claude-remote-type-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    expect(claudeConfigPath).toBeDefined();

    await writeFile(codexConfigPath, [
      '[mcp_servers.stitch]',
      'url = "https://stitch.googleapis.com/mcp"',
      '',
    ].join('\n'), 'utf8');
    await writeFile(claudeConfigPath as string, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, 'utf8');

    await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'stitch',
        selectedVariantPath: codexConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const claudeConfig = await readFileJson(claudeConfigPath as string) as {
      mcpServers?: Record<string, Record<string, unknown>>;
    };
    expect(claudeConfig.mcpServers?.stitch).toEqual({
      type: 'http',
      url: 'https://stitch.googleapis.com/mcp',
    });
  });

  it('repairs MCP definition mismatches without adding missing agent definitions', async () => {
    const paths = await createPaths('skillindex-resolve-mcp-mixed-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    const factoryConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(claudeConfigPath).toBeDefined();
    expect(factoryConfigPath).toBeDefined();

    const mcpName = 'mixed-definition-missing-mcp';
    await writeFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        [mcpName]: {
          command: 'node',
          args: ['canonical.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(claudeConfigPath as string, `${JSON.stringify({
      mcpServers: {
        [mcpName]: {
          command: 'node',
          args: ['diverged.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(factoryConfigPath as string, `${JSON.stringify({
      mcpServers: {},
    }, null, 2)}\n`, 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName,
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(claudeConfigPath as string, 'utf8')).toContain('canonical.js');
    expect(await readFile(factoryConfigPath as string, 'utf8')).not.toContain(mcpName);
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === mcpName)).toMatchObject({
      issueReasons: ['missing-from-agents'],
    });
  });

  it('applies a selected MCP mismatch variant across existing definitions without filling missing agents', async () => {
    const paths = await createPaths('skillindex-resolve-mcp-selected-mixed-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    const factoryConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(claudeConfigPath).toBeDefined();
    expect(factoryConfigPath).toBeDefined();

    const mcpName = 'selected-definition-missing-mcp';
    await writeFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        [mcpName]: {
          command: 'node',
          args: ['canonical.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(claudeConfigPath as string, `${JSON.stringify({
      mcpServers: {
        [mcpName]: {
          command: 'uvx',
          args: ['selected'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(factoryConfigPath as string, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName,
        selectedVariantPath: claudeConfigPath as string,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(agentsConfigPath, 'utf8')).toContain('"uvx"');
    expect(await readFile(agentsConfigPath, 'utf8')).toContain('"selected"');
    expect(await readFile(factoryConfigPath as string, 'utf8')).not.toContain(mcpName);
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === mcpName)).toMatchObject({
      issueReasons: ['missing-from-agents'],
    });
  });

  it('repairs missing skill symlinks on a mixed-issue skill without rewriting diverged copies', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'missing-symlink-skill';
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const claudeEntrypoint = path.join(claudePath, 'SKILL.md');
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    await rm(claudePath, { recursive: true, force: true });
    await mkdir(claudePath, { recursive: true });
    await writeFile(claudeEntrypoint, [
      '---',
      `name: ${skillName}`,
      '---',
      '',
      '# Missing symlink skill',
      'Claude diverged copy missing its description field.',
      '',
    ].join('\n'), 'utf8');
    const beforeClaude = await readFile(claudeEntrypoint, 'utf8');
    const beforeCanonical = await readFile(canonicalEntrypoint, 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(await readFile(claudeEntrypoint, 'utf8')).toBe(beforeClaude);
    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(beforeCanonical);
    expect(resolvedSkill?.issueReasons).toEqual(expect.arrayContaining(['diverged-copies', 'invalid-definition']));
    expect(resolvedSkill?.issueReasons).not.toContain('missing-symlinks');
  });

  it('repairs missing skill symlinks for installed agents whose skills dir was not scanned yet', async () => {
    const paths = await createPaths('skillindex-resolve-parser-missing-skills-');
    const matrixEnv = {
      SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX: '1',
    };
    await seedRepresentativeFixtures({ paths, env: matrixEnv });

    const skillName = 'diagnostic-rich-skill';
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const ampPath = path.join(paths.sandboxRoot, '.config', 'agents', 'skills', skillName);
    const vibePath = path.join(paths.sandboxRoot, '.vibe', 'skills', skillName);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        env: matrixEnv,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readlink(ampPath)).toBe(canonicalPath);
    expect(await readlink(vibePath)).toBe(canonicalPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)?.detailDiagnostics.missingInstallSources)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: 'sandbox-amp' }),
        expect.objectContaining({ sourceId: 'sandbox-mistral-vibe' }),
      ]));
  });

  it('repairs missing skill symlinks without repairing broken or wrong existing links', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'missing-symlink-skill';
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const healthySkillPath = path.join(paths.sandboxRoot, '.agents', 'skills', 'healthy-skill');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);
    const missingTargetPath = path.join(paths.sandboxRoot, 'deleted-skills', skillName);

    await rm(claudePath, { recursive: true, force: true });
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(healthySkillPath, claudePath);
    await mkdir(path.dirname(windsurfPath), { recursive: true });
    await symlink(missingTargetPath, windsurfPath);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(await readlink(claudePath)).toBe(healthySkillPath);
    expect(await readlink(windsurfPath)).toBe(missingTargetPath);
    expect(resolvedSkill?.issueReasons).toEqual(expect.arrayContaining(['broken-symlink', 'wrong-symlink-target']));
    expect(resolvedSkill?.issueReasons).not.toContain('missing-symlinks');
  });

  it('repairs diverged skill copies without creating missing symlinks', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'missing-symlink-skill';
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const claudeEntrypoint = path.join(claudePath, 'SKILL.md');
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const selectedContent = [
      '---',
      `name: ${skillName}`,
      'description: Claude selected copy.',
      '---',
      '',
      '# Missing symlink skill',
      'Claude selected content.',
      '',
    ].join('\n');
    await rm(claudePath, { recursive: true, force: true });
    await mkdir(claudePath, { recursive: true });
    await writeFile(claudeEntrypoint, selectedContent, 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName,
        selectedVariantPath: claudePath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    await expect(readlink(factoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(selectedContent);
    expect(resolvedSkill?.issueReasons).toEqual(['missing-symlinks']);
  });

  it('repairs identical skill copies without creating missing symlinks', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'double-identical-copies-skill';
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'identical-copies',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
    await expect(readlink(windsurfPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(resolvedSkill?.issueReasons).toEqual(['missing-symlinks']);
  });

  it('repairs identical skill copies without repairing broken existing symlinks', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'double-identical-copies-skill';
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);
    const missingTargetPath = path.join(paths.sandboxRoot, 'deleted-skills', skillName);
    await mkdir(path.dirname(windsurfPath), { recursive: true });
    await symlink(missingTargetPath, windsurfPath);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'identical-copies',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(await readlink(windsurfPath)).toBe(missingTargetPath);
    expect(resolvedSkill?.issueReasons).toEqual(['broken-symlink']);
    expect(resolvedSkill?.issueReasons).not.toContain('identical-copies');
  });

  it('does not add invalid-definition issues for repaired symlink locations', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });
    const skillName = 'missing-symlink-skill';
    const canonicalEntrypoint = path.join(paths.sandboxRoot, '.agents', 'skills', skillName, 'SKILL.md');

    await writeFile(canonicalEntrypoint, [
      '---',
      'description: Canonical copy is missing its required name field.',
      '---',
      '',
      '# Missing symlink skill',
      'Canonical invalid content.',
      '',
    ].join('\n'), 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(resolvedSkill?.issueReasons).toEqual(expect.arrayContaining(['invalid-definition']));
    expect(resolvedSkill?.issueReasons).not.toContain('missing-symlinks');
    expect(resolvedSkill?.detailDiagnostics.definitionIssues).toHaveLength(1);
    expect(resolvedSkill?.detailDiagnostics.definitionIssues?.map((issue) => issue.sourceId)).toEqual([
      'sandbox-agents',
    ]);

    const cachedSnapshot = await readCachedSkillInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const cachedSkill = cachedSnapshot?.skills.find((skill) => skill.name === skillName);

    expect(cachedSkill?.detailDiagnostics.definitionIssues).toHaveLength(1);
    expect(cachedSkill?.detailDiagnostics.definitionIssues?.map((issue) => issue.sourceId)).toEqual([
      'sandbox-agents',
    ]);
  });

  it('allows a missing-canonical skill with diverged copies to be repaired from either issue path without filling missing symlinks', async () => {
    const firstPaths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths: firstPaths });
    const claudePath = path.join(firstPaths.sandboxRoot, '.claude', 'skills', 'double-missing-canonical-skill');

    const healthyFromDiverged = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName: 'double-missing-canonical-skill',
        selectedVariantPath: claudePath,
      },
      {
        paths: firstPaths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(healthyFromDiverged.skills.find((skill) => skill.name === 'double-missing-canonical-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
      driftPresentation: 'active',
    });

    const secondPaths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths: secondPaths });
    const healthyDirectly = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-canonical',
        skillName: 'double-missing-canonical-skill',
        selectedVariantPath: path.join(secondPaths.sandboxRoot, '.claude', 'skills', 'double-missing-canonical-skill'),
      },
      {
        paths: secondPaths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(healthyDirectly.skills.find((skill) => skill.name === 'double-missing-canonical-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
      driftPresentation: 'active',
    });
  });

  it('repairs only the wrong symlink target and leaves healthy links unchanged', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', 'wrong-symlink-target-skill');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', 'wrong-symlink-target-skill');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'wrong-symlink-target-skill');
    const beforeFactoryTarget = await readlink(factoryPath);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'wrong-symlink-target',
        skillName: 'wrong-symlink-target-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(beforeFactoryTarget);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'wrong-symlink-target-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs broken skill symlinks without repairing wrong links or creating missing symlinks', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'broken-symlink-skill';
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const healthySkillPath = path.join(paths.sandboxRoot, '.agents', 'skills', 'healthy-skill');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);

    await rm(factoryPath, { recursive: true, force: true });
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(healthySkillPath, factoryPath);
    await rm(windsurfPath, { recursive: true, force: true });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'broken-symlink',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(healthySkillPath);
    await expect(readlink(windsurfPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(resolvedSkill?.issueReasons).toEqual(expect.arrayContaining(['missing-symlinks', 'wrong-symlink-target']));
    expect(resolvedSkill?.issueReasons).not.toContain('broken-symlink');
  });

  it('repairs wrong skill symlink targets without repairing broken links or creating missing symlinks', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const skillName = 'wrong-symlink-target-skill';
    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'skills', skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);
    const missingTargetPath = path.join(paths.sandboxRoot, 'deleted-skills', skillName);

    await rm(factoryPath, { recursive: true, force: true });
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(missingTargetPath, factoryPath);
    await rm(windsurfPath, { recursive: true, force: true });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'wrong-symlink-target',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);

    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(missingTargetPath);
    await expect(readlink(windsurfPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(resolvedSkill?.issueReasons).toEqual(expect.arrayContaining(['broken-symlink', 'missing-symlinks']));
    expect(resolvedSkill?.issueReasons).not.toContain('wrong-symlink-target');
  });

  it('repairs missing skill symlinks for live agent installs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'live-missing-symlink-skill';
    const canonicalPath = path.join(homeDir, '.agents', 'skills', skillName);
    const factoryPath = path.join(homeDir, '.factory', 'skills', skillName);

    await writeSkillFile(path.join(canonicalPath, 'SKILL.md'), [
      '---',
      `name: ${skillName}`,
      'description: Live canonical copy.',
      '---',
      '',
      '# Live missing symlink skill',
      'Canonical live content.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('makes a plugin skill Universal by linking writable agents to the plugin root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-plugin-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(pluginSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      '',
    ].join('\n'));
    await mkdir(path.join(homeDir, '.agents', 'skills'), { recursive: true });
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'tools:foo',
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(agentsPath)).toBe(pluginSkillPath);
    expect(await readlink(factoryPath)).toBe(pluginSkillPath);
    expect(await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8')).toContain('Plugin foo.');
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });

    const config = await readSkillIndexConfig(paths.configFile, { homeDir });
    const pluginDecision = (config.skillUniversalDecisions ?? []).find((decision) => decision.skillName === 'tools:foo');
    expect(pluginDecision?.universal).toMatchObject({
      kind: 'plugin',
      pluginId: 'tools@official',
      pluginSkillName: 'foo',
    });

    await rm(path.join(pluginRoot, '.claude-plugin'), { recursive: true, force: true });
    const rescanWithoutPluginSource = await scanSkillInventory({
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });
    expect(rescanWithoutPluginSource.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });
  });

  it('preserves unrelated dismissed plugin drift while resolving a broken plugin symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-preserve-dismissal-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const codexPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'openai-codex', 'codex', '1.0.2');
    const dismissedSkillName = 'codex:codex-result-handling';
    const buildPluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'build-ios-apps', '0d4f5414');
    const buildSkillName = 'build-ios-apps:ios-ettrace-performance';
    const buildSkillPath = path.join(buildPluginRoot, 'skills', 'ios-ettrace-performance');
    const staleBuildSkillPath = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'build-ios-apps', 'eed16198', 'skills', 'ios-ettrace-performance');
    const brokenLinkPath = path.join(homeDir, '.agents', 'skills', buildSkillName);

    await mkdir(path.join(codexPluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(codexPluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'codex',
      version: '1.0.2',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(codexPluginRoot, 'skills', 'codex-result-handling', 'SKILL.md'), [
      '---',
      'name: codex-result-handling',
      'description: Codex result handling.',
      '---',
      '',
      '# Codex Result Handling',
      '',
    ].join('\n'));
    await mkdir(path.join(buildPluginRoot, '.codex-plugin'), { recursive: true });
    await writeFile(path.join(buildPluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'build-ios-apps',
      version: '0.1.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(buildSkillPath, 'SKILL.md'), [
      '---',
      'name: ios-ettrace-performance',
      'description: ETTrace performance.',
      '---',
      '',
      '# ETTrace Performance',
      '',
    ].join('\n'));
    await mkdir(path.dirname(brokenLinkPath), { recursive: true });
    await symlink(staleBuildSkillPath, brokenLinkPath);

    const scanOptions = {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    };
    const initialSnapshot = await scanSkillInventory(scanOptions);
    expect(initialSnapshot.skills.find((skill) => skill.name === dismissedSkillName)).toMatchObject({
      structuralState: 'missing-symlinks',
      driftPresentation: 'active',
    });
    expect(initialSnapshot.skills.find((skill) => skill.name === buildSkillName)?.issueReasons)
      .toContain('broken-symlink');

    const dismissedSnapshot = await dismissSkillDrift({ skillName: dismissedSkillName }, scanOptions);
    const dismissedSignature = dismissedSnapshot.skills.find((skill) => skill.name === dismissedSkillName)?.driftSignature;
    expect(dismissedSignature).toBeDefined();

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'broken-symlink',
        skillName: buildSkillName,
      },
      scanOptions,
    );

    expect(await readlink(brokenLinkPath)).toBe(buildSkillPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === dismissedSkillName)?.driftPresentation).toBe('dismissed');
    const config = await readSkillIndexConfig(paths.configFile, { homeDir });
    expect(config.dismissedDriftSignatures).toContain(dismissedSignature);
  });

  it('keeps manual contents separate when a plugin skill is chosen as Universal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-plugin-over-manual-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const manualSkillPath = path.join(homeDir, '.agents', 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(pluginSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      'Plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(manualSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Manual foo.',
      '---',
      '',
      '# Foo',
      'Manual version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    const beforeManual = await readFile(path.join(manualSkillPath, 'SKILL.md'), 'utf8');

    const resolvedSnapshot = await applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'tools:foo',
      selectedVariantPath: pluginSkillPath,
    }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(await readlink(agentsPath)).toBe(pluginSkillPath);
    expect(await readlink(factoryPath)).toBe(pluginSkillPath);
    expect(await readFile(path.join(manualSkillPath, 'SKILL.md'), 'utf8')).toBe(beforeManual);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs manual Universal links while leaving an alternate plugin skill untouched', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-manual-over-plugin-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const manualSkillPath = path.join(homeDir, '.agents', 'skills', 'foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(pluginSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      'Plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(manualSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Manual foo.',
      '---',
      '',
      '# Foo',
      'Manual version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    const beforePlugin = await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8');

    const resolvedSnapshot = await applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'foo',
      selectedVariantPath: manualSkillPath,
    }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(await readlink(factoryPath)).toBe(manualSkillPath);
    expect(await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8')).toBe(beforePlugin);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('uses a static copy as Universal while keeping a divergent plugin copy separate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-static-over-plugin-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(pluginSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      'Plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(agentsPath, 'SKILL.md'), [
      '---',
      'name: tools:foo',
      'description: Static foo.',
      '---',
      '',
      '# Foo',
      'Static version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(factoryPath, 'SKILL.md'), [
      '---',
      'name: tools:foo',
      'description: Factory foo.',
      '---',
      '',
      '# Foo',
      'Factory version.',
      '',
    ].join('\n'));
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(agentsPath, claudePath);
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    const beforePlugin = await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName: 'tools:foo',
        selectedVariantPath: agentsPath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(factoryPath)).toBe(agentsPath);
    expect(await readlink(claudePath)).toBe(agentsPath);
    expect(await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8')).toBe(beforePlugin);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      detailDiagnostics: {
        acceptedAlternates: [
          expect.objectContaining({
            kind: 'plugin',
            host: 'claude',
            pluginId: 'tools@official',
            reason: 'kept-separate',
          }),
        ],
      },
    });
  });

  it('preserves accepted plugin alternates when filling missing symlinks after a static Universal choice', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-static-then-missing-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(pluginSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      'Plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(agentsPath, 'SKILL.md'), [
      '---',
      'name: tools:foo',
      'description: Static foo.',
      '---',
      '',
      '# Foo',
      'Static version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');

    const afterDivergedResolution = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName: 'tools:foo',
        selectedVariantPath: agentsPath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );
    const afterDivergedSkill = afterDivergedResolution.skills.find((skill) => skill.name === 'tools:foo');
    expect(afterDivergedSkill).toMatchObject({
      issueReasons: ['missing-symlinks'],
      detailDiagnostics: {
        acceptedAlternates: [
          expect.objectContaining({
            kind: 'plugin',
            host: 'claude',
            pluginId: 'tools@official',
            reason: 'kept-separate',
          }),
        ],
      },
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'tools:foo',
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(factoryPath)).toBe(agentsPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      detailDiagnostics: {
        acceptedAlternates: [
          expect.objectContaining({
            kind: 'plugin',
            host: 'claude',
            pluginId: 'tools@official',
            reason: 'kept-separate',
          }),
        ],
      },
    });
  });

  it('keeps sandbox handoff plugin alternates accepted after resolving its missing symlinks', async () => {
    const paths = await createPaths('skillindex-resolve-handoff-static-');
    await seedRepresentativeFixtures({ paths });
    const skillName = 'example-workflow-kit:handoff-notes-with-static';
    const agentsPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);

    const afterDivergedResolution = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName,
        selectedVariantPath: agentsPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const afterDivergedSkill = afterDivergedResolution.skills.find((skill) => skill.name === skillName);
    expect(afterDivergedSkill).toMatchObject({
      issueReasons: ['missing-symlinks'],
    });
    expect((afterDivergedSkill?.detailDiagnostics.missingInstallSources ?? [])
      .map((source) => source.sourceId)
      .sort()).toEqual([
        'sandbox-claude',
        'sandbox-factory',
        'sandbox-windsurf',
      ]);
    expect((afterDivergedSkill?.detailDiagnostics.acceptedAlternates ?? [])
      .map((alternate) => `${alternate.kind}:${alternate.pluginId}:${alternate.reason}`)
      .sort()).toEqual([
        'plugin:example-workflow-kit@sandbox-curated:kept-separate',
        'plugin:example-workflow-kit@sandbox-gallery:kept-separate',
      ]);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);
    expect(resolvedSkill).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      issueReasons: [],
    });
    expect(await readlink(claudePath)).toBe(agentsPath);
    expect(await readlink(factoryPath)).toBe(agentsPath);
    expect(await readlink(windsurfPath)).toBe(agentsPath);
    expect((resolvedSkill?.detailDiagnostics.acceptedAlternates ?? [])
      .map((alternate) => `${alternate.kind}:${alternate.pluginId}:${alternate.reason}`)
      .sort()).toEqual([
        'plugin:example-workflow-kit@sandbox-curated:kept-separate',
        'plugin:example-workflow-kit@sandbox-gallery:kept-separate',
      ]);
  });

  it('auto-repairs existing copies and symlinks when an accepted plugin alternate becomes Universal', async () => {
    const paths = await createPaths('skillindex-switch-handoff-alternate-');
    await seedRepresentativeFixtures({ paths });
    const skillName = 'example-workflow-kit:handoff-notes-with-static';
    const agentsPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const windsurfPath = path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName);

    await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName,
        selectedVariantPath: agentsPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === skillName);
    const claudePluginPath = resolvedSkill?.locations.find((location) =>
      location.provenance?.kind === 'plugin'
      && location.provenance.plugin?.host === 'claude')?.path;
    expect(claudePluginPath).toBeDefined();

    const switchedSnapshot = await applyCapabilityAction(
      {
        entity: 'skill',
        action: 'choose-universal-version',
        skillName,
        selectedVariantPath: claudePluginPath as string,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const switchedSkill = switchedSnapshot.skills.find((skill) => skill.name === skillName);
    expect(switchedSkill?.detailDiagnostics.universalDecision?.universal).toMatchObject({
      kind: 'plugin',
      host: 'claude',
      pluginId: 'example-workflow-kit@sandbox-gallery',
      pluginSkillName: 'handoff-notes-with-static',
    });
    expect(switchedSkill?.issueReasons).not.toContain('wrong-symlink-target');
    expect(switchedSkill?.issueReasons).not.toContain('missing-symlinks');
    expect(switchedSkill?.issueReasons).not.toContain('broken-symlink');
    expect(switchedSkill?.issueReasons).not.toContain('diverged-copies');
    expect(switchedSkill?.issueReasons).not.toContain('identical-copies');
    expect(switchedSkill?.locations.find((location) => location.path === agentsPath)).toMatchObject({
      fileType: 'symlink',
      canonical: false,
    });
    for (const linkPath of [agentsPath, claudePath, factoryPath, windsurfPath]) {
      expect(await readlink(linkPath)).toBe(claudePluginPath);
      const linkLocation = switchedSkill?.locations.find((location) => location.path === linkPath);
      expect(linkLocation).toMatchObject({
        fileType: 'symlink',
      });
      expect(linkLocation?.resolvedPath).toMatch(new RegExp(`${escapeRegExp(path.join(
        'sandbox',
        '.claude',
        'plugins',
        'cache',
        'sandbox-gallery',
        'example-workflow-kit',
        '5.1.0',
        'skills',
        'handoff-notes-with-static',
      ))}$`));
    }
  });

  it('uses a plugin copy as Universal by linking writable static copies to it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-plugin-over-static-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(pluginSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      'Plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(agentsPath, 'SKILL.md'), [
      '---',
      'name: tools:foo',
      'description: Static foo.',
      '---',
      '',
      '# Foo',
      'Static version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(factoryPath, 'SKILL.md'), [
      '---',
      'name: tools:foo',
      'description: Factory foo.',
      '---',
      '',
      '# Foo',
      'Factory version.',
      '',
    ].join('\n'));
    await mkdir(path.dirname(claudePath), { recursive: true });
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName: 'tools:foo',
        selectedVariantPath: pluginSkillPath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(agentsPath)).toBe(pluginSkillPath);
    expect(await readlink(factoryPath)).toBe(pluginSkillPath);
    await expect(readlink(claudePath)).rejects.toMatchObject({ code: 'ENOENT' });
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo');
    expect(resolvedSkill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['missing-symlinks'],
    });
    expect(resolvedSkill?.detailDiagnostics.universalDecision?.universal).toMatchObject({
      kind: 'plugin',
      pluginId: 'tools@official',
      pluginSkillName: 'foo',
    });
    expect(resolvedSkill?.detailDiagnostics.universalDecision?.acceptedAlternates).toEqual([]);
  });

  it('rejects stale skill issue resolution requests after the issue is already resolved', async () => {
    const paths = await createPaths('skillindex-resolve-stale-skill-');
    await seedRepresentativeFixtures({ paths });

    const request = {
      entity: 'skill' as const,
      issue: 'missing-symlinks' as const,
      skillName: 'missing-symlink-skill',
    };

    const firstSnapshot = await resolveInventoryIssue(request, {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    expect(firstSnapshot.skills.find((skill) => skill.name === request.skillName)?.issueReasons)
      .not.toContain(request.issue);

    await expect(resolveInventoryIssue(request, {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    })).rejects.toThrow('Skill "missing-symlink-skill" no longer has Missing Symlinks.');
  });

  it('uses plugin A as Universal while keeping plugin B as a healthy separate version', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-plugin-over-plugin-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const codexRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'tools', 'abc123');
    const claudeRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const codexSkillPath = path.join(codexRoot, 'skills', 'foo');
    const claudeSkillPath = path.join(claudeRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(codexRoot, '.codex-plugin'), { recursive: true });
    await writeFile(path.join(codexRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: 'abc123',
    }, null, 2), 'utf8');
    await mkdir(path.join(claudeRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(claudeRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(codexSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Codex plugin foo.',
      '---',
      '',
      '# Foo',
      'Codex plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(claudeSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Claude plugin foo.',
      '---',
      '',
      '# Foo',
      'Claude plugin version.',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    const beforeClaude = await readFile(path.join(claudeSkillPath, 'SKILL.md'), 'utf8');

    const resolvedSnapshot = await applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'tools:foo',
      selectedVariantPath: codexSkillPath,
    }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(await readlink(agentsPath)).toBe(codexSkillPath);
    expect(await readlink(factoryPath)).toBe(codexSkillPath);
    expect(await readFile(path.join(claudeSkillPath, 'SKILL.md'), 'utf8')).toBe(beforeClaude);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      detailDiagnostics: {
        acceptedAlternates: [
          expect.objectContaining({
            kind: 'plugin',
            host: 'claude',
            pluginId: 'tools@official',
            reason: 'kept-separate',
          }),
        ],
      },
    });
  });

  it('repairs stale plugin cache symlinks to the active plugin root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-plugin-cache-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const oldSkillPath = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0', 'skills', 'foo');
    const newPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '2.0.0');
    const newSkillPath = path.join(newPluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(newPluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(newPluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '2.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(path.join(newSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo v2.',
      '---',
      '',
      '# Foo',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(oldSkillPath, 'SKILL.md'), [
      '---',
      'name: foo',
      'description: Plugin foo v1.',
      '---',
      '',
      '# Foo',
      '',
    ].join('\n'));
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await symlink(oldSkillPath, agentsPath);
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(newSkillPath, claudePath);
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(newSkillPath, factoryPath);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
      skillUniversalDecisions: [{
        id: 'skill:tools-foo:plugin',
        skillName: 'tools:foo',
        state: 'policy',
        universal: {
          kind: 'plugin',
          host: 'claude',
          pluginId: 'tools@official',
          pluginSkillName: 'foo',
        },
        acceptedAlternates: [],
        updatedAt: '2026-05-07T00:00:00.000Z',
      }],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'wrong-symlink-target',
        skillName: 'tools:foo',
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(agentsPath)).toBe(newSkillPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('creates missing live canonical packages in the preferred source when configured', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'preferred-missing-canonical-skill';
    const preferredSkillsDir = path.join(homeDir, 'repos', 'arjit-skills', 'skills');
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const claudePath = path.join(homeDir, '.claude', 'skills', skillName);
    const skillContent = [
      '---',
      `name: ${skillName}`,
      'description: Noncanonical live copy.',
      '---',
      '',
      '# Preferred missing canonical skill',
      '',
    ].join('\n');

    await mkdir(preferredSkillsDir, { recursive: true });
    await writeSkillFile(path.join(claudePath, 'SKILL.md'), skillContent);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-canonical',
        skillName,
        selectedVariantPath: claudePath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readFile(path.join(preferredPath, 'SKILL.md'), 'utf8')).toBe(skillContent);
    expect(await readlink(claudePath)).toBe(preferredPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs diverged live copies to the selected version in the preferred canonical source when configured', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'preferred-diverged-copy-skill';
    const preferredSkillsDir = path.join(homeDir, 'repos', 'arjit-skills', 'skills');
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const agentsPath = path.join(homeDir, '.agents', 'skills', skillName);
    const claudePath = path.join(homeDir, '.claude', 'skills', skillName);
    const selectedContent = [
      '---',
      `name: ${skillName}`,
      'description: Selected live copy.',
      '---',
      '',
      '# Preferred diverged copy skill',
      'Selected content.',
      '',
    ].join('\n');
    const otherContent = [
      '---',
      `name: ${skillName}`,
      'description: Other live copy.',
      '---',
      '',
      '# Preferred diverged copy skill',
      'Other content.',
      '',
    ].join('\n');

    await mkdir(preferredSkillsDir, { recursive: true });
    await writeSkillFile(path.join(agentsPath, 'SKILL.md'), otherContent);
    await writeSkillFile(path.join(claudePath, 'SKILL.md'), selectedContent);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'diverged-copies',
        skillName,
        selectedVariantPath: claudePath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readFile(path.join(preferredPath, 'SKILL.md'), 'utf8')).toBe(selectedContent);
    expect(await readlink(agentsPath)).toBe(preferredPath);
    expect(await readlink(claudePath)).toBe(preferredPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs identical live copies to the preferred canonical source when the skill exists there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'preferred-identical-copy-skill';
    const preferredSkillsDir = path.join(homeDir, 'repos', 'arjit-skills', 'skills');
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const agentsPath = path.join(homeDir, '.agents', 'skills', skillName);
    const skillContent = [
      '---',
      `name: ${skillName}`,
      'description: Preferred canonical live copy.',
      '---',
      '',
      '# Preferred identical copy skill',
      '',
    ].join('\n');

    await writeSkillFile(path.join(preferredPath, 'SKILL.md'), skillContent);
    await writeSkillFile(path.join(agentsPath, 'SKILL.md'), skillContent);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'identical-copies',
        skillName,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readFile(path.join(preferredPath, 'SKILL.md'), 'utf8')).toBe(skillContent);
    expect(await readlink(agentsPath)).toBe(preferredPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs missing live skill symlinks to the preferred canonical source when the skill exists there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'preferred-missing-symlink-skill';
    const preferredSkillsDir = path.join(homeDir, 'repos', 'arjit-skills', 'skills');
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const agentsPath = path.join(homeDir, '.agents', 'skills', skillName);
    const factoryPath = path.join(homeDir, '.factory', 'skills', skillName);

    await writeSkillFile(path.join(preferredPath, 'SKILL.md'), [
      '---',
      `name: ${skillName}`,
      'description: Preferred canonical live copy.',
      '---',
      '',
      '# Preferred missing symlink skill',
      '',
    ].join('\n'));
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await symlink(preferredPath, agentsPath);
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(agentsPath)).toBe(preferredPath);
    expect(await readlink(factoryPath)).toBe(preferredPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs broken live skill symlinks to the preferred canonical source when the skill exists there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'preferred-broken-symlink-skill';
    const preferredSkillsDir = path.join(homeDir, 'repos', 'arjit-skills', 'skills');
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const agentsPath = path.join(homeDir, '.agents', 'skills', skillName);
    const factoryPath = path.join(homeDir, '.factory', 'skills', skillName);
    const missingTargetPath = path.join(homeDir, 'deleted-skills', skillName);

    await writeSkillFile(path.join(preferredPath, 'SKILL.md'), [
      '---',
      `name: ${skillName}`,
      'description: Preferred canonical live copy.',
      '---',
      '',
      '# Preferred broken symlink skill',
      '',
    ].join('\n'));
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(preferredPath, agentsPath);
    await symlink(missingTargetPath, factoryPath);
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'broken-symlink',
        skillName,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(agentsPath)).toBe(preferredPath);
    expect(await readlink(factoryPath)).toBe(preferredPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs wrong live symlink targets to the preferred canonical source when the skill exists there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'preferred-wrong-target-skill';
    const preferredSkillsDir = path.join(homeDir, 'repos', 'arjit-skills', 'skills');
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const agentsPath = path.join(homeDir, '.agents', 'skills', skillName);
    const stalePath = path.join(homeDir, 'stale-skills', skillName);
    const factoryPath = path.join(homeDir, '.factory', 'skills', skillName);

    await writeSkillFile(path.join(preferredPath, 'SKILL.md'), [
      '---',
      `name: ${skillName}`,
      'description: Preferred canonical live copy.',
      '---',
      '',
      '# Preferred wrong target skill',
      '',
    ].join('\n'));
    await writeSkillFile(path.join(stalePath, 'SKILL.md'), [
      '---',
      `name: ${skillName}`,
      'description: Stale noncanonical copy.',
      '---',
      '',
      '# Preferred wrong target skill',
      '',
    ].join('\n'));
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(preferredPath, agentsPath);
    await symlink(stalePath, factoryPath);
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'skill',
        issue: 'wrong-symlink-target',
        skillName,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readlink(agentsPath)).toBe(preferredPath);
    expect(await readlink(factoryPath)).toBe(preferredPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('fills missing MCP agents without rewriting existing mismatched definitions', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    const factoryConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(claudeConfigPath).toBeDefined();
    expect(factoryConfigPath).toBeDefined();

    await upsertMcpDefinition(claudeConfigPath as string, 'json-mcpServers', 'missing-from-agents-mcp', {
      command: 'uvx',
      args: ['missing-from-agents-claude'],
    });
    await deleteMcpDefinition(factoryConfigPath as string, 'json-mcpServers', 'missing-from-agents-mcp');

    const beforeAgentsConfig = await readFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), 'utf8');
    const beforeClaudeConfig = await readFile(claudeConfigPath as string, 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: claudeConfigPath as string,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedMcp = resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'missing-from-agents-mcp');

    expect(await readFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), 'utf8')).toBe(beforeAgentsConfig);
    expect(await readFile(claudeConfigPath as string, 'utf8')).toBe(beforeClaudeConfig);
    expect(await readFile(factoryConfigPath as string, 'utf8')).toContain('missing-from-agents-claude');
    expect(resolvedMcp?.issueReasons).toEqual(['definition-mismatch']);
  });

  it('fills missing MCP agents without repairing invalid existing definitions', async () => {
    const paths = await createPaths('skillindex-resolve-mcp-invalid-missing-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    const factoryConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(claudeConfigPath).toBeDefined();
    expect(factoryConfigPath).toBeDefined();

    const mcpName = 'invalid-existing-missing-mcp';
    await writeFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        [mcpName]: {
          command: 'node',
          args: ['selected-valid.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(claudeConfigPath as string, `${JSON.stringify({
      mcpServers: {
        [mcpName]: {
          args: ['invalid-missing-command.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(factoryConfigPath as string, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, 'utf8');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName,
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedMcp = resolvedSnapshot.mcps?.find((mcp) => mcp.name === mcpName);

    expect(await readFile(factoryConfigPath as string, 'utf8')).toContain('selected-valid.js');
    expect(await readFile(claudeConfigPath as string, 'utf8')).toContain('invalid-missing-command.js');
    expect(await readFile(claudeConfigPath as string, 'utf8')).not.toContain('selected-valid.js');
    expect(resolvedMcp?.issueReasons).toEqual(expect.arrayContaining(['invalid-definition']));
    expect(resolvedMcp?.issueReasons).not.toContain('missing-from-agents');
  });

  it('creates a missing writable MCP config when filling installed agents', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });
    const inventoryBefore = await scanSkillInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const claudeConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-claude')?.mcpConfigLocation.path;
    const factoryConfigPath = inventoryBefore.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(claudeConfigPath).toBeDefined();
    expect(factoryConfigPath).toBeDefined();

    await upsertMcpDefinition(claudeConfigPath as string, 'json-mcpServers', 'missing-from-agents-mcp', {
      command: 'uvx',
      args: ['missing-from-agents-claude'],
    });
    await rm(factoryConfigPath as string, { force: true });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: claudeConfigPath as string,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(factoryConfigPath as string, 'utf8')).toContain('missing-from-agents-claude');
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'missing-from-agents-mcp')?.missingLocations).toEqual([]);
  });

  it('applies a selected MCP definition across existing configs and can clear invalid definitions indirectly', async () => {
    const paths = await createPaths('skillindex-resolve-');
    await seedRepresentativeFixtures({ paths });

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName: 'broken-mcp',
        selectedVariantPath: path.join(paths.sandboxRoot, '.claude.json'),
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const resolvedMcp = resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'broken-mcp');

    expect(resolvedMcp).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
    });
    expect(await readFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), 'utf8')).toContain('recovered-command.js');
    expect(await readFile(path.join(paths.sandboxRoot, '.claude.json'), 'utf8')).toContain('recovered-command.js');
  });

  it('applies only portable MCP fields when standardizing a selected definition', async () => {
    const paths = await createPaths('skillindex-resolve-portable-mcp-');
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const factoryConfigPath = path.join(paths.sandboxRoot, '.factory', 'mcp.json');

    await mkdir(path.dirname(codexConfigPath), { recursive: true });
    await mkdir(path.dirname(factoryConfigPath), { recursive: true });
    await writeFile(codexConfigPath, [
      '[mcp_servers.blitz-macos]',
      'command = "/Users/tester/.blitz/blitz-macos-mcp"',
      'args = ["--mode", "app-store"]',
      'cwd = "/Users/tester/.blitz/mcps"',
      'enabled_tools = ["app_get_state", "project_open"]',
      '',
    ].join('\n'), 'utf8');
    await writeFile(factoryConfigPath, `${JSON.stringify({
      mcpServers: {
        'blitz-macos': {
          type: 'stdio',
          command: '/Users/tester/.blitz/old-blitz-macos-mcp',
          args: [],
          disabled: false,
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');

    await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName: 'blitz-macos',
        selectedVariantPath: codexConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const factoryConfig = JSON.parse(await readFile(factoryConfigPath, 'utf8')) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(factoryConfig.mcpServers['blitz-macos']).toEqual({
      command: '/Users/tester/.blitz/blitz-macos-mcp',
      args: ['--mode', 'app-store'],
      cwd: '/Users/tester/.blitz/mcps',
    });
  });

  it('writes cwd-dependent MCP definitions into OpenCode configs', async () => {
    const paths = await createPaths('skillindex-resolve-mcp-opencode-cwd-');
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const opencodeConfigPath = path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json');

    await writeSkillFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        cwdServer: {
          command: 'node',
          args: ['server.js'],
          cwd: '/Users/tester/project',
        },
      },
    }, null, 2)}\n`);
    await writeSkillFile(opencodeConfigPath, `${JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {},
    }, null, 2)}\n`);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'cwdServer',
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: {
          SKILL_INDEX_AGENT_SUBSET: 'opencode',
        },
      },
    );

    const opencodeConfig = await readFileJson(opencodeConfigPath) as {
      mcp?: Record<string, Record<string, unknown>>;
    };
    expect(opencodeConfig.mcp?.cwdServer).toEqual({
      command: ['node', 'server.js'],
      cwd: '/Users/tester/project',
      type: 'local',
    });
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'cwdServer')?.missingLocations).toEqual([]);
  });

  it('resolves plugin-owned MCPs and verifies the written definitions can connect', async () => {
    const paths = await createPaths('skillindex-resolve-plugin-mcp-connectivity-');
    await seedRepresentativeFixtures({ paths });
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const existingCodexConfig = await readFile(codexConfigPath, 'utf8');
    await writeFile(codexConfigPath, [
      existingCodexConfig.trimEnd(),
      '',
      '[mcp_servers."signal-tools:signalMap"]',
      'command = "node"',
      'args = ["stale-qualified-signal-map.js"]',
      '',
    ].join('\n'), 'utf8');

    const mcpName = 'signal-tools:signalMap';
    const beforeSnapshot = await scanSkillInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const pluginMcp = beforeSnapshot.mcps?.find((mcp) => mcp.name === mcpName);
    const pluginLocation = pluginMcp?.locations.find((location) => location.agentId.startsWith('plugin:'));
    const factoryConfigPath = beforeSnapshot.agents?.find((agent) => agent.id === 'sandbox-factory')?.mcpConfigLocation.path;
    expect(pluginMcp?.issueReasons).toContain('missing-from-agents');
    expect(pluginLocation?.configPath).toBeDefined();
    expect(pluginLocation?.configName).toBe('signalMap');
    expect(factoryConfigPath).toBeDefined();

    const checkedTargets: Array<{ agentId: string; status: McpConnectivityRecord['status']; definition: unknown }> = [];
    const verifySignalMap = async (target: McpConnectivityProbeTarget): Promise<McpConnectivityRecord> => {
      if (target.name !== mcpName) {
        return {
          status: 'skipped',
          checkedAt: '2026-05-15T12:00:00.000Z',
          error: 'Not part of this connectivity contract test.',
        };
      }

      const result = await verifyMcpConnection(target.location, {
        checkedAt: '2026-05-15T12:00:00.000Z',
        definition: target.definition,
        timeoutMs: 3_000,
      });
      checkedTargets.push({
        agentId: target.location.agentId,
        status: result.status,
        definition: target.definition,
      });
      return result;
    };

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName,
        selectedVariantPath: pluginLocation?.configPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        verifyMcpConnectivity: verifySignalMap,
      },
    );
    const resolvedMcp = resolvedSnapshot.mcps?.find((mcp) => mcp.name === mcpName);
    const resolvedAgentIds = new Set(
      resolvedMcp?.locations
        .filter((location) => !location.agentId.startsWith('plugin:'))
        .map((location) => location.agentId),
    );
    expect(resolvedMcp).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      missingLocations: [],
    });
    const codexConfig = await readFile(codexConfigPath, 'utf8');
    const factoryConfig = await readFileJson(factoryConfigPath as string) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(codexConfig).toContain('[mcp_servers.signalMap]');
    expect(codexConfig).not.toContain('signal-tools:signalMap');
    expect(factoryConfig.mcpServers?.signalMap).toBeDefined();
    expect(factoryConfig.mcpServers?.['signal-tools:signalMap']).toBeUndefined();
    const finalSignalMapChecks = checkedTargets.filter((target) =>
      getDefinitionArgs(target.definition)[0]?.toString().includes('/servers/signal-map.js'));
    const finalVerifiedAgentIds = new Set(
      finalSignalMapChecks
        .filter((target) => !target.agentId.startsWith('plugin:') && target.status === 'verified')
        .map((target) => target.agentId),
    );
    expect(finalSignalMapChecks.filter((target) => target.status !== 'verified')).toEqual([]);
    expect(finalVerifiedAgentIds).toEqual(resolvedAgentIds);
    expectVerifiedSignalMapTarget(finalSignalMapChecks, 'sandbox-codex');
    expectVerifiedSignalMapTarget(finalSignalMapChecks, 'sandbox-factory');
  }, 20_000);

  it('resolves the representative parser-shape matrix MCP across sandbox agent config formats', async () => {
    const paths = await createPaths('skillindex-resolve-parser-shape-matrix-');
    const matrixEnv = {
      SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX: '1',
    };

    await seedRepresentativeFixtures({ paths, env: matrixEnv });
    const mcpName = 'parser-shape-matrix-mcp';
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName,
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        env: matrixEnv,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const ampConfig = await readFileJson(path.join(paths.sandboxRoot, '.config', 'amp', 'settings.json')) as {
      'amp.mcpServers'?: Record<string, unknown>;
    };
    const codebuddyConfig = await readFileJson(path.join(paths.sandboxRoot, '.codebuddy', '.mcp.json')) as {
      mcpServers?: Record<string, unknown>;
    };
    const crushConfig = await readFileJson(path.join(paths.sandboxRoot, '.config', 'crush', 'crush.json')) as {
      mcp?: Record<string, unknown>;
    };
    const cursorConfig = await readFileJson(path.join(paths.sandboxRoot, '.cursor', 'mcp.json')) as {
      mcpServers?: Record<string, unknown>;
    };
    const muxConfig = await readFileJson(path.join(paths.sandboxRoot, '.mux', 'mcp.jsonc')) as {
      servers?: Record<string, unknown>;
    };
    const openclawConfig = await readFileJson(path.join(paths.sandboxRoot, '.openclaw', 'openclaw.json')) as {
      mcp?: { servers?: Record<string, unknown> };
    };
    const opencodeConfig = await readFileJson(path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json')) as {
      mcp?: Record<string, unknown>;
    };
    const pochiConfig = await readFileJson(path.join(paths.sandboxRoot, '.pochi', 'config.jsonc')) as {
      mcp?: Record<string, unknown>;
    };
    const zencoderConfig = await readFileJson(path.join(paths.sandboxRoot, '.zencoder', 'settings.json')) as {
      'zencoder.mcpServers'?: Record<string, unknown>;
    };

    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === mcpName)).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      missingLocations: [],
    });
    expect(ampConfig['amp.mcpServers']?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(codebuddyConfig.mcpServers?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(await readFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), 'utf8'))
      .toContain('[mcp_servers.parser-shape-matrix-mcp]');
    expect(crushConfig.mcp?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(cursorConfig.mcpServers?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(muxConfig.servers?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(await readFile(path.join(paths.sandboxRoot, '.vibe', 'config.toml'), 'utf8'))
      .toContain('[[mcp_servers]]\nname = "parser-shape-matrix-mcp"');
    expect(openclawConfig.mcp?.servers?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(opencodeConfig.mcp?.[mcpName]).toMatchObject({
      type: 'local',
      command: ['node', 'parser-shape-matrix.js'],
      environment: {
        MATRIX_TOKEN: 'sandbox',
      },
    });
    expect(pochiConfig.mcp?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
    expect(zencoderConfig['zencoder.mcpServers']?.[mcpName]).toMatchObject({ command: 'node', args: ['parser-shape-matrix.js'] });
  });

  it('fills missing live MCP configs for installed live agents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-resolve-live-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    };
    const paths = resolveSkillIndexPaths({
      env,
      homeDir,
    });
    const claudeConfigPath = path.join(homeDir, '.claude.json');
    const opencodeConfigPath = path.join(homeDir, '.config', 'opencode', 'opencode.json');

    await Promise.all([
      writeSkillFile(path.join(homeDir, '.claude', 'settings.json'), '{}\n'),
      writeSkillFile(path.join(homeDir, '.config', 'opencode', 'opencode.json'), `${JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: {},
        mcpServers: {
          staleShape: {
            command: 'node',
          },
        },
      }, null, 2)}\n`),
      writeSkillFile(claudeConfigPath, `${JSON.stringify({
        mcpServers: {
          'live-mcp': {
            command: 'uvx',
            args: ['live-mcp'],
          },
        },
      }, null, 2)}\n`),
    ]);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'live-mcp',
        selectedVariantPath: claudeConfigPath,
      },
      {
        paths,
        env,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    const opencodeConfig = await readFileJson(opencodeConfigPath) as {
      $schema?: string;
      mcp?: Record<string, { command?: string[]; type?: string }>;
      mcpServers?: Record<string, unknown>;
    };
    expect(opencodeConfig).toMatchObject({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'live-mcp': {
          type: 'local',
          command: ['uvx', 'live-mcp'],
        },
      },
    });
    expect(opencodeConfig.mcpServers).toBeUndefined();
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'live-mcp')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
    });
  });

  it('writes missing MCP definitions using documented agent-specific config shapes', async () => {
    const paths = await createPaths('skillindex-resolve-agent-mcp-shapes-');
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const ampConfigPath = path.join(paths.sandboxRoot, '.config', 'amp', 'settings.json');
    const claudeDesktopConfigPath = path.join(paths.sandboxRoot, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    const codebuddyConfigPath = path.join(paths.sandboxRoot, '.codebuddy', '.mcp.json');
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const crushConfigPath = path.join(paths.sandboxRoot, '.config', 'crush', 'crush.json');
    const cursorConfigPath = path.join(paths.sandboxRoot, '.cursor', 'mcp.json');
    const pochiConfigPath = path.join(paths.sandboxRoot, '.pochi', 'config.jsonc');
    const muxConfigPath = path.join(paths.sandboxRoot, '.mux', 'mcp.jsonc');
    const opencodeConfigPath = path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json');
    const vibeConfigPath = path.join(paths.sandboxRoot, '.vibe', 'config.toml');
    const openclawConfigPath = path.join(paths.sandboxRoot, '.openclaw', 'openclaw.json');
    const zencoderConfigPath = path.join(paths.sandboxRoot, '.zencoder', 'settings.json');
    const connectivityChecks: Array<{ agentId: string; definition: unknown }> = [];

    await Promise.all([
      writeSkillFile(agentsConfigPath, `${JSON.stringify({
        servers: {
          shaped: {
            command: 'node',
            args: ['server.js'],
          },
        },
      }, null, 2)}\n`),
      writeSkillFile(ampConfigPath, `${JSON.stringify({ 'amp.mcpServers': {}, theme: 'dark' }, null, 2)}\n`),
      writeSkillFile(claudeDesktopConfigPath, `${JSON.stringify({
        globalShortcut: 'Control+Space',
        mcpServers: {},
      }, null, 2)}\n`),
      writeSkillFile(codebuddyConfigPath, '{\n  // JSONC is allowed here.\n  "editor": "vscode",\n  "mcp": { "staleAlias": { "command": "stale-mcp" } },\n  "mcpServers": {},\n  "servers": { "staleAlias": { "command": "stale-servers" } },\n}\n'),
      writeSkillFile(codexConfigPath, 'model = "gpt-5"\n'),
      writeSkillFile(crushConfigPath, `${JSON.stringify({
        mcp: {},
        mcpServers: { staleAlias: { command: 'stale-mcpServers' } },
        servers: { staleAlias: { command: 'stale-servers' } },
        theme: 'dark',
      }, null, 2)}\n`),
      writeSkillFile(cursorConfigPath, `${JSON.stringify({
        mcp: { staleAlias: { command: 'stale-mcp' } },
        mcpServers: {},
        servers: { staleAlias: { command: 'stale-servers' } },
        ui: { fontSize: 14 },
      }, null, 2)}\n`),
      writeSkillFile(pochiConfigPath, `${JSON.stringify({
        mcp: {},
        mcpServers: { staleAlias: { command: 'stale-mcpServers' } },
        servers: { staleAlias: { command: 'stale-servers' } },
        theme: 'midnight',
      }, null, 2)}\n`),
      writeSkillFile(muxConfigPath, `${JSON.stringify({
        mcp: { staleAlias: { command: 'stale-mcp' } },
        mcpServers: { staleAlias: { command: 'stale-mcpServers' } },
        profile: 'work',
        servers: {},
      }, null, 2)}\n`),
      writeSkillFile(opencodeConfigPath, `${JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: {},
      }, null, 2)}\n`),
      writeSkillFile(vibeConfigPath, 'model = "codestral"\n'),
      writeSkillFile(openclawConfigPath, `${JSON.stringify({ mcp: { servers: {} }, theme: 'dark' }, null, 2)}\n`),
      writeSkillFile(zencoderConfigPath, `${JSON.stringify({ 'zencoder.mcpServers': {}, theme: 'dark' }, null, 2)}\n`),
    ]);

    const resolvedSnapshot = await resolveInventoryIssue(
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'shaped',
        selectedVariantPath: agentsConfigPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: {
          SKILL_INDEX_AGENT_SUBSET: 'amp,claude-desktop,codebuddy,codex,crush,cursor,mistral-vibe,mux,openclaw,opencode,pochi,zencoder',
        },
        verifyMcpConnectivity: (target) => {
          if (target.name === 'shaped') {
            connectivityChecks.push({
              agentId: target.location.agentId,
              definition: target.definition,
            });
          }

          return Promise.resolve({
            status: 'verified',
            checkedAt: '2026-05-15T12:00:00.000Z',
          } satisfies McpConnectivityRecord);
        },
      },
    );

    const ampConfig = JSON.parse(await readFile(ampConfigPath, 'utf8')) as Record<string, Record<string, unknown>>;
    const claudeDesktopConfig = JSON.parse(await readFile(claudeDesktopConfigPath, 'utf8')) as { globalShortcut?: string; mcpServers?: Record<string, unknown> };
    const codebuddyConfig = JSON.parse(await readFile(codebuddyConfigPath, 'utf8')) as { editor?: string; mcpServers?: Record<string, unknown> };
    const crushConfig = JSON.parse(await readFile(crushConfigPath, 'utf8')) as { mcp?: Record<string, unknown>; theme?: string };
    const cursorConfig = JSON.parse(await readFile(cursorConfigPath, 'utf8')) as { mcpServers?: Record<string, unknown>; ui?: { fontSize?: number } };
    const muxConfig = JSON.parse(await readFile(muxConfigPath, 'utf8')) as { profile?: string; servers?: Record<string, unknown> };
    const openclawConfig = JSON.parse(await readFile(openclawConfigPath, 'utf8')) as { mcp?: { servers?: Record<string, unknown> }; theme?: string };
    const opencodeConfig = JSON.parse(await readFile(opencodeConfigPath, 'utf8')) as { $schema?: string; mcp?: Record<string, unknown> };
    const pochiConfig = JSON.parse(await readFile(pochiConfigPath, 'utf8')) as { mcp?: Record<string, unknown>; theme?: string };
    const zencoderConfig = JSON.parse(await readFile(zencoderConfigPath, 'utf8')) as Record<string, Record<string, unknown>>;

    expect(ampConfig['amp.mcpServers']?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(ampConfig.theme).toBe('dark');
    expect(claudeDesktopConfig.mcpServers?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(claudeDesktopConfig.globalShortcut).toBe('Control+Space');
    expect(codebuddyConfig.mcpServers?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(codebuddyConfig.editor).toBe('vscode');
    expect(codebuddyConfig).not.toHaveProperty('mcp');
    expect(codebuddyConfig).not.toHaveProperty('servers');
    expect(await readFile(codexConfigPath, 'utf8')).toContain('model = "gpt-5"');
    expect(await readFile(codexConfigPath, 'utf8')).toContain('[mcp_servers.shaped]');
    expect(crushConfig.mcp?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(crushConfig.theme).toBe('dark');
    expect(crushConfig).not.toHaveProperty('mcpServers');
    expect(crushConfig).not.toHaveProperty('servers');
    expect(cursorConfig.mcpServers?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(cursorConfig.ui?.fontSize).toBe(14);
    expect(cursorConfig).not.toHaveProperty('mcp');
    expect(cursorConfig).not.toHaveProperty('servers');
    expect(muxConfig.servers?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(muxConfig.profile).toBe('work');
    expect(muxConfig).not.toHaveProperty('mcp');
    expect(muxConfig).not.toHaveProperty('mcpServers');
    expect(await readFile(vibeConfigPath, 'utf8')).toContain('model = "codestral"');
    expect(await readFile(vibeConfigPath, 'utf8')).toContain('[[mcp_servers]]\nname = "shaped"');
    expect(openclawConfig.mcp?.servers?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(openclawConfig.theme).toBe('dark');
    expect(opencodeConfig.mcp?.shaped).toMatchObject({ type: 'local', command: ['node', 'server.js'] });
    expect(opencodeConfig.$schema).toBe('https://opencode.ai/config.json');
    expect(pochiConfig.mcp?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(pochiConfig.theme).toBe('midnight');
    expect(pochiConfig).not.toHaveProperty('mcpServers');
    expect(pochiConfig).not.toHaveProperty('servers');
    expect(zencoderConfig['zencoder.mcpServers']?.shaped).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(zencoderConfig.theme).toBe('dark');
    expect(resolvedSnapshot.mcps?.find((mcp) => mcp.name === 'shaped')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
    });
    const opencodeLocation = resolvedSnapshot.mcps
      ?.find((mcp) => mcp.name === 'shaped')
      ?.locations.find((location) => location.agentId === 'sandbox-opencode');
    expect(opencodeLocation?.connectivity).toMatchObject({ status: 'verified' });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-amp', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-claude-desktop', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-codebuddy', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-codex', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-crush', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-cursor', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-pochi', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-mistral-vibe', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-mux', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-openclaw', { command: 'node', args: ['server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-opencode', { type: 'local', command: ['node', 'server.js'] });
    expectConnectivityDefinition(connectivityChecks, 'sandbox-zencoder', { command: 'node', args: ['server.js'] });
  });
});

function expectVerifiedSignalMapTarget(
  checkedTargets: Array<{ agentId: string; status: McpConnectivityRecord['status']; definition: unknown }>,
  agentId: string,
): void {
  const target = checkedTargets.find((candidate) => candidate.agentId === agentId);
  expect(target?.status).toBe('verified');
  expect(target?.definition).toMatchObject({ command: 'node' });
  expect(getDefinitionArgs(target?.definition)[0]).toEqual(expect.stringContaining('signal-map.js'));
}

function expectConnectivityDefinition(
  checks: Array<{ agentId: string; definition: unknown }>,
  agentId: string,
  expectedDefinition: Record<string, unknown>,
): void {
  const check = checks.find((candidate) => candidate.agentId === agentId);
  expect(check?.definition).toMatchObject(expectedDefinition);
}

function getDefinitionArgs(definition: unknown): unknown[] {
  if (typeof definition !== 'object' || definition === null || !('args' in definition)) {
    return [];
  }

  const { args } = definition as { args?: unknown };
  return Array.isArray(args) ? args : [];
}

async function createPaths(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return resolveSkillIndexPaths({
    env: {
      SKILL_INDEX_DATA_DIR: root,
    },
  });
}

async function upsertMcpDefinition(
  configPath: string,
  parserKind: 'json-servers' | 'json-mcpServers',
  mcpName: string,
  definition: Record<string, unknown>,
): Promise<void> {
  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  const field = parserKind === 'json-mcpServers' ? 'mcpServers' : 'servers';
  parsed[field] = {
    ...(parsed[field] ?? {}),
    [mcpName]: definition,
  };
  await writeStructuredJsonConfig(configPath, parsed);
}

async function deleteMcpDefinition(
  configPath: string,
  parserKind: 'json-servers' | 'json-mcpServers',
  mcpName: string,
): Promise<void> {
  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  const field = parserKind === 'json-mcpServers' ? 'mcpServers' : 'servers';
  const definitions = { ...(parsed[field] ?? {}) };
  delete definitions[mcpName];
  parsed[field] = definitions;
  await writeStructuredJsonConfig(configPath, parsed);
}

async function writeStructuredJsonConfig(configPath: string, value: unknown): Promise<void> {
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readFileJson(configPath: string): Promise<unknown> {
  return JSON.parse(await readFile(configPath, 'utf8')) as unknown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeSkillFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}
