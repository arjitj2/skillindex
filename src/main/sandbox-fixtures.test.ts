// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
});
