import path from 'node:path';

import type {
  CanonicalRole,
  PluginDependencyWarning,
  PluginManagedSourceCandidate,
  PluginSourceEvidence,
  PluginSourceRef,
  SkillScanSource,
} from '@shared/contracts';

export function getOperationalLocations<T extends { canonicalRole?: CanonicalRole }>(locations: T[]): T[] {
  return locations.filter((location) => location.canonicalRole !== 'managed-source');
}

export function isAgentSatisfiedByNativePlugin(
  family: string | undefined,
  plugins: Array<Pick<PluginSourceRef, 'host' | 'enabled'>>,
): boolean {
  return plugins.some((plugin) => plugin.enabled === true && plugin.host === family);
}

export function isPluginManagedTarget(
  targetPath: string,
  sources: Array<Pick<SkillScanSource, 'kind' | 'skillsDir'>>,
): boolean {
  const normalizedTarget = path.normalize(targetPath);
  return sources.some((source) => {
    if (source.kind !== 'plugin') return false;
    const normalizedRoot = path.normalize(source.skillsDir);
    return normalizedTarget === normalizedRoot
      || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

export function buildPluginManagedSourceCandidate({
  path: sourcePath,
  plugin,
  comparisonKey,
  universalComparisonKey,
  dependencyWarnings,
}: {
  path: string;
  plugin: PluginSourceRef;
  comparisonKey: string;
  universalComparisonKey: string | null;
  dependencyWarnings: PluginDependencyWarning[];
}): PluginManagedSourceCandidate {
  return {
    path: sourcePath,
    plugin,
    evidence: plugin.enabled === true ? 'enabled-installation' : 'cached-unknown',
    relationship: universalComparisonKey === null
      ? 'universal-missing'
      : comparisonKey === universalComparisonKey
        ? 'matches-universal'
        : 'differs-from-universal',
    dependencyWarnings,
  };
}

export function annotateComparableVersionEvidence<
  T extends { version?: string; evidence: PluginSourceEvidence },
>(candidates: T[]): T[] {
  if (candidates.some((candidate) => candidate.evidence === 'enabled-installation')) return candidates;

  const parsed = candidates.map((candidate) => ({
    candidate,
    version: parseComparableVersion(candidate.version),
  }));
  if (parsed.some((entry) => entry.version === null)) return candidates;

  const greatest = parsed
    .slice()
    .sort((left, right) => compareVersionParts(right.version!, left.version!))[0];

  return candidates.map((candidate) => candidate === greatest?.candidate
    ? { ...candidate, evidence: 'newer-comparable-version' }
    : candidate);
}

function parseComparableVersion(value: string | undefined): [number, number, number] | null {
  const match = value?.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersionParts(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function detectPluginDependencyWarnings({
  text,
  pluginRoot,
  providerSpecificFields = [],
}: {
  text: string;
  pluginRoot: string;
  providerSpecificFields?: string[];
}): PluginDependencyWarning[] {
  const warnings: PluginDependencyWarning[] = [];
  if (/\$\{?(?:CODEX|CLAUDE)_PLUGIN_ROOT\}?/u.test(text)) {
    warnings.push({
      kind: 'plugin-root-variable',
      detail: 'References a plugin-root environment variable.',
    });
  }
  if (text.includes(pluginRoot)) {
    warnings.push({
      kind: 'plugin-contained-path',
      detail: `References a path inside ${pluginRoot}.`,
    });
  }
  if (providerSpecificFields.length > 0) {
    warnings.push({
      kind: 'provider-specific-field',
      detail: `Uses provider-specific fields: ${[...providerSpecificFields].sort().join(', ')}.`,
    });
  }
  return warnings;
}
