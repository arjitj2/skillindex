import type {
  AgentIconRecord,
  AgentMcpConfigKind,
  AgentMcpParserKind,
  AgentMcpSupportedTransport,
  AgentMcpWriteDialect,
  AgentMetadataSource,
} from './contracts';
import type { UpstreamAgentResolutionContext } from './upstream-agent-catalog';
import { resolveUpstreamAgentContext } from './upstream-agent-catalog';
import { joinPath } from './path-utils';

export interface KnownAgentFamilyOverrideDefinition {
  family: string;
  label?: string;
  aliases?: string[];
  ignoredSkillSubpathsByDisplayPath?: Record<string, string[]>;
  resolveLiveMcpConfigPathOverride?: (context?: UpstreamAgentResolutionContext) => string;
  resolveLiveAgentConfigPathOverride?: (context?: UpstreamAgentResolutionContext) => string;
  mcpConfigRelativeParts?: string[];
  agentConfigRelativeParts?: string[];
  expectedExecutableNames?: string[];
  mcpConfigKind?: AgentMcpConfigKind;
  mcpParserKind?: AgentMcpParserKind;
  mcpWriteDialect?: AgentMcpWriteDialect;
  mcpSupportedTransports?: AgentMcpSupportedTransport[];
  metadataSources?: AgentMetadataSource[];
  icon?: AgentIconRecord;
}

function resolveClaudeConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.CLAUDE_CONFIG_DIR?.trim() || joinPath(resolved.homeDir, '.claude');
}

function resolveClaudeDesktopConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.CLAUDE_DESKTOP_CONFIG_DIR?.trim()
    || joinPath(resolved.homeDir, 'Library', 'Application Support', 'Claude');
}

function resolveClineConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.CLINE_DIR?.trim() || joinPath(resolved.homeDir, '.cline');
}

function resolveCodexConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.CODEX_HOME?.trim() || joinPath(resolved.homeDir, '.codex');
}

function resolveConfigHomeDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.XDG_CONFIG_HOME?.trim() || joinPath(resolved.homeDir, '.config');
}

function resolveConfigHomePath(context: UpstreamAgentResolutionContext = {}, ...parts: string[]): string {
  return joinPath(resolveConfigHomeDir(context), ...parts);
}

function resolveCopilotConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.COPILOT_HOME?.trim() || joinPath(resolved.homeDir, '.copilot');
}

function resolveGeminiCliDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.GEMINI_CLI_HOME?.trim() || joinPath(resolved.homeDir, '.gemini');
}

function resolveGooseConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.GOOSE_PATH_ROOT?.trim() || resolveConfigHomePath(resolved, 'goose');
}

function resolveKimiConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.KIMI_SHARE_DIR?.trim() || joinPath(resolved.homeDir, '.kimi');
}

function resolveMuxConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.MUX_CONFIG_ROOT?.trim() || joinPath(resolved.homeDir, '.mux');
}

function resolveOpenHandsDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.OH_PERSISTENCE_DIR?.trim() || joinPath(resolved.homeDir, '.openhands');
}

function resolveOpenClawStateDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.env.OPENCLAW_STATE_DIR?.trim()
    || resolved.env.OPENCLAW_HOME?.trim()
    || resolved.env.PI_CODING_AGENT_DIR?.trim()
    || joinPath(resolved.homeDir, '.openclaw');
}

