import { describe, expect, it } from 'vitest';

import { AGENT_CATALOG, getAgentCatalogEntry, getRenderableAgentIconOrigins } from './agent-catalog';

function arrayContaining(values: Parameters<typeof expect.arrayContaining>[0]): unknown {
  return expect.arrayContaining(values);
}

describe('agent catalog skill directory facts', () => {
  it('keeps non-verified native global skill directories in merged data', () => {
    expect(getAgentCatalogEntry('amp')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.config/agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.config/agents/skills', '~/.claude/skills']),
      compatibleProjectSkillsDirs: ['.claude/skills'],
    });
    expect(getAgentCatalogEntry('antigravity')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.gemini/antigravity/skills',
    });
    expect(getAgentCatalogEntry('windsurf')).toMatchObject({
      defaultProjectSkillsDir: '.windsurf/skills',
      defaultGlobalSkillsDir: '~/.codeium/windsurf/skills',
    });
  });

  it('lets verified primary-doc facts become the merged default global skill dir', () => {
    expect(getAgentCatalogEntry('cursor')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.cursor/skills']),
      nativeGlobalSkillsDir: '~/.cursor/skills',
    });
    expect(getAgentCatalogEntry('codex')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.codex/skills']),
      nativeGlobalSkillsDir: '~/.codex/skills',
    });
    expect(getAgentCatalogEntry('opencode')).toMatchObject({
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.config/opencode/skills', '~/.claude/skills']),
      nativeGlobalSkillsDir: '~/.config/opencode/skills',
      mcpParserKind: 'jsonc-opencode-mcp',
      mcpWriteDialect: 'json-opencode',
    });
    expect(getAgentCatalogEntry('claude')).toMatchObject({
      label: 'Claude Code',
      defaultProjectSkillsDir: '.claude/skills',
      defaultGlobalSkillsDir: '~/.claude/skills',
      mcpConfigKind: 'dedicated-file',
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-type-url',
    });
    expect(getAgentCatalogEntry('claude-desktop')).toMatchObject({
      label: 'Claude Desktop',
      skillStorageKind: 'account-managed',
      defaultGlobalSkillsDir: 'claude.ai Customize > Skills',
      mcpConfigKind: 'dedicated-file',
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-url',
      mcpSupportedTransports: ['stdio'],
    });
    expect(getAgentCatalogEntry('amp')).toMatchObject({
      mcpParserKind: 'jsonc-dotted-amp-mcpServers',
      mcpWriteDialect: 'json-url',
    });
    expect(getAgentCatalogEntry('codebuddy')).toMatchObject({
      mcpParserKind: 'jsonc-mcpServers',
      mcpWriteDialect: 'json-url',
    });
    expect(getAgentCatalogEntry('dbt-wizard')).toMatchObject({
      label: 'dbt Wizard',
      aliases: ['wizard'],
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.agents/skills',
      nativeGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.claude/skills']),
      compatibleProjectSkillsDirs: ['.claude/skills'],
      subagentGlobalDirRelativeParts: ['.dbt', 'wizard', 'agents'],
      subagentProjectDir: '.dbt/wizard/agents',
      subagentConfigKind: 'directory',
      subagentParserKind: 'codex-toml',
      subagentWriteDialect: 'codex-toml',
      mcpConfigRelativeParts: ['.dbt', 'wizard', 'config.toml'],
      mcpConfigKind: 'agent-config',
      mcpParserKind: 'toml',
      mcpWriteDialect: 'toml-codex',
      mcpSupportedTransports: ['stdio', 'streamable-http'],
    });
    expect(getAgentCatalogEntry('gemini-cli')).toMatchObject({
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-http-url',
    });
    expect(getAgentCatalogEntry('mistral-vibe')).toMatchObject({
      mcpParserKind: 'toml-mcpServers-array',
      mcpWriteDialect: 'toml-transport-array',
    });
    expect(getAgentCatalogEntry('openclaw')).toMatchObject({
      mcpParserKind: 'jsonc-mcp-servers',
      mcpWriteDialect: 'json-openclaw',
    });
    expect(getAgentCatalogEntry('qwen-code')).toMatchObject({
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-http-url',
    });
    expect(getAgentCatalogEntry('zencoder')).toMatchObject({
      mcpParserKind: 'jsonc-dotted-zencoder-mcpServers',
      mcpWriteDialect: 'json-url',
    });
    expect(getAgentCatalogEntry('replit')).toMatchObject({
      mcpConfigKind: 'none',
      mcpParserKind: 'none',
    });
    expect(getAgentCatalogEntry('mcpjam')).toMatchObject({
      mcpConfigKind: 'none',
      mcpParserKind: 'none',
    });
    expect(getAgentCatalogEntry('warp')).toMatchObject({
      mcpConfigKind: 'none',
      mcpParserKind: 'none',
    });
  });

  it('keeps skill, MCP, subagent, and source facts in the canonical catalog entry', () => {
    expect(AGENT_CATALOG.find((facts) => facts.family === 'cursor')).toMatchObject({
      defaultGlobalSkillsDir: '~/.agents/skills',
      nativeGlobalSkillsDir: '~/.cursor/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.cursor/skills']),
      mcpConfigRelativeParts: ['.cursor', 'mcp.json'],
      subagentConfigKind: 'none',
    });

    expect(getAgentCatalogEntry('cursor').metadataSources).toEqual(
      arrayContaining([
        expect.objectContaining({
          url: 'https://cursor.com/docs/skills#skill-directories',
        }),
      ]),
    );
  });

  it('does not mark agent families canonical or universal', () => {
    expect(getAgentCatalogEntry('amp')).not.toHaveProperty('canonical');
    expect(getAgentCatalogEntry('amp')).not.toHaveProperty('universal');
  });
});

