import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultConfig,
  ensureSkillIndexSandboxLayout,
  ensureSkillIndexLayout,
  readSkillIndexConfig,
  readSkillIndexConfigSync,
  resolveRootSkillIndexStatePaths,
  resolveSandboxSkillIndexPaths,
  resolveSkillIndexPathsForScanOptions,
  resolveSkillIndexPaths,
  writeSkillIndexConfig,
} from '@shared/skill-index-paths';

describe('resolveSkillIndexPaths', () => {
  it('defaults to ~/.skillindex with a sandboxed .agents skills root', () => {
    const paths = resolveSkillIndexPaths({ homeDir: '/Users/tester', env: {} });

    expect(paths.dataDir).toBe(path.join('/Users/tester', '.skillindex'));
    expect(paths.auditLogFile).toBe(path.join('/Users/tester', '.skillindex', 'audit-log.jsonl'));
    expect(paths.cacheFile).toBe(path.join('/Users/tester', '.skillindex', 'cache.json'));
    expect(paths.configFile).toBe(path.join('/Users/tester', '.skillindex', 'config.json'));
    expect(paths.sandboxRoot).toBe(path.join('/Users/tester', '.skillindex', 'sandbox'));
    expect(paths.sandboxAgentsDir).toBe(path.join('/Users/tester', '.skillindex', 'sandbox', '.agents'));
    expect(paths.sandboxAgentsSkillsDir).toBe(path.join('/Users/tester', '.skillindex', 'sandbox', '.agents', 'skills'));
    expect(paths.fixturesDir).toBe(path.join('/Users/tester', '.skillindex', 'fixtures'));
  });

  it('honors explicit data and sandbox overrides for isolated tests', () => {
    const paths = resolveSkillIndexPaths({
      homeDir: '/Users/tester',
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/custom-data',
        SKILL_INDEX_SANDBOX_ROOT: '/tmp/custom-data/sandbox-alt',
      },
    });

    expect(paths.dataDir).toBe('/tmp/custom-data');
    expect(paths.sandboxRoot).toBe('/tmp/custom-data/sandbox-alt');
    expect(paths.sandboxAgentsSkillsDir).toBe('/tmp/custom-data/sandbox-alt/.agents/skills');
  });
});

