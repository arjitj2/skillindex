import { access, readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  McpServerDefinitions,
  PluginHost,
  PluginMcpRef,
  PluginRecord,
  PluginSubagentRef,
  PluginUnsupportedAssetRef,
  SkillSourceScope,
  PluginSkillRef,
  SkillScanSource,
} from '@shared/contracts';
import { isMcpServerDefinitions } from '@shared/mcp-definition';

import { sanitizeJsonc } from './json-utils';

interface ScanPluginInventoryOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  scope?: SkillSourceScope;
}

interface PluginManifest {
  name?: string;
  version?: string;
  homepage?: string;
  repository?: string | { url?: string };
  skills?: string | string[];
  mcpServers?: string | string[] | McpServerDefinitions;
  agents?: string | string[];
  hooks?: string | string[];
}

interface PluginMarketplaceEntry {
  name?: string;
  homepage?: string;
  source?: string | PluginMarketplaceSource;
}

interface PluginMarketplaceSource {
  source?: string;
  path?: string;
  ref?: string;
  commit?: string;
  sha?: string;
  sourceUrl?: string;
  repo?: string;
  url?: string;
}

interface KnownPluginMarketplaceEntry {
  source?: string | PluginMarketplaceSource;
}

interface KnownPluginMarketplaces {
  [marketplaceName: string]: KnownPluginMarketplaceEntry;
}

interface MarketplaceSourceContext {
  repositoryRoot?: string;
  ref?: string;
}

interface PluginMarketplaceMetadata {
  repository?: string;
}

interface PluginBundleCandidate {
  host: PluginHost;
  rootPath: string;
  manifestPath: string;
}

interface PluginSkillInventory {
  skillRoots: string[];
  skills: PluginSkillRef[];
}

type PluginEnabledState = boolean | 'unknown';

export async function scanPluginInventory(options: ScanPluginInventoryOptions = {}): Promise<PluginRecord[]> {
  const homeDir = options.homeDir ?? homedir();
  const candidates = [
    ...(await findPluginBundles(path.join(homeDir, '.codex', 'plugins'), 'codex')),
    ...(await findPluginBundles(path.join(homeDir, '.claude', 'plugins'), 'claude')),
  ];
  const enabledCodexPluginIds = await readCodexEnabledPluginIds(path.join(homeDir, '.codex', 'config.toml'));
  const claudePluginEnabledStates = await readClaudePluginEnabledStates(resolveClaudeSettingsPath(homeDir, options));
  const marketplaceMetadata = await readPluginMarketplaceMetadata(homeDir);

  const plugins = await Promise.all(candidates.map(async (candidate) =>
    readPluginRecord(candidate, {
      claudePluginEnabledStates,
      codexEnabledPluginIds: enabledCodexPluginIds,
      marketplaceMetadata,
      scope: options.scope ?? 'live',
    })));

  return plugins
    .filter((plugin): plugin is PluginRecord => plugin !== null)
    .sort((left, right) =>
      left.host.localeCompare(right.host)
      || left.pluginName.localeCompare(right.pluginName, undefined, { sensitivity: 'base' })
      || left.rootPath.localeCompare(right.rootPath));
}

export function buildPluginSkillScanSources(plugins: PluginRecord[]): SkillScanSource[] {
  return plugins
    .filter((plugin) => plugin.bundledSkills.length > 0)
    .flatMap((plugin) => getPluginSkillRoots(plugin).map((skillRoot, index) => ({
      id: createPluginSkillRootSourceId(plugin, index),
      label: `${formatPluginHost(plugin.host)} Plugin ${plugin.pluginName}`,
      canonical: true,
      kind: 'plugin',
      writable: false,
      scope: plugin.scope ?? 'live',
      skillsDir: skillRoot,
      preferredCanonical: false,
      compatibleAgentFamilies: [],
      plugin: {
        host: plugin.host,
        pluginId: plugin.pluginId,
        pluginName: plugin.pluginName,
        version: plugin.version,
        rootPath: plugin.rootPath,
        manifestPath: plugin.manifestPath,
      },
      mcpConfigPath: plugin.bundledMcps[0]?.configPath,
    })));
}

