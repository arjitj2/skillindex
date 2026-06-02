import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { addSkill } from '@main/add-skill';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

const createdRoots: string[] = [];

describe('addSkill', () => {
  afterEach(async () => {
    await Promise.all(createdRoots.splice(0, createdRoots.length).map((root) =>
      rm(root, { recursive: true, force: true })));
  });

  it('creates a canonical markdown skill package and symlinks installed sandbox agents to it', async () => {
    const paths = await createSandboxPaths();
    await Promise.all([
      mkdir(path.join(paths.sandboxRoot, '.claude'), { recursive: true }),
      mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true }),
    ]);

    const snapshot = await addSkill({
      sourceType: 'markdown',
      skillName: 'my-skill-name',
      markdown: '# my-skill\n\nUse this skill.\n',
    }, {
      includeSandboxSources: true,
      includeLiveSources: false,
      paths,
      homeDir: path.dirname(paths.dataDir),
    });

    const canonicalDir = path.join(paths.sandboxAgentsSkillsDir, 'my-skill-name');
    const claudeDir = path.join(paths.sandboxRoot, '.claude', 'skills', 'my-skill-name');
    const factoryDir = path.join(paths.sandboxRoot, '.factory', 'skills', 'my-skill-name');

    await expect(readFile(path.join(canonicalDir, 'SKILL.md'), 'utf8')).resolves.toBe('# my-skill\n\nUse this skill.\n');
    await expect(readlink(claudeDir)).resolves.toBe(canonicalDir);
    await expect(readlink(factoryDir)).resolves.toBe(canonicalDir);
    expect(snapshot.skills.some((skill) => skill.name === 'my-skill-name')).toBe(true);
  });

  it('delegates URL-backed sandbox installs to the skills CLI using the sandbox home', async () => {
    const paths = await createSandboxPaths();
    await Promise.all([
      mkdir(path.join(paths.sandboxRoot, '.claude'), { recursive: true }),
      mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true }),
    ]);
    const calls: Array<{ source: string; home: string | undefined; cwd: string; scope: string }> = [];

    await addSkill({
      sourceType: 'url',
      source: 'https://github.com/example/repo',
    }, {
      includeSandboxSources: true,
      includeLiveSources: false,
      paths,
      homeDir: path.dirname(paths.dataDir),
      runSkillsAdd: async (source, environment) => {
        calls.push({
          source,
          home: environment.env.HOME,
          cwd: environment.cwd,
          scope: environment.scope,
        });
        const packageDir = path.join(environment.env.HOME ?? paths.sandboxRoot, '.agents', 'skills', '.system', 'internal-skill');
        await mkdir(path.join(packageDir, 'docs'), { recursive: true });
        await writeFile(path.join(packageDir, 'SKILL.md'), '---\nname: internal-skill\ndescription: Internal skill\n---\n');
        await writeFile(path.join(packageDir, 'docs', 'guide.md'), '# Guide\n');
        await mkdir(path.dirname(path.join(paths.sandboxRoot, '.claude', 'skills', '.system', 'internal-skill')), { recursive: true });
        await mkdir(path.dirname(path.join(paths.sandboxRoot, '.factory', 'skills', '.system', 'internal-skill')), { recursive: true });
        await symlink(packageDir, path.join(paths.sandboxRoot, '.claude', 'skills', '.system', 'internal-skill'));
        await symlink(packageDir, path.join(paths.sandboxRoot, '.factory', 'skills', '.system', 'internal-skill'));
      },
    });

    const canonicalDir = path.join(paths.sandboxAgentsSkillsDir, '.system', 'internal-skill');
    const claudeDir = path.join(paths.sandboxRoot, '.claude', 'skills', '.system', 'internal-skill');
    const factoryDir = path.join(paths.sandboxRoot, '.factory', 'skills', '.system', 'internal-skill');

    expect(calls).toEqual([{
      source: 'https://github.com/example/repo',
      home: paths.sandboxRoot,
      cwd: paths.sandboxRoot,
      scope: 'sandbox',
    }]);
    await expect(readFile(path.join(canonicalDir, 'SKILL.md'), 'utf8')).resolves.toContain('name: internal-skill');
    await expect(readFile(path.join(canonicalDir, 'docs', 'guide.md'), 'utf8')).resolves.toBe('# Guide\n');
    await expect(readlink(claudeDir)).resolves.toBe(canonicalDir);
    await expect(readlink(factoryDir)).resolves.toBe(canonicalDir);
    const canonicalStats = await lstat(canonicalDir);
    expect(canonicalStats.isDirectory()).toBe(true);
  });

  it('delegates URL-backed live installs to the skills CLI using the live home', async () => {
    const paths = await createSandboxPaths();
    const liveHome = await mkdtemp(path.join(tmpdir(), 'skillindex-live-home-'));
    createdRoots.push(liveHome);
    const calls: Array<{ source: string; home: string | undefined }> = [];

    await addSkill({
      sourceType: 'url',
      source: 'https://github.com/example/live-repo',
    }, {
      includeSandboxSources: false,
      includeLiveSources: true,
      paths,
      homeDir: liveHome,
      runSkillsAdd: async (source, environment) => {
        calls.push({ source, home: environment.env.HOME });
        const packageDir = path.join(liveHome, '.agents', 'skills', 'live-skill');
        await mkdir(packageDir, { recursive: true });
        await writeFile(path.join(packageDir, 'SKILL.md'), '---\nname: live-skill\ndescription: Live skill\n---\n');
      },
    });

    expect(calls).toEqual([{ source: 'https://github.com/example/live-repo', home: liveHome }]);
    await expect(readFile(path.join(liveHome, '.agents', 'skills', 'live-skill', 'SKILL.md'), 'utf8')).resolves.toContain('name: live-skill');
  });

  it('fails instead of treating an uninspectable install path as available', async () => {
    const paths = await createSandboxPaths();
    const blockedSkillPath = path.join(paths.sandboxAgentsSkillsDir, 'blocked-skill');
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    await expect(addSkill({
      sourceType: 'markdown',
      skillName: 'blocked-skill',
      markdown: '# blocked-skill\n\nUse this skill.\n',
    }, {
      includeSandboxSources: true,
      includeLiveSources: false,
      paths,
      homeDir: path.dirname(paths.dataDir),
      inspectInstallPath: async (targetPath) => {
        if (targetPath === blockedSkillPath) {
          throw permissionError;
        }

        return lstat(targetPath);
      },
    })).rejects.toThrow(`Failed to inspect skill install path ${blockedSkillPath}: permission denied`);
  });
});

async function createSandboxPaths() {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'skillindex-add-skill-test-'));
  createdRoots.push(dataRoot);
  return resolveSkillIndexPaths({
    env: {
      ...process.env,
      SKILL_INDEX_DATA_DIR: dataRoot,
    },
    homeDir: path.dirname(dataRoot),
  });
}
