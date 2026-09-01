// @vitest-environment node

import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { removeInventoryItem } from '@main/remove-inventory-item';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

describe('removeInventoryItem', () => {
  it('moves a skill package from every scanned location to Trash', async () => {
    const paths = await createPaths('skillindex-remove-skill-');
    const canonicalSkillPath = path.join(paths.sandboxAgentsSkillsDir, 'remove-me');
    const claudeSkillPath = path.join(paths.sandboxRoot, '.claude', 'skills', 'remove-me');
    const trashedPaths: string[] = [];

    await writeSkillPackage(paths.sandboxAgentsSkillsDir, 'remove-me');
    await mkdir(path.dirname(claudeSkillPath), { recursive: true });
    await symlink(canonicalSkillPath, claudeSkillPath);

    const snapshot = await removeInventoryItem(
      { entity: 'skill', skillName: 'remove-me' },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        trashItem: async (targetPath) => {
          trashedPaths.push(targetPath);
          await rm(targetPath, { recursive: true, force: true });
        },
      },
    );

    expect(snapshot.skills.some((skill) => skill.name === 'remove-me')).toBe(false);
    expect([...trashedPaths].sort()).toEqual([canonicalSkillPath, claudeSkillPath].sort());
    await expect(pathExists(canonicalSkillPath)).resolves.toBe(false);
    await expect(pathExists(claudeSkillPath)).resolves.toBe(false);
  });

  it('removes an MCP server definition from every config where it appears', async () => {
    const paths = await createPaths('skillindex-remove-mcp-');
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const claudeConfigPath = path.join(paths.sandboxRoot, '.claude.json');

    await writeJsonFile(agentsConfigPath, {
      servers: {
        keepMe: { command: 'node', args: ['keep.js'] },
        removeMe: { command: 'node', args: ['agents.js'] },
      },
    });
    await writeJsonFile(claudeConfigPath, {
      mcpServers: {
        keepMe: { command: 'node', args: ['keep.js'] },
        removeMe: { command: 'node', args: ['claude.js'] },
      },
    });
    await writeJsonFile(path.join(paths.sandboxRoot, '.claude', 'settings.json'), {});

    const snapshot = await removeInventoryItem(
      { entity: 'mcp', mcpName: 'removeMe' },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: { SKILL_INDEX_AGENT_SUBSET: 'claude' },
      },
    );

    const agentsConfig = JSON.parse(await readFile(agentsConfigPath, 'utf8')) as { servers?: Record<string, unknown> };
    const claudeConfig = JSON.parse(await readFile(claudeConfigPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
    expect(snapshot.mcps?.some((mcp) => mcp.name === 'removeMe')).toBe(false);
    expect(agentsConfig.servers).toHaveProperty('keepMe');
    expect(agentsConfig.servers).not.toHaveProperty('removeMe');
    expect(claudeConfig.mcpServers).toHaveProperty('keepMe');
    expect(claudeConfig.mcpServers).not.toHaveProperty('removeMe');
  });

  it('never removes a managed plugin MCP definition from its cache config', async () => {
    const paths = await createPaths('skillindex-remove-plugin-mcp-');
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'protected-mcp', '1.0.0');
    const pluginConfigPath = path.join(pluginRoot, '.mcp.json');
    const pluginConfig = JSON.stringify({
      mcpServers: { protected: { command: 'node', args: ['server.js'] } },
    }, null, 2);
    await writeJsonFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), { name: 'protected-mcp', version: '1.0.0' });
    await writeFile(pluginConfigPath, pluginConfig, 'utf8');

    await expect(removeInventoryItem(
      { entity: 'mcp', mcpName: 'protected-mcp:protected' },
      { paths, includeSandboxSources: true, includeLiveSources: false },
    )).rejects.toThrow('no removable config locations');
    expect(await readFile(pluginConfigPath, 'utf8')).toBe(pluginConfig);
  });

  it('rolls back public MCP removal when the later atomic config commit fails', async () => {
    const paths = await createPaths('skillindex-remove-mcp-transaction-');
    const universalPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const universalReferent = path.join(paths.sandboxRoot, 'real', 'universal-mcp.json');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const universalOriginal = `${JSON.stringify({ servers: {
      removeTransactional: { command: 'node', args: ['remove.js'] },
      keepUniversal: { command: 'node', args: ['keep.js'] },
    } })}\n`;
    const factoryOriginal = `${JSON.stringify({ mcpServers: {
      removeTransactional: { command: 'node', args: ['remove.js'] },
      keepFactory: { command: 'node', args: ['keep.js'] },
    }, telemetry: { enabled: false } })}\n`;
    await mkdir(path.join(paths.sandboxRoot, '.agents', 'skills'), { recursive: true });
    await mkdir(path.dirname(universalReferent), { recursive: true });
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await writeFile(universalReferent, universalOriginal, 'utf8');
    await chmod(universalReferent, 0o600);
    await symlink(universalReferent, universalPath);
    await writeFile(factoryPath, factoryOriginal, 'utf8');
    await chmod(factoryPath, 0o600);
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');

    await expect(removeInventoryItem(
      { entity: 'mcp', mcpName: 'removeTransactional' },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: { SKILL_INDEX_AGENT_SUBSET: 'factory' },
        testFailMcpCommitAt: 1,
      },
    )).rejects.toThrow('MCP config commit failed before atomic rename.');

    expect((await lstat(universalPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(universalReferent, 'utf8')).toBe(universalOriginal);
    expect(await readFile(factoryPath, 'utf8')).toBe(factoryOriginal);
    expect((await stat(universalReferent)).mode & 0o777).toBe(0o600);
    expect((await stat(factoryPath)).mode & 0o777).toBe(0o600);
    expect((await readdir(path.dirname(universalReferent))).every((name) => !name.includes('.skillindex-'))).toBe(true);
    expect((await readdir(path.dirname(factoryPath))).every((name) => !name.includes('.skillindex-'))).toBe(true);
  });

  it('moves a subagent definition from every scanned location to Trash', async () => {
    const paths = await createPaths('skillindex-remove-subagent-');
    const canonicalSubagentPath = path.join(paths.sandboxRoot, '.agents', 'agents', 'remove-me.md');
    const claudeSubagentPath = path.join(paths.sandboxRoot, '.claude', 'agents', 'remove-me.md');
    const trashedPaths: string[] = [];

    await writeMarkdownSubagent(canonicalSubagentPath, 'remove-me', 'Canonical remove me');
    await writeMarkdownSubagent(claudeSubagentPath, 'remove-me', 'Claude remove me');

    const snapshot = await removeInventoryItem(
      { entity: 'subagent', subagentName: 'remove-me' },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        env: { SKILL_INDEX_AGENT_SUBSET: 'claude' },
        trashItem: async (targetPath) => {
          trashedPaths.push(targetPath);
          await rm(targetPath, { recursive: true, force: true });
        },
      },
    );

    expect(snapshot.subagents?.some((subagent) => subagent.name === 'remove-me')).toBe(false);
    expect([...trashedPaths].sort()).toEqual([canonicalSubagentPath, claudeSubagentPath].sort());
    await expect(pathExists(canonicalSubagentPath)).resolves.toBe(false);
    await expect(pathExists(claudeSubagentPath)).resolves.toBe(false);
  });

  it('never trashes plugin-only skill or subagent caches', async () => {
    const paths = await createPaths('skillindex-remove-plugin-assets-');
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'protected-assets', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'protected-skill');
    const pluginSubagentPath = path.join(pluginRoot, 'agents', 'protected-subagent.md');
    const trashedPaths: string[] = [];

    await writeJsonFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), { name: 'protected-assets', version: '1.0.0' });
    await writeSkillPackage(path.join(pluginRoot, 'skills'), 'protected-skill');
    await writeMarkdownSubagent(pluginSubagentPath, 'protected-subagent', 'Plugin-only protected subagent');
    const skillBefore = await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8');
    const subagentBefore = await readFile(pluginSubagentPath, 'utf8');
    const options = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      trashItem: async (targetPath: string) => {
        trashedPaths.push(targetPath);
        await rm(targetPath, { recursive: true, force: true });
      },
    };

    await expect(removeInventoryItem({ entity: 'skill', skillName: 'protected-assets:protected-skill' }, options))
      .rejects.toThrow('no removable locations');
    await expect(removeInventoryItem({ entity: 'subagent', subagentName: 'protected-assets:protected-subagent' }, options))
      .rejects.toThrow('no removable locations');

    expect(trashedPaths).toEqual([]);
    expect(await readFile(path.join(pluginSkillPath, 'SKILL.md'), 'utf8')).toBe(skillBefore);
    expect(await readFile(pluginSubagentPath, 'utf8')).toBe(subagentBefore);
  });

  it('refuses an unindexed plugin-cache alias before passing it to Trash', async () => {
    const paths = await createPaths('skillindex-remove-plugin-alias-');
    const cacheSkillsDir = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'unindexed', 'alias-removal', '1.0.0', 'skills');
    const canonicalSkillsDir = paths.sandboxAgentsSkillsDir;
    const skillName = 'aliased-skill';
    const cacheSkillPath = path.join(cacheSkillsDir, skillName, 'SKILL.md');
    const trashedPaths: string[] = [];

    await writeSkillPackage(cacheSkillsDir, skillName);
    await mkdir(path.dirname(canonicalSkillsDir), { recursive: true });
    await symlink(cacheSkillsDir, canonicalSkillsDir);
    const cacheBefore = await readFile(cacheSkillPath, 'utf8');

    await expect(removeInventoryItem({ entity: 'skill', skillName }, {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      trashItem: async (targetPath) => {
        trashedPaths.push(targetPath);
        await rm(targetPath, { recursive: true, force: true });
      },
    })).rejects.toThrow('no removable locations');

    expect(trashedPaths).toEqual([]);
    expect(await readFile(cacheSkillPath, 'utf8')).toBe(cacheBefore);
  });

  it('removes writable mixed skill and subagent locations without touching matching plugin cache candidates', async () => {
    const paths = await createPaths('skillindex-remove-mixed-plugin-assets-');
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'mixed-assets', '1.0.0');
    const skillName = 'mixed-assets:shared-skill';
    const subagentName = 'mixed-assets:shared-subagent';
    const universalSkillPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const claudeSkillPath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);
    const universalSubagentPath = path.join(paths.sandboxRoot, '.agents', 'agents', 'mixed-assets-shared-subagent.md');
    const claudeSubagentPath = path.join(paths.sandboxRoot, '.claude', 'agents', 'mixed-assets-shared-subagent.md');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'shared-skill', 'SKILL.md');
    const pluginSubagentPath = path.join(pluginRoot, 'agents', 'shared-subagent.md');
    const trashedPaths: string[] = [];

    await writeJsonFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), { name: 'mixed-assets', version: '1.0.0' });
    await writeSkillPackage(path.join(pluginRoot, 'skills'), 'shared-skill');
    await writeMarkdownSubagent(pluginSubagentPath, 'shared-subagent', 'Plugin cache definition');
    await writeSkillPackage(paths.sandboxAgentsSkillsDir, skillName);
    await mkdir(path.dirname(claudeSkillPath), { recursive: true });
    await symlink(universalSkillPath, claudeSkillPath);
    await writeMarkdownSubagent(universalSubagentPath, 'shared-subagent', 'Universal definition');
    await writeMarkdownSubagent(claudeSubagentPath, 'shared-subagent', 'Claude definition');
    await writeFile(path.join(paths.sandboxRoot, '.claude', 'settings.json'), '{}\n', 'utf8');
    const pluginSkillBefore = await readFile(pluginSkillPath, 'utf8');
    const pluginSubagentBefore = await readFile(pluginSubagentPath, 'utf8');

    const options = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'claude' },
      trashItem: async (targetPath: string) => {
        trashedPaths.push(targetPath);
        await rm(targetPath, { recursive: true, force: true });
      },
    };
    await removeInventoryItem({ entity: 'skill', skillName }, options);
    await removeInventoryItem({ entity: 'subagent', subagentName }, options);

    expect(trashedPaths).toEqual(expect.arrayContaining([
      universalSkillPath,
      claudeSkillPath,
      universalSubagentPath,
      claudeSubagentPath,
    ]));
    expect(trashedPaths).not.toContain(pluginSkillPath);
    expect(trashedPaths).not.toContain(pluginSubagentPath);
    expect(await readFile(pluginSkillPath, 'utf8')).toBe(pluginSkillBefore);
    expect(await readFile(pluginSubagentPath, 'utf8')).toBe(pluginSubagentBefore);
  });
});

async function createPaths(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return resolveSkillIndexPaths({
    env: {
      SKILL_INDEX_DATA_DIR: root,
    },
  });
}

async function writeSkillPackage(rootDir: string, skillName: string): Promise<void> {
  await writeFileWithParents(path.join(rootDir, skillName, 'SKILL.md'), [
    '---',
    `name: ${skillName}`,
    `description: ${skillName}`,
    '---',
    '',
    `# ${skillName}`,
    '',
  ].join('\n'));
}

async function writeMarkdownSubagent(filePath: string, name: string, description: string): Promise<void> {
  await writeFileWithParents(filePath, [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n'));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileWithParents(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileWithParents(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}