describe('agent catalog icon metadata', () => {
  it('derives renderer-safe origins from valid renderable icon URLs', () => {
    const origins = getRenderableAgentIconOrigins();

    expect(origins).toContain('https://cursor.com');
    for (const origin of origins) {
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it('uses directly renderable square icon assets for the reported agent list regressions', () => {
    expect(getAgentCatalogEntry('adal').icon).toMatchObject({
      assetUrl: 'https://github.com/SylphAI-Inc.png',
      format: 'png',
    });
    expect(getAgentCatalogEntry('amp').icon).toMatchObject({
      assetUrl: 'https://ampcode.com/amp-mark-color.svg',
      format: 'svg',
    });
    expect(getAgentCatalogEntry('augment').icon).toMatchObject({
      assetUrl: 'https://www.augmentcode.com/favicon.svg',
      format: 'svg',
    });
    expect(getAgentCatalogEntry('cline').icon).toMatchObject({
      assetUrl: 'https://cline.bot/assets/branding/brand/App%20Icons/PNG/APP_ICON_LIGHT.png',
      format: 'png',
    });
    expect(getAgentCatalogEntry('continue').icon).toMatchObject({
      assetUrl: 'https://www.continue.dev/favicon.png',
      format: 'png',
    });
    expect(getAgentCatalogEntry('cursor').icon).toMatchObject({
      assetUrl: 'https://cursor.com/marketing-static/icon-512x512.png',
      format: 'png',
    });
    expect(getAgentCatalogEntry('opencode').icon).toMatchObject({
      assetUrl: 'https://opencode.ai/apple-touch-icon-v3.png',
      format: 'png',
    });
    expect(getAgentCatalogEntry('codebuddy').icon).toMatchObject({
      assetUrl: 'https://cdn.prod.website-files.com/65a6a15ecd9b4909597c6be5/689dfd72095849f4e1693503_Stack-Icon-Thin.svg',
      format: 'svg',
    });
    expect(getAgentCatalogEntry('cortex').icon).toMatchObject({
      assetUrl: 'https://www.snowflake.com/etc.clientlibs/snowflake-site/clientlibs/clientlib-react/resources/apple-touch-icon.png?v=3',
      format: 'png',
    });
    expect(getAgentCatalogEntry('deepagents').icon).toMatchObject({
      assetUrl: 'https://deepagents.org/deep_icon.svg',
      format: 'svg',
    });
    expect(getAgentCatalogEntry('github-copilot').icon).toMatchObject({
      assetUrl: 'https://github.com/github.png',
      format: 'png',
    });
    expect(getAgentCatalogEntry('goose').icon).toMatchObject({
      assetUrl: 'https://goose-docs.ai/img/favicon.ico',
      format: 'ico',
    });
    expect(getAgentCatalogEntry('kode').icon).toMatchObject({
      assetUrl: 'https://avatars.githubusercontent.com/u/189210346?v=4',
      format: 'png',
    });
    expect(getAgentCatalogEntry('pi').icon).toMatchObject({
      assetUrl: 'https://framerusercontent.com/images/Hu7aeJCxpUvwSxyA5mfRMSPAqAU.svg',
      format: 'svg',
    });
    expect(getAgentCatalogEntry('qoder').icon).toMatchObject({
      assetUrl: 'https://img.alicdn.com/imgextra/i3/O1CN01KliT1u1jEq947NlKH_!!6000000004517-55-tps-180-180.svg',
      format: 'svg',
    });
    expect(getAgentCatalogEntry('trae-cn').icon).toMatchObject({
      assetUrl: 'https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png',
      format: 'png',
    });
  });
});
