import { chmod, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentRecord, McpServerDefinition, SeedRepresentativeFixturesResult, SkillStructuralState } from '@shared/contracts';
import {
  defaultConfig,
  ensureSkillIndexSandboxLayout,
  ensureSkillIndexLayout,
  resolveSandboxSkillIndexPaths,
  writeSkillIndexConfig,
  type ResolveSkillIndexPathOptions,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';
import { updateTomlMcpServerArray, updateTomlMcpServers } from '@shared/toml-mcp';

import { buildRegisteredInventorySources, buildInventoryAgents } from '@main/inventory-source-model';
import { scanInventory } from '@main/scan-inventory';

export interface SeedRepresentativeFixturesOptions extends ResolveSkillIndexPathOptions {
  paths?: SkillIndexPaths;
}

interface FixtureDefinition {
  name: string;
  expectedState: SkillStructuralState;
  operations: FixtureOperation[];
}

interface SkillMarkdownOptions {
  skillName: string;
  description: string;
  title: string;
  bodyLines: string[];
  includeName?: boolean;
  frontMatterName?: string;
  frontMatterDescription?: string;
}

interface SubagentMarkdownOptions {
  name: string;
  description?: string;
  bodyLines: string[];
  extraFields?: Record<string, string | boolean | number>;
}

type McpDefinition = McpServerDefinition;
type RepresentativeMcpOwnerId =
  | 'sandbox-agents'
  | 'sandbox-amp'
  | 'sandbox-codebuddy'
  | 'sandbox-codex'
  | 'sandbox-claude'
  | 'sandbox-claude-desktop'
  | 'sandbox-crush'
  | 'sandbox-cursor'
  | 'sandbox-factory'
  | 'sandbox-mistral-vibe'
  | 'sandbox-mux'
  | 'sandbox-openclaw'
  | 'sandbox-opencode'
  | 'sandbox-pochi'
  | 'sandbox-windsurf'
  | 'sandbox-zencoder';

const BASE_REPRESENTATIVE_MCP_AGENT_IDS = [
  'sandbox-codex',
  'sandbox-claude',
  'sandbox-claude-desktop',
  'sandbox-cursor',
  'sandbox-factory',
  'sandbox-windsurf',
] as const;

const REPRESENTATIVE_MCP_AGENT_IDS = [
  'sandbox-amp',
  'sandbox-codebuddy',
  'sandbox-codex',
  'sandbox-claude',
  'sandbox-claude-desktop',
  'sandbox-crush',
  'sandbox-cursor',
  'sandbox-factory',
  'sandbox-mistral-vibe',
  'sandbox-mux',
  'sandbox-openclaw',
  'sandbox-opencode',
  'sandbox-pochi',
  'sandbox-windsurf',
  'sandbox-zencoder',
] as const;

const REPRESENTATIVE_SKILL_AGENT_IDS = REPRESENTATIVE_MCP_AGENT_IDS.filter((agentId) =>
  agentId !== 'sandbox-claude-desktop');

type FixtureOperation =
  | {
      type: 'write';
      sourceId: string;
      content: string;
      modifiedAt: string;
    }
  | {
      type: 'write-file';
      sourceId: string;
      relativePath: string;
      content: string;
      modifiedAt: string;
    }
  | {
      type: 'symlink';
      sourceId: string;
      targetSourceId?: string;
      targetSkillName?: string;
      targetPath?: string;
    }
  | {
      type: 'symlink-file';
      sourceId: string;
      relativePath: string;
      targetSourceId?: string;
      targetSkillName?: string;
      targetRelativePath?: string;
      targetPath?: string;
    };

const FIXTURE_SET = 'representative-agent-scan-foundation';
const INITIALLY_DISMISSED_SKILL_NAMES = new Set([
  'dismissed-drift-skill',
  'representative-dismissed-drift-skill-01',
]);
const INITIALLY_DISMISSED_MCP_NAMES = new Set([
  'muted-mcp',
  'muted-extra-mcp',
]);
const INITIALLY_DISMISSED_SUBAGENT_NAMES = new Set([
  'dismissed-subagent',
]);
const INVALID_SKILL_NAME_TOO_LONG = 'a'.repeat(65);
const INVALID_SKILL_DESCRIPTION_TOO_LONG = `Too long: ${'x'.repeat(1016)}`;
const INVALID_SKILL_NAME_WITH_LEADING_WHITESPACE = '" Leading whitespace skill"';
const INVALID_SKILL_NAME_WITH_TRAILING_WHITESPACE = '"Trailing whitespace skill "';
const INVALID_SKILL_NAME_WITH_MULTIPLE_ISSUES = `" ${'a'.repeat(65)} "`;
const MIRRORED_CANONICAL_AGENT_SOURCE_IDS = ['sandbox-codex', 'sandbox-cursor'];
const GENERATED_HEALTHY_FIXTURE_COUNT = 37;

const BASE_FIXTURES: FixtureDefinition[] = [
  {
    name: 'healthy-skill',
    expectedState: 'healthy',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'healthy-skill',
          description: 'Healthy across every installed location.',
          title: 'Healthy skill',
          bodyLines: ['This content is canonical.'],
        }),
        modifiedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'single-source-skill',
    expectedState: 'single-source-noncanonical',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-windsurf',
        content: buildSkillMarkdown({
          skillName: 'single-source-skill',
          description: 'Installed in a single location outside the universal .agents folder.',
          title: 'Single source skill',
          bodyLines: ['Only one copy exists, and it is outside the universal .agents folder.'],
        }),
        modifiedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
  },
  {
    name: 'missing-symlink-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'missing-symlink-skill',
          description: 'Universal copy exists but one installed link is still missing.',
          title: 'Missing symlink skill',
          bodyLines: ['Sandbox Factory should still point at the universal copy.'],
        }),
        modifiedAt: '2026-01-02T12:00:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'double-missing-symlink-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'double-missing-symlink-skill',
          description: 'Universal copy exists but two installed links are still missing.',
          title: 'Double missing symlink skill',
          bodyLines: ['Sandbox Factory and Windsurf should still point at the universal copy.'],
        }),
        modifiedAt: '2026-01-02T12:15:00.000Z',
      },
    ],
  },
  {
    name: 'broken-symlink-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'broken-symlink-skill',
          description: 'Canonical file exists while one installed symlink is broken.',
          title: 'Broken symlink skill',
          bodyLines: ['One installed path points at a target that does not exist.'],
        }),
        modifiedAt: '2026-01-02T18:00:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
        targetSkillName: 'missing-broken-symlink-target',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'double-broken-symlink-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'double-broken-symlink-skill',
          description: 'Canonical file exists while two installed symlinks are broken.',
          title: 'Double broken symlink skill',
          bodyLines: ['Two installed paths point at missing targets.'],
        }),
        modifiedAt: '2026-01-02T18:15:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
        targetSkillName: 'missing-broken-symlink-target-a',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
        targetSkillName: 'missing-broken-symlink-target-b',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'wrong-symlink-target-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'wrong-symlink-target-skill',
          description: 'Canonical file exists while one installed symlink points elsewhere.',
          title: 'Wrong symlink target skill',
          bodyLines: ['One installed path points at another canonical skill instead.'],
        }),
        modifiedAt: '2026-01-02T19:00:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
        targetSkillName: 'healthy-skill',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'double-wrong-symlink-target-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'double-wrong-symlink-target-skill',
          description: 'Canonical file exists while two installed symlinks point elsewhere.',
          title: 'Double wrong symlink target skill',
          bodyLines: ['Two installed paths point at other canonical skills instead.'],
        }),
        modifiedAt: '2026-01-02T19:15:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
        targetSkillName: 'healthy-skill',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
        targetSkillName: 'missing-symlink-skill',
      },
    ],
  },
  {
    name: 'invalid-definition-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-definition-skill',
          description: 'Canonical file is present, installed everywhere, and missing required front matter.',
          title: 'Invalid definition skill',
          bodyLines: ['This canonical copy intentionally omits the required name field.'],
          includeName: false,
        }),
        modifiedAt: '2026-01-02T20:00:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'double-invalid-definition-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: [
          '---',
          'description: Canonical copy is missing its required name field.',
          '---',
          '',
          '# Double invalid definition skill',
          'Canonical invalid content.',
          '',
        ].join('\n'),
        modifiedAt: '2026-01-02T20:15:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: [
          '---',
          'name: double-invalid-definition-skill',
          '---',
          '',
          '# Double invalid definition skill',
          'Factory invalid content missing its description field.',
          '',
        ].join('\n'),
        modifiedAt: '2026-01-02T20:16:00.000Z',
      },
    ],
  },
  {
    name: 'invalid-name-length-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-name-length-skill',
          frontMatterName: INVALID_SKILL_NAME_TOO_LONG,
          description: 'Canonical copy has a skill name that is longer than the spec allows.',
          title: 'Invalid name length skill',
          bodyLines: ['The name field is intentionally longer than 64 characters.'],
        }),
        modifiedAt: '2026-01-02T20:17:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'invalid-description-length-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-description-length-skill',
          description: 'Canonical copy has a description that is longer than the spec allows.',
          frontMatterDescription: INVALID_SKILL_DESCRIPTION_TOO_LONG,
          title: 'Invalid description length skill',
          bodyLines: ['The description field is intentionally longer than 1024 characters.'],
        }),
        modifiedAt: '2026-01-02T20:18:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'invalid-name-uppercase-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-name-uppercase-skill',
          frontMatterName: INVALID_SKILL_NAME_WITH_LEADING_WHITESPACE,
          description: 'Canonical copy includes leading whitespace in the display title.',
          title: 'Invalid leading whitespace name skill',
          bodyLines: ['The name field intentionally starts with whitespace inside quotes.'],
        }),
        modifiedAt: '2026-01-02T20:19:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'invalid-name-special-char-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-name-special-char-skill',
          frontMatterName: INVALID_SKILL_NAME_WITH_TRAILING_WHITESPACE,
          description: 'Canonical copy includes trailing whitespace in the display title.',
          title: 'Invalid trailing whitespace name skill',
          bodyLines: ['The name field intentionally ends with whitespace inside quotes.'],
        }),
        modifiedAt: '2026-01-02T20:20:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'invalid-name-leading-hyphen-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-name-leading-hyphen-skill',
          frontMatterName: INVALID_SKILL_NAME_WITH_LEADING_WHITESPACE,
          description: 'Canonical copy includes leading whitespace in the display title.',
          title: 'Invalid leading whitespace name skill',
          bodyLines: ['The name field intentionally starts with whitespace inside quotes.'],
        }),
        modifiedAt: '2026-01-02T20:21:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'invalid-name-trailing-hyphen-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'invalid-name-trailing-hyphen-skill',
          frontMatterName: INVALID_SKILL_NAME_WITH_TRAILING_WHITESPACE,
          description: 'Canonical copy includes trailing whitespace in the display title.',
          title: 'Invalid trailing whitespace name skill',
          bodyLines: ['The name field intentionally ends with whitespace inside quotes.'],
        }),
        modifiedAt: '2026-01-02T20:22:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'multi-invalid-definition-skill',
    expectedState: 'missing-symlinks',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'multi-invalid-definition-skill',
          frontMatterName: INVALID_SKILL_NAME_WITH_MULTIPLE_ISSUES,
          description: 'Canonical copy combines several invalid title and description rules at once.',
          frontMatterDescription: INVALID_SKILL_DESCRIPTION_TOO_LONG,
          title: 'Multi invalid definition skill',
          bodyLines: ['The frontmatter intentionally violates several title and description rules at once.'],
        }),
        modifiedAt: '2026-01-02T20:23:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'identical-drift-skill',
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'identical-drift-skill',
          description: 'Two file copies currently match exactly.',
          title: 'Identical drift skill',
          bodyLines: ['Two real files match exactly.'],
        }),
        modifiedAt: '2026-01-03T00:00:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'identical-drift-skill',
          description: 'Two file copies currently match exactly.',
          title: 'Identical drift skill',
          bodyLines: ['Two real files match exactly.'],
        }),
        modifiedAt: '2026-01-03T00:00:01.000Z',
      },
    ],
  },
  {
    name: 'double-identical-copies-skill',
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'double-identical-copies-skill',
          description: 'Two installed copies still match the canonical content exactly.',
          title: 'Double identical copies skill',
          bodyLines: ['Claude and Factory both still have matching real-file copies.'],
        }),
        modifiedAt: '2026-01-03T00:15:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'double-identical-copies-skill',
          description: 'Two installed copies still match the canonical content exactly.',
          title: 'Double identical copies skill',
          bodyLines: ['Claude and Factory both still have matching real-file copies.'],
        }),
        modifiedAt: '2026-01-03T00:15:01.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'double-identical-copies-skill',
          description: 'Two installed copies still match the canonical content exactly.',
          title: 'Double identical copies skill',
          bodyLines: ['Claude and Factory both still have matching real-file copies.'],
        }),
        modifiedAt: '2026-01-03T00:15:02.000Z',
      },
    ],
  },
  {
    name: 'dismissed-drift-skill',
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'dismissed-drift-skill',
          description: 'Shared copy currently hidden from review.',
          title: 'Dismissed drift skill',
          bodyLines: ['Muted but unresolved.'],
        }),
        modifiedAt: '2026-01-05T00:00:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'dismissed-drift-skill',
          description: 'Shared copy currently hidden from review.',
          title: 'Dismissed drift skill',
          bodyLines: ['Muted but unresolved.'],
        }),
        modifiedAt: '2026-01-05T00:00:01.000Z',
      },
    ],
  },
  {
    name: 'double-diverged-copies-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'double-diverged-copies-skill',
          description: 'Canonical candidate content for a two-copy divergence example.',
          title: 'Double diverged copies skill',
          bodyLines: ['Canonical candidate content.'],
        }),
        modifiedAt: '2026-01-04T00:15:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'double-diverged-copies-skill',
          description: 'Claude copy drifted away from canonical.',
          title: 'Double diverged copies skill',
          bodyLines: ['Claude copy drifted in its own direction.'],
        }),
        modifiedAt: '2026-01-04T00:15:01.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'double-diverged-copies-skill',
          description: 'Factory copy drifted away from canonical.',
          title: 'Double diverged copies skill',
          bodyLines: ['Factory copy drifted differently from both canonical and Claude.'],
        }),
        modifiedAt: '2026-01-04T00:15:02.000Z',
      },
    ],
  },
  {
    name: 'diverged-drift-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'diverged-drift-skill',
          description: 'Canonical candidate content.',
          title: 'Diverged drift skill',
          bodyLines: ['Canonical candidate content.'],
        }),
        modifiedAt: '2026-01-04T00:00:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'diverged-drift-skill',
          description: 'Canonical candidate content.',
          title: 'Diverged drift skill',
          bodyLines: ['Conflicting content from Claude.'],
        }),
        modifiedAt: '2026-01-04T00:00:02.000Z',
      },
    ],
  },
  {
    name: 'double-missing-canonical-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'double-missing-canonical-skill',
          description: 'Claude has a candidate definition while canonical is missing.',
          title: 'Double missing canonical skill',
          bodyLines: ['Claude candidate content.'],
        }),
        modifiedAt: '2026-01-04T12:15:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'double-missing-canonical-skill',
          description: 'Factory has a different candidate definition while canonical is missing.',
          title: 'Double missing canonical skill',
          bodyLines: ['Factory candidate content differs from Claude.'],
        }),
        modifiedAt: '2026-01-04T12:15:01.000Z',
      },
    ],
  },
  {
    name: 'diagnostic-rich-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'diagnostic-rich-skill',
          description: 'Canonical detail candidate.',
          title: 'Diagnostic rich skill',
          bodyLines: ['Canonical content.'],
        }),
        modifiedAt: '2026-01-08T00:00:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'diagnostic-rich-skill',
          description: 'Claude detail candidate.',
          title: 'Diagnostic rich skill',
          bodyLines: ['Claude copy with its own description.'],
        }),
        modifiedAt: '2026-01-08T00:00:02.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'diagnostic-rich-skill',
          description: 'Factory copy with a description but missing a name field.',
          title: 'Diagnostic rich skill',
          bodyLines: ['Factory copy missing the required name.'],
          includeName: false,
        }),
        modifiedAt: '2026-01-08T00:00:01.000Z',
      },
    ],
  },
  {
    name: 'multi-file-entrypoint-drift-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'multi-file-entrypoint-drift-skill',
          description: 'Package where only the entrypoint drifted across installs.',
          title: 'Multi file entrypoint drift skill',
          bodyLines: ['The universal package keeps the original instructions.'],
        }),
        modifiedAt: '2026-01-08T12:00:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'rules/checklist.md',
        content: ['# Checklist', '- Follow the shared package checklist.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:00:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'scripts/validate.py',
        content: ['print("shared validation")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:00:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'multi-file-entrypoint-drift-skill',
          description: 'Package where only the Claude entrypoint drifted.',
          title: 'Multi file entrypoint drift skill',
          bodyLines: ['Claude updated only the entrypoint instructions.'],
        }),
        modifiedAt: '2026-01-08T12:00:02.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-claude',
        relativePath: 'rules/checklist.md',
        content: ['# Checklist', '- Follow the shared package checklist.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:00:02.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-claude',
        relativePath: 'scripts/validate.py',
        content: ['print("shared validation")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:00:02.000Z',
      },
    ],
  },
  {
    name: 'multi-file-support-drift-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'multi-file-support-drift-skill',
          description: 'Package where only a supporting file drifted.',
          title: 'Multi file support drift skill',
          bodyLines: ['The entrypoint still matches the universal package.'],
        }),
        modifiedAt: '2026-01-08T12:05:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'rules/usage.md',
        content: ['# Usage', 'Use the canonical support flow.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:05:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'scripts/check.py',
        content: ['print("support unchanged")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:05:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'multi-file-support-drift-skill',
          description: 'Package where only a supporting file drifted.',
          title: 'Multi file support drift skill',
          bodyLines: ['The entrypoint still matches the universal package.'],
        }),
        modifiedAt: '2026-01-08T12:05:01.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-factory',
        relativePath: 'rules/usage.md',
        content: ['# Usage', 'Factory rewrote the support flow for its own package copy.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:05:01.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-factory',
        relativePath: 'scripts/check.py',
        content: ['print("support unchanged")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:05:01.000Z',
      },
    ],
  },
  {
    name: 'multi-file-combo-drift-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'multi-file-combo-drift-skill',
          description: 'Package where both the entrypoint and support files drifted.',
          title: 'Multi file combo drift skill',
          bodyLines: ['Universal instructions stay in sync with the universal support files.'],
        }),
        modifiedAt: '2026-01-08T12:10:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'references/notes.md',
        content: ['# Notes', 'Canonical notes stay stable.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:10:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'scripts/build.py',
        content: ['print("canonical build")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:10:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName: 'multi-file-combo-drift-skill',
          description: 'Claude changed the entrypoint and one of the support files.',
          title: 'Multi file combo drift skill',
          bodyLines: ['Claude revised the instructions and the script together.'],
        }),
        modifiedAt: '2026-01-08T12:10:02.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-claude',
        relativePath: 'references/notes.md',
        content: ['# Notes', 'Canonical notes stay stable.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:10:02.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-claude',
        relativePath: 'scripts/build.py',
        content: ['print("claude build override")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:10:02.000Z',
      },
    ],
  },
  {
    name: 'partial-folder-symlink-skill',
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'partial-folder-symlink-skill',
          description: 'Folder copy whose internal files are symlinked instead of the package root.',
          title: 'Partial folder symlink skill',
          bodyLines: ['The issue is that the install is a real directory, not a directory symlink.'],
        }),
        modifiedAt: '2026-01-08T12:15:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'rules/checklist.md',
        content: ['# Checklist', '- The package root should be symlinked.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:15:00.000Z',
      },
      {
        type: 'symlink-file',
        sourceId: 'sandbox-claude',
        relativePath: 'SKILL.md',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink-file',
        sourceId: 'sandbox-claude',
        relativePath: 'rules/checklist.md',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'partial-folder-symlink-drift-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'partial-folder-symlink-drift-skill',
          description: 'Real folder install mixes internal symlinks with a drifted support file.',
          title: 'Partial folder symlink drift skill',
          bodyLines: ['The package root should still be symlinked even when one file diverges.'],
        }),
        modifiedAt: '2026-01-08T12:20:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'rules/usage.md',
        content: ['# Usage', 'Universal support instructions.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:20:00.000Z',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-agents',
        relativePath: 'scripts/audit.py',
        content: ['print("audit canonical")', ''].join('\n'),
        modifiedAt: '2026-01-08T12:20:00.000Z',
      },
      {
        type: 'symlink-file',
        sourceId: 'sandbox-factory',
        relativePath: 'SKILL.md',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink-file',
        sourceId: 'sandbox-factory',
        relativePath: 'scripts/audit.py',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'write-file',
        sourceId: 'sandbox-factory',
        relativePath: 'rules/usage.md',
        content: ['# Usage', 'Factory diverged on the nested support file while keeping other files symlinked.', ''].join('\n'),
        modifiedAt: '2026-01-08T12:20:02.000Z',
      },
    ],
  },
  {
    name: 'MiXeD-Case-Skill',
    expectedState: 'healthy',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'MiXeD-Case-Skill',
          description: 'Case-sensitive install that still resolves cleanly.',
          title: 'Mixed Case Skill',
          bodyLines: ['Case-insensitive queries should still match.'],
        }),
        modifiedAt: '2026-01-06T00:00:00.000Z',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  },
  {
    name: 'mixed-plugin-skill',
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content: buildSkillMarkdown({
          skillName: 'mixed-plugin-skill',
          description: 'Plugin-managed copy with an extra installed file.',
          title: 'Mixed plugin skill',
          bodyLines: ['Shared content from a writable source.'],
        }),
        modifiedAt: '2026-01-06T00:00:30.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-plugin-pack',
        content: buildSkillMarkdown({
          skillName: 'mixed-plugin-skill',
          description: 'Plugin-managed copy with an extra installed file.',
          title: 'Mixed plugin skill',
          bodyLines: ['Shared content from a writable source.'],
        }),
        modifiedAt: '2026-01-06T00:00:31.000Z',
      },
    ],
  },
  {
    name: 'plugin-manual-identical-skill',
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'plugin-manual-identical-skill',
          description: 'Manual and plugin copies have identical content.',
          title: 'Plugin manual identical skill',
          bodyLines: ['The manual and plugin content intentionally match.'],
        }),
        modifiedAt: '2026-01-06T00:01:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-plugin-pack',
        content: buildSkillMarkdown({
          skillName: 'plugin-manual-identical-skill',
          description: 'Manual and plugin copies have identical content.',
          title: 'Plugin manual identical skill',
          bodyLines: ['The manual and plugin content intentionally match.'],
        }),
        modifiedAt: '2026-01-06T00:01:01.000Z',
      },
    ],
  },
  {
    name: 'plugin-manual-diverged-skill',
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName: 'plugin-manual-diverged-skill',
          description: 'Manual copy differs from the plugin copy.',
          title: 'Plugin manual diverged skill',
          bodyLines: ['Manual content should be treated as distinct.'],
        }),
        modifiedAt: '2026-01-06T00:02:00.000Z',
      },
      {
        type: 'write',
        sourceId: 'sandbox-plugin-pack',
        content: buildSkillMarkdown({
          skillName: 'plugin-manual-diverged-skill',
          description: 'Plugin copy differs from the manual copy.',
          title: 'Plugin manual diverged skill',
          bodyLines: ['Plugin content should be treated as distinct.'],
        }),
        modifiedAt: '2026-01-06T00:02:01.000Z',
      },
    ],
  },
  {
    name: 'plugin-readonly-skill',
    expectedState: 'single-source-noncanonical',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-plugin-pack',
        content: buildSkillMarkdown({
          skillName: 'plugin-readonly-skill',
          description: 'Read-only plugin skill outside the universal .agents folder.',
          title: 'Plugin read-only skill',
          bodyLines: ['Installed by a plugin bundle.'],
        }),
        modifiedAt: '2026-01-07T00:00:00.000Z',
      },
    ],
  },
];

