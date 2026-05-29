import { accessSync, constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AgentLocationRecord, AgentRecord, ScanInventoryOptions, SkillScanSource } from '@shared/contracts';
import {
  KNOWN_AGENT_FAMILIES,
  deriveAgentDefaultHomeDir,
  resolveAgentHomeRelativePath,
  type KnownAgentFamily,
  type KnownAgentFamilyDefinition,
} from '@shared/known-agent-catalog';
import { CANONICAL_USER_SKILLS_DISPLAY_PATH, type SkillIndexPaths } from '@shared/skill-index-paths';
import {
  createSandboxPluginSource,
  resolveSandboxAgentRuntimePaths,
  resolveSandboxSkillsDir,
} from '@main/sandbox-inventory-adapter';

export interface BuildInventorySourceModelOptions extends ScanInventoryOptions {
  paths: SkillIndexPaths;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  preferredCanonicalSourcePath?: string | null;
}

type InventoryAgentFamily = KnownAgentFamily;

const INVENTORY_AGENT_FAMILIES: readonly KnownAgentFamilyDefinition[] = KNOWN_AGENT_FAMILIES;
const ALL_AGENT_FAMILIES = INVENTORY_AGENT_FAMILIES.map((family) => family.family);

export function buildRegisteredInventorySources(
  options: BuildInventorySourceModelOptions,
): SkillScanSource[] {
  const registry: SkillScanSource[] = [];
  registry.push(...buildAgentScanSources(options));
  const preferredCanonicalSourcePath = options.preferredCanonicalSourcePath
    ? path.resolve(options.preferredCanonicalSourcePath)
    : null;

  if ((options.includeLiveSources ?? true) === true && preferredCanonicalSourcePath) {
    registry.push({
      id: `preferred-canonical:${preferredCanonicalSourcePath}`,
      label: `Preferred canonical ${preferredCanonicalSourcePath}`,
      canonical: false,
      kind: 'custom',
      writable: true,
      scope: 'live',
      skillsDir: preferredCanonicalSourcePath,
      preferredCanonical: true,
      compatibleAgentFamilies: [],
    });
  }

  if ((options.includeSandboxSources ?? false) === true) {
    registry.push(createSandboxPluginSource(options.paths));
  }

  for (const customScanPath of options.customScanPaths ?? []) {
    const resolvedCustomScanPath = path.resolve(customScanPath);
    if (preferredCanonicalSourcePath && resolvedCustomScanPath === preferredCanonicalSourcePath) {
      continue;
    }

    registry.push({
      id: `custom:${customScanPath}`,
      label: `Custom ${customScanPath}`,
      canonical: false,
      kind: 'custom',
      writable: false,
      scope: 'custom',
      skillsDir: resolvedCustomScanPath,
      preferredCanonical: false,
      compatibleAgentFamilies: [],
    });
  }

  return registry;
}

export async function buildInventoryAgents(
  options: BuildInventorySourceModelOptions,
): Promise<AgentRecord[]> {
  const supportedAgents = buildInventoryAgentDefinitions(options);

  return Promise.all(
    supportedAgents.map(async (agent) => {
      const skillsExists = await pathExists(agent.skillsLocation.path);
      const mcpExists = await pathExists(agent.mcpConfigLocation.path);
      const subagentsExists = await pathExists(agent.subagentsLocation?.path);
      const configExists = await pathExists(agent.configLocation?.path);
      const executablePath = await resolveExecutablePath(agent.executableLocation?.path, options.env);
      const executableExists = Boolean(executablePath);
      const skillsLocation: AgentLocationRecord = {
        ...agent.skillsLocation,
        exists: skillsExists,
      };
      const mcpConfigLocation: AgentLocationRecord = agent.mcpConfigLocation.path
        ? {
            ...agent.mcpConfigLocation,
            exists: mcpExists,
          }
        : agent.mcpConfigLocation;
      const subagentsLocation: AgentLocationRecord | undefined = agent.subagentsLocation
        ? {
            ...agent.subagentsLocation,
            exists: subagentsExists,
          }
        : undefined;
      const configLocation: AgentLocationRecord | undefined = agent.configLocation
        ? {
            ...agent.configLocation,
            exists: configExists,
          }
        : undefined;
      const executableLocation: AgentLocationRecord | undefined = agent.executableLocation
        ? {
            ...agent.executableLocation,
            path: executablePath ?? agent.executableLocation.path,
            exists: executableExists,
          }
        : undefined;

      return {
        ...agent,
        installState: agent.installState,
        skillsLocation,
        mcpConfigLocation,
        subagentsLocation,
        configLocation,
        executableLocation,
      };
    }),
  );
}

