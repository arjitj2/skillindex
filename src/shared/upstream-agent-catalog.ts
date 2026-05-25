/**
 * Vendored snapshot of upstream agent metadata from `vercel-labs/skills`.
 *
 * Maintenance workflow:
 * 1. Refresh this file from upstream `src/agents.ts`, preserving the browser-safe
 *    adaptations in this copy.
 * 2. Reconcile intentional local divergences in `src/shared/agent-catalog-overrides.ts`
 *    and `src/shared/known-agent-catalog.ts`.
 * 3. Re-check override metadata in `src/shared/agent-catalog-overrides.ts`.
 * 4. Run the focused verification commands in `docs/reference/upstream-agent-catalog-refresh-guide.md`.
 *
 * Full refresh instructions live in `docs/reference/upstream-agent-catalog-refresh-guide.md`.
 */
import { joinPath } from './path-utils';

export interface UpstreamAgentResolutionContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathExists?: (targetPath: string) => boolean;
}

export interface UpstreamAgentFamilyDefinition {
  family: string;
  label: string;
  aliases?: string[];
  defaultProjectSkillsDir: string;
  defaultGlobalSkillsDir: string;
  compatibleGlobalSkillsDirs?: string[];
  compatibleProjectSkillsDirs?: string[];
  skillStorageKind?: 'local-directory' | 'account-managed';
  resolveGlobalSkillsDir: (context?: UpstreamAgentResolutionContext) => string;
  detectInstalled: (context?: UpstreamAgentResolutionContext) => boolean;
}

interface ResolvedUpstreamAgentContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  pathExists: (targetPath: string) => boolean;
}

export function resolveUpstreamAgentContext(context: UpstreamAgentResolutionContext = {}): ResolvedUpstreamAgentContext {
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

function configHome(context: ResolvedUpstreamAgentContext): string {
  return context.env.XDG_CONFIG_HOME?.trim() || joinPath(context.homeDir, '.config');
}

function codexHome(context: ResolvedUpstreamAgentContext): string {
  return context.env.CODEX_HOME?.trim() || joinPath(context.homeDir, '.codex');
}

function claudeHome(context: ResolvedUpstreamAgentContext): string {
  return context.env.CLAUDE_CONFIG_DIR?.trim() || joinPath(context.homeDir, '.claude');
}

function claudeDesktopConfigDir(context: ResolvedUpstreamAgentContext): string {
  return context.env.CLAUDE_DESKTOP_CONFIG_DIR?.trim()
    || joinPath(context.homeDir, 'Library', 'Application Support', 'Claude');
}

function getOpenClawGlobalSkillsDir(context: ResolvedUpstreamAgentContext): string {
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
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return joinPath(resolved.homeDir, ...parts);
  };
}

function resolveConfigHomePath(...parts: string[]) {
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return joinPath(configHome(resolved), ...parts);
  };
}

function resolveCodexHomePath(...parts: string[]) {
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return joinPath(codexHome(resolved), ...parts);
  };
}

function resolveClaudeHomePath(...parts: string[]) {
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return joinPath(claudeHome(resolved), ...parts);
  };
}

function detectHomeInstall(...parts: string[]) {
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return resolved.pathExists(joinPath(resolved.homeDir, ...parts));
  };
}

function detectConfigHomeInstall(...parts: string[]) {
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return resolved.pathExists(joinPath(configHome(resolved), ...parts));
  };
}

function detectCwdOrHomeInstall(cwdParts: string[], homeParts: string[]) {
  return (context: UpstreamAgentResolutionContext = {}) => {
    const resolved = resolveUpstreamAgentContext(context);
    return resolved.pathExists(joinPath(resolved.cwd, ...cwdParts))
      || resolved.pathExists(joinPath(resolved.homeDir, ...homeParts));
  };
}

function detectCodexInstall(context: UpstreamAgentResolutionContext = {}): boolean {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.pathExists(codexHome(resolved)) || resolved.pathExists('/etc/codex');
}

function detectClaudeInstall(context: UpstreamAgentResolutionContext = {}): boolean {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.pathExists(claudeHome(resolved));
}