const FIXTURES: FixtureDefinition[] = [...BASE_FIXTURES, ...buildGeneratedFixtures()];

export async function seedRepresentativeFixtures(
  options: SeedRepresentativeFixturesOptions = {},
): Promise<SeedRepresentativeFixturesResult> {
  const paths = resolveSandboxSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);
  await rm(paths.sandboxRoot, { recursive: true, force: true });
  await ensureSkillIndexSandboxLayout(paths);

  const sandboxSources = buildRegisteredInventorySources({
    paths,
    env: options.env,
    homeDir: options.homeDir,
    includeSandboxSources: true,
    includeLiveSources: false,
  });
  const sourceById = new Map(sandboxSources.map((source) => [source.id, source]));

  for (const fixture of FIXTURES) {
    for (const operation of fixture.operations) {
      if (operation.type === 'write') {
        await writeFixtureFile(sourceById, fixture.name, operation.sourceId, operation.content, operation.modifiedAt);
        continue;
      }

      if (operation.type === 'write-file') {
        await writeFixturePackageFile(
          sourceById,
          fixture.name,
          operation.sourceId,
          operation.relativePath,
          operation.content,
          operation.modifiedAt,
        );
        continue;
      }

      if (operation.type === 'symlink-file') {
        await writeFixturePackageFileSymlink(
          sourceById,
          fixture.name,
          operation.sourceId,
          operation.relativePath,
          operation.targetSourceId,
          operation.targetSkillName,
          operation.targetRelativePath,
          operation.targetPath,
        );
        continue;
      }

      await writeFixtureSymlink(
        sourceById,
        fixture.name,
        operation.sourceId,
        operation.targetSourceId,
        operation.targetSkillName,
        operation.targetPath,
      );
    }

    for (const sourceId of getCanonicalMirrorSourceIds(fixture, sourceById)) {
      await writeFixtureSymlink(sourceById, fixture.name, sourceId, 'sandbox-agents');
    }
  }

  const ignoredPaths = [
    await writeIgnoredFile(sourceById, 'sandbox-claude', 'ignore-me.txt', 'ignored'),
    await writeIgnoredFile(sourceById, 'sandbox-factory', 'README', 'ignored'),
  ];

  const includeParserMatrix = shouldSeedMcpParserMatrix(options.env);
  await Promise.all([
    writeSandboxBinary(path.join(paths.sandboxRoot, 'bin', 'codex')),
    writeSandboxBinary(path.join(paths.sandboxRoot, 'bin', 'claude')),
    writeSandboxBinary(path.join(paths.sandboxRoot, 'bin', 'factory')),
    writeSandboxCodexConfig(path.join(paths.sandboxRoot, '.codex', 'config.toml')),
    mkdir(path.join(paths.sandboxRoot, 'Library', 'Application Support', 'Claude'), { recursive: true }),
    ...(includeParserMatrix ? [writeSandboxMcpParserAgentInstallMarkers(paths.sandboxRoot)] : []),
    writeSandboxClaudePluginState(paths.sandboxRoot),
    writeSandboxExamplePluginBundles(paths.sandboxRoot),
    writeSandboxClaudePluginMarketplaceMetadata(paths.sandboxRoot),
  ]);

  const sandboxAgents = await buildInventoryAgents({
    paths,
    env: options.env,
    homeDir: options.homeDir,
    includeSandboxSources: true,
    includeLiveSources: false,
  });
  const representativeMcpConfigs = buildRepresentativeMcpConfigs(includeParserMatrix);
  const representativeMcpAgentIds = includeParserMatrix
    ? REPRESENTATIVE_MCP_AGENT_IDS
    : BASE_REPRESENTATIVE_MCP_AGENT_IDS;
  await Promise.all([
    writeJsonConfig(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), representativeMcpConfigs['sandbox-agents']),
    ...representativeMcpAgentIds.map((agentId) =>
      writeAgentMcpConfig(sandboxAgents, agentId, representativeMcpConfigs[agentId])),
  ]);
  await writeSandboxSubagentFixtures(paths.sandboxRoot, sandboxAgents);
  if (includeParserMatrix) {
    await writeGeneratedHealthySkillSymlinksForAgents(sourceById, sandboxAgents, REPRESENTATIVE_SKILL_AGENT_IDS);
  }

  const seededInventory = await scanInventory({
    paths,
    includeSandboxSources: true,
    includeLiveSources: false,
  });
  const dismissedDriftSignatures = seededInventory.skills
    .filter((skill) => INITIALLY_DISMISSED_SKILL_NAMES.has(skill.name) && skill.driftSignature)
    .map((skill) => skill.driftSignature as string);
  const dismissedMcpSignatures = (seededInventory.mcps ?? [])
    .filter((mcp) => INITIALLY_DISMISSED_MCP_NAMES.has(mcp.name) && mcp.signature)
    .map((mcp) => mcp.signature as string);
  const dismissedSubagentSignatures = (seededInventory.subagents ?? [])
    .filter((subagent) => INITIALLY_DISMISSED_SUBAGENT_NAMES.has(subagent.name) && subagent.signature)
    .map((subagent) => subagent.signature as string);
  await writeSkillIndexConfig(paths.configFile, {
    ...defaultConfig,
    dismissedDriftSignatures,
    dismissedMcpSignatures,
    dismissedSubagentSignatures,
  });

  return {
    fixtureSet: FIXTURE_SET,
    sandboxRoot: paths.sandboxRoot,
    ignoredPaths,
    skills: FIXTURES.map((fixture) => ({
      name: fixture.name,
      expectedState: fixture.expectedState,
      expectedLocationCount: new Set(fixture.operations.map((operation) => operation.sourceId)).size,
    })),
  };
}

