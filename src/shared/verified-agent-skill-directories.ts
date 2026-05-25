import type { AgentMetadataSource } from './contracts';
import { CANONICAL_USER_SKILLS_DISPLAY_PATH } from './skill-path-policy';

export interface VerifiedAgentSkillDirectoryFacts {
  family: string;
  defaultGlobalSkillsDir?: string;
  compatibleGlobalSkillsDirs?: readonly string[];
  evidence: readonly AgentMetadataSource[];
}

function source(url: string, note: string): AgentMetadataSource {
  return { url, note };
}

export const VERIFIED_AGENT_SKILL_DIRECTORIES = [
  {
    family: 'codex',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.codex/skills'],
    evidence: [
      source('https://developers.openai.com/codex/skills', 'Codex docs list ~/.agents/skills as the user-level skills directory.'),
    ],
  },
  {
    family: 'cursor',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.cursor/skills'],
    evidence: [
      source('https://cursor.com/docs/skills#skill-directories', 'Cursor docs list ~/.agents/skills as a skill directory.'),
    ],
  },
  {
    family: 'deepagents',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.deepagents/agent/skills'],
    evidence: [
      source('https://docs.langchain.com/oss/python/deepagents/skills', 'Deep Agents accepts configured skill directories; Skill Index treats ~/.agents/skills as the verified shared user location.'),
    ],
  },
  {
    family: 'firebender',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.firebender/skills'],
    evidence: [
      source('https://docs.firebender.com/multi-agent/skills', 'Firebender docs say it loads ~/.agents/skills for cross-compatible skills.'),
    ],
  },
  {
    family: 'gemini-cli',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.gemini/skills'],
    evidence: [
      source('https://geminicli.com/docs/cli/using-agent-skills/#discovery-tiers', 'Gemini CLI docs list ~/.agents/skills as a user-skill alias.'),
    ],
  },
  {
    family: 'github-copilot',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.copilot/skills'],
    evidence: [
      source('https://docs.github.com/en/copilot/concepts/agents/about-agent-skills', 'GitHub Copilot docs list ~/.agents/skills for personal skills.'),
    ],
  },
  {
    family: 'kimi-cli',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.config/agents/skills'],
    evidence: [
      source('https://moonshotai.github.io/kimi-cli/en/customization/skills.html#skill-discovery', 'Kimi CLI docs list ~/.agents/skills in the generic user-level skill group.'),
    ],
  },
  {
    family: 'opencode',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.config/opencode/skills', '~/.claude/skills'],
    evidence: [
      source('https://opencode.ai/docs/skills/', 'OpenCode docs list ~/.agents/skills as a global agent-compatible skill directory.'),
    ],
  },
  {
    family: 'warp',
    defaultGlobalSkillsDir: CANONICAL_USER_SKILLS_DISPLAY_PATH,
    compatibleGlobalSkillsDirs: ['~/.warp/skills'],
    evidence: [
      source('https://docs.warp.dev/agent-platform/capabilities/skills#skill-locations', 'Warp docs recommend ~/.agents/skills for global skills.'),
    ],
  },
] as const satisfies readonly VerifiedAgentSkillDirectoryFacts[];
