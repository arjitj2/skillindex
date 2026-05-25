import type { CompleteOnboardingRequest, SettingsState } from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  normalizeCustomScanPath,
  resolveRootSkillIndexStatePaths,
  readSkillIndexConfig,
  resolveSkillIndexPathsForScanOptions,
  writeSkillIndexConfig,
  type ResolveSkillIndexScanPathOptions,
  type SkillIndexConfig,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

export interface SettingsStateOptions extends ResolveSkillIndexScanPathOptions {
  paths?: SkillIndexPaths;
}

export async function readSettingsState(options: SettingsStateOptions = {}): Promise<SettingsState> {
  const { config } = await resolveSettingsContext(options);
  const { config: globalConfig } = await resolveGlobalSettingsContext(options);

  return toSettingsState(config, globalConfig);
}

export async function addCustomScanPath(scanPath: string, options: SettingsStateOptions = {}): Promise<SettingsState> {
  const normalizedScanPath = requireCustomScanPath(scanPath, options);
  const { config, paths } = await resolveSettingsContext(options);
  const customScanPaths = config.customScanPaths.includes(normalizedScanPath)
    ? config.customScanPaths
    : [...config.customScanPaths, normalizedScanPath];

  await writeSkillIndexConfig(paths.configFile, {
    ...config,
    customScanPaths,
  });

  const { config: globalConfig } = await resolveGlobalSettingsContext(options);
  return toSettingsState({ ...config, customScanPaths }, globalConfig);
}

export async function removeCustomScanPath(scanPath: string, options: SettingsStateOptions = {}): Promise<SettingsState> {
  const normalizedScanPath = requireCustomScanPath(scanPath, options);
  const { config, paths } = await resolveSettingsContext(options);
  const customScanPaths = config.customScanPaths.filter((configuredPath) => configuredPath !== normalizedScanPath);

  await writeSkillIndexConfig(paths.configFile, {
    ...config,
    customScanPaths,
  });

  const { config: globalConfig } = await resolveGlobalSettingsContext(options);
  return toSettingsState({ ...config, customScanPaths }, globalConfig);
}

export async function setPreferredCanonicalSourcePath(
  scanPath: string,
  options: SettingsStateOptions = {},
): Promise<SettingsState> {
  const normalizedScanPath = requireCustomScanPath(scanPath, options);
  const { config, paths } = await resolveSettingsContext(options);

  await writeSkillIndexConfig(paths.configFile, {
    ...config,
    preferredCanonicalSourcePath: normalizedScanPath,
  });

  const { config: globalConfig } = await resolveGlobalSettingsContext(options);
  return toSettingsState({ ...config, preferredCanonicalSourcePath: normalizedScanPath }, globalConfig);
}

export async function clearPreferredCanonicalSourcePath(options: SettingsStateOptions = {}): Promise<SettingsState> {
  const { config, paths } = await resolveSettingsContext(options);

  await writeSkillIndexConfig(paths.configFile, {
    ...config,
    preferredCanonicalSourcePath: null,
  });

  const { config: globalConfig } = await resolveGlobalSettingsContext(options);
  return toSettingsState({ ...config, preferredCanonicalSourcePath: null }, globalConfig);
}

export async function setDevSidebarInventorySourceSwitcherVisible(
  visible: boolean,
  options: SettingsStateOptions = {},
): Promise<SettingsState> {
  const { config: globalConfig, paths: globalPaths } = await resolveGlobalSettingsContext(options);

  await writeSkillIndexConfig(globalPaths.configFile, {
    ...globalConfig,
    showDevSidebarInventorySourceSwitcher: visible,
  });

  const { config } = await resolveSettingsContext(options);
  return toSettingsState(config, {
    ...globalConfig,
    showDevSidebarInventorySourceSwitcher: visible,
  });
}

export async function completeOnboarding(
  request: CompleteOnboardingRequest = {},
  options: SettingsStateOptions = {},
): Promise<SettingsState> {
  const { config, paths } = await resolveSettingsContext(options);
  const { config: globalConfig, paths: globalPaths } = await resolveGlobalSettingsContext(options);
  const hasPreferredCanonicalSourcePathRequest = Object.hasOwn(request, 'preferredCanonicalSourcePath');
  const preferredCanonicalSourcePath = hasPreferredCanonicalSourcePathRequest
    ? (
        request.preferredCanonicalSourcePath?.trim()
          ? requireCustomScanPath(request.preferredCanonicalSourcePath, options)
          : null
      )
    : config.preferredCanonicalSourcePath;
  const customScanPaths = hasPreferredCanonicalSourcePathRequest
    && preferredCanonicalSourcePath
    && !config.customScanPaths.includes(preferredCanonicalSourcePath)
    ? [...config.customScanPaths, preferredCanonicalSourcePath]
    : config.customScanPaths;
  const onboardingCompletedAt = request.completedAt ?? new Date().toISOString();
  const nextConfig: SkillIndexConfig = {
    ...config,
    customScanPaths,
    preferredCanonicalSourcePath,
  };
  const nextGlobalConfig: SkillIndexConfig = {
    ...globalConfig,
    onboardingCompletedAt,
  };

  if (paths.configFile === globalPaths.configFile) {
    const nextSharedConfig: SkillIndexConfig = {
      ...nextConfig,
      onboardingCompletedAt,
    };
    await writeSkillIndexConfig(paths.configFile, nextSharedConfig);
    return toSettingsState(nextSharedConfig, nextSharedConfig);
  }

  await writeSkillIndexConfig(paths.configFile, nextConfig);
  await writeSkillIndexConfig(globalPaths.configFile, nextGlobalConfig);

  return toSettingsState(nextConfig, nextGlobalConfig);
}

function requireCustomScanPath(scanPath: string, options: ResolveSkillIndexScanPathOptions): string {
  const trimmedScanPath = scanPath.trim();
  if (!trimmedScanPath) {
    throw new Error('Enter a custom scan path before saving.');
  }

  return normalizeCustomScanPath(trimmedScanPath, options);
}

async function resolveSettingsContext(options: SettingsStateOptions) {
  const paths = resolveSkillIndexPathsForScanOptions(options);
  await ensureSkillIndexLayout(paths);
  const config = await readSkillIndexConfig(paths.configFile, options);

  return {
    config,
    paths,
  };
}

async function resolveGlobalSettingsContext(options: SettingsStateOptions) {
  const paths = resolveRootSkillIndexStatePaths(options);
  await ensureSkillIndexLayout(paths);
  const config = await readSkillIndexConfig(paths.configFile, options);

  return {
    config,
    paths,
  };
}

function toSettingsState(config: SkillIndexConfig, globalConfig: SkillIndexConfig): SettingsState {
  return {
    customScanPaths: config.customScanPaths,
    onboardingCompletedAt: globalConfig.onboardingCompletedAt ?? null,
    preferredCanonicalSourcePath: config.preferredCanonicalSourcePath,
    showDevSidebarInventorySourceSwitcher: globalConfig.showDevSidebarInventorySourceSwitcher,
  };
}