function getCanonicalMirrorSourceIds(
  fixture: FixtureDefinition,
  sourceById: Map<string, { skillsDir: string }>,
): string[] {
  const hasCanonicalPackage = fixture.operations.some((operation) =>
    operation.sourceId === 'sandbox-agents'
    && (operation.type === 'write' || operation.type === 'write-file'));
  if (!hasCanonicalPackage) {
    return [];
  }

  const explicitSourceIds = new Set(fixture.operations.map((operation) => operation.sourceId));
  return MIRRORED_CANONICAL_AGENT_SOURCE_IDS.filter((sourceId) =>
    sourceById.has(sourceId) && !explicitSourceIds.has(sourceId));
}

async function writeFixtureFile(
  sourceById: Map<string, { skillsDir: string }>,
  skillName: string,
  sourceId: string,
  content: string,
  modifiedAt: string,
): Promise<void> {
  const filePath = getSkillEntrypointPath(sourceById, sourceId, skillName);
  await writeFixturePath(filePath, content, modifiedAt);
}

async function writeFixturePackageFile(
  sourceById: Map<string, { skillsDir: string }>,
  skillName: string,
  sourceId: string,
  relativePath: string,
  content: string,
  modifiedAt: string,
): Promise<void> {
  const filePath = getSkillPackageFilePath(sourceById, sourceId, skillName, relativePath);
  await writeFixturePath(filePath, content, modifiedAt);
}

