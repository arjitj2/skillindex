// @vitest-environment node

import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeSkillCanonical } from '@main/skill-canonicalization';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { resolveSkillIndexPaths, writeSkillIndexConfig } from '@shared/skill-index-paths';

describe('makeSkillCanonical', () => {
  it('requires explicit source selection for diverged skills, writes the chosen content to sandbox .agents, and repairs duplicates into symlinks', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, 'diverged-drift-skill');
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', 'diverged-drift-skill');
    const claudeEntrypoint = path.join(claudePath, 'SKILL.md');

    await seedRepresentativeFixtures({ paths });

    await expect(
      makeSkillCanonical(
        {
          skillName: 'diverged-drift-skill',
        },
        {
          paths,
          includeSandboxSources: true,
          includeLiveSources: false,
        },
      ),
    ).rejects.toThrow(/Choose a skill version/i);

    const selectedContent = await readFile(claudeEntrypoint, 'utf8');
    const snapshot = await makeSkillCanonical(
      {
        skillName: 'diverged-drift-skill',
        selectedVariantPath: claudePath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    const resolvedSkill = snapshot.skills.find((skill) => skill.name === 'diverged-drift-skill');

    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(selectedContent);
    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(resolvedSkill).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
    await expect(readFile(paths.cacheFile, 'utf8')).resolves.toContain('"name": "diverged-drift-skill"');
  });

  it('auto-resolves identical drift by reusing the existing canonical file and symlinking the remaining non-universal copy', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, 'identical-drift-skill');
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'identical-drift-skill');

    await seedRepresentativeFixtures({ paths });
    const beforeContent = await readFile(canonicalEntrypoint, 'utf8');

    const snapshot = await makeSkillCanonical(
      {
        skillName: 'identical-drift-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(beforeContent);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(snapshot.skills.find((skill) => skill.name === 'identical-drift-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('keeps a configured preferred source canonical and rewrites duplicate live copies to it', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const preferredSkillsDir = path.join(homeDir, 'preferred-skills');
    const skillName = 'preferred-duplicate-skill';
    const agentsPath = path.join(homeDir, '.agents', 'skills', skillName);
    const preferredPath = path.join(preferredSkillsDir, skillName);
    const skillContent = [
      '---',
      `name: ${skillName}`,
      'description: Duplicate outside agent-derived locations.',
      '---',
      '',
      '# Preferred duplicate skill',
      '',
    ].join('\n');

    await Promise.all([
      writeSkillFile(path.join(agentsPath, 'SKILL.md'), skillContent),
      writeSkillFile(path.join(preferredPath, 'SKILL.md'), skillContent),
    ]);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: preferredSkillsDir,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    await makeSkillCanonical(
      {
        skillName,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readFile(path.join(preferredPath, 'SKILL.md'), 'utf8')).toBe(skillContent);
    expect(await readlink(agentsPath)).toBe(preferredPath);
  });

  it('reuses the existing canonical file when it is explicitly selected and only rewrites the duplicate copies', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, 'diagnostic-rich-skill');
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', 'diagnostic-rich-skill');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'diagnostic-rich-skill');

    await seedRepresentativeFixtures({ paths });
    const beforeContent = await readFile(canonicalEntrypoint, 'utf8');

    await makeSkillCanonical(
      {
        skillName: 'diagnostic-rich-skill',
        selectedVariantPath: canonicalPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(beforeContent);
    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
  });

  it('repairs a mispointed non-universal symlink when the sandbox canonical file is already the only real copy', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, 'healthy-skill');
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'healthy-skill');
    const wrongTargetPath = path.join(paths.sandboxRoot, '.windsurf', 'skills', 'single-source-skill');

    await seedRepresentativeFixtures({ paths });
    const beforeContent = await readFile(canonicalEntrypoint, 'utf8');
    await rm(factoryPath, { force: true });
    await symlink(wrongTargetPath, factoryPath);

    const snapshot = await makeSkillCanonical(
      {
        skillName: 'healthy-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(beforeContent);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(snapshot.skills.find((skill) => skill.name === 'healthy-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('repairs a broken non-universal symlink when the sandbox canonical file is already the only real copy', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, 'healthy-skill');
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'healthy-skill');
    const brokenTargetPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'missing-skill');

    await seedRepresentativeFixtures({ paths });
    const beforeContent = await readFile(canonicalEntrypoint, 'utf8');
    await rm(factoryPath, { force: true });
    await symlink(brokenTargetPath, factoryPath);

    const snapshot = await makeSkillCanonical(
      {
        skillName: 'healthy-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(beforeContent);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(snapshot.skills.find((skill) => skill.name === 'healthy-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('leaves representative live directories unchanged when live sources are excluded', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const liveAgentsPath = path.join(homeDir, '.agents', 'skills', 'diverged-drift-skill');
    const liveClaudePath = path.join(homeDir, '.claude', 'skills', 'diverged-drift-skill');
    const liveFactoryPath = path.join(homeDir, '.factory', 'skills', 'diverged-drift-skill');
    const selectedVariantPath = path.join(paths.sandboxRoot, '.claude', 'skills', 'diverged-drift-skill');

    await seedRepresentativeFixtures({ paths });
    await Promise.all([
      writeSkillFile(path.join(liveAgentsPath, 'SKILL.md'), '# Live agents copy\n'),
      writeSkillFile(path.join(liveClaudePath, 'SKILL.md'), '# Live claude copy\n'),
      writeSkillFile(path.join(liveFactoryPath, 'SKILL.md'), '# Live factory copy\n'),
    ]);
    const beforeSnapshots = await Promise.all([
      snapshotPath(liveAgentsPath),
      snapshotPath(liveClaudePath),
      snapshotPath(liveFactoryPath),
    ]);

    await makeSkillCanonical(
      {
        skillName: 'diverged-drift-skill',
        selectedVariantPath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    await expect(Promise.all([snapshotPath(liveAgentsPath), snapshotPath(liveClaudePath), snapshotPath(liveFactoryPath)])).resolves.toEqual(
      beforeSnapshots,
    );
  });

  it('fails instead of inventing a live canonical directory when no canonical source is installed', async () => {
    const root = await createRoot('skillindex-canonicalize-live-missing-canonical-');
    const homeDir = path.join(root, 'home');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: path.join(root, 'data'),
      },
      homeDir,
    });
    const skillName = 'live-no-canonical-skill';
    const claudePath = path.join(homeDir, '.claude', 'skills', skillName);
    const claudeEntrypoint = path.join(claudePath, 'SKILL.md');
    const factoryPath = path.join(homeDir, '.factory', 'skills', skillName);

    await Promise.all([
      writeSkillFile(claudeEntrypoint, [
        '---',
        `name: ${skillName}`,
        'description: Claude live copy.',
        '---',
        '',
        '# Live skill',
        'Claude version wins.',
        '',
      ].join('\n')),
      writeSkillFile(path.join(factoryPath, 'SKILL.md'), [
        '---',
        `name: ${skillName}`,
        'description: Factory live copy.',
        '---',
        '',
        '# Live skill',
        'Factory version conflicts.',
        '',
      ].join('\n')),
      writeSkillFile(path.join(homeDir, '.claude', 'settings.json'), '{}\n'),
      writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n'),
    ]);

    await expect(
      makeSkillCanonical(
        {
          skillName,
          selectedVariantPath: claudePath,
        },
        {
          paths,
          homeDir,
          includeSandboxSources: false,
          includeLiveSources: true,
        },
      ),
    ).rejects.toThrow(`Unable to locate the canonical live skills directory for "${skillName}".`);
  });

  it('creates the canonical package in the live shared directory and rewrites live installs into symlinks', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'live-diverged-skill';
    const canonicalPath = path.join(homeDir, '.agents', 'skills', skillName);
    const canonicalEntrypoint = path.join(canonicalPath, 'SKILL.md');
    const claudePath = path.join(homeDir, '.claude', 'skills', skillName);
    const claudeEntrypoint = path.join(claudePath, 'SKILL.md');
    const factoryPath = path.join(homeDir, '.factory', 'skills', skillName);

    await mkdir(path.join(homeDir, '.agents', 'skills'), { recursive: true });
    await Promise.all([
      writeSkillFile(claudeEntrypoint, [
        '---',
        `name: ${skillName}`,
        'description: Claude live copy.',
        '---',
        '',
        '# Live diverged skill',
        'Claude version wins.',
        '',
      ].join('\n')),
      writeSkillFile(path.join(factoryPath, 'SKILL.md'), [
        '---',
        `name: ${skillName}`,
        'description: Factory live copy.',
        '---',
        '',
        '# Live diverged skill',
        'Factory version conflicts.',
        '',
      ].join('\n')),
      writeSkillFile(path.join(homeDir, '.claude', 'settings.json'), '{}\n'),
      writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n'),
    ]);

    const selectedContent = await readFile(claudeEntrypoint, 'utf8');
    const snapshot = await makeSkillCanonical(
      {
        skillName,
        selectedVariantPath: claudePath,
      },
      {
        paths,
        homeDir,
        includeSandboxSources: false,
        includeLiveSources: true,
      },
    );

    expect(await readFile(canonicalEntrypoint, 'utf8')).toBe(selectedContent);
    expect(await readlink(claudePath)).toBe(canonicalPath);
    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(snapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
  });

  it('persists non-plugin Universal choices against the final canonical package path', async () => {
    const root = await createRoot('skillindex-canonicalize-');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const skillName = 'example-workflow-kit:handoff-notes-with-two-statics';
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);

    await seedRepresentativeFixtures({ paths });

    const snapshot = await makeSkillCanonical(
      {
        skillName,
        selectedVariantPath: factoryPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(await readlink(factoryPath)).toBe(canonicalPath);
    const resolvedSkill = snapshot.skills.find((skill) => skill.name === skillName);
    expect(resolvedSkill?.detailDiagnostics.universalDecision?.universal).toMatchObject({
      kind: 'path',
      sourceId: 'sandbox-agents',
      path: canonicalPath,
    });
  });
});

async function createRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function writeSkillFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function snapshotPath(filePath: string): Promise<{ fileType: 'real-file' | 'symlink'; content: string; target?: string }> {
  const stats = await lstat(filePath);
  const contentPath = filePath.endsWith('SKILL.md') ? filePath : path.join(filePath, 'SKILL.md');
  if (stats.isSymbolicLink()) {
    return {
      fileType: 'symlink',
      target: await readlink(filePath),
      content: await readFile(contentPath, 'utf8'),
    };
  }

  return {
    fileType: 'real-file',
    content: await readFile(contentPath, 'utf8'),
  };
}