function createPluginSourceId(plugin: Pick<PluginRecord, 'host' | 'pluginId' | 'version' | 'scope'>): string {
  const scopePrefix = plugin.scope === 'sandbox' ? 'sandbox:' : '';
  return `plugin:${scopePrefix}${plugin.host}:${plugin.pluginId}:${plugin.version ?? 'unknown'}`;
}

function createPluginSkillRootSourceId(
  plugin: Pick<PluginRecord, 'host' | 'pluginId' | 'version' | 'scope'>,
  index: number,
): string {
  const baseId = createPluginSourceId(plugin);
  return index === 0 ? baseId : `${baseId}:skill-root:${index + 1}`;
}

function getPluginSkillRoots(plugin: PluginRecord): string[] {
  if (plugin.skillRoots && plugin.skillRoots.length > 0) {
    return plugin.skillRoots;
  }

  return dedupeBy(
    plugin.bundledSkills.map((skill) => path.dirname(skill.path)),
    (skillRoot) => skillRoot,
  ).sort((left, right) => left.localeCompare(right));
}

async function findPluginBundles(rootPath: string, host: PluginHost): Promise<PluginBundleCandidate[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const manifestDirectoryName = host === 'codex' ? '.codex-plugin' : '.claude-plugin';
  const candidates: PluginBundleCandidate[] = [];
  await walkPluginTree(rootPath, async (currentPath, depth) => {
    if (depth > 6) {
      return 'skip-children';
    }

    const manifestPath = path.join(currentPath, manifestDirectoryName, 'plugin.json');
    if (await fileExists(manifestPath)) {
      candidates.push({
        host,
        rootPath: currentPath,
        manifestPath,
      });
      return 'skip-children';
    }

    return 'continue';
  });

  return candidates;
}

async function walkPluginTree(
  currentPath: string,
  visit: (currentPath: string, depth: number) => Promise<'continue' | 'skip-children'>,
  depth = 0,
): Promise<void> {
  const decision = await visit(currentPath, depth);
  if (decision === 'skip-children') {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipPluginTreeEntry(entry.name)) {
      continue;
    }

    await walkPluginTree(path.join(currentPath, entry.name), visit, depth + 1);
  }
}

function shouldSkipPluginTreeEntry(name: string): boolean {
  return name === 'data'
    || name === 'marketplaces'
    || name === 'node_modules'
    || name === 'dist'
    || name === 'build';
}

async function readPluginRecord(
  candidate: PluginBundleCandidate,
  options: {
    claudePluginEnabledStates: Map<string, boolean>;
    codexEnabledPluginIds: Set<string>;
    marketplaceMetadata: Map<string, PluginMarketplaceMetadata>;
    scope: SkillSourceScope;
  },
): Promise<PluginRecord | null> {
  const manifest = await readPluginManifest(candidate.manifestPath);
  const pluginName = normalizePluginName(manifest.name, candidate.rootPath);
  const marketplace = inferPluginMarketplace(candidate.rootPath);
  const pluginId = marketplace ? `${pluginName}@${marketplace}` : pluginName;
  const marketplaceEntry = marketplace
    ? options.marketplaceMetadata.get(getPluginMarketplaceKey(candidate.host, marketplace, pluginName))
    : undefined;
  const version = manifest.version ?? inferPluginCacheVersion(candidate.rootPath);
  const sourceId = createPluginSourceId({
    host: candidate.host,
    scope: options.scope,
    pluginId,
    version,
  });
  const skillInventory = await collectPluginSkills(candidate.rootPath, manifest, {
    host: candidate.host,
    pluginId,
    scope: options.scope,
    version,
  });
  const bundledMcps = await collectPluginMcps(candidate.rootPath, manifest, sourceId);
  const bundledSubagents = await collectPluginSubagents(candidate.rootPath, manifest, sourceId);
  const unsupportedAssets = await collectPluginHooks(candidate.rootPath, manifest, sourceId);

  return {
    host: candidate.host,
    scope: options.scope,
    pluginId,
    pluginName,
    version,
    rootPath: candidate.rootPath,
    manifestPath: candidate.manifestPath,
    enabled: resolvePluginEnabledState(candidate.host, pluginId, options),
    skillRoots: skillInventory.skillRoots,
    bundledSkills: skillInventory.skills,
    bundledMcps,
    bundledSubagents,
    unsupportedAssets,
    unsupportedHooksCount: unsupportedAssets.length,
    source: {
      marketplace,
      repository: normalizeRepositoryUrl(manifest.repository) ?? normalizeUrlString(manifest.homepage) ?? marketplaceEntry?.repository,
    },
  };
}

