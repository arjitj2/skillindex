// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureRepresentativeSandboxFixturesForDev } from '@main/dev-sandbox-bootstrap';
import { ensureSkillIndexSandboxLayout, resolveSkillIndexPaths } from '@shared/skill-index-paths';

const createdRoots: string[] = [];

describe('ensureRepresentativeSandboxFixturesForDev', () => {
  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('seeds representative fixtures for a fresh dev sandbox so Electron dev has data on first launch', async () => {
    const paths = await createSandboxPaths();

    await expect(ensureRepresentativeSandboxFixturesForDev({
      enabled: true,
      inventoryMode: 'sandbox',
      paths,
    })).resolves.toBe(true);

    const cachedSnapshot = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      sourceIds: string[];
      skills: Array<{ name: string }>;
      mcps: Array<{ name: string }>;
    };
    expect(cachedSnapshot.sourceIds).toEqual(expect.arrayContaining(['sandbox-agents', 'sandbox-factory']));
    expect(cachedSnapshot.skills.map((skill) => skill.name)).toContain('diagnostic-rich-skill');
    expect(cachedSnapshot.mcps.map((mcp) => mcp.name)).toContain('diagnostic-rich-mcp');
    await expect(readFile(path.join(paths.sandboxRoot, '.claude', 'plugins', 'known_marketplaces.json'), 'utf8'))
      .resolves.toContain('sandbox-gallery');
    await expect(readFile(path.join(
      paths.sandboxRoot,
      '.claude',
      'plugins',
      'marketplaces',
      'sandbox-gallery',
      '.claude-plugin',
      'marketplace.json',
    ), 'utf8')).resolves.toContain('signal-index');
  });

  it('passes the opt-in parser-matrix environment through fresh dev sandbox bootstrapping', async () => {
    const paths = await createSandboxPaths();

    await expect(ensureRepresentativeSandboxFixturesForDev({
      enabled: true,
      inventoryMode: 'sandbox',
      paths,
      env: {
        SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX: '1',
      },
    })).resolves.toBe(true);

    const cachedSnapshot = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      mcps: Array<{ name: string }>;
    };
    expect(cachedSnapshot.mcps.map((mcp) => mcp.name)).toContain('parser-shape-matrix-mcp');
    await expect(readFile(path.join(paths.sandboxRoot, '.config', 'amp', 'settings.json'), 'utf8'))
      .resolves.toContain('healthy-mcp');
    await expect(readFile(path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json'), 'utf8'))
      .resolves.toContain('healthy-mcp');
    await expect(readFile(path.join(paths.sandboxRoot, '.zencoder', 'settings.json'), 'utf8'))
      .resolves.toContain('healthy-mcp');
  });

  it('does not overwrite an existing sandbox inventory', async () => {
    const paths = await createSandboxPaths();
    await ensureSkillIndexSandboxLayout(paths);
    await mkdir(path.join(paths.sandboxRoot, '.factory', 'skills', 'existing-skill'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'skills', 'existing-skill', 'SKILL.md'), [
      '---',
      'name: existing-skill',
      'description: Existing sandbox skill',
      '---',
      '',
      '# Existing skill',
      '',
    ].join('\n'), 'utf8');

    await expect(ensureRepresentativeSandboxFixturesForDev({
      enabled: true,
      inventoryMode: 'sandbox',
      paths,
    })).resolves.toBe(false);

    const cachedSnapshot = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      skills: Array<{ name: string }>;
    };
    expect(cachedSnapshot.skills.map((skill) => skill.name)).toEqual(['existing-skill']);
  });

  it('does nothing outside dev sandbox mode', async () => {
    const paths = await createSandboxPaths();

    await expect(ensureRepresentativeSandboxFixturesForDev({
      enabled: true,
      inventoryMode: 'live',
      paths,
    })).resolves.toBe(false);

    await expect(readFile(paths.cacheFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createSandboxPaths() {
  const root = await mkdtemp(path.join(tmpdir(), 'skillindex-dev-sandbox-'));
  createdRoots.push(root);
  return resolveSkillIndexPaths({
    env: {
      SKILL_INDEX_DATA_DIR: root,
    },
  });
}
