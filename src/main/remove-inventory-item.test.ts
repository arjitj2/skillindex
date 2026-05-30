// @vitest-environment node

import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
