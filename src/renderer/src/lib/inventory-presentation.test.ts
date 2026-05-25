import type { McpRecord, SkillRecord } from '@shared/contracts';

import { describe, expect, it } from 'vitest';

import {
  getPillToneForMcp,
  getPillToneForSkill,
  formatMcpIssueReason,
  formatSkillIssueReason,
  getMcpStatusLabels,
  getShortMcpStatusLabel,
  getSkillStatusLabels,
  getShortSkillStatusLabel,
} from './inventory-presentation';

function createSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    name: 'example-skill',
    description: 'Example skill',
    structuralState: 'healthy',
    isDrifted: false,
    driftPresentation: 'none',
    issueReasons: [],
    locations: [],
    detailDiagnostics: {
      duplicateCandidates: [],
      installSources: [],
    },
    ...overrides,
  };
}

function createMcp(overrides: Partial<McpRecord> = {}): McpRecord {
  return {
    name: 'example-mcp',
    status: 'healthy',
    presentation: 'none',
    locations: [],
    issueReasons: [],
    ...overrides,
  };
}

describe('inventory presentation severity mapping', () => {
  it('renders single-source noncanonical skills as attention', () => {
    const tone = getPillToneForSkill(createSkill({
      structuralState: 'single-source-noncanonical',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['missing-canonical'],
    }));

    expect(tone).toBe('attention');
  });

  it('renders non-healthy MCPs as attention regardless of issue reason', () => {
    const tone = getPillToneForMcp(createMcp({
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['missing-from-agents'],
    }));

    expect(tone).toBe('attention');
  });

  it('formats stable problem labels for skill and MCP issue lists', () => {
    expect(formatSkillIssueReason('missing-canonical')).toBe('Missing Universal');
    expect(formatSkillIssueReason('diverged-copies')).toBe('Diverged Copies');
    expect(formatMcpIssueReason('definition-mismatch')).toBe('Definition Mismatch');
    expect(formatMcpIssueReason('invalid-definition')).toBe('Invalid Definition');
    expect(formatMcpIssueReason('connection-failed')).toBe('Connection Failed');
  });

  it('uses the same missing-from-agents label in compact MCP pills', () => {
    const label = getShortMcpStatusLabel(createMcp({
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['missing-from-agents'],
    }));

    expect(label).toBe('Missing From Agents');
  });

  it('uses canonical issue labels in compact skill pills', () => {
    const label = getShortSkillStatusLabel(createSkill({
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['identical-copies'],
    }));

    expect(label).toBe('Identical Copies');
  });

  it('uses Healthy for healthy compact MCP pills', () => {
    const label = getShortMcpStatusLabel(createMcp({
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
    }));

    expect(label).toBe('Healthy');
  });

  it('keeps healthy MCP status copy generic after a successful runtime check', () => {
    const label = getShortMcpStatusLabel(createMcp({
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['server.js'],
          connectivity: {
            status: 'verified',
            checkedAt: '2026-05-04T12:00:00.000Z',
            latencyMs: 12,
          },
        },
      ],
    }));

    expect(label).toBe('Healthy');
  });

  it('returns all visible issue labels for multi-issue skills and MCPs', () => {
    expect(getSkillStatusLabels(createSkill({
      structuralState: 'diverged-drift',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['diverged-copies'],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        definitionIssues: [
          {
            type: 'missing-required-field',
            field: 'name',
            path: '/tmp/skill.md',
            sourceId: 'sandbox-factory',
            sourceLabel: 'Sandbox Factory',
            sourceScope: 'sandbox',
            installSource: {
              sourceId: 'sandbox-factory',
              label: 'Sandbox Factory',
              kind: 'agent',
              scope: 'sandbox',
              writable: true,
              canonical: false,
            },
          },
        ],
      },
    }))).toEqual(['Diverged Copies', 'Invalid Definition']);

    expect(getMcpStatusLabels(createMcp({
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch', 'invalid-definition', 'connection-failed'],
    }))).toEqual(['Definition Mismatch', 'Invalid Definition', 'Connection Failed']);
  });
});