async function writeFixturePath(filePath: string, content: string, modifiedAt: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  const timestamp = new Date(modifiedAt);
  await utimes(filePath, timestamp, timestamp);
}

async function writeFixtureSymlink(
  sourceById: Map<string, { skillsDir: string }>,
  skillName: string,
  sourceId: string,
  targetSourceId?: string,
  targetSkillName?: string,
  targetPath?: string,
): Promise<void> {
  const linkPath = getSkillPackagePath(sourceById, sourceId, skillName);
  const resolvedTargetPath = targetPath
    ?? (targetSourceId
      ? getSkillPackagePath(sourceById, targetSourceId, targetSkillName ?? skillName)
      : null);
  if (!resolvedTargetPath) {
    throw new Error(`No symlink target configured for ${skillName} in ${sourceId}`);
  }
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(resolvedTargetPath, linkPath);
}

async function replaceSkillSymlink(linkPath: string, targetPath: string): Promise<void> {
  if (path.normalize(linkPath) === path.normalize(targetPath)) {
    return;
  }

  await mkdir(path.dirname(linkPath), { recursive: true });
  await rm(linkPath, { recursive: true, force: true });
  await symlink(targetPath, linkPath);
}

async function writeFixturePackageFileSymlink(
  sourceById: Map<string, { skillsDir: string }>,
  skillName: string,
  sourceId: string,
  relativePath: string,
  targetSourceId?: string,
  targetSkillName?: string,
  targetRelativePath?: string,
  targetPath?: string,
): Promise<void> {
  const linkPath = getSkillPackageFilePath(sourceById, sourceId, skillName, relativePath);
  const resolvedTargetPath = targetPath
    ?? (targetSourceId
      ? getSkillPackageFilePath(
        sourceById,
        targetSourceId,
        targetSkillName ?? skillName,
        targetRelativePath ?? relativePath,
      )
      : null);
  if (!resolvedTargetPath) {
    throw new Error(`No file symlink target configured for ${skillName}:${relativePath} in ${sourceId}`);
  }
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(resolvedTargetPath, linkPath);
}

async function writeIgnoredFile(
  sourceById: Map<string, { skillsDir: string }>,
  sourceId: string,
  fileName: string,
  content: string,
): Promise<string> {
  const source = sourceById.get(sourceId);
  if (!source) {
    throw new Error(`Unknown source id: ${sourceId}`);
  }

  const targetPath = path.join(source.skillsDir, fileName);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');
  return targetPath;
}

function getSkillPackagePath(sourceById: Map<string, { skillsDir: string }>, sourceId: string, skillName: string): string {
  const source = sourceById.get(sourceId);
  if (!source) {
    throw new Error(`Unknown source id: ${sourceId}`);
  }

  return path.join(source.skillsDir, skillName);
}

function getSkillEntrypointPath(sourceById: Map<string, { skillsDir: string }>, sourceId: string, skillName: string): string {
  return path.join(getSkillPackagePath(sourceById, sourceId, skillName), 'SKILL.md');
}

function getSkillPackageFilePath(
  sourceById: Map<string, { skillsDir: string }>,
  sourceId: string,
  skillName: string,
  relativePath: string,
): string {
  return path.join(getSkillPackagePath(sourceById, sourceId, skillName), relativePath);
}

async function writeAgentMcpConfig(
  agents: Array<{ id: string; mcpConfigLocation: { path?: string }; mcpParserKind?: string }>,
  agentId: string,
  servers: Record<string, McpDefinition>,
): Promise<void> {
  const agent = agents.find((candidate) => candidate.id === agentId);
  const configPath = agent?.mcpConfigLocation.path;
  if (!configPath) {
    throw new Error(`No MCP config path available for ${agentId}`);
  }

  await writeStructuredAgentMcpConfig(configPath, agent.mcpParserKind, servers);
}

async function writeJsonConfig(
  configPath: string,
  servers: Record<string, McpDefinition>,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
}

function shouldSeedMcpParserMatrix(env: NodeJS.ProcessEnv | undefined): boolean {
  return env?.SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX === '1';
}

async function writeSandboxMcpParserAgentInstallMarkers(sandboxRoot: string): Promise<void> {
  await Promise.all([
    mkdir(path.join(sandboxRoot, '.config', 'amp'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.codebuddy'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.config', 'crush'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.cursor'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.vibe'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.mux'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.openclaw'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.config', 'opencode'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.pochi'), { recursive: true }),
    mkdir(path.join(sandboxRoot, '.zencoder'), { recursive: true }),
  ]);
}

async function writeStructuredAgentMcpConfig(
  configPath: string,
  parserKind: string | undefined,
  servers: Record<string, McpDefinition>,
): Promise<void> {
  if (parserKind === 'toml') {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, updateTomlMcpServers('model = "gpt-5"\n', servers), 'utf8');
    return;
  }

  if (parserKind === 'toml-mcpServers-array') {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, updateTomlMcpServerArray('model = "codestral"\n', servers), 'utf8');
    return;
  }

  if (parserKind === 'jsonc-dotted-amp-mcpServers') {
    await writeJsonFile(configPath, { 'amp.mcpServers': servers });
    return;
  }

  if (parserKind === 'jsonc-dotted-zencoder-mcpServers') {
    await writeJsonFile(configPath, { 'zencoder.mcpServers': servers });
    return;
  }

  if (parserKind === 'jsonc-mcp-servers') {
    await writeJsonFile(configPath, { mcp: { servers } });
    return;
  }

  if (parserKind === 'jsonc-opencode-mcp') {
    await writeJsonFile(configPath, {
      $schema: 'https://opencode.ai/config.json',
      mcp: Object.fromEntries(
        Object.entries(servers).map(([name, definition]) => [name, toOpenCodeFixtureMcpDefinition(definition)]),
      ),
    });
    return;
  }

  const payload = parserKind === 'json-mcpServers' || parserKind === 'jsonc-mcpServers'
    ? { mcpServers: servers }
    : parserKind === 'json-mcp'
      ? { mcp: servers }
      : parserKind === 'jsonc-mcp'
        ? { mcp: servers }
        : { servers };

  await writeJsonFile(configPath, payload);
}

function toOpenCodeFixtureMcpDefinition(definition: McpDefinition): Record<string, unknown> {
  if (definition.url) {
    return {
      type: 'remote',
      url: definition.url,
      ...(definition.headers ? { headers: definition.headers } : {}),
    };
  }

  return {
    type: 'local',
    ...(definition.command ? { command: [definition.command, ...(definition.args ?? [])] } : {}),
    ...(definition.env ? { environment: definition.env } : {}),
  };
}

async function writeSandboxBinary(binaryPath: string): Promise<void> {
  await mkdir(path.dirname(binaryPath), { recursive: true });
  await writeFile(binaryPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(binaryPath, 0o755);
}

async function writeSandboxCodexConfig(configPath: string): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, 'model = "gpt-5"\n', 'utf8');
}

