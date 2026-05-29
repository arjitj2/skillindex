import { describe, expect, it } from 'vitest';

import type { McpRecord, SkillInventorySnapshot, SkillRecord, SkillScanSource } from '@shared/contracts';

import { representativeInventorySnapshot } from './representative-preview-data';
import {
  filterMcpRows,
  filterSkillRows,
  getHomeSummary,
  getMcpDisplayName,
  getMcpSections,
  getMcpTableRows,
  getSkillAccessState,
  getSkillDisplayName,
  getSkillSections,
  getSkillTableRows,
} from './inventory-view-model';

describe('inventory view ordering', () => {
  it('orders attention skills by issue count, then displayed title', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const missingSymlink = base.skills.find((skill) => skill.name === 'missing-symlink-skill');
    const diverged = base.skills.find((skill) => skill.name === 'diverged-drift-skill');
    expect(missingSymlink).toBeDefined();
    expect(diverged).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      skills: [
        {
          ...missingSymlink!,
          name: 'zeta-skill',
          displayName: 'Alpha Skill',
          issueReasons: ['missing-symlinks'],
        },
        {
          ...diverged!,
          name: 'alpha-skill',
          displayName: 'Zulu Skill',
          issueReasons: ['diverged-copies'],
        },
      ],
    };

    const attentionRows = getSkillSections(snapshot).find((section) => section.title === 'Needs attention')?.rows ?? [];
    expect(attentionRows.slice(0, 2).map((skill) => skill.displayName)).toEqual([
      'Alpha Skill',
      'Zulu Skill',
    ]);
    expect(getSkillTableRows(snapshot).slice(0, 2).map((skill) => skill.displayName)).toEqual([
      'Alpha Skill',
      'Zulu Skill',
    ]);
  });

  it('orders MCP table rows by issue count, then title', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const broken = base.mcps?.find((mcp) => mcp.name === 'broken-mcp');
    const diagnostic = base.mcps?.find((mcp) => mcp.name === 'diagnostic-rich-mcp');
    const missing = base.mcps?.find((mcp) => mcp.name === 'missing-from-agents-mcp');
    expect(broken).toBeDefined();
    expect(diagnostic).toBeDefined();
    expect(missing).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      mcps: [
        {
          ...diagnostic!,
          name: 'zulu-mcp',
          issueReasons: ['definition-mismatch'],
        },
        {
          ...broken!,
          name: 'middle-mcp',
          issueReasons: ['definition-mismatch', 'invalid-definition'],
        },
        {
          ...missing!,
          name: 'alpha-mcp',
          issueReasons: ['missing-from-agents'],
        },
      ],
    };

    expect(getMcpTableRows(snapshot).slice(0, 3).map((mcp) => mcp.name)).toEqual([
      'middle-mcp',
      'alpha-mcp',
      'zulu-mcp',
    ]);
  });

  it('orders dismissed skills from most issues to fewest issues', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const dismissed = base.skills.find((skill) => skill.name === 'dismissed-drift-skill');
    expect(dismissed).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      skills: [
        {
          ...dismissed!,
          name: 'dismissed-two-issues-skill',
          issueReasons: ['identical-copies', 'invalid-definition'],
        },
        {
          ...dismissed!,
          name: 'dismissed-one-issue-skill',
          issueReasons: ['identical-copies'],
        },
        ...base.skills.filter((skill) => skill.name !== 'dismissed-drift-skill'),
      ],
    };

    const dismissedRows = getSkillSections(snapshot).find((section) => section.title === 'Dismissed issues')?.rows ?? [];
    expect(dismissedRows.slice(0, 2).map((skill) => skill.name)).toEqual([
      'dismissed-two-issues-skill',
      'dismissed-one-issue-skill',
    ]);
  });

  it('orders dismissed MCPs from most issues to fewest issues', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const dismissed = base.mcps?.find((mcp) => mcp.name === 'muted-mcp');
    expect(dismissed).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      mcps: [
        {
          ...dismissed!,
          name: 'dismissed-two-issues-mcp',
          issueReasons: ['definition-mismatch', 'invalid-definition'],
        } satisfies McpRecord,
        {
          ...dismissed!,
          name: 'dismissed-one-issue-mcp',
          issueReasons: ['definition-mismatch'],
        } satisfies McpRecord,
        ...(base.mcps ?? []).filter((mcp) => mcp.name !== 'muted-mcp'),
      ],
    };

    const dismissedRows = getMcpSections(snapshot).find((section) => section.title === 'Dismissed issues')?.rows ?? [];
    expect(dismissedRows.slice(0, 2).map((mcp) => mcp.name)).toEqual([
      'dismissed-two-issues-mcp',
      'dismissed-one-issue-mcp',
    ]);
  });

  it('uses universal wording for plugin-managed skill access guidance', () => {
    const source: SkillScanSource = {
      id: 'plugin-source',
      label: 'Sandbox Plugin Pack',
      canonical: false,
      kind: 'plugin',
      writable: false,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/plugins/skills',
    };
    const skill = createSkillWithSingleSource('plugin-readonly-skill', source);

    expect(getSkillAccessState(skill, new Map([[source.id, source]]))?.detailMessage).toBe(
      'This skill comes from a plugin. Skill Index can use it as Universal, but cannot edit the plugin copy.',
    );
  });

  it('derives home attention totals from current counts when the embedded summary is stale', () => {
    const snapshot = structuredClone(representativeInventorySnapshot);
    snapshot.counts = {
      ...snapshot.counts,
      driftedSkills: 1,
      dismissedDriftSkills: 8,
    };
    snapshot.mcpCounts = {
      totalMcps: 11,
      healthyMcps: 7,
      attentionMcps: 0,
      dismissedAttentionMcps: 4,
    };
    snapshot.subagentCounts = {
      totalSubagents: 6,
      healthySubagents: 4,
      attentionSubagents: 2,
      dismissedAttentionSubagents: 1,
    };
    snapshot.homeSummary = {
      skills: {
        total: 92,
        healthy: 83,
        needsAttention: 9,
      },
      mcps: {
        total: 11,
        healthy: 7,
        needsAttention: 4,
      },
      installedAgents: 8,
    };

    expect(getHomeSummary(snapshot)).toMatchObject({
      skills: {
        needsAttention: 1,
      },
      mcps: {
        needsAttention: 0,
      },
      subagents: {
        total: 6,
        healthy: 4,
        needsAttention: 2,
      },
      installedAgents: snapshot.agentCounts?.installedAgents,
    });
  });

  it('uses universal wording for read-only skill access guidance', () => {
    const source: SkillScanSource = {
      id: 'readonly-source',
      label: 'Sandbox Factory',
      canonical: false,
      kind: 'agent',
      writable: false,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.factory/skills',
    };
    const skill = createSkillWithSingleSource('healthy-skill', source);

    expect(getSkillAccessState(skill, new Map([[source.id, source]]))?.detailMessage).toBe(
      'This skill is read-only right now. You can review it here, but you need an editable copy before you can make it universal.',
    );
  });

  it('matches skill search against the frontmatter display name', () => {
    const rows = [
      {
        ...structuredClone(representativeInventorySnapshot.skills.find((skill) => skill.name === 'healthy-skill')!),
        name: 'slides',
        displayName: 'PowerPoint',
      },
    ];

    expect(filterSkillRows(rows, 'powerpoint').map((skill) => skill.name)).toEqual(['slides']);
  });

  it('hides plugin qualifiers from plugin-managed skill display names', () => {
    const skill = {
      ...structuredClone(representativeInventorySnapshot.skills.find((entry) => entry.name === 'plugin-readonly-skill')!),
      name: 'example-workflow-kit:handoff-notes-with-two-statics',
      displayName: 'example-workflow-kit:handoff-notes-with-two-statics',
    };

    expect(getSkillDisplayName(skill)).toBe('handoff-notes-with-two-statics');
    expect(filterSkillRows([skill], 'example-workflow-kit').map((row) => row.name)).toEqual([
      'example-workflow-kit:handoff-notes-with-two-statics',
    ]);
  });

  it('hides plugin qualifiers from plugin-managed MCP display names', () => {
    const sourceMcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'missing-from-agents-mcp');
    if (!sourceMcp) {
      throw new Error('Missing representative MCP fixture: missing-from-agents-mcp');
    }

    const mcp: McpRecord = {
      ...structuredClone(sourceMcp),
      name: 'signal-tools:signalMap',
      locations: [
        {
          agentId: 'plugin:sandbox:codex:signal-tools@sandbox-curated:2.0.0',
          agentLabel: 'Codex Plugin signal-tools',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json',
          command: 'node',
          args: ['signal-map.js'],
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'codex',
              pluginId: 'signal-tools@sandbox-curated',
              version: '2.0.0',
            },
            sourcePath: '~/.skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json',
            discoveredAt: '2026-05-15T12:00:00.000Z',
          },
          mutability: 'read-only-managed',
        },
      ],
    };

    expect(getMcpDisplayName(mcp)).toBe('signalMap');
    expect(filterMcpRows([mcp], 'signalmap').map((row) => row.name)).toEqual(['signal-tools:signalMap']);
    expect(filterMcpRows([mcp], 'signal-tools').map((row) => row.name)).toEqual(['signal-tools:signalMap']);
  });
});

function createSkillWithSingleSource(skillName: string, source: SkillScanSource): SkillRecord {
  const skill = structuredClone(representativeInventorySnapshot.skills.find((entry) => entry.name === skillName));
  if (!skill) {
    throw new Error(`Missing representative skill ${skillName}.`);
  }

  return {
    ...skill,
    locations: skill.locations.map((location) => ({
      ...location,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceScope: source.scope,
    })),
  };
}
