// @vitest-environment node

import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { defaultConfig, ensureSkillIndexLayout, resolveSkillIndexPaths, writeSkillIndexConfig } from '@shared/skill-index-paths';

describe('seedRepresentativeFixtures', () => {
  it('writes fixture config to sandbox app state without rewriting live app config or deleting sandbox audit history', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-sandbox-fixtures-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
    };
    const livePaths = resolveSkillIndexPaths({ env });
    const sandboxStateDir = path.join(root, 'sandbox-state');
    const sandboxConfigFile = path.join(sandboxStateDir, 'config.json');
    const sandboxAuditLogFile = path.join(sandboxStateDir, 'audit-log.jsonl');
    const liveConfig = {
      ...defaultConfig,
      customScanPaths: [path.join(root, 'live-custom-skills')],
      preferredCanonicalSourcePath: path.join(root, 'live-custom-skills'),
    };

    await ensureSkillIndexLayout(livePaths);
    await writeSkillIndexConfig(livePaths.configFile, liveConfig);
    await mkdir(path.dirname(sandboxAuditLogFile), { recursive: true });
    await writeFile(sandboxAuditLogFile, 'sentinel sandbox audit entry\n', 'utf8');

    await seedRepresentativeFixtures({ env });

    await expect(readFile(livePaths.configFile, 'utf8')).resolves.toBe(`${JSON.stringify(liveConfig, null, 2)}\n`);
    await expect(readFile(sandboxConfigFile, 'utf8')).resolves.toContain('"dismissedMcpSignatures"');
    await expect(readFile(sandboxAuditLogFile, 'utf8')).resolves.toBe('sentinel sandbox audit entry\n');
  });

  it('rebuilds managed plugin cache fixtures byte-for-byte and restores the legacy broken link', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-fixtures-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await seedRepresentativeFixtures({ paths });
    const baseline = await treeFingerprint(paths.sandboxRoot);
    const cacheRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-fixtures');
    const semverSkill = path.join(cacheRoot, 'plugin-version-choice-skill', '1.0.0', 'skills', 'plugin-version-choice-skill', 'SKILL.md');
    const hashSkill = path.join(cacheRoot, 'plugin-version-choice-skill', 'd6169bef', 'skills', 'plugin-version-choice-skill', 'SKILL.md');
    const staleTarget = path.join(cacheRoot, 'legacy-plugin-link-skill', '1.0.0', 'skills', 'legacy-plugin-link-skill');
    const legacyLink = path.join(paths.sandboxRoot, '.claude', 'skills', 'legacy-plugin-link-skill');

    await expect(readFile(semverSkill, 'utf8')).resolves.toContain('version 1.0.0 selected content');
    await expect(readFile(hashSkill, 'utf8')).resolves.toContain('revision d6169bef selected content');
    expect((await lstat(legacyLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(legacyLink)).toBe(staleTarget);
    await expect(lstat(staleTarget)).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(semverSkill, 'mutated plugin cache\n', 'utf8');
    await mkdir(path.join(paths.sandboxRoot, '.agents', 'skills', 'plugin-single-source-skill'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.agents', 'skills', 'plugin-single-source-skill', 'SKILL.md'), 'generated Universal\n', 'utf8');
    await writeFile(path.join(paths.sandboxRoot, 'stale-generated-state'), 'stale\n', 'utf8');

    await seedRepresentativeFixtures({ paths });

    expect(await treeFingerprint(paths.sandboxRoot)).toEqual(baseline);
    await expect(readFile(semverSkill, 'utf8')).resolves.toContain('version 1.0.0 selected content');
    await expect(lstat(staleTarget)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function treeFingerprint(root: string): Promise<Array<{ path: string; type: string; value?: string }>> {
  const entries: Array<{ path: string; type: string; value?: string }> = [];

  async function visit(currentPath: string): Promise<void> {
    const stats = await lstat(currentPath);
    const relativePath = path.relative(root, currentPath) || '.';
    if (stats.isSymbolicLink()) {
      entries.push({ path: relativePath, type: 'symlink', value: await readlink(currentPath) });
      return;
    }
    if (stats.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory' });
      const children = await readdir(currentPath);
      await Promise.all(children.sort((left, right) => left.localeCompare(right)).map((child) => visit(path.join(currentPath, child))));
      return;
    }
    entries.push({ path: relativePath, type: 'file', value: await readFile(currentPath, 'utf8') });
  }

  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
