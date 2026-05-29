import type { AgentMcpParserKind, McpRecord, SkillInventorySnapshot, SkillRecord, SubagentRecord } from '@shared/contracts';
import { describe, expect, it } from 'vitest';

import { representativeInventorySnapshot } from '../representative-preview-data';
import { buildMcpInspectorModel, buildSkillInspectorModel, buildSubagentInspectorModel } from './detail-inspector-model';
import {
  getAutoResolvableMcpRequests,
  getAutoResolvableSkillRequests,
  getAutoResolvableSubagentRequests,
  getMcpResolveActionState,
  getSkillResolveActionState,
  getSubagentResolveActionState,
} from './issue-resolution';

const sourceIndex = new Map(representativeInventorySnapshot.sources.map((source) => [source.id, source]));
const agentIndex = new Map((representativeInventorySnapshot.agents ?? []).map((agent) => [agent.id, agent]));

function findRepresentativeMcp(name: string): McpRecord {
  const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === name);
  if (!mcp) {
    throw new Error(`Missing representative MCP fixture: ${name}`);
  }
  return mcp;
}

function findRepresentativeSubagent(name: string): SubagentRecord {
  const subagent = representativeInventorySnapshot.subagents?.find((entry) => entry.name === name);
  if (!subagent) {
    throw new Error(`Missing representative subagent fixture: ${name}`);
  }
  return subagent;
}