export function buildInventoryAgentsSync(
  options: BuildInventorySourceModelOptions,
): AgentRecord[] {
  const supportedAgents = buildInventoryAgentDefinitions(options);

  return supportedAgents.map((agent) => {
    const skillsExists = pathExistsSync(agent.skillsLocation.path);
    const mcpExists = pathExistsSync(agent.mcpConfigLocation.path);
    const subagentsExists = pathExistsSync(agent.subagentsLocation?.path);
    const configExists = pathExistsSync(agent.configLocation?.path);
    const executablePath = resolveExecutablePathSync(agent.executableLocation?.path, options.env);
    const executableExists = Boolean(executablePath);
    const skillsLocation: AgentLocationRecord = {
      ...agent.skillsLocation,
      exists: skillsExists,
    };
    const mcpConfigLocation: AgentLocationRecord = agent.mcpConfigLocation.path
      ? {
          ...agent.mcpConfigLocation,
          exists: mcpExists,
        }
      : agent.mcpConfigLocation;
    const subagentsLocation: AgentLocationRecord | undefined = agent.subagentsLocation
      ? {
          ...agent.subagentsLocation,
          exists: subagentsExists,
        }
      : undefined;
    const configLocation: AgentLocationRecord | undefined = agent.configLocation
      ? {
          ...agent.configLocation,
          exists: configExists,
        }
      : undefined;
    const executableLocation: AgentLocationRecord | undefined = agent.executableLocation
      ? {
          ...agent.executableLocation,
          path: executablePath ?? agent.executableLocation.path,
          exists: executableExists,
        }
      : undefined;

    return {
      ...agent,
      installState: agent.installState,
      skillsLocation,
      mcpConfigLocation,
      subagentsLocation,
      configLocation,
      executableLocation,
    };
  });
}

export async function filterInstalledInventorySources(sources: SkillScanSource[]): Promise<SkillScanSource[]> {
  const installed = await Promise.all(
    sources.map(async (source) => ({
      source,
      exists: await directoryExists(source.skillsDir),
    })),
  );

  return installed.filter((entry) => entry.exists).map((entry) => entry.source);
}

export function filterInstalledInventorySourcesSync(sources: SkillScanSource[]): SkillScanSource[] {
  return sources.filter((source) => directoryExistsSync(source.skillsDir));
}

