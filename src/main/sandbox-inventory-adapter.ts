import path from 'node:path';

import type { SkillScanSource } from '@shared/contracts';
import { resolveAgentHomeRelativePath, type AgentCatalogEntry } from '@shared/agent-catalog';
import type { SkillIndexPaths } from '@shared/skill-index-paths';

export function createSandboxPluginSource(paths: SkillIndexPaths): SkillScanSource {
  return {
    id: 'sandbox-plugin-pack',
    label: 'Sandbox Plugin bundle',
    canonical: false,
    kind: 'plugin',
    writable: false,
    scope: 'sandbox',
    skillsDir: path.join(paths.sandboxRoot, 'plugins', 'skills'),
    preferredCanonical: false,
    compatibleAgentFamilies: [],
  };
}

export function resolveSandboxSkillsDir(rootDir: string, displayPath: string): string {
  return resolveAgentHomeRelativePath(rootDir, displayPath);
}

export function resolveSandboxAgentRuntimePaths(
  rootDir: string,
  family: AgentCatalogEntry,
): {
  installResolutionContext: { cwd: string; env: NodeJS.ProcessEnv; homeDir: string };
  mcpConfigPath?: string;
  configPath?: string;
  subagentsDir?: string;
  executablePath?: string;
} {
  return {
    installResolutionContext: { cwd: rootDir, env: {}, homeDir: rootDir },
    mcpConfigPath: family.mcpConfigRelativeParts ? path.join(rootDir, ...family.mcpConfigRelativeParts) : undefined,
    configPath: family.agentConfigRelativeParts ? path.join(rootDir, ...family.agentConfigRelativeParts) : undefined,
    subagentsDir: family.subagentGlobalDirRelativeParts ? path.join(rootDir, ...family.subagentGlobalDirRelativeParts) : undefined,
    executablePath: family.expectedExecutableNames?.[0]
      ? path.join(rootDir, 'bin', family.expectedExecutableNames[0])
      : undefined,
  };
}
