import { describe, expect, it } from 'vitest';

import type { McpRecord, SkillInventorySnapshot, SkillRecord, SkillScanSource, SubagentRecord } from '@shared/contracts';

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
  getSubagentSections,
  getSubagentTableRows,
} from './inventory-view-model';

describe('inventory view ordering', () => {
  it('orders attention skills alphabetically by displayed title regardless of issue count', () => {
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
          issueReasons: ['diverged-copies', 'invalid-definition'],
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

  it('orders healthy skills alphabetically by displayed title regardless of structural state', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const healthy = base.skills.find((skill) => skill.name === 'healthy-skill');
    const singleSource = base.skills.find((skill) => skill.name === 'single-source-skill');
    expect(healthy).toBeDefined();
    expect(singleSource).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      skills: [
        {
          ...healthy!,
          name: 'healthy-zulu-skill',
          displayName: 'Zulu Skill',
        },
        {
          ...singleSource!,
          name: 'healthy-alpha-skill',
          displayName: 'Alpha Skill',
        },
      ],
    };

    const healthyRows = getSkillSections(snapshot).find((section) => section.title === 'Healthy')?.rows ?? [];
    expect(healthyRows.map((skill) => skill.displayName)).toEqual(['Alpha Skill', 'Zulu Skill']);
    expect(getSkillTableRows(snapshot).map((skill) => skill.displayName)).toEqual(['Alpha Skill', 'Zulu Skill']);
  });

  it('orders attention MCPs alphabetically by displayed title regardless of issue count', () => {
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

    const attentionRows = getMcpSections(snapshot).find((section) => section.title === 'Needs attention')?.rows ?? [];
    expect(attentionRows.map((mcp) => mcp.name)).toEqual([
      'alpha-mcp',
      'middle-mcp',
      'zulu-mcp',
    ]);
    expect(getMcpTableRows(snapshot).map((mcp) => mcp.name)).toEqual(['alpha-mcp', 'middle-mcp', 'zulu-mcp']);
  });

  it('orders attention subagents alphabetically by displayed title regardless of issue count', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const reviewer = base.subagents?.find((subagent) => subagent.name === 'reviewer');
    expect(reviewer).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      subagents: [
        {
          ...reviewer!,
          name: 'zeta-subagent',
          displayName: 'Alpha Subagent',
          issueReasons: ['missing-from-agents'],
        } satisfies SubagentRecord,
        {
          ...reviewer!,
          name: 'alpha-subagent',
          displayName: 'Zulu Subagent',
          issueReasons: ['missing-from-agents', 'definition-mismatch'],
        } satisfies SubagentRecord,
      ],
    };

    const attentionRows = getSubagentSections(snapshot).find((section) => section.title === 'Needs attention')?.rows ?? [];
    expect(attentionRows.map((subagent) => subagent.displayName)).toEqual(['Alpha Subagent', 'Zulu Subagent']);
    expect(getSubagentTableRows(snapshot).map((subagent) => subagent.displayName)).toEqual([
      'Alpha Subagent',
      'Zulu Subagent',
    ]);
  });

  it('orders dismissed skills alphabetically regardless of issue count', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const dismissed = base.skills.find((skill) => skill.name === 'dismissed-drift-skill');
    expect(dismissed).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      skills: [
        {
          ...dismissed!,
          name: 'zulu-dismissed-skill',
          issueReasons: ['identical-copies', 'invalid-definition'],
        },
        {
          ...dismissed!,
          name: 'alpha-dismissed-skill',
          issueReasons: ['identical-copies'],
        },
        ...base.skills.filter((skill) => skill.name !== 'dismissed-drift-skill'),
      ],
    };

    const dismissedRows = getSkillSections(snapshot).find((section) => section.title === 'Dismissed issues')?.rows ?? [];
    expect(dismissedRows.slice(0, 2).map((skill) => skill.name)).toEqual([
      'alpha-dismissed-skill',
      'zulu-dismissed-skill',
    ]);
    expect(getSkillTableRows(snapshot)
      .filter((skill) => skill.driftPresentation === 'dismissed')
      .slice(0, 2)
      .map((skill) => skill.name)).toEqual(['alpha-dismissed-skill', 'zulu-dismissed-skill']);
  });

  it('orders dismissed MCPs alphabetically regardless of issue count', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const dismissed = base.mcps?.find((mcp) => mcp.name === 'muted-mcp');
    expect(dismissed).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      mcps: [
        {
          ...dismissed!,
          name: 'zulu-dismissed-mcp',
          issueReasons: ['definition-mismatch', 'invalid-definition'],
        } satisfies McpRecord,
        {
          ...dismissed!,
          name: 'alpha-dismissed-mcp',
          issueReasons: ['definition-mismatch'],
        } satisfies McpRecord,
        ...(base.mcps ?? []).filter((mcp) => mcp.name !== 'muted-mcp'),
      ],
    };

    const dismissedRows = getMcpSections(snapshot).find((section) => section.title === 'Dismissed issues')?.rows ?? [];
    expect(dismissedRows.slice(0, 2).map((mcp) => mcp.name)).toEqual([
      'alpha-dismissed-mcp',
      'zulu-dismissed-mcp',
    ]);
    expect(getMcpTableRows(snapshot)
      .filter((mcp) => mcp.presentation === 'dismissed')
      .slice(0, 2)
      .map((mcp) => mcp.name)).toEqual(['alpha-dismissed-mcp', 'zulu-dismissed-mcp']);
  });

  it('orders dismissed subagents alphabetically regardless of issue count', () => {
    const base = structuredClone(representativeInventorySnapshot);
    const reviewer = base.subagents?.find((subagent) => subagent.name === 'reviewer');
    expect(reviewer).toBeDefined();

    const snapshot: SkillInventorySnapshot = {
      ...base,
      subagents: [
        {
          ...reviewer!,
          name: 'zulu-dismissed-subagent',
          displayName: 'Zulu Dismissed Subagent',
          presentation: 'dismissed',
          issueReasons: ['missing-from-agents', 'definition-mismatch'],
        } satisfies SubagentRecord,
        {
          ...reviewer!,
          name: 'alpha-dismissed-subagent',
          displayName: 'Alpha Dismissed Subagent',
          presentation: 'dismissed',
          issueReasons: ['missing-from-agents'],
        } satisfies SubagentRecord,
      ],
    };

    const dismissedRows = getSubagentSections(snapshot).find((section) => section.title === 'Dismissed issues')?.rows ?? [];
    expect(dismissedRows.map((subagent) => subagent.displayName)).toEqual([
      'Alpha Dismissed Subagent',
      'Zulu Dismissed Subagent',
    ]);
    expect(getSubagentTableRows(snapshot)
      .filter((subagent) => subagent.presentation === 'dismissed')
      .map((subagent) => subagent.displayName)).toEqual(['Alpha Dismissed Subagent', 'Zulu Dismissed Subagent']);
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