function createCompatibleSourceDefinitions(
  scope: 'sandbox' | 'live',
  selection: {
    agents: Set<InventoryAgentFamily>;
    sourceKeys: Set<string>;
    hasExplicitSelection: boolean;
  },
  rootDir: string,
  displayHomeDir: string,
  env?: NodeJS.ProcessEnv,
): SkillScanSource[] {
  const sourceByPath = new Map<string, SkillScanSource>();
  const liveResolutionContext = { env, homeDir: displayHomeDir };

  for (const family of INVENTORY_AGENT_FAMILIES) {
    const familyDefinition = family;
    if (familyDefinition.skillStorageKind !== 'local-directory') {
      continue;
    }

    const compatibleAgentFamily = familyDefinition.family;
    const candidateSkillsDirs = new Map<string, string>();
    candidateSkillsDirs.set(
      familyDefinition.defaultGlobalSkillsDir,
      resolvePhysicalSkillsDir(scope, rootDir, familyDefinition, familyDefinition.defaultGlobalSkillsDir, liveResolutionContext),
    );
    for (const compatibleGlobalSkillsDir of familyDefinition.compatibleGlobalSkillsDirs) {
      if (!candidateSkillsDirs.has(compatibleGlobalSkillsDir)) {
        candidateSkillsDirs.set(
          compatibleGlobalSkillsDir,
          resolvePhysicalSkillsDir(scope, rootDir, familyDefinition, compatibleGlobalSkillsDir, liveResolutionContext),
        );
      }
    }

    for (const [displayPath, skillsDir] of candidateSkillsDirs) {
      if (displayPath === CANONICAL_USER_SKILLS_DISPLAY_PATH) {
        continue;
      }

      const ignoredSkillSubpaths = normalizeIgnoredSkillSubpaths(
        familyDefinition.ignoredSkillSubpathsByDisplayPath?.[displayPath],
      );
      const sourceKey = createSourcePathId(displayPath);
      const sourceMatchesSelection = !selection.hasExplicitSelection
        || selection.sourceKeys.has(sourceKey)
        || selection.agents.has(compatibleAgentFamily);
      if (!sourceMatchesSelection) {
        continue;
      }

      const existing = sourceByPath.get(skillsDir);
      if (existing) {
        existing.compatibleAgentFamilies ??= [];
        if (!existing.compatibleAgentFamilies.includes(compatibleAgentFamily)) {
          existing.compatibleAgentFamilies.push(compatibleAgentFamily);
        }
        existing.ignoredSkillSubpaths = mergeIgnoredSkillSubpaths(existing.ignoredSkillSubpaths, ignoredSkillSubpaths);
        continue;
      }

      const resolvedSkillsDir = skillsDir;
      sourceByPath.set(resolvedSkillsDir, {
        id: `${scope}-${sourceKey}`,
        label: `${scope === 'sandbox' ? 'Sandbox' : 'Live'} ${createSourceLabel(displayPath)}`,
        canonical: false,
        kind: 'agent',
        writable: isWritableAgentScope(scope),
        scope,
        skillsDir: resolvedSkillsDir,
        preferredCanonical: false,
        compatibleAgentFamilies: [compatibleAgentFamily],
        ignoredSkillSubpaths,
      });
    }
  }

  return [...sourceByPath.values()];
}

function resolvePhysicalSkillsDir(
  scope: 'sandbox' | 'live',
  rootDir: string,
  family: KnownAgentFamilyDefinition,
  displayPath: string,
  liveResolutionContext: { env?: NodeJS.ProcessEnv; homeDir: string },
): string {
  if (scope === 'sandbox') {
    return resolveSandboxSkillsDir(rootDir, displayPath);
  }

  if (displayPath === family.upstreamDefaultGlobalSkillsDir) {
    return family.resolveLiveSkillsDir(liveResolutionContext);
  }

  return resolveAgentHomeRelativePath(rootDir, displayPath);
}

function buildAgentScanSources(options: BuildInventorySourceModelOptions): SkillScanSource[] {
  const includeSandboxSources = options.includeSandboxSources ?? false;
  const includeLiveSources = options.includeLiveSources ?? true;
  const selection = getSelectedFamilies(options.env ?? process.env);
  const registry: SkillScanSource[] = [];

  if (includeSandboxSources) {
    registry.push(createCanonicalUserSkillsSource('sandbox', options.paths.sandboxCanonicalUserSkillsDir));
    registry.push(...createCompatibleSourceDefinitions('sandbox', selection, options.paths.sandboxRoot, options.homeDir ?? homedir(), options.env));
  }

  if (includeLiveSources) {
    const homeDir = options.homeDir ?? homedir();
    registry.push(createCanonicalUserSkillsSource('live', options.paths.liveCanonicalUserSkillsDir));
    registry.push(...createCompatibleSourceDefinitions('live', selection, homeDir, homeDir, options.env));
  }

  return registry;
}

