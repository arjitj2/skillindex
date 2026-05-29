import type {
  AgentIconRecord,
  AgentMcpConfigKind,
  AgentMcpParserKind,
  AgentMcpSupportedTransport,
  AgentMcpWriteDialect,
  AgentMetadataSource,
  AgentSubagentConfigKind,
  AgentSubagentParserKind,
  AgentSubagentWriteDialect,
} from './contracts';
import {
  UPSTREAM_AGENT_FAMILIES,
  type UpstreamAgentFamilyDefinition,
  type UpstreamAgentResolutionContext,
} from './upstream-agent-catalog';
import { KNOWN_AGENT_FAMILY_OVERRIDES, type KnownAgentFamilyOverrideDefinition } from './agent-catalog-overrides';
import {
  VERIFIED_AGENT_SKILL_DIRECTORIES,
  type VerifiedAgentSkillDirectoryFacts,
} from './verified-agent-skill-directories';
import { joinPath } from './path-utils';

export interface KnownAgentFamilyDefinition {
  family: string;
  label: string;
  aliases?: string[];
  defaultProjectSkillsDir: string;
  defaultGlobalSkillsDir: string;
  compatibleGlobalSkillsDirs: string[];
  compatibleProjectSkillsDirs: string[];
  skillStorageKind: 'local-directory' | 'account-managed';
  upstreamDefaultGlobalSkillsDir: string;
  ignoredSkillSubpathsByDisplayPath?: Record<string, string[]>;
  mcpConfigRelativeParts?: string[];
  agentConfigRelativeParts?: string[];
  expectedExecutableNames?: string[];
  mcpConfigKind?: AgentMcpConfigKind;
  mcpParserKind?: AgentMcpParserKind;
  mcpWriteDialect?: AgentMcpWriteDialect;
  mcpSupportedTransports?: AgentMcpSupportedTransport[];
  subagentConfigKind?: AgentSubagentConfigKind;
  subagentParserKind?: AgentSubagentParserKind;
  subagentWriteDialect?: AgentSubagentWriteDialect;
  subagentGlobalDirRelativeParts?: string[];
  subagentProjectDir?: string;
  metadataSources?: AgentMetadataSource[];
  icon?: AgentIconRecord;
  resolveLiveSkillsDir: (context?: UpstreamAgentResolutionContext) => string;
  resolveLiveMcpConfigPath?: (context?: UpstreamAgentResolutionContext) => string;
  resolveLiveAgentConfigPath?: (context?: UpstreamAgentResolutionContext) => string;
  resolveLiveSubagentsDir?: (context?: UpstreamAgentResolutionContext) => string;
  detectInstalled: (context?: UpstreamAgentResolutionContext) => boolean;
}

const knownAgentFamilyOverrides = new Map<string, KnownAgentFamilyOverrideDefinition>(
  KNOWN_AGENT_FAMILY_OVERRIDES.map((override) => [override.family, override]),
);

const verifiedAgentSkillDirectories = new Map<string, VerifiedAgentSkillDirectoryFacts>(
  VERIFIED_AGENT_SKILL_DIRECTORIES.map((facts) => [facts.family, facts]),
);