function resolvePluginEnabledState(
  host: PluginHost,
  pluginId: string,
  options: {
    claudePluginEnabledStates: Map<string, boolean>;
    codexEnabledPluginIds: Set<string>;
  },
): PluginEnabledState {
  if (host === 'codex') {
    return options.codexEnabledPluginIds.has(pluginId) ? true : 'unknown';
  }

  return options.claudePluginEnabledStates.get(pluginId) ?? 'unknown';
}

async function readPluginManifest(manifestPath: string): Promise<PluginManifest> {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(sanitizeJsonc(raw)) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePluginName(manifestName: unknown, rootPath: string): string {
  return typeof manifestName === 'string' && manifestName.trim().length > 0
    ? manifestName.trim()
    : path.basename(rootPath);
}

function inferPluginMarketplace(rootPath: string): string | undefined {
  const segments = rootPath.split(path.sep).filter(Boolean);
  const cacheIndex = segments.lastIndexOf('cache');
  if (cacheIndex < 0 || cacheIndex + 1 >= segments.length) {
    return undefined;
  }

  return segments[cacheIndex + 1];
}

function normalizeRepositoryUrl(repository: PluginManifest['repository']): string | undefined {
  if (typeof repository === 'string' && repository.trim().length > 0) {
    return repository.trim();
  }

  if (isRecord(repository) && typeof repository.url === 'string' && repository.url.trim().length > 0) {
    return repository.url.trim();
  }

  return undefined;
}

function inferPluginCacheVersion(rootPath: string): string | undefined {
  const segments = rootPath.split(path.sep).filter(Boolean);
  const cacheIndex = segments.lastIndexOf('cache');
  if (cacheIndex < 0 || cacheIndex + 3 >= segments.length) {
    return undefined;
  }

  const version = segments[cacheIndex + 3];
  return version && version !== 'unknown' ? version : undefined;
}

async function readPluginMarketplaceMetadata(homeDir: string): Promise<Map<string, PluginMarketplaceMetadata>> {
  const entries = new Map<string, PluginMarketplaceMetadata>();
  const knownMarketplaces = await readKnownPluginMarketplaces(path.join(homeDir, '.claude', 'plugins', 'known_marketplaces.json'));
  await readMarketplaceMetadataFromRoot({
    entries,
    host: 'claude',
    knownMarketplaces,
    rootPath: path.join(homeDir, '.claude', 'plugins', 'marketplaces'),
    manifestPathForMarketplace: (marketplaceRoot) => path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
  });

  return entries;
}

async function readMarketplaceMetadataFromRoot({
  entries,
  host,
  knownMarketplaces,
  manifestPathForMarketplace,
  rootPath,
}: {
  entries: Map<string, PluginMarketplaceMetadata>;
  host: PluginHost;
  knownMarketplaces: Map<string, MarketplaceSourceContext>;
  manifestPathForMarketplace: (marketplaceRoot: string) => string;
  rootPath: string;
}): Promise<void> {
  let marketplaces: Dirent[];
  try {
    marketplaces = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const marketplace of marketplaces) {
    if (!marketplace.isDirectory()) {
      continue;
    }

    const marketplaceName = marketplace.name;
    const manifestPath = manifestPathForMarketplace(path.join(rootPath, marketplaceName));
    const marketplaceSource = knownMarketplaces.get(getPluginMarketplaceKey(host, marketplaceName));
    const marketplaceEntries = await readMarketplaceEntries(manifestPath);
    for (const entry of marketplaceEntries) {
      if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
        continue;
      }

      const repository = normalizeMarketplaceRepositoryUrl(entry, marketplaceSource);
      if (!repository) {
        continue;
      }

      entries.set(getPluginMarketplaceKey(host, marketplaceName, entry.name.trim()), { repository });
    }
  }
}