function createCanonicalUserSkillsSource(scope: 'sandbox' | 'live', skillsDir: string): SkillScanSource {
  return {
    id: `${scope}-agents`,
    label: `${scope === 'sandbox' ? 'Sandbox' : 'Live'} .agents`,
    canonical: true,
    kind: 'canonical',
    writable: true,
    scope,
    skillsDir,
    preferredCanonical: false,
    compatibleAgentFamilies: [],
  };
}

function buildInventoryAgentDefinitions(options: BuildInventorySourceModelOptions): AgentRecord[] {
  const includeSandboxSources = options.includeSandboxSources ?? false;
  const includeLiveSources = options.includeLiveSources ?? true;
  const selection = getSelectedFamilies(options.env ?? process.env);
  const displayHomeDir = options.homeDir ?? homedir();
  const registry: AgentRecord[] = [];

  if (includeSandboxSources) {
    registry.push(...INVENTORY_AGENT_FAMILIES.flatMap((family) =>
      isSelectedInventoryAgent(family, selection)
        ? [createAgentRecord('sandbox', family, options.paths.sandboxRoot, displayHomeDir, options.env)]
        : []));
  }

  if (includeLiveSources) {
    registry.push(...INVENTORY_AGENT_FAMILIES.flatMap((family) =>
      isSelectedInventoryAgent(family, selection)
        ? [createAgentRecord('live', family, displayHomeDir, displayHomeDir, options.env)]
        : []));
  }

  return registry;
}