async function writeSandboxSubagentFixtures(sandboxRoot: string, agents: AgentRecord[]): Promise<void> {
  const canonicalDir = path.join(sandboxRoot, '.agents', 'agents');
  const claudeDir = getSandboxAgentSubagentsDir(agents, 'sandbox-claude');
  const codexDir = getSandboxAgentSubagentsDir(agents, 'sandbox-codex');
  const factoryDir = getSandboxAgentSubagentsDir(agents, 'sandbox-factory');
  const canonicalPath = (name: string) => path.join(canonicalDir, `${name}.md`);
  const claudePath = (name: string) => path.join(claudeDir ?? canonicalDir, `${name}.md`);
  const factoryPath = (name: string) => path.join(factoryDir ?? canonicalDir, `${name}.md`);
  const codexPath = (name: string) => path.join(codexDir ?? canonicalDir, `${name}.toml`);
  const writeMarkdown = (
    filePath: string,
    name: string,
    description: string | undefined,
    bodyLines: string[],
    extraFields?: Record<string, string | boolean | number>,
  ) =>
    writeFileWithParents(
      filePath,
      buildSubagentMarkdown({
        name,
        description,
        bodyLines,
        ...(extraFields ? { extraFields } : {}),
      }),
    );
  const writeCodex = (
    filePath: string,
    name: string,
    description: string,
    developerInstructions: string,
  ) =>
    writeFileWithParents(
      filePath,
      buildCodexSubagentToml({ name, description, developerInstructions }),
    );

  const canonicalDefinitions: Array<Promise<void>> = [
    writeMarkdown(
      canonicalPath('healthy-subagent'),
      'healthy-subagent',
      'Healthy across Universal, Claude, Codex, and Factory.',
      ['Use the shared healthy behavior everywhere.'],
    ),
    writeMarkdown(
      canonicalPath('reviewer'),
      'reviewer',
      'Reviews implementation changes across supported agents.',
      ['Inspect diffs, note risks, and keep recommendations grounded in repository behavior.'],
    ),
    writeMarkdown(
      canonicalPath('missing-from-agents-subagent'),
      'missing-from-agents-subagent',
      'Universal copy exists but supported agent locations are absent.',
      ['This should show the Missing From Agents issue by itself.'],
    ),
    writeMarkdown(
      canonicalPath('dismissed-subagent'),
      'dismissed-subagent',
      'Universal copy exists, but its missing agent copies start dismissed in Sandbox.',
      ['This should show the same issue as Missing From Agents with dismissed presentation.'],
    ),
    writeMarkdown(
      canonicalPath('identical-copies-subagent'),
      'identical-copies-subagent',
      'Has an agent-local Markdown copy that exactly matches Universal.',
      ['This duplicate should be replaced with a symlink.'],
    ),
    writeMarkdown(
      canonicalPath('definition-mismatch-subagent'),
      'definition-mismatch-subagent',
      'Canonical definition used for mismatch resolution.',
      ['Use the canonical mismatch fixture behavior.'],
    ),
    writeMarkdown(
      canonicalPath('broken-symlink-subagent'),
      'broken-symlink-subagent',
      'Exercises repair for a broken agent-local subagent link.',
      ['This canonical copy should replace the broken agent-local link.'],
    ),
    writeMarkdown(
      canonicalPath('wrong-symlink-target-subagent'),
      'wrong-symlink-target-subagent',
      'Exercises repair for a symlink pointing at a different subagent.',
      ['This canonical copy is the correct target for the agent-local symlink.'],
    ),
    writeMarkdown(
      canonicalPath('wrong-symlink-target-decoy'),
      'wrong-symlink-target-decoy',
      'A healthy decoy subagent used as the wrong symlink target.',
      ['This file intentionally receives an unrelated symlink from another subagent.'],
    ),
    writeMarkdown(
      canonicalPath('invalid-universal-subagent'),
      'invalid-universal-subagent',
      undefined,
      ['This Universal definition intentionally omits the required description field.'],
    ),
    writeMarkdown(
      canonicalPath('multi-mismatch-missing-subagent'),
      'multi-mismatch-missing-subagent',
      'Canonical definition that also lacks some supported agent targets.',
      ['Use the canonical multi-issue mismatch behavior.'],
    ),
    writeMarkdown(
      canonicalPath('multi-identical-missing-subagent'),
      'multi-identical-missing-subagent',
      'Canonical definition with a duplicate and missing supported agent targets.',
      ['This duplicate is intentionally missing other agent renderings.'],
    ),
    writeMarkdown(
      canonicalPath('multi-broken-missing-subagent'),
      'multi-broken-missing-subagent',
      'Canonical definition with a broken link and missing supported agent targets.',
      ['Repair the broken link while still showing absent agent locations.'],
    ),
  ];

  await Promise.all(canonicalDefinitions);

  const writes: Array<Promise<void>> = [];
  if (claudeDir) {
    writes.push(
      writeSubagentFixtureSymlink(
        claudePath('healthy-subagent'),
        canonicalPath('healthy-subagent'),
      ),
      writeFileWithParents(
        claudePath('identical-copies-subagent'),
        buildSubagentMarkdown({
          name: 'identical-copies-subagent',
          description: 'Has an agent-local Markdown copy that exactly matches Universal.',
          bodyLines: ['This duplicate should be replaced with a symlink.'],
        }),
      ),
      writeFileWithParents(
        claudePath('definition-mismatch-subagent'),
        buildSubagentMarkdown({
          name: 'definition-mismatch-subagent',
          description: 'Claude-local definition used for mismatch resolution.',
          bodyLines: ['Use the Claude-local mismatch fixture behavior.'],
        }),
      ),
      writeSubagentFixtureSymlink(
        claudePath('broken-symlink-subagent'),
        path.join(canonicalDir, 'missing-broken-symlink-target.md'),
      ),
      writeSubagentFixtureSymlink(
        claudePath('wrong-symlink-target-subagent'),
        canonicalPath('wrong-symlink-target-decoy'),
      ),
      writeSubagentFixtureSymlink(
        claudePath('wrong-symlink-target-decoy'),
        canonicalPath('wrong-symlink-target-decoy'),
      ),
      writeFileWithParents(
        claudePath('multi-mismatch-missing-subagent'),
        buildSubagentMarkdown({
          name: 'multi-mismatch-missing-subagent',
          description: 'Claude definition that differs while other agents are missing.',
          bodyLines: ['Use the Claude-local multi-issue behavior.'],
        }),
      ),
      writeFileWithParents(
        claudePath('multi-identical-missing-subagent'),
        buildSubagentMarkdown({
          name: 'multi-identical-missing-subagent',
          description: 'Canonical definition with a duplicate and missing supported agent targets.',
          bodyLines: ['This duplicate is intentionally missing other agent renderings.'],
        }),
      ),
      writeSubagentFixtureSymlink(
        claudePath('multi-broken-missing-subagent'),
        path.join(canonicalDir, 'missing-multi-broken-target.md'),
      ),
      writeFileWithParents(
        claudePath('missing-universal-claude-subagent'),
        buildSubagentMarkdown({
          name: 'missing-universal-claude-subagent',
          description: 'Claude-local subagent without a Universal copy.',
          bodyLines: ['Promote this into Universal before syncing elsewhere.'],
        }),
      ),
      writeFileWithParents(
        claudePath('invalid-definition-subagent'),
        [
          '---',
          'name: invalid-definition-subagent',
          '---',
          'This intentionally omits Claude Code\'s required description field.',
          '',
        ].join('\n'),
      ),
    );
  }

  if (codexDir) {
    writes.push(
      writeCodex(
        codexPath('healthy-subagent'),
        'healthy-subagent',
        'Healthy across Universal, Claude, Codex, and Factory.',
        'Use the shared healthy behavior everywhere.',
      ),
      writeCodex(
        codexPath('identical-copies-subagent'),
        'identical-copies-subagent',
        'Has an agent-local Markdown copy that exactly matches Universal.',
        'This duplicate should be replaced with a symlink.',
      ),
      writeCodex(
        codexPath('definition-mismatch-subagent'),
        'definition-mismatch-subagent',
        'Canonical definition used for mismatch resolution.',
        'Use the canonical mismatch fixture behavior.',
      ),
      writeCodex(
        codexPath('broken-symlink-subagent'),
        'broken-symlink-subagent',
        'Exercises repair for a broken agent-local subagent link.',
        'This canonical copy should replace the broken agent-local link.',
      ),
      writeCodex(
        codexPath('wrong-symlink-target-subagent'),
        'wrong-symlink-target-subagent',
        'Exercises repair for a symlink pointing at a different subagent.',
        'This canonical copy is the correct target for the agent-local symlink.',
      ),
      writeCodex(
        codexPath('wrong-symlink-target-decoy'),
        'wrong-symlink-target-decoy',
        'A healthy decoy subagent used as the wrong symlink target.',
        'This file intentionally receives an unrelated symlink from another subagent.',
      ),
      writeCodex(
        codexPath('missing-universal-codex-subagent'),
        'missing-universal-codex-subagent',
        'Codex TOML subagent without a Universal copy.',
        'Promote this Codex TOML definition into Universal.',
      ),
      writeFileWithParents(
        codexPath('codex-multiline-subagent'),
        [
          'name = "codex-multiline-subagent"',
          'description = "Exercises Codex TOML multiline instructions."',
          'developer_instructions = """',
          'Review release health before proceeding.',
          'Confirm rollback ownership.',
          '"""',
          '',
        ].join('\n'),
      ),
    );
  }

  if (factoryDir) {
    writes.push(
      writeSubagentFixtureSymlink(
        factoryPath('healthy-subagent'),
        canonicalPath('healthy-subagent'),
      ),
      writeSubagentFixtureSymlink(
        factoryPath('identical-copies-subagent'),
        canonicalPath('identical-copies-subagent'),
      ),
      writeSubagentFixtureSymlink(
        factoryPath('definition-mismatch-subagent'),
        canonicalPath('definition-mismatch-subagent'),
      ),
      writeSubagentFixtureSymlink(
        factoryPath('broken-symlink-subagent'),
        canonicalPath('broken-symlink-subagent'),
      ),
      writeSubagentFixtureSymlink(
        factoryPath('wrong-symlink-target-subagent'),
        canonicalPath('wrong-symlink-target-subagent'),
      ),
      writeSubagentFixtureSymlink(
        factoryPath('wrong-symlink-target-decoy'),
        canonicalPath('wrong-symlink-target-decoy'),
      ),
      writeFileWithParents(
        factoryPath('factory-name-only-droid'),
        buildSubagentMarkdown({
          name: 'factory-name-only-droid',
          bodyLines: ['Factory droids document name as the required frontmatter field.'],
        }),
      ),
    );
  }

  await Promise.all(writes);
}

function getSandboxAgentSubagentsDir(agents: AgentRecord[], agentId: string): string | null {
  const subagentsPath = agents.find((agent) => agent.id === agentId)?.subagentsLocation?.path;
  return subagentsPath && subagentsPath.length > 0 ? subagentsPath : null;
}

async function writeSubagentFixtureSymlink(linkPath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(targetPath, linkPath);
}

async function writeSandboxClaudePluginState(sandboxRoot: string): Promise<void> {
  const pluginRoot = path.join(sandboxRoot, '.claude', 'plugins', 'sandbox-plugin-pack');
  await Promise.all([
    writeJsonFile(path.join(sandboxRoot, '.claude', 'settings.json'), {
      enabledPlugins: {
        'sandbox-plugin-pack': true,
        'example-workflow-kit@sandbox-gallery': true,
        'alloy-kit@sandbox-gallery': true,
        'data-lens@sandbox-gallery': false,
      },
    }),
    writeJsonFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'sandbox-plugin-pack',
      version: '0.1.0',
      repository: 'https://github.com/example/sandbox-plugin-pack',
    }),
    writeFileWithParents(
      path.join(pluginRoot, 'agents', 'deployment-expert.md'),
      buildSubagentMarkdown({
        name: 'deployment-expert',
        description: 'Specializes in deployment strategies and production rollouts.',
        bodyLines: ['Check release gates, rollback ownership, and production rollout sequencing.'],
      }),
    ),
  ]);
}