describe('resolveSkillIndexPathsForScanOptions', () => {
  it('keeps live app state at the data root and sandbox app state outside the disposable sandbox root', () => {
    const livePaths = resolveSkillIndexPathsForScanOptions({
      homeDir: '/Users/tester',
      env: {},
      includeLiveSources: true,
      includeSandboxSources: false,
    });
    const sandboxPaths = resolveSkillIndexPathsForScanOptions({
      homeDir: '/Users/tester',
      env: {},
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    expect(livePaths.configFile).toBe(path.join('/Users/tester', '.skillindex', 'config.json'));
    expect(livePaths.auditLogFile).toBe(path.join('/Users/tester', '.skillindex', 'audit-log.jsonl'));
    expect(sandboxPaths.sandboxRoot).toBe(path.join('/Users/tester', '.skillindex', 'sandbox'));
    expect(sandboxPaths.sandboxAgentsSkillsDir).toBe(path.join('/Users/tester', '.skillindex', 'sandbox', '.agents', 'skills'));
    expect(sandboxPaths.configFile).toBe(path.join('/Users/tester', '.skillindex', 'sandbox-state', 'config.json'));
    expect(sandboxPaths.cacheFile).toBe(path.join('/Users/tester', '.skillindex', 'sandbox-state', 'cache.json'));
    expect(sandboxPaths.auditLogFile).toBe(path.join('/Users/tester', '.skillindex', 'sandbox-state', 'audit-log.jsonl'));
    expect(sandboxPaths.fixturesDir).toBe(path.join('/Users/tester', '.skillindex', 'fixtures'));
    expect(sandboxPaths.configFile.startsWith(`${sandboxPaths.sandboxRoot}${path.sep}`)).toBe(false);
  });
});

describe('resolveRootSkillIndexStatePaths', () => {
  it('derives root app-state paths from sandbox-state paths without falling back to the real environment', () => {
    const sandboxPaths = resolveSkillIndexPathsForScanOptions({
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/custom-data',
      },
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    const rootPaths = resolveRootSkillIndexStatePaths({
      paths: sandboxPaths,
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    expect(rootPaths.dataDir).toBe('/tmp/custom-data');
    expect(rootPaths.configFile).toBe(path.join('/tmp/custom-data', 'config.json'));
    expect(rootPaths.cacheFile).toBe(path.join('/tmp/custom-data', 'cache.json'));
    expect(rootPaths.auditLogFile).toBe(path.join('/tmp/custom-data', 'audit-log.jsonl'));
    expect(rootPaths.sandboxRoot).toBe(sandboxPaths.sandboxRoot);
    expect(rootPaths.sandboxAgentsSkillsDir).toBe(sandboxPaths.sandboxAgentsSkillsDir);
  });

  it('honors explicit root path overrides even when scan flags select sandbox sources', () => {
    const explicitPaths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/explicit-root',
      },
    });

    expect(resolveRootSkillIndexStatePaths({
      paths: explicitPaths,
      includeLiveSources: false,
      includeSandboxSources: true,
    })).toBe(explicitPaths);
  });
});

describe('resolveSandboxSkillIndexPaths', () => {
  it('derives sandbox app-state paths from explicit root path overrides', () => {
    const rootPaths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/custom-data',
      },
    });

    const sandboxPaths = resolveSandboxSkillIndexPaths({ paths: rootPaths });

    expect(sandboxPaths.dataDir).toBe(path.join('/tmp/custom-data', 'sandbox-state'));
    expect(sandboxPaths.configFile).toBe(path.join('/tmp/custom-data', 'sandbox-state', 'config.json'));
    expect(sandboxPaths.cacheFile).toBe(path.join('/tmp/custom-data', 'sandbox-state', 'cache.json'));
    expect(sandboxPaths.auditLogFile).toBe(path.join('/tmp/custom-data', 'sandbox-state', 'audit-log.jsonl'));
    expect(sandboxPaths.sandboxRoot).toBe(rootPaths.sandboxRoot);
    expect(sandboxPaths.sandboxAgentsSkillsDir).toBe(rootPaths.sandboxAgentsSkillsDir);
  });

  it('does not double-apply sandbox app-state paths that are already sandbox-scoped', () => {
    const sandboxPaths = resolveSkillIndexPathsForScanOptions({
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/custom-data',
      },
      includeLiveSources: false,
      includeSandboxSources: true,
    });

    expect(resolveSandboxSkillIndexPaths({ paths: sandboxPaths })).toBe(sandboxPaths);
  });
});