describe('issue resolution request builder', () => {
  it('keeps plugin-owned missing symlink repairs out of Home auto-resolve batches', () => {
    const skill: SkillRecord = {
      name: 'tools:foo',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['missing-symlinks'],
      locations: [
        {
          path: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
          sourceId: 'live-plugin-tools',
          sourceLabel: 'Claude Plugin tools',
          sourceScope: 'live',
          fileType: 'real-file',
          installKind: 'directory',
          modifiedAt: '2026-01-08T00:00:00.000Z',
          canonical: true,
          resolvedPath: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
          contentHash: 'plugin-foo',
          provenance: {
            kind: 'plugin',
            sourcePath: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
            discoveredAt: '2026-01-08T00:00:00.000Z',
            plugin: {
              host: 'claude',
              pluginId: 'tools@official',
              version: '1.0.0',
            },
          },
          mutability: 'read-only-managed',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [
          {
            sourceId: 'live-plugin-tools',
            label: 'Claude Plugin tools',
            kind: 'plugin',
            scope: 'live',
            writable: false,
            canonical: true,
          },
        ],
        missingInstallSources: [
          {
            sourceId: 'live-agents',
            label: 'Live .agents',
            kind: 'canonical',
            scope: 'live',
            writable: true,
            canonical: false,
          },
        ],
        definitionIssues: [],
      },
    };
    const pluginSourceIndex = new Map(sourceIndex);
    pluginSourceIndex.set('live-plugin-tools', {
      id: 'live-plugin-tools',
      label: 'Claude Plugin tools',
      canonical: true,
      kind: 'plugin',
      writable: false,
      scope: 'live',
      skillsDir: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills',
      compatibleAgentFamilies: ['claude'],
    });
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      skills: [skill],
      sources: [...representativeInventorySnapshot.sources, pluginSourceIndex.get('live-plugin-tools')!],
    };

    expect(getAutoResolvableSkillRequests(snapshot, pluginSourceIndex)).toEqual([]);
  });

  it('keeps wrong symlink target repairs out of Home auto-resolve batches', () => {
    const skill: SkillRecord = {
      name: 'wrong-link-skill',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['wrong-symlink-target'],
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/wrong-link-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-08T00:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/wrong-link-skill.md',
          contentHash: 'canonical-copy',
        },
        {
          path: '~/.skillindex/sandbox/.claude/skills/wrong-link-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'symlink',
          modifiedAt: '2026-01-08T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/other-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/other-skill.md',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        definitionIssues: [],
      },
    };
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      skills: [skill],
    };

    expect(getAutoResolvableSkillRequests(snapshot, sourceIndex)).toEqual([]);
  });

  it('includes missing-from-agents MCP repairs in Home auto-resolve batches', () => {
    expect(getAutoResolvableMcpRequests(representativeInventorySnapshot)).toEqual([
      {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/mcp.json',
      },
    ]);
  });

  it('includes supported missing-from-agents subagent repairs in Home auto-resolve batches', () => {
    expect(getAutoResolvableSubagentRequests(representativeInventorySnapshot)).toEqual([
      {
        entity: 'subagent',
        issue: 'missing-from-agents',
        subagentName: 'reviewer',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/agents/reviewer.md',
      },
    ]);
  });

  it('keeps plugin-owned subagent repairs out of Home auto-resolve batches', () => {
    const pluginSubagent = findRepresentativeSubagent('sandbox-plugin-pack:deployment-expert');
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      subagents: [pluginSubagent],
    };

    expect(getAutoResolvableSubagentRequests(snapshot)).toEqual([]);
  });

  it('keeps plugin-owned missing-from-agents MCP repairs out of Home auto-resolve batches', () => {
    const baseMcp = findRepresentativeMcp('missing-from-agents-mcp');
    const pluginSourceId = 'plugin:live:codex:mcpmarket-my-toolkit@market:1.0.0';
    const pluginMcp: McpRecord = {
      ...structuredClone(baseMcp),
      name: 'mcpmarket-my-toolkit:mcpmarket-my-toolkit',
      locations: [
        {
          ...baseMcp.locations[0],
          agentId: pluginSourceId,
          agentLabel: 'Codex Plugin mcpmarket-my-toolkit',
          configPath: '/Users/tester/.codex/plugins/cache/mcpmarket-my-toolkit/1.0.0/.mcp.json',
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'codex',
              pluginId: 'mcpmarket-my-toolkit@market',
              version: '1.0.0',
            },
            sourcePath: '/Users/tester/.codex/plugins/cache/mcpmarket-my-toolkit/1.0.0/.mcp.json',
            discoveredAt: '2026-05-01T00:00:00.000Z',
          },
          mutability: 'read-only-managed',
        },
      ],
    };
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      mcps: [pluginMcp],
      sources: [
        ...representativeInventorySnapshot.sources,
        {
          id: pluginSourceId,
          label: 'Codex Plugin mcpmarket-my-toolkit',
          canonical: true,
          kind: 'plugin',
          writable: false,
          scope: 'live',
          skillsDir: '/Users/tester/.codex/plugins/cache/mcpmarket-my-toolkit/1.0.0/skills',
          mcpConfigPath: '/Users/tester/.codex/plugins/cache/mcpmarket-my-toolkit/1.0.0/.mcp.json',
        },
      ],
    };

    expect(getAutoResolvableMcpRequests(snapshot)).toEqual([]);
  });

  it('builds a missing-symlink skill request without forcing diverged selection when canonical exists', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill')!;
    const skill: SkillRecord = {
      ...baseSkill,
      name: 'mixed-missing-symlink-skill',
      issueReasons: ['diverged-copies', 'missing-symlinks', 'invalid-definition'],
      detailDiagnostics: {
        ...baseSkill.detailDiagnostics,
        missingInstallSources: [
          {
            sourceId: 'sandbox-factory',
            label: 'Sandbox Factory',
            kind: 'agent',
            scope: 'sandbox',
            writable: true,
            canonical: false,
          },
        ],
      },
    };
    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    expect(getSkillResolveActionState(skill, model, sourceIndex)).toEqual({
      disabledReason: null,
      request: {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'mixed-missing-symlink-skill',
        selectedVariantPath: undefined,
      },
    });
  });

  it('requires a selected variant before repairing links when canonical is missing and multiple variants exist', () => {
    const skill: SkillRecord = {
      ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill')!,
      name: 'double-missing-canonical-skill',
      structuralState: 'diverged-drift',
      issueReasons: ['diverged-copies', 'missing-canonical'],
      locations: [
        {
          path: '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T12:15:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md',
          contentHash: 'claude',
          definitionText: 'claude body',
        },
        {
          path: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
          sourceId: 'sandbox-factory',
          sourceLabel: 'Sandbox Factory',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T12:15:01.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
          contentHash: 'factory',
          definitionText: 'factory body',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [
          {
            path: '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md',
            sourceId: 'sandbox-claude',
            sourceLabel: 'Sandbox Claude',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-04T12:15:00.000Z',
            canonical: false,
            resolvedPath: '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md',
            contentHash: 'claude',
            definitionText: 'claude body',
            installSource: {
              sourceId: 'sandbox-claude',
              label: 'Sandbox Claude',
              kind: 'agent',
              scope: 'sandbox',
              writable: true,
              canonical: false,
            },
          },
          {
            path: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
            sourceId: 'sandbox-factory',
            sourceLabel: 'Sandbox Factory',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-04T12:15:01.000Z',
            canonical: false,
            resolvedPath: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
            contentHash: 'factory',
            definitionText: 'factory body',
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
        installSources: [
          {
            sourceId: 'sandbox-claude',
            label: 'Sandbox Claude',
            kind: 'agent',
            scope: 'sandbox',
            writable: true,
            canonical: false,
          },
          {
            sourceId: 'sandbox-factory',
            label: 'Sandbox Factory',
            kind: 'agent',
            scope: 'sandbox',
            writable: true,
            canonical: false,
          },
        ],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };
    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath: null,
    }, agentIndex);

    expect(getSkillResolveActionState(skill, model, sourceIndex)).toEqual({
      disabledReason: null,
      request: {
        entity: 'skill',
        issue: 'missing-canonical',
        skillName: 'double-missing-canonical-skill',
        selectedVariantPath: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
      },
    });
  });

  it('reuses a preserved selected skill variant on structural tabs', () => {
    const skill = {
      ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill')!,
      name: 'double-missing-canonical-skill',
      structuralState: 'diverged-drift',
      issueReasons: ['diverged-copies', 'missing-canonical'],
      locations: [
        {
          path: '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T12:15:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md',
          contentHash: 'claude',
          definitionText: 'claude body',
        },
        {
          path: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
          sourceId: 'sandbox-factory',
          sourceLabel: 'Sandbox Factory',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T12:15:01.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.factory/skills/double-missing-canonical-skill.md',
          contentHash: 'factory',
          definitionText: 'factory body',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        missingInstallSources: [],
        definitionIssues: [],
      },
    } satisfies SkillRecord;
    const selectedVariantPath = '~/.skillindex/sandbox/.claude/skills/double-missing-canonical-skill.md';
    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath,
    }, agentIndex);

    expect(getSkillResolveActionState(skill, model, sourceIndex)).toEqual({
      disabledReason: null,
      request: {
        entity: 'skill',
        issue: 'missing-canonical',
        skillName: 'double-missing-canonical-skill',
        selectedVariantPath,
      },
    });
  });

  it('allows live skill repairs when the live source is writable', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'single-source-skill')!;
    const skill: SkillRecord = {
      ...baseSkill,
      name: 'live-single-source-skill',
      issueReasons: ['missing-canonical'],
      locations: [
        {
          path: '/Users/tester/.claude/skills/live-single-source-skill',
          sourceId: 'live-claude',
          sourceLabel: 'Claude Code',
          sourceScope: 'live',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T12:15:00.000Z',
          canonical: false,
          resolvedPath: '/Users/tester/.claude/skills/live-single-source-skill',
          contentHash: 'live-single-source',
          definitionText: 'live single source body',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };
    const liveSourceIndex = new Map(sourceIndex);
    liveSourceIndex.set('live-claude', {
      id: 'live-claude',
      label: 'Claude Code',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'live',
      skillsDir: '/Users/tester/.claude/skills',
      compatibleAgentFamilies: ['claude'],
    });
    const liveAgentIndex = new Map(agentIndex);
    liveAgentIndex.set('live-claude', {
      ...representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-claude')!,
      id: 'live-claude',
      scope: 'live',
      writable: true,
      installState: 'installed',
      skillsLocation: {
        state: 'available',
        path: '/Users/tester/.claude/skills',
        displayPath: '~/.claude/skills',
        exists: true,
      },
    });
    const model = buildSkillInspectorModel(skill, liveSourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath: null,
    }, liveAgentIndex);

    expect(getSkillResolveActionState(skill, model, liveSourceIndex)).toEqual({
      disabledReason: null,
      request: {
        entity: 'skill',
        issue: 'missing-canonical',
        skillName: 'live-single-source-skill',
        selectedVariantPath: '/Users/tester/.claude/skills/live-single-source-skill',
      },
    });
  });

  it('allows repairing Universal links to a read-only plugin skill', () => {
    const skill: SkillRecord = {
      ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'plugin-readonly-skill')!,
      name: 'tools:foo',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
      locations: [
        {
          path: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
          sourceId: 'live-plugin-tools',
          sourceLabel: 'Claude Plugin tools',
          sourceScope: 'live',
          fileType: 'real-file',
          installKind: 'directory',
          modifiedAt: '2026-01-08T00:00:00.000Z',
          canonical: true,
          resolvedPath: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
          contentHash: 'plugin-foo',
          provenance: {
            kind: 'plugin',
            sourcePath: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
            discoveredAt: '2026-01-08T00:00:00.000Z',
            plugin: {
              host: 'claude',
              pluginId: 'tools@official',
              version: '1.0.0',
            },
          },
          mutability: 'read-only-managed',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [
          {
            sourceId: 'live-plugin-tools',
            label: 'Claude Plugin tools',
            kind: 'plugin',
            scope: 'live',
            writable: false,
            canonical: true,
          },
        ],
        missingInstallSources: [
          {
            sourceId: 'live-agents',
            label: 'Live .agents',
            kind: 'canonical',
            scope: 'live',
            writable: true,
            canonical: false,
          },
        ],
        definitionIssues: [],
      },
    };
    const pluginSourceIndex = new Map(sourceIndex);
    pluginSourceIndex.set('live-plugin-tools', {
      id: 'live-plugin-tools',
      label: 'Claude Plugin tools',
      canonical: true,
      kind: 'plugin',
      writable: false,
      scope: 'live',
      skillsDir: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills',
      compatibleAgentFamilies: ['claude'],
    });
    const model = buildSkillInspectorModel(skill, pluginSourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    expect(getSkillResolveActionState(skill, model, pluginSourceIndex)).toEqual({
      disabledReason: null,
      request: {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'tools:foo',
        selectedVariantPath: '/Users/tester/.claude/plugins/cache/official/tools/1.0.0/skills/foo',
      },
    });
  });

  it('selects a deterministic plugin location when the same plugin skill exists in multiple hosts', () => {
    const skill: SkillRecord = {
      ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'plugin-readonly-skill')!,
      name: 'example-workflow-kit:idea-shaping',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
      locations: [
        {
          path: '/Users/tester/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/idea-shaping',
          sourceId: 'plugin:sandbox:claude:example-workflow-kit@sandbox-gallery:5.1.0',
          sourceLabel: 'Claude Plugin example-workflow-kit',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          installKind: 'directory',
          modifiedAt: '2026-01-08T00:00:00.000Z',
          canonical: true,
          resolvedPath: '/Users/tester/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/idea-shaping',
          contentHash: 'claude-plugin-copy',
          provenance: {
            kind: 'plugin',
            sourcePath: '/Users/tester/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/idea-shaping',
            discoveredAt: '2026-01-08T00:00:00.000Z',
            plugin: {
              host: 'claude',
              pluginId: 'example-workflow-kit@sandbox-gallery',
              version: '5.1.0',
            },
          },
          mutability: 'read-only-managed',
        },
        {
          path: '/Users/tester/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/idea-shaping',
          sourceId: 'plugin:sandbox:codex:example-workflow-kit@sandbox-curated:5.1.0',
          sourceLabel: 'Codex Plugin example-workflow-kit',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          installKind: 'directory',
          modifiedAt: '2026-01-08T00:00:00.000Z',
          canonical: true,
          resolvedPath: '/Users/tester/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/idea-shaping',
          contentHash: 'codex-plugin-copy',
          provenance: {
            kind: 'plugin',
            sourcePath: '/Users/tester/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/idea-shaping',
            discoveredAt: '2026-01-08T00:00:00.000Z',
            plugin: {
              host: 'codex',
              pluginId: 'example-workflow-kit@sandbox-curated',
              version: '5.1.0',
            },
          },
          mutability: 'read-only-managed',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        missingInstallSources: [
          {
            sourceId: 'sandbox-agents',
            label: 'Sandbox .agents',
            kind: 'canonical',
            scope: 'sandbox',
            writable: true,
            canonical: false,
          },
        ],
        definitionIssues: [],
      },
    };
    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    expect(getSkillResolveActionState(skill, model, sourceIndex)).toEqual({
      disabledReason: null,
      request: {
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'example-workflow-kit:idea-shaping',
        selectedVariantPath: '/Users/tester/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/idea-shaping',
      },
    });
  });

  it('auto-selects the sole MCP definition variant for missing-from-agents', () => {
    const mcp = findRepresentativeMcp('missing-from-agents-mcp');
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, agentIndex);

    expect(getMcpResolveActionState(mcp, model, representativeInventorySnapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/mcp.json',
      },
    });
  });

  it('requires MCP variant selection when multiple definitions exist', () => {
    const mcp = findRepresentativeMcp('diagnostic-rich-mcp');
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.claude.json',
    }, agentIndex);

    expect(getMcpResolveActionState(mcp, model, representativeInventorySnapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName: 'diagnostic-rich-mcp',
        selectedVariantPath: '~/.skillindex/sandbox/.claude.json',
      },
    });
  });

  it('allows live definition-mismatch repair even when unrelated missing-agent targets are not writable', () => {
    const mcp: McpRecord = {
      name: 'live-blitz-macos',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch', 'missing-from-agents'],
      locations: [
        {
          agentId: 'live-codex',
          agentLabel: 'Codex',
          scope: 'live',
          configPath: '/Users/tester/.codex/config.toml',
          transport: 'stdio',
          command: '/Users/tester/.blitz/blitz-macos-mcp',
          args: [],
          definitionText: '{"command":"/Users/tester/.blitz/blitz-macos-mcp","cwd":"/Users/tester/.blitz/mcps"}',
          definitionComparisonKey: '{"command":"/Users/tester/.blitz/blitz-macos-mcp","cwd":"/Users/tester/.blitz/mcps","transport":"stdio"}',
        },
        {
          agentId: 'live-factory',
          agentLabel: 'Factory',
          scope: 'live',
          configPath: '/Users/tester/.factory/mcp.json',
          transport: 'stdio',
          command: '/Users/tester/.blitz/blitz-macos-mcp',
          args: [],
          definitionText: '{"command":"/Users/tester/.blitz/blitz-macos-mcp","type":"stdio"}',
          definitionComparisonKey: '{"command":"/Users/tester/.blitz/blitz-macos-mcp","transport":"stdio"}',
        },
      ],
      expectedLocations: [
        {
          agentId: 'live-codex',
          agentLabel: 'Codex',
          scope: 'live',
          configPath: '/Users/tester/.codex/config.toml',
        },
        {
          agentId: 'live-factory',
          agentLabel: 'Factory',
          scope: 'live',
          configPath: '/Users/tester/.factory/mcp.json',
        },
        {
          agentId: 'live-missing-agent',
          agentLabel: 'Missing Agent',
          scope: 'live',
        },
      ],
      missingLocations: [
        {
          agentId: 'live-missing-agent',
          agentLabel: 'Missing Agent',
          scope: 'live',
        },
      ],
    };
    const baseAgent = representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!;
    const liveSnapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      agents: [
        {
          ...baseAgent,
          id: 'live-codex',
          family: 'codex',
          label: 'Codex',
          scope: 'live',
          writable: true,
          installState: 'installed',
          mcpParserKind: 'toml',
          mcpConfigLocation: {
            state: 'available',
            path: '/Users/tester/.codex/config.toml',
            displayPath: '~/.codex/config.toml',
            exists: true,
          },
        },
        {
          ...baseAgent,
          id: 'live-factory',
          family: 'factory',
          label: 'Factory',
          scope: 'live',
          writable: true,
          installState: 'installed',
          mcpParserKind: 'json-mcpServers',
          mcpConfigLocation: {
            state: 'available',
            path: '/Users/tester/.factory/mcp.json',
            displayPath: '~/.factory/mcp.json',
            exists: true,
          },
        },
      ],
    };
    const liveAgentIndex = new Map((liveSnapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '/Users/tester/.codex/config.toml',
    }, liveAgentIndex);

    expect(getMcpResolveActionState(mcp, model, liveSnapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName: 'live-blitz-macos',
        selectedVariantPath: '/Users/tester/.codex/config.toml',
      },
    });
  });

  it('allows definition-mismatch repair for mixed plugin and writable manual MCP locations', () => {
    const mcp: McpRecord = {
      name: 'mixed-plugin-definition-mcp',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch'],
      locations: [
        {
          agentId: 'sandbox-plugin-pack',
          agentLabel: 'Sandbox Plugin bundle',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/plugins/.mcp.json',
          transport: 'stdio',
          command: 'node',
          args: ['plugin-server.js'],
          definitionText: '{"command":"node","args":["plugin-server.js"]}',
          definitionComparisonKey: '{"command":"node","args":["plugin-server.js"],"transport":"stdio"}',
        },
        {
          agentId: 'sandbox-codex',
          agentLabel: 'Sandbox .codex',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/config.toml',
          transport: 'stdio',
          command: 'node',
          args: ['manual-server.js'],
          definitionText: '{"command":"node","args":["manual-server.js"]}',
          definitionComparisonKey: '{"command":"node","args":["manual-server.js"],"transport":"stdio"}',
        },
      ],
    };
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/plugins/.mcp.json',
    }, agentIndex);

    expect(getMcpResolveActionState(mcp, model, representativeInventorySnapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'mcp',
        issue: 'definition-mismatch',
        mcpName: 'mixed-plugin-definition-mcp',
        selectedVariantPath: '~/.skillindex/sandbox/plugins/.mcp.json',
      },
    });
  });

  it('allows live MCP repairs when the target config is writable and supported', () => {
    const baseMcp = findRepresentativeMcp('missing-from-agents-mcp');
    const liveMcp: McpRecord = {
      ...baseMcp,
      locations: [
        {
          agentId: 'live-claude',
          agentLabel: 'Claude',
          scope: 'live',
          configPath: '/Users/tester/.claude.json',
          command: 'uvx',
          args: ['live-mcp'],
          definitionText: '{"command":"uvx","args":["live-mcp"]}',
        },
      ],
      expectedLocations: [
        {
          agentId: 'live-opencode',
          agentLabel: 'OpenCode',
          scope: 'live',
          configPath: '/Users/tester/.config/opencode/opencode.json',
        },
      ],
      missingLocations: [
        {
          agentId: 'live-opencode',
          agentLabel: 'OpenCode',
          scope: 'live',
          configPath: '/Users/tester/.config/opencode/opencode.json',
        },
      ],
    };
    const liveSnapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      agents: [
        ...(representativeInventorySnapshot.agents ?? []),
        {
          ...representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-claude')!,
          id: 'live-claude',
          scope: 'live',
          writable: true,
          installState: 'installed',
          mcpParserKind: 'json-mcpServers',
          mcpConfigLocation: {
            state: 'available',
            path: '/Users/tester/.claude.json',
            displayPath: '~/.claude.json',
            exists: true,
          },
        },
        {
          ...representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!,
          id: 'live-opencode',
          family: 'opencode',
          label: 'OpenCode',
          scope: 'live',
          writable: true,
          installState: 'installed',
          mcpParserKind: 'jsonc-mcp',
          skillsLocation: {
            state: 'available',
            path: '/Users/tester/.agents/skills',
            displayPath: '~/.agents/skills',
            exists: true,
          },
          mcpConfigLocation: {
            state: 'available',
            path: '/Users/tester/.config/opencode/opencode.json',
            displayPath: '~/.config/opencode/opencode.json',
            exists: true,
          },
        },
      ],
    };
    const liveAgentIndex = new Map(agentIndex);
    liveAgentIndex.set('live-claude', liveSnapshot.agents!.find((agent) => agent.id === 'live-claude')!);
    liveAgentIndex.set('live-opencode', liveSnapshot.agents!.find((agent) => agent.id === 'live-opencode')!);
    const model = buildMcpInspectorModel(liveMcp, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, liveAgentIndex);

    expect(getMcpResolveActionState(liveMcp, model, liveSnapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: '/Users/tester/.claude.json',
      },
    });
  });

  it('auto-selects the canonical subagent definition for missing-from-agents', () => {
    const subagent = findRepresentativeSubagent('reviewer');
    const model = buildSubagentInspectorModel(subagent, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, agentIndex);

    expect(getSubagentResolveActionState(subagent, model, representativeInventorySnapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'subagent',
        issue: 'missing-from-agents',
        subagentName: 'reviewer',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/agents/reviewer.md',
      },
    });
  });

  it('allows subagent repairs for YAML targets', () => {
    const baseSubagent = findRepresentativeSubagent('reviewer');
    const targetAgentId = 'target-yaml-subagent';
    const subagent: SubagentRecord = {
      ...baseSubagent,
      missingLocations: [{
        agentId: targetAgentId,
        agentLabel: 'YAML Agent',
        scope: 'live',
        directoryPath: '/Users/tester/yaml/agents',
        path: '/Users/tester/yaml/agents/reviewer.yaml',
        format: 'yaml',
        supportStatus: 'supported',
      }],
    };
    const baseAgent = representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!;
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      subagents: [subagent],
      agents: [
        ...(representativeInventorySnapshot.agents ?? []),
        {
          ...baseAgent,
          id: targetAgentId,
          label: 'YAML Agent',
          scope: 'live',
          writable: true,
          installState: 'installed',
          subagentParserKind: 'yaml',
          subagentsLocation: {
            state: 'available',
            path: '/Users/tester/yaml/agents',
            displayPath: '/Users/tester/yaml/agents',
            exists: true,
          },
        },
      ],
    };
    const localAgentIndex = new Map((snapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const model = buildSubagentInspectorModel(subagent, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, localAgentIndex);

    expect(getSubagentResolveActionState(subagent, model, snapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'subagent',
        issue: 'missing-from-agents',
        subagentName: 'reviewer',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/agents/reviewer.md',
      },
    });
  });

  it('keeps subagent repairs disabled for installed agents with unsupported parser kinds', () => {
    const baseSubagent = findRepresentativeSubagent('reviewer');
    const targetAgentId = 'target-unknown-subagent';
    const subagent: SubagentRecord = {
      ...baseSubagent,
      missingLocations: [{
        agentId: targetAgentId,
        agentLabel: 'Unknown Agent',
        scope: 'live',
        directoryPath: '/Users/tester/unknown/agents',
        path: '/Users/tester/unknown/agents/reviewer.agent',
        format: 'unknown',
        supportStatus: 'supported',
      }],
    };
    const baseAgent = representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!;
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      subagents: [subagent],
      agents: [
        ...(representativeInventorySnapshot.agents ?? []),
        {
          ...baseAgent,
          id: targetAgentId,
          label: 'Unknown Agent',
          scope: 'live',
          writable: true,
          installState: 'installed',
          subagentParserKind: 'unknown',
          subagentsLocation: {
            state: 'available',
            path: '/Users/tester/unknown/agents',
            displayPath: '/Users/tester/unknown/agents',
            exists: true,
          },
        },
      ],
    };
    const localAgentIndex = new Map((snapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const model = buildSubagentInspectorModel(subagent, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, localAgentIndex);

    expect(getSubagentResolveActionState(subagent, model, snapshot)).toEqual({
      disabledReason: 'This subagent can only be resolved when every target location is writable and uses a supported format.',
      request: null,
    });
  });

  it('allows MCP repairs when cwd-dependent definitions target OpenCode', () => {
    const baseMcp = findRepresentativeMcp('missing-from-agents-mcp');
    const sourceLocation = {
      ...baseMcp.locations[0],
      definitionText: '{"command":"node","args":["server.js"],"cwd":"/Users/tester/project"}',
      definitionComparisonKey: '{"args":["server.js"],"command":"node","cwd":"/Users/tester/project"}',
    };
    const targetAgentId = 'live-opencode-cwd';
    const targetConfigPath = '/Users/tester/.config/opencode/opencode.json';
    const mcp: McpRecord = {
      ...baseMcp,
      locations: [sourceLocation],
      missingLocations: [{
        agentId: targetAgentId,
        agentLabel: 'OpenCode',
        scope: 'live',
        configPath: targetConfigPath,
      }],
    };
    const baseAgent = representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!;
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      agents: [
        ...(representativeInventorySnapshot.agents ?? []),
        {
          ...baseAgent,
          id: targetAgentId,
          family: 'opencode',
          label: 'OpenCode',
          scope: 'live',
          writable: true,
          installState: 'installed',
          mcpParserKind: 'jsonc-opencode-mcp',
          mcpConfigLocation: {
            state: 'available',
            path: targetConfigPath,
            displayPath: '~/.config/opencode/opencode.json',
            exists: true,
          },
        },
      ],
    };
    const localAgentIndex = new Map((snapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, localAgentIndex);

    expect(getMcpResolveActionState(mcp, model, snapshot)).toEqual({
      disabledReason: null,
      request: {
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/mcp.json',
      },
    });
  });

  it('allows MCP repairs for every backend-writable parser kind exposed by installed agents', () => {
    const supportedParserKinds: AgentMcpParserKind[] = [
      'json-servers',
      'json-mcpServers',
      'json-mcp',
      'jsonc-mcpServers',
      'jsonc-mcp',
      'jsonc-dotted-amp-mcpServers',
      'jsonc-dotted-zencoder-mcpServers',
      'jsonc-mcp-servers',
      'jsonc-opencode-mcp',
      'toml',
      'toml-mcpServers-array',
    ];
    const baseMcp = findRepresentativeMcp('missing-from-agents-mcp');
    const [sourceLocation] = baseMcp.locations;
    const baseAgent = representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!;

    for (const parserKind of supportedParserKinds) {
      const targetAgentId = `target-${parserKind}`;
      const targetConfigPath = `/Users/tester/${parserKind}/mcp-config`;
      const mcp: McpRecord = {
        ...baseMcp,
        locations: [sourceLocation],
        missingLocations: [{
          agentId: targetAgentId,
          agentLabel: parserKind,
          scope: 'live',
          configPath: targetConfigPath,
        }],
      };
      const snapshot: SkillInventorySnapshot = {
        ...representativeInventorySnapshot,
        agents: [
          ...(representativeInventorySnapshot.agents ?? []),
          {
            ...baseAgent,
            id: targetAgentId,
            label: parserKind,
            scope: 'live',
            writable: true,
            installState: 'installed',
            mcpParserKind: parserKind,
            mcpConfigLocation: {
              state: 'available',
              path: targetConfigPath,
              displayPath: targetConfigPath,
              exists: true,
            },
          },
        ],
      };
      const localAgentIndex = new Map((snapshot.agents ?? []).map((agent) => [agent.id, agent]));
      const model = buildMcpInspectorModel(mcp, {
        selectedProblemKey: 'missing-from-agents',
        selectedVariantPath: null,
      }, localAgentIndex);

      expect(getMcpResolveActionState(mcp, model, snapshot), parserKind).toMatchObject({
        disabledReason: null,
        request: {
          entity: 'mcp',
          issue: 'missing-from-agents',
          mcpName: 'missing-from-agents-mcp',
        },
      });
    }
  });

  it('keeps MCP repairs disabled for installed agents with unsupported parser kinds', () => {
    const baseMcp = findRepresentativeMcp('missing-from-agents-mcp');
    const [sourceLocation] = baseMcp.locations;
    const baseAgent = representativeInventorySnapshot.agents!.find((agent) => agent.id === 'sandbox-codex')!;
    const targetAgentId = 'target-yaml';
    const mcp: McpRecord = {
      ...baseMcp,
      locations: [sourceLocation],
      missingLocations: [{
        agentId: targetAgentId,
        agentLabel: 'YAML Agent',
        scope: 'live',
        configPath: '/Users/tester/yaml/mcp.yaml',
      }],
    };
    const snapshot: SkillInventorySnapshot = {
      ...representativeInventorySnapshot,
      agents: [
        ...(representativeInventorySnapshot.agents ?? []),
        {
          ...baseAgent,
          id: targetAgentId,
          label: 'YAML Agent',
          scope: 'live',
          writable: true,
          installState: 'installed',
          mcpParserKind: 'yaml',
          mcpConfigLocation: {
            state: 'available',
            path: '/Users/tester/yaml/mcp.yaml',
            displayPath: '/Users/tester/yaml/mcp.yaml',
            exists: true,
          },
        },
      ],
    };
    const localAgentIndex = new Map((snapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, localAgentIndex);

    expect(getMcpResolveActionState(mcp, model, snapshot)).toEqual({
      disabledReason: 'This MCP can only be resolved when every target config is writable and uses a supported format.',
      request: null,
    });
  });
});
