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
import { joinPath } from './path-utils';
import { CANONICAL_USER_SKILLS_DISPLAY_PATH } from './skill-path-policy';

export interface AgentCatalogResolutionContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathExists?: (targetPath: string) => boolean;
}

interface ResolvedAgentCatalogContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  pathExists: (targetPath: string) => boolean;
}

export interface AgentCatalogDefinition {
  family: string;
  label: string;
  aliases?: string[];
  defaultProjectSkillsDir: string;
  defaultGlobalSkillsDir: string;
  nativeGlobalSkillsDir: string;
  compatibleGlobalSkillsDirs: string[];
  compatibleProjectSkillsDirs: string[];
  skillStorageKind: 'local-directory' | 'account-managed';
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
  resolveLiveSkillsDir: (context?: AgentCatalogResolutionContext) => string;
  resolveLiveMcpConfigPath?: (context?: AgentCatalogResolutionContext) => string;
  resolveLiveAgentConfigPath?: (context?: AgentCatalogResolutionContext) => string;
  resolveLiveSubagentsDir?: (context?: AgentCatalogResolutionContext) => string;
  detectInstalled: (context?: AgentCatalogResolutionContext) => boolean;
}

type AgentCatalogEntryInput = Omit<
  AgentCatalogDefinition,
  | 'nativeGlobalSkillsDir'
  | 'compatibleGlobalSkillsDirs'
  | 'compatibleProjectSkillsDirs'
  | 'skillStorageKind'
  | 'metadataSources'
> & {
  nativeGlobalSkillsDir?: string;
  compatibleGlobalSkillsDirs?: readonly string[];
  compatibleProjectSkillsDirs?: readonly string[];
  skillStorageKind?: 'local-directory' | 'account-managed';
  metadataSources?: readonly AgentMetadataSource[];
  skillDirectoryMetadataSources?: readonly AgentMetadataSource[];
};

function resolveAgentCatalogContext(context: AgentCatalogResolutionContext = {}): ResolvedAgentCatalogContext {
  return {
    cwd: context.cwd ?? process.cwd(),
    env: context.env ?? process.env,
    homeDir: context.homeDir ?? resolveHomeDir(),
    pathExists: context.pathExists ?? pathExistsSync,
  };
}

function pathExistsSync(targetPath: string): boolean {
  const fsModule = getBuiltinModule<{ accessSync: (path: string) => void }>('node:fs');
  if (!fsModule) {
    return false;
  }

  try {
    fsModule.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveHomeDir(): string {
  const osModule = getBuiltinModule<{ homedir: () => string }>('node:os');
  if (osModule) {
    return osModule.homedir();
  }

  return process.env.HOME ?? '~';
}

function getBuiltinModule<T>(name: string): T | undefined {
  const processWithBuiltins = process as typeof process & {
    getBuiltinModule?: (moduleName: string) => object | undefined;
  };

  return processWithBuiltins.getBuiltinModule?.(name) as T | undefined;
}

function configHome(context: ResolvedAgentCatalogContext): string {
  return context.env.XDG_CONFIG_HOME?.trim() || joinPath(context.homeDir, '.config');
}

function codexHome(context: ResolvedAgentCatalogContext): string {
  return context.env.CODEX_HOME?.trim() || joinPath(context.homeDir, '.codex');
}

function claudeHome(context: ResolvedAgentCatalogContext): string {
  return context.env.CLAUDE_CONFIG_DIR?.trim() || joinPath(context.homeDir, '.claude');
}

function claudeDesktopConfigDir(context: ResolvedAgentCatalogContext): string {
  return context.env.CLAUDE_DESKTOP_CONFIG_DIR?.trim()
    || joinPath(context.homeDir, 'Library', 'Application Support', 'Claude');
}

function getOpenClawGlobalSkillsDir(context: ResolvedAgentCatalogContext): string {
  if (context.pathExists(joinPath(context.homeDir, '.openclaw'))) {
    return joinPath(context.homeDir, '.openclaw', 'skills');
  }
  if (context.pathExists(joinPath(context.homeDir, '.clawdbot'))) {
    return joinPath(context.homeDir, '.clawdbot', 'skills');
  }
  if (context.pathExists(joinPath(context.homeDir, '.moltbot'))) {
    return joinPath(context.homeDir, '.moltbot', 'skills');
  }
  return joinPath(context.homeDir, '.openclaw', 'skills');
}

function resolveHomePath(...parts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return joinPath(resolved.homeDir, ...parts);
  };
}

function resolveConfigHomeSkillsPath(...parts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return joinPath(configHome(resolved), ...parts);
  };
}

function resolveCodexHomePath(...parts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return joinPath(codexHome(resolved), ...parts);
  };
}

function resolveClaudeHomePath(...parts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return joinPath(claudeHome(resolved), ...parts);
  };
}

function detectHomeInstall(...parts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return resolved.pathExists(joinPath(resolved.homeDir, ...parts));
  };
}

function detectConfigHomeInstall(...parts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return resolved.pathExists(joinPath(configHome(resolved), ...parts));
  };
}

function detectCwdOrHomeInstall(cwdParts: string[], homeParts: string[]) {
  return (context: AgentCatalogResolutionContext = {}) => {
    const resolved = resolveAgentCatalogContext(context);
    return resolved.pathExists(joinPath(resolved.cwd, ...cwdParts))
      || resolved.pathExists(joinPath(resolved.homeDir, ...homeParts));
  };
}

function detectCodexInstall(context: AgentCatalogResolutionContext = {}): boolean {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.pathExists(codexHome(resolved)) || resolved.pathExists('/etc/codex');
}

function detectClaudeInstall(context: AgentCatalogResolutionContext = {}): boolean {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.pathExists(claudeHome(resolved));
}

function detectClaudeDesktopInstall(context: AgentCatalogResolutionContext = {}): boolean {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.pathExists(claudeDesktopConfigDir(resolved));
}

function detectOpenClawInstall(context: AgentCatalogResolutionContext = {}): boolean {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.pathExists(joinPath(resolved.homeDir, '.openclaw'))
    || resolved.pathExists(joinPath(resolved.homeDir, '.clawdbot'))
    || resolved.pathExists(joinPath(resolved.homeDir, '.moltbot'));
}

function detectReplitInstall(context: AgentCatalogResolutionContext = {}): boolean {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.pathExists(joinPath(resolved.cwd, '.replit'));
}

function resolveClaudeConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.CLAUDE_CONFIG_DIR?.trim() || joinPath(resolved.homeDir, '.claude');
}

function resolveClaudeDesktopConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.CLAUDE_DESKTOP_CONFIG_DIR?.trim()
    || joinPath(resolved.homeDir, 'Library', 'Application Support', 'Claude');
}

function resolveClineConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.CLINE_DIR?.trim() || joinPath(resolved.homeDir, '.cline');
}

function resolveCodexConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.CODEX_HOME?.trim() || joinPath(resolved.homeDir, '.codex');
}

function resolveConfigHomeDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.XDG_CONFIG_HOME?.trim() || joinPath(resolved.homeDir, '.config');
}

function resolveConfigHomePath(context: AgentCatalogResolutionContext = {}, ...parts: string[]): string {
  return joinPath(resolveConfigHomeDir(context), ...parts);
}

function resolveCopilotConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.COPILOT_HOME?.trim() || joinPath(resolved.homeDir, '.copilot');
}

function resolveGeminiCliDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.GEMINI_CLI_HOME?.trim() || joinPath(resolved.homeDir, '.gemini');
}

function resolveGooseConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.GOOSE_PATH_ROOT?.trim() || resolveConfigHomePath(resolved, 'goose');
}

function resolveKimiConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.KIMI_SHARE_DIR?.trim() || joinPath(resolved.homeDir, '.kimi');
}

function resolveMuxConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.MUX_CONFIG_ROOT?.trim() || joinPath(resolved.homeDir, '.mux');
}

function resolveOpenHandsDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.OH_PERSISTENCE_DIR?.trim() || joinPath(resolved.homeDir, '.openhands');
}

function resolveOpenClawStateDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.OPENCLAW_STATE_DIR?.trim()
    || resolved.env.OPENCLAW_HOME?.trim()
    || resolved.env.PI_CODING_AGENT_DIR?.trim()
    || joinPath(resolved.homeDir, '.openclaw');
}