function resolvePiConfigDir(context: UpstreamAgentResolutionContext = {}): string {
  const resolved = resolveUpstreamAgentContext(context);
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

export const KNOWN_AGENT_FAMILY_OVERRIDES = [
  {
    family: 'adal',
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
  },
  {
    family: 'amp',
    mcpConfigRelativeParts: ['.config', 'amp', 'settings.json'],
    agentConfigRelativeParts: ['.config', 'amp', 'settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) => resolveConfigHomePath(context, 'amp', 'settings.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) => resolveConfigHomePath(context, 'amp', 'settings.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-dotted-amp-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://ampcode.com/manual', 'Settings and MCP docs'),
      source('https://ampcode.com/news/cli-workspace-settings', 'Workspace and settings behavior'),
      source('https://ampcode.com/press-kit', 'Brand assets'),
    ],
    icon: icon('https://ampcode.com/amp-mark-color.svg', 'svg', 'Official square mark from the Amp site'),
  },
  {
    family: 'antigravity',
    mcpConfigRelativeParts: ['.gemini', 'antigravity', 'mcp_config.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://codelabs.developers.google.com/getting-started-google-antigravity', 'Getting started doc'),
      source('https://antigravity.google/', 'Official product site'),
    ],
    icon: icon('https://antigravity.google/assets/image/antigravity-logo.svg', 'svg', 'Official square mark'),
  },
  {
    family: 'augment',
    mcpConfigRelativeParts: ['.augment', 'settings.json'],
    agentConfigRelativeParts: ['.augment', 'settings.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://docs.augmentcode.com/cli/config', 'Config reference'),
      source('https://docs.augmentcode.com/cli/integrations', 'MCP and integrations'),
    ],
    icon: icon(
      'https://www.augmentcode.com/favicon.svg',
      'svg',
      'Official square favicon',
    ),
  },
  {
    family: 'bob',
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
  },
  {
    family: 'claude',
    label: 'Claude Code',
    aliases: ['claude-code'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    mcpConfigRelativeParts: ['.claude.json'],
    agentConfigRelativeParts: ['.claude', 'settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveUpstreamAgentContext(context).homeDir, '.claude.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveClaudeConfigDir(context), 'settings.json'),
    expectedExecutableNames: ['claude'],
    metadataSources: [
      source('https://code.claude.com/docs/en/settings', 'Settings path and config root'),
      source('https://code.claude.com/docs/en/mcp', 'MCP file layout'),
      source('https://code.claude.com/docs/en/env-vars', 'CLAUDE_CONFIG_DIR override'),
    ],
    icon: icon(
      'https://cdn.prod.website-files.com/6889473510b50328dbb70ae6/68c33859cc6cd903686c66a2_apple-touch-icon.png',
      'png',
      'Official high-resolution square touch icon',
    ),
  },
  {
    family: 'claude-desktop',
    label: 'Claude Desktop',
    aliases: ['claude-for-desktop'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    mcpSupportedTransports: ['stdio'],
    mcpConfigRelativeParts: ['Library', 'Application Support', 'Claude', 'claude_desktop_config.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      joinPath(resolveClaudeDesktopConfigDir(context), 'claude_desktop_config.json'),
    metadataSources: [
      source('https://modelcontextprotocol.io/docs/develop/connect-local-servers', 'Claude Desktop local MCP config path and mcpServers JSON format'),
      source('https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop', 'Desktop extensions and MCPB are the current local MCP install path'),
      source('https://support.claude.com/en/articles/12512180-use-skills-in-claude', 'Claude app skills are managed from claude.ai Customize > Skills'),
    ],
    icon: icon(
      'https://cdn.prod.website-files.com/6889473510b50328dbb70ae6/68c33859cc6cd903686c66a2_apple-touch-icon.png',
      'png',
      'Official high-resolution square touch icon',
    ),
  },
  {
    family: 'cline',
    mcpConfigRelativeParts: ['.cline', 'data', 'settings', 'cline_mcp_settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      joinPath(resolveClineConfigDir(context), 'data', 'settings', 'cline_mcp_settings.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.cline.bot/cline-cli/configuration#setting-up-mcp-servers', 'Official Cline CLI MCP settings path and format'),
      source('https://docs.cline.bot/cline-cli/configuration#configuration-directory', 'Official Cline configuration directory layout'),
    ],
    icon: icon('https://cline.bot/assets/branding/brand/App%20Icons/PNG/APP_ICON_LIGHT.png', 'png', 'Official square app icon'),
  },
  {
    family: 'codebuddy',
    mcpConfigRelativeParts: ['.codebuddy', '.mcp.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'jsonc-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://www.codebuddy.ai/docs/cli/mcp#configuration-files', 'Official CodeBuddy CLI MCP configuration files'),
    ],
    icon: icon('https://cdn.prod.website-files.com/65a6a15ecd9b4909597c6be5/689dfd72095849f4e1693503_Stack-Icon-Thin.svg', 'svg', 'Official square stack icon'),
  },
  {
    family: 'codex',
    ignoredSkillSubpathsByDisplayPath: {
      '~/.codex/skills': ['.system'],
    },
    mcpConfigRelativeParts: ['.codex', 'config.toml'],
    agentConfigRelativeParts: ['.codex', 'config.toml'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveCodexConfigDir(context), 'config.toml'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveCodexConfigDir(context), 'config.toml'),
    expectedExecutableNames: ['codex'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'toml',
    mcpWriteDialect: 'toml-codex',
    metadataSources: [
      source('https://platform.openai.com/docs/codex/cli/configuration', 'Codex config path and settings'),
      source('https://platform.openai.com/docs/codex/cli/mcp', 'Codex MCP config in TOML'),
    ],
    icon: icon('https://openai.com/favicon.ico', 'ico', 'OpenAI favicon fallback for Codex'),
  },
  {
    family: 'command-code',
    mcpConfigRelativeParts: ['.commandcode', 'mcp.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://commandcode.ai/docs/mcp/manage', 'MCP config'),
      source('https://commandcode.ai/docs/skills/manage', 'Skills directory and local state'),
    ],
    icon: icon('https://commandcode.ai/favicon/2024/safari-pinned-tab.svg', 'svg'),
  },
  {
    family: 'continue',
    mcpConfigRelativeParts: ['.continue', 'mcpServers'],
    agentConfigRelativeParts: ['.continue', 'config.yaml'],
    mcpConfigKind: 'directory',
    mcpParserKind: 'yaml',
    mcpWriteDialect: 'yaml-typed',
    metadataSources: [
      source('https://docs.continue.dev/customize/deep-dives/configuration', 'Continue config'),
      source('https://docs.continue.dev/customize/deep-dives/mcp', 'Continue MCP directory support'),
    ],
    icon: icon(
      'https://www.continue.dev/favicon.png',
      'png',
      'Official square favicon',
    ),
  },
  {
    family: 'cortex',
    mcpConfigRelativeParts: ['.snowflake', 'cortex', 'mcp.json'],
    agentConfigRelativeParts: ['.snowflake', 'cortex', 'settings.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.snowflake.com/en/user-guide/cortex-code/settings', 'Cortex settings'),
      source('https://docs.snowflake.com/en/user-guide/cortex-code/extensibility', 'Cortex MCP extensibility'),
    ],
    icon: icon(
      'https://www.snowflake.com/etc.clientlibs/snowflake-site/clientlibs/clientlib-react/resources/apple-touch-icon.png?v=3',
      'png',
      'Use the square Snowflake app icon for compact agent badges',
    ),
  },
  {
    family: 'crush',
    mcpConfigRelativeParts: ['.config', 'crush', 'crush.json'],
    agentConfigRelativeParts: ['.config', 'crush', 'crush.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.CRUSH_GLOBAL_CONFIG?.trim() || resolveConfigHomePath(context, 'crush', 'crush.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.CRUSH_GLOBAL_CONFIG?.trim() || resolveConfigHomePath(context, 'crush', 'crush.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcp',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://raw.githubusercontent.com/charmbracelet/crush/main/README.md', 'Config and usage'),
      source('https://raw.githubusercontent.com/charmbracelet/crush/main/schema.json', 'Top-level config schema'),
    ],
    icon: icon('https://raw.githubusercontent.com/charmbracelet/crush/main/internal/ui/notification/crush-icon-solo.png', 'png'),
  },
  {
    family: 'cursor',
    mcpConfigRelativeParts: ['.cursor', 'mcp.json'],
    agentConfigRelativeParts: ['.cursor', 'cli-config.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.cursor.com/en/cli/reference/configuration', 'Cursor CLI config'),
      source('https://docs.cursor.com/context/model-context-protocol', 'Cursor MCP config'),
      source('https://cursor.com/brand', 'Brand assets'),
    ],
    icon: icon(
      'https://cursor.com/marketing-static/icon-512x512.png',
      'png',
      'Official square app icon',
    ),
  },
  {
    family: 'deepagents',
    mcpConfigRelativeParts: ['.deepagents', '.mcp.json'],
    agentConfigRelativeParts: ['.deepagents', 'config.toml'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.langchain.com/oss/python/deepagents/cli/configuration', 'Config path'),
      source('https://docs.langchain.com/oss/python/deepagents/cli/mcp-tools', 'Dedicated MCP file'),
    ],
    icon: icon(
      'https://deepagents.org/deep_icon.svg',
      'svg',
      'Official square icon',
    ),
  },
  {
    family: 'factory',
    label: 'Factory',
    aliases: ['droid'],
    mcpConfigRelativeParts: ['.factory', 'mcp.json'],
    agentConfigRelativeParts: ['.factory', 'settings.json'],
    expectedExecutableNames: ['factory'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://docs.factory.ai/cli/configuration/settings', 'Factory settings'),
      source('https://docs.factory.ai/factory-cli/configuration/mcp', 'Factory MCP config'),
    ],
    icon: icon('https://factory.ai/favicon.svg', 'svg'),
  },
  {
    family: 'firebender',
    mcpConfigRelativeParts: ['.firebender', 'firebender.json'],
    agentConfigRelativeParts: ['.firebender', 'firebender.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://firebender.com/docs/configuration', 'Config file location'),
      source('https://firebender.com/docs/mcp', 'Inline MCP config'),
    ],
    icon: icon('https://firebender.com/icon.svg', 'svg'),
  },
  {
    family: 'gemini-cli',
    mcpConfigRelativeParts: ['.gemini', 'settings.json'],
    agentConfigRelativeParts: ['.gemini', 'settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.GEMINI_CLI_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveGeminiCliDir(context), 'settings.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.GEMINI_CLI_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveGeminiCliDir(context), 'settings.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-http-url',
    metadataSources: [
      source('https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md', 'Gemini CLI config'),
      source('https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md', 'Gemini CLI MCP'),
    ],
    icon: icon('https://geminicli.com/icon.png', 'png'),
  },
  {
    family: 'github-copilot',
    mcpConfigRelativeParts: ['.copilot', 'mcp-config.json'],
    agentConfigRelativeParts: ['.copilot', 'config.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveCopilotConfigDir(context), 'mcp-config.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveCopilotConfigDir(context), 'config.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-type-url',
    metadataSources: [
      source('https://docs.github.com/en/copilot/customizing-copilot/configuring-github-copilot-in-your-environment', 'Copilot config'),
      source('https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp', 'Copilot MCP'),
      source('https://brand.github.com/', 'Brand assets'),
    ],
    icon: icon('https://github.com/github.png', 'png', 'Use the square GitHub logo for compact Copilot badges'),
  },
  {
    family: 'goose',
    mcpConfigRelativeParts: ['.config', 'goose', 'config.yaml'],
    agentConfigRelativeParts: ['.config', 'goose', 'config.yaml'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveGooseConfigDir(context), 'config.yaml'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveGooseConfigDir(context), 'config.yaml'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'yaml',
    mcpWriteDialect: 'yaml-typed',
    metadataSources: [
      source('https://block.github.io/goose/docs/getting-started/configuration/', 'Goose config'),
      source('https://block.github.io/goose/docs/mcp/configuration/', 'Goose MCP in YAML'),
    ],
    icon: icon('https://goose-docs.ai/img/favicon.ico', 'ico', 'Official square favicon for compact badges'),
  },
  {
    family: 'iflow-cli',
    mcpConfigRelativeParts: ['.iflow', 'mcp', 'config.json'],
    agentConfigRelativeParts: ['.iflow', 'settings.json'],
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.IFLOW_CLI_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveUpstreamAgentContext(context).homeDir, '.iflow', 'settings.json'),
    mcpConfigKind: 'mixed',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://iflow-cli.ai/docs/configuration', 'iFlow config'),
      source('https://iflow-cli.ai/docs/mcp', 'Dedicated and inline MCP support'),
    ],
    icon: icon('https://img.alicdn.com/imgextra/i4/O1CN01VFxaDc1s3EZKig0PM_!!6000000005710-0-tps-300-300.jpg', 'jpg'),
  },
  {
    family: 'junie',
    mcpConfigRelativeParts: ['.junie', 'mcp', 'mcp.json'],
    agentConfigRelativeParts: ['.junie', 'AGENTS.md'],
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      joinPath(resolveUpstreamAgentContext(context).homeDir, '.junie', resolveUpstreamAgentContext(context).env.JUNIE_GUIDELINES_FILENAME?.trim() || 'AGENTS.md'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://www.jetbrains.com/help/junie/configure-guidelines.html', 'Guidelines/config file'),
      source('https://www.jetbrains.com/help/junie/model-context-protocol.html', 'MCP settings'),
    ],
    icon: icon('https://resources.jetbrains.com/help/img/idea/2026.1/junie-logo.svg', 'svg'),
  },
  {
    family: 'kilo',
    mcpConfigRelativeParts: ['.config', 'kilo', 'kilo.jsonc'],
    agentConfigRelativeParts: ['.config', 'kilo', 'kilo.jsonc'],
    resolveLiveMcpConfigPathOverride: (context = {}) => resolveConfigHomePath(context, 'kilo', 'kilo.jsonc'),
    resolveLiveAgentConfigPathOverride: (context = {}) => resolveConfigHomePath(context, 'kilo', 'kilo.jsonc'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-mcp',
    metadataSources: [
      source('https://kilo.ai/docs/automate/mcp/using-in-kilo-code', 'Kilo MCP in config'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/201822503?s=512&v=4', 'png'),
  },
  {
    family: 'kimi-cli',
    mcpConfigRelativeParts: ['.kimi', 'mcp.json'],
    agentConfigRelativeParts: ['.kimi', 'config.toml'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveKimiConfigDir(context), 'mcp.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveKimiConfigDir(context), 'config.toml'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://github.com/MoonshotAI/Kimi-K2/blob/main/docs/kimi-cli/configuration.md', 'Kimi config'),
      source('https://github.com/MoonshotAI/Kimi-K2/blob/main/docs/kimi-cli/mcp.md', 'Kimi MCP'),
    ],
    icon: icon('https://moonshotai.github.io/Branding-Guide/scenarios/04-k-only/k-only-light.svg', 'svg'),
  },
  {
    family: 'kiro-cli',
    mcpConfigRelativeParts: ['.kiro', 'settings', 'mcp.json'],
    agentConfigRelativeParts: ['.kiro', 'agents'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://kiro.dev/docs/configuration', 'Kiro config layout'),
      source('https://kiro.dev/docs/mcp', 'Kiro MCP settings'),
    ],
    icon: icon('https://kiro.dev/icon.svg?fe599162bb293ea0', 'svg'),
  },
  {
    family: 'kode',
    mcpConfigRelativeParts: ['.mcp.json'],
    agentConfigRelativeParts: ['.kode.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://raw.githubusercontent.com/shareAI-lab/Kode/main/README.md', 'Main README and MCP files'),
      source('https://raw.githubusercontent.com/shareAI-lab/Kode/main/docs/develop/configuration.md', 'Config location'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/189210346?v=4', 'png', 'Stable square fallback via the ShareAI Lab org avatar'),
  },
  {
    family: 'mcpjam',
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://docs.mcpjam.com/installation', 'User-supplied --config file'),
      source('https://docs.mcpjam.com/inspector/launch-from-code', 'Env-provided MCP config payload'),
    ],
    icon: icon('https://raw.githubusercontent.com/MCPJam/inspector/main/mcpjam-inspector/client/public/mcp_jam.svg', 'svg'),
  },
  {
    family: 'mistral-vibe',
    mcpConfigRelativeParts: ['.vibe', 'config.toml'],
    agentConfigRelativeParts: ['.vibe', 'config.toml'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'toml-mcpServers-array',
    mcpWriteDialect: 'toml-transport-array',
    metadataSources: [
      source('https://github.com/mistralai/mistral-vibe/blob/main/docs/configuration.md', 'Vibe config'),
      source('https://github.com/mistralai/mistral-vibe/blob/main/docs/mcp.md', 'Vibe MCP in TOML'),
    ],
    icon: icon('https://raw.githubusercontent.com/mistralai/mistral-vibe/main/distribution/zed/icons/mistral_vibe.svg', 'svg'),
  },
  {
    family: 'mux',
    mcpConfigRelativeParts: ['.mux', 'mcp.jsonc'],
    agentConfigRelativeParts: ['.mux', 'config.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveMuxConfigDir(context), 'mcp.jsonc'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveMuxConfigDir(context), 'config.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-servers',
    metadataSources: [
      source('https://mux.coder.com/docs/configuration', 'Mux config'),
      source('https://mux.coder.com/docs/mcp', 'Mux MCP config'),
      source('https://mux.coder.com/', 'Brand source page'),
    ],
    icon: icon('https://mux.coder.com/', 'html', 'Official source page only; a stable square asset still needs to be vendored'),
  },
  {
    family: 'neovate',
    mcpConfigRelativeParts: ['.neovate', 'config.json'],
    agentConfigRelativeParts: ['.neovate', 'config.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://neovate.dev/docs/configuration', 'Neovate config'),
      source('https://neovate.dev/docs/mcp', 'Neovate MCP'),
    ],
    icon: icon('https://mdn.alipayobjects.com/huamei_9rin5s/afts/img/Q48CQ7a8GLEAAAAAQBAAAAgADiB8AQFr/original', 'svg'),
  },
  {
    family: 'openclaw',
    mcpConfigRelativeParts: ['.openclaw', 'openclaw.json'],
    agentConfigRelativeParts: ['.openclaw', 'openclaw.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.OPENCLAW_CONFIG_PATH?.trim() || joinPath(resolveOpenClawStateDir(context), 'openclaw.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.OPENCLAW_CONFIG_PATH?.trim() || joinPath(resolveOpenClawStateDir(context), 'openclaw.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-mcp-servers',
    mcpWriteDialect: 'json-openclaw',
    metadataSources: [
      source('https://github.com/openclaw/openclaw/blob/main/README.md', 'Main README'),
      source('https://github.com/openclaw/openclaw/blob/main/docs/configuration.md', 'Config path and env vars'),
      source('https://github.com/openclaw/openclaw/blob/main/docs/mcp.md', 'Nested MCP config'),
    ],
    icon: icon('https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-logo-text.png', 'png', 'Official logo image; replace with a square mark if one is published'),
  },
  {
    family: 'opencode',
    mcpConfigRelativeParts: ['.config', 'opencode', 'opencode.json'],
    agentConfigRelativeParts: ['.config', 'opencode', 'opencode.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.OPENCODE_CONFIG?.trim() || resolveConfigHomePath(context, 'opencode', 'opencode.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.OPENCODE_CONFIG?.trim() || resolveConfigHomePath(context, 'opencode', 'opencode.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-opencode-mcp',
    mcpWriteDialect: 'json-opencode',
    metadataSources: [
      source('https://opencode.ai/docs/config/', 'OpenCode config'),
      source('https://opencode.ai/docs/mcp-servers/', 'OpenCode MCP in config'),
      source('https://opencode.ai/brand', 'Brand assets'),
    ],
    icon: icon('https://opencode.ai/apple-touch-icon-v3.png', 'png', 'Official square app icon'),
  },
  {
    family: 'openhands',
    mcpConfigRelativeParts: ['.openhands', 'mcp.json'],
    agentConfigRelativeParts: ['.openhands', 'agent_settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) => joinPath(resolveOpenHandsDir(context), 'mcp.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolveOpenHandsDir(context), 'agent_settings.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.openhands.dev/openhands/usage/cli/command-reference', 'Explicit agent_settings.json path'),
      source('https://docs.openhands.dev/openhands/usage/settings/mcp-settings', 'Dedicated MCP file'),
      source('https://docs.openhands.dev/openhands/usage/environment-variables', 'OH_PERSISTENCE_DIR'),
    ],
    icon: icon('https://raw.githubusercontent.com/OpenHands/docs/main/openhands/static/img/logo.png', 'png'),
  },
  {
    family: 'pi',
    agentConfigRelativeParts: ['.pi', 'agent', 'settings.json'],
    resolveLiveAgentConfigPathOverride: (context = {}) => joinPath(resolvePiConfigDir(context), 'settings.json'),
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md', 'Pi settings path'),
      source('https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md', 'Pi explicitly documents no MCP in core'),
    ],
    icon: icon('https://framerusercontent.com/images/Hu7aeJCxpUvwSxyA5mfRMSPAqAU.svg', 'svg', 'Official square favicon'),
  },
  {
    family: 'pochi',
    mcpConfigRelativeParts: ['.pochi', 'config.jsonc'],
    agentConfigRelativeParts: ['.pochi', 'config.jsonc'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-mcp',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.getpochi.com/', 'Pochi global and workspace config'),
      source('https://docs.getpochi.com/mcp/', 'Inline MCP block'),
      source('https://docs.getpochi.com/cli/', 'CLI env vars'),
    ],
    icon: icon('https://raw.githubusercontent.com/TabbyML/pochi/main/packages/vscode/assets/icons/pochi-logo.svg', 'svg'),
  },
  {
    family: 'qoder',
    mcpConfigRelativeParts: ['.qoder.json'],
    agentConfigRelativeParts: ['.qoder', 'settings.json'],
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://docs.qoder.com/cli/using-cli', 'CLI config and MCP file'),
      source('https://docs.qoder.com/extensions/hooks', 'Settings path hierarchy'),
      source('https://docs.qoder.com/user-guide/chat/model-context-protocol', 'MCP UX'),
    ],
    icon: icon(
      'https://img.alicdn.com/imgextra/i3/O1CN01KliT1u1jEq947NlKH_!!6000000004517-55-tps-180-180.svg',
      'svg',
      'Official square icon',
    ),
  },
  {
    family: 'qwen-code',
    mcpConfigRelativeParts: ['.qwen', 'settings.json'],
    agentConfigRelativeParts: ['.qwen', 'settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.QWEN_CODE_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveUpstreamAgentContext(context).homeDir, '.qwen', 'settings.json'),
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.QWEN_CODE_SYSTEM_SETTINGS_PATH?.trim() || joinPath(resolveUpstreamAgentContext(context).homeDir, '.qwen', 'settings.json'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'json-mcpServers',
    mcpWriteDialect: 'json-http-url',
    metadataSources: [
      source('https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/configuration/settings.md', 'Qwen Code settings'),
      source('https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/', 'Qwen Code MCP'),
      source('https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/', 'Developer MCP reference'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/141221163?s=200&v=4', 'png'),
  },
  {
    family: 'replit',
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://docs.replit.com/replitai/skills', 'Replit skills docs'),
      source('https://docs.replit.com/replitai/mcp/overview', 'MCP is managed through Replit UI, not a documented local file'),
      source('https://docs.replit.com/replitai/mcp/install-links', 'Replit MCP install flow'),
    ],
    icon: icon('https://replit.com/public/icons/favicon-prompt-192-rebrand.png', 'png'),
  },
  {
    family: 'roo',
    mcpConfigRelativeParts: ['Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      joinPath(
        resolveUpstreamAgentContext(context).homeDir,
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
    ],
    icon: icon('https://github.com/RooCodeInc.png', 'png', 'Official GitHub org avatar'),
  },
  {
    family: 'trae',
    mcpConfigRelativeParts: ['trae_config.yaml'],
    agentConfigRelativeParts: ['trae_config.yaml'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.TRAE_CONFIG_FILE?.trim() || joinPath(resolveUpstreamAgentContext(context).cwd, 'trae_config.yaml'),
    resolveLiveAgentConfigPathOverride: (context = {}) =>
      resolveUpstreamAgentContext(context).env.TRAE_CONFIG_FILE?.trim() || joinPath(resolveUpstreamAgentContext(context).cwd, 'trae_config.yaml'),
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'yaml',
    mcpWriteDialect: 'yaml-typed',
    metadataSources: [
      source('https://github.com/bytedance/trae-agent/blob/main/README.md', 'Trae Agent README'),
      source('https://github.com/bytedance/trae-agent/blob/main/trae_agent/cli.py', 'TRAE_CONFIG_FILE and --config-file'),
      source('https://github.com/bytedance/trae-agent/blob/main/trae_agent/utils/config.py', 'YAML config parser and mcp_servers'),
    ],
    icon: icon('https://avatars.githubusercontent.com/u/192691831?s=200&v=4', 'png'),
  },
  {
    family: 'trae-cn',
    mcpConfigRelativeParts: ['Library', 'Application Support', 'Trae', 'User', 'settings', 'mcp.json'],
    resolveLiveMcpConfigPathOverride: (context = {}) =>
      joinPath(resolveUpstreamAgentContext(context).homeDir, 'Library', 'Application Support', 'Trae', 'User', 'settings', 'mcp.json'),
    mcpConfigKind: 'dedicated-file',
    mcpParserKind: 'json-mcpServers',
    metadataSources: [
      source('https://forum.trae.cn/t/topic/6780', 'Official community support thread with MCP paths'),
      source('https://forum.trae.cn/t/topic/6433', 'Project-local .trae/mcp.json references'),
      source('https://www.trae.cn/changelog', 'Official product site'),
    ],
    icon: icon('https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png', 'png', 'Official square favicon'),
  },
  {
    family: 'warp',
    agentConfigRelativeParts: ['.config', 'warp-terminal', 'user_preferences.json'],
    resolveLiveAgentConfigPathOverride: (context = {}) => resolveConfigHomePath(context, 'warp-terminal', 'user_preferences.json'),
    mcpConfigKind: 'none',
    mcpParserKind: 'none',
    metadataSources: [
      source('https://docs.warp.dev/terminal/warpify/subshells', 'Warp user preferences file'),
      source('https://docs.warp.dev/agent-platform/capabilities/mcp', 'Warp MCP is app-managed; no documented local config file'),
      source('https://www.warp.dev/', 'Brand/homepage'),
    ],
    icon: icon('https://framerusercontent.com/images/GybmHeNj1WzkgFqIjQYypmhg.png', 'png'),
  },
  {
    family: 'windsurf',
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
  },
  {
    family: 'zencoder',
    mcpConfigRelativeParts: ['.zencoder', 'settings.json'],
    agentConfigRelativeParts: ['.zencoder', 'settings.json'],
    mcpConfigKind: 'agent-config',
    mcpParserKind: 'jsonc-dotted-zencoder-mcpServers',
    mcpWriteDialect: 'json-url',
    metadataSources: [
      source('https://docs.zencoder.ai/features/custom-models-configuration', 'Zencoder settings file path'),
      source('https://docs.zencoder.ai/features/integrations-and-mcp', 'Zencoder MCP in settings'),
      source('https://docs.zencoder.ai/features/autonomous-agents-configuration', 'Related settings evolution'),
    ],
    icon: icon('https://zencoder.ai/hubfs/export.png', 'png'),
  },
] as const satisfies readonly KnownAgentFamilyOverrideDefinition[];

export function getRenderableAgentIconOrigins(): string[] {
  const origins: string[] = [];

  for (const override of KNOWN_AGENT_FAMILY_OVERRIDES) {
    const iconRecord = 'icon' in override ? override.icon : undefined;
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