async function readKnownPluginMarketplaces(knownMarketplacesPath: string): Promise<Map<string, MarketplaceSourceContext>> {
  const marketplaces = new Map<string, MarketplaceSourceContext>();
  try {
    const raw = await readFile(knownMarketplacesPath, 'utf8');
    const parsed = JSON.parse(sanitizeJsonc(raw)) as unknown;
    if (!isRecord(parsed)) {
      return marketplaces;
    }

    const entries = parsed as KnownPluginMarketplaces;
    for (const [marketplaceName, entry] of Object.entries(entries)) {
      if (!isRecord(entry)) {
        continue;
      }

      const knownEntry = entry as KnownPluginMarketplaceEntry;
      const repositoryRoot = normalizeMarketplaceSourceRootUrl(knownEntry.source);
      if (!repositoryRoot) {
        continue;
      }

      marketplaces.set(getPluginMarketplaceKey('claude', marketplaceName), {
        repositoryRoot,
        ref: getMarketplaceSourceRef(knownEntry.source),
      });
    }
  } catch {
    return marketplaces;
  }

  return marketplaces;
}

async function readMarketplaceEntries(marketplacePath: string): Promise<PluginMarketplaceEntry[]> {
  try {
    const raw = await readFile(marketplacePath, 'utf8');
    const parsed = JSON.parse(sanitizeJsonc(raw)) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
      return [];
    }

    return parsed.plugins.filter(isRecord);
  } catch {
    return [];
  }
}

function normalizeMarketplaceRepositoryUrl(
  entry: PluginMarketplaceEntry,
  marketplaceSource?: MarketplaceSourceContext,
): string | undefined {
  if (typeof entry.homepage === 'string' && entry.homepage.trim().length > 0) {
    return entry.homepage.trim();
  }

  return normalizeMarketplaceSourceUrl(entry.source, marketplaceSource);
}

function normalizeMarketplaceSourceUrl(
  source: PluginMarketplaceEntry['source'],
  marketplaceSource?: MarketplaceSourceContext,
): string | undefined {
  if (typeof source === 'string') {
    const sourceValue = source.trim();
    if (/^https?:\/\//u.test(sourceValue)) {
      return normalizeGitUrl(sourceValue);
    }

    return appendRepositoryPath(marketplaceSource?.repositoryRoot, sourceValue, marketplaceSource?.ref);
  }

  if (isRecord(source)) {
    const rootUrl = normalizeMarketplaceSourceRootUrl(source);
    const repositoryUrl = appendRepositoryPath(rootUrl, getOptionalString(source.path), getMarketplaceSourceRef(source));
    if (repositoryUrl) {
      return repositoryUrl;
    }

    const relativePathUrl = appendRepositoryPath(
      marketplaceSource?.repositoryRoot,
      getOptionalString(source.path),
      marketplaceSource?.ref,
    );
    if (relativePathUrl) {
      return relativePathUrl;
    }
  }

  return undefined;
}

function normalizeMarketplaceSourceRootUrl(source: PluginMarketplaceEntry['source']): string | undefined {
  if (typeof source === 'string') {
    const sourceValue = source.trim();
    return /^https?:\/\//u.test(sourceValue) ? normalizeGitUrl(sourceValue) : undefined;
  }

  if (!isRecord(source)) {
    return undefined;
  }

  const url = getOptionalString(source.url) ?? getOptionalString(source.sourceUrl);
  if (url && /^https?:\/\//u.test(url)) {
    return normalizeGitUrl(url);
  }

  const repo = getOptionalString(source.repo);
  if (repo) {
    return `https://github.com/${repo.replace(/^\/+|\/+$/gu, '')}`;
  }

  return undefined;
}

function getMarketplaceSourceRef(source: PluginMarketplaceEntry['source']): string | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  return getOptionalString(source.ref) ?? getOptionalString(source.commit) ?? getOptionalString(source.sha);
}

