import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/skill-index-paths', async () => {
  const actual = await vi.importActual<typeof import('@shared/skill-index-paths')>('@shared/skill-index-paths');

  return {
    ...actual,
    readSkillIndexConfig: vi.fn(actual.readSkillIndexConfig),
    writeSkillIndexConfig: vi.fn(actual.writeSkillIndexConfig),
  };
});

import {
  ensureSkillIndexLayout,
  readSkillIndexConfig,
  resolveSkillIndexPaths,
  writeSkillIndexConfig,
  type SkillIndexConfig,
} from '@shared/skill-index-paths';

import { scanSkillInventory } from './skill-inventory';

describe('dismissed drift config remediation', () => {
  it('re-reads the latest config before pruning dismissed drift signatures so newer custom paths survive', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-config-remediation-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const staleConfig: SkillIndexConfig = {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
      onboardingCompletedAt: null,
      dismissedDriftSignatures: ['stale-dismissed-signature'],
      dismissedMcpSignatures: [],
      dismissedSubagentSignatures: [],
    };
    const latestConfig: SkillIndexConfig = {
      customScanPaths: [path.join(root, 'custom-skills')],
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
      onboardingCompletedAt: null,
      dismissedDriftSignatures: ['stale-dismissed-signature'],
      dismissedMcpSignatures: ['dismissed-mcp-signature'],
      dismissedSubagentSignatures: ['dismissed-subagent-signature'],
    };
    const mockedReadSkillIndexConfig = vi.mocked(readSkillIndexConfig);
    const mockedWriteSkillIndexConfig = vi.mocked(writeSkillIndexConfig);

    await ensureSkillIndexLayout(paths);
    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'healthy-skill', '# Healthy skill\n');
    await writeFile(paths.configFile, `${JSON.stringify(latestConfig, null, 2)}\n`, 'utf8');

    mockedReadSkillIndexConfig.mockClear();
    mockedWriteSkillIndexConfig.mockClear();
    mockedReadSkillIndexConfig
      .mockResolvedValueOnce(staleConfig)
      .mockResolvedValueOnce(latestConfig);

    const snapshot = await scanSkillInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.counts.dismissedDriftSkills).toBe(0);
    expect(mockedReadSkillIndexConfig).toHaveBeenCalledTimes(2);
    await expect(readFileJson(paths.configFile)).resolves.toEqual({
      ...latestConfig,
      dismissedDriftSignatures: [],
    });
  });
});

async function writeSkillFile(rootDir: string, skillName: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, skillName, 'SKILL.md');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function readFileJson(filePath: string): Promise<SkillIndexConfig> {
  return JSON.parse(await readFile(filePath, 'utf8')) as SkillIndexConfig;
}
