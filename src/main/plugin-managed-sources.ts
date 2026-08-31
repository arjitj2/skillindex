import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  CanonicalRole,
  PluginDependencyWarning,
  PluginManagedSourceCandidate,
  PluginSourceEvidence,
  PluginSourceRef,
  SkillScanSource,
} from '@shared/contracts';

const pluginPathSeparators = new Set(['/','\\']);
const pluginPathTextDelimiters = new Set([
  ' ', '\t', '\n', '\r',
  '"', "'", '`',
  ',', ';', ':', '=',
  '(', ')', '[', ']', '{', '}',
  '<', '>', '|', '&',
]);

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
    const relative = path.relative(normalizedRoot, normalizedTarget);
    return relative === ''
      || (relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative));
  });
}

export async function assertSkillSymlinkTargetIsUniversal(
  targetPath: string,
  sources: Array<Pick<SkillScanSource, 'kind' | 'skillsDir'>>,
): Promise<void> {
  if (isPluginManagedTarget(targetPath, sources)) {
    throw new Error('Skill symlinks must target a writable Universal skill package, not a plugin-managed cache path.');
  }

  const resolvedTarget = await resolvePathThroughNearestExistingParent(targetPath);
  const pluginRoots = await Promise.all(sources
    .filter((source) => source.kind === 'plugin')
    .map(async (source) => ({
      lexical: path.normalize(source.skillsDir),
      resolved: await resolvePathThroughNearestExistingParent(source.skillsDir),
    })));
  if (pluginRoots.some((root) =>
    isPathContainedBy(root.lexical, resolvedTarget)
    || isPathContainedBy(root.resolved, resolvedTarget))) {
    throw new Error('Skill symlinks must target a writable Universal skill package, not a plugin-managed cache path.');
  }
}

async function resolvePathThroughNearestExistingParent(targetPath: string): Promise<string> {
  const normalizedTarget = path.normalize(targetPath);
  let candidate = normalizedTarget;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const resolved = await realpath(candidate);
      return path.join(resolved, ...missingSegments.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return normalizedTarget;
      }
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) return normalizedTarget;
    missingSegments.push(path.basename(candidate));
    candidate = parent;
  }
}

function isPathContainedBy(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(path.normalize(rootPath), path.normalize(targetPath));
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
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

export function annotateComparableVersionEvidence<T extends { evidence: PluginSourceEvidence }>(
  candidates: T[],
  getVersion: (candidate: T) => string | undefined = (candidate) => {
    const value = (candidate as { version?: unknown }).version;
    return typeof value === 'string' ? value : undefined;
  },
): T[] {
  if (candidates.some((candidate) => candidate.evidence === 'enabled-installation')) return candidates;

  const parsed = candidates.map((candidate) => ({
    candidate,
    version: parseComparableVersion(getVersion(candidate)),
  }));
  if (parsed.length < 2 || parsed.some((entry) => entry.version === null)) return candidates;

  const greatestVersion = parsed.reduce<[string, string, string] | null>((greatest, entry) => {
    if (!entry.version || greatest === null || compareVersionParts(entry.version, greatest) > 0) {
      return entry.version;
    }
    return greatest;
  }, null);
  if (greatestVersion === null
    || parsed.filter((entry) => compareVersionParts(entry.version!, greatestVersion) === 0).length !== 1) {
    return candidates;
  }
  const greatest = parsed.find((entry) => compareVersionParts(entry.version!, greatestVersion) === 0);

  return candidates.map((candidate) => candidate === greatest?.candidate
    ? { ...candidate, evidence: 'newer-comparable-version' }
    : candidate);
}

function parseComparableVersion(value: string | undefined): [string, string, string] | null {
  const match = value?.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  return match ? [match[1], match[2], match[3]] : null;
}

function compareVersionParts(left: [string, string, string], right: [string, string, string]): number {
  return compareDecimalStrings(left[0], right[0])
    || compareDecimalStrings(left[1], right[1])
    || compareDecimalStrings(left[2], right[2]);
}

function compareDecimalStrings(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
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
  if (/(?:\$\{(?:CODEX|CLAUDE)_PLUGIN_ROOT\}|\$(?:CODEX|CLAUDE)_PLUGIN_ROOT(?![A-Za-z0-9_]))/u.test(text)) {
    warnings.push({
      kind: 'plugin-root-variable',
      detail: 'References a plugin-root environment variable.',
    });
  }
  if (pluginRoot.length > 0 && hasPluginRootPathReference(text, pluginRoot)) {
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

function hasPluginRootPathReference(text: string, pluginRoot: string): boolean {
  const normalizedRoot = path.normalize(pluginRoot);
  let start = 0;
  while (true) {
    const index = text.indexOf(normalizedRoot, start);
    if (index === -1) return false;
    const previous = text[index - 1];
    const next = text[index + normalizedRoot.length];
    const previousIsDelimiter = previous === undefined
      || pluginPathSeparators.has(previous)
      || pluginPathTextDelimiters.has(previous);
    const nextIsDelimiter = next === undefined
      || pluginPathSeparators.has(next)
      || pluginPathTextDelimiters.has(next)
      || normalizedRoot === path.parse(normalizedRoot).root;
    if (previousIsDelimiter && nextIsDelimiter) {
      return true;
    }
    start = index + normalizedRoot.length;
  }
}