function detectClaudeDesktopInstall(context: UpstreamAgentResolutionContext = {}): boolean {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.pathExists(claudeDesktopConfigDir(resolved));
}

function detectOpenClawInstall(context: UpstreamAgentResolutionContext = {}): boolean {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.pathExists(joinPath(resolved.homeDir, '.openclaw'))
    || resolved.pathExists(joinPath(resolved.homeDir, '.clawdbot'))
    || resolved.pathExists(joinPath(resolved.homeDir, '.moltbot'));
}

function detectReplitInstall(context: UpstreamAgentResolutionContext = {}): boolean {
  const resolved = resolveUpstreamAgentContext(context);
  return resolved.pathExists(joinPath(resolved.cwd, '.replit'));
}

export const UPSTREAM_AGENT_FAMILIES = [
  {
    family: 'adal',
    label: 'AdaL',
    defaultProjectSkillsDir: '.adal/skills',
    defaultGlobalSkillsDir: '~/.adal/skills',
    resolveGlobalSkillsDir: resolveHomePath('.adal', 'skills'),
    detectInstalled: detectHomeInstall('.adal'),
  },
  {
    family: 'amp',
    label: 'Amp',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.config/agents/skills',
    compatibleGlobalSkillsDirs: ['~/.claude/skills'],
    compatibleProjectSkillsDirs: ['.claude/skills'],
    resolveGlobalSkillsDir: resolveConfigHomePath('agents', 'skills'),
    detectInstalled: detectConfigHomeInstall('amp'),
  },
  {
    family: 'antigravity',
    label: 'Antigravity',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.gemini/antigravity/skills',
    resolveGlobalSkillsDir: resolveHomePath('.gemini', 'antigravity', 'skills'),
    detectInstalled: detectHomeInstall('.gemini', 'antigravity'),
  },
  {
    family: 'augment',
    label: 'Augment',
    defaultProjectSkillsDir: '.augment/skills',
    defaultGlobalSkillsDir: '~/.augment/skills',
    resolveGlobalSkillsDir: resolveHomePath('.augment', 'skills'),
    detectInstalled: detectHomeInstall('.augment'),
  },
  {
    family: 'bob',
    label: 'IBM Bob',
    defaultProjectSkillsDir: '.bob/skills',
    defaultGlobalSkillsDir: '~/.bob/skills',
    resolveGlobalSkillsDir: resolveHomePath('.bob', 'skills'),
    detectInstalled: detectHomeInstall('.bob'),
  },
  {
    family: 'claude',
    label: 'Claude Code',
    aliases: ['claude-code'],
    defaultProjectSkillsDir: '.claude/skills',
    defaultGlobalSkillsDir: '~/.claude/skills',
    resolveGlobalSkillsDir: resolveClaudeHomePath('skills'),
    detectInstalled: detectClaudeInstall,
  },
  {
    family: 'claude-desktop',
    label: 'Claude Desktop',
    aliases: ['claude-for-desktop'],
    defaultProjectSkillsDir: 'claude.ai Customize > Skills',
    defaultGlobalSkillsDir: 'claude.ai Customize > Skills',
    skillStorageKind: 'account-managed',
    resolveGlobalSkillsDir: (context = {}) => {
      const resolved = resolveUpstreamAgentContext(context);
      return claudeDesktopConfigDir(resolved);
    },
    detectInstalled: detectClaudeDesktopInstall,
  },
  {
    family: 'cline',
    label: 'Cline',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.agents/skills',
    resolveGlobalSkillsDir: resolveHomePath('.agents', 'skills'),
    detectInstalled: detectHomeInstall('.cline'),
  },
  {
    family: 'codebuddy',
    label: 'CodeBuddy',
    defaultProjectSkillsDir: '.codebuddy/skills',
    defaultGlobalSkillsDir: '~/.codebuddy/skills',
    resolveGlobalSkillsDir: resolveHomePath('.codebuddy', 'skills'),
    detectInstalled: detectCwdOrHomeInstall(['.codebuddy'], ['.codebuddy']),
  },
  {
    family: 'codex',
    label: 'Codex',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.codex/skills',
    compatibleGlobalSkillsDirs: ['~/.codex/skills'],
    resolveGlobalSkillsDir: resolveCodexHomePath('skills'),
    detectInstalled: detectCodexInstall,
  },
  {
    family: 'command-code',
    label: 'Command Code',
    defaultProjectSkillsDir: '.commandcode/skills',
    defaultGlobalSkillsDir: '~/.commandcode/skills',
    resolveGlobalSkillsDir: resolveHomePath('.commandcode', 'skills'),
    detectInstalled: detectHomeInstall('.commandcode'),
  },
  {
    family: 'continue',
    label: 'Continue',
    defaultProjectSkillsDir: '.continue/skills',
    defaultGlobalSkillsDir: '~/.continue/skills',
    resolveGlobalSkillsDir: resolveHomePath('.continue', 'skills'),
    detectInstalled: detectCwdOrHomeInstall(['.continue'], ['.continue']),
  },
  {
    family: 'cortex',
    label: 'Cortex Code',
    defaultProjectSkillsDir: '.cortex/skills',
    defaultGlobalSkillsDir: '~/.cortex/skills',
    resolveGlobalSkillsDir: resolveHomePath('.cortex', 'skills'),
    detectInstalled: detectHomeInstall('.snowflake', 'cortex'),
  },
  {
    family: 'crush',
    label: 'Crush',
    defaultProjectSkillsDir: '.crush/skills',
    defaultGlobalSkillsDir: '~/.crush/skills',
    resolveGlobalSkillsDir: resolveHomePath('.crush', 'skills'),
    detectInstalled: detectHomeInstall('.config', 'crush'),
  },
  {
    family: 'cursor',
    label: 'Cursor',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.cursor/skills',
    resolveGlobalSkillsDir: resolveHomePath('.cursor', 'skills'),
    detectInstalled: detectHomeInstall('.cursor'),
  },
  {
    family: 'deepagents',
    label: 'Deep Agents',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.deepagents/agent/skills',
    resolveGlobalSkillsDir: resolveHomePath('.deepagents', 'agent', 'skills'),
    detectInstalled: detectHomeInstall('.deepagents'),
  },
  {
    family: 'factory',
    label: 'Droid',
    aliases: ['droid'],
    defaultProjectSkillsDir: '.factory/skills',
    defaultGlobalSkillsDir: '~/.factory/skills',
    resolveGlobalSkillsDir: resolveHomePath('.factory', 'skills'),
    detectInstalled: detectHomeInstall('.factory'),
  },
  {
    family: 'firebender',
    label: 'Firebender',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.firebender/skills',
    resolveGlobalSkillsDir: resolveHomePath('.firebender', 'skills'),
    detectInstalled: detectHomeInstall('.firebender'),
  },
  {
    family: 'gemini-cli',
    label: 'Gemini CLI',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.gemini/skills',
    resolveGlobalSkillsDir: resolveHomePath('.gemini', 'skills'),
    detectInstalled: detectHomeInstall('.gemini'),
  },
  {
    family: 'github-copilot',
    label: 'GitHub Copilot',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.copilot/skills',
    resolveGlobalSkillsDir: resolveHomePath('.copilot', 'skills'),
    detectInstalled: detectHomeInstall('.copilot'),
  },
  {
    family: 'goose',
    label: 'Goose',
    defaultProjectSkillsDir: '.goose/skills',
    defaultGlobalSkillsDir: '~/.goose/skills',
    resolveGlobalSkillsDir: resolveHomePath('.goose', 'skills'),
    detectInstalled: detectConfigHomeInstall('goose'),
  },
  {
    family: 'iflow-cli',
    label: 'iFlow CLI',
    defaultProjectSkillsDir: '.iflow/skills',
    defaultGlobalSkillsDir: '~/.iflow/skills',
    resolveGlobalSkillsDir: resolveHomePath('.iflow', 'skills'),
    detectInstalled: detectHomeInstall('.iflow'),
  },
  {
    family: 'junie',
    label: 'Junie',
    defaultProjectSkillsDir: '.junie/skills',
    defaultGlobalSkillsDir: '~/.junie/skills',
    resolveGlobalSkillsDir: resolveHomePath('.junie', 'skills'),
    detectInstalled: detectHomeInstall('.junie'),
  },
  {
    family: 'kilo',
    label: 'Kilo Code',
    defaultProjectSkillsDir: '.kilocode/skills',
    defaultGlobalSkillsDir: '~/.kilocode/skills',
    resolveGlobalSkillsDir: resolveHomePath('.kilocode', 'skills'),
    detectInstalled: detectHomeInstall('.kilocode'),
  },
  {
    family: 'kimi-cli',
    label: 'Kimi Code CLI',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.config/agents/skills',
    resolveGlobalSkillsDir: resolveHomePath('.config', 'agents', 'skills'),
    detectInstalled: detectHomeInstall('.kimi'),
  },
  {
    family: 'kiro-cli',
    label: 'Kiro CLI',
    defaultProjectSkillsDir: '.kiro/skills',
    defaultGlobalSkillsDir: '~/.kiro/skills',
    resolveGlobalSkillsDir: resolveHomePath('.kiro', 'skills'),
    detectInstalled: detectHomeInstall('.kiro'),
  },
  {
    family: 'kode',
    label: 'Kode',
    defaultProjectSkillsDir: '.kode/skills',
    defaultGlobalSkillsDir: '~/.kode/skills',
    resolveGlobalSkillsDir: resolveHomePath('.kode', 'skills'),
    detectInstalled: detectHomeInstall('.kode'),
  },
  {
    family: 'mcpjam',
    label: 'MCPJam',
    defaultProjectSkillsDir: '.mcpjam/skills',
    defaultGlobalSkillsDir: '~/.mcpjam/skills',
    resolveGlobalSkillsDir: resolveHomePath('.mcpjam', 'skills'),
    detectInstalled: detectHomeInstall('.mcpjam'),
  },
  {
    family: 'mistral-vibe',
    label: 'Mistral Vibe',
    defaultProjectSkillsDir: '.vibe/skills',
    defaultGlobalSkillsDir: '~/.vibe/skills',
    resolveGlobalSkillsDir: resolveHomePath('.vibe', 'skills'),
    detectInstalled: detectHomeInstall('.vibe'),
  },
  {
    family: 'mux',
    label: 'Mux',
    defaultProjectSkillsDir: '.mux/skills',
    defaultGlobalSkillsDir: '~/.mux/skills',
    resolveGlobalSkillsDir: resolveHomePath('.mux', 'skills'),
    detectInstalled: detectHomeInstall('.mux'),
  },
  {
    family: 'neovate',
    label: 'Neovate',
    defaultProjectSkillsDir: '.neovate/skills',
    defaultGlobalSkillsDir: '~/.neovate/skills',
    resolveGlobalSkillsDir: resolveHomePath('.neovate', 'skills'),
    detectInstalled: detectHomeInstall('.neovate'),
  },
  {
    family: 'openclaw',
    label: 'OpenClaw',
    defaultProjectSkillsDir: 'skills',
    defaultGlobalSkillsDir: '~/.openclaw/skills',
    resolveGlobalSkillsDir: (context = {}) => getOpenClawGlobalSkillsDir(resolveUpstreamAgentContext(context)),
    detectInstalled: detectOpenClawInstall,
  },
  {
    family: 'opencode',
    label: 'OpenCode',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.config/opencode/skills',
    compatibleGlobalSkillsDirs: ['~/.claude/skills'],
    resolveGlobalSkillsDir: resolveConfigHomePath('opencode', 'skills'),
    detectInstalled: detectConfigHomeInstall('opencode'),
  },
  {
    family: 'openhands',
    label: 'OpenHands',
    defaultProjectSkillsDir: '.openhands/skills',
    defaultGlobalSkillsDir: '~/.openhands/skills',
    resolveGlobalSkillsDir: resolveHomePath('.openhands', 'skills'),
    detectInstalled: detectHomeInstall('.openhands'),
  },
  {
    family: 'pi',
    label: 'Pi',
    defaultProjectSkillsDir: '.pi/skills',
    defaultGlobalSkillsDir: '~/.pi/skills',
    resolveGlobalSkillsDir: resolveHomePath('.pi', 'skills'),
    detectInstalled: detectHomeInstall('.pi', 'agent'),
  },
  {
    family: 'pochi',
    label: 'Pochi',
    defaultProjectSkillsDir: '.pochi/skills',
    defaultGlobalSkillsDir: '~/.pochi/skills',
    resolveGlobalSkillsDir: resolveHomePath('.pochi', 'skills'),
    detectInstalled: detectHomeInstall('.pochi'),
  },
  {
    family: 'qoder',
    label: 'Qoder',
    defaultProjectSkillsDir: '.qoder/skills',
    defaultGlobalSkillsDir: '~/.qoder/skills',
    resolveGlobalSkillsDir: resolveHomePath('.qoder', 'skills'),
    detectInstalled: detectHomeInstall('.qoder'),
  },
  {
    family: 'qwen-code',
    label: 'Qwen Code',
    defaultProjectSkillsDir: '.qwen/skills',
    defaultGlobalSkillsDir: '~/.qwen/skills',
    resolveGlobalSkillsDir: resolveHomePath('.qwen', 'skills'),
    detectInstalled: detectHomeInstall('.qwen'),
  },
  {
    family: 'replit',
    label: 'Replit',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.config/agents/skills',
    resolveGlobalSkillsDir: resolveConfigHomePath('agents', 'skills'),
    detectInstalled: detectReplitInstall,
  },
  {
    family: 'roo',
    label: 'Roo Code',
    defaultProjectSkillsDir: '.roo/skills',
    defaultGlobalSkillsDir: '~/.roo/skills',
    resolveGlobalSkillsDir: resolveHomePath('.roo', 'skills'),
    detectInstalled: detectHomeInstall('.roo'),
  },
  {
    family: 'trae',
    label: 'Trae',
    defaultProjectSkillsDir: '.trae/skills',
    defaultGlobalSkillsDir: '~/.trae/skills',
    resolveGlobalSkillsDir: resolveHomePath('.trae', 'skills'),
    detectInstalled: detectHomeInstall('.trae'),
  },
  {
    family: 'trae-cn',
    label: 'Trae CN',
    defaultProjectSkillsDir: '.trae/skills',
    defaultGlobalSkillsDir: '~/.trae/skills',
    resolveGlobalSkillsDir: resolveHomePath('.trae', 'skills'),
    detectInstalled: detectHomeInstall('.trae-cn'),
  },
  {
    family: 'warp',
    label: 'Warp',
    defaultProjectSkillsDir: '.agents/skills',
    defaultGlobalSkillsDir: '~/.agents/skills',
    resolveGlobalSkillsDir: resolveHomePath('.agents', 'skills'),
    detectInstalled: detectHomeInstall('.warp'),
  },
  {
    family: 'windsurf',
    label: 'Windsurf',
    defaultProjectSkillsDir: '.windsurf/skills',
    defaultGlobalSkillsDir: '~/.codeium/windsurf/skills',
    resolveGlobalSkillsDir: resolveHomePath('.codeium', 'windsurf', 'skills'),
    detectInstalled: detectHomeInstall('.codeium', 'windsurf'),
  },
  {
    family: 'zencoder',
    label: 'Zencoder',
    defaultProjectSkillsDir: '.zencoder/skills',
    defaultGlobalSkillsDir: '~/.zencoder/skills',
    resolveGlobalSkillsDir: resolveHomePath('.zencoder', 'skills'),
    detectInstalled: detectHomeInstall('.zencoder'),
  },
] as const satisfies readonly UpstreamAgentFamilyDefinition[];

export type UpstreamAgentFamily = (typeof UPSTREAM_AGENT_FAMILIES)[number]['family'];
