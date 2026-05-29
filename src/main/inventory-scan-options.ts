import type { ScanInventoryOptions } from '@shared/contracts';
import type { ResolveSkillIndexPathOptions, SkillIndexPaths } from '@shared/skill-index-paths';

import type { McpConnectivityVerifier } from '@main/mcp-inventory';

export interface ScanSkillInventoryOptions extends ScanInventoryOptions, ResolveSkillIndexPathOptions {
  paths?: SkillIndexPaths;
  verifyMcpConnectivity?: boolean | McpConnectivityVerifier;
  mcpConnectivityAbortSignal?: AbortSignal;
  mcpConnectivityTimeoutMs?: number;
  mcpConnectivityConcurrency?: number;
  writeCache?: boolean;
}

export function applyDefaultInventoryMode<T extends ScanSkillInventoryOptions>(options: T): T {
  if (options.includeLiveSources !== undefined || options.includeSandboxSources !== undefined) {
    return options;
  }

  return {
    ...options,
    includeLiveSources: true,
    includeSandboxSources: false,
  };
}
