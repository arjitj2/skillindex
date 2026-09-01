import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises';
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

export async function assertSafeUniversalSkillMutation({
  destinationPath,
  universalRoot,
  skillName,
  scope,
  sources,
  allowDefaultUniversalRoot,
}: {
  destinationPath: string;
  universalRoot: string;
  skillName: string;
  scope: SkillScanSource['scope'];
  sources: SkillScanSource[];
  allowDefaultUniversalRoot: boolean;
}): Promise<void> {
  const permittedRoots = sources
    .filter((source) =>
      source.scope === scope
      && source.writable
      && source.kind !== 'plugin'
      && (source.canonical || source.preferredCanonical))
    .map((source) => source.skillsDir);
  if (allowDefaultUniversalRoot) {
    permittedRoots.push(universalRoot);
  }
  assertSafeSkillPackageName(skillName);
  if (!permittedRoots.some((root) => isExactSkillPackageDestination(root, destinationPath, skillName))) {
    throw new Error('Universal skill mutation requires a current writable Universal destination in the active scope.');
  }

  await assertPathDoesNotResolveIntoPlugin(destinationPath, sources);
  for (const root of permittedRoots) {
    if (isExactSkillPackageDestination(root, destinationPath, skillName)) {
      await assertResolvedExactSkillDestination(root, destinationPath, skillName);
      return;
    }
  }
}

export async function assertSafeWritableSkillLinkMutation(
  locationPath: string,
  sources: SkillScanSource[],
  additionalWritableRoots: string[] = [],
): Promise<void> {
  const writableRoots = sources
    .filter((source) => source.writable && source.kind !== 'plugin')
    .map((source) => source.skillsDir)
    .concat(additionalWritableRoots);
  if (!writableRoots.some((root) => isContainedDirectSkillPackage(root, locationPath))) {
    throw new Error('Skill link mutation requires a current writable agent skills destination.');
  }
  await assertPathDoesNotResolveIntoPlugin(path.dirname(locationPath), sources);
}

export async function isPluginManagedTargetThroughRealpath(
  targetPath: string,
  sources: SkillScanSource[],
): Promise<boolean> {
  try {
    await assertPathDoesNotResolveIntoPlugin(targetPath, sources);
    return false;
  } catch (error) {
    if ((error as Error).message.includes('plugin-managed cache path')) return true;
    throw error;
  }
}

export function assertSafeSkillPackageName(skillName: string): void {
  if (!skillName || skillName.includes('\0') || skillName.includes('/') || skillName.includes('\\')
    || path.isAbsolute(skillName) || path.win32.isAbsolute(skillName) || /^[A-Za-z]:/u.test(skillName)
    || skillName === '.' || skillName === '..') {
    throw new Error('Skill names must be a single safe skill package name.');
  }
}

export async function assertSkillSourceAndDestinationDoNotOverlap(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const sourceResolved = await resolvePathThroughNearestExistingParent(sourcePath);
  const destinationResolved = await resolvePathThroughNearestExistingParent(destinationPath);
  if (isPathContainedBy(sourceResolved, destinationResolved) || isPathContainedBy(destinationResolved, sourceResolved)) {
    throw new Error('Selected skill source must not overlap the Universal destination.');
  }
}

/**
 * Verifies that a plugin-managed package can be exported without dereferencing
 * nested links outside that package. Relative links whose resolved targets stay
 * inside the package are portable and may be preserved by the staged copy.
 */
export async function assertPluginManagedSkillPackageSymlinksContained(packageRoot: string): Promise<void> {
  const rootStats = await lstat(packageRoot);
  if (rootStats.isSymbolicLink()) {
    throw new Error('Plugin skill package roots must not be symlinks when exported to Universal.');
  }

  const resolvedRoot = await realpath(packageRoot);
  await assertContainedPackageDirectory(packageRoot, resolvedRoot, packageRoot, new Set());
}

async function assertContainedPackageDirectory(
  lexicalRoot: string,
  resolvedRoot: string,
  currentPath: string,
  activeDirectories: Set<string>,
): Promise<void> {
  const resolvedCurrent = await realpath(currentPath);
  if (activeDirectories.has(resolvedCurrent)) return;
  activeDirectories.add(resolvedCurrent);

  try {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) {
        const linkTarget = await readlink(entryPath);
        if (path.isAbsolute(linkTarget)) {
          throw new Error(`Plugin skill package symlink cannot be exported portably: ${entryPath}.`);
        }
        const lexicalTarget = path.resolve(path.dirname(entryPath), linkTarget);
        let resolvedTarget: string;
        try {
          resolvedTarget = await realpath(entryPath);
        } catch {
          throw new Error(`Plugin skill package contains an unreadable symlink and cannot be exported safely: ${entryPath}.`);
        }
        if (!isPathContainedBy(lexicalRoot, lexicalTarget) || !isPathContainedBy(resolvedRoot, resolvedTarget)) {
          throw new Error(`Plugin skill package symlink escapes its managed source: ${entryPath}.`);
        }
        if ((await stat(entryPath)).isDirectory()) {
          await assertContainedPackageDirectory(lexicalRoot, resolvedRoot, entryPath, activeDirectories);
        }
        continue;
      }

      if (entry.isDirectory()) {
        await assertContainedPackageDirectory(lexicalRoot, resolvedRoot, entryPath, activeDirectories);
      }
    }
  } finally {
    activeDirectories.delete(resolvedCurrent);
  }
}

async function assertPathDoesNotResolveIntoPlugin(targetPath: string, sources: SkillScanSource[]): Promise<void> {
  if (isPluginManagedTarget(targetPath, sources)) {
    throw new Error('Skill mutations cannot write into a plugin-managed cache path.');
  }
  const resolvedTarget = await resolvePathThroughNearestExistingParent(targetPath);
  const pluginRoots = await Promise.all(sources.filter((source) => source.kind === 'plugin')
    .map((source) => resolvePathThroughNearestExistingParent(source.skillsDir)));
  if (pluginRoots.some((root) => isPathContainedBy(root, resolvedTarget))) {
    throw new Error('Skill mutations cannot write into a plugin-managed cache path.');
  }
}

function isContainedDirectSkillPackage(rootPath: string, destinationPath: string): boolean {
  const relative = path.relative(path.normalize(rootPath), path.normalize(destinationPath));
  return relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative)
    && !relative.includes(path.sep);
}

function isExactSkillPackageDestination(rootPath: string, destinationPath: string, skillName: string): boolean {
  return path.normalize(destinationPath) === path.normalize(path.join(rootPath, skillName))
    && isContainedDirectSkillPackage(rootPath, destinationPath);
}

async function assertResolvedExactSkillDestination(rootPath: string, destinationPath: string, skillName: string): Promise<void> {
  const resolvedRoot = await resolvePathThroughNearestExistingParent(rootPath);
  const resolvedDestination = await resolvePathThroughNearestExistingParent(destinationPath);
  if (path.normalize(resolvedDestination) !== path.normalize(path.join(resolvedRoot, skillName))) {
    throw new Error('Universal skill destination escapes its writable Universal root.');
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
        throw new Error(`Unable to verify filesystem safety for ${normalizedTarget}.`);
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
): T[] {
  const enabledCandidateCount = candidates.filter((candidate) => candidate.evidence === 'enabled-installation').length;
  if (enabledCandidateCount > 1) {
    return candidates.map((candidate) => ({ ...candidate, evidence: 'cached-unknown' }));
  }
  return candidates;
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
