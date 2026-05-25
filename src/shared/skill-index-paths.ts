import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  SkillUniversalAlternate,
  SkillUniversalDecision,
  SkillUniversalOrigin,
} from './contracts';

export { CANONICAL_USER_SKILLS_DISPLAY_PATH } from './skill-path-policy';

export interface SkillIndexPaths {
  dataDir: string;
  auditLogFile: string;
  cacheFile: string;
  configFile: string;
  sandboxRoot: string;
  sandboxAgentsDir: string;
  liveCanonicalUserSkillsDir: string;
  sandboxCanonicalUserSkillsDir: string;
  sandboxAgentsSkillsDir: string;
  fixturesDir: string;
}

export interface ResolveSkillIndexPathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface ResolveSkillIndexScanPathOptions extends ResolveSkillIndexPathOptions {
  includeSandboxSources?: boolean;
  includeLiveSources?: boolean;
  paths?: SkillIndexPaths;
}

export interface SkillIndexConfig {
  customScanPaths: string[];
  preferredCanonicalSourcePath: string | null;
  showDevSidebarInventorySourceSwitcher: boolean;
  onboardingCompletedAt?: string | null;
  dismissedDriftSignatures: string[];
  dismissedMcpSignatures: string[];
  skillUniversalDecisions?: SkillUniversalDecision[];
}

export type WritableSkillIndexConfig = Omit<SkillIndexConfig, 'showDevSidebarInventorySourceSwitcher' | 'onboardingCompletedAt'> & {
  showDevSidebarInventorySourceSwitcher?: boolean;
  onboardingCompletedAt?: string | null;
};

export const defaultConfig: SkillIndexConfig = {
  customScanPaths: [],
  preferredCanonicalSourcePath: null,
  showDevSidebarInventorySourceSwitcher: true,
  onboardingCompletedAt: null,
  dismissedDriftSignatures: [],
  dismissedMcpSignatures: [],
  skillUniversalDecisions: [],
};

export function resolveSkillIndexPaths(options: ResolveSkillIndexPathOptions = {}): SkillIndexPaths {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const dataDir = env.SKILL_INDEX_DATA_DIR ? path.resolve(env.SKILL_INDEX_DATA_DIR) : path.join(homeDir, '.skillindex');
  const sandboxRoot = env.SKILL_INDEX_SANDBOX_ROOT ? path.resolve(env.SKILL_INDEX_SANDBOX_ROOT) : path.join(dataDir, 'sandbox');
  const sandboxAgentsDir = path.join(sandboxRoot, '.agents');
  const liveCanonicalUserSkillsDir = path.join(homeDir, '.agents', 'skills');
  const sandboxCanonicalUserSkillsDir = path.join(sandboxAgentsDir, 'skills');
  const fixturesDir = path.join(dataDir, 'fixtures');

  return {
    dataDir,
    auditLogFile: path.join(dataDir, 'audit-log.jsonl'),
    cacheFile: path.join(dataDir, 'cache.json'),
    configFile: path.join(dataDir, 'config.json'),
    sandboxRoot,
    sandboxAgentsDir,
    liveCanonicalUserSkillsDir,
    sandboxCanonicalUserSkillsDir,
    sandboxAgentsSkillsDir: sandboxCanonicalUserSkillsDir,
    fixturesDir,
  };
}

export function resolveSkillIndexPathsForScanOptions(options: ResolveSkillIndexScanPathOptions = {}): SkillIndexPaths {
  if (options.paths) {
    return options.paths;
  }

  const basePaths = resolveSkillIndexPaths(options);
  return usesSandboxSkillIndexState(options) ? withSandboxSkillIndexState(basePaths) : basePaths;
}

export function resolveRootSkillIndexStatePaths(options: ResolveSkillIndexScanPathOptions = {}): SkillIndexPaths {
  if (!options.paths) {
    return resolveSkillIndexPaths(options);
  }

  return usesSandboxSkillIndexStatePaths(options.paths)
    ? withRootSkillIndexState(options.paths)
    : options.paths;
}

export function resolveSandboxSkillIndexPaths(options: ResolveSkillIndexPathOptions & { paths?: SkillIndexPaths } = {}): SkillIndexPaths {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  return usesSandboxSkillIndexStatePaths(paths) ? paths : withSandboxSkillIndexState(paths);
}