async function writeSandboxExamplePluginBundles(sandboxRoot: string): Promise<void> {
  const codexRoot = path.join(sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-curated', 'example-workflow-kit', '5.1.0');
  const claudeRoot = path.join(sandboxRoot, '.claude', 'plugins', 'cache', 'sandbox-gallery', 'example-workflow-kit', '5.1.0');
  const signalToolsRoot = path.join(sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-curated', 'signal-tools', '2.0.0');
  const hookLabRoot = path.join(sandboxRoot, '.codex', 'plugins', 'cache', 'sandbox-curated', 'hook-lab', '1.4.0');
  const dataLensRoot = path.join(sandboxRoot, '.claude', 'plugins', 'cache', 'sandbox-gallery', 'data-lens', '0.8.0');
  const relayHubRoot = path.join(sandboxRoot, '.claude', 'plugins', 'cache', 'sandbox-gallery', 'relay-hub', '3.2.0');
  const alloyKitRoot = path.join(sandboxRoot, '.claude', 'plugins', 'cache', 'sandbox-gallery', 'alloy-kit', '1.1.0');
  const signalMapServerPath = path.join(signalToolsRoot, 'servers', 'signal-map.js');
  const relayHubServerPath = path.join(relayHubRoot, 'servers', 'relay-hub.js');
  const alloyPlannerServerPath = path.join(alloyKitRoot, 'servers', 'alloy-planner.js');
  const ideaShapingSkill = buildSkillMarkdown({
    skillName: 'idea-shaping',
    description: 'Structure product ideas before implementation.',
    title: 'Idea shaping',
    bodyLines: ['Explore goals, constraints, and options before choosing an implementation path.'],
  });
  const codexConflictSkill = buildSkillMarkdown({
    skillName: 'overlap-check',
    description: 'Codex plugin variant for conflict coverage.',
    title: 'Overlap check',
    bodyLines: ['Codex plugin content is the selected variant in some tests.'],
  });
  const claudeConflictSkill = buildSkillMarkdown({
    skillName: 'overlap-check',
    description: 'Claude plugin variant for conflict coverage.',
    title: 'Overlap check',
    bodyLines: ['Claude plugin content is intentionally different.'],
  });
  const codexHandoffNotesSkill = buildSkillMarkdown({
    skillName: 'handoff-notes',
    description: 'Codex plugin variant with a small wording difference.',
    title: 'Handoff notes',
    bodyLines: ['Capture implementation context before handing work to another agent.'],
  });
  const claudeHandoffNotesSkill = buildSkillMarkdown({
    skillName: 'handoff-notes',
    description: 'Claude plugin variant with a small wording difference.',
    title: 'Handoff notes',
    bodyLines: ['Capture implementation context before handing work to a teammate.'],
  });
  const codexHandoffWithStaticSkill = buildSkillMarkdown({
    skillName: 'handoff-notes-with-static',
    description: 'Codex plugin variant with one writable static install.',
    title: 'Handoff notes with static',
    bodyLines: ['Codex plugin content stays immutable while a static install can choose a Universal target.'],
  });
  const claudeHandoffWithStaticSkill = buildSkillMarkdown({
    skillName: 'handoff-notes-with-static',
    description: 'Claude plugin variant with one writable static install.',
    title: 'Handoff notes with static',
    bodyLines: ['Claude plugin content stays immutable while a static install can choose a Universal target.'],
  });
  const staticHandoffWithStaticSkill = buildSkillMarkdown({
    skillName: 'example-workflow-kit:handoff-notes-with-static',
    description: 'Writable static copy alongside two plugin variants.',
    title: 'Handoff notes with static',
    bodyLines: ['Static content can be linked toward either plugin variant or become Universal itself.'],
  });
  const codexHandoffWithTwoStaticsSkill = buildSkillMarkdown({
    skillName: 'handoff-notes-with-two-statics',
    description: 'Codex plugin variant with two writable static installs.',
    title: 'Handoff notes with two statics',
    bodyLines: ['Codex plugin content is one immutable option in a four-location conflict.'],
  });
  const claudeHandoffWithTwoStaticsSkill = buildSkillMarkdown({
    skillName: 'handoff-notes-with-two-statics',
    description: 'Claude plugin variant with two writable static installs.',
    title: 'Handoff notes with two statics',
    bodyLines: ['Claude plugin content is a second immutable option in a four-location conflict.'],
  });
  const agentsHandoffWithTwoStaticsSkill = buildSkillMarkdown({
    skillName: 'example-workflow-kit:handoff-notes-with-two-statics',
    description: 'Agents static copy beside two plugin variants.',
    title: 'Handoff notes with two statics',
    bodyLines: ['Agents static content is writable and can be used as Universal.'],
  });
  const factoryHandoffWithTwoStaticsSkill = buildSkillMarkdown({
    skillName: 'example-workflow-kit:handoff-notes-with-two-statics',
    description: 'Factory static copy beside two plugin variants.',
    title: 'Handoff notes with two statics',
    bodyLines: ['Factory static content diverged from both plugin variants and the Agents copy.'],
  });
  const signalMappingSkill = buildSkillMarkdown({
    skillName: 'signal-mapping',
    description: 'Synthetic plugin skill bundled with an MCP server and hooks.',
    title: 'Signal mapping',
    bodyLines: ['Map placeholder signals across a sandbox-only workflow.'],
  });
  const signalStaticPluginChoiceSkill = buildSkillMarkdown({
    skillName: 'static-plugin-choice',
    description: 'Plugin copy competing with two writable static installs.',
    title: 'Static plugin choice',
    bodyLines: ['Plugin content can be used as Universal without editing this immutable copy.'],
  });
  const agentsStaticPluginChoiceSkill = buildSkillMarkdown({
    skillName: 'signal-tools:static-plugin-choice',
    description: 'Agents static copy competing with one plugin copy.',
    title: 'Static plugin choice',
    bodyLines: ['Agents static content can be selected as Universal and link the other writable copy.'],
  });
  const factoryStaticPluginChoiceSkill = buildSkillMarkdown({
    skillName: 'signal-tools:static-plugin-choice',
    description: 'Factory static copy competing with one plugin copy.',
    title: 'Static plugin choice',
    bodyLines: ['Factory static content diverged from both the plugin and Agents copies.'],
  });
  const dataSketchSkill = buildSkillMarkdown({
    skillName: 'data-sketch',
    description: 'Synthetic plugin skill with no bundled MCP server.',
    title: 'Data sketch',
    bodyLines: ['Sketch a small data story without touching live plugins.'],
  });
  const releaseNotesSkill = buildSkillMarkdown({
    skillName: 'release-notes',
    description: 'Synthetic plugin skill bundled with hooks but no MCP server.',
    title: 'Release notes',
    bodyLines: ['Draft release notes from a sandbox-only bundle.'],
  });
  const alloyPlannerSkill = buildSkillMarkdown({
    skillName: 'alloy-planner',
    description: 'Synthetic plugin skill bundled with both MCP servers and hooks.',
    title: 'Alloy planner',
    bodyLines: ['Plan a composite workflow across every plugin asset type.'],
  });

  await Promise.all([
    writePluginManifest(path.join(codexRoot, '.codex-plugin', 'plugin.json'), 'example-workflow-kit'),
    writePluginManifest(path.join(claudeRoot, '.claude-plugin', 'plugin.json'), 'example-workflow-kit'),
    writeFileWithParents(path.join(codexRoot, 'skills', 'idea-shaping', 'SKILL.md'), ideaShapingSkill),
    writeFileWithParents(path.join(claudeRoot, 'skills', 'idea-shaping', 'SKILL.md'), ideaShapingSkill),
    writeFileWithParents(path.join(codexRoot, 'skills', 'overlap-check', 'SKILL.md'), codexConflictSkill),
    writeFileWithParents(path.join(claudeRoot, 'skills', 'overlap-check', 'SKILL.md'), claudeConflictSkill),
    writeFileWithParents(path.join(codexRoot, 'skills', 'handoff-notes', 'SKILL.md'), codexHandoffNotesSkill),
    writeFileWithParents(path.join(claudeRoot, 'skills', 'handoff-notes', 'SKILL.md'), claudeHandoffNotesSkill),
    writeFileWithParents(path.join(codexRoot, 'skills', 'handoff-notes-with-static', 'SKILL.md'), codexHandoffWithStaticSkill),
    writeFileWithParents(path.join(claudeRoot, 'skills', 'handoff-notes-with-static', 'SKILL.md'), claudeHandoffWithStaticSkill),
    writeFileWithParents(
      path.join(sandboxRoot, '.agents', 'skills', 'example-workflow-kit:handoff-notes-with-static', 'SKILL.md'),
      staticHandoffWithStaticSkill,
    ),
    writeFileWithParents(path.join(codexRoot, 'skills', 'handoff-notes-with-two-statics', 'SKILL.md'), codexHandoffWithTwoStaticsSkill),
    writeFileWithParents(path.join(claudeRoot, 'skills', 'handoff-notes-with-two-statics', 'SKILL.md'), claudeHandoffWithTwoStaticsSkill),
    writeFileWithParents(
      path.join(sandboxRoot, '.agents', 'skills', 'example-workflow-kit:handoff-notes-with-two-statics', 'SKILL.md'),
      agentsHandoffWithTwoStaticsSkill,
    ),
    writeFileWithParents(
      path.join(sandboxRoot, '.factory', 'skills', 'example-workflow-kit:handoff-notes-with-two-statics', 'SKILL.md'),
      factoryHandoffWithTwoStaticsSkill,
    ),
    writeFileWithParents(path.join(codexRoot, 'skills', 'idea-shaping', 'agents', 'sandbox-runner.yaml'), 'name: sandbox-runner\n'),
    writePluginManifest(path.join(signalToolsRoot, '.codex-plugin', 'plugin.json'), 'signal-tools', '2.0.0'),
    writeFileWithParents(path.join(signalToolsRoot, 'skills', 'signal-mapping', 'SKILL.md'), signalMappingSkill),
    writeFileWithParents(path.join(signalToolsRoot, 'skills', 'static-plugin-choice', 'SKILL.md'), signalStaticPluginChoiceSkill),
    writeFileWithParents(
      path.join(sandboxRoot, '.agents', 'skills', 'signal-tools:static-plugin-choice', 'SKILL.md'),
      agentsStaticPluginChoiceSkill,
    ),
    writeFileWithParents(
      path.join(sandboxRoot, '.factory', 'skills', 'signal-tools:static-plugin-choice', 'SKILL.md'),
      factoryStaticPluginChoiceSkill,
    ),
    writePluginMcpConfig(path.join(signalToolsRoot, '.mcp.json'), {
      signalMap: {
        command: 'node',
        args: [signalMapServerPath],
      },
    }),
    writeFileWithParents(signalMapServerPath, buildSandboxMcpServerScript('signal-map')),
    writePluginHooks(path.join(signalToolsRoot, 'hooks', 'hooks.json'), ['SessionStart', 'Stop']),
    writePluginManifest(path.join(hookLabRoot, '.codex-plugin', 'plugin.json'), 'hook-lab', '1.4.0'),
    writePluginHooks(path.join(hookLabRoot, 'hooks', 'hooks.json'), ['PreToolUse', 'PostToolUse']),
    writePluginManifest(path.join(dataLensRoot, '.claude-plugin', 'plugin.json'), 'data-lens', '0.8.0'),
    writeFileWithParents(path.join(dataLensRoot, 'skills', 'data-sketch', 'SKILL.md'), dataSketchSkill),
    writePluginManifest(path.join(relayHubRoot, '.claude-plugin', 'plugin.json'), 'relay-hub', '3.2.0'),
    writePluginMcpConfig(path.join(relayHubRoot, '.mcp.json'), {
      relayHub: {
        command: 'node',
        args: [relayHubServerPath],
      },
    }),
    writeFileWithParents(relayHubServerPath, buildSandboxMcpServerScript('relay-hub')),
    writePluginManifest(path.join(alloyKitRoot, '.claude-plugin', 'plugin.json'), 'alloy-kit', '1.1.0'),
    writeFileWithParents(path.join(alloyKitRoot, 'skills', 'release-notes', 'SKILL.md'), releaseNotesSkill),
    writeFileWithParents(path.join(alloyKitRoot, 'skills', 'alloy-planner', 'SKILL.md'), alloyPlannerSkill),
    writePluginMcpConfig(path.join(alloyKitRoot, '.mcp.json'), {
      alloyPlanner: {
        command: 'node',
        args: [alloyPlannerServerPath],
      },
    }),
    writeFileWithParents(alloyPlannerServerPath, buildSandboxMcpServerScript('alloy-planner')),
    writePluginHooks(path.join(alloyKitRoot, 'hooks', 'hooks.json'), ['Notification', 'Stop']),
  ]);
}

function buildSandboxMcpServerScript(name: string): string {
  return `#!/usr/bin/env node
const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

rl.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: 'skillindex-sandbox-${name}', version: '0.0.0' },
      },
    });
    return;
  }

  if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
  }
});
`;
}

async function writePluginManifest(manifestPath: string, name: string, version = '5.1.0'): Promise<void> {
  await writeFileWithParents(manifestPath, `${JSON.stringify({ name, version }, null, 2)}\n`);
}

async function writePluginMcpConfig(configPath: string, servers: Record<string, McpDefinition>): Promise<void> {
  await writeJsonFile(configPath, { mcpServers: servers });
}

async function writePluginHooks(hookPath: string, hookNames: string[]): Promise<void> {
  await writeJsonFile(hookPath, {
    hooks: Object.fromEntries(hookNames.map((hookName) => [
      hookName,
      [{ hooks: [{ type: 'command', command: `node ${hookName.toLowerCase()}.js` }] }],
    ])),
  });
}

async function writeFileWithParents(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writeSandboxClaudePluginMarketplaceMetadata(sandboxRoot: string): Promise<void> {
  await Promise.all([
    writeJsonFile(path.join(sandboxRoot, '.claude', 'plugins', 'known_marketplaces.json'), {
      'sandbox-gallery': {
        source: {
          source: 'github',
          repo: 'example/sandbox-gallery',
        },
      },
      'sandbox-codex-lab': {
        source: {
          source: 'github',
          repo: 'example/sandbox-codex-lab',
        },
      },
    }),
    writeJsonFile(path.join(sandboxRoot, '.claude', 'plugins', 'marketplaces', 'sandbox-gallery', '.claude-plugin', 'marketplace.json'), {
      name: 'sandbox-gallery',
      plugins: [
        {
          name: 'context-lab',
          source: './external_plugins/context-lab',
          homepage: 'https://example.invalid/sandbox-gallery/context-lab',
        },
        {
          name: 'interface-sketcher',
          source: './plugins/interface-sketcher',
          homepage: 'https://example.invalid/sandbox-gallery/interface-sketcher',
        },
        {
          name: 'browser-runner',
          source: './external_plugins/browser-runner',
          homepage: 'https://example.invalid/sandbox-gallery/browser-runner',
        },
        {
          name: 'signal-index',
          source: './plugins/signal-index',
        },
        {
          name: 'data-lens',
          source: './plugins/data-lens',
          homepage: 'https://example.invalid/sandbox-gallery/data-lens',
        },
        {
          name: 'relay-hub',
          source: './plugins/relay-hub',
          homepage: 'https://example.invalid/sandbox-gallery/relay-hub',
        },
        {
          name: 'alloy-kit',
          source: './plugins/alloy-kit',
          homepage: 'https://example.invalid/sandbox-gallery/alloy-kit',
        },
      ],
    }),
    writeJsonFile(path.join(sandboxRoot, '.claude', 'plugins', 'marketplaces', 'sandbox-codex-lab', '.claude-plugin', 'marketplace.json'), {
      name: 'sandbox-codex-lab',
      plugins: [
        {
          name: 'terminal-agent',
          source: './plugins/terminal-agent',
        },
      ],
    }),
  ]);
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildSkillMarkdown({
  skillName,
  description,
  title,
  bodyLines,
  includeName = true,
  frontMatterName,
  frontMatterDescription,
}: SkillMarkdownOptions): string {
  return [
    '---',
    ...(includeName ? [`name: ${frontMatterName ?? skillName}`] : []),
    `description: ${frontMatterDescription ?? description}`,
    '---',
    '',
    `# ${title}`,
    ...bodyLines,
    '',
  ].join('\n');
}

function buildSubagentMarkdown({
  name,
  description,
  bodyLines,
  extraFields = {},
}: SubagentMarkdownOptions): string {
  return [
    '---',
    `name: ${JSON.stringify(name)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    ...Object.entries(extraFields).map(([key, value]) =>
      `${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`),
    '---',
    ...bodyLines,
    '',
  ].join('\n');
}

function buildCodexSubagentToml({
  name,
  description,
  developerInstructions,
}: {
  name: string;
  description: string;
  developerInstructions: string;
}): string {
  return [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(developerInstructions)}`,
    '',
  ].join('\n');
}

function buildGeneratedFixtures(): FixtureDefinition[] {
  const generatedHealthyFixtures = Array.from(
    { length: GENERATED_HEALTHY_FIXTURE_COUNT },
    (_, index) => createGeneratedHealthyFixture(index + 1),
  );
  const generatedActiveIdenticalFixtures = Array.from({ length: 4 }, (_, index) => createGeneratedIdenticalFixture(index + 1));
  const generatedActiveDivergedFixtures = Array.from({ length: 2 }, (_, index) => createGeneratedDivergedFixture(index + 1));
  const generatedDismissedFixtures = [createGeneratedDismissedFixture(1)];

  return [
    ...generatedHealthyFixtures,
    ...generatedActiveIdenticalFixtures,
    ...generatedActiveDivergedFixtures,
    ...generatedDismissedFixtures,
  ];
}

function createGeneratedHealthyFixture(index: number): FixtureDefinition {
  const suffix = formatFixtureSuffix(index);
  const skillName = `representative-healthy-skill-${suffix}`;

  return {
    name: skillName,
    expectedState: 'healthy',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName,
          description: `Representative healthy skill ${suffix} for larger inventory coverage.`,
          title: `Representative healthy skill ${suffix}`,
          bodyLines: [`This canonical sample keeps the healthy bucket populated for dev testing (${suffix}).`],
        }),
        modifiedAt: buildFixtureTimestamp(index, 0),
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-claude',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-factory',
        targetSourceId: 'sandbox-agents',
      },
      {
        type: 'symlink',
        sourceId: 'sandbox-windsurf',
        targetSourceId: 'sandbox-agents',
      },
    ],
  };
}

async function writeGeneratedHealthySkillSymlinksForAgents(
  sourceById: Map<string, { skillsDir: string }>,
  agents: Array<{ id: string; skillsLocation: { path?: string } }>,
  agentIds: readonly RepresentativeMcpOwnerId[],
): Promise<void> {
  const canonicalSkillsDir = sourceById.get('sandbox-agents')?.skillsDir;
  if (!canonicalSkillsDir) {
    throw new Error('No canonical sandbox skills source is available.');
  }

  await Promise.all(getGeneratedHealthySkillNames().flatMap((skillName) => {
    const canonicalSkillPath = getSkillPackagePath(sourceById, 'sandbox-agents', skillName);
    return agentIds.flatMap((agentId) => {
      const agent = agents.find((candidate) => candidate.id === agentId);
      const skillsDir = agent?.skillsLocation.path;
      if (!skillsDir || path.normalize(skillsDir) === path.normalize(canonicalSkillsDir)) {
        return [];
      }

      return [replaceSkillSymlink(path.join(skillsDir, skillName), canonicalSkillPath)];
    });
  }));
}

function getGeneratedHealthySkillNames(): string[] {
  return Array.from(
    { length: GENERATED_HEALTHY_FIXTURE_COUNT },
    (_, index) => `representative-healthy-skill-${formatFixtureSuffix(index + 1)}`,
  );
}

function createGeneratedIdenticalFixture(index: number): FixtureDefinition {
  const suffix = formatFixtureSuffix(index);
  const skillName = `representative-identical-drift-skill-${suffix}`;
  const content = buildSkillMarkdown({
    skillName,
    description: `Representative identical-drift skill ${suffix}.`,
    title: `Representative identical drift skill ${suffix}`,
    bodyLines: [`These writable copies intentionally match to exercise identical-drift review paths (${suffix}).`],
  });

  return {
    name: skillName,
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content,
        modifiedAt: buildFixtureTimestamp(100 + index, 0),
      },
      {
        type: 'write',
        sourceId: 'sandbox-factory',
        content,
        modifiedAt: buildFixtureTimestamp(100 + index, 1),
      },
    ],
  };
}