function resolvePiConfigDir(context: AgentCatalogResolutionContext = {}): string {
  const resolved = resolveAgentCatalogContext(context);
  return resolved.env.PI_CODING_AGENT_DIR?.trim() || joinPath(resolved.homeDir, '.pi', 'agent');
}

function source(url: string, note?: string): AgentMetadataSource {
  return note ? { url, note } : { url };
}

function icon(assetUrl: string, format: string, note?: string, assetPathInArchive?: string): AgentIconRecord {
  return {
    assetUrl,
    format,
    note,
    assetPathInArchive,
  };
}

const RENDERABLE_ICON_FORMATS = new Set([
  'png',
  'jpg',
  'jpeg',
  'svg',
  'ico',
  'webp',
  'gif',
  'avif',
]);

function agent<const T extends AgentCatalogEntryInput>(definition: T): AgentCatalogDefinition & Pick<T, 'family'> {
  const { skillDirectoryMetadataSources, ...catalogDefinition } = definition;
  const nativeGlobalSkillsDir = catalogDefinition.nativeGlobalSkillsDir ?? catalogDefinition.defaultGlobalSkillsDir;
  const compatibleGlobalSkillsDirs = mergeCompatibleGlobalSkillsDirs(
    catalogDefinition.defaultGlobalSkillsDir,
    nativeGlobalSkillsDir,
    catalogDefinition.compatibleGlobalSkillsDirs,
  );
  const metadataSources = mergeMetadataSources(catalogDefinition.metadataSources, skillDirectoryMetadataSources);

  return {
    ...catalogDefinition,
    nativeGlobalSkillsDir,
    compatibleGlobalSkillsDirs,
    compatibleProjectSkillsDirs: [...(catalogDefinition.compatibleProjectSkillsDirs ?? [])],
    skillStorageKind: catalogDefinition.skillStorageKind ?? 'local-directory',
    metadataSources,
  };
}

