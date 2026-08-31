// @vitest-environment node

import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeSkillCanonical } from '@main/skill-canonicalization';
import { applyCapabilityAction } from '@main/capability-actions';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { resolveSkillIndexPaths, writeSkillIndexConfig } from '@shared/skill-index-paths';

describe('makeSkillCanonical', () => {
  it('rejects traversal-shaped plugin inventory names before any filesystem mutation', async () => {
    const root = await createRoot('skillindex-canonicalize-malicious-name-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const escapedPath = path.join(root, 'escape');

    await expect(makeSkillCanonical({ skillName: '../../../escape' }, {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    })).rejects.toThrow(/single safe skill package name/i);
    await expect(lstat(escapedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

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

  it('refuses non-plugin resolution when no active canonical Universal source exists', async () => {
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

    await expect(makeSkillCanonical(
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
    )).rejects.toThrow(/current writable Universal destination/i);
    await expect(lstat(path.join(homeDir, '.agents', 'skills', skillName))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(factoryPath).then((stats) => stats.isSymbolicLink())).resolves.toBe(false);
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

  it('copies selected plugin packages into Universal, keeps cache versions unchanged, and retargets links through the stable Universal path', async () => {
    const root = await createRoot('skillindex-canonicalize-plugin-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: root },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginPath = path.join(pluginRoot, 'skills', 'foo');
    const nextPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '2.0.0');
    const nextPluginPath = path.join(nextPluginRoot, 'skills', 'foo');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '1.0.0' }), 'utf8');
    await writeSkillFile(path.join(pluginPath, 'SKILL.md'), '# Plugin foo\n');
    await mkdir(path.join(pluginPath, 'assets'), { recursive: true });
    await writeFile(path.join(pluginPath, 'assets', 'payload.bin'), Buffer.from([0, 1, 2, 255]));
    await mkdir(path.join(nextPluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(nextPluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '2.0.0' }), 'utf8');
    await writeSkillFile(path.join(nextPluginPath, 'SKILL.md'), '# Plugin foo v2\n');
    await mkdir(path.join(nextPluginPath, 'assets'), { recursive: true });
    await writeFile(path.join(nextPluginPath, 'assets', 'payload.bin'), Buffer.from([255, 2, 1, 0]));
    await writeSkillFile(path.join(factoryPath, 'SKILL.md'), '# Factory foo\n');
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');
    const beforePluginSkill = await readFile(path.join(pluginPath, 'SKILL.md'));
    const beforePluginAsset = await readFile(path.join(pluginPath, 'assets', 'payload.bin'));
    const beforeNextPluginSkill = await readFile(path.join(nextPluginPath, 'SKILL.md'));
    const beforeNextPluginAsset = await readFile(path.join(nextPluginPath, 'assets', 'payload.bin'));

    const snapshot = await makeSkillCanonical({
      skillName: 'tools:foo',
      selectedVariantPath: pluginPath,
    }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(await readFile(path.join(universalPath, 'SKILL.md'))).toEqual(beforePluginSkill);
    expect(await readFile(path.join(universalPath, 'assets', 'payload.bin'))).toEqual(beforePluginAsset);
    expect(await readlink(factoryPath)).toBe(universalPath);
    expect(await realpath(factoryPath)).toBe(await realpath(universalPath));
    expect(await readFile(path.join(pluginPath, 'SKILL.md'))).toEqual(beforePluginSkill);
    expect(await readFile(path.join(pluginPath, 'assets', 'payload.bin'))).toEqual(beforePluginAsset);
    expect(snapshot.skills.find((skill) => skill.name === 'tools:foo')?.detailDiagnostics.universalDecision?.universal)
      .toMatchObject({ kind: 'path', sourceId: 'live-agents', path: universalPath });

    await makeSkillCanonical({
      skillName: 'tools:foo',
      selectedVariantPath: nextPluginPath,
    }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(await readFile(path.join(universalPath, 'SKILL.md'))).toEqual(beforeNextPluginSkill);
    expect(await readFile(path.join(universalPath, 'assets', 'payload.bin'))).toEqual(beforeNextPluginAsset);
    expect(await readlink(factoryPath)).toBe(universalPath);
    expect(await readFile(path.join(pluginPath, 'SKILL.md'))).toEqual(beforePluginSkill);
    expect(await readFile(path.join(pluginPath, 'assets', 'payload.bin'))).toEqual(beforePluginAsset);
    expect(await readFile(path.join(nextPluginPath, 'SKILL.md'))).toEqual(beforeNextPluginSkill);
    expect(await readFile(path.join(nextPluginPath, 'assets', 'payload.bin'))).toEqual(beforeNextPluginAsset);
  });

  it('rolls back the Universal package and every earlier link when a later link transaction fails', async () => {
    const root = await createRoot('skillindex-canonicalize-link-rollback-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, 'diverged-drift-skill');
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', 'diverged-drift-skill');
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', 'diverged-drift-skill');

    await seedRepresentativeFixtures({ paths });
    await writeSkillFile(path.join(factoryPath, 'SKILL.md'), '# Factory diverged skill\n');
    const beforeCanonical = await snapshotPath(canonicalPath);
    const beforeClaude = await snapshotPath(claudePath);
    const beforeFactory = await snapshotPath(factoryPath);

    await expect(makeSkillCanonical({
      skillName: 'diverged-drift-skill',
      selectedVariantPath: claudePath,
    }, {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      testFailSkillLinkAt: 2,
      writeCache: false,
    })).rejects.toThrow(/Injected skill link replacement failure at 2/i);

    await expect(snapshotPath(canonicalPath)).resolves.toEqual(beforeCanonical);
    await expect(snapshotPath(claudePath)).resolves.toEqual(beforeClaude);
    await expect(snapshotPath(factoryPath)).resolves.toEqual(beforeFactory);
  });

  it('does not duplicate a plugin-selected skill into its enabled native Claude skills directory', async () => {
    const root = await createRoot('skillindex-canonicalize-native-plugin-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root }, homeDir });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginPath = path.join(pluginRoot, 'skills', 'foo');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '1.0.0' }), 'utf8');
    await writeSkillFile(path.join(pluginPath, 'SKILL.md'), '# Plugin foo\n');
    await writeSkillFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'tools@official': true } }));
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    const beforePlugin = await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8');

    await makeSkillCanonical({ skillName: 'tools:foo', selectedVariantPath: pluginPath }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(await readFile(path.join(universalPath, 'SKILL.md'), 'utf8')).toBe(beforePlugin);
    expect(await readlink(factoryPath)).toBe(universalPath);
    await expect(lstat(claudePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8')).toBe(beforePlugin);
  });

  it('does materialize a selected plugin into Claude when only an unrelated Claude plugin is enabled', async () => {
    const root = await createRoot('skillindex-canonicalize-exact-native-plugin-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root }, homeDir });
    const alphaRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'alpha', '1.0.0');
    const betaRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'beta', '1.0.0');
    const alphaPath = path.join(alphaRoot, 'skills', 'foo');
    const betaPath = path.join(betaRoot, 'skills', 'foo');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'alpha:foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'alpha:foo');
    await Promise.all([
      mkdir(path.join(alphaRoot, '.claude-plugin'), { recursive: true }),
      mkdir(path.join(betaRoot, '.claude-plugin'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(alphaRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'alpha', version: '1.0.0' }), 'utf8'),
      writeFile(path.join(betaRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'beta', version: '1.0.0' }), 'utf8'),
      writeSkillFile(path.join(alphaPath, 'SKILL.md'), '# Alpha foo\n'),
      writeSkillFile(path.join(betaPath, 'SKILL.md'), '# Beta foo\n'),
      writeSkillFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'beta@official': true } })),
    ]);

    await makeSkillCanonical({ skillName: 'alpha:foo', selectedVariantPath: alphaPath }, {
      paths, homeDir, includeSandboxSources: false, includeLiveSources: true,
    });

    expect(await readlink(claudePath)).toBe(universalPath);
    expect(await readFile(path.join(universalPath, 'SKILL.md'), 'utf8')).toContain('Alpha foo');
  });

  it('rolls back Universal and links when persisting a plugin selection fails', async () => {
    const root = await createRoot('skillindex-canonicalize-persist-rollback-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root }, homeDir });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginPath = path.join(pluginRoot, 'skills', 'foo');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '1.0.0' }), 'utf8');
    await writeSkillFile(path.join(pluginPath, 'SKILL.md'), '# Plugin source\n');
    await writeSkillFile(path.join(universalPath, 'SKILL.md'), '# Universal sentinel\n');
    await writeSkillFile(path.join(factoryPath, 'SKILL.md'), '# Factory sentinel\n');
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [], preferredCanonicalSourcePath: null, dismissedDriftSignatures: [], dismissedMcpSignatures: [],
    });
    await writeFile(paths.cacheFile, 'cache-sentinel\n', 'utf8');
    const beforeUniversal = await snapshotPath(universalPath);
    const beforeFactory = await snapshotPath(factoryPath);
    const beforeConfig = await readFile(paths.configFile, 'utf8');
    const beforeCache = await readFile(paths.cacheFile, 'utf8');

    await expect(makeSkillCanonical({ skillName: 'tools:foo', selectedVariantPath: pluginPath }, {
      paths, homeDir, includeSandboxSources: false, includeLiveSources: true, writeCache: false,
      testFailSkillDecisionPersist: true,
    })).rejects.toThrow(/Injected skill Universal decision persistence failure/i);

    await expect(snapshotPath(universalPath)).resolves.toEqual(beforeUniversal);
    await expect(snapshotPath(factoryPath)).resolves.toEqual(beforeFactory);
    expect(await readFile(paths.configFile, 'utf8')).toBe(beforeConfig);
    expect(await readFile(paths.cacheFile, 'utf8')).toBe(beforeCache);
  });

  it('refuses a Universal directory symlinked into a plugin cache without mutating packages or state', async () => {
    const root = await createRoot('skillindex-canonicalize-plugin-target-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root }, homeDir });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginPath = path.join(pluginRoot, 'skills', 'foo');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '1.0.0' }), 'utf8');
    await writeSkillFile(path.join(pluginPath, 'SKILL.md'), '# Plugin foo\n');
    await mkdir(path.join(homeDir, '.agents'), { recursive: true });
    await symlink(path.join(pluginRoot, 'skills'), path.join(homeDir, '.agents', 'skills'));
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });
    await writeFile(paths.cacheFile, 'cache-sentinel\n', 'utf8');
    const beforePlugin = await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8');
    const beforeConfig = await readFile(paths.configFile, 'utf8');
    const beforeCache = await readFile(paths.cacheFile, 'utf8');

    await expect(applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'tools:foo',
      selectedVariantPath: pluginPath,
    }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
      writeCache: false,
    })).rejects.toThrow(/plugin-managed cache path/i);

    expect(await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8')).toBe(beforePlugin);
    expect(await readFile(paths.configFile, 'utf8')).toBe(beforeConfig);
    expect(await readFile(paths.cacheFile, 'utf8')).toBe(beforeCache);
    expect(await readlink(path.join(homeDir, '.agents', 'skills'))).toBe(path.join(pluginRoot, 'skills'));
    await expect(lstat(universalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a writable agent skills directory aliased into a plugin cache before staging Universal', async () => {
    const root = await createRoot('skillindex-canonicalize-plugin-agent-alias-');
    const homeDir = await createRoot('skillindex-live-home-');
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root }, homeDir });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginPath = path.join(pluginRoot, 'skills', 'foo');
    const factorySkillsDir = path.join(homeDir, '.factory', 'skills');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', version: '1.0.0' }), 'utf8');
    await writeSkillFile(path.join(pluginPath, 'SKILL.md'), '# Plugin foo\n');
    await writeSkillFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n');
    await symlink(path.join(pluginRoot, 'skills'), factorySkillsDir);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });
    await writeFile(paths.cacheFile, 'cache-sentinel\n', 'utf8');
    const beforePlugin = await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8');
    const beforeConfig = await readFile(paths.configFile, 'utf8');
    const beforeCache = await readFile(paths.cacheFile, 'utf8');

    await expect(makeSkillCanonical({ skillName: 'tools:foo', selectedVariantPath: pluginPath }, {
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
      writeCache: false,
    })).rejects.toThrow(/plugin-managed cache path/i);

    expect(await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8')).toBe(beforePlugin);
    expect(await readFile(paths.configFile, 'utf8')).toBe(beforeConfig);
    expect(await readFile(paths.cacheFile, 'utf8')).toBe(beforeCache);
    expect(await readlink(factorySkillsDir)).toBe(path.join(pluginRoot, 'skills'));
    await expect(lstat(universalPath)).rejects.toMatchObject({ code: 'ENOENT' });
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
