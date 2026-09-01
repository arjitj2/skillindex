// @vitest-environment node

import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { resolveInventoryIssue } from '@main/issue-resolution';
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
    const newerSkill = path.join(cacheRoot, 'plugin-version-choice-skill', '1.1.0', 'skills', 'plugin-version-choice-skill', 'SKILL.md');
    const staleTarget = path.join(cacheRoot, 'legacy-plugin-link-skill', '1.0.0', 'skills', 'legacy-plugin-link-skill');
    const legacyLink = path.join(paths.sandboxRoot, '.claude', 'skills', 'legacy-plugin-link-skill');

    await expect(readFile(semverSkill, 'utf8')).resolves.toContain('version 1.0.0 selected content');
    await expect(readFile(newerSkill, 'utf8')).resolves.toContain('version 1.1.0 selected content');
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

  it('refuses unsafe direct reset roots before any mutation, including realpath aliases', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'skillindex-reset-workspace-'));
    const homeDir = path.join(workspace, 'home');
    const dataDir = path.join(workspace, 'data');
    const outsideRoot = path.join(workspace, 'outside');
    await Promise.all([mkdir(homeDir, { recursive: true }), mkdir(dataDir, { recursive: true }), mkdir(outsideRoot, { recursive: true })]);

    try {
      const controlledTargets = [
        dataDir,
        workspace,
        path.join(outsideRoot, 'nested-sandbox'),
        homeDir,
      ];
      for (const target of controlledTargets) {
        await mkdir(target, { recursive: true });
        const sentinel = path.join(target, 'sentinel.txt');
        await writeFile(sentinel, `sentinel:${target}\n`, 'utf8');
        await expect(seedRepresentativeFixtures({
          env: { SKILL_INDEX_DATA_DIR: dataDir, SKILL_INDEX_SANDBOX_ROOT: target },
          homeDir,
        })).rejects.toThrow('unsafe sandbox root');
        await expect(readFile(sentinel, 'utf8')).resolves.toBe(`sentinel:${target}\n`);
      }

      const tmpSentinel = path.join(tmpdir(), `skillindex-reset-tmp-${path.basename(workspace)}.txt`);
      await writeFile(tmpSentinel, 'tmp sentinel\n', 'utf8');
      for (const target of ['/', tmpdir(), homedir(), path.join(homedir(), '.codex', 'plugins', 'cache')]) {
        await expect(seedRepresentativeFixtures({
          env: { SKILL_INDEX_DATA_DIR: dataDir, SKILL_INDEX_SANDBOX_ROOT: target },
          homeDir,
        })).rejects.toThrow('unsafe sandbox root');
      }
      await expect(readFile(tmpSentinel, 'utf8')).resolves.toBe('tmp sentinel\n');

      const codexCache = path.join(homeDir, '.codex', 'plugins', 'cache');
      await mkdir(codexCache, { recursive: true });
      const alias = path.join(dataDir, 'sandbox');
      const aliasedSentinel = path.join(codexCache, 'alias-sentinel.txt');
      await writeFile(aliasedSentinel, 'alias sentinel\n', 'utf8');
      await symlink(codexCache, alias);

      await expect(seedRepresentativeFixtures({
        env: { SKILL_INDEX_DATA_DIR: dataDir, SKILL_INDEX_SANDBOX_ROOT: alias },
        homeDir,
      })).rejects.toThrow('unsafe sandbox root');
      await expect(readFile(aliasedSentinel, 'utf8')).resolves.toBe('alias sentinel\n');

      await rm(alias, { force: true });
      const validSandboxRoot = path.join(dataDir, 'sandbox', 'nested-fixture-root');
      await expect(seedRepresentativeFixtures({
        env: { SKILL_INDEX_DATA_DIR: dataDir, SKILL_INDEX_SANDBOX_ROOT: validSandboxRoot },
        homeDir,
      })).resolves.toMatchObject({ sandboxRoot: validSandboxRoot });
      await expect(readFile(path.join(validSandboxRoot, '.agents', 'skills', 'healthy-skill', 'SKILL.md'), 'utf8')).resolves.toContain('Healthy skill');
    } finally {
      await rm(path.join(tmpdir(), `skillindex-reset-tmp-${path.basename(workspace)}.txt`), { force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('returns to the same complete sandbox tree after real managed-source resolutions and repeated resets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-reset-after-actions-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false } as const;
    const skillName = 'plugin-single-source-skill';
    const subagentName = 'plugin-version-choice-subagent:plugin-version-choice-subagent';
    const skillCandidate = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-fixtures', skillName, '1.0.0', 'skills', skillName);
    const subagentCandidate = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-fixtures', 'plugin-version-choice-subagent', '1.0.0', 'agents', 'plugin-version-choice-subagent.md');
    const boundConfig = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-fixtures', 'plugin-bound-mcp', '1.0.0', '.mcp.json');

    await seedRepresentativeFixtures({ paths });
    const skillCacheBefore = await readFile(path.join(skillCandidate, 'SKILL.md'), 'utf8');
    const subagentCacheBefore = await readFile(subagentCandidate, 'utf8');
    const mcpCacheBefore = await readFile(boundConfig, 'utf8');

    await resolveInventoryIssue({ entity: 'skill', issue: 'missing-canonical', skillName, selectedVariantPath: skillCandidate }, scanOptions);
    await resolveInventoryIssue({ entity: 'subagent', issue: 'missing-universal', subagentName, selectedVariantPath: subagentCandidate }, scanOptions);
    await resolveInventoryIssue({ entity: 'mcp', issue: 'missing-universal', mcpName: 'plugin-bound-mcp:plugin-bound-mcp', selectedVariantPath: boundConfig }, scanOptions);
    await writeFile(path.join(paths.sandboxRoot, 'stale-generated-after-action'), 'remove me\n', 'utf8');

    expect(await readFile(path.join(skillCandidate, 'SKILL.md'), 'utf8')).toBe(skillCacheBefore);
    expect(await readFile(subagentCandidate, 'utf8')).toBe(subagentCacheBefore);
    expect(await readFile(boundConfig, 'utf8')).toBe(mcpCacheBefore);

    await seedRepresentativeFixtures({ paths });
    const firstReset = await treeFingerprint(paths.sandboxRoot);
    await expect(lstat(path.join(paths.sandboxRoot, 'stale-generated-after-action'))).rejects.toMatchObject({ code: 'ENOENT' });
    await seedRepresentativeFixtures({ paths });
    expect(await treeFingerprint(paths.sandboxRoot)).toEqual(firstReset);
  }, 20_000);
});

// Intentionally excludes mtimes: fixture writes get fresh timestamps, while
// bytes, file modes, directory shape, and symlink targets must be identical.
async function treeFingerprint(root: string): Promise<Array<{ path: string; type: string; mode: number; value?: string }>> {
  const entries: Array<{ path: string; type: string; mode: number; value?: string }> = [];

  async function visit(currentPath: string): Promise<void> {
    const stats = await lstat(currentPath);
    const relativePath = path.relative(root, currentPath) || '.';
    const mode = stats.mode & 0o777;
    if (stats.isSymbolicLink()) {
      entries.push({ path: relativePath, type: 'symlink', mode, value: await readlink(currentPath) });
      return;
    }
    if (stats.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory', mode });
      const children = await readdir(currentPath);
      await Promise.all(children.sort((left, right) => left.localeCompare(right)).map((child) => visit(path.join(currentPath, child))));
      return;
    }
    entries.push({ path: relativePath, type: 'file', mode, value: await readFile(currentPath, 'utf8') });
  }

  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
