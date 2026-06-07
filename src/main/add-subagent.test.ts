import { lstat, mkdir, mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { addSubagent } from '@main/add-subagent';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

const createdRoots: string[] = [];

describe('addSubagent', () => {
  afterEach(async () => {
    await Promise.all(createdRoots.splice(0, createdRoots.length).map((root) =>
      rm(root, { recursive: true, force: true })));
  });

  it('creates a universal markdown subagent and installs supported sandbox agent copies', async () => {
    const paths = await createSandboxPaths();
    await Promise.all([
      mkdir(path.join(paths.sandboxRoot, '.claude'), { recursive: true }),
      mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true }),
      mkdir(path.join(paths.sandboxRoot, '.dbt', 'wizard'), { recursive: true }),
      mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true }),
    ]);

    const snapshot = await addSubagent({
      sourceType: 'fields',
      name: 'reviewer',
      description: 'Reviews implementation changes.',
      prompt: 'Review the diff and call out correctness risks.',
    }, {
      includeSandboxSources: true,
      includeLiveSources: false,
      paths,
      homeDir: path.dirname(paths.dataDir),
    });

    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'agents', 'reviewer.md');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'agents', 'reviewer.md');
    const codexPath = path.join(paths.sandboxRoot, '.codex', 'agents', 'reviewer.toml');
    const dbtWizardPath = path.join(paths.sandboxRoot, '.dbt', 'wizard', 'agents', 'reviewer.toml');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'droids', 'reviewer.md');

    await expect(readFile(canonicalPath, 'utf8')).resolves.toContain('description: "Reviews implementation changes."');
    await expect(readlink(claudePath)).resolves.toBe(canonicalPath);
    await expect(readlink(factoryPath)).resolves.toBe(canonicalPath);
    await expect(readFile(codexPath, 'utf8')).resolves.toContain('developer_instructions = "Review the diff and call out correctness risks."');
    await expect(readFile(dbtWizardPath, 'utf8')).resolves.toContain('developer_instructions = "Review the diff and call out correctness risks."');
    expect((await lstat(codexPath)).isFile()).toBe(true);
    expect((await lstat(dbtWizardPath)).isFile()).toBe(true);
    expect(snapshot.subagents?.some((subagent) => subagent.name === 'reviewer')).toBe(true);
  });

  it('parses pasted Codex TOML definitions before installing them', async () => {
    const paths = await createSandboxPaths();
    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });

    const snapshot = await addSubagent({
      sourceType: 'definition',
      name: 'fallback-reviewer',
      format: 'codex-toml',
      definition: [
        'name = "codex-reviewer"',
        'description = "Reviews Codex changes."',
        'developer_instructions = "Use Codex-specific review guidance."',
        '',
      ].join('\n'),
    }, {
      includeSandboxSources: true,
      includeLiveSources: false,
      paths,
      homeDir: path.dirname(paths.dataDir),
    });

    const canonicalPath = path.join(paths.sandboxRoot, '.agents', 'agents', 'codex-reviewer.md');
    await expect(readFile(canonicalPath, 'utf8')).resolves.toContain('Use Codex-specific review guidance.');
    expect(snapshot.subagents?.some((subagent) => subagent.name === 'codex-reviewer')).toBe(true);
  });

  it('fails instead of treating an uninspectable install path as available', async () => {
    const paths = await createSandboxPaths();
    const canonicalSubagentsDir = path.join(path.dirname(paths.sandboxCanonicalUserSkillsDir), 'agents');
    const blockedSubagentPath = path.join(canonicalSubagentsDir, 'blocked-reviewer.md');
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    await expect(addSubagent({
      sourceType: 'fields',
      name: 'blocked-reviewer',
      description: 'Reviews blocked paths.',
      prompt: 'Review blocked paths.',
    }, {
      includeSandboxSources: true,
      includeLiveSources: false,
      paths,
      homeDir: path.dirname(paths.dataDir),
      inspectInstallPath: async (targetPath) => {
        if (targetPath === blockedSubagentPath) {
          throw permissionError;
        }

        return lstat(targetPath);
      },
    })).rejects.toThrow(`Failed to inspect subagent install path ${blockedSubagentPath}: permission denied`);
  });
});

async function createSandboxPaths() {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'skillindex-add-subagent-test-'));
  createdRoots.push(dataRoot);
  return resolveSkillIndexPaths({
    env: {
      ...process.env,
      SKILL_INDEX_DATA_DIR: dataRoot,
    },
    homeDir: path.dirname(dataRoot),
  });
}
