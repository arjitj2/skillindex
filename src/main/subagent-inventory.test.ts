// @vitest-environment node

import { lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveInventoryIssue } from '@main/issue-resolution';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { dismissSkillDrift, scanSkillInventory } from '@main/skill-inventory';
import {
  readPortableSubagentDefinitionFromFile,
  renderPortableSubagentDefinition,
} from '@main/subagent-inventory';
import { readSkillIndexConfig, resolveSandboxSkillIndexPaths, resolveSkillIndexPaths } from '@shared/skill-index-paths';

async function writeMarkdownSubagent(
  filePath: string,
  name: string,
  description: string,
  prompt: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    prompt,
    '',
  ].join('\n'), 'utf8');
}

async function writeCodexSubagent(
  filePath: string,
  name: string,
  description: string,
  prompt: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(prompt)}`,
    '',
  ].join('\n'), 'utf8');
}

async function writeRawFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function createSubagentTestPaths() {
  const root = await mkdtemp(path.join(tmpdir(), 'skillindex-subagents-'));
  const homeDir = path.join(root, 'home');
  const dataDir = path.join(root, 'data');
  const paths = resolveSkillIndexPaths({
    env: { SKILL_INDEX_DATA_DIR: dataDir },
    homeDir,
  });
  await mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await mkdir(path.join(homeDir, '.claude'), { recursive: true });

  return {
    homeDir,
    paths,
    scanOptions: {
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    },
  };
}

describe('subagent inventory', () => {
  it('normalizes Markdown and Codex TOML definitions and identifies duplicate Markdown copies', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'reviewer.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'reviewer.md');
    const codexPath = path.join(homeDir, '.codex', 'agents', 'reviewer.toml');

    await writeMarkdownSubagent(canonicalPath, 'reviewer', 'Reviews code changes.', 'Review the diff carefully.');
    await writeMarkdownSubagent(claudePath, 'reviewer', 'Reviews code changes.', 'Review the diff carefully.');
    await writeCodexSubagent(codexPath, 'reviewer', 'Reviews code changes.', 'Review the diff carefully.');

    const inventory = await scanSkillInventory(scanOptions);
    const reviewer = inventory.subagents?.find((subagent) => subagent.name === 'reviewer');

    expect(reviewer).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['identical-copies'],
    });
    expect(reviewer?.locations.map((location) => location.agentLabel).sort()).toEqual([
      'Claude Code',
      'Codex',
      'Live .agents',
    ]);
  });

  it('repairs subagent drift by symlinking Markdown agents and rendering Codex TOML', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'planner.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'planner.md');
    const codexPath = path.join(homeDir, '.codex', 'agents', 'planner.toml');

    await writeMarkdownSubagent(canonicalPath, 'planner', 'Plans implementation work.', 'Plan carefully.');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'missing-from-agents',
      selectedVariantPath: canonicalPath,
      subagentName: 'planner',
    }, scanOptions);

    const planner = repaired.subagents?.find((subagent) => subagent.name === 'planner');
    expect(planner?.issueReasons).not.toContain('missing-from-agents');
    expect((await lstat(claudePath)).isSymbolicLink()).toBe(true);
    expect(await realpath(claudePath)).toBe(await realpath(canonicalPath));
    expect(await readFile(codexPath, 'utf8')).toContain('developer_instructions = "Plan carefully."');
  });

  it('promotes a discovered subagent into the universal agents directory', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'deployer.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'deployer.md');

    await writeMarkdownSubagent(claudePath, 'deployer', 'Handles deployment rollout checks.', 'Check rollout safety.');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'missing-universal',
      selectedVariantPath: claudePath,
      subagentName: 'deployer',
    }, scanOptions);

    const deployer = repaired.subagents?.find((subagent) => subagent.name === 'deployer');
    expect(deployer?.issueReasons).not.toContain('missing-universal');
    expect(deployer?.issueReasons).not.toContain('identical-copies');
    expect(await readFile(canonicalPath, 'utf8')).toContain('Check rollout safety.');
    expect((await lstat(claudePath)).isSymbolicLink()).toBe(true);
    expect(await realpath(claudePath)).toBe(await realpath(canonicalPath));
  });

  it('applies documented required fields per Markdown subagent family', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();

    await writeRawFile(path.join(homeDir, '.copilot', 'agents', 'copilot-reviewer.agent.md'), [
      '---',
      'description: Reviews pull request changes.',
      '---',
      'Review the current pull request.',
      '',
    ].join('\n'));
    await writeRawFile(path.join(homeDir, '.augment', 'agents', 'augment-planner.md'), [
      '---',
      'name: augment-planner',
      '---',
      'Plan the task.',
      '',
    ].join('\n'));
    await writeRawFile(path.join(homeDir, '.mux', 'agents', 'mux-runner.md'), [
      '---',
      'name: mux-runner',
      'subagent.runnable: true',
      '---',
      'Run delegated work.',
      '',
    ].join('\n'));
    await writeRawFile(path.join(homeDir, '.claude', 'agents', 'missing-description.md'), [
      '---',
      'name: missing-description',
      '---',
      'This Claude subagent is missing its required description.',
      '',
    ].join('\n'));

    const inventory = await scanSkillInventory(scanOptions);
    const copilot = inventory.subagents?.find((subagent) => subagent.name === 'copilot-reviewer');
    const augment = inventory.subagents?.find((subagent) => subagent.name === 'augment-planner');
    const mux = inventory.subagents?.find((subagent) => subagent.name === 'mux-runner');
    const claude = inventory.subagents?.find((subagent) => subagent.name === 'missing-description');

    expect(copilot?.issueReasons).not.toContain('invalid-definition');
    expect(augment?.issueReasons).not.toContain('invalid-definition');
    expect(mux?.issueReasons).not.toContain('invalid-definition');
    expect(claude?.issueReasons).toContain('invalid-definition');
    expect(claude?.locations[0]?.invalidDetails).toContain('Missing required field: description');
  });

  it('groups symlinks by link filename so wrong subagent targets are visible', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const reviewerPath = path.join(homeDir, '.agents', 'agents', 'reviewer.md');
    const plannerPath = path.join(homeDir, '.agents', 'agents', 'planner.md');
    const claudeReviewerPath = path.join(homeDir, '.claude', 'agents', 'reviewer.md');

    await writeMarkdownSubagent(reviewerPath, 'reviewer', 'Reviews code.', 'Review the diff.');
    await writeMarkdownSubagent(plannerPath, 'planner', 'Plans work.', 'Plan the change.');
    await mkdir(path.dirname(claudeReviewerPath), { recursive: true });
    await symlink(plannerPath, claudeReviewerPath);

    const inventory = await scanSkillInventory(scanOptions);
    const reviewer = inventory.subagents?.find((subagent) => subagent.name === 'reviewer');

    expect(reviewer?.issueReasons).toContain('wrong-symlink-target');
    expect(reviewer?.issueReasons).not.toContain('definition-mismatch');
    expect(inventory.subagents?.find((subagent) => subagent.name === 'planner')?.locations)
      .toHaveLength(1);

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'wrong-symlink-target',
      selectedVariantPath: reviewerPath,
      subagentName: 'reviewer',
    }, scanOptions);
    const repairedReviewer = repaired.subagents?.find((subagent) => subagent.name === 'reviewer');

    expect(repairedReviewer?.issueReasons).not.toContain('wrong-symlink-target');
    expect(await realpath(claudeReviewerPath)).toBe(await realpath(reviewerPath));
  });

  it('reports broken subagent symlinks without hiding them behind invalid-definition', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'broken-link.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'broken-link.md');

    await writeMarkdownSubagent(canonicalPath, 'broken-link', 'Covers broken symlink repair.', 'Repair safely.');
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(path.join(homeDir, '.agents', 'agents', 'missing-target.md'), claudePath);

    const inventory = await scanSkillInventory(scanOptions);
    const brokenLink = inventory.subagents?.find((subagent) => subagent.name === 'broken-link');

    expect(brokenLink?.issueReasons).toContain('broken-symlink');
    expect(brokenLink?.issueReasons).not.toContain('invalid-definition');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'broken-symlink',
      selectedVariantPath: canonicalPath,
      subagentName: 'broken-link',
    }, scanOptions);
    const repairedBrokenLink = repaired.subagents?.find((subagent) => subagent.name === 'broken-link');

    expect(repairedBrokenLink?.issueReasons).not.toContain('broken-symlink');
    expect(await realpath(claudePath)).toBe(await realpath(canonicalPath));
  });

  it('rejects symlink paths as selected subagent definitions', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'reviewer.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'reviewer.md');
    const codexPath = path.join(homeDir, '.codex', 'agents', 'reviewer.toml');

    await writeMarkdownSubagent(canonicalPath, 'reviewer', 'Reviews code.', 'Use canonical review rules.');
    await writeCodexSubagent(codexPath, 'reviewer', 'Reviews code differently.', 'Use Codex review rules.');
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(canonicalPath, claudePath);

    await expect(resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      selectedVariantPath: claudePath,
      subagentName: 'reviewer',
    }, scanOptions)).rejects.toThrow('Choose one of the available subagent definitions before resolving this issue.');
  });

  it('renders markdown subagents with incompatible required fields as materialized copies', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'mux-runner.md');
    const muxPath = path.join(homeDir, '.mux', 'agents', 'mux-runner.md');

    await mkdir(path.dirname(muxPath), { recursive: true });
    await writeMarkdownSubagent(canonicalPath, 'mux-runner', 'Runs delegated work.', 'Run the delegated task.');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'missing-from-agents',
      selectedVariantPath: canonicalPath,
      subagentName: 'mux-runner',
    }, scanOptions);
    const repairedMuxRunner = repaired.subagents?.find((subagent) => subagent.name === 'mux-runner');
    const muxContent = await readFile(muxPath, 'utf8');

    expect((await lstat(muxPath)).isSymbolicLink()).toBe(false);
    expect(muxContent).toContain('subagent.runnable: true');
    expect(repairedMuxRunner?.locations.find((location) => location.path === muxPath)?.invalidDetails).toBeUndefined();
  });

  it('ignores local-only subagent fields when comparing portable definitions', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'mux-runner.md');
    const muxPath = path.join(homeDir, '.mux', 'agents', 'mux-runner.md');

    await writeMarkdownSubagent(canonicalPath, 'mux-runner', 'Runs delegated work.', 'Run the delegated task.');
    await writeRawFile(muxPath, [
      '---',
      'name: mux-runner',
      'description: Runs delegated work.',
      'subagent.runnable: true',
      '---',
      'Run the delegated task.',
      '',
    ].join('\n'));

    const inventory = await scanSkillInventory(scanOptions);
    const muxRunner = inventory.subagents?.find((subagent) => subagent.name === 'mux-runner');

    expect(muxRunner?.issueReasons).not.toContain('definition-mismatch');
    expect(muxRunner?.issueReasons).not.toContain('identical-copies');
  });

  it('blocks subagent resolution across mixed inventory scopes', async () => {
    const { homeDir, paths } = await createSubagentTestPaths();
    const livePath = path.join(homeDir, '.agents', 'agents', 'scope-split.md');
    const sandboxPath = path.join(paths.sandboxRoot, '.agents', 'agents', 'scope-split.md');
    const scanOptions = {
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: true,
    };

    await writeMarkdownSubagent(livePath, 'scope-split', 'Live definition.', 'Use live behavior.');
    await writeMarkdownSubagent(sandboxPath, 'scope-split', 'Sandbox definition.', 'Use sandbox behavior.');

    await expect(resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      selectedVariantPath: livePath,
      subagentName: 'scope-split',
    }, scanOptions)).rejects.toThrow('Subagent resolution currently requires every affected location to stay within one scope.');
  });

  it('reads Codex multiline TOML instructions before promoting to the universal directory', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const codexPath = path.join(homeDir, '.codex', 'agents', 'release-planner.toml');
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'release-planner.md');

    await writeRawFile(codexPath, [
      'name = "release-planner"',
      'description = "Plans release rollouts."',
      'developer_instructions = """',
      'Check staged rollout health.',
      'Verify rollback ownership.',
      '"""',
      '',
    ].join('\n'));

    await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'missing-universal',
      selectedVariantPath: codexPath,
      subagentName: 'release-planner',
    }, scanOptions);

    const canonicalContent = await readFile(canonicalPath, 'utf8');
    expect(canonicalContent).toContain('Check staged rollout health.');
    expect(canonicalContent).toContain('Verify rollback ownership.');
  });

  it('marks generic TOML subagents invalid when required prompt metadata is missing', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const vibePath = path.join(homeDir, '.vibe', 'agents', 'bare.toml');

    await writeRawFile(vibePath, [
      'agent_type = "subagent"',
      'name = "bare"',
      '',
    ].join('\n'));

    const inventory = await scanSkillInventory(scanOptions);
    const bare = inventory.subagents?.find((subagent) => subagent.name === 'bare');

    expect(bare?.issueReasons).toContain('invalid-definition');
    expect(bare?.locations[0]?.invalidDetails).toEqual(expect.arrayContaining([
      'Missing required field: description',
      'Missing required field: instructions',
    ]));
  });

  it('keeps plugin subagents namespaced and promotes them without overwriting local names', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const localPath = path.join(homeDir, '.agents', 'agents', 'reviewer.md');
    const pluginPath = path.join(
      homeDir,
      '.codex',
      'plugins',
      'cache',
      'sandbox-curated',
      'github-tools',
      'abc123',
      'agents',
      'reviewer.md',
    );
    const manifestPath = path.join(
      homeDir,
      '.codex',
      'plugins',
      'cache',
      'sandbox-curated',
      'github-tools',
      'abc123',
      '.codex-plugin',
      'plugin.json',
    );

    await writeMarkdownSubagent(localPath, 'reviewer', 'Local review helper.', 'Use local review rules.');
    await writeMarkdownSubagent(pluginPath, 'reviewer', 'Plugin review helper.', 'Use plugin review rules.');
    await writeRawFile(manifestPath, `${JSON.stringify({ name: 'github-tools', version: 'abc123' }, null, 2)}\n`);

    const inventory = await scanSkillInventory(scanOptions);
    const localReviewer = inventory.subagents?.find((subagent) => subagent.name === 'reviewer');
    const pluginReviewer = inventory.subagents?.find((subagent) => subagent.name === 'github-tools:reviewer');

    expect(localReviewer?.locations.some((location) => location.provenance?.kind === 'plugin')).toBe(false);
    expect(pluginReviewer?.displayName).toBe('reviewer');
    expect(pluginReviewer?.issueReasons).toContain('missing-universal');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'missing-universal',
      selectedVariantPath: pluginPath,
      subagentName: 'github-tools:reviewer',
    }, scanOptions);
    const repairedPlugin = repaired.subagents?.find((subagent) => subagent.name === 'github-tools:reviewer');

    expect(repairedPlugin?.issueReasons).not.toContain('missing-universal');
    expect(repairedPlugin?.issueReasons).not.toContain('definition-mismatch');
    const universalDefinition = await readFile(path.join(homeDir, '.agents', 'agents', 'github-tools-reviewer.md'), 'utf8');
    expect(universalDefinition).toContain('name: "reviewer"');
    expect(universalDefinition).not.toContain('github-tools:reviewer');
    expect(await readFile(localPath, 'utf8')).toContain('Local review helper.');
  });

  it('repairs legacy plugin subagent Universal files without keeping the scoped name in frontmatter', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const universalPath = path.join(homeDir, '.agents', 'agents', 'github-tools-reviewer.md');
    const pluginPath = path.join(
      homeDir,
      '.codex',
      'plugins',
      'cache',
      'sandbox-curated',
      'github-tools',
      'abc123',
      'agents',
      'reviewer.md',
    );
    const manifestPath = path.join(
      homeDir,
      '.codex',
      'plugins',
      'cache',
      'sandbox-curated',
      'github-tools',
      'abc123',
      '.codex-plugin',
      'plugin.json',
    );

    await writeMarkdownSubagent(universalPath, 'github-tools:reviewer', 'Plugin review helper.', 'Use plugin review rules.');
    await writeMarkdownSubagent(pluginPath, 'reviewer', 'Plugin review helper.', 'Use plugin review rules.');
    await writeRawFile(manifestPath, `${JSON.stringify({ name: 'github-tools', version: 'abc123' }, null, 2)}\n`);

    const inventory = await scanSkillInventory(scanOptions);
    expect(inventory.subagents?.find((subagent) => subagent.name === 'github-tools:reviewer')?.issueReasons)
      .toContain('definition-mismatch');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      selectedVariantPath: pluginPath,
      subagentName: 'github-tools:reviewer',
    }, scanOptions);
    const repairedPlugin = repaired.subagents?.find((subagent) => subagent.name === 'github-tools:reviewer');
    const universalDefinition = await readFile(universalPath, 'utf8');

    expect(repairedPlugin?.issueReasons).not.toContain('definition-mismatch');
    expect(repairedPlugin?.issueReasons).not.toContain('missing-universal');
    expect(universalDefinition).toContain('name: "reviewer"');
    expect(universalDefinition).not.toContain('github-tools:reviewer');
  });

  it('requires an explicit definition choice for ambiguous subagent mismatch repair', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'ambiguous.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'ambiguous.md');

    await writeMarkdownSubagent(canonicalPath, 'ambiguous', 'Canonical description.', 'Use canonical behavior.');
    await writeMarkdownSubagent(claudePath, 'ambiguous', 'Claude description.', 'Use Claude behavior.');

    await expect(resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      subagentName: 'ambiguous',
    }, scanOptions)).rejects.toThrow('Choose a subagent definition before resolving this issue.');

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      selectedVariantPath: canonicalPath,
      subagentName: 'ambiguous',
    }, scanOptions);
    const ambiguous = repaired.subagents?.find((subagent) => subagent.name === 'ambiguous');

    expect(ambiguous?.issueReasons).not.toContain('definition-mismatch');
    expect((await lstat(claudePath)).isSymbolicLink()).toBe(true);
    expect(await realpath(claudePath)).toBe(await realpath(canonicalPath));
  });

  it('dismisses and undismisses attention subagents by signature', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'quiet-planner.md');

    await writeMarkdownSubagent(canonicalPath, 'quiet-planner', 'Plans quietly.', 'Prepare the implementation plan.');

    const inventory = await scanSkillInventory(scanOptions);
    const initialSubagent = inventory.subagents?.find((subagent) => subagent.name === 'quiet-planner');
    expect(initialSubagent).toMatchObject({
      status: 'needs-attention',
      presentation: 'active',
    });
    expect(initialSubagent?.signature).toBeDefined();

    const dismissedSnapshot = await dismissSkillDrift({ subagentName: 'quiet-planner' }, {
      ...scanOptions,
      snapshot: inventory,
    });
    const dismissedSubagent = dismissedSnapshot.subagents?.find((subagent) => subagent.name === 'quiet-planner');
    expect(dismissedSubagent).toMatchObject({
      status: 'needs-attention',
      presentation: 'dismissed',
    });
    expect(dismissedSnapshot.subagentCounts?.dismissedAttentionSubagents).toBe(1);

    const configAfterDismiss = await readSkillIndexConfig(scanOptions.paths.configFile, { homeDir });
    expect(configAfterDismiss.dismissedSubagentSignatures).toContain(initialSubagent?.signature);

    const restoredSnapshot = await dismissSkillDrift({ subagentName: 'quiet-planner' }, {
      ...scanOptions,
      snapshot: dismissedSnapshot,
    });
    expect(restoredSnapshot.subagents?.find((subagent) => subagent.name === 'quiet-planner')?.presentation).toBe('active');

    const configAfterRestore = await readSkillIndexConfig(scanOptions.paths.configFile, { homeDir });
    expect(configAfterRestore.dismissedSubagentSignatures).not.toContain(initialSubagent?.signature);
  });

  it('seeds representative sandbox subagents across documented issue combinations', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-subagents-sandbox-'));
    const homeDir = path.join(root, 'home');
    const rootPaths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: path.join(root, 'data') },
      homeDir,
    });
    const sandboxPaths = resolveSandboxSkillIndexPaths({ paths: rootPaths });

    await seedRepresentativeFixtures({ paths: rootPaths, homeDir });

    const inventory = await scanSkillInventory({
      paths: sandboxPaths,
      homeDir,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const byName = new Map((inventory.subagents ?? []).map((subagent) => [subagent.name, subagent]));

    expect(byName.get('healthy-subagent')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      presentation: 'none',
    });
    expect(byName.get('missing-from-agents-subagent')?.issueReasons).toEqual(['missing-from-agents']);
    expect(byName.get('dismissed-subagent')).toMatchObject({
      issueReasons: ['missing-from-agents'],
      presentation: 'dismissed',
    });
    expect(byName.get('missing-universal-claude-subagent')?.issueReasons).toEqual(['missing-universal']);
    expect(byName.get('missing-universal-codex-subagent')?.issueReasons).toEqual(['missing-universal']);
    expect(byName.get('identical-copies-subagent')?.issueReasons).toEqual(['identical-copies']);
    expect(byName.get('definition-mismatch-subagent')?.issueReasons).toEqual(['definition-mismatch']);
    expect(byName.get('broken-symlink-subagent')?.issueReasons).toEqual(expect.arrayContaining(['broken-symlink']));
    expect(byName.get('wrong-symlink-target-subagent')?.issueReasons)
      .toEqual(expect.arrayContaining(['wrong-symlink-target']));
    expect(byName.get('wrong-symlink-target-subagent')?.issueReasons)
      .not.toContain('definition-mismatch');
    expect(byName.get('invalid-universal-subagent')?.issueReasons)
      .toEqual(expect.arrayContaining(['invalid-definition', 'missing-from-agents']));
    expect(byName.get('invalid-definition-subagent')?.issueReasons)
      .toEqual(expect.arrayContaining(['invalid-definition', 'missing-universal']));
    expect(byName.get('multi-mismatch-missing-subagent')?.issueReasons)
      .toEqual(expect.arrayContaining(['definition-mismatch', 'missing-from-agents']));
    expect(byName.get('multi-identical-missing-subagent')?.issueReasons)
      .toEqual(expect.arrayContaining(['identical-copies', 'missing-from-agents']));
    expect(byName.get('multi-broken-missing-subagent')?.issueReasons)
      .toEqual(expect.arrayContaining(['broken-symlink', 'missing-from-agents']));
    expect(byName.get('multi-broken-missing-subagent')?.issueReasons)
      .not.toContain('definition-mismatch');
    expect(byName.get('sandbox-plugin-pack:deployment-expert')?.issueReasons).toEqual(['missing-universal']);
    expect(inventory.subagentCounts).toMatchObject({
      dismissedAttentionSubagents: 1,
    });
    expect(inventory.subagentCounts?.totalSubagents ?? 0).toBeGreaterThanOrEqual(16);
  });

  it('resolves sandbox subagent definition mismatches without filling missing agent targets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-subagents-sandbox-resolution-'));
    const homeDir = path.join(root, 'home');
    const rootPaths = resolveSkillIndexPaths({
      env: { SKILL_INDEX_DATA_DIR: path.join(root, 'data') },
      homeDir,
    });
    const sandboxPaths = resolveSandboxSkillIndexPaths({ paths: rootPaths });
    const scanOptions = {
      paths: sandboxPaths,
      homeDir,
      includeSandboxSources: true,
      includeLiveSources: false,
    };
    const subagentName = 'multi-mismatch-missing-subagent';
    const canonicalPath = path.join(rootPaths.sandboxRoot, '.agents', 'agents', `${subagentName}.md`);
    const claudePath = path.join(rootPaths.sandboxRoot, '.claude', 'agents', `${subagentName}.md`);

    await seedRepresentativeFixtures({ paths: rootPaths, homeDir });

    const before = await scanSkillInventory(scanOptions);
    const beforeSubagent = before.subagents?.find((subagent) => subagent.name === subagentName);
    expect(beforeSubagent?.issueReasons).toEqual(expect.arrayContaining(['definition-mismatch', 'missing-from-agents']));
    expect(beforeSubagent?.missingLocations ?? []).not.toHaveLength(0);

    const resolved = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      selectedVariantPath: claudePath,
      subagentName,
    }, scanOptions);
    const resolvedSubagent = resolved.subagents?.find((subagent) => subagent.name === subagentName);

    expect(await readFile(canonicalPath, 'utf8')).toContain('Use the Claude-local multi-issue behavior.');
    expect(resolvedSubagent?.issueReasons).not.toContain('definition-mismatch');
    expect(resolvedSubagent?.issueReasons).toContain('missing-from-agents');
    expect(resolvedSubagent?.missingLocations ?? []).not.toHaveLength(0);
  });

  it('preserves local-only Markdown fields when resolving subagent mismatches', async () => {
    const { homeDir, scanOptions } = await createSubagentTestPaths();
    const canonicalPath = path.join(homeDir, '.agents', 'agents', 'colored-reviewer.md');
    const claudePath = path.join(homeDir, '.claude', 'agents', 'colored-reviewer.md');

    await writeMarkdownSubagent(canonicalPath, 'colored-reviewer', 'Reviews code with color metadata.', 'Use canonical behavior.');
    await writeRawFile(claudePath, [
      '---',
      'name: colored-reviewer',
      'description: Reviews code with color metadata.',
      'color: blue',
      '---',
      'Use Claude-local behavior.',
      '',
    ].join('\n'));

    const before = await scanSkillInventory(scanOptions);
    const beforeSubagent = before.subagents?.find((subagent) => subagent.name === 'colored-reviewer');
    expect(beforeSubagent?.issueReasons).toContain('definition-mismatch');
    expect(beforeSubagent?.locations.find((location) => location.path === claudePath)?.localExtrasKeys).toEqual(['color']);

    const repaired = await resolveInventoryIssue({
      entity: 'subagent',
      issue: 'definition-mismatch',
      selectedVariantPath: canonicalPath,
      subagentName: 'colored-reviewer',
    }, scanOptions);
    const repairedSubagent = repaired.subagents?.find((subagent) => subagent.name === 'colored-reviewer');
    const claudeContent = await readFile(claudePath, 'utf8');

    expect((await lstat(claudePath)).isSymbolicLink()).toBe(false);
    expect(claudeContent).toContain('color: "blue"');
    expect(claudeContent).toContain('Use canonical behavior.');
    expect(repairedSubagent?.issueReasons).not.toContain('definition-mismatch');
    expect(repairedSubagent?.issueReasons).not.toContain('identical-copies');
  });

  it('round-trips documented JSON, JSONC, generic TOML, Codex TOML, and YAML subagent formats', async () => {
    const { homeDir } = await createSubagentTestPaths();
    const markdownPath = path.join(homeDir, '.agents', 'agents', 'format-matrix.md');
    const yamlPath = path.join(homeDir, '.agents', 'agents', 'format-matrix.yaml');

    await writeMarkdownSubagent(markdownPath, 'format-matrix', 'Exercises supported renderers.', 'Render every format.');

    const portable = readPortableSubagentDefinitionFromFile({
      filePath: markdownPath,
      format: 'markdown-frontmatter',
    });

    expect(renderPortableSubagentDefinition(portable, 'json')).toContain('"prompt": "Render every format."');
    expect(renderPortableSubagentDefinition(portable, 'jsonc')).toContain('"prompt": "Render every format."');
    expect(renderPortableSubagentDefinition(portable, 'toml')).toContain('agent_type = "subagent"');
    expect(renderPortableSubagentDefinition(portable, 'toml')).toContain('instructions = "Render every format."');
    expect(renderPortableSubagentDefinition(portable, 'codex-toml')).toContain('developer_instructions = "Render every format."');
    expect(renderPortableSubagentDefinition(portable, 'yaml')).toContain('prompt: "Render every format."');

    await writeRawFile(yamlPath, renderPortableSubagentDefinition(portable, 'yaml'));
    expect(readPortableSubagentDefinitionFromFile({
      filePath: yamlPath,
      format: 'yaml',
    })).toMatchObject({
      name: 'format-matrix',
      description: 'Exercises supported renderers.',
      prompt: 'Render every format.',
    });
  });

  it('reads YAML block prompt strings and local list metadata', async () => {
    const { homeDir } = await createSubagentTestPaths();
    const yamlPath = path.join(homeDir, '.agents', 'agents', 'yaml-block.yaml');

    await writeRawFile(yamlPath, [
      'name: yaml-block',
      'description: Reads YAML block strings.',
      'tools:',
      '  - read',
      '  - write',
      'prompt: |',
      '  Read YAML carefully.',
      '  Preserve block content.',
      '',
    ].join('\n'));

    expect(readPortableSubagentDefinitionFromFile({
      filePath: yamlPath,
      format: 'yaml',
    })).toMatchObject({
      name: 'yaml-block',
      description: 'Reads YAML block strings.',
      prompt: 'Read YAML carefully.\nPreserve block content.',
      extras: {
        tools: ['read', 'write'],
      },
    });
  });
});
