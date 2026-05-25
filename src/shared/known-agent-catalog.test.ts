import { describe, expect, it } from 'vitest';

import { getRenderableAgentIconOrigins, KNOWN_AGENT_FAMILY_OVERRIDES } from './agent-catalog-overrides';
import { getKnownAgentFamily } from './known-agent-catalog';
import { VERIFIED_AGENT_SKILL_DIRECTORIES } from './verified-agent-skill-directories';

function arrayContaining(values: Parameters<typeof expect.arrayContaining>[0]): unknown {
  return expect.arrayContaining(values);
}

describe('known agent skill directory facts', () => {
  it('keeps non-verified native global skill directories in merged data', () => {
    expect(getKnownAgentFamily('amp')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.config/agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.config/agents/skills', '~/.claude/skills']),
      compatibleProjectSkillsDirs: ['.claude/skills'],
    });
    expect(getKnownAgentFamily('antigravity')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.gemini/antigravity/skills',
    });
    expect(getKnownAgentFamily('windsurf')).toMatchObject({
      defaultProjectSkillsDir: '.windsurf/skills',
      defaultGlobalSkillsDir: '~/.codeium/windsurf/skills',
    });
  });

  it('lets verified primary-doc facts become the merged default global skill dir', () => {
    expect(getKnownAgentFamily('cursor')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.cursor/skills']),
      upstreamDefaultGlobalSkillsDir: '~/.cursor/skills',
    });
    expect(getKnownAgentFamily('codex')).toMatchObject({
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.codex/skills']),
      upstreamDefaultGlobalSkillsDir: '~/.codex/skills',
    });
    expect(getKnownAgentFamily('opencode')).toMatchObject({
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: arrayContaining(['~/.agents/skills', '~/.config/opencode/skills', '~/.claude/skills']),
      upstreamDefaultGlobalSkillsDir: '~/.config/opencode/skills',
      mcpParserKind: 'jsonc-opencode-mcp',
      mcpWriteDialect: 'json-opencode',
    });
    expect(getKnownAgentFamily('claude')).toMatchObject({
      label: 'Claude Code',
      defaultProjectSkillsDir: '.claude/skills',
      defaultGlobalSkillsDir: '~/.claude/skills',
      mcpConfigKind: 'dedicated-file',
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-type-url',
    });
    expect(getKnownAgentFamily('claude-desktop')).toMatchObject({
      label: 'Claude Desktop',
      skillStorageKind: 'account-managed',
      defaultGlobalSkillsDir: 'claude.ai Customize > Skills',
      mcpConfigKind: 'dedicated-file',
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-url',
      mcpSupportedTransports: ['stdio'],
    });
    expect(getKnownAgentFamily('amp')).toMatchObject({
      mcpParserKind: 'jsonc-dotted-amp-mcpServers',
      mcpWriteDialect: 'json-url',
    });
    expect(getKnownAgentFamily('codebuddy')).toMatchObject({
      mcpParserKind: 'jsonc-mcpServers',
      mcpWriteDialect: 'json-url',
    });
    expect(getKnownAgentFamily('gemini-cli')).toMatchObject({
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-http-url',
    });
    expect(getKnownAgentFamily('mistral-vibe')).toMatchObject({
      mcpParserKind: 'toml-mcpServers-array',
      mcpWriteDialect: 'toml-transport-array',
    });
    expect(getKnownAgentFamily('openclaw')).toMatchObject({
      mcpParserKind: 'jsonc-mcp-servers',
      mcpWriteDialect: 'json-openclaw',
    });
    expect(getKnownAgentFamily('qwen-code')).toMatchObject({
      mcpParserKind: 'json-mcpServers',
      mcpWriteDialect: 'json-http-url',
    });
    expect(getKnownAgentFamily('zencoder')).toMatchObject({
      mcpParserKind: 'jsonc-dotted-zencoder-mcpServers',
      mcpWriteDialect: 'json-url',
    });
    expect(getKnownAgentFamily('replit')).toMatchObject({
      mcpConfigKind: 'none',
      mcpParserKind: 'none',
    });
    expect(getKnownAgentFamily('mcpjam')).toMatchObject({
      mcpConfigKind: 'none',
      mcpParserKind: 'none',
    });
    expect(getKnownAgentFamily('warp')).toMatchObject({
      mcpConfigKind: 'none',
      mcpParserKind: 'none',
    });
  });

  it('keeps verified skill directory facts out of Skill Index overrides', () => {
    expect(VERIFIED_AGENT_SKILL_DIRECTORIES.find((facts) => facts.family === 'cursor')).toMatchObject({
      defaultGlobalSkillsDir: '~/.agents/skills',
      compatibleGlobalSkillsDirs: ['~/.cursor/skills'],
    });

    for (const override of KNOWN_AGENT_FAMILY_OVERRIDES) {
      expect(override).not.toHaveProperty('defaultGlobalSkillsDir');
      expect(override).not.toHaveProperty('compatibleGlobalSkillsDirs');
      expect(override).not.toHaveProperty('upstreamDefaultGlobalSkillsDir');
    }
  });

  it('does not let Skill Index overrides rewrite skill dirs or mark agent families canonical', () => {
    for (const override of KNOWN_AGENT_FAMILY_OVERRIDES) {
      expect(override).not.toHaveProperty('defaultGlobalSkillsDirOverride');
      expect(override).not.toHaveProperty('compatibleGlobalSkillsDirOverrides');
      expect(override).not.toHaveProperty('canonical');
      expect(override).not.toHaveProperty('universal');
    }

    expect(getKnownAgentFamily('amp')).not.toHaveProperty('canonical');
    expect(getKnownAgentFamily('amp')).not.toHaveProperty('universal');
  });
});