function createGeneratedDismissedFixture(index: number): FixtureDefinition {
  const suffix = formatFixtureSuffix(index);
  const skillName = `representative-dismissed-drift-skill-${suffix}`;
  const content = buildSkillMarkdown({
    skillName,
    description: `Representative dismissed drift skill ${suffix}.`,
    title: `Representative dismissed drift skill ${suffix}`,
    bodyLines: [`This identical drift sample starts dismissed so the muted bucket stays represented (${suffix}).`],
  });

  return {
    name: skillName,
    expectedState: 'identical-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content,
        modifiedAt: buildFixtureTimestamp(130 + index, 0),
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content,
        modifiedAt: buildFixtureTimestamp(130 + index, 1),
      },
    ],
  };
}

function createGeneratedDivergedFixture(index: number): FixtureDefinition {
  const suffix = formatFixtureSuffix(index);
  const skillName = `representative-diverged-drift-skill-${suffix}`;
  const description = `Representative diverged-drift skill ${suffix}.`;

  return {
    name: skillName,
    expectedState: 'diverged-drift',
    operations: [
      {
        type: 'write',
        sourceId: 'sandbox-agents',
        content: buildSkillMarkdown({
          skillName,
          description,
          title: `Representative diverged drift skill ${suffix}`,
          bodyLines: [`Canonical sample content for diverged fixture ${suffix}.`],
        }),
        modifiedAt: buildFixtureTimestamp(160 + index, 0),
      },
      {
        type: 'write',
        sourceId: 'sandbox-claude',
        content: buildSkillMarkdown({
          skillName,
          description,
          title: `Representative diverged drift skill ${suffix}`,
          bodyLines: [`Conflicting Claude content for diverged fixture ${suffix}.`],
        }),
        modifiedAt: buildFixtureTimestamp(160 + index, 1),
      },
    ],
  };
}