function appendRepositoryPath(
  repositoryRoot: string | undefined,
  relativePath: string | undefined,
  ref: string | undefined,
): string | undefined {
  if (!repositoryRoot) {
    return undefined;
  }

  if (!relativePath) {
    return repositoryRoot;
  }

  const normalizedPath = relativePath.trim().replace(/^\.?\//u, '').replace(/^\/+|\/+$/gu, '');
  if (!normalizedPath) {
    return repositoryRoot;
  }

  if (isGitHubUrl(repositoryRoot)) {
    return `${repositoryRoot.replace(/\/+$/u, '')}/tree/${encodeURIComponent(ref ?? 'main')}/${normalizedPath}`;
  }

  return `${repositoryRoot.replace(/\/+$/u, '')}/${normalizedPath}`;
}

function isGitHubUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'github.com';
  } catch {
    return false;
  }
}

function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\.git$/u, '');
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeUrlString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const url = value.trim();
  return /^https?:\/\//u.test(url) ? url : undefined;
}

function getPluginMarketplaceKey(host: PluginHost, marketplace: string): string;
function getPluginMarketplaceKey(host: PluginHost, marketplace: string, pluginName: string): string;
function getPluginMarketplaceKey(host: PluginHost, marketplace: string, pluginName?: string): string {
  return pluginName ? `${host}:${marketplace}:${pluginName}` : `${host}:${marketplace}`;
}

async function collectPluginSkills(
  rootPath: string,
  manifest: PluginManifest,
  plugin: Pick<PluginRecord, 'host' | 'pluginId' | 'version' | 'scope'>,
): Promise<PluginSkillInventory> {
  const skillRoots = normalizeManifestPaths(manifest.skills, 'skills').map((relativeSkillPath) =>
    path.resolve(rootPath, relativeSkillPath)).sort((left, right) => left.localeCompare(right));
  const skills: PluginSkillRef[] = [];

  for (const [index, skillRoot] of skillRoots.entries()) {
    const sourceId = createPluginSkillRootSourceId(plugin, index);
    const entries = await collectSkillEntrypoints(skillRoot);
    skills.push(...entries.map((entrypointPath) => {
      const skillPath = path.dirname(entrypointPath);
      return {
        name: path.basename(skillPath),
        path: skillPath,
        entrypointPath,
        sourceId,
      };
    }));
  }

  return {
    skillRoots,
    skills: dedupeBy(skills, (skill) => skill.path)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
  };
}

async function collectSkillEntrypoints(skillRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(skillRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const entrypoints: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entrypointPath = path.join(skillRoot, entry.name, 'SKILL.md');
    if (await fileExists(entrypointPath)) {
      entrypoints.push(entrypointPath);
    }
  }

  return entrypoints;
}

async function collectPluginMcps(
  rootPath: string,
  manifest: PluginManifest,
  sourceId: string,
): Promise<PluginMcpRef[]> {
  const configPaths = await resolvePluginMcpConfigPaths(rootPath, manifest);
  const refs: PluginMcpRef[] = [];

  for (const configPath of configPaths) {
    const names = await readMcpNames(configPath);
    refs.push(...names.map((name) => ({
      name,
      configPath,
      sourceId,
    })));
  }

  return dedupeBy(refs, (ref) => `${ref.configPath}:${ref.name}`)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

async function resolvePluginMcpConfigPaths(rootPath: string, manifest: PluginManifest): Promise<string[]> {
  const manifestPaths = typeof manifest.mcpServers === 'string' || Array.isArray(manifest.mcpServers)
    ? normalizeManifestPaths(manifest.mcpServers, '.mcp.json').map((relativeMcpPath) => path.resolve(rootPath, relativeMcpPath))
    : [];
  const defaultPath = path.join(rootPath, '.mcp.json');
  const configPaths = manifestPaths.length > 0 ? manifestPaths : [defaultPath];
  const existingPaths = await Promise.all(configPaths.map(async (configPath) =>
    await fileExists(configPath) ? configPath : null));

  return existingPaths.filter((configPath): configPath is string => configPath !== null);
}

async function readMcpNames(configPath: string): Promise<string[]> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(sanitizeJsonc(raw)) as unknown;
    if (!isRecord(parsed)) {
      return [];
    }

    const definitions = isMcpServerDefinitions(parsed.mcpServers)
      ? parsed.mcpServers
      : isMcpServerDefinitions(parsed.servers)
        ? parsed.servers
        : isMcpServerDefinitions(parsed.mcp)
          ? parsed.mcp
          : isMcpServerDefinitions(parsed)
            ? parsed
            : null;

  return definitions ? Object.keys(definitions).sort((left, right) => left.localeCompare(right)) : [];
  } catch {
    return [];
  }
}