describe('known agent icon metadata', () => {
  it('derives renderer-safe origins from valid renderable icon URLs', () => {
    const origins = getRenderableAgentIconOrigins();

    expect(origins).toContain('https://cursor.com');
    for (const origin of origins) {
      expect(new URL(origin).origin).toBe(origin);
    }
  });

  it('uses directly renderable square icon assets for the reported agent list regressions', () => {
    expect(getKnownAgentFamily('adal').icon).toMatchObject({
      assetUrl: 'https://github.com/SylphAI-Inc.png',
      format: 'png',
    });
    expect(getKnownAgentFamily('amp').icon).toMatchObject({
      assetUrl: 'https://ampcode.com/amp-mark-color.svg',
      format: 'svg',
    });
    expect(getKnownAgentFamily('augment').icon).toMatchObject({
      assetUrl: 'https://www.augmentcode.com/favicon.svg',
      format: 'svg',
    });
    expect(getKnownAgentFamily('cline').icon).toMatchObject({
      assetUrl: 'https://cline.bot/assets/branding/brand/App%20Icons/PNG/APP_ICON_LIGHT.png',
      format: 'png',
    });
    expect(getKnownAgentFamily('continue').icon).toMatchObject({
      assetUrl: 'https://www.continue.dev/favicon.png',
      format: 'png',
    });
    expect(getKnownAgentFamily('cursor').icon).toMatchObject({
      assetUrl: 'https://cursor.com/marketing-static/icon-512x512.png',
      format: 'png',
    });
    expect(getKnownAgentFamily('opencode').icon).toMatchObject({
      assetUrl: 'https://opencode.ai/apple-touch-icon-v3.png',
      format: 'png',
    });
    expect(getKnownAgentFamily('codebuddy').icon).toMatchObject({
      assetUrl: 'https://cdn.prod.website-files.com/65a6a15ecd9b4909597c6be5/689dfd72095849f4e1693503_Stack-Icon-Thin.svg',
      format: 'svg',
    });
    expect(getKnownAgentFamily('cortex').icon).toMatchObject({
      assetUrl: 'https://www.snowflake.com/etc.clientlibs/snowflake-site/clientlibs/clientlib-react/resources/apple-touch-icon.png?v=3',
      format: 'png',
    });
    expect(getKnownAgentFamily('deepagents').icon).toMatchObject({
      assetUrl: 'https://deepagents.org/deep_icon.svg',
      format: 'svg',
    });
    expect(getKnownAgentFamily('github-copilot').icon).toMatchObject({
      assetUrl: 'https://github.com/github.png',
      format: 'png',
    });
    expect(getKnownAgentFamily('goose').icon).toMatchObject({
      assetUrl: 'https://goose-docs.ai/img/favicon.ico',
      format: 'ico',
    });
    expect(getKnownAgentFamily('kode').icon).toMatchObject({
      assetUrl: 'https://avatars.githubusercontent.com/u/189210346?v=4',
      format: 'png',
    });
    expect(getKnownAgentFamily('pi').icon).toMatchObject({
      assetUrl: 'https://framerusercontent.com/images/Hu7aeJCxpUvwSxyA5mfRMSPAqAU.svg',
      format: 'svg',
    });
    expect(getKnownAgentFamily('qoder').icon).toMatchObject({
      assetUrl: 'https://img.alicdn.com/imgextra/i3/O1CN01KliT1u1jEq947NlKH_!!6000000004517-55-tps-180-180.svg',
      format: 'svg',
    });
    expect(getKnownAgentFamily('trae-cn').icon).toMatchObject({
      assetUrl: 'https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png',
      format: 'png',
    });
  });
});