export function usesSandboxSkillIndexState(options: Pick<ResolveSkillIndexScanPathOptions, 'includeSandboxSources' | 'includeLiveSources'>): boolean {
  return options.includeSandboxSources === true && options.includeLiveSources === false;
}

export function usesSandboxSkillIndexStatePaths(paths: SkillIndexPaths): boolean {
  return path.basename(paths.dataDir) === 'sandbox-state'
    && paths.auditLogFile === path.join(paths.dataDir, 'audit-log.jsonl')
    && paths.cacheFile === path.join(paths.dataDir, 'cache.json')
    && paths.configFile === path.join(paths.dataDir, 'config.json');
}

function withSandboxSkillIndexState(paths: SkillIndexPaths): SkillIndexPaths {
  const dataDir = path.join(paths.dataDir, 'sandbox-state');

  return {
    ...paths,
    dataDir,
    auditLogFile: path.join(dataDir, 'audit-log.jsonl'),
    cacheFile: path.join(dataDir, 'cache.json'),
    configFile: path.join(dataDir, 'config.json'),
  };
}

function withRootSkillIndexState(paths: SkillIndexPaths): SkillIndexPaths {
  const dataDir = path.dirname(paths.dataDir);

  return {
    ...paths,
    dataDir,
    auditLogFile: path.join(dataDir, 'audit-log.jsonl'),
    cacheFile: path.join(dataDir, 'cache.json'),
    configFile: path.join(dataDir, 'config.json'),
  };
}

export async function ensureSkillIndexLayout(paths: SkillIndexPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.dataDir, { recursive: true }),
  ]);

  await Promise.all([
    ensureJsonFile(paths.cacheFile, {}),
    ensureJsonFile(paths.configFile, defaultConfig),
  ]);
}

export async function ensureSkillIndexSandboxLayout(paths: SkillIndexPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.sandboxAgentsDir, { recursive: true }),
    mkdir(paths.sandboxCanonicalUserSkillsDir, { recursive: true }),
    mkdir(paths.fixturesDir, { recursive: true }),
  ]);
}

async function ensureJsonFile(filePath: string, value: object): Promise<void> {
  try {
    await access(filePath);
    return;
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  await writeFile(filePath, `${JSON.stringify(value, null, 2)}
`, 'utf8');
}

export async function readSkillIndexConfig(
  configFile: string,
  options: ResolveSkillIndexPathOptions = {},
): Promise<SkillIndexConfig> {
  let raw: string;
  try {
    raw = await readFile(configFile, 'utf8');
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw new Error(`Failed to read Skill Index config at ${configFile}: ${formatUnknownError(error)}`, { cause: error });
    }

    return defaultConfig;
  }

  return parseSkillIndexConfigFile(raw, configFile, options);
}

export function readSkillIndexConfigSync(
  configFile: string,
  options: ResolveSkillIndexPathOptions = {},
): SkillIndexConfig {
  let raw: string;
  try {
    raw = readFileSync(configFile, 'utf8');
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw new Error(`Failed to read Skill Index config at ${configFile}: ${formatUnknownError(error)}`, { cause: error });
    }

    return defaultConfig;
  }

  return parseSkillIndexConfigFile(raw, configFile, options);
}

