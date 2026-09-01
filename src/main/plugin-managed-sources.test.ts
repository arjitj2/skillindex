// @vitest-environment node

import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertSkillSourceAndDestinationDoNotOverlap,
  assertSkillSymlinkTargetIsUniversal,
  annotateComparableVersionEvidence,
  buildPluginManagedSourceCandidate,
  detectPluginDependencyWarnings,
  getOperationalLocations,
  isAgentSatisfiedByNativePlugin,
  isPluginManagedTarget,
} from '@main/plugin-managed-sources';
import { replaceSkillLinksTransaction } from '@main/skill-link-transaction';
import { readSkillInventoryCache } from '@main/skill-inventory';
import type { SkillInventorySnapshot } from '@shared/contracts';

describe('plugin managed sources', () => {
  it('excludes managed-source locations from operational locations', () => {
    const locations = [
      { path: '/home/.agents/skills/foo', canonicalRole: 'canonical' as const },
      { path: '/home/.config/skills/foo', canonicalRole: 'materialized-copy' as const },
      { path: '/home/.codex/plugins/cache/tools/1.0.0/skills/foo', canonicalRole: 'managed-source' as const },
    ];

    expect(getOperationalLocations(locations)).toEqual(locations.slice(0, 2));
  });

  it('assigns evidence and universal relationship for plugin candidates', () => {
    const plugin = {
      host: 'codex' as const,
      pluginId: 'tools@official',
      pluginName: 'tools',
      version: '1.0.0',
      rootPath: '/cache/tools/1.0.0',
      enabled: true as const,
    };

    expect(buildPluginManagedSourceCandidate({
      path: '/cache/tools/1.0.0/skills/foo',
      plugin,
      comparisonKey: 'old',
      universalComparisonKey: null,
      dependencyWarnings: [],
    })).toMatchObject({ evidence: 'enabled-installation', relationship: 'universal-missing' });
    expect(buildPluginManagedSourceCandidate({
      path: '/cache/tools/1.0.0/skills/foo',
      plugin: { ...plugin, enabled: false },
      comparisonKey: 'same',
      universalComparisonKey: 'same',
      dependencyWarnings: [],
    })).toMatchObject({ evidence: 'cached-unknown', relationship: 'matches-universal' });
    expect(buildPluginManagedSourceCandidate({
      path: '/cache/tools/1.0.0/skills/foo',
      plugin: { ...plugin, enabled: 'unknown' },
      comparisonKey: 'new',
      universalComparisonKey: 'old',
      dependencyWarnings: [],
    })).toMatchObject({ evidence: 'cached-unknown', relationship: 'differs-from-universal' });
  });

  it('reports plugin dependency warnings in deterministic order', () => {
    const providerSpecificFields = ['timeout', 'startup_timeout_ms'];
    const warnings = detectPluginDependencyWarnings({
      text: 'node ${CODEX_PLUGIN_ROOT}/server.js /cache/tools/1.0.0/data.json',
      pluginRoot: '/cache/tools/1.0.0',
      providerSpecificFields,
    });

    expect(warnings).toEqual([
      { kind: 'plugin-root-variable', detail: 'References a plugin-root environment variable.' },
      { kind: 'plugin-contained-path', detail: 'References a path inside /cache/tools/1.0.0.' },
      { kind: 'provider-specific-field', detail: 'Uses provider-specific fields: startup_timeout_ms, timeout.' },
    ]);
    expect(providerSpecificFields).toEqual(['timeout', 'startup_timeout_ms']);
  });

  it('recognizes both plugin root variables', () => {
    expect(detectPluginDependencyWarnings({
      text: '${CLAUDE_PLUGIN_ROOT}/server.js',
      pluginRoot: '/cache/tools',
    })).toEqual([{
      kind: 'plugin-root-variable',
      detail: 'References a plugin-root environment variable.',
    }]);
  });

  it('satisfies an agent only with an enabled native plugin for its family', () => {
    const plugins = [
      { host: 'codex' as const, enabled: true as const },
      { host: 'claude' as const, enabled: false as const },
    ];

    expect(isAgentSatisfiedByNativePlugin('codex', plugins)).toBe(true);
    expect(isAgentSatisfiedByNativePlugin('claude', plugins)).toBe(false);
    expect(isAgentSatisfiedByNativePlugin(undefined, plugins)).toBe(false);
  });

  it('recognizes plugin-managed targets with a path-separator boundary', () => {
    const sources = [{ kind: 'plugin' as const, skillsDir: '/cache/tools/skills' }];

    expect(isPluginManagedTarget('/', [{ kind: 'plugin', skillsDir: '/' }])).toBe(true);
    expect(isPluginManagedTarget('/child', [{ kind: 'plugin', skillsDir: '/' }])).toBe(true);
    expect(isPluginManagedTarget('/cache/tools/skills', sources)).toBe(true);
    expect(isPluginManagedTarget(path.join('/cache/tools/skills', 'foo'), sources)).toBe(true);
    expect(isPluginManagedTarget('/cache/tools/skills-other/foo', sources)).toBe(false);
    expect(isPluginManagedTarget('/cache/other/skills/foo', sources)).toBe(false);
    expect(isPluginManagedTarget('/cache/tools/skills/../other', sources)).toBe(false);
    expect(isPluginManagedTarget('/cache/tools/skills', [{ kind: 'agent', skillsDir: '/cache/tools/skills' }])).toBe(false);
  });

  it('rejects a plugin-managed target at the symlink creation boundary', async () => {
    const sources = [{ kind: 'plugin' as const, skillsDir: '/cache/tools/skills' }];

    await expect(assertSkillSymlinkTargetIsUniversal('/cache/tools/skills/foo', sources))
      .rejects.toThrow(/must target a writable Universal skill package/i);
    await expect(assertSkillSymlinkTargetIsUniversal('/home/.agents/skills/foo', sources)).resolves.toBeUndefined();
  });

  it('rejects a Universal path whose existing parent symlinks into a plugin cache', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-managed-target-'));
    const pluginSkills = path.join(root, 'plugin-cache', 'skills');
    const universalSkills = path.join(root, '.agents', 'skills');
    await mkdir(pluginSkills, { recursive: true });
    await mkdir(path.dirname(universalSkills), { recursive: true });
    await symlink(pluginSkills, universalSkills);

    await expect(assertSkillSymlinkTargetIsUniversal(path.join(universalSkills, 'foo'), [{
      kind: 'plugin',
      skillsDir: pluginSkills,
    }])).rejects.toThrow(/must target a writable Universal skill package/i);
  });

  it('rejects selected-source and Universal destination aliases before a package swap', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-source-destination-alias-'));
    const realSkills = path.join(root, 'real-skills');
    const sourcePath = path.join(realSkills, 'foo');
    const aliasedUniversalSkills = path.join(root, '.agents', 'skills');
    await mkdir(sourcePath, { recursive: true });
    await writeFile(path.join(sourcePath, 'SKILL.md'), '# Foo\n', 'utf8');
    await mkdir(path.dirname(aliasedUniversalSkills), { recursive: true });
    await symlink(realSkills, aliasedUniversalSkills);

    await expect(assertSkillSourceAndDestinationDoNotOverlap(
      sourcePath,
      path.join(aliasedUniversalSkills, 'foo'),
    )).rejects.toThrow(/must not overlap/i);
  });

  it('enforces the plugin-target rejection immediately before a skill symlink is created', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-link-boundary-'));
    const pluginSkills = path.join(root, 'plugin-cache', 'skills');
    const pluginSkill = path.join(pluginSkills, 'foo');
    const linkPath = path.join(root, '.factory', 'skills', 'foo');
    await mkdir(pluginSkill, { recursive: true });
    await writeFile(path.join(pluginSkill, 'SKILL.md'), '# Foo\n', 'utf8');

    await expect(replaceSkillLinksTransaction([linkPath], pluginSkill, [{
      id: 'plugin-test',
      label: 'Plugin test',
      canonical: false,
      kind: 'plugin',
      writable: false,
      scope: 'live',
      skillsDir: pluginSkills,
    }])).rejects.toThrow(/must target a writable Universal skill package/i);
    await expect(lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('revalidates every writable link destination immediately before mutation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-link-validator-'));
    const canonicalPath = path.join(root, '.agents', 'skills', 'foo');
    const firstPath = path.join(root, '.factory', 'skills', 'foo');
    const secondPath = path.join(root, '.windsurf', 'skills', 'foo');
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(path.join(canonicalPath, 'SKILL.md'), '# Foo\n', 'utf8');
    const validated: string[] = [];

    const transaction = await replaceSkillLinksTransaction([firstPath, secondPath], canonicalPath, [], {
      validateDestination: (locationPath) => {
        validated.push(locationPath);
        return Promise.resolve();
      },
    });
    expect(validated).toEqual([firstPath, secondPath]);
    await transaction.rollback();
    await expect(lstat(firstPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(secondPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a writable link path that aliases the canonical package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-link-alias-'));
    const universalSkills = path.join(root, '.agents', 'skills');
    const canonicalPath = path.join(universalSkills, 'foo');
    const factorySkills = path.join(root, '.factory', 'skills');
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(path.join(canonicalPath, 'SKILL.md'), '# Universal\n', 'utf8');
    await mkdir(path.dirname(factorySkills), { recursive: true });
    await symlink(universalSkills, factorySkills);
    await expect(replaceSkillLinksTransaction([path.join(factorySkills, 'foo')], canonicalPath, []))
      .rejects.toThrow(/must not overlap/i);
    expect(await readFile(path.join(canonicalPath, 'SKILL.md'), 'utf8')).toBe('# Universal\n');
  });

  it('attempts every rollback restore and surfaces restore failures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-link-restore-failure-'));
    const canonicalPath = path.join(root, '.agents', 'skills', 'foo');
    const firstPath = path.join(root, '.factory', 'skills', 'foo');
    const secondPath = path.join(root, '.windsurf', 'skills', 'foo');
    await Promise.all([
      mkdir(canonicalPath, { recursive: true }),
      mkdir(firstPath, { recursive: true }),
      mkdir(secondPath, { recursive: true }),
    ]);
    await Promise.all([writeFile(path.join(canonicalPath, 'SKILL.md'), '# Canonical\n'), writeFile(path.join(firstPath, 'SKILL.md'), '# First\n'), writeFile(path.join(secondPath, 'SKILL.md'), '# Second\n')]);
    const transaction = await replaceSkillLinksTransaction([firstPath, secondPath], canonicalPath, [], { failRestoreAt: 1 });
    await expect(transaction.rollback()).rejects.toBeInstanceOf(AggregateError);
    expect(await readFile(path.join(firstPath, 'SKILL.md'), 'utf8')).toBe('# First\n');
  });

  it('preserves the initiating replacement failure when rollback also fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-link-error-composition-'));
    const canonicalPath = path.join(root, '.agents', 'skills', 'foo');
    const firstPath = path.join(root, '.factory', 'skills', 'foo');
    const secondPath = path.join(root, '.windsurf', 'skills', 'foo');
    await Promise.all([mkdir(canonicalPath, { recursive: true }), mkdir(firstPath, { recursive: true }), mkdir(secondPath, { recursive: true })]);
    await Promise.all([writeFile(path.join(canonicalPath, 'SKILL.md'), '# Canonical\n'), writeFile(path.join(firstPath, 'SKILL.md'), '# First\n'), writeFile(path.join(secondPath, 'SKILL.md'), '# Second\n')]);
    const failure = await replaceSkillLinksTransaction([firstPath, secondPath], canonicalPath, [], {
      failAt: 2,
      failRestoreAt: 1,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as AggregateError).errors.map((error) => String(error));
    expect(errors.join('\n')).toContain('Injected skill link replacement failure at 2');
    const rollbackFailure = (failure as AggregateError).errors[1] as AggregateError;
    expect(rollbackFailure.errors.map((error) => String(error)).join('\n'))
      .toContain('Injected skill link restore failure at 1');
  });

  it('does not infer recency from comparable cached versions when none is enabled', () => {
    const candidates = [
      { version: '1.0.0', evidence: 'cached-unknown' as const },
      { version: '1.10.0', evidence: 'cached-unknown' as const },
      { version: '1.2.0', evidence: 'cached-unknown' as const },
    ];

    expect(annotateComparableVersionEvidence(candidates)).toEqual([
      candidates[0],
      { version: '1.10.0', evidence: 'cached-unknown' },
      candidates[2],
    ]);
    expect(candidates[1].evidence).toBe('cached-unknown');
  });

  it('leaves mixed version families and enabled evidence untouched', () => {
    const mixed = [
      { version: 'd6169bef', evidence: 'cached-unknown' as const },
      { version: '0.21.4', evidence: 'cached-unknown' as const },
    ];
    const enabled = [
      { version: '1.0.0', evidence: 'cached-unknown' as const },
      { version: '2.0.0', evidence: 'enabled-installation' as const },
    ];

    expect(annotateComparableVersionEvidence(mixed)).toEqual(mixed);
    expect(annotateComparableVersionEvidence(enabled)).toEqual(enabled);
  });

  it('downgrades ambiguous plugin-id enablement when multiple cached versions look enabled', () => {
    const ambiguous = [
      { version: '1.0.0', evidence: 'enabled-installation' as const },
      { version: '1.1.0', evidence: 'enabled-installation' as const },
    ];
    const unambiguous = [
      { version: '1.0.0', evidence: 'enabled-installation' as const },
    ];

    expect(annotateComparableVersionEvidence(ambiguous)).toEqual([
      { version: '1.0.0', evidence: 'cached-unknown' },
      { version: '1.1.0', evidence: 'cached-unknown' },
    ]);
    expect(annotateComparableVersionEvidence(unambiguous)).toEqual(unambiguous);
  });

  it('requires strict core semver, handles huge values safely, and does not label ties or singletons', () => {
    const singleton = [{ version: '1.0.0', evidence: 'cached-unknown' as const }];
    const leadingZero = [
      { version: '01.0.0', evidence: 'cached-unknown' as const },
      { version: '2.0.0', evidence: 'cached-unknown' as const },
    ];
    const huge = [
      { version: '9007199254740992.0.0', evidence: 'cached-unknown' as const },
      { version: '9007199254740991.99.99', evidence: 'cached-unknown' as const },
    ];
    const tied = [
      { version: '2.0.0', evidence: 'cached-unknown' as const },
      { version: '2.0.0', evidence: 'cached-unknown' as const },
    ];
    const tiedReordered = [
      { version: '1.0.0', evidence: 'cached-unknown' as const },
      { version: '2.0.0', evidence: 'cached-unknown' as const },
      { version: '2.0.0', evidence: 'cached-unknown' as const },
    ];

    expect(annotateComparableVersionEvidence(singleton)).toEqual(singleton);
    expect(annotateComparableVersionEvidence(leadingZero)).toEqual(leadingZero);
    expect(annotateComparableVersionEvidence(huge)).toEqual([
      huge[0],
      huge[1],
    ]);
    expect(annotateComparableVersionEvidence(tied)).toEqual(tied);
    expect(annotateComparableVersionEvidence(tiedReordered)).toEqual(tiedReordered);
    const tiedReorderedReverse = [...tiedReordered].reverse();
    expect(annotateComparableVersionEvidence(tiedReorderedReverse)).toEqual(tiedReorderedReverse);
  });

  it('requires dependency variable and path boundaries', () => {
    expect(detectPluginDependencyWarnings({
      text: '${CODEX_PLUGIN_ROOTED}/x $CLAUDE_PLUGIN_ROOTed/y',
      pluginRoot: '/cache/tools/1.0.0',
    })).toEqual([]);
    expect(detectPluginDependencyWarnings({
      text: '$CODEX_PLUGIN_ROOT/x ${CLAUDE_PLUGIN_ROOT}/y /cache/tools/1.0.01/data',
      pluginRoot: '/cache/tools/1.0.0',
    }).map((warning) => warning.kind)).toEqual(['plugin-root-variable']);
    expect(detectPluginDependencyWarnings({
      text: '/cache/tools/1.0.0/data',
      pluginRoot: '',
    })).toEqual([]);
    expect(detectPluginDependencyWarnings({
      text: '/other/cache/tools/1.0.0/data',
      pluginRoot: '/cache/tools/1.0.0',
    })).toEqual([]);
    expect(detectPluginDependencyWarnings({
      text: '/cache/tools/1.0.0-backup/data /cache/tools/1.0.0.old/data',
      pluginRoot: '/cache/tools/1.0.0',
    })).toEqual([]);
    expect(detectPluginDependencyWarnings({
      text: '"/cache/tools/1.0.0"',
      pluginRoot: '/cache/tools/1.0.0',
    }).map((warning) => warning.kind)).toEqual(['plugin-contained-path']);
  });

  it('round-trips managed-source records and rejects malformed managed metadata in cache', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-managed-cache-'));
    const cachePath = path.join(root, 'inventory.json');
    const plugin = {
      host: 'codex' as const,
      pluginId: 'tools@official',
      pluginName: 'tools',
      version: '1.0.0',
      rootPath: '/cache/tools/1.0.0',
      enabled: true as const,
    };
    const candidate = {
      path: '/cache/tools/1.0.0/skills/foo',
      plugin,
      evidence: 'enabled-installation' as const,
      relationship: 'universal-missing' as const,
      dependencyWarnings: [{ kind: 'plugin-root-variable' as const, detail: 'warning' }],
    };
    const snapshot: SkillInventorySnapshot = {
      scannedAt: '2026-08-31T00:00:00.000Z',
      sourceIds: ['plugin-source'],
      sources: [{
        id: 'plugin-source',
        label: 'Tools',
        canonical: false,
        kind: 'plugin',
        writable: false,
        scope: 'live',
        skillsDir: '/cache/tools/1.0.0/skills',
        plugin,
      }],
      plugins: [{
        ...plugin,
        bundledSkills: [{ name: 'foo', path: candidate.path, entrypointPath: `${candidate.path}/SKILL.md`, sourceId: 'plugin-source' }],
        bundledMcps: [],
      }],
      skills: [{
        name: 'foo',
        structuralState: 'single-source-noncanonical',
        isDrifted: true,
        driftPresentation: 'active',
        locations: [{
          path: candidate.path,
          sourceId: 'plugin-source',
          sourceLabel: 'Tools',
          sourceScope: 'live',
          fileType: 'real-file',
          modifiedAt: '2026-08-31T00:00:00.000Z',
          canonical: false,
          canonicalRole: 'managed-source',
        }],
        detailDiagnostics: { duplicateCandidates: [], installSources: [] },
        managedSourceCandidates: [candidate],
      }],
      counts: {
        totalSkills: 1,
        driftedSkills: 1,
        healthySkills: 0,
        singleSourceSkills: 1,
        identicalDriftSkills: 0,
        divergedDriftSkills: 0,
        dismissedDriftSkills: 0,
      },
      mcps: [{
        name: 'foo-server',
        status: 'healthy',
        presentation: 'none',
        locations: [{
          agentId: 'plugin-source',
          agentLabel: 'Tools',
          scope: 'live',
          configPath: '/cache/tools/1.0.0/.mcp.json',
          args: [],
          canonicalRole: 'managed-source',
        }],
        issueReasons: [],
        managedSourceCandidates: [candidate],
      }],
      mcpCounts: { totalMcps: 1, attentionMcps: 0, healthyMcps: 1, dismissedAttentionMcps: 0 },
      subagents: [{
        name: 'foo-agent',
        status: 'healthy',
        presentation: 'none',
        locations: [{
          agentId: 'plugin-source',
          agentLabel: 'Tools',
          scope: 'live',
          path: '/cache/tools/1.0.0/agents/foo.md',
          directoryPath: '/cache/tools/1.0.0/agents',
          fileType: 'real-file',
          modifiedAt: '2026-08-31T00:00:00.000Z',
          canonical: false,
          format: 'markdown-frontmatter',
          canonicalRole: 'managed-source',
        }],
        issueReasons: [],
        managedSourceCandidates: [candidate],
      }],
      subagentCounts: { totalSubagents: 1, attentionSubagents: 0, healthySubagents: 1, dismissedAttentionSubagents: 0 },
    };

    await writeFile(cachePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    await expect(readSkillInventoryCache(cachePath)).resolves.toEqual(snapshot);

    const malformed = structuredClone(snapshot) as unknown as Record<string, unknown>;
    const malformedSkills = malformed.skills as Array<Record<string, unknown>>;
    malformedSkills[0] = {
      ...malformedSkills[0],
      managedSourceCandidates: [{ ...candidate, evidence: 'not-valid' }],
    };
    await writeFile(cachePath, `${JSON.stringify(malformed)}\n`, 'utf8');
    await expect(readSkillInventoryCache(cachePath)).resolves.toBeNull();
  });
});