async function collectPluginSubagents(
  rootPath: string,
  manifest: PluginManifest,
  sourceId: string,
): Promise<PluginSubagentRef[]> {
  const agentPaths = await resolvePluginSubagentPaths(rootPath, manifest);
  const refs = await Promise.all(agentPaths.map(async (agentPath) => ({
    name: await readPluginSubagentName(agentPath),
    path: agentPath,
    sourceId,
  })));

  return dedupeBy(refs, (ref) => ref.path)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

async function resolvePluginSubagentPaths(rootPath: string, manifest: PluginManifest): Promise<string[]> {
  // Claude Code documents plugin subagents under the `agents` manifest key and
  // both Claude and Codex plugin bundles use `agents/` as the default root.
  const declaredPaths = normalizeManifestPaths(manifest.agents, 'agents').map((relativeAgentPath) =>
    path.resolve(rootPath, relativeAgentPath));
  const paths: string[] = [];

  for (const agentPath of declaredPaths) {
    paths.push(...await collectSubagentFiles(agentPath));
  }

  return paths.sort((left, right) => left.localeCompare(right));
}

async function collectSubagentFiles(targetPath: string): Promise<string[]> {
  let stats;
  try {
    stats = await stat(targetPath);
  } catch {
    return [];
  }

  if (stats.isFile()) {
    return isSubagentFileName(path.basename(targetPath)) ? [targetPath] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  let entries: Dirent[];
  try {
    entries = await readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && isSubagentFileName(entry.name)) {
      files.push(path.join(targetPath, entry.name));
    }
  }

  return files;
}

function isSubagentFileName(fileName: string): boolean {
  return /\.(?:md|toml|json|jsonc|ya?ml)$/iu.test(fileName);
}

async function readPluginSubagentName(agentPath: string): Promise<string> {
  const fallbackName = path.basename(agentPath).replace(/(?:\.agent)?\.(?:md|toml|jsonc?|ya?ml)$/iu, '');
  try {
    const raw = await readFile(agentPath, 'utf8');
    const frontMatterName = readFrontMatterField(raw, 'name');
    if (frontMatterName) {
      return frontMatterName;
    }

    const tomlName = readTomlStringField(raw, 'name');
    if (tomlName) {
      return tomlName;
    }

    const yamlName = readYamlStringField(raw, 'name');
    if (yamlName) {
      return yamlName;
    }

    const parsedJson = JSON.parse(sanitizeJsonc(raw)) as unknown;
    if (isRecord(parsedJson) && typeof parsedJson.name === 'string' && parsedJson.name.trim().length > 0) {
      return parsedJson.name.trim();
    }
  } catch {
    return fallbackName;
  }

  return fallbackName;
}

function readFrontMatterField(raw: string, field: string): string | null {
  const lines = raw.split(/\r?\n/u);
  if (lines[0] !== '---') {
    return null;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  if (closingIndex < 0) {
    return null;
  }

  const fieldPattern = new RegExp(`^${field}:\\s*(.*)$`, 'u');
  for (const line of lines.slice(1, closingIndex)) {
    const match = fieldPattern.exec(line);
    const value = match?.[1]?.trim();
    if (value) {
      return unquoteScalar(value);
    }
  }

  return null;
}

function readYamlStringField(raw: string, field: string): string | null {
  const fieldPattern = new RegExp(`^${field}:\\s*(.*)$`, 'u');
  for (const line of raw.split(/\r?\n/u)) {
    const match = fieldPattern.exec(stripYamlComment(line).trim());
    const value = match?.[1]?.trim();
    if (value && value !== '|' && value !== '>') {
      return unquoteScalar(value);
    }
  }

  return null;
}

function stripYamlComment(line: string): string {
  let inQuote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === '"' || character === "'") && line[index - 1] !== '\\') {
      inQuote = inQuote === character ? null : inQuote ?? character;
    }
    if (character === '#' && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function readTomlStringField(raw: string, field: string): string | null {
  const fieldPattern = new RegExp(`^\\s*${field}\\s*=\\s*(.+?)\\s*$`, 'mu');
  const value = fieldPattern.exec(raw)?.[1]?.trim();
  return value ? unquoteScalar(value) : null;
}

function unquoteScalar(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

async function collectPluginHooks(
  rootPath: string,
  manifest: PluginManifest,
  sourceId: string,
): Promise<PluginUnsupportedAssetRef[]> {
  const hookPaths = normalizeManifestPaths(manifest.hooks, path.join('hooks', 'hooks.json')).map((relativeHookPath) =>
    path.resolve(rootPath, relativeHookPath));
  const hooks: PluginUnsupportedAssetRef[] = [];
  for (const hookPath of hookPaths) {
    if (!(await fileExists(hookPath))) {
      continue;
    }

    const hookNames = await readPluginHookNames(hookPath);
    if (hookNames.length === 0) {
      hooks.push({
        kind: 'hook',
        name: formatHookDisplayName(path.basename(hookPath, path.extname(hookPath))),
        path: hookPath,
        sourceId,
      });
      continue;
    }

    for (const hookName of hookNames) {
      hooks.push({
        kind: 'hook',
        name: formatHookDisplayName(hookName),
        path: hookPath,
        sourceId,
      });
    }
  }

  return hooks.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

async function readPluginHookNames(hookPath: string): Promise<string[]> {
  try {
    const raw = await readFile(hookPath, 'utf8');
    const parsed = JSON.parse(sanitizeJsonc(raw)) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
      return [];
    }

    return Object.keys(parsed.hooks).filter((hookName) => hookName.trim().length > 0);
  } catch {
    return [];
  }
}

function formatHookDisplayName(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[_\s]+/gu, '-')
    .toLowerCase();
}

function normalizeManifestPaths(value: string | string[] | undefined, fallback: string): string[] {
  const rawPaths = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [fallback];
  return rawPaths
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().replace(/^\.\//u, ''));
}

async function readCodexEnabledPluginIds(configPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const enabledIds = new Set<string>();
    const pluginHeaderPattern = /^\[plugins\."([^"]+)"\]\s*$/u;
    let currentPluginId: string | null = null;

    for (const line of raw.split(/\r?\n/u)) {
      const headerMatch = line.match(pluginHeaderPattern);
      if (headerMatch) {
        currentPluginId = headerMatch[1]?.replace(/@([^@]+)$/u, '@$1') ?? null;
        continue;
      }

      if (currentPluginId && /^\s*enabled\s*=\s*true\s*$/u.test(line)) {
        enabledIds.add(currentPluginId);
      }
    }

    return enabledIds;
  } catch {
    return new Set();
  }
}

function resolveClaudeSettingsPath(homeDir: string, options: Pick<ScanPluginInventoryOptions, 'env' | 'scope'>): string {
  const configDir = options.scope === 'sandbox'
    ? path.join(homeDir, '.claude')
    : options.env?.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir, '.claude');
  return path.join(configDir, 'settings.json');
}

async function readClaudePluginEnabledStates(settingsPath: string): Promise<Map<string, boolean>> {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(sanitizeJsonc(raw)) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.enabledPlugins)) {
      return new Map();
    }

    const states = new Map<string, boolean>();
    for (const [pluginId, enabled] of Object.entries(parsed.enabledPlugins)) {
      if (typeof enabled === 'boolean') {
        states.set(pluginId, enabled);
      }
    }

    return states;
  } catch {
    return new Map();
  }
}

function formatPluginHost(host: PluginHost): string {
  return host === 'codex' ? 'Codex' : 'Claude';
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const uniqueItems: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await stat(targetPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