function buildRepresentativeMcpConfigs(
  includeParserMatrix: boolean,
): Record<RepresentativeMcpOwnerId, Record<string, McpDefinition>> {
  const sharedHealthyMcps: Record<string, McpDefinition> = {
    'healthy-mcp': {
      command: 'node',
      args: ['healthy-server.js'],
    },
    'healthy-remote-mcp': {
      type: 'http',
      url: 'https://example.test/mcp',
    },
    'double-definition-mismatch-mcp': {
      command: 'node',
      args: ['double-definition-mismatch-agents.js'],
    },
  };
  const configs: Record<RepresentativeMcpOwnerId, Record<string, McpDefinition>> = {
    'sandbox-agents': {
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'muted-mcp': {
        command: 'node',
        args: ['muted-server-v1.js'],
      },
      'broken-mcp': {
        args: ['missing-command.js'],
      },
      'missing-from-agents-mcp': {
        command: 'node',
        args: ['missing-from-agents.js'],
      },
      'diagnostic-rich-mcp': {
        command: 'node',
        args: ['canonical-server.js'],
      },
      'broken-shared-mcp-01': {
        args: ['broken-shared-mcp-01.js'],
      },
      'mismatch-shared-mcp-01': {
        command: 'node',
        args: ['mismatch-shared-mcp-01-agents.js'],
      },
      'muted-extra-mcp': {
        command: 'node',
        args: ['muted-extra-mcp-agents.js'],
      },
      'double-definition-mismatch-mcp': {
        command: 'node',
        args: ['double-definition-mismatch-agents.js'],
      },
      'double-missing-from-agents-mcp': {
        command: 'node',
        args: ['double-missing-from-agents.js'],
      },
      'double-invalid-definition-mcp': {
        args: ['double-invalid-definition-agents.js'],
      },
    },
    'sandbox-amp': {},
    'sandbox-codebuddy': {},
    'sandbox-codex': {
      'codex-only-mcp': {
        command: 'node',
        args: ['codex-only-server.js'],
      },
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'double-definition-mismatch-mcp': {
        command: 'node',
        args: ['double-definition-mismatch-agents.js'],
      },
    },
    'sandbox-crush': {},
    'sandbox-claude': {
      'claude-only-mcp': {
        command: 'node',
        args: ['claude-only-server.js'],
      },
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'broken-mcp': {
        command: 'node',
        args: ['recovered-command.js'],
      },
      'missing-from-agents-mcp': {
        command: 'node',
        args: ['missing-from-agents.js'],
      },
      'diagnostic-rich-mcp': {
        command: 'node',
        args: ['claude-server.js'],
      },
      'broken-shared-mcp-01': {
        command: 'node',
        args: ['broken-shared-mcp-01-recovered.js'],
      },
      'mismatch-shared-mcp-02': {
        command: 'node',
        args: ['mismatch-shared-mcp-02-claude.js'],
      },
      'muted-extra-mcp': {
        command: 'node',
        args: ['muted-extra-mcp-claude.js'],
      },
      'double-definition-mismatch-mcp': {
        command: 'uvx',
        args: ['double-definition-mismatch-claude'],
      },
      'double-invalid-definition-mcp': {
        command: 'node',
        args: ['double-invalid-definition-claude.js'],
      },
    },
    'sandbox-claude-desktop': {
      'claude-desktop-only-mcp': {
        command: 'node',
        args: ['claude-desktop-server.js'],
      },
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'double-definition-mismatch-mcp': {
        command: 'node',
        args: ['double-definition-mismatch-agents.js'],
      },
    },
    'sandbox-cursor': {
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'double-definition-mismatch-mcp': {
        command: 'node',
        args: ['double-definition-mismatch-agents.js'],
      },
    },
    'sandbox-mistral-vibe': {},
    'sandbox-mux': {},
    'sandbox-openclaw': {},
    'sandbox-opencode': {},
    'sandbox-pochi': {},
    'sandbox-factory': {
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'factory-only-mcp': {
        command: 'node',
        args: ['factory-only-server.js'],
      },
      'muted-mcp': {
        command: 'node',
        args: ['muted-server-v2.js'],
      },
      'diagnostic-rich-mcp': {
        command: 'uvx',
        args: ['factory-server'],
      },
      'mismatch-shared-mcp-01': {
        command: 'node',
        args: ['mismatch-shared-mcp-01-factory.js'],
      },
      'mismatch-shared-mcp-02': {
        command: 'node',
        args: ['mismatch-shared-mcp-02-factory.js'],
      },
      'double-definition-mismatch-mcp': {
        command: 'bun',
        args: ['double-definition-mismatch-factory.ts'],
      },
      'double-invalid-definition-mcp': {
        args: ['double-invalid-definition-factory.js'],
      },
    },
    'sandbox-windsurf': {
      'healthy-mcp': {
        command: 'node',
        args: ['healthy-server.js'],
      },
      'healthy-remote-mcp': {
        type: 'http',
        url: 'https://example.test/mcp',
      },
      'double-definition-mismatch-mcp': {
        command: 'node',
        args: ['double-definition-mismatch-agents.js'],
      },
    },
    'sandbox-zencoder': {},
  };

  if (includeParserMatrix) {
    configs['sandbox-agents']['parser-shape-matrix-mcp'] = {
      command: 'node',
      args: ['parser-shape-matrix.js'],
      env: {
        MATRIX_TOKEN: 'sandbox',
      },
    };

    for (const agentId of REPRESENTATIVE_MCP_AGENT_IDS) {
      configs[agentId] = {
        ...sharedHealthyMcps,
        ...configs[agentId],
      };
    }
  }

  for (let index = 1; index <= 2; index += 1) {
    const suffix = formatFixtureSuffix(index);
    configs['sandbox-agents'][`shared-stable-mcp-${suffix}`] = {
      command: 'node',
      args: [`shared-stable-mcp-${suffix}.js`],
    };
    configs['sandbox-claude'][`shared-stable-mcp-${suffix}`] = {
      command: 'node',
      args: [`shared-stable-mcp-${suffix}.js`],
    };
    configs['sandbox-factory'][`shared-stable-mcp-${suffix}`] = {
      command: 'node',
      args: [`shared-stable-mcp-${suffix}.js`],
    };
    configs['sandbox-codex'][`shared-stable-mcp-${suffix}`] = {
      command: 'node',
      args: [`shared-stable-mcp-${suffix}.js`],
    };
  }

  for (let index = 1; index <= 3; index += 1) {
    const suffix = formatFixtureSuffix(index);
    configs['sandbox-codex'][`codex-only-extra-mcp-${suffix}`] = {
      command: 'node',
      args: [`codex-only-extra-mcp-${suffix}.js`],
    };
  }

  for (let index = 1; index <= 2; index += 1) {
    const suffix = formatFixtureSuffix(index);
    configs['sandbox-claude'][`claude-only-extra-mcp-${suffix}`] = {
      command: 'node',
      args: [`claude-only-extra-mcp-${suffix}.js`],
    };
  }

  configs['sandbox-factory']['factory-only-extra-mcp-01'] = {
    command: 'node',
    args: ['factory-only-extra-mcp-01.js'],
  };

  return configs;
}

function formatFixtureSuffix(index: number): string {
  return index.toString().padStart(2, '0');
}

function buildFixtureTimestamp(dayOffset: number, seconds: number): string {
  return new Date(Date.UTC(2026, 1, 1 + dayOffset, 0, 0, seconds)).toISOString();
}