describe('ensureSkillIndexLayout', () => {
  it('creates bootstrap JSON files without creating sandbox directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-layout-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await ensureSkillIndexLayout(paths);

    await expect(readFile(paths.cacheFile, 'utf8')).resolves.toBe('{}\n');
    await expect(readFile(paths.configFile, 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          customScanPaths: [],
          preferredCanonicalSourcePath: null,
          showDevSidebarInventorySourceSwitcher: true,
          onboardingCompletedAt: null,
          dismissedDriftSignatures: [],
          dismissedMcpSignatures: [],
          dismissedSubagentSignatures: [],
          skillUniversalDecisions: [],
        },
        null,
        2,
      )}\n`,
    );
    await expect(pathExists(paths.sandboxCanonicalUserSkillsDir)).resolves.toBe(false);
    await expect(pathExists(paths.fixturesDir)).resolves.toBe(false);
  });
});

describe('ensureSkillIndexSandboxLayout', () => {
  it('creates the writable sandbox structure only when requested', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-sandbox-layout-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await ensureSkillIndexLayout(paths);
    await ensureSkillIndexSandboxLayout(paths);

    await expect(pathExists(paths.sandboxCanonicalUserSkillsDir)).resolves.toBe(true);
    await expect(pathExists(paths.fixturesDir)).resolves.toBe(true);
  });
});

describe('readSkillIndexConfig', () => {
  it('uses the default config when the config file has not been created yet', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-missing-'));
    const configFile = path.join(root, 'config.json');

    await expect(readSkillIndexConfig(configFile)).resolves.toEqual(defaultConfig);
    expect(readSkillIndexConfigSync(configFile)).toEqual(defaultConfig);
  });

  it('reports malformed config JSON instead of silently falling back to defaults', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-malformed-'));
    const configFile = path.join(root, 'config.json');
    await writeFile(configFile, '{not valid json', 'utf8');

    await expect(readSkillIndexConfig(configFile)).rejects.toThrow(
      `Failed to parse Skill Index config at ${configFile}:`,
    );
    expect(() => readSkillIndexConfigSync(configFile)).toThrow(
      `Failed to parse Skill Index config at ${configFile}:`,
    );
  });

  it('parses plugin-aware Universal skill decisions from config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-decisions-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await writeFile(paths.configFile, JSON.stringify({
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
      detachedProvenance: [
        {
          originKind: 'plugin',
          pluginId: 'stale@marketplace',
          originPath: '/tmp/plugin/foo',
          originContentHash: 'abc',
          exportedAt: '2026-05-07T00:00:00.000Z',
          destinationPath: '/tmp/local/foo',
        },
      ],
      skillUniversalDecisions: [
        {
          id: 'skill:foo:plugin',
          skillName: 'foo',
          state: 'user-confirmed',
          universal: {
            kind: 'plugin',
            host: 'claude',
            pluginId: 'tools@marketplace',
            pluginSkillName: 'foo',
          },
          acceptedAlternates: [
            {
              kind: 'path',
              path: '/tmp/local/foo',
              sourceId: 'live-agents',
              reason: 'kept-separate',
            },
          ],
          updatedAt: '2026-05-07T00:00:00.000Z',
        },
      ],
    }, null, 2), 'utf8');

    await expect(readSkillIndexConfig(paths.configFile)).resolves.toMatchObject({
      customScanPaths: [],
      skillUniversalDecisions: [
        {
          skillName: 'foo',
          universal: {
            kind: 'plugin',
            pluginId: 'tools@marketplace',
            pluginSkillName: 'foo',
          },
          acceptedAlternates: [
            {
              kind: 'path',
              path: '/tmp/local/foo',
              sourceId: 'live-agents',
              reason: 'kept-separate',
            },
          ],
        },
      ],
    });
    await expect(readSkillIndexConfig(paths.configFile)).resolves.not.toHaveProperty('detachedProvenance');
  });

  it('filters malformed Universal skill decisions from config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-decisions-invalid-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await writeFile(paths.configFile, JSON.stringify({
      skillUniversalDecisions: [
        {
          id: 'skill:valid:plugin',
          skillName: 'valid',
          state: 'policy',
          universal: {
            kind: 'plugin',
            host: 'codex',
            pluginId: 'tools@marketplace',
            pluginSkillName: 'valid',
          },
          acceptedAlternates: [],
          updatedAt: '2026-05-07T00:00:00.000Z',
        },
        {
          id: 'skill:invalid:plugin',
          skillName: 'invalid',
          state: 'surprise',
          universal: {
            kind: 'plugin',
            host: 'codex',
            pluginId: 'tools@marketplace',
            pluginSkillName: 'invalid',
          },
          acceptedAlternates: [],
          updatedAt: '2026-05-07T00:00:00.000Z',
        },
      ],
    }, null, 2), 'utf8');

    await expect(readSkillIndexConfig(paths.configFile)).resolves.toMatchObject({
      skillUniversalDecisions: [
        {
          skillName: 'valid',
        },
      ],
    });
  });

  it('normalizes onboarding completion timestamps from config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-onboarding-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await writeFile(paths.configFile, JSON.stringify({
      onboardingCompletedAt: '  2026-05-19T06:30:00.000Z  ',
    }, null, 2), 'utf8');

    await expect(readSkillIndexConfig(paths.configFile)).resolves.toMatchObject({
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
    });

    await writeFile(paths.configFile, JSON.stringify({
      onboardingCompletedAt: '   ',
    }, null, 2), 'utf8');

    await expect(readSkillIndexConfig(paths.configFile)).resolves.toMatchObject({
      onboardingCompletedAt: null,
    });
  });
});

describe('writeSkillIndexConfig', () => {
  it('persists a complete config file without leaving temp files behind', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-write-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });

    await writeSkillIndexConfig(paths.configFile, {
      ...defaultConfig,
      customScanPaths: ['/tmp/custom-skills'],
    });

    await expect(readSkillIndexConfig(paths.configFile)).resolves.toMatchObject({
      customScanPaths: ['/tmp/custom-skills'],
    });
    await expect(readdir(path.dirname(paths.configFile))).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^\.config\.json\..*\.tmp$/)]),
    );
  });
});

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