export async function writeSkillIndexConfig(configFile: string, config: WritableSkillIndexConfig): Promise<void> {
  const serialized = `${JSON.stringify({
    ...config,
    showDevSidebarInventorySourceSwitcher: config.showDevSidebarInventorySourceSwitcher ?? true,
    onboardingCompletedAt: config.onboardingCompletedAt ?? null,
  }, null, 2)}
`;
  const tempFile = path.join(
    path.dirname(configFile),
    `.${path.basename(configFile)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  await mkdir(path.dirname(configFile), { recursive: true });
  try {
    await writeFile(tempFile, serialized, 'utf8');
    await rename(tempFile, configFile);
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function normalizeCustomScanPath(scanPath: string, options: ResolveSkillIndexPathOptions = {}): string {
  const trimmedScanPath = scanPath.trim();
  return path.resolve(expandHomeRelativePath(trimmedScanPath, options));
}

function normalizeConfiguredCustomScanPaths(
  scanPaths: string[],
  options: ResolveSkillIndexPathOptions,
): string[] {
  return [...new Set(
    scanPaths
      .filter((scanPath) => typeof scanPath === 'string' && scanPath.trim().length > 0)
      .map((scanPath) => normalizeCustomScanPath(scanPath, options)),
  )];
}

function normalizeConfiguredOptionalPath(
  targetPath: unknown,
  options: ResolveSkillIndexPathOptions,
): string | null {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    return null;
  }

  return normalizeCustomScanPath(targetPath, options);
}

function expandHomeRelativePath(targetPath: string, options: ResolveSkillIndexPathOptions): string {
  const homeDir = options.homeDir ?? homedir();

  if (targetPath === '~') {
    return homeDir;
  }

  if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
    return path.join(homeDir, targetPath.slice(2));
  }

  return targetPath;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseSkillIndexConfig(raw: string, options: ResolveSkillIndexPathOptions): SkillIndexConfig {
  const parsed = JSON.parse(raw) as Partial<SkillIndexConfig>;

  return {
    customScanPaths: Array.isArray(parsed.customScanPaths)
      ? normalizeConfiguredCustomScanPaths(parsed.customScanPaths, options)
      : [],
    preferredCanonicalSourcePath: normalizeConfiguredOptionalPath(parsed.preferredCanonicalSourcePath, options),
    showDevSidebarInventorySourceSwitcher: parsed.showDevSidebarInventorySourceSwitcher !== false,
    onboardingCompletedAt: normalizeConfiguredOptionalTimestamp(parsed.onboardingCompletedAt),
    dismissedDriftSignatures: Array.isArray(parsed.dismissedDriftSignatures)
      ? parsed.dismissedDriftSignatures.filter(isString)
      : [],
    dismissedMcpSignatures: Array.isArray(parsed.dismissedMcpSignatures)
      ? parsed.dismissedMcpSignatures.filter(isString)
      : [],
    skillUniversalDecisions: Array.isArray(parsed.skillUniversalDecisions)
      ? parsed.skillUniversalDecisions.filter(isSkillUniversalDecision)
      : [],
  };
}

function normalizeConfiguredOptionalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function isSkillUniversalDecision(value: unknown): value is SkillUniversalDecision {
  return isRecord(value)
    && isString(value.id)
    && isString(value.skillName)
    && (value.state === 'policy' || value.state === 'user-confirmed')
    && isSkillUniversalOrigin(value.universal)
    && Array.isArray(value.acceptedAlternates)
    && value.acceptedAlternates.every(isSkillUniversalAlternate)
    && isString(value.updatedAt);
}

function isSkillUniversalOrigin(value: unknown): value is SkillUniversalOrigin {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === 'plugin') {
    return isPluginHost(value.host)
      && isString(value.pluginId)
      && (value.pluginVersion === undefined || isString(value.pluginVersion))
      && isString(value.pluginSkillName);
  }

  return value.kind === 'path'
    && isString(value.sourceId)
    && isString(value.path);
}

function isSkillUniversalAlternate(value: unknown): value is SkillUniversalAlternate {
  return isRecord(value)
    && (value.kind === 'plugin' || value.kind === 'path')
    && value.reason === 'kept-separate'
    && (value.path === undefined || isString(value.path))
    && (value.sourceId === undefined || isString(value.sourceId))
    && (value.host === undefined || isPluginHost(value.host))
    && (value.pluginId === undefined || isString(value.pluginId))
    && (value.pluginVersion === undefined || isString(value.pluginVersion))
    && (value.pluginSkillName === undefined || isString(value.pluginSkillName));
}

function isPluginHost(value: unknown): value is 'claude' | 'codex' {
  return value === 'claude' || value === 'codex';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSkillIndexConfigFile(
  raw: string,
  configFile: string,
  options: ResolveSkillIndexPathOptions,
): SkillIndexConfig {
  try {
    return parseSkillIndexConfig(raw, options);
  } catch (error) {
    throw new Error(`Failed to parse Skill Index config at ${configFile}: ${formatUnknownError(error)}`, { cause: error });
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return isErrnoException(error) && error.code === 'ENOENT';
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