function createSourcePathId(displayPath: string): string {
  const normalized = normalizePath(displayPath.replace(/^~\//u, '').replace(/\/skills$/u, ''));
  switch (normalized) {
    case '.agents':
      return 'agents';
    case '.claude':
      return 'claude';
    case '.factory':
      return 'factory';
    case '.codeium/windsurf':
      return 'windsurf';
    case '.codex':
      return 'codex';
    default:
      return createPathBasedSourceId(normalized) ?? 'skills';
  }
}

function createPathBasedSourceId(normalizedPath: string): string | undefined {
  const segments = normalizedPath.split('/').filter((segment) => segment);
  if (segments.length === 0) {
    return undefined;
  }

  if (segments[0] === '.config') {
    return `config-${segments.slice(1).map(stripLeadingDot).join('-')}`;
  }

  return segments.map(stripLeadingDot).join('-');
}

function stripLeadingDot(segment: string): string {
  return segment.replace(/^\./u, '');
}

function normalizeIgnoredSkillSubpaths(values: readonly string[] | undefined): string[] | undefined {
  const normalized = [...new Set((values ?? [])
    .map((value) => value.replace(/[\\/]+/gu, '/').replace(/^\/+|\/+$/gu, ''))
    .filter((value) => value.length > 0))];
  return normalized.length > 0 ? normalized : undefined;
}

function mergeIgnoredSkillSubpaths(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
): string[] | undefined {
  return normalizeIgnoredSkillSubpaths([...(existing ?? []), ...(incoming ?? [])]);
}

function normalizePath(targetPath: string): string {
  return targetPath.replace(/[\\/]+/gu, '/');
}

function createSourceLabel(displayPath: string): string {
  switch (displayPath) {
    case '~/.agents/skills':
      return '.agents';
    case '~/.claude/skills':
      return 'Claude';
    case '~/.factory/skills':
      return 'Factory';
    case '~/.windsurf/skills':
    case '~/.codeium/windsurf/skills':
      return 'Windsurf';
    default:
      return displayPath.replace(/^~\//u, '').replace(/\/skills$/u, '');
  }
}

function createAgentRecord(
  scope: 'sandbox' | 'live',
  family: KnownAgentFamilyDefinition,
  rootDir: string,
  displayHomeDir: string,
  env?: NodeJS.ProcessEnv,
): AgentRecord {
  const liveResolutionContext = { env, homeDir: displayHomeDir };
  const sandboxRuntimePaths = scope === 'sandbox'
    ? resolveSandboxAgentRuntimePaths(rootDir, family)
    : null;
  const installResolutionContext = sandboxRuntimePaths?.installResolutionContext
    ?? { cwd: process.cwd(), env, homeDir: displayHomeDir };
  const mcpConfigPath = sandboxRuntimePaths?.mcpConfigPath
    ?? (family.resolveLiveMcpConfigPath
        ? family.resolveLiveMcpConfigPath(liveResolutionContext)
        : family.mcpConfigRelativeParts
          ? path.join(displayHomeDir, ...family.mcpConfigRelativeParts)
          : undefined);
  const configPath = sandboxRuntimePaths?.configPath
    ?? (family.resolveLiveAgentConfigPath
        ? family.resolveLiveAgentConfigPath(liveResolutionContext)
        : family.agentConfigRelativeParts
          ? path.join(displayHomeDir, ...family.agentConfigRelativeParts)
          : undefined);
  const executablePath = sandboxRuntimePaths?.executablePath ?? family.expectedExecutableNames?.[0];
  const subagentsPath = sandboxRuntimePaths?.subagentsDir
    ?? (family.resolveLiveSubagentsDir
        ? family.resolveLiveSubagentsDir(liveResolutionContext)
        : family.subagentGlobalDirRelativeParts
          ? path.join(displayHomeDir, ...family.subagentGlobalDirRelativeParts)
          : undefined);
  const skillsPath = family.skillStorageKind === 'local-directory'
    ? resolvePhysicalSkillsDir(
        scope,
        rootDir,
        family,
        family.defaultGlobalSkillsDir,
        liveResolutionContext,
      )
    : undefined;

  return {
    id: `${scope}-${family.family}`,
    family: family.family,
    label: family.label,
    writable: isWritableAgentScope(scope),
    scope,
    installState: family.detectInstalled(installResolutionContext) ? 'installed' : 'not-installed',
    defaultProjectSkillsDir: family.defaultProjectSkillsDir,
    defaultGlobalSkillsDir: family.defaultGlobalSkillsDir,
    defaultHomeDir: family.skillStorageKind === 'local-directory'
      ? deriveAgentDefaultHomeDir(family.defaultProjectSkillsDir, family.defaultGlobalSkillsDir)
      : '',
    mcpConfigKind: family.mcpConfigKind,
    mcpParserKind: family.mcpParserKind,
    mcpWriteDialect: family.mcpWriteDialect,
    mcpSupportedTransports: family.mcpSupportedTransports,
    subagentConfigKind: family.subagentConfigKind,
    subagentParserKind: family.subagentParserKind,
    subagentWriteDialect: family.subagentWriteDialect,
    metadataSources: family.metadataSources,
    icon: family.icon,
    skillsLocation: skillsPath
      ? {
          state: 'available',
          path: skillsPath,
          displayPath: collapseHomePath(skillsPath, displayHomeDir),
          exists: false,
        }
      : {
          state: 'unavailable',
          exists: false,
          reason: 'account-managed',
        },
    mcpConfigLocation: mcpConfigPath
      ? {
          state: 'available',
          path: mcpConfigPath,
          displayPath: collapseHomePath(mcpConfigPath, displayHomeDir),
          exists: false,
        }
      : {
          state: 'unavailable',
          exists: false,
          reason: 'not-supported',
        },
    subagentsLocation: subagentsPath
      ? {
          state: 'available',
          path: subagentsPath,
          displayPath: collapseHomePath(subagentsPath, displayHomeDir),
          exists: false,
        }
      : {
          state: 'unavailable',
          exists: false,
          reason: family.subagentConfigKind === 'account-managed' ? 'account-managed' : 'not-supported',
        },
    configLocation: configPath
      ? {
          state: 'available',
          path: configPath,
          displayPath: collapseHomePath(configPath, displayHomeDir),
          exists: false,
        }
      : {
          state: 'unavailable',
          exists: false,
          reason: 'not-supported',
        },
    executableLocation: executablePath
      ? {
          state: 'available',
          path: executablePath,
          exists: false,
        }
      : {
          state: 'unavailable',
          exists: false,
          reason: 'not-supported',
        },
  };
}

function isWritableAgentScope(scope: 'sandbox' | 'live'): boolean {
  return scope === 'sandbox' || scope === 'live';
}

function collapseHomePath(targetPath: string, homeDir: string): string {
  const normalizedTargetPath = normalizeComparablePath(targetPath);
  const normalizedHomeDir = normalizeComparablePath(homeDir);

  if (normalizedTargetPath === normalizedHomeDir) {
    return '~';
  }

  const homePrefix = `${normalizedHomeDir}/`;
  if (normalizedTargetPath.startsWith(homePrefix)) {
    return `~/${normalizedTargetPath.slice(homePrefix.length)}`;
  }

  return targetPath;
}

function normalizeComparablePath(targetPath: string): string {
  return targetPath
    .replace(/\\/gu, '/')
    .replace(/\/+$/u, '');
}

function getSelectedFamilies(env: NodeJS.ProcessEnv): {
  agents: Set<InventoryAgentFamily>;
  sourceKeys: Set<string>;
  hasExplicitSelection: boolean;
} {
  const rawSubset = env.SKILL_INDEX_AGENT_SUBSET?.trim();
  if (!rawSubset) {
    return {
      agents: new Set<InventoryAgentFamily>(ALL_AGENT_FAMILIES),
      sourceKeys: new Set<string>(),
      hasExplicitSelection: false,
    };
  }

  const selectedAgents = new Set<InventoryAgentFamily>();
  const selectedSourceKeys = new Set<string>();
  for (const value of rawSubset.split(',')) {
    const normalized = value.trim().toLowerCase();
    const selectedAgent = INVENTORY_AGENT_FAMILIES.find((family) =>
      family.family === normalized || family.aliases?.includes(normalized));
    if (selectedAgent) {
      selectedAgents.add(selectedAgent.family);
    }

    const selectedSourceKey = INVENTORY_AGENT_FAMILIES
      .flatMap((family) => family.compatibleGlobalSkillsDirs)
      .map((displayPath) => createSourcePathId(displayPath))
      .find((sourceKey) => sourceKey === normalized);
    if (selectedSourceKey) {
      selectedSourceKeys.add(selectedSourceKey);
    }
  }

  if (selectedAgents.size > 0 || selectedSourceKeys.size > 0) {
    return {
      agents: selectedAgents,
      sourceKeys: selectedSourceKeys,
      hasExplicitSelection: true,
    };
  }

  return {
    agents: new Set<InventoryAgentFamily>(ALL_AGENT_FAMILIES),
    sourceKeys: new Set<string>(),
    hasExplicitSelection: false,
  };
}

function isSelectedInventoryAgent(
  family: KnownAgentFamilyDefinition,
  selection: {
    agents: Set<InventoryAgentFamily>;
    sourceKeys: Set<string>;
    hasExplicitSelection: boolean;
  },
): boolean {
  if (!selection.hasExplicitSelection) {
    return true;
  }

  if (selection.agents.has(family.family)) {
    return true;
  }

  return family.compatibleGlobalSkillsDirs.some((displayPath) =>
    selection.sourceKeys.has(createSourcePathId(displayPath)));
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(targetPath?: string): Promise<boolean> {
  if (!targetPath) {
    return false;
  }

  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function directoryExistsSync(targetPath: string): boolean {
  try {
    accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(targetPath?: string): boolean {
  if (!targetPath) {
    return false;
  }

  try {
    accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutablePath(commandName: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (!commandName) {
    return undefined;
  }

  for (const candidate of getExecutableCandidates(commandName, env)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function resolveExecutablePathSync(commandName: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!commandName) {
    return undefined;
  }

  for (const candidate of getExecutableCandidates(commandName, env)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getExecutableCandidates(commandName: string, env: NodeJS.ProcessEnv): string[] {
  if (path.isAbsolute(commandName)) {
    return [commandName];
  }

  const searchPath = env.PATH ?? process.env.PATH ?? '';
  if (!searchPath) {
    return [];
  }

  return searchPath
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.join(entry, commandName));
}
