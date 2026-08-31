// @vitest-environment node

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  annotateComparableVersionEvidence,
  buildPluginManagedSourceCandidate,
  detectPluginDependencyWarnings,
  getOperationalLocations,
  isAgentSatisfiedByNativePlugin,
  isPluginManagedTarget,
} from '@main/plugin-managed-sources';

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

    expect(isPluginManagedTarget('/cache/tools/skills', sources)).toBe(true);
    expect(isPluginManagedTarget(path.join('/cache/tools/skills', 'foo'), sources)).toBe(true);
    expect(isPluginManagedTarget('/cache/tools/skills-other/foo', sources)).toBe(false);
    expect(isPluginManagedTarget('/cache/other/skills/foo', sources)).toBe(false);
    expect(isPluginManagedTarget('/cache/tools/skills', [{ kind: 'agent', skillsDir: '/cache/tools/skills' }])).toBe(false);
  });

  it('annotates only the greatest comparable version when no candidate is enabled', () => {
    const candidates = [
      { version: '1.0.0', evidence: 'cached-unknown' as const },
      { version: '1.10.0', evidence: 'cached-unknown' as const },
      { version: '1.2.0', evidence: 'cached-unknown' as const },
    ];

    expect(annotateComparableVersionEvidence(candidates)).toEqual([
      candidates[0],
      { version: '1.10.0', evidence: 'newer-comparable-version' },
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
});
