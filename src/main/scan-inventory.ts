import type {
  DismissDriftRequest,
  PluginRecord,
  SkillInventorySnapshot,
  SkillScanSource,
} from '@shared/contracts';
import {
  ensureSkillIndexSandboxLayout,
  ensureSkillIndexLayout,
  readSkillIndexConfig,
  readSkillIndexConfigSync,
  resolveSkillIndexPathsForScanOptions,
  writeSkillIndexConfig,
  type SkillIndexConfig,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import {
  buildInventoryAgents,
  buildInventoryAgentsSync,
  buildRegisteredInventorySources,
  filterInstalledInventorySources,
  filterInstalledInventorySourcesSync,
} from '@main/inventory-source-model';
import { applyDefaultInventoryMode, type ScanSkillInventoryOptions } from '@main/inventory-scan-options';
import {
  applyDismissedMcpState,
  applyMcpPresentation,
  collectMcpRecords,
  compareMcps,
  countMcps,
} from '@main/mcp-inventory';
import { buildPluginSkillScanSources, scanPluginInventory } from '@main/plugin-inventory';
import {
  applyDismissedDriftState,
  buildHomeSummary,
  collectSkillInventoryRecords,
  countAgents,
  countSkills,
  persistDismissedDriftSignatures,
  readSkillInventoryCache,
  readSkillInventoryCacheSync,
  reconcileSkillInventorySnapshot,
  writeSkillInventoryCache,
} from '@main/skill-inventory';
import {
  applyDismissedSubagentState,
  applySubagentPresentation,
  collectSubagentRecords,
  countSubagents,
} from '@main/subagent-inventory';

export type { ScanSkillInventoryOptions } from '@main/inventory-scan-options';

export async function scanInventory(options: ScanSkillInventoryOptions = {}): Promise<SkillInventorySnapshot> {
  const scanOptions = applyDefaultInventoryMode(options);
  const { agents, config, paths, registeredSources, sources, plugins } = await resolveScanContext(scanOptions);
  const skills = await collectSkillInventoryRecords({
    sources,
    registeredSources,
    agents,
    config,
  });
  const skillCounts = countSkills(skills);
  const mcps = (await collectMcpRecords(agents, sources, plugins, scanOptions)).map((mcp) =>
    applyMcpPresentation(mcp, config.dismissedMcpSignatures)).sort(compareMcps);
  const mcpCounts = countMcps(mcps);
  const subagents = collectSubagentRecords({
    agents,
    plugins,
    paths,
    includeLiveSources: scanOptions.includeLiveSources,
    includeSandboxSources: scanOptions.includeSandboxSources,
  }).map((subagent) => applySubagentPresentation(subagent, config.dismissedSubagentSignatures));
  const subagentCounts = countSubagents(subagents);
  const agentCounts = countAgents(agents);

  const snapshot: SkillInventorySnapshot = {
    scannedAt: new Date().toISOString(),
    sourceIds: sources.map((source) => source.id),
    sources,
    plugins,
    skills,
    counts: skillCounts,
    mcps,
    mcpCounts,
    subagents,
    subagentCounts,
    agents,
    agentCounts,
    homeSummary: buildHomeSummary(skillCounts, mcpCounts, agentCounts),
  };

  await persistDismissedDriftSignatures(paths.configFile, skills, scanOptions);
  if (scanOptions.writeCache !== false) {
    await writeSkillInventoryCache(paths.cacheFile, snapshot);
  }

  return snapshot;
}

export async function writeInventorySnapshotCache(
  snapshot: SkillInventorySnapshot,
  options: ScanSkillInventoryOptions = {},
): Promise<void> {
  const paths = options.paths ?? resolveSkillIndexPathsForScanOptions(options);
  await writeSkillInventoryCache(paths.cacheFile, snapshot);
}

export async function readCachedInventory(
  options: ScanSkillInventoryOptions = {},
): Promise<SkillInventorySnapshot | null> {
  const scanOptions = applyDefaultInventoryMode(options);
  const { agents, config, paths, registeredSources, sources, plugins } = await resolveScanContext(scanOptions);
  const cachedSnapshot = await readSkillInventoryCache(paths.cacheFile);
  if (!cachedSnapshot) {
    return null;
  }

  return reconcileSkillInventorySnapshot(
    cachedSnapshot,
    registeredSources,
    sources,
    agents,
    plugins,
    config.skillUniversalDecisions ?? [],
    config.dismissedDriftSignatures,
    config.dismissedMcpSignatures,
    config.dismissedSubagentSignatures,
  );
}

export function readCachedInventorySync(
  options: ScanSkillInventoryOptions = {},
): SkillInventorySnapshot | null {
  const scanOptions = applyDefaultInventoryMode(options);
  const paths = resolveSkillIndexPathsForScanOptions(scanOptions);
  const config = readSkillIndexConfigSync(paths.configFile, scanOptions);
  const registeredSources = buildRegisteredInventorySources({
    ...scanOptions,
    paths,
    customScanPaths: config.customScanPaths,
    preferredCanonicalSourcePath: config.preferredCanonicalSourcePath,
  });
  const sources = filterInstalledInventorySourcesSync(registeredSources);
  const agents = buildInventoryAgentsSync({
    ...scanOptions,
    paths,
    customScanPaths: config.customScanPaths,
  });
  const cachedSnapshot = readSkillInventoryCacheSync(paths.cacheFile);
  if (!cachedSnapshot) {
    return null;
  }
  const cachedPluginSources = cachedSnapshot.sources.filter((source) => source.kind === 'plugin');
  const activeRegisteredSources = mergeCachedPluginSources(registeredSources, cachedPluginSources);
  const activeSources = mergeCachedPluginSources(sources, cachedPluginSources);

  return reconcileSkillInventorySnapshot(
    cachedSnapshot,
    activeRegisteredSources,
    activeSources,
    agents,
    cachedSnapshot.plugins ?? [],
    config.skillUniversalDecisions ?? [],
    config.dismissedDriftSignatures,
    config.dismissedMcpSignatures,
    config.dismissedSubagentSignatures,
  );
}

export async function dismissDrift(
  request: DismissDriftRequest,
  options: ScanSkillInventoryOptions & { snapshot?: SkillInventorySnapshot } = {},
): Promise<SkillInventorySnapshot> {
  const scanOptions = applyDefaultInventoryMode(options);
  const paths = resolveSkillIndexPathsForScanOptions(scanOptions);
  await ensureSkillIndexLayout(paths);
  if (scanOptions.includeSandboxSources === true) {
    await ensureSkillIndexSandboxLayout(paths);
  }

  const config = await readSkillIndexConfig(paths.configFile, scanOptions);
  const snapshot = scanOptions.snapshot ?? await scanInventory({
    ...scanOptions,
    paths,
  });
  if ('skillName' in request) {
    const skill = snapshot.skills.find((candidate) => candidate.name === request.skillName);

    if (!skill || !skill.isDrifted || !skill.driftSignature) {
      throw new Error(`Only drifted skills can be dismissed or undismissed: ${request.skillName}`);
    }

    const dismissedDriftSignatures = skill.driftPresentation === 'dismissed'
      ? config.dismissedDriftSignatures.filter((signature) => signature !== skill.driftSignature)
      : [...new Set([...config.dismissedDriftSignatures, skill.driftSignature])];

    await writeSkillIndexConfig(paths.configFile, {
      ...config,
      dismissedDriftSignatures,
    });

    const nextSnapshot = applyDismissedDriftState({
      ...snapshot,
      scannedAt: new Date().toISOString(),
    }, dismissedDriftSignatures, snapshot.sources);
    await writeSkillInventoryCache(paths.cacheFile, nextSnapshot);

    return nextSnapshot;
  }

  if ('subagentName' in request) {
    const subagent = (snapshot.subagents ?? []).find((candidate) => candidate.name === request.subagentName);

    if (!subagent || subagent.status !== 'needs-attention' || !subagent.signature) {
      throw new Error(`Only attention subagents can be dismissed or undismissed: ${request.subagentName}`);
    }

    const dismissedSubagentSignatures = subagent.presentation === 'dismissed'
      ? config.dismissedSubagentSignatures.filter((signature) => signature !== subagent.signature)
      : [...new Set([...config.dismissedSubagentSignatures, subagent.signature])];

    await writeSkillIndexConfig(paths.configFile, {
      ...config,
      dismissedSubagentSignatures,
    });

    const subagents = applyDismissedSubagentState(snapshot.subagents ?? [], dismissedSubagentSignatures);
    const subagentCounts = countSubagents(subagents);
    const nextSnapshot: SkillInventorySnapshot = {
      ...snapshot,
      scannedAt: new Date().toISOString(),
      subagents,
      subagentCounts,
    };
    await writeSkillInventoryCache(paths.cacheFile, nextSnapshot);

    return nextSnapshot;
  }

  const mcp = (snapshot.mcps ?? []).find((candidate) => candidate.name === request.mcpName);
  if (!mcp || mcp.status !== 'needs-attention' || !mcp.signature) {
    throw new Error(`Only attention MCPs can be dismissed or undismissed: ${request.mcpName}`);
  }

  const dismissedMcpSignatures = mcp.presentation === 'dismissed'
    ? config.dismissedMcpSignatures.filter((signature) => signature !== mcp.signature)
    : [...new Set([...config.dismissedMcpSignatures, mcp.signature])];

  await writeSkillIndexConfig(paths.configFile, {
    ...config,
    dismissedMcpSignatures,
  });

  const mcps = applyDismissedMcpState(snapshot.mcps ?? [], dismissedMcpSignatures);
  const mcpCounts = countMcps(mcps);
  const agentCounts = snapshot.agentCounts ?? countAgents(snapshot.agents ?? []);
  const nextSnapshot: SkillInventorySnapshot = {
    ...snapshot,
    scannedAt: new Date().toISOString(),
    mcps,
    mcpCounts,
    homeSummary: buildHomeSummary(snapshot.counts, mcpCounts, agentCounts),
  };
  await writeSkillInventoryCache(paths.cacheFile, nextSnapshot);

  return nextSnapshot;
}

async function resolveScanContext(options: ScanSkillInventoryOptions): Promise<{
  config: SkillIndexConfig;
  paths: SkillIndexPaths;
  registeredSources: SkillScanSource[];
  sources: SkillScanSource[];
  agents: Awaited<ReturnType<typeof buildInventoryAgents>>;
  plugins: PluginRecord[];
}> {
  const paths = options.paths ?? resolveSkillIndexPathsForScanOptions(options);
  await ensureSkillIndexLayout(paths);
  if (options.includeSandboxSources === true) {
    await ensureSkillIndexSandboxLayout(paths);
  }

  const config = await readSkillIndexConfig(paths.configFile, options);
  const customScanPaths = mergeCustomScanPaths(config.customScanPaths, options.customScanPaths);
  const plugins = await scanPluginsForOptions(options, paths);
  const registeredSourcesWithoutPlugins = buildRegisteredInventorySources({
    ...options,
    paths,
    customScanPaths,
    preferredCanonicalSourcePath: config.preferredCanonicalSourcePath,
  });
  const pluginSources = buildPluginSkillScanSources(plugins);
  const registeredSources = [
    ...registeredSourcesWithoutPlugins,
    ...pluginSources,
  ];
  const sources = await filterInstalledInventorySources(registeredSources);
  const agents = await buildInventoryAgents({
    ...options,
    paths,
    customScanPaths,
  });

  return {
    agents,
    config,
    paths,
    registeredSources,
    sources,
    plugins,
  };
}

function mergeCachedPluginSources(sources: SkillScanSource[], cachedPluginSources: SkillScanSource[]): SkillScanSource[] {
  const sourceIds = new Set(sources.map((source) => source.id));
  return [
    ...sources,
    ...cachedPluginSources.filter((source) => !sourceIds.has(source.id)),
  ];
}

function mergeCustomScanPaths(configuredPaths: string[], requestedPaths: string[] | undefined): string[] {
  return [...new Set([...configuredPaths, ...(requestedPaths ?? [])])];
}

async function scanPluginsForOptions(options: ScanSkillInventoryOptions, paths: SkillIndexPaths): Promise<PluginRecord[]> {
  const pluginGroups = await Promise.all([
    options.includeLiveSources === true
      ? scanPluginInventory({
        homeDir: options.homeDir,
        env: options.env,
        scope: 'live',
      })
      : Promise.resolve([]),
    options.includeSandboxSources === true
      ? scanPluginInventory({
        homeDir: paths.sandboxRoot,
        env: options.env,
        scope: 'sandbox',
      })
      : Promise.resolve([]),
  ]);

  return pluginGroups.flat();
}