export const AGENT_CATALOG = [
  agent({
    family: 'adal',
    label: 'AdaL',
    defaultProjectSkillsDir: '.adal/skills',
    defaultGlobalSkillsDir: '~/.adal/skills',
    resolveLiveSkillsDir: resolveHomePath('.adal', 'skills'),
    detectInstalled: detectHomeInstall('.adal'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.adal', 'settings.json'],
    agentConfigRelativeParts: ['.adal', 'settings.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://adal-cli-docs.onrender.com/features/mcp-support-proposed', 'Proposed MCP support and settings location'),
      source('https://github.com/SylphAI-Inc/adal-cli/blob/main/docs-site/docs/03-features/mcp-support-proposed.md', 'Upstream doc source'),
    ],
    icon: icon('https://github.com/SylphAI-Inc.png', 'png', 'Stable square fallback via the official GitHub org avatar'),
  }),
  agent({
    family: 'amp',
    label: 'Amp',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.config/agents/skills',
    compatibleGlobalSkillsDirs: ['~/.claude/skills'],
    compatibleProjectSkillsDirs: ['.claude/skills'],
    resolveLiveSkillsDir: resolveConfigHomeSkillsPath('agents', 'skills'),
    detectInstalled: detectConfigHomeInstall('amp'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.config', 'amp', 'settings.json'],
    agentConfigRelativeParts: ['.config', 'amp', 'settings.json'],
    resolveLiveMcpConfigPath: (context = {}) => resolveConfigHomePath(context, 'amp', 'settings.json'),
    resolveLiveAgentConfigPath: (context = {}) => resolveConfigHomePath(context, 'amp', 'settings.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-dotted-amp-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://ampcode.com/manual', 'Settings and MCP docs'),
      source('https://ampcode.com/news/cli-workspace-settings', 'Workspace and settings behavior'),
      source('https://ampcode.com/press-kit', 'Brand assets'),
    ],
    icon: icon('https://ampcode.com/amp-mark-color.svg', 'svg', 'Official square mark from the Amp site'),
  }),
  agent({
    family: 'antigravity',
    label: 'Antigravity',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.gemini/antigravity/skills',
    resolveLiveSkillsDir: resolveHomePath('.gemini', 'antigravity', 'skills'),
    detectInstalled: detectHomeInstall('.gemini', 'antigravity'),
    subagentConfigKind: 'plugin-only',
    subagentParserKind: 'unknown',
    mcpConfigRelativeParts: ['.gemini', 'antigravity', 'mcp_config.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://codelabs.developers.google.com/getting-started-google-antigravity', 'Getting started doc'),
      source('https://antigravity.google/', 'Official product site'),
    ],
    icon: icon('https://antigravity.google/assets/image/antigravity-logo.svg', 'svg', 'Official square mark'),
  }),
  agent({
    family: 'augment',
    label: 'Augment',
    defaultProjectSkillsDir: '.augment/skills',
    defaultGlobalSkillsDir: '~/.augment/skills',
    resolveLiveSkillsDir: resolveHomePath('.augment', 'skills'),
    detectInstalled: detectHomeInstall('.augment'),
    subagentGlobalDirRelativeParts: ['.augment', 'agents'],
    subagentProjectDir: '.augment/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.augment', 'settings.json'],
    agentConfigRelativeParts: ['.augment', 'settings.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://docs.augmentcode.com/cli/config', 'Config reference'),
      source('https://docs.augmentcode.com/cli/integrations', 'MCP and integrations'),
      source('https://docs.augmentcode.com/cli/subagents', 'Subagent directory and Markdown format'),
    ],
    icon: icon(
      'https://www.augmentcode.com/favicon.svg',
      'svg',
      'Official square favicon',
    ),
  }),
  agent({
    family: 'bob',
    label: 'IBM Bob',
    defaultProjectSkillsDir: '.bob/skills',
    defaultGlobalSkillsDir: '~/.bob/skills',
    resolveLiveSkillsDir: resolveHomePath('.bob', 'skills'),
    detectInstalled: detectHomeInstall('.bob'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.bob', 'mcp_settings.json'],
    agentConfigRelativeParts: ['.bob', 'settings.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://bob.ibm.com/docs/ide/configuration/custom-modes', 'Settings and custom modes'),
      source('https://www.ibm.com/think/tutorials/mcp-integration-ibm-bob', 'IBM MCP tutorial with Bob'),
    ],
    icon: icon('https://bob.ibm.com/icon.svg', 'svg'),
  }),
  agent({
    family: 'claude',
    defaultProjectSkillsDir: '.claude/skills',
    defaultGlobalSkillsDir: '~/.claude/skills',
    resolveLiveSkillsDir: resolveClaudeHomePath('skills'),
    detectInstalled: detectClaudeInstall,
    label: 'Claude Code',
    aliases: ['claude-code'],
    subagentGlobalDirRelativeParts: ['.claude', 'agents'],
    subagentProjectDir: '.claude/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    mcpConfigRelativeParts: ['.claude.json'],
    agentConfigRelativeParts: ['.claude', 'settings.json'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveAgentCatalogContext(context).homeDir, '.claude.json'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveClaudeConfigDir(context), 'settings.json'),
    expectedExecutableNames: ['claude'],
    metadataSources: [
      source('https://code.claude.com/docs/en/settings', 'Settings path and config root'),
      source('https://code.claude.com/docs/en/mcp', 'MCP file layout'),
      source('https://code.claude.com/docs/en/sub-agents', 'Subagent directory and Markdown format'),
      source('https://code.claude.com/docs/en/env-vars', 'CLAUDE_CONFIG_DIR override'),
    ],
    icon: icon(
      'https://cdn.prod.website-files.com/6889473510b50328dbb70ae6/68c33859cc6cd903686c66a2_apple-touch-icon.png',
      'png',
      'Official high-resolution square touch icon',
    ),
  }),
  agent({
    family: 'claude-desktop',
    defaultProjectSkillsDir: 'claude.ai Customize > Skills',
    defaultGlobalSkillsDir: 'claude.ai Customize > Skills',
    skillStorageKind: 'account-managed',
    resolveLiveSkillsDir: (context = {}) => {
      const resolved = resolveAgentCatalogContext(context);
      return claudeDesktopConfigDir(resolved);
    },
    detectInstalled: detectClaudeDesktopInstall,
    label: 'Claude Desktop',
    aliases: ['claude-for-desktop'],
    subagentConfigKind: 'account-managed',
    subagentParserKind: 'none',
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    mcpSupportedTransports: ['stdio'],
    mcpConfigRelativeParts: ['Library', 'Application Support', 'Claude', 'claude_desktop_config.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      joinPath(resolveClaudeDesktopConfigDir(context), 'claude_desktop_config.json'),
    metadataSources: [
      source('https://modelcontextprotocol.io/docs/develop/connect-local-servers', 'Claude Desktop local MCP config path and mcpServers JSON format'),
      source('https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop', 'Desktop extensions and MCPB are the current local MCP install path'),
      source('https://support.claude.com/en/articles/12512180-use-skills-in-claude', 'Claude app skills are managed from claude.ai Customize > Skills'),
      source('https://support.claude.com/en/articles/13837440-use-plugins-in-claude-cowork', 'Claude Cowork plugins can bundle sub-agents; no standalone local agent path is documented'),
    ],
    icon: icon(
      'https://cdn.prod.website-files.com/6889473510b50328dbb70ae6/68c33859cc6cd903686c66a2_apple-touch-icon.png',
      'png',
      'Official high-resolution square touch icon',
    ),
  }),
  agent({
    family: 'cline',
    label: 'Cline',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.agents/skills',
    resolveLiveSkillsDir: resolveHomePath('.agents', 'skills'),
    detectInstalled: detectHomeInstall('.cline'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.cline', 'data', 'settings', 'cline_mcp_settings.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      joinPath(resolveClineConfigDir(context), 'data', 'settings', 'cline_mcp_settings.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.cline.bot/cline-cli/configuration#setting-up-mcp-servers', 'Official Cline CLI MCP settings path and format'),
      source('https://docs.cline.bot/cline-cli/configuration#configuration-directory', 'Official Cline configuration directory layout'),
      source('https://docs.cline.bot/features/subagents', 'Built-in read-only subagents; no documented custom local subagent files'),
    ],
    icon: icon('https://cline.bot/assets/branding/brand/App%20Icons/PNG/APP_ICON_LIGHT.png', 'png', 'Official square app icon'),
  }),
  agent({
    family: 'codebuddy',
    label: 'CodeBuddy',
    defaultProjectSkillsDir: '.codebuddy/skills',
    defaultGlobalSkillsDir: '~/.codebuddy/skills',
    resolveLiveSkillsDir: resolveHomePath('.codebuddy', 'skills'),
    detectInstalled: detectCwdOrHomeInstall(['.codebuddy'], ['.codebuddy']),
    subagentGlobalDirRelativeParts: ['.codebuddy', 'agents'],
    subagentProjectDir: '.codebuddy/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.codebuddy', '.mcp.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'jsonc-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://www.codebuddy.ai/docs/cli/mcp#configuration-files', 'Official CodeBuddy CLI MCP configuration files'),
      source('https://www.codebuddy.ai/docs/cli/sub-agents', 'Sub-agent directory and Markdown format'),
    ],
    icon: icon('https://cdn.prod.website-files.com/65a6a15ecd9b4909597c6be5/689dfd72095849f4e1693503_Stack-Icon-Thin.svg', 'svg', 'Official square stack icon'),
  }),
  agent({
    family: 'codex',
    label: 'Codex',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.codex/skills',
    ],
    nativeGlobalSkillsDir: '~/.codex/skills',
    resolveLiveSkillsDir: resolveCodexHomePath('skills'),
    detectInstalled: detectCodexInstall,
    skillDirectoryMetadataSources: [
      source('https://developers.openai.com/codex/skills', 'Codex docs list ~/.agents/skills as the user-level skills directory.'),
    ],
    ignoredSkillSubpathsByDisplayPath: {
      '~/.codex/skills': ['.system'],
    },
    subagentGlobalDirRelativeParts: ['.codex', 'agents'],
    subagentProjectDir: '.codex/agents',
    resolveLiveSubagentsDir: (context = {}) => joinPath(resolveCodexConfigDir(context), 'agents'),
    subagentConfigKind: 'directory',
    subagentParserKind: 'codex-toml',
    subagentWriteDialect: 'codex-toml',
    mcpConfigRelativeParts: ['.codex', 'config.toml'],
    agentConfigRelativeParts: ['.codex', 'config.toml'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveCodexConfigDir(context), 'config.toml'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveCodexConfigDir(context), 'config.toml'),
    expectedExecutableNames: ['codex'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'toml',
    mcpWriteDialect: 'toml-codex',
    metadataSources: [
      source('https://platform.openai.com/docs/codex/cli/configuration', 'Codex config path and settings'),
      source('https://platform.openai.com/docs/codex/cli/mcp', 'Codex MCP config in TOML'),
      source('https://developers.openai.com/codex/subagents', 'Codex subagent directory and TOML format'),
    ],
    icon: icon('https://openai.com/favicon.ico', 'ico', 'OpenAI favicon fallback for Codex'),
  }),
  agent({
    family: 'command-code',
    label: 'Command Code',
    defaultProjectSkillsDir: '.commandcode/skills',
    defaultGlobalSkillsDir: '~/.commandcode/skills',
    resolveLiveSkillsDir: resolveHomePath('.commandcode', 'skills'),
    detectInstalled: detectHomeInstall('.commandcode'),
    subagentGlobalDirRelativeParts: ['.commandcode', 'agents'],
    subagentProjectDir: '.commandcode/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.commandcode', 'mcp.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://commandcode.ai/docs/mcp/manage', 'MCP config'),
      source('https://commandcode.ai/docs/skills/manage', 'Skills directory and local state'),
      source('https://commandcode.ai/docs/core-concepts/custom-agents', 'Custom agents directory and Markdown format'),
    ],
    icon: icon('https://commandcode.ai/favicon/2024/safari-pinned-tab.svg', 'svg'),
  }),
  agent({
    family: 'continue',
    label: 'Continue',
    defaultProjectSkillsDir: '.continue/skills',
    defaultGlobalSkillsDir: '~/.continue/skills',
    resolveLiveSkillsDir: resolveHomePath('.continue', 'skills'),
    detectInstalled: detectCwdOrHomeInstall(['.continue'], ['.continue']),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.continue', 'mcpServers'],
    agentConfigRelativeParts: ['.continue', 'config.yaml'],
    mcpConfigKind: 'directory',
    mcpParserKind: 'yaml',
    mcpWriteDialect: 'yaml-typed',
    metadataSources: [
      source('https://docs.continue.dev/customize/deep-dives/configuration', 'Continue config'),
      source('https://docs.continue.dev/customize/deep-dives/mcp', 'Continue MCP directory support'),
      source('https://docs.continue.dev/hub/agents/overview', 'Hosted agents; no documented local subagent directory'),
    ],
    icon: icon(
      'https://www.continue.dev/favicon.png',
      'png',
      'Official square favicon',
    ),
  }),
  agent({
    family: 'cortex',
    label: 'Cortex Code',
    defaultProjectSkillsDir: '.cortex/skills',
    defaultGlobalSkillsDir: '~/.cortex/skills',
    resolveLiveSkillsDir: resolveHomePath('.cortex', 'skills'),
    detectInstalled: detectHomeInstall('.snowflake', 'cortex'),
    subagentGlobalDirRelativeParts: ['.snowflake', 'cortex', 'agents'],
    subagentProjectDir: '.cortex/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.snowflake', 'cortex', 'mcp.json'],
    agentConfigRelativeParts: ['.snowflake', 'cortex', 'settings.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.snowflake.com/en/user-guide/cortex-code/settings', 'Cortex settings'),
      source('https://docs.snowflake.com/en/user-guide/cortex-code/extensibility', 'Cortex MCP extensibility'),
      source('https://docs.snowflake.com/en/user-guide/cortex-code/extensibility', 'Cortex custom subagents and agent directories'),
    ],
    icon: icon(
      'https://www.snowflake.com/etc.clientlibs/snowflake-site/clientlibs/clientlib-react/resources/apple-touch-icon.png?v=3',
      'png',
      'Use the square Snowflake app icon for compact agent badges',
    ),
  }),
  agent({
    family: 'crush',
    label: 'Crush',
    defaultProjectSkillsDir: '.crush/skills',
    defaultGlobalSkillsDir: '~/.crush/skills',
    resolveLiveSkillsDir: resolveHomePath('.crush', 'skills'),
    detectInstalled: detectHomeInstall('.config', 'crush'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.config', 'crush', 'crush.json'],
    agentConfigRelativeParts: ['.config', 'crush', 'crush.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.CRUSH_GLOBAL_CONFIG?.trim() || resolveConfigHomePath(context, 'crush', 'crush.json'),
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.CRUSH_GLOBAL_CONFIG?.trim() || resolveConfigHomePath(context, 'crush', 'crush.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcp',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://raw.githubusercontent.com/charmbracelet/crush/main/README.md', 'Config and usage'),
      source('https://raw.githubusercontent.com/charmbracelet/crush/main/schema.json', 'Top-level config schema'),
    ],
    icon: icon('https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/notification/crush-icon-solo.png', 'png'),
  }),
  agent({
    family: 'cursor',
    label: 'Cursor',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.cursor/skills',
    ],
    nativeGlobalSkillsDir: '~/.cursor/skills',
    resolveLiveSkillsDir: resolveHomePath('.cursor', 'skills'),
    detectInstalled: detectHomeInstall('.cursor'),
    skillDirectoryMetadataSources: [
      source('https://cursor.com/docs/skills#skill-directories', 'Cursor docs list ~/.agents/skills as a skill directory.'),
    ],
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.cursor', 'mcp.json'],
    agentConfigRelativeParts: ['.cursor', 'cli-config.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.cursor.com/en/cli/reference/configuration', 'Cursor CLI config'),
      source('https://docs.cursor.com/context/model-context-protocol', 'Cursor MCP config'),
      source('https://docs.cursor.com/agent', 'Cursor modes; no documented local custom subagent files'),
      source('https://cursor.com/brand', 'Brand assets'),
    ],
    icon: icon(
      'https://cursor.com/marketing-static/icon-512x512.png',
      'png',
      'Official square app icon',
    ),
  }),
  agent({
    family: 'dbt-wizard',
    label: 'dbt Wizard',
    aliases: ['wizard'],
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleProjectSkillsDirs: ['.claude/skills'],
    resolveLiveSkillsDir: resolveHomePath('.agents', 'skills'),
    detectInstalled: detectHomeInstall('.dbt', 'wizard'),
    skillDirectoryMetadataSources: [
      source('https://docs.getdbt.com/docs/dbt-ai/wizard-skills', 'dbt Wizard docs list .agents/skills and ~/.agents/skills for custom skills, with Claude Code skills auto-discovered for compatibility.'),
    ],
    subagentGlobalDirRelativeParts: ['.dbt', 'wizard', 'agents'],
    subagentProjectDir: '.dbt/wizard/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'codex-toml',
    subagentWriteDialect: 'codex-toml',
    mcpConfigRelativeParts: ['.dbt', 'wizard', 'config.toml'],
    agentConfigRelativeParts: ['.dbt', 'wizard', 'config.toml'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveAgentCatalogContext(context).homeDir, '.dbt', 'wizard', 'config.toml'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveAgentCatalogContext(context).homeDir, '.dbt', 'wizard', 'config.toml'),
    expectedExecutableNames: ['wizard'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'toml',
    mcpWriteDialect: 'toml-codex',
    mcpSupportedTransports: ['stdio', 'streamable-http'],
    metadataSources: [
      source('https://docs.getdbt.com/docs/platform/wizard-overview?version=2.0', 'dbt Wizard overview and CLI install commands'),
      source('https://docs.getdbt.com/docs/dbt-ai/wizard-skills', 'Skills locations, custom skill format, and built-in dbt Agent Skills'),
      source('https://docs.getdbt.com/docs/dbt-ai/wizard-subagents', 'Custom agent TOML directory and required fields'),
      source('https://docs.getdbt.com/docs/dbt-ai/wizard-mcp', 'MCP servers under [mcp_servers.NAME] in config.toml and supported transports'),
      source('https://docs.getdbt.com/docs/dbt-ai/wizard-config', 'Wizard config.toml location'),
    ],
    icon: icon('https://www.getdbt.com/favicon.ico', 'ico', 'Official dbt Labs favicon fallback'),
  }),
  agent({
    family: 'deepagents',
    label: 'Deep Agents',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.deepagents/agent/skills',
    ],
    nativeGlobalSkillsDir: '~/.deepagents/agent/skills',
    resolveLiveSkillsDir: resolveHomePath('.deepagents', 'agent', 'skills'),
    detectInstalled: detectHomeInstall('.deepagents'),
    skillDirectoryMetadataSources: [
      source('https://docs.langchain.com/oss/python/deepagents/skills', 'Deep Agents accepts configured skill directories; Skill Index treats ~/.agents/skills as the verified shared user location.'),
    ],
    subagentConfigKind: 'unknown',
    subagentParserKind: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.deepagents', '.mcp.json'],
    agentConfigRelativeParts: ['.deepagents', 'config.toml'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.langchain.com/oss/python/deepagents/cli/configuration', 'Config path'),
      source('https://docs.langchain.com/oss/python/deepagents/cli/mcp-tools', 'Dedicated MCP file'),
      source('https://docs.langchain.com/oss/python/deepagents/cli/subagents', 'Subagent format; user path is agent-name dependent'),
    ],
    icon: icon(
      'https://deepagents.org/deep_icon.svg',
      'svg',
      'Official square icon',
    ),
  }),
  agent({
    family: 'factory',
    defaultProjectSkillsDir: '.factory/skills',
    defaultGlobalSkillsDir: '~/.factory/skills',
    resolveLiveSkillsDir: resolveHomePath('.factory', 'skills'),
    detectInstalled: detectHomeInstall('.factory'),
    label: 'Factory',
    aliases: ['droid'],
    subagentGlobalDirRelativeParts: ['.factory', 'droids'],
    subagentProjectDir: '.factory/droids',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.factory', 'mcp.json'],
    agentConfigRelativeParts: ['.factory', 'settings.json'],
    expectedExecutableNames: ['factory'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://docs.factory.ai/cli/configuration/settings', 'Factory settings'),
      source('https://docs.factory.ai/factory-cli/configuration/mcp', 'Factory MCP config'),
      source('https://docs.factory.ai/cli/configuration/custom-droids', 'Custom droids directory and Markdown format'),
    ],
    icon: icon('https://factory.ai/favicon.svg', 'svg'),
  }),
  agent({
    family: 'firebender',
    label: 'Firebender',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.firebender/skills',
    ],
    nativeGlobalSkillsDir: '~/.firebender/skills',
    resolveLiveSkillsDir: resolveHomePath('.firebender', 'skills'),
    detectInstalled: detectHomeInstall('.firebender'),
    skillDirectoryMetadataSources: [
      source('https://docs.firebender.com/multi-agent/skills', 'Firebender docs say it loads ~/.agents/skills for cross-compatible skills.'),
    ],
    subagentConfigKind: 'agent-config',
    subagentParserKind: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.firebender', 'firebender.json'],
    agentConfigRelativeParts: ['.firebender', 'firebender.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://firebender.com/docs/configuration', 'Config file location'),
      source('https://firebender.com/docs/mcp', 'Inline MCP config'),
      source('https://docs.firebender.com/multi-agent/subagents', 'Subagents are files referenced from config'),
    ],
    icon: icon('https://firebender.com/icon.svg', 'svg'),
  }),
  agent({
    family: 'gemini-cli',
    label: 'Gemini CLI',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.gemini/skills',
    ],
    nativeGlobalSkillsDir: '~/.gemini/skills',
    resolveLiveSkillsDir: resolveHomePath('.gemini', 'skills'),
    detectInstalled: detectHomeInstall('.gemini'),
    skillDirectoryMetadataSources: [
      source('https://geminicli.com/docs/cli/using-agent-skills/#discovery-tiers', 'Gemini CLI docs list ~/.agents/skills as a user-skill alias.'),
    ],
    subagentGlobalDirRelativeParts: ['.gemini', 'agents'],
    subagentProjectDir: '.gemini/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.gemini', 'settings.json'],
    agentConfigRelativeParts: ['.gemini', 'settings.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.GEMINI_CLI_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveGeminiCliDir(context), 'settings.json'),
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.GEMINI_CLI_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveGeminiCliDir(context), 'settings.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-http-url',
    metadataSources: [
      source('https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md', 'Gemini CLI config'),
      source('https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md', 'Gemini CLI MCP'),
      source('https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md', 'Subagent directory and Markdown format'),
    ],
    icon: icon('https://geminicli.com/icon.png', 'png'),
  }),
  agent({
    family: 'github-copilot',
    label: 'GitHub Copilot',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.copilot/skills',
    ],
    nativeGlobalSkillsDir: '~/.copilot/skills',
    resolveLiveSkillsDir: resolveHomePath('.copilot', 'skills'),
    detectInstalled: detectHomeInstall('.copilot'),
    skillDirectoryMetadataSources: [
      source('https://docs.github.com/en/copilot/concepts/agents/about-agent-skills', 'GitHub Copilot docs list ~/.agents/skills for personal skills.'),
    ],
    subagentGlobalDirRelativeParts: ['.copilot', 'agents'],
    subagentProjectDir: '.github/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.copilot', 'mcp-config.json'],
    agentConfigRelativeParts: ['.copilot', 'config.json'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveCopilotConfigDir(context), 'mcp-config.json'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveCopilotConfigDir(context), 'config.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://docs.github.com/en/copilot/customizing-copilot/configuring-github-copilot-in-your-environment', 'Copilot config'),
      source('https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp', 'Copilot MCP'),
      source('https://docs.github.com/en/copilot/reference/custom-agents-configuration', 'Copilot custom agents paths and Markdown format'),
      source('https://brand.github.com/', 'Brand assets'),
    ],
    icon: icon('https://github.com/github.png', 'png', 'Use the square GitHub logo for compact Copilot badges'),
  }),
  agent({
    family: 'goose',
    label: 'Goose',
    defaultProjectSkillsDir: '.goose/skills',
    defaultGlobalSkillsDir: '~/.goose/skills',
    resolveLiveSkillsDir: resolveHomePath('.goose', 'skills'),
    detectInstalled: detectConfigHomeInstall('goose'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.config', 'goose', 'config.yaml'],
    agentConfigRelativeParts: ['.config', 'goose', 'config.yaml'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveGooseConfigDir(context), 'config.yaml'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveGooseConfigDir(context), 'config.yaml'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'yaml',
    mcpWriteDialect: 'yaml-typed',
    metadataSources: [
      source('https://block.github.io/goose/docs/getting-started/configuration/', 'Goose config'),
      source('https://block.github.io/goose/docs/mcp/configuration/', 'Goose MCP in YAML'),
      source('https://block.github.io/goose/docs/guides/subagents/', 'Subagents use runtime delegation/recipes, not a documented local agents directory'),
    ],
    icon: icon('https://goose-docs.ai/img/favicon.ico', 'ico', 'Official square favicon for compact badges'),
  }),
  agent({
    family: 'iflow-cli',
    label: 'iFlow CLI',
    defaultProjectSkillsDir: '.iflow/skills',
    defaultGlobalSkillsDir: '~/.iflow/skills',
    resolveLiveSkillsDir: resolveHomePath('.iflow', 'skills'),
    detectInstalled: detectHomeInstall('.iflow'),
    subagentGlobalDirRelativeParts: ['.iflow', 'agents'],
    subagentProjectDir: '.iflow/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.iflow', 'mcp', 'config.json'],
    agentConfigRelativeParts: ['.iflow', 'settings.json'],
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.IFLOW_CLI_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveAgentCatalogContext(context).homeDir, '.iflow', 'settings.json'),
    mcpConfigKind: 'mixed',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://iflow-cli.ai/docs/configuration', 'iFlow config'),
      source('https://iflow-cli.ai/docs/mcp', 'Dedicated and inline MCP support'),
      source('https://platform.iflow.cn/en/cli/examples/subagent', 'Subagent directory and Markdown frontmatter fields'),
    ],
    icon: icon('https://img.alicdn.com/imgextra/i4/O1CN01VFxaDc1s3EZKig0PM_!!6000000005710-0-tps-300-300.jpg', 'jpg'),
  }),
  agent({
    family: 'junie',
    label: 'Junie',
    defaultProjectSkillsDir: '.junie/skills',
    defaultGlobalSkillsDir: '~/.junie/skills',
    resolveLiveSkillsDir: resolveHomePath('.junie', 'skills'),
    detectInstalled: detectHomeInstall('.junie'),
    subagentGlobalDirRelativeParts: ['.junie', 'agents'],
    subagentProjectDir: '.junie/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.junie', 'mcp', 'mcp.json'],
    agentConfigRelativeParts: ['.junie', 'AGENTS.md'],
    resolveLiveAgentConfigPath: (context = {}) =>
      joinPath(resolveAgentCatalogContext(context).homeDir, '.junie', resolveAgentCatalogContext(context).env.JUNIE_GUIDELINES_FILENAME?.trim() || 'AGENTS.md'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://www.jetbrains.com/help/junie/configure-guidelines.html', 'Guidelines/config file'),
      source('https://www.jetbrains.com/help/junie/model-context-protocol.html', 'MCP settings'),
      source('https://junie.jetbrains.com/docs/junie-cli-subagents.html', 'Custom subagents directories and Markdown format'),
    ],
    icon: icon('https://resources.jetbrains.com/help/img/idea/2026.1/junie-logo.svg', 'svg'),
  }),
  agent({
    family: 'kilo',
    label: 'Kilo Code',
    defaultProjectSkillsDir: '.kilocode/skills',
    defaultGlobalSkillsDir: '~/.kilocode/skills',
    resolveLiveSkillsDir: resolveHomePath('.kilocode', 'skills'),
    detectInstalled: detectHomeInstall('.kilocode'),
    subagentGlobalDirRelativeParts: ['.config', 'kilo', 'agents'],
    subagentProjectDir: '.kilo/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.config', 'kilo', 'kilo.jsonc'],
    agentConfigRelativeParts: ['.config', 'kilo', 'kilo.jsonc'],
    resolveLiveMcpConfigPath: (context = {}) => resolveConfigHomePath(context, 'kilo', 'kilo.jsonc'),
    resolveLiveAgentConfigPath: (context = {}) => resolveConfigHomePath(context, 'kilo', 'kilo.jsonc'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-mcp',
    metadataSources: [
      source('https://kilo.ai/docs/automate/mcp/using-in-kilo-code', 'Kilo MCP in config'),
      source('https://kilo.ai/docs/customize/custom-subagents', 'Custom subagents directory and Markdown/JSONC formats'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/201822503?s=512&v=4', 'png'),
  }),
  agent({
    family: 'kimi-cli',
    label: 'Kimi Code CLI',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.config/agents/skills',
    ],
    nativeGlobalSkillsDir: '~/.config/agents/skills',
    resolveLiveSkillsDir: resolveHomePath('.config', 'agents', 'skills'),
    detectInstalled: detectHomeInstall('.kimi'),
    skillDirectoryMetadataSources: [
      source('https://moonshotai.github.io/kimi-cli/en/customization/skills.html#skill-discovery', 'Kimi CLI docs list ~/.agents/skills in the generic user-level skill group.'),
    ],
    subagentConfigKind: 'unknown',
    subagentParserKind: 'yaml',
    mcpConfigRelativeParts: ['.kimi', 'mcp.json'],
    agentConfigRelativeParts: ['.kimi', 'config.toml'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveKimiConfigDir(context), 'mcp.json'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveKimiConfigDir(context), 'config.toml'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://github.com/MoonshotAI/Kimi-K2/blob/main/docs/kimi-cli/configuration.md', 'Kimi config'),
      source('https://github.com/MoonshotAI/Kimi-K2/blob/main/docs/kimi-cli/mcp.md', 'Kimi MCP'),
      source('https://moonshotai.github.io/kimi-cli/en/customization/agents.html', 'Agent YAML supports nested subagents but no documented scanned global directory'),
    ],
    icon: icon('https://moonshotai.github.io/Branding-Guide/scenarios/04-k-only/k-only-light.svg', 'svg'),
  }),
  agent({
    family: 'kiro-cli',
    label: 'Kiro CLI',
    defaultProjectSkillsDir: '.kiro/skills',
    defaultGlobalSkillsDir: '~/.kiro/skills',
    resolveLiveSkillsDir: resolveHomePath('.kiro', 'skills'),
    detectInstalled: detectHomeInstall('.kiro'),
    subagentGlobalDirRelativeParts: ['.kiro', 'agents'],
    subagentProjectDir: '.kiro/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'json',
    subagentWriteDialect: 'json',
    mcpConfigRelativeParts: ['.kiro', 'settings', 'mcp.json'],
    agentConfigRelativeParts: ['.kiro', 'agents'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://kiro.dev/docs/configuration', 'Kiro config layout'),
      source('https://kiro.dev/docs/mcp', 'Kiro MCP settings'),
      source('https://kiro.dev/docs/cli/custom-agents/creating/', 'Custom agents directory and JSON format'),
    ],
    icon: icon('https://kiro.dev/icon.svg?fe599162bb293ea0', 'svg'),
  }),
  agent({
    family: 'kode',
    label: 'Kode',
    defaultProjectSkillsDir: '.kode/skills',
    defaultGlobalSkillsDir: '~/.kode/skills',
    resolveLiveSkillsDir: resolveHomePath('.kode', 'skills'),
    detectInstalled: detectHomeInstall('.kode'),
    subagentGlobalDirRelativeParts: ['.kode', 'agents'],
    subagentProjectDir: '.kode/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.mcp.json'],
    agentConfigRelativeParts: ['.kode.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://raw.githubusercontent.com/shareAI-lab/Kode/main/README.md', 'Main README and MCP files'),
      source('https://raw.githubusercontent.com/shareAI-lab/Kode/main/docs/develop/configuration.md', 'Config location'),
      source('https://github.com/shareAI-lab/Kode-Agent/blob/main/docs/agents-system.md', 'Agents directories and Markdown format'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/189210346?v=4', 'png', 'Stable square fallback via the ShareAI Lab org avatar'),
  }),
  agent({
    family: 'mcpjam',
    label: 'MCPJam',
    defaultProjectSkillsDir: '.mcpjam/skills',
    defaultGlobalSkillsDir: '~/.mcpjam/skills',
    resolveLiveSkillsDir: resolveHomePath('.mcpjam', 'skills'),
    detectInstalled: detectHomeInstall('.mcpjam'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://docs.mcpjam.com/installation', 'User-supplied --config file'),
      source('https://docs.mcpjam.com/inspector/launch-from-code', 'Env-provided MCP config payload'),
    ],
    icon: icon('https://raw.githubusercontent.com/MCPJam/inspector/main/mcpjam-inspector/client/public/mcp_jam.svg', 'svg'),
  }),
  agent({
    family: 'mistral-vibe',
    label: 'Mistral Vibe',
    defaultProjectSkillsDir: '.vibe/skills',
    defaultGlobalSkillsDir: '~/.vibe/skills',
    resolveLiveSkillsDir: resolveHomePath('.vibe', 'skills'),
    detectInstalled: detectHomeInstall('.vibe'),
    subagentGlobalDirRelativeParts: ['.vibe', 'agents'],
    subagentProjectDir: '.vibe/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'toml',
    subagentWriteDialect: 'toml',
    mcpConfigRelativeParts: ['.vibe', 'config.toml'],
    agentConfigRelativeParts: ['.vibe', 'config.toml'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'toml-mcpServers-array',
    mcpWriteDialect: 'toml-transport-array',
    metadataSources: [
      source('https://github.com/mistralai/mistral-vibe/blob/main/docs/configuration.md', 'Vibe config'),
      source('https://github.com/mistralai/mistral-vibe/blob/main/docs/mcp.md', 'Vibe MCP in TOML'),
      source('https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/agents/manager.py', 'Agents directory scanning and TOML format'),
    ],
    icon: icon('https://raw.githubusercontent.com/mistralai/mistral-vibe/main/distribution/zed/icons/mistral_vibe.svg', 'svg'),
  }),
  agent({
    family: 'mux',
    label: 'Mux',
    defaultProjectSkillsDir: '.mux/skills',
    defaultGlobalSkillsDir: '~/.mux/skills',
    resolveLiveSkillsDir: resolveHomePath('.mux', 'skills'),
    detectInstalled: detectHomeInstall('.mux'),
    subagentGlobalDirRelativeParts: ['.mux', 'agents'],
    subagentProjectDir: '.mux/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.mux', 'mcp.jsonc'],
    agentConfigRelativeParts: ['.mux', 'config.json'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveMuxConfigDir(context), 'mcp.jsonc'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveMuxConfigDir(context), 'config.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-servers',
    metadataSources: [
      source('https://mux.coder.com/docs/configuration', 'Mux config'),
      source('https://mux.coder.com/docs/mcp', 'Mux MCP config'),
      source('https://mux.coder.com/agents', 'Agents directory and Markdown format'),
      source('https://mux.coder.com/', 'Brand source page'),
    ],
    icon: icon('https://mux.coder.com/', 'html', 'Official source page only; a stable square asset still needs to be sourced'),
  }),
  agent({
    family: 'neovate',
    label: 'Neovate',
    defaultProjectSkillsDir: '.neovate/skills',
    defaultGlobalSkillsDir: '~/.neovate/skills',
    resolveLiveSkillsDir: resolveHomePath('.neovate', 'skills'),
    detectInstalled: detectHomeInstall('.neovate'),
    subagentConfigKind: 'unknown',
    subagentParserKind: 'unknown',
    mcpConfigRelativeParts: ['.neovate', 'config.json'],
    agentConfigRelativeParts: ['.neovate', 'config.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://neovate.dev/docs/configuration', 'Neovate config'),
      source('https://neovate.dev/docs/mcp', 'Neovate MCP'),
      source('https://neovateai.dev/docs/features', 'Subagents exist, but exact local paths were not confirmed'),
    ],
    icon: icon('https://mdn.alipayobjects.com/huamei_9rin5s/afts/img/Q48CQ7a8GLEAAAAAQBAAAAgADiB8AQFr/original', 'svg'),
  }),
  agent({
    family: 'openclaw',
    label: 'OpenClaw',
    defaultProjectSkillsDir: 'skills',
    defaultGlobalSkillsDir: '~/.openclaw/skills',
    resolveLiveSkillsDir: (context = {}) => getOpenClawGlobalSkillsDir(resolveAgentCatalogContext(context)),
    detectInstalled: detectOpenClawInstall,
    subagentConfigKind: 'agent-config',
    subagentParserKind: 'jsonc',
    mcpConfigRelativeParts: ['.openclaw', 'openclaw.json'],
    agentConfigRelativeParts: ['.openclaw', 'openclaw.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.OPENCLAW_CONFIG_PATH?.trim() || joinPath(resolveOpenClawStateDir(context), 'openclaw.json'),
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.OPENCLAW_CONFIG_PATH?.trim() || joinPath(resolveOpenClawStateDir(context), 'openclaw.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-mcp-servers',
    mcpWriteDialect: 'json-openclaw',
    metadataSources: [
      source('https://github.com/openclaw/openclaw/blob/main/README.md', 'Main README'),
      source('https://github.com/openclaw/openclaw/blob/main/docs/configuration.md', 'Config path and env vars'),
      source('https://github.com/openclaw/openclaw/blob/main/docs/mcp.md', 'Nested MCP config'),
      source('https://docs.openclaw.ai/tools/subagents', 'Subagents are configured/spawned through OpenClaw config and sessions'),
    ],
    icon: icon('https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-logo-text.png', 'png', 'Official logo image; replace with a square mark if one is published'),
  }),
  agent({
    family: 'opencode',
    label: 'OpenCode',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.claude/skills',
      '~/.config/opencode/skills',
    ],
    nativeGlobalSkillsDir: '~/.config/opencode/skills',
    resolveLiveSkillsDir: resolveConfigHomeSkillsPath('opencode', 'skills'),
    detectInstalled: detectConfigHomeInstall('opencode'),
    skillDirectoryMetadataSources: [
      source('https://opencode.ai/docs/skills/', 'OpenCode docs list ~/.agents/skills as a global agent-compatible skill directory.'),
    ],
    subagentGlobalDirRelativeParts: ['.config', 'opencode', 'agents'],
    subagentProjectDir: '.opencode/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.config', 'opencode', 'opencode.json'],
    agentConfigRelativeParts: ['.config', 'opencode', 'opencode.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.OPENCODE_CONFIG?.trim() || resolveConfigHomePath(context, 'opencode', 'opencode.json'),
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.OPENCODE_CONFIG?.trim() || resolveConfigHomePath(context, 'opencode', 'opencode.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-opencode-mcp',
    mcpWriteDialect: 'json-opencode',
    metadataSources: [
      source('https://opencode.ai/docs/config/', 'OpenCode config'),
      source('https://opencode.ai/docs/mcp-servers/', 'OpenCode MCP in config'),
      source('https://dev.opencode.ai/docs/agents/', 'Agents directories and Markdown/JSON formats'),
      source('https://opencode.ai/brand', 'Brand assets'),
    ],
    icon: icon('https://opencode.ai/apple-touch-icon-v3.png', 'png', 'Official square app icon'),
  }),
  agent({
    family: 'openhands',
    label: 'OpenHands',
    defaultProjectSkillsDir: '.openhands/skills',
    defaultGlobalSkillsDir: '~/.openhands/skills',
    resolveLiveSkillsDir: resolveHomePath('.openhands', 'skills'),
    detectInstalled: detectHomeInstall('.openhands'),
    subagentGlobalDirRelativeParts: ['.openhands', 'agents'],
    subagentProjectDir: '.openhands/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.openhands', 'mcp.json'],
    agentConfigRelativeParts: ['.openhands', 'agent_settings.json'],
    resolveLiveMcpConfigPath: (context = {}) => joinPath(resolveOpenHandsDir(context), 'mcp.json'),
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolveOpenHandsDir(context), 'agent_settings.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.openhands.dev/openhands/usage/cli/command-reference', 'Explicit agent_settings.json path'),
      source('https://docs.openhands.dev/openhands/usage/settings/mcp-settings', 'Dedicated MCP file'),
      source('https://docs.openhands.dev/openhands/usage/environment-variables', 'OH_PERSISTENCE_DIR'),
      source('https://docs.openhands.dev/sdk/guides/agent-file-based', 'File-based agents and Markdown format'),
    ],
    icon: icon('https://raw.githubusercontent.com/OpenHands/docs/main/openhands/static/img/logo.png', 'png'),
  }),
  agent({
    family: 'pi',
    label: 'Pi',
    defaultProjectSkillsDir: '.pi/skills',
    defaultGlobalSkillsDir: '~/.pi/skills',
    resolveLiveSkillsDir: resolveHomePath('.pi', 'skills'),
    detectInstalled: detectHomeInstall('.pi', 'agent'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    agentConfigRelativeParts: ['.pi', 'agent', 'settings.json'],
    resolveLiveAgentConfigPath: (context = {}) => joinPath(resolvePiConfigDir(context), 'settings.json'),
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md', 'Pi settings path'),
      source('https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md', 'Pi explicitly documents no MCP in core'),
      source('https://pi.dev/packages/pi-subagents', 'Subagents are package-provided, not core Pi local format'),
    ],
    icon: icon('https://framerusercontent.com/images/Hu7aeJCxpUvwSxyA5mfRMSPAqAU.svg', 'svg', 'Official square favicon'),
  }),
  agent({
    family: 'pochi',
    label: 'Pochi',
    defaultProjectSkillsDir: '.pochi/skills',
    defaultGlobalSkillsDir: '~/.pochi/skills',
    resolveLiveSkillsDir: resolveHomePath('.pochi', 'skills'),
    detectInstalled: detectHomeInstall('.pochi'),
    subagentGlobalDirRelativeParts: ['.pochi', 'agents'],
    subagentProjectDir: '.pochi/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.pochi', 'config.jsonc'],
    agentConfigRelativeParts: ['.pochi', 'config.jsonc'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-mcp',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.getpochi.com/', 'Pochi global and workspace config'),
      source('https://docs.getpochi.com/mcp/', 'Inline MCP block'),
      source('https://docs.getpochi.com/cli/', 'CLI env vars'),
      source('https://docs.getpochi.com/custom-agent/', 'Custom agent directories and Markdown format'),
    ],
    icon: icon('https://raw.githubusercontent.com/TabbyML/pochi/main/packages/vscode/assets/icons/pochi-logo.svg', 'svg'),
  }),
  agent({
    family: 'qoder',
    label: 'Qoder',
    defaultProjectSkillsDir: '.qoder/skills',
    defaultGlobalSkillsDir: '~/.qoder/skills',
    resolveLiveSkillsDir: resolveHomePath('.qoder', 'skills'),
    detectInstalled: detectHomeInstall('.qoder'),
    subagentGlobalDirRelativeParts: ['.qoder', 'agents'],
    subagentProjectDir: '.qoder/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.qoder.json'],
    agentConfigRelativeParts: ['.qoder', 'settings.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.qoder.com/cli/using-cli', 'CLI config and MCP file'),
      source('https://docs.qoder.com/extensions/hooks', 'Settings path hierarchy'),
      source('https://docs.qoder.com/user-guide/chat/model-context-protocol', 'MCP UX'),
      source('https://docs.qoder.com/en/cli/subagent', 'Subagent directory and Markdown format'),
    ],
    icon: icon(
      'https://img.alicdn.com/imgextra/i3/O1CN01KliT1u1jEq947NlKH_!!6000000004517-55-tps-180-180.svg',
      'svg',
      'Official square icon',
    ),
  }),
  agent({
    family: 'qwen-code',
    label: 'Qwen Code',
    defaultProjectSkillsDir: '.qwen/skills',
    defaultGlobalSkillsDir: '~/.qwen/skills',
    resolveLiveSkillsDir: resolveHomePath('.qwen', 'skills'),
    detectInstalled: detectHomeInstall('.qwen'),
    subagentGlobalDirRelativeParts: ['.qwen', 'agents'],
    subagentProjectDir: '.qwen/agents',
    subagentConfigKind: 'directory',
    subagentParserKind: 'markdown-frontmatter',
    subagentWriteDialect: 'markdown-frontmatter',
    mcpConfigRelativeParts: ['.qwen', 'settings.json'],
    agentConfigRelativeParts: ['.qwen', 'settings.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.QWEN_CODE_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveAgentCatalogContext(context).homeDir, '.qwen', 'settings.json'),
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.QWEN_CODE_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveAgentCatalogContext(context).homeDir, '.qwen', 'settings.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-http-url',
    metadataSources: [
      source('https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/configuration/settings.md', 'Qwen Code settings'),
      source('https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/', 'Qwen Code MCP'),
      source('https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/', 'Developer MCP reference'),
      source('https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/', 'Sub-agent directories and Markdown format'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/141221163?s=200&v=4', 'png'),
  }),
  agent({
    family: 'replit',
    label: 'Replit',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.config/agents/skills',
    resolveLiveSkillsDir: resolveConfigHomeSkillsPath('agents', 'skills'),
    detectInstalled: detectReplitInstall,
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://docs.replit.com/replitai/skills', 'Replit skills docs'),
      source('https://docs.replit.com/replitai/mcp/overview', 'MCP is managed through Replit UI, not a documented local file'),
      source('https://docs.replit.com/replitai/mcp/install-links', 'Replit MCP install flow'),
      source('https://docs.replit.com/replitai/agents-and-automations', 'Hosted agents; no documented local subagent directory'),
    ],
    icon: icon('https://replit.com/public/icons/favicon-prompt-192-rebrand.png', 'png'),
  }),
  agent({
    family: 'roo',
    label: 'Roo Code',
    defaultProjectSkillsDir: '.roo/skills',
    defaultGlobalSkillsDir: '~/.roo/skills',
    resolveLiveSkillsDir: resolveHomePath('.roo', 'skills'),
    detectInstalled: detectHomeInstall('.roo'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      joinPath(
        resolveAgentCatalogContext(context).homeDir,
        'Library',
        'Application Support',
        'Code',
        'User',
        'globalStorage',
        'rooveterinaryinc.roo-cline',
        'settings',
        'mcp_settings.json',
      ),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://github.com/RooCodeInc/Roo-Code/security/advisories/GHSA-5x8h-m52g-5v54', 'Project-specific MCP override at .roo/mcp.json'),
      source('https://github.com/RooCodeInc/Roo-Code/issues/2273', 'Global mcp_settings.json path example'),
      source('https://github.com/RooCodeInc/Roo-Code/issues/3788', 'customStoragePath and mcp_settings.json migration behavior'),
      source('https://roocodeinc.github.io/Roo-Code/features/custom-modes/', 'Custom modes, not standalone subagent files'),
    ],
    icon: icon('https://github.com/RooCodeInc.png', 'png', 'Official GitHub org avatar'),
  }),
  agent({
    family: 'trae',
    label: 'Trae',
    defaultProjectSkillsDir: '.trae/skills',
    defaultGlobalSkillsDir: '~/.trae/skills',
    resolveLiveSkillsDir: resolveHomePath('.trae', 'skills'),
    detectInstalled: detectHomeInstall('.trae'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['trae_config.yaml'],
    agentConfigRelativeParts: ['trae_config.yaml'],
    resolveLiveMcpConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.TRAE_CONFIG_FILE?.trim() || joinPath(resolveAgentCatalogContext(context).cwd, 'trae_config.yaml'),
    resolveLiveAgentConfigPath: (context = {}) =>
      resolveAgentCatalogContext(context).env.TRAE_CONFIG_FILE?.trim() || joinPath(resolveAgentCatalogContext(context).cwd, 'trae_config.yaml'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'yaml',
    mcpWriteDialect: 'yaml-typed',
    metadataSources: [
      source('https://github.com/bytedance/trae-agent/blob/main/README.md', 'Trae Agent README'),
      source('https://github.com/bytedance/trae-agent/blob/main/trae_agent/cli.py', 'TRAE_CONFIG_FILE and --config-file'),
      source('https://github.com/bytedance/trae-agent/blob/main/trae_agent/utils/config.py', 'YAML config parser and mcp_servers'),
      source('https://docs.trae.ai/ide/custom-agents-ready-for-one-click-import', 'Product custom agents; no local file format confirmed for Trae Agent OSS'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/192691831?s=200&v=4', 'png'),
  }),
  agent({
    family: 'trae-cn',
    label: 'Trae CN',
    defaultProjectSkillsDir: '.trae/skills',
    defaultGlobalSkillsDir: '~/.trae/skills',
    resolveLiveSkillsDir: resolveHomePath('.trae', 'skills'),
    detectInstalled: detectHomeInstall('.trae-cn'),
    subagentConfigKind: 'account-managed',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['Library', 'Application Support', 'Trae', 'User', 'settings', 'mcp.json'],
    resolveLiveMcpConfigPath: (context = {}) =>
      joinPath(resolveAgentCatalogContext(context).homeDir, 'Library', 'Application Support', 'Trae', 'User', 'settings', 'mcp.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://forum.trae.cn/t/topic/6780', 'Official community support thread with MCP paths'),
      source('https://forum.trae.cn/t/topic/6433', 'Project-local .trae/mcp.json references'),
      source('https://www.trae.cn/changelog', 'Official product site'),
      source('https://forum.trae.cn/t/topic/15119', 'Custom agents are UI/account managed; no local file path documented'),
    ],
    icon: icon('https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png', 'png', 'Official square favicon'),
  }),
  agent({
    family: 'warp',
    label: 'Warp',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: [
      '~/.warp/skills',
    ],
    resolveLiveSkillsDir: resolveHomePath('.agents', 'skills'),
    detectInstalled: detectHomeInstall('.warp'),
    skillDirectoryMetadataSources: [
      source('https://docs.warp.dev/agent-platform/capabilities/skills#skill-locations', 'Warp docs recommend ~/.agents/skills for global skills.'),
    ],
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    agentConfigRelativeParts: ['.config', 'warp-terminal', 'user_preferences.json'],
    resolveLiveAgentConfigPath: (context = {}) => resolveConfigHomePath(context, 'warp-terminal', 'user_preferences.json'),
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://docs.warp.dev/terminal/warpify/subshells', 'Warp user preferences file'),
      source('https://docs.warp.dev/agent-platform/capabilities/mcp', 'Warp MCP is app-managed; no documented local config file'),
      source('https://docs.warp.dev/agent-platform/cloud-agents/skills-as-agents', 'Skills as agents, not local custom subagent profiles'),
      source('https://www.warp.dev/', 'Brand/homepage'),
    ],
    icon: icon('https://framerusercontent.com/images/GybmHeNj1WzkgFqIjQYypmhg.png', 'png'),
  }),
  agent({
    family: 'windsurf',
    label: 'Windsurf',
    defaultProjectSkillsDir: '.windsurf/skills',
    defaultGlobalSkillsDir: '~/.codeium/windsurf/skills',
    resolveLiveSkillsDir: resolveHomePath('.codeium', 'windsurf', 'skills'),
    detectInstalled: detectHomeInstall('.codeium', 'windsurf'),
    subagentConfigKind: 'none',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.codeium', 'windsurf', 'mcp_config.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.windsurf.com/windsurf/cascade/skills', 'Windsurf skills root'),
      source('https://docs.windsurf.com/windsurf/cascade/workflows', 'Windsurf global_workflows under the same root'),
      source('https://docs.windsurf.com/windsurf/cascade/mcp', 'Windsurf MCP config file'),
      source('https://docs.windsurf.com/plugins/cascade/mcp', 'Plugin-side MCP docs'),
    ],
    icon: icon('https://windsurf.com/favicon.svg', 'svg'),
  }),
  agent({
    family: 'zencoder',
    label: 'Zencoder',
    defaultProjectSkillsDir: '.zencoder/skills',
    defaultGlobalSkillsDir: '~/.zencoder/skills',
    resolveLiveSkillsDir: resolveHomePath('.zencoder', 'skills'),
    detectInstalled: detectHomeInstall('.zencoder'),
    subagentConfigKind: 'account-managed',
    subagentParserKind: 'none',
    mcpConfigRelativeParts: ['.zencoder', 'settings.json'],
    agentConfigRelativeParts: ['.zencoder', 'settings.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-dotted-zencoder-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.zencoder.ai/features/custom-models-configuration', 'Zencoder settings file path'),
      source('https://docs.zencoder.ai/features/integrations-and-mcp', 'Zencoder MCP in settings'),
      source('https://docs.zencoder.ai/features/autonomous-agents-configuration', 'Related settings evolution'),
      source('https://docs.zencoder.ai/features/ai-agents', 'UI-managed AI agents; no documented local subagent files'),
    ],
    icon: icon('https://zencoder.ai/hubfs/export.png', 'png'),
  }),
] as const;

export type AgentCatalogEntry = (typeof AGENT_CATALOG)[number];
export type AgentCatalogFamily = AgentCatalogEntry['family'];

export function getAgentCatalogEntry(family: AgentCatalogFamily): AgentCatalogEntry {
  return AGENT_CATALOG.find((candidate) => candidate.family === family)
    ?? (() => {
      throw new Error(`Missing agent catalog family ${family}`);
    })();
}

export function getRenderableAgentIconOrigins(): string[] {
  const origins: string[] = [];

  for (const agentEntry of AGENT_CATALOG) {
    const iconRecord = agentEntry.icon;
    const assetUrl = iconRecord?.assetUrl?.trim();
    const format = iconRecord?.format?.trim().toLowerCase();
    if (!assetUrl || !format || !RENDERABLE_ICON_FORMATS.has(format)) {
      continue;
    }

    if (!URL.canParse(assetUrl)) {
      continue;
    }

    const parsed = new URL(assetUrl);
    const origin = parsed.origin;
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !origins.includes(origin)) {
      origins.push(origin);
    }
  }

  return origins.sort();
}

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

    for (const sourceRecord of group) {
      const key = `${sourceRecord.url}\n${sourceRecord.note ?? ''}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(sourceRecord);
    }
  }

  return merged.length > 0 ? merged : undefined;
}