export const KNOWN_AGENT_FAMILIES: readonly KnownAgentFamilyDefinition[] = (UPSTREAM_AGENT_FAMILIES as readonly UpstreamAgentFamilyDefinition[]).map((upstreamFamily) => {
  const override = knownAgentFamilyOverrides.get(upstreamFamily.family);
  if (!override) {
    throw new Error(`Missing agent catalog override for ${upstreamFamily.family}`);
  }

  const verifiedSkillDirs = verifiedAgentSkillDirectories.get(upstreamFamily.family);
  const aliases = [...new Set([...(upstreamFamily.aliases ?? []), ...(override.aliases ?? [])])];
  const defaultGlobalSkillsDir = verifiedSkillDirs?.defaultGlobalSkillsDir ?? upstreamFamily.defaultGlobalSkillsDir;
  const compatibleGlobalSkillsDirs = mergeCompatibleGlobalSkillsDirs(
    defaultGlobalSkillsDir,
    upstreamFamily.defaultGlobalSkillsDir,
    upstreamFamily.compatibleGlobalSkillsDirs,
    verifiedSkillDirs?.compatibleGlobalSkillsDirs,
  );
  const metadataSources = mergeMetadataSources(override.metadataSources, verifiedSkillDirs?.evidence);

  return {
    family: upstreamFamily.family,
    label: override.label ?? upstreamFamily.label,
    aliases: aliases.length > 0 ? aliases : undefined,
    defaultProjectSkillsDir: upstreamFamily.defaultProjectSkillsDir,
    defaultGlobalSkillsDir,
    compatibleGlobalSkillsDirs,
    compatibleProjectSkillsDirs: [...(upstreamFamily.compatibleProjectSkillsDirs ?? [])],
    skillStorageKind: upstreamFamily.skillStorageKind ?? 'local-directory',
    upstreamDefaultGlobalSkillsDir: upstreamFamily.defaultGlobalSkillsDir,
    ignoredSkillSubpathsByDisplayPath: override.ignoredSkillSubpathsByDisplayPath,
    mcpConfigRelativeParts: override.mcpConfigRelativeParts,
    agentConfigRelativeParts: override.agentConfigRelativeParts,
    expectedExecutableNames: override.expectedExecutableNames,
    mcpConfigKind: override.mcpConfigKind,
    mcpParserKind: override.mcpParserKind,
    mcpWriteDialect: override.mcpWriteDialect,
    mcpSupportedTransports: override.mcpSupportedTransports,
    subagentConfigKind: override.subagentConfigKind,
    subagentParserKind: override.subagentParserKind,
    subagentWriteDialect: override.subagentWriteDialect,
    subagentGlobalDirRelativeParts: override.subagentGlobalDirRelativeParts,
    subagentProjectDir: override.subagentProjectDir,
    metadataSources,
    icon: override.icon,
    resolveLiveSkillsDir: upstreamFamily.resolveGlobalSkillsDir,
    resolveLiveMcpConfigPath: override.resolveLiveMcpConfigPathOverride,
    resolveLiveAgentConfigPath: override.resolveLiveAgentConfigPathOverride,
    resolveLiveSubagentsDir: override.resolveLiveSubagentsDirOverride,
    detectInstalled: upstreamFamily.detectInstalled,
  };
});

export type KnownAgentFamily = (typeof KNOWN_AGENT_FAMILIES)[number]['family'];

export function resolveAgentHomeRelativePath(rootDir: string, targetPath: string): string {
  const normalizedPath = targetPath === '~'
    ? ''
    : targetPath.replace(/^~[\\/]/u, '').replace(/^~/u, '');
  const segments = normalizedPath.split(/[\\/]/u).filter(Boolean);
  return joinPath(rootDir, ...segments);
}

export function deriveAgentDefaultHomeDir(projectSkillsDir: string, globalSkillsDir: string): string {
  const normalizedProjectDir = trimTrailingSlash(projectSkillsDir);
  if (normalizedProjectDir.startsWith('.')) {
    const projectHomeDir = stripSkillsSuffix(normalizedProjectDir);
    if (projectHomeDir !== normalizedProjectDir) {
      return `~/${projectHomeDir}`;
    }
  }

  return stripSkillsSuffix(trimTrailingSlash(globalSkillsDir));
}

function stripSkillsSuffix(targetPath: string): string {
  return targetPath.replace(/\/skills$/u, '');
}

function trimTrailingSlash(targetPath: string): string {
  return targetPath.replace(/\/+$/u, '');
}

export function getKnownAgentFamily(family: KnownAgentFamily): KnownAgentFamilyDefinition {
  return KNOWN_AGENT_FAMILIES.find((candidate) => candidate.family === family)
    ?? (() => {
      throw new Error(`Missing merged known agent family ${family}`);
    })();
}

function mergeCompatibleGlobalSkillsDirs(...groups: Array<readonly string[] | string | undefined>): string[] {
  const merged: string[] = [];
  for (const group of groups) {
    if (!group) {
      continue;
    }

  const values: readonly string[] = Array.isArray(group) ? group : [group];
    for (const value of values) {
      if (!merged.includes(value)) {
        merged.push(value);
      }
    }
  }

  return merged;
}

function mergeMetadataSources(
  ...groups: Array<readonly AgentMetadataSource[] | undefined>
): AgentMetadataSource[] | undefined {
  const merged: AgentMetadataSource[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group) {
      continue;
    }

    for (const source of group) {
      const key = `${source.url}\n${source.note ?? ''}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(source);
    }
  }

  return merged.length > 0 ? merged : undefined;
}
