import type { AgentRecord, SkillRecord, SkillScanSource } from '@shared/contracts';

import { describe, expect, it } from 'vitest';

import { representativeInventorySnapshot } from '../representative-preview-data';
import {
  DETAIL_DIFF_TITLE,
  buildMcpInspectorModel,
  buildSkillInspectorModel,
  type InspectorActiveProblemModel,
  type StructuralRepairProblemModel,
  type VariantResolutionProblemModel,
} from './detail-inspector-model';

const sourceIndex = new Map(representativeInventorySnapshot.sources.map((source) => [source.id, source]));
const agentIndex = new Map((representativeInventorySnapshot.agents ?? []).map((agent) => [agent.id, agent]));
const packagePath = (value: string) => value.replace(/\.md$/, '');
type RepresentativeMcp = NonNullable<typeof representativeInventorySnapshot.mcps>[number];

function arrayContaining(values: Parameters<typeof expect.arrayContaining>[0]): unknown {
  return expect.arrayContaining(values);
}

function objectContaining(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}

function stringContaining(value: string): unknown {
  return expect.stringContaining(value);
}

function findRepresentativeSkill(name: string): SkillRecord {
  const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === name);
  if (!skill) {
    throw new Error(`Missing representative skill fixture: ${name}`);
  }
  return skill;
}

function findRepresentativeMcp(name: string): RepresentativeMcp {
  const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === name);
  if (!mcp) {
    throw new Error(`Missing representative MCP fixture: ${name}`);
  }
  return mcp;
}

function expectFirstTwoLocations(skill: SkillRecord): [SkillRecord['locations'][number], SkillRecord['locations'][number]] {
  const [firstLocation, secondLocation] = skill.locations;
  expect(firstLocation).toBeDefined();
  expect(secondLocation).toBeDefined();
  return [firstLocation, secondLocation];
}

describe('buildSkillInspectorModel', () => {
  it('builds definition files for a healthy skill without needing an active problem', () => {
    const healthyPath = packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md');
    const skill = withPackageFiles(findRepresentativeSkill('healthy-skill'), {
      [healthyPath]: {
        'SKILL.md': [
          '---',
          'name: healthy-skill',
          'description: Healthy across every installed location.',
          '---',
          '# Healthy skill',
          'The canonical definition is visible even when nothing needs repair.',
        ].join('\n'),
        'references/notes.md': 'Supplemental healthy skill notes.\n',
      },
    });

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: null,
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problems).toEqual([]);
    expect(model.definition.listTitle).toBe('Detected Versions');
    expect(model.definition.selectedVariantPath).toBe(healthyPath);
    expect(model.definition.variants.map((variant) => variant.path)).toEqual([healthyPath]);
    expect(model.definition.variants[0]?.isBaseline).toBe(true);
    expect(model.definition.files).toEqual([
      expect.objectContaining({
        relativePath: 'SKILL.md',
        absolutePath: `${healthyPath}/SKILL.md`,
        kind: 'text',
        text: stringContaining('The canonical definition is visible even when nothing needs repair.'),
      }),
      expect.objectContaining({
        relativePath: 'references/notes.md',
        absolutePath: `${healthyPath}/references/notes.md`,
        kind: 'text',
        text: 'Supplemental healthy skill notes.\n',
      }),
    ]);
  });

  it('builds definition files from the resolved target for a readable symlink-only skill', () => {
    const linkPath = '/Users/tester/.agents/skills/repo-backed-skill';
    const targetPath = '/Users/tester/repos/arjit-skills/skills/repo-backed-skill';
    const skill: SkillRecord = {
      name: 'repo-backed-skill',
      description: 'Repo-backed skill exposed through a symlink.',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['wrong-symlink-target', 'missing-canonical'],
      locations: [{
        path: linkPath,
        sourceId: 'live-agents',
        sourceLabel: 'Live .agents',
        sourceScope: 'live',
        installKind: 'directory',
        fileType: 'symlink',
        modifiedAt: '2026-05-18T12:00:00.000Z',
        canonical: false,
        resolvedPath: targetPath,
        symlinkTarget: targetPath,
        definitionText: [
          '---',
          'name: repo-backed-skill',
          'description: Repo-backed skill exposed through a symlink.',
          '---',
          '# Repo-backed skill',
        ].join('\n'),
        packageFiles: [{
          relativePath: 'SKILL.md',
          kind: 'text',
          size: 118,
          text: [
            '---',
            'name: repo-backed-skill',
            'description: Repo-backed skill exposed through a symlink.',
            '---',
            '# Repo-backed skill',
          ].join('\n'),
        }],
      }],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };

    const model = buildSkillInspectorModel(skill, new Map(), {
      selectedProblemKey: 'wrong-symlink-target',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.definition.selectedVariantPath).toBe(linkPath);
    expect(model.definition.files).toEqual([
      expect.objectContaining({
        relativePath: 'SKILL.md',
        absolutePath: `${targetPath}/SKILL.md`,
        kind: 'text',
        text: stringContaining('Repo-backed skill exposed through a symlink.'),
      }),
    ]);
  });

  it('keeps .agents first and selected for Diverged Copies when it is the Universal version', () => {
    const codexPath = '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/handoff-notes-with-static';
    const claudePath = '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes-with-static';
    const agentsPath = '/tmp/skillindex/sandbox/.agents/skills/example-workflow-kit:handoff-notes-with-static';
    const skill: SkillRecord = {
      name: 'example-workflow-kit:handoff-notes-with-static',
      displayName: 'handoff-notes-with-static',
      description: 'Codex plugin variant with one writable static install.',
      structuralState: 'diverged-drift',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['diverged-copies'],
      locations: [],
      detailDiagnostics: {
        duplicateCandidates: [
          createDuplicateCandidate(codexPath, 'Codex Plugin example-workflow-kit', 'codex body', {
            modifiedAt: '2026-05-15T04:00:00.000Z',
            provenanceKind: 'plugin',
          }),
          createDuplicateCandidate(claudePath, 'Claude Plugin example-workflow-kit', 'claude body', {
            modifiedAt: '2026-05-15T03:00:00.000Z',
            provenanceKind: 'plugin',
          }),
          createDuplicateCandidate(agentsPath, 'Universal', 'agents body', {
            modifiedAt: '2026-05-15T02:00:00.000Z',
            provenanceKind: 'manual',
          }),
        ],
        installSources: [],
      },
    };

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: null,
    }, agentIndex);
    const activeProblem = expectVariantResolution(model.activeProblem);

    expect(activeProblem.variants.map((variant) => variant.path)).toEqual([
      agentsPath,
      codexPath,
      claudePath,
    ]);
    expect(activeProblem.selectedVariant?.path).toBe(agentsPath);
    expect(activeProblem.baselineVariant?.path).toBe(agentsPath);
    expect(activeProblem.variants.map((variant) => ({ path: variant.path, badge: variant.badge, isBaseline: variant.isBaseline }))).toEqual([
      { path: agentsPath, badge: 'Universal', isBaseline: true },
      { path: codexPath, badge: undefined, isBaseline: false },
      { path: claudePath, badge: undefined, isBaseline: false },
    ]);
  });

  it('lists every read-only plugin location when identical plugin skills share one inventory row', () => {
    const codexPath = '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/idea-shaping';
    const claudePath = '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/idea-shaping';
    const codexSource: SkillScanSource = {
      id: 'plugin:sandbox:codex:example-workflow-kit@sandbox-curated:5.1.0',
      label: 'Codex Plugin example-workflow-kit',
      canonical: true,
      kind: 'plugin',
      writable: false,
      scope: 'sandbox',
      skillsDir: '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills',
      plugin: {
        host: 'codex',
        pluginId: 'example-workflow-kit@sandbox-curated',
        pluginName: 'example-workflow-kit',
        version: '5.1.0',
        rootPath: '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0',
        manifestPath: '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/.codex-plugin/plugin.json',
      },
    };
    const claudeSource: SkillScanSource = {
      id: 'plugin:sandbox:claude:example-workflow-kit@sandbox-gallery:5.1.0',
      label: 'Claude Plugin example-workflow-kit',
      canonical: true,
      kind: 'plugin',
      writable: false,
      scope: 'sandbox',
      skillsDir: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills',
      plugin: {
        host: 'claude',
        pluginId: 'example-workflow-kit@sandbox-gallery',
        pluginName: 'example-workflow-kit',
        version: '5.1.0',
        rootPath: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0',
        manifestPath: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/.claude-plugin/plugin.json',
      },
    };
    const contentHash = 'sha256-identical-plugin-skill';
    const locations: SkillRecord['locations'] = [
      {
        path: codexPath,
        entrypointPath: `${codexPath}/SKILL.md`,
        sourceId: codexSource.id,
        sourceLabel: codexSource.label,
        sourceScope: 'sandbox',
        installKind: 'directory',
        fileType: 'real-file',
        modifiedAt: '2026-05-01T12:00:00.000Z',
        canonical: false,
        resolvedPath: codexPath,
        contentHash,
        provenance: {
          kind: 'plugin',
          plugin: {
            host: 'codex',
            pluginId: 'example-workflow-kit@sandbox-curated',
            version: '5.1.0',
          },
          sourcePath: codexPath,
          discoveredAt: '2026-05-01T12:00:00.000Z',
        },
        canonicalRole: 'canonical',
        mutability: 'read-only-managed',
      },
      {
        path: claudePath,
        entrypointPath: `${claudePath}/SKILL.md`,
        sourceId: claudeSource.id,
        sourceLabel: claudeSource.label,
        sourceScope: 'sandbox',
        installKind: 'directory',
        fileType: 'real-file',
        modifiedAt: '2026-05-01T12:00:00.000Z',
        canonical: false,
        resolvedPath: claudePath,
        contentHash,
        provenance: {
          kind: 'plugin',
          plugin: {
            host: 'claude',
            pluginId: 'example-workflow-kit@sandbox-gallery',
            version: '5.1.0',
          },
          sourcePath: claudePath,
          discoveredAt: '2026-05-01T12:00:00.000Z',
        },
        canonicalRole: 'canonical',
        mutability: 'read-only-managed',
      },
    ];
    const skill: SkillRecord = {
      name: 'example-workflow-kit:idea-shaping',
      displayName: 'idea-shaping',
      description: 'Structure product ideas before implementation.',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['missing-symlinks'],
      locations,
      detailDiagnostics: {
        duplicateCandidates: locations.map((location) => ({
          ...location,
          installSource: {
            sourceId: location.sourceId,
            label: location.sourceLabel,
            kind: 'plugin',
            scope: 'sandbox',
            writable: false,
            canonical: true,
          },
        })),
        installSources: locations.map((location) => ({
          sourceId: location.sourceId,
          label: location.sourceLabel,
          kind: 'plugin',
          scope: 'sandbox',
          writable: false,
          canonical: false,
        })),
        missingInstallSources: [],
        definitionIssues: [],
      },
    };

    const model = buildSkillInspectorModel(skill, new Map([
      [codexSource.id, codexSource],
      [claudeSource.id, claudeSource],
      ['sandbox-agents', {
        id: 'sandbox-agents',
        label: 'Sandbox .agents',
        canonical: true,
        kind: 'canonical',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.agents/skills',
      }],
      ['sandbox-codex', {
        id: 'sandbox-codex',
        label: 'Sandbox Codex',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.codex/skills',
      }],
      ['sandbox-cursor', {
        id: 'sandbox-cursor',
        label: 'Sandbox Cursor',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.cursor/skills',
      }],
      ['sandbox-claude', {
        id: 'sandbox-claude',
        label: 'Sandbox Claude',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.claude/skills',
      }],
      ['sandbox-factory', {
        id: 'sandbox-factory',
        label: 'Sandbox Factory',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.factory/skills',
      }],
      ['sandbox-windsurf', {
        id: 'sandbox-windsurf',
        label: 'Sandbox Windsurf',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.codeium/windsurf/skills',
      }],
    ]));

    expect(model.header.metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Locations',
        value: '2 locations',
      }),
    ]));
    expect(model.locations.find((section) => section.id === 'universal')?.rows).toEqual([
      expect.objectContaining({
        label: null,
        path: '/tmp/skillindex/sandbox/.agents/skills/example-workflow-kit:idea-shaping',
        statusLabel: 'Missing Universal',
        tone: 'muted',
      }),
    ]);
    expect(model.locations.find((section) => section.id === 'plugin-paths')?.rows).toEqual([
      expect.objectContaining({
        label: 'Codex Plugin example-workflow-kit',
        path: codexPath,
        tone: 'healthy',
      }),
      expect.objectContaining({
        label: 'Claude Plugin example-workflow-kit',
        path: claudePath,
        tone: 'healthy',
      }),
    ]);
    expect(model.locations.find((section) => section.id === 'installed-paths')).toBeUndefined();
  });

  it('keeps Universal Directory symlink repair status visible', () => {
    const agentsPath = '/tmp/skillindex/sandbox/.agents/skills/wrong-universal-link';
    const wrongTargetPath = '/tmp/skillindex/sandbox/.agents/skills/old-universal-link';
    const agentsSource: SkillScanSource = {
      id: 'sandbox-agents',
      label: 'Sandbox .agents',
      canonical: true,
      kind: 'canonical',
      writable: true,
      scope: 'sandbox',
      skillsDir: '/tmp/skillindex/sandbox/.agents/skills',
    };
    const skill: SkillRecord = {
      name: 'wrong-universal-link',
      description: 'Universal symlink points at an old target.',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['wrong-symlink-target'],
      locations: [{
        path: agentsPath,
        sourceId: agentsSource.id,
        sourceLabel: agentsSource.label,
        sourceScope: 'sandbox',
        installKind: 'directory',
        fileType: 'symlink',
        modifiedAt: '2026-05-15T04:00:00.000Z',
        canonical: true,
        resolvedPath: wrongTargetPath,
        symlinkTarget: wrongTargetPath,
      }],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [{
          sourceId: agentsSource.id,
          label: agentsSource.label,
          kind: agentsSource.kind,
          scope: agentsSource.scope,
          writable: agentsSource.writable,
          canonical: true,
        }],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };

    const model = buildSkillInspectorModel(skill, new Map([[agentsSource.id, agentsSource]]), {
      selectedProblemKey: 'wrong-symlink-target',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.locations.find((section) => section.id === 'universal')?.rows).toEqual([
      expect.objectContaining({
        path: agentsPath,
        statusLabel: 'Wrong Target',
        tone: 'warning',
      }),
    ]);
  });

  it('keeps plugin definition issue status visible in Plugin Paths', () => {
    const pluginSource = buildPluginSource('codex', 'example-workflow-kit@sandbox-curated', 'Codex Plugin example-workflow-kit', '/tmp/skillindex/codex/example-workflow-kit');
    const pluginPath = '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/invalid-plugin-skill';
    const pluginLocation = buildPluginLocation(pluginSource, pluginPath, 'invalid-plugin-skill');
    const skill: SkillRecord = {
      name: 'example-workflow-kit:invalid-plugin-skill',
      displayName: 'invalid-plugin-skill',
      description: 'Plugin skill with invalid front matter.',
      structuralState: 'single-source-noncanonical',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['invalid-definition'],
      locations: [pluginLocation],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [{
          sourceId: pluginSource.id,
          label: pluginSource.label,
          kind: 'plugin',
          scope: 'sandbox',
          writable: false,
          canonical: true,
        }],
        missingInstallSources: [],
        definitionIssues: [{
          type: 'malformed-front-matter',
          path: pluginPath,
          sourceId: pluginSource.id,
          sourceLabel: pluginSource.label,
          sourceScope: 'sandbox',
          installSource: {
            sourceId: pluginSource.id,
            label: pluginSource.label,
            kind: 'plugin',
            scope: 'sandbox',
            writable: false,
            canonical: true,
          },
          detail: 'Front matter is malformed.',
        }],
      },
    };

    const model = buildSkillInspectorModel(skill, new Map([[pluginSource.id, pluginSource]]), {
      selectedProblemKey: 'invalid-definition',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.locations.find((section) => section.id === 'plugin-paths')?.rows).toEqual([
      expect.objectContaining({
        path: pluginPath,
        statusLabel: 'Invalid Definition',
        tone: 'danger',
      }),
    ]);
  });

  it('marks the detail header when any skill location is plugin-backed', () => {
    const pluginSource = buildPluginSource('claude', 'example-workflow-kit@sandbox-gallery', 'Claude Plugin example-workflow-kit', '/tmp/skillindex/claude/example-workflow-kit');
    const pluginPath = '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/mixed-copy';
    const manualPath = '/tmp/skillindex/sandbox/.agents/skills/mixed-copy';
    const pluginLocation = buildPluginLocation(pluginSource, pluginPath, 'plugin-copy');
    delete pluginLocation.mutability;
    const manualLocation: SkillRecord['locations'][number] = {
      ...createDuplicateCandidate(manualPath, 'Sandbox .agents', 'manual body', {
        modifiedAt: '2026-05-15T03:00:00.000Z',
        provenanceKind: 'manual',
      }),
      sourceId: 'sandbox-agents',
      sourceLabel: 'Sandbox .agents',
      canonical: true,
    };
    const skill: SkillRecord = {
      name: 'mixed-copy',
      displayName: 'mixed-copy',
      description: 'Manual skill with a plugin-backed location.',
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['identical-copies'],
      locations: [manualLocation, pluginLocation],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };

    const model = buildSkillInspectorModel(skill, new Map([[pluginSource.id, pluginSource]]), {}, agentIndex);

    expect(model.header.isLocked).toBe(true);
  });

  it('marks accepted plugin alternates in Plugin Paths', () => {
    const pluginSource = buildPluginSource('claude', 'example-workflow-kit@sandbox-gallery', 'Claude Plugin example-workflow-kit', '/tmp/skillindex/claude/example-workflow-kit');
    const pluginPath = '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes-with-static';
    const pluginLocation = buildPluginLocation(pluginSource, pluginPath, 'plugin-handoff-notes-with-static');
    const agentsPath = '/tmp/skillindex/sandbox/.agents/skills/example-workflow-kit:handoff-notes-with-static';
    const agentsCopy = createDuplicateCandidate(agentsPath, 'Sandbox .agents', 'agents body', {
      modifiedAt: '2026-05-15T03:00:00.000Z',
      provenanceKind: 'manual',
    });
    agentsCopy.sourceId = 'sandbox-agents';
    agentsCopy.canonical = true;
    const skill: SkillRecord = {
      name: 'example-workflow-kit:handoff-notes-with-static',
      displayName: 'handoff-notes-with-static',
      description: 'Static copy chosen as Universal with a plugin alternate kept separate.',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['missing-symlinks'],
      locations: [agentsCopy, pluginLocation],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [agentsCopy, pluginLocation].map((location) => ({
          sourceId: location.sourceId,
          label: location.sourceLabel,
          kind: location.provenance?.kind === 'plugin' ? 'plugin' : 'agent',
          scope: 'sandbox',
          writable: location.provenance?.kind !== 'plugin',
          canonical: location.canonical,
        })),
        missingInstallSources: [],
        definitionIssues: [],
        acceptedAlternates: [{
          kind: 'plugin',
          host: 'claude',
          pluginId: 'example-workflow-kit@sandbox-gallery',
          pluginVersion: '1.0.0',
          pluginSkillName: 'handoff-notes-with-static',
          reason: 'kept-separate',
        }],
      },
    };

    const model = buildSkillInspectorModel(skill, new Map([
      [pluginSource.id, pluginSource],
      ['sandbox-agents', {
        id: 'sandbox-agents',
        label: 'Sandbox .agents',
        canonical: true,
        kind: 'canonical',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/tmp/skillindex/sandbox/.agents/skills',
      }],
    ]), {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.locations.find((section) => section.id === 'plugin-paths')?.rows).toEqual([
      expect.objectContaining({
        path: pluginPath,
        statusLabel: 'Accepted Alternate',
        tone: 'healthy',
        action: {
          kind: 'choose-skill-universal-version',
          label: 'Make Universal',
          path: pluginPath,
        },
      }),
    ]);
  });

  it('pluralizes read-only plugin copies in action summaries', () => {
    const pluginSources: SkillScanSource[] = [
      buildPluginSource('codex', 'workflow-kit@sandbox-curated', 'Codex Plugin workflow-kit', '/tmp/skillindex/codex/workflow-kit'),
      buildPluginSource('claude', 'workflow-kit@sandbox-gallery', 'Claude Plugin workflow-kit', '/tmp/skillindex/claude/workflow-kit'),
      buildPluginSource('codex', 'workflow-kit-lab@sandbox-curated', 'Codex Plugin workflow-kit-lab', '/tmp/skillindex/codex/workflow-kit-lab'),
    ];
    const locations = pluginSources.map((source, index) =>
      buildPluginLocation(source, `/tmp/skillindex/plugin-${index}/skills/plural-copy`, `hash-${index}`));
    const skill: SkillRecord = {
      name: 'workflow-kit:plural-copy',
      displayName: 'plural-copy',
      description: 'Three immutable plugin copies differ.',
      structuralState: 'diverged-drift',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['diverged-copies'],
      locations,
      detailDiagnostics: {
        duplicateCandidates: locations.map((location) => ({
          ...location,
          installSource: {
            sourceId: location.sourceId,
            label: location.sourceLabel,
            kind: 'plugin',
            scope: 'sandbox',
            writable: false,
            canonical: true,
          },
        })),
        installSources: locations.map((location) => ({
          sourceId: location.sourceId,
          label: location.sourceLabel,
          kind: 'plugin',
          scope: 'sandbox',
          writable: false,
          canonical: true,
        })),
        missingInstallSources: [],
        definitionIssues: [],
      },
    };
    const model = buildSkillInspectorModel(
      skill,
      new Map(pluginSources.map((source) => [source.id, source])),
      {
        selectedProblemKey: 'diverged-copies',
        selectedVariantPath: locations[0]?.path,
      },
      agentIndex,
    );

    expect(expectVariantResolution(model.activeProblem).actionSummary).toBe('This will keep 2 read-only plugin copies separate.');
  });

  it('describes plugin Universal repairs as symlink operations instead of generic writable updates', () => {
    const codexSource = buildPluginSource('codex', 'example-workflow-kit@sandbox-curated', 'Codex Plugin example-workflow-kit', '/tmp/skillindex/codex/example-workflow-kit');
    const claudeSource = buildPluginSource('claude', 'example-workflow-kit@sandbox-gallery', 'Claude Plugin example-workflow-kit', '/tmp/skillindex/claude/example-workflow-kit');
    const agentsPath = '/tmp/skillindex/sandbox/.agents/skills/example-workflow-kit:handoff-notes-with-two-statics';
    const factoryPath = '/tmp/skillindex/sandbox/.factory/skills/example-workflow-kit:handoff-notes-with-two-statics';
    const codexPluginPath = '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/handoff-notes-with-two-statics';
    const claudePluginPath = '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes-with-two-statics';
    const writableSourceIndex = new Map([
      ...sourceIndex,
      [codexSource.id, codexSource],
      [claudeSource.id, claudeSource],
      ['sandbox-agents', {
        id: 'sandbox-agents',
        label: 'Sandbox .agents',
        canonical: true,
        kind: 'agent' as const,
        writable: true,
        scope: 'sandbox' as const,
        skillsDir: '/tmp/skillindex/sandbox/.agents/skills',
      }],
      ['sandbox-factory', {
        id: 'sandbox-factory',
        label: 'Sandbox Factory',
        canonical: false,
        kind: 'agent' as const,
        writable: true,
        scope: 'sandbox' as const,
        skillsDir: '/tmp/skillindex/sandbox/.factory/skills',
      }],
    ]);
    const codexPlugin = buildPluginLocation(codexSource, codexPluginPath, 'codex-plugin');
    const claudePlugin = buildPluginLocation(claudeSource, claudePluginPath, 'claude-plugin');
    const agentsCopy = createDuplicateCandidate(agentsPath, 'Sandbox .agents', 'agents body', {
      modifiedAt: '2026-05-15T03:00:00.000Z',
      provenanceKind: 'manual',
    });
    const factoryCopy = createDuplicateCandidate(factoryPath, 'Sandbox Factory', 'factory body', {
      modifiedAt: '2026-05-15T02:00:00.000Z',
      provenanceKind: 'manual',
    });
    agentsCopy.sourceId = 'sandbox-agents';
    agentsCopy.canonical = true;
    factoryCopy.sourceId = 'sandbox-factory';
    const skill: SkillRecord = {
      name: 'example-workflow-kit:handoff-notes-with-two-statics',
      displayName: 'handoff-notes-with-two-statics',
      description: 'Codex plugin variant with two writable static installs.',
      structuralState: 'diverged-drift',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['diverged-copies', 'missing-symlinks'],
      locations: [agentsCopy, codexPlugin, claudePlugin, factoryCopy],
      detailDiagnostics: {
        duplicateCandidates: [agentsCopy, codexPlugin, claudePlugin, factoryCopy].map((location) => ({
          ...location,
          installSource: {
            sourceId: location.sourceId,
            label: location.sourceLabel,
            kind: location.provenance?.kind === 'plugin' ? 'plugin' : 'agent',
            scope: 'sandbox',
            writable: location.provenance?.kind !== 'plugin',
            canonical: location.canonical,
          },
        })),
        installSources: [agentsCopy, codexPlugin, claudePlugin, factoryCopy].map((location) => ({
          sourceId: location.sourceId,
          label: location.sourceLabel,
          kind: location.provenance?.kind === 'plugin' ? 'plugin' : 'agent',
          scope: 'sandbox',
          writable: location.provenance?.kind !== 'plugin',
          canonical: location.canonical,
        })),
        missingInstallSources: [
          {
            sourceId: 'sandbox-claude',
            label: 'Sandbox Claude',
            kind: 'agent',
            scope: 'sandbox',
            writable: true,
            canonical: false,
          },
          {
            sourceId: 'sandbox-windsurf',
            label: 'Sandbox Windsurf',
            kind: 'agent',
            scope: 'sandbox',
            writable: true,
            canonical: false,
          },
        ],
      },
    };

    const model = buildSkillInspectorModel(skill, writableSourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: codexPluginPath,
    }, agentIndex);

    expect(expectVariantResolution(model.activeProblem).actionSummary).toBe(
      'This will replace 2 writable copies with symlinks and keep 1 read-only plugin copy separate.',
    );
    expect(model.locations.map((section) => section.id)).toEqual(['universal', 'plugin-paths', 'installed-paths']);
    expect(model.locations.find((section) => section.id === 'universal')?.rows).toEqual([
      expect.objectContaining({
        label: null,
        path: agentsPath,
        tone: 'healthy',
      }),
    ]);
    expect(model.locations.find((section) => section.id === 'plugin-paths')?.rows).toEqual([
      expect.objectContaining({
        label: 'Codex Plugin example-workflow-kit',
        path: codexPluginPath,
        statusLabel: 'Diverged Copy',
        tone: 'warning',
      }),
      expect.objectContaining({
        label: 'Claude Plugin example-workflow-kit',
        path: claudePluginPath,
        statusLabel: 'Diverged Copy',
        tone: 'warning',
      }),
    ]);
    const installedRows = model.locations.find((section) => section.id === 'installed-paths')?.rows ?? [];
    expect(installedRows.map((row) => row.label)).toEqual(['Claude Code', 'Claude Desktop', 'Factory', 'Windsurf']);
    expect(installedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Factory',
        path: factoryPath,
        statusLabel: 'Diverged Copy',
        tone: 'warning',
      }),
      expect.objectContaining({
        label: 'Claude Code',
        path: null,
        pathText: 'not installed',
        statusLabel: 'Not installed',
        tone: 'muted',
      }),
      expect.objectContaining({
        label: 'Claude Desktop',
        path: null,
        pathText: 'Local files not supported',
        tone: 'muted',
      }),
      expect.objectContaining({
        label: 'Windsurf',
        path: null,
        pathText: 'not installed',
        statusLabel: 'Not installed',
        tone: 'muted',
      }),
    ]));
    expect(installedRows.map((row) => row.label)).not.toEqual(expect.arrayContaining(['Universal', 'Codex', 'Cursor']));
  });

  it('builds a multi-problem inspector with a selected diverged variant', () => {
    const skill = withDefinitionText(
      findRepresentativeSkill('diagnostic-rich-skill'),
      {
        [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: [
          '---',
          'name: diagnostic-rich-skill',
          'description: Canonical detail candidate.',
          '---',
          '# Diagnostic rich skill',
          'Canonical content.',
        ].join('\n'),
        [packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')]: [
          '---',
          'name: diagnostic-rich-skill',
          'description: Claude detail candidate.',
          '---',
          '# Diagnostic rich skill',
          'Claude copy with its own description.',
        ].join('\n'),
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: [
          '---',
          'description: Factory copy with a description but missing a name field.',
          '---',
          '# Diagnostic rich skill',
          'Factory copy missing the required name.',
        ].join('\n'),
      },
    );

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
    }, agentIndex);

    expect(model.problemCountLabel).toBe('2 problems');
    expect(model.problems.map((problem) => problem.key)).toEqual(['diverged-copies', 'invalid-definition']);
    expect(model.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'invalid-definition',
        detail: 'One or more issues with front matter',
      }),
    ]));
    expect(model.problemSections.map((section) => section.title)).toEqual(['Variant resolution', 'Structural repair']);
    expect(model.header.metadata).toEqual([
      expect.objectContaining({
        label: 'Selected version',
        value: 'Sandbox Claude',
        path: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
      }),
      expect.objectContaining({
        label: 'Universal',
        value: 'Sandbox .agents',
        path: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
      }),
      expect.objectContaining({
        label: 'Locations',
        value: '3 locations',
      }),
    ]);
    expect(model.selectedVariantPath).toBe(packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'));
    expect(model.provenanceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Selected version',
        sourceLabel: 'Sandbox Claude',
        path: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
        isSelected: true,
        isCanonical: false,
      }),
      expect.objectContaining({
        label: 'Universal',
        sourceLabel: 'Sandbox .agents',
        path: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
        isSelected: false,
        isCanonical: true,
      }),
    ]));
    expect(model.locations).toEqual([
      expect.objectContaining({
        id: 'universal',
        title: 'Universal Directory',
        rows: [
          expect.objectContaining({
            path: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
            tone: 'healthy',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'installed-paths',
        title: 'Installed Paths',
        rows: arrayContaining([
          objectContaining({
            label: 'Claude Code',
            path: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
            tone: 'healthy',
          }),
          objectContaining({
            label: 'Factory',
            path: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
            statusLabel: 'Invalid Definition',
            tone: 'danger',
          }),
        ]),
      }),
    ]);
    const activeProblem = expectVariantResolution(model.activeProblem);

    expect(activeProblem.selectedVariant?.path).toBe(packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'));
    expect(activeProblem.baselineVariant?.path).toBe(packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'));
    expect(activeProblem.variants.map((variant) => variant.path)).toEqual([
      packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
      packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
      packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
    ]);
    expect(activeProblem.diffTitle).toBe(DETAIL_DIFF_TITLE);
    expect(activeProblem.changedFiles[0]).toEqual(expect.objectContaining({
      path: 'SKILL.md',
      absolutePath: `${packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')}/SKILL.md`,
    }));
    expect(activeProblem.diffPath).toBe(`${packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')}/SKILL.md`);
    expect(activeProblem.diffLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', text: 'description: Canonical detail candidate.' }),
        expect.objectContaining({ type: 'added', text: 'description: Claude detail candidate.' }),
      ]),
    );
  });

  it('keeps diverged skill variant ordering stable when selection changes', () => {
    const skill = withDefinitionText(
      findRepresentativeSkill('diagnostic-rich-skill'),
      {
        [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: 'canonical',
        [packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')]: 'claude',
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: 'factory',
      },
    );

    const canonicalSelected = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
    }, agentIndex);
    const factorySelected = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
    }, agentIndex);

    expect(expectVariantResolution(canonicalSelected.activeProblem).variants.map((variant) => variant.path)).toEqual([
      packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
      packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
      packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
    ]);
    expect(expectVariantResolution(factorySelected.activeProblem).variants.map((variant) => variant.path)).toEqual([
      packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
      packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
      packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
    ]);
  });

  it('shows the shared .agents path and preferred repo location when a preferred repo is canonical', () => {
    const skill: SkillRecord = {
      name: 'repo-backed-skill',
      description: 'Preferred repo backed skill.',
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      issueReasons: [],
      locations: [
        {
          path: '/Users/tester/repos/arjit-skills/skills/repo-backed-skill',
          sourceId: 'preferred-canonical:/Users/tester/repos/arjit-skills/skills',
          sourceLabel: 'Preferred canonical /Users/tester/repos/arjit-skills/skills',
          sourceScope: 'live',
          installKind: 'directory',
          fileType: 'real-file',
          modifiedAt: '2026-04-09T00:00:00.000Z',
          canonical: true,
        },
        {
          path: '/Users/tester/.agents/skills/repo-backed-skill',
          sourceId: 'live-agents',
          sourceLabel: 'Live .agents',
          sourceScope: 'live',
          installKind: 'directory',
          fileType: 'symlink',
          modifiedAt: '2026-04-09T00:00:00.000Z',
          canonical: false,
          resolvedPath: '/Users/tester/repos/arjit-skills/skills/repo-backed-skill',
          symlinkTarget: '/Users/tester/repos/arjit-skills/skills/repo-backed-skill',
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [
          {
            sourceId: 'preferred-canonical:/Users/tester/repos/arjit-skills/skills',
            label: 'Preferred canonical /Users/tester/repos/arjit-skills/skills',
            kind: 'custom',
            scope: 'live',
            writable: true,
            canonical: true,
          },
          {
            sourceId: 'live-agents',
            label: 'Live .agents',
            kind: 'canonical',
            scope: 'live',
            writable: true,
            canonical: false,
          },
        ],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };
    const preferredSource: SkillScanSource = {
      id: 'preferred-canonical:/Users/tester/repos/arjit-skills/skills',
      label: 'Preferred canonical /Users/tester/repos/arjit-skills/skills',
      canonical: false,
      kind: 'custom',
      writable: true,
      scope: 'live',
      skillsDir: '/Users/tester/repos/arjit-skills/skills',
      preferredCanonical: true,
      compatibleAgentFamilies: [],
    };
    const agentsSource: SkillScanSource = {
      id: 'live-agents',
      label: 'Live .agents',
      canonical: true,
      kind: 'canonical',
      writable: true,
      scope: 'live',
      skillsDir: '/Users/tester/.agents/skills',
      preferredCanonical: false,
      compatibleAgentFamilies: [],
    };

    const model = buildSkillInspectorModel(
      skill,
      new Map([
        [preferredSource.id, preferredSource],
        [agentsSource.id, agentsSource],
      ]),
    );

    expect(model.locations.find((section) => section.id === 'universal')?.rows).toEqual([
      expect.objectContaining({
        label: 'Preferred canonical',
        path: '/Users/tester/repos/arjit-skills/skills/repo-backed-skill',
        tone: 'healthy',
      }),
      expect.objectContaining({
        label: '.agents',
        path: '/Users/tester/.agents/skills/repo-backed-skill',
        statusLabel: 'symlink',
        tone: 'healthy',
      }),
    ]);
    expect(model.locations.find((section) => section.id === 'installed-paths')).toBeUndefined();
  });

  it('shows non-preferred custom scan path locations in the Locations tab', () => {
    const customPath = '/Users/tester/repos/arjit-skills/frontend-design';
    const skill: SkillRecord = {
      name: 'frontend-design',
      description: 'Custom scanned skill.',
      structuralState: 'single-source-noncanonical',
      isDrifted: true,
      driftPresentation: 'active',
      issueReasons: ['missing-canonical'],
      locations: [
        {
          path: customPath,
          sourceId: 'custom:/Users/tester/repos/arjit-skills',
          sourceLabel: 'Custom /Users/tester/repos/arjit-skills',
          sourceScope: 'custom',
          installKind: 'directory',
          fileType: 'real-file',
          modifiedAt: '2026-04-09T00:00:00.000Z',
          canonical: false,
        },
      ],
      detailDiagnostics: {
        duplicateCandidates: [],
        installSources: [
          {
            sourceId: 'custom:/Users/tester/repos/arjit-skills',
            label: 'Custom /Users/tester/repos/arjit-skills',
            kind: 'custom',
            scope: 'custom',
            writable: false,
            canonical: false,
          },
        ],
        missingInstallSources: [],
        definitionIssues: [],
      },
    };
    const customSource: SkillScanSource = {
      id: 'custom:/Users/tester/repos/arjit-skills',
      label: 'Custom /Users/tester/repos/arjit-skills',
      canonical: false,
      kind: 'custom',
      writable: false,
      scope: 'custom',
      skillsDir: '/Users/tester/repos/arjit-skills',
      preferredCanonical: false,
      compatibleAgentFamilies: [],
    };

    const model = buildSkillInspectorModel(skill, new Map([[customSource.id, customSource]]));

    expect(model.locations.find((section) => section.id === 'installed-paths')?.rows).toEqual([
      expect.objectContaining({
        label: 'Custom /Users/tester/repos/arjit-skills',
        path: customPath,
        tone: 'healthy',
      }),
    ]);
  });

  it('keeps a stable changed-file superset visible across diverged variant switches and pins SKILL.md first', () => {
    const skill = withPackageFiles(
      findRepresentativeSkill('diagnostic-rich-skill'),
      {
        [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: {
          'SKILL.md': [
            '---',
            'name: diagnostic-rich-skill',
            'description: Canonical detail candidate.',
            '---',
            '# Diagnostic rich skill',
            'Canonical content.',
          ].join('\n'),
          'rules/shared.md': '# Shared\nsame\n',
          'scripts/check.py': 'print("canonical")\n',
        },
        [packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')]: {
          'SKILL.md': [
            '---',
            'name: diagnostic-rich-skill',
            'description: Claude detail candidate.',
            '---',
            '# Diagnostic rich skill',
            'Claude content.',
          ].join('\n'),
          'rules/shared.md': '# Shared\nsame\n',
          'scripts/check.py': 'print("claude override")\n',
        },
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: {
          'SKILL.md': [
            '---',
            'name: diagnostic-rich-skill',
            'description: Canonical detail candidate.',
            '---',
            '# Diagnostic rich skill',
            'Canonical content.',
          ].join('\n'),
          'rules/shared.md': '# Shared\nfactory override\n',
          'scripts/check.py': 'print("canonical")\n',
        },
      },
    );

    const canonicalSelected = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
    }, agentIndex);
    const claudeSelected = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
    }, agentIndex);

    const canonicalProblem = expectVariantResolution(canonicalSelected.activeProblem);
    const claudeProblem = expectVariantResolution(claudeSelected.activeProblem);

    expect(canonicalProblem.changedFiles.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/check.py',
      'rules/shared.md',
    ]);
    expect(claudeProblem.changedFiles.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/check.py',
      'rules/shared.md',
    ]);
    expect(canonicalProblem.changedFiles.map((file) => file.diffLines.length)).toEqual([6, 2, 3]);
    expect(canonicalProblem.changedFiles.find((file) => file.path === 'SKILL.md')?.diffLines).toEqual([
      { type: 'context', text: '---' },
      { type: 'context', text: 'name: diagnostic-rich-skill' },
      { type: 'context', text: 'description: Canonical detail candidate.' },
      { type: 'context', text: '---' },
      { type: 'context', text: '# Diagnostic rich skill' },
      { type: 'context', text: 'Canonical content.' },
    ]);
    expect(canonicalProblem.changedFiles.find((file) => file.path === 'scripts/check.py')?.diffLines).toEqual([
      { type: 'context', text: 'print("canonical")' },
      { type: 'context', text: '' },
    ]);
    expect(canonicalProblem.changedFiles.find((file) => file.path === 'rules/shared.md')?.diffLines).toEqual([
      { type: 'context', text: '# Shared' },
      { type: 'context', text: 'same' },
      { type: 'context', text: '' },
    ]);
    expect(claudeProblem.changedFiles.find((file) => file.path === 'SKILL.md')?.diffLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', text: 'description: Canonical detail candidate.' }),
        expect.objectContaining({ type: 'added', text: 'description: Claude detail candidate.' }),
      ]),
    );
    expect(claudeProblem.changedFiles.find((file) => file.path === 'rules/shared.md')?.diffLines).toEqual([
      { type: 'context', text: '# Shared' },
      { type: 'context', text: 'same' },
      { type: 'context', text: '' },
    ]);
  });

  it('builds a structural identical-copies problem without diff state', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'identical-drift-skill')!;

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'identical-copies',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problemCountLabel).toBe('1 problem');
    expect(model.problemSections.map((section) => section.title)).toEqual(['Variant resolution', 'Structural repair']);
    expect(model.problems).toEqual([
      expect.objectContaining({
        key: 'identical-copies',
        summary: '1 copy',
        detail: 'Convert copies to symlinks',
      }),
    ]);
    const activeProblem = expectStructuralRepair(model.activeProblem);

    expect(activeProblem.title).toBe('Identical Copies');
    expect(activeProblem.listTitle).toBe('Matching Copies');
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'Factory',
        path: packagePath('~/.skillindex/sandbox/.factory/skills/identical-drift-skill.md'),
      }),
    ]);
    expect(activeProblem.primaryActionLabel).toBe('Convert Copies to Symlinks');
    expect(activeProblem.actionSummary).toBe('This will replace 1 writable copy with a symlink to the Universal version.');
  });

  it('builds a structural missing-symlinks problem from representative fixtures', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill')!;

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problemCountLabel).toBe('1 problem');
    expect(model.problemSections.map((section) => section.title)).toEqual(['Variant resolution', 'Structural repair']);
    expect(model.problems).toEqual([
      expect.objectContaining({
        key: 'missing-symlinks',
        summary: '1 issue',
        detail: 'One or more symlinks are missing',
      }),
    ]);
    const activeProblem = expectStructuralRepair(model.activeProblem);

    expect(activeProblem.title).toBe('Missing Symlinks');
    expect(activeProblem.listTitle).toBe('Missing Symlinks');
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'Factory',
        path: packagePath('~/.skillindex/sandbox/.factory/skills/missing-symlink-skill.md'),
      }),
    ]);
    expect(model.locations.find((section) => section.id === 'installed-paths')?.rows).toEqual(
      arrayContaining([
        objectContaining({
          label: 'Claude Desktop',
          path: null,
          pathText: 'Local files not supported',
          tone: 'muted',
        }),
      ]),
    );
    expect(activeProblem.primaryActionLabel).toBe('Create Missing Symlinks');
  });

  it('pluralizes missing-symlinks summaries for multiple affected installs', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill')!;
    const skill = {
      ...baseSkill,
      detailDiagnostics: {
        ...baseSkill.detailDiagnostics,
        missingInstallSources: [
          ...(baseSkill.detailDiagnostics.missingInstallSources ?? []),
          {
            sourceId: 'sandbox-windsurf',
            label: 'Sandbox Windsurf',
            kind: 'agent' as const,
            scope: 'sandbox' as const,
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

    expect(model.problems).toEqual([
      expect.objectContaining({
        key: 'missing-symlinks',
        summary: '2 issues',
        detail: 'One or more symlinks are missing',
      }),
    ]);
  });

  it('falls back to the agent registry for missing-symlink paths when a source is not installed', () => {
    const skill = {
      ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill')!,
      detailDiagnostics: {
        ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill')!.detailDiagnostics,
        missingInstallSources: [
          {
            sourceId: 'sandbox-windsurf',
            label: 'Sandbox Windsurf',
            kind: 'agent' as const,
            scope: 'sandbox' as const,
            writable: true,
            canonical: false,
          },
        ],
      },
    };
    const sourceIndexWithoutWindsurf = new Map(
      representativeInventorySnapshot.sources
        .filter((source) => source.id !== 'sandbox-windsurf')
        .map((source) => [source.id, source]),
    );

    const model = buildSkillInspectorModel(skill, sourceIndexWithoutWindsurf, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items).toEqual([
      objectContaining({
        label: 'Windsurf',
        path: stringContaining('.codeium/windsurf/skills/missing-symlink-skill'),
      }),
    ]);
  });

  it('uses the agent registry label for live config-backed install sources', () => {
    const baseSkill = findRepresentativeSkill('missing-symlink-skill');
    const skill = {
      ...baseSkill,
      detailDiagnostics: {
        ...baseSkill.detailDiagnostics,
        missingInstallSources: [
          {
            sourceId: 'live-config-opencode',
            label: 'Live .config/opencode',
            kind: 'agent' as const,
            scope: 'live' as const,
            writable: true,
            canonical: false,
          },
        ],
      },
    };
    const liveSourceIndex = new Map(sourceIndex);
    liveSourceIndex.set('live-config-opencode', {
      id: 'live-config-opencode',
      label: 'Live .config/opencode',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'live',
      skillsDir: '/Users/tester/.config/opencode/skills',
      compatibleAgentFamilies: ['opencode'],
    });
    const liveAgentIndex = new Map(agentIndex);
    const representativeAgent = representativeInventorySnapshot.agents?.[0];
    if (!representativeAgent) {
      throw new Error('Missing representative agent fixture.');
    }
    liveAgentIndex.set('live-opencode', {
      ...representativeAgent,
      id: 'live-opencode',
      family: 'opencode',
      label: 'OpenCode',
      scope: 'live',
      writable: true,
      installState: 'installed',
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.config/opencode/skills',
      defaultHomeDir: '~/.agents',
      skillsLocation: {
        state: 'available',
        path: '/Users/tester/.config/opencode/skills',
        displayPath: '~/.config/opencode/skills',
        exists: true,
      },
    });

    const model = buildSkillInspectorModel(skill, liveSourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, liveAgentIndex);

    expect(model.locations.find((section) => section.id === 'installed-paths')?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'OpenCode',
          path: null,
          pathText: 'not installed',
        }),
      ]),
    );

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'OpenCode',
        path: '/Users/tester/.config/opencode/skills/missing-symlink-skill',
      }),
    ]);
  });

  it('uses the only installed compatible agent label for shared install sources', () => {
    const baseSkill = findRepresentativeSkill('missing-symlink-skill');
    const skill = {
      ...baseSkill,
      detailDiagnostics: {
        ...baseSkill.detailDiagnostics,
        missingInstallSources: [
          {
            sourceId: 'live-config-agents',
            label: 'Live .config/agents',
            kind: 'agent' as const,
            scope: 'live' as const,
            writable: true,
            canonical: false,
          },
        ],
      },
    };
    const liveSourceIndex = new Map(sourceIndex);
    liveSourceIndex.set('live-config-agents', {
      id: 'live-config-agents',
      label: 'Live .config/agents',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'live',
      skillsDir: '/Users/tester/.config/agents/skills',
      compatibleAgentFamilies: ['amp', 'kimi-cli', 'replit'],
    });
    const representativeAgent = representativeInventorySnapshot.agents?.[0];
    if (!representativeAgent) {
      throw new Error('Missing representative agent fixture.');
    }
    const liveAgentIndex = new Map(agentIndex);
    liveAgentIndex.set('live-amp', {
      ...representativeAgent,
      id: 'live-amp',
      family: 'amp',
      label: 'Amp',
      scope: 'live',
      writable: true,
      installState: 'installed',
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.config/agents/skills',
      defaultHomeDir: '~/.config/agents',
      skillsLocation: {
        state: 'available',
        path: '/Users/tester/.config/agents/skills',
        displayPath: '~/.config/agents/skills',
        exists: true,
      },
    });
    liveAgentIndex.set('live-kimi-cli', {
      ...representativeAgent,
      id: 'live-kimi-cli',
      family: 'kimi-cli',
      label: 'Kimi Code CLI',
      scope: 'live',
      writable: true,
      installState: 'not-installed',
      defaultProjectSkillsDir: '.agents/skills',
      defaultGlobalSkillsDir: '~/.config/agents/skills',
      defaultHomeDir: '~/.config/agents',
      skillsLocation: {
        state: 'available',
        path: '/Users/tester/.config/agents/skills',
        displayPath: '~/.config/agents/skills',
        exists: true,
      },
    });

    const model = buildSkillInspectorModel(skill, liveSourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, liveAgentIndex);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'Amp',
        path: '/Users/tester/.config/agents/skills/missing-symlink-skill',
      }),
    ]);
  });

  it('builds a broken-symlink problem using the same compact label and path pattern', () => {
    const baseSkill = findRepresentativeSkill('missing-symlink-skill');
    const [canonicalLocation, claudeLocation] = expectFirstTwoLocations(baseSkill);
    const skill: SkillRecord = {
      ...baseSkill,
      name: 'broken-symlink-skill',
      issueReasons: ['broken-symlink'],
      detailDiagnostics: {
        ...baseSkill.detailDiagnostics,
        missingInstallSources: [],
      },
      locations: [
        canonicalLocation,
        {
          ...claudeLocation,
          path: packagePath('~/.skillindex/sandbox/.claude/skills/broken-symlink-skill.md'),
          resolvedPath: undefined,
          symlinkTarget: undefined,
        },
      ],
    };

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'broken-symlink',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problems).toEqual([
      expect.objectContaining({
        key: 'broken-symlink',
        summary: '1 issue',
        detail: 'One or more symlinks need repair',
      }),
    ]);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.title).toBe('Broken Symlink');
    expect(activeProblem.listTitle).toBe('Broken Symlink');
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'Claude Code',
        path: packagePath('~/.skillindex/sandbox/.claude/skills/broken-symlink-skill.md'),
      }),
    ]);
  });

  it('shows the current wrong symlink target underneath the affected path', () => {
    const baseSkill = findRepresentativeSkill('missing-symlink-skill');
    const [canonicalLocation, claudeLocation] = expectFirstTwoLocations(baseSkill);
    const skill: SkillRecord = {
      ...baseSkill,
      name: 'wrong-symlink-target-skill',
      issueReasons: ['wrong-symlink-target'],
      detailDiagnostics: {
        ...baseSkill.detailDiagnostics,
        missingInstallSources: [],
      },
      locations: [
        canonicalLocation,
        {
          ...claudeLocation,
          path: packagePath('~/.skillindex/sandbox/.claude/skills/wrong-symlink-target-skill.md'),
          resolvedPath: packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md'),
          symlinkTarget: packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md'),
        },
      ],
    };

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'wrong-symlink-target',
      selectedVariantPath: null,
    }, agentIndex);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.title).toBe('Wrong Symlink Target');
    expect(model.problems).toEqual([
      expect.objectContaining({
        key: 'wrong-symlink-target',
        summary: '1 issue',
        detail: 'One or more symlinks point somewhere other than universal',
      }),
    ]);
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'Claude Code',
        path: packagePath('~/.skillindex/sandbox/.claude/skills/wrong-symlink-target-skill.md'),
        detail: packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md'),
      }),
    ]);
    expect(activeProblem.primaryActionLabel).toBe('Repair Symlinks');
  });

  it('does not mark any detected version as universal when a skill is missing the universal copy', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'single-source-skill')!;

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath: null,
    }, agentIndex);
    const activeProblem = expectVariantResolution(model.activeProblem);

    expect(activeProblem.baselineVariant).toBeNull();
    expect(activeProblem.variants).toHaveLength(1);
    expect(activeProblem.variants[0]).toEqual(expect.objectContaining({
      path: packagePath('~/.skillindex/sandbox/.codeium/windsurf/skills/single-source-skill.md'),
      badge: 'Selected Version',
      isBaseline: false,
    }));
    expect(model.problems).toEqual([
      expect.objectContaining({
        key: 'missing-canonical',
        summary: '1 issue',
        detail: 'Choose the version local installs should use as Universal',
      }),
    ]);
    expect(activeProblem.diffLines).toEqual([
      { type: 'context', text: '---' },
      { type: 'context', text: 'name: single-source-skill' },
      { type: 'context', text: 'description: Installed in a single location outside the universal .agents folder.' },
      { type: 'context', text: '---' },
      { type: 'context', text: '# Single source skill' },
      { type: 'context', text: 'Only Windsurf has this copy right now.' },
    ]);
    expect(model.provenanceRows.map((row) => row.label)).not.toContain('Universal');
  });

  it('shows every installed agent location before a missing universal copy exists', () => {
    const skill = findRepresentativeSkill('single-source-skill');

    expect(skill.detailDiagnostics.missingInstallSources).toEqual([]);

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath: null,
    }, agentIndex);

    const installedRows = model.locations.find((section) => section.id === 'installed-paths')?.rows ?? [];
    expect(installedRows.map((row) => row.label)).toEqual([
      'Claude Code',
      'Claude Desktop',
      'Factory',
      'Windsurf',
    ]);
    expect(installedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Windsurf',
        path: packagePath('~/.skillindex/sandbox/.codeium/windsurf/skills/single-source-skill.md'),
        tone: 'healthy',
      }),
      expect.objectContaining({
        label: 'Claude Code',
        path: null,
        pathText: 'not installed',
        statusLabel: 'Not installed',
        tone: 'muted',
      }),
      expect.objectContaining({
        label: 'Factory',
        path: null,
        pathText: 'not installed',
        statusLabel: 'Not installed',
        tone: 'muted',
      }),
      expect.objectContaining({
        label: 'Claude Desktop',
        path: null,
        pathText: 'Local files not supported',
        tone: 'muted',
      }),
    ]));
  });
});

describe('buildMcpInspectorModel', () => {
  it('builds a definition preview for healthy MCPs without needing an active problem', () => {
    const model = buildMcpInspectorModel(findRepresentativeMcp('healthy-mcp'), {}, agentIndex);

    expect(model.header.description).toBeNull();
    expect(model.problems).toEqual([]);
    expect(model.definition.listTitle).toBe('Detected Definitions');
    expect(model.definition.selectedVariantPath).toBe('~/.skillindex/sandbox/.agents/mcp.json');
    expect(model.definition.variants.map((variant) => variant.path)).toEqual([
      '~/.skillindex/sandbox/.agents/mcp.json',
    ]);
    expect(model.definition.variants[0]?.isBaseline).toBe(true);
    expect(model.definition.files).toEqual([
      expect.objectContaining({
        relativePath: model.definition.variants[0]?.label,
        absolutePath: '~/.skillindex/sandbox/.agents/mcp.json',
        displayPath: model.definition.variants[0]?.label,
        openPath: null,
        kind: 'text',
        text: stringContaining('healthy-server.js'),
      }),
    ]);
  });

  it('renders unsupported MCP expected locations without treating them as missing', () => {
    const model = buildMcpInspectorModel({
      name: 'remote-docs',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      locations: [{
        agentId: 'sandbox-codex',
        agentLabel: 'Codex',
        scope: 'sandbox',
        configPath: '~/.skillindex/sandbox/.codex/config.toml',
        transport: 'http',
        url: 'https://example.test/mcp',
        args: [],
        definitionText: JSON.stringify({ url: 'https://example.test/mcp' }, null, 2),
        definitionComparisonKey: '{"transport":"http","url":"https://example.test/mcp"}',
      }],
      expectedLocations: [
        {
          agentId: 'sandbox-codex',
          agentLabel: 'Codex',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/config.toml',
        },
        {
          agentId: 'sandbox-claude-desktop',
          agentLabel: 'Claude Desktop',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/Library/Application Support/Claude/claude_desktop_config.json',
          supportStatus: 'unsupported',
          unsupportedReason: 'remote-mcp-not-supported',
          unsupportedTransport: 'http',
        },
      ],
      missingLocations: [],
    }, {}, agentIndex, sourceIndex);

    expect(model.problems).toEqual([]);
    expect(model.locations.find((section) => section.id === 'universal')?.rows).toEqual([
      objectContaining({
        path: '~/.skillindex/sandbox/.agents/mcp.json',
        pathText: '~/.skillindex/sandbox/.agents/mcp.json',
        statusLabel: 'Missing Universal',
        tone: 'muted',
      }),
    ]);
    expect(model.locations.find((section) => section.id === 'installed-paths')?.rows).toEqual(arrayContaining([
      objectContaining({
        label: 'Claude Desktop',
        path: '~/.skillindex/sandbox/Library/Application Support/Claude/claude_desktop_config.json',
        statusLabel: 'Remote MCPs not supported',
        tone: 'muted',
      }),
    ]));
  });

  it('labels MCP definition variants by normalized version instead of representative config file', () => {
    const mcp: RepresentativeMcp = {
      name: 'blitz-iphone',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch'],
      locations: [
        {
          agentId: 'sandbox-augment',
          agentLabel: 'Augment',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.augment/settings.json',
          transport: 'stdio',
          command: '/Users/tester/.blitz/iphone-mcp',
          args: ['--mode', 'simulator'],
          definitionText: JSON.stringify({
            args: ['--mode', 'simulator'],
            command: '/Users/tester/.blitz/iphone-mcp',
            env: { PATH: '/usr/bin' },
          }),
          definitionComparisonKey: '{"args":["--mode","simulator"],"command":"/Users/tester/.blitz/iphone-mcp","transport":"stdio"}',
        },
        {
          agentId: 'sandbox-codex',
          agentLabel: 'Codex',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/config.toml',
          transport: 'stdio',
          command: '/Users/tester/.blitz/iphone-mcp',
          args: ['--mode', 'simulator'],
          definitionText: [
            'command = "/Users/tester/.blitz/iphone-mcp"',
            'args = ["--mode", "simulator"]',
          ].join('\n'),
          definitionComparisonKey: '{"args":["--mode","simulator"],"command":"/Users/tester/.blitz/iphone-mcp","transport":"stdio"}',
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Claude Code',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          transport: 'stdio',
          command: '/Users/tester/.blitz/iphone-mcp',
          args: ['--mode', 'simulator'],
          definitionText: JSON.stringify({
            command: '/Users/tester/.blitz/iphone-mcp',
            args: ['--mode', 'simulator'],
          }),
          definitionComparisonKey: '{"args":["--mode","simulator"],"command":"/Users/tester/.blitz/iphone-mcp","transport":"stdio"}',
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          transport: 'stdio',
          command: '/Users/tester/.blitz/iphone-mcp',
          args: ['--mode', 'device'],
          definitionText: JSON.stringify({
            command: '/Users/tester/.blitz/iphone-mcp',
            args: ['--mode', 'device'],
          }),
          definitionComparisonKey: '{"args":["--mode","device"],"command":"/Users/tester/.blitz/iphone-mcp","transport":"stdio"}',
        },
      ],
    };

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.augment/settings.json',
    }, agentIndex);

    expect(model.definition.variants).toEqual([
      objectContaining({
        label: 'Augment, Codex, Claude Code',
        secondaryLabel: '3 agents',
        locations: [
          { label: 'Augment', path: '~/.skillindex/sandbox/.augment/settings.json' },
          { label: 'Codex', path: '~/.skillindex/sandbox/.codex/config.toml' },
          { label: 'Claude Code', path: '~/.skillindex/sandbox/.claude.json' },
        ],
      }),
      objectContaining({
        label: 'Factory',
        secondaryLabel: '1 agent',
        locations: [
          { label: 'Factory', path: '~/.skillindex/sandbox/.factory/mcp.json' },
        ],
      }),
    ]);
    expect(model.definition.files).toEqual([
      objectContaining({
        relativePath: model.definition.selectedVariant?.label,
        displayPath: model.definition.selectedVariant?.label,
        openPath: null,
        text: [
          '{',
          '  "transport": "stdio",',
          '  "command": "/Users/tester/.blitz/iphone-mcp",',
          '  "args": [',
          '    "--mode",',
          '    "simulator"',
          '  ],',
          '  "env": {',
          '    "PATH": "/usr/bin"',
          '  }',
          '}',
        ].join('\n'),
      }),
    ]);
  });

  it('builds a multi-problem inspector with definition mismatch selection', () => {
    const mcp = findRepresentativeMcp('diagnostic-rich-mcp');

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.claude.json',
    }, agentIndex);

    expect(model.problemCountLabel).toBe('1 problem');
    expect(model.problems.map((problem) => problem.key)).toEqual(['definition-mismatch']);
    expect(model.problemSections.map((section) => section.title)).toEqual(['Variant resolution', 'Structural repair']);
    expect(model.header.description).toBe('Definition Mismatch');
    expect(model.header.metadata).toEqual([
      expect.objectContaining({
        label: 'Selected definition',
        value: 'Claude Code',
        path: '~/.skillindex/sandbox/.claude.json',
      }),
      expect.objectContaining({
        label: 'Reference definition',
        value: 'Universal',
        path: '~/.skillindex/sandbox/.agents/mcp.json',
      }),
      expect.objectContaining({
        label: 'Locations',
        value: '7 locations',
      }),
    ]);
    expect(model.selectedVariantPath).toBe('~/.skillindex/sandbox/.claude.json');
    expect(expectVariantResolution(model.activeProblem).variants.map((variant) => variant.path)).toEqual([
      '~/.skillindex/sandbox/.agents/mcp.json',
      '~/.skillindex/sandbox/.claude.json',
      '~/.skillindex/sandbox/.factory/mcp.json',
    ]);
    expect(expectVariantResolution(model.activeProblem).variants[0]).toEqual(expect.objectContaining({
      label: 'Universal, Codex, Claude Desktop +2',
      secondaryLabel: '5 agents',
    }));
    expect(model.provenanceRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Selected definition',
        sourceLabel: 'Claude Code',
        path: '~/.skillindex/sandbox/.claude.json',
        isSelected: true,
      }),
      expect.objectContaining({
        label: 'Reference definition',
        sourceLabel: 'Universal',
        path: '~/.skillindex/sandbox/.agents/mcp.json',
        isCanonical: true,
      }),
    ]));
    expect(model.locations).toEqual([
      expect.objectContaining({
        id: 'universal',
        title: 'Universal File',
        rows: [
          expect.objectContaining({
            path: '~/.skillindex/sandbox/.agents/mcp.json',
            tone: 'healthy',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'installed-paths',
        title: 'Installed Paths',
        rows: arrayContaining([
          objectContaining({
            label: 'Claude Code',
            path: '~/.skillindex/sandbox/.claude.json',
            statusLabel: 'Definition Mismatch',
            tone: 'warning',
          }),
          objectContaining({
            label: 'Factory',
            path: '~/.skillindex/sandbox/.factory/mcp.json',
            statusLabel: 'Definition Mismatch',
            tone: 'warning',
          }),
        ]),
      }),
    ]);
    const activeProblem = expectVariantResolution(model.activeProblem);

    expect(activeProblem.selectedVariant?.path).toBe('~/.skillindex/sandbox/.claude.json');
    expect(activeProblem.primaryActionLabel).toBe('Apply Selected Definition Across Agents');
    const definitionBreakdown = activeProblem.definitionBreakdown;
    expect(definitionBreakdown).toBeDefined();
    if (!definitionBreakdown) {
      throw new Error('Expected MCP definition mismatch to include a definition breakdown.');
    }
    expect(definitionBreakdown.comparedFields).toEqual(arrayContaining([
      objectContaining({
        label: 'Args',
        status: 'different',
        referenceValue: ['canonical-server.js'],
        selectedValue: ['claude-server.js'],
      }),
    ]));
    expect(definitionBreakdown.ignoredSettings).toEqual([]);
    expect(definitionBreakdown.rawConfigs).toHaveLength(2);
    expect(definitionBreakdown.rawConfigs[0]).toEqual(objectContaining({
      label: 'Reference definition',
      path: '~/.skillindex/sandbox/.agents/mcp.json',
      text: stringContaining('canonical-server.js'),
    }));
    expect(definitionBreakdown.rawConfigs[1]).toEqual(objectContaining({
      label: 'Selected definition',
      path: '~/.skillindex/sandbox/.claude.json',
      text: stringContaining('claude-server.js'),
    }));
  });

  it('shows cwd as a compared MCP field when it causes a definition mismatch', () => {
    const mcp: RepresentativeMcp = {
      name: 'blitz-macos',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch'],
      locations: [
        {
          agentId: 'sandbox-codex',
          agentLabel: 'Codex',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/config.toml',
          transport: 'stdio',
          command: '/Users/tester/.blitz/blitz-macos-mcp',
          args: [],
          definitionText: JSON.stringify({
            command: '/Users/tester/.blitz/blitz-macos-mcp',
            cwd: '/Users/tester/.blitz/mcps',
            enabled_tools: ['app_get_state'],
          }),
          definitionComparisonKey: '{"command":"/Users/tester/.blitz/blitz-macos-mcp","cwd":"/Users/tester/.blitz/mcps","transport":"stdio"}',
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          transport: 'stdio',
          command: '/Users/tester/.blitz/blitz-macos-mcp',
          args: [],
          definitionText: JSON.stringify({
            command: '/Users/tester/.blitz/blitz-macos-mcp',
            disabled: false,
            type: 'stdio',
          }),
          definitionComparisonKey: '{"command":"/Users/tester/.blitz/blitz-macos-mcp","transport":"stdio"}',
        },
      ],
    };

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.factory/mcp.json',
    }, agentIndex, sourceIndex);
    expect(model.problems.find((problem) => problem.key === 'definition-mismatch')?.detail).toBe(
      'Definitions differ across Codex, Factory',
    );
    const definitionBreakdown = expectVariantResolution(model.activeProblem).definitionBreakdown;
    expect(definitionBreakdown).toBeDefined();
    if (!definitionBreakdown) {
      throw new Error('Expected MCP definition mismatch to include a definition breakdown.');
    }

    expect(definitionBreakdown.comparedFields).toEqual(arrayContaining([
      objectContaining({
        label: 'Cwd',
        status: 'reference-only',
        referenceValue: ['/Users/tester/.blitz/mcps'],
        selectedValue: ['None'],
      }),
    ]));
    expect(definitionBreakdown.ignoredSettings).toEqual([
      objectContaining({
        label: 'Disabled',
        sources: ['Factory'],
      }),
      objectContaining({
        label: 'Enabled Tools',
        sources: ['Codex'],
      }),
    ]);
  });

  it('keeps MCP mismatch variant order stable across selections', () => {
    const mcp = findRepresentativeMcp('diagnostic-rich-mcp');

    const canonicalSelected = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.agents/mcp.json',
    }, agentIndex);

    const factorySelected = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.factory/mcp.json',
    }, agentIndex);

    expect(expectVariantResolution(canonicalSelected.activeProblem).variants.map((variant) => variant.path)).toEqual([
      '~/.skillindex/sandbox/.agents/mcp.json',
      '~/.skillindex/sandbox/.claude.json',
      '~/.skillindex/sandbox/.factory/mcp.json',
    ]);
    expect(expectVariantResolution(factorySelected.activeProblem).variants.map((variant) => variant.path)).toEqual([
      '~/.skillindex/sandbox/.agents/mcp.json',
      '~/.skillindex/sandbox/.claude.json',
      '~/.skillindex/sandbox/.factory/mcp.json',
    ]);
  });

  it('prefers the .agents MCP config as the reference definition even when locations are reordered or use backslashes', () => {
    const mcp = findRepresentativeMcp('diagnostic-rich-mcp');
    const windowsAgentsPath = 'C:\\skillindex\\sandbox\\.agents\\mcp.json';
    const [canonicalLocation, claudeLocation, factoryLocation] = mcp.locations;
    expect(canonicalLocation).toBeDefined();
    expect(claudeLocation).toBeDefined();
    expect(factoryLocation).toBeDefined();
    const reorderedMcp = {
      ...mcp,
      locations: [
        {
          ...factoryLocation,
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
        },
        {
          ...canonicalLocation,
          configPath: windowsAgentsPath,
        },
        {
          ...claudeLocation,
          configPath: '~/.skillindex/sandbox/.claude.json',
        },
      ],
    };

    const model = buildMcpInspectorModel(reorderedMcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: null,
    }, agentIndex);
    const activeProblem = expectVariantResolution(model.activeProblem);

    expect(model.selectedVariantPath).toBe(windowsAgentsPath);
    expect(activeProblem.baselineVariant?.path).toBe(windowsAgentsPath);
    expect(model.header.metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Reference definition',
        path: windowsAgentsPath,
      }),
      expect.objectContaining({
        label: 'Selected definition',
        path: windowsAgentsPath,
      }),
    ]));
  });

  it('uses compact skill variant ids instead of raw definition text', () => {
    const skill = withDefinitionText(
      findRepresentativeSkill('diagnostic-rich-skill'),
      {
        [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: 'canonical body',
        [packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')]: 'claude body with a long content string',
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: 'factory body with a different long content string',
      },
    );
    const [canonicalCandidate, claudeCandidate, factoryCandidate] = skill.detailDiagnostics.duplicateCandidates;
    expect(canonicalCandidate).toBeDefined();
    expect(claudeCandidate).toBeDefined();
    expect(factoryCandidate).toBeDefined();
    canonicalCandidate.contentHash = 'canonical-hash';
    claudeCandidate.contentHash = undefined;
    factoryCandidate.contentHash = undefined;

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
    }, agentIndex);
    const activeProblem = expectVariantResolution(model.activeProblem);

    expect(activeProblem.variants.map((variant) => variant.id)).toEqual([
      'hash:canonical-hash',
      expect.stringMatching(/^text:[0-9a-f]+$/),
      expect.stringMatching(/^text:[0-9a-f]+$/),
    ]);
    expect(activeProblem.variants.map((variant) => variant.id)).not.toContain('claude body with a long content string');
  });

  it('builds invalid-definition MCP rows with the error as the primary label', () => {
    const mcp = findRepresentativeMcp('broken-mcp');

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'invalid-definition',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problemCountLabel).toBe('2 problems');
    expect(model.problems.map((problem) => problem.key)).toEqual(['definition-mismatch', 'invalid-definition']);
    expect(model.header.description).toBe('Definition Mismatch · Invalid Definition');

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items[0]).toMatchObject({
      label: 'Missing connection target.',
      path: '~/.skillindex/sandbox/.agents/mcp.json',
      detail: 'Universal',
      snippet: {
        title: 'Definition Excerpt',
        text: [
          '{',
          '  "mcpServers": {',
          '    "broken-mcp": {',
          '      "args": ["missing-command.js"]',
          '    }',
          '  }',
          '}',
        ].join('\n'),
      },
    });
  });

  it('builds connection-failed MCP rows with runtime error details', () => {
    const baseMcp = findRepresentativeMcp('healthy-mcp');
    const [location] = baseMcp.locations;
    expect(location).toBeDefined();
    const mcp: RepresentativeMcp = {
      ...baseMcp,
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['connection-failed'],
      locations: [
        {
          ...location,
          command: 'npx',
          args: ['-y', 'ios-simulator-mcp'],
          connectivity: {
            status: 'failed',
            checkedAt: '2026-05-04T12:00:00.000Z',
            latencyMs: 42,
            error: 'Process exited before initialization.',
          },
        },
      ],
    };

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'connection-failed',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problemCountLabel).toBe('1 problem');
    expect(model.header.description).toBe('Connection Failed');

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem).toMatchObject({
      key: 'connection-failed',
      title: 'Connection Failed',
      listTitle: 'Connection Failures',
    });
    expect(activeProblem.items[0]).toMatchObject({
      label: 'Process exited before initialization.',
      path: location.configPath,
      detail: 'Universal',
      snippet: {
        title: 'Connection Target',
        text: 'npx -y ios-simulator-mcp',
      },
    });
    expect(model.locations[0]?.rows[0]).toMatchObject({
      statusLabel: 'Connection Failed',
      tone: 'danger',
    });
  });

  it('builds invalid-definition skill rows with a recoverable frontmatter snippet', () => {
    const skill = withDefinitionText(
      representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill')!,
      {
        [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: [
          '---',
          'name: diagnostic-rich-skill',
          'description: Canonical detail candidate.',
          '---',
          '# Diagnostic rich skill',
          'Canonical content.',
        ].join('\n'),
        [packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')]: [
          '---',
          'name: diagnostic-rich-skill',
          'description: Claude detail candidate.',
          '---',
          '# Diagnostic rich skill',
          'Claude copy with its own description.',
        ].join('\n'),
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: [
          '---',
          'description: Factory copy with a description but missing a name field.',
          '---',
          '# Diagnostic rich skill',
          'Factory copy missing the required name.',
        ].join('\n'),
      },
    );

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'invalid-definition',
      selectedVariantPath: null,
    }, agentIndex);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items).toEqual([
      expect.objectContaining({
        label: 'Missing required field: name',
        path: `${packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')}/SKILL.md`,
        detail: 'Factory',
        snippet: {
          title: 'Frontmatter',
          text: [
            '---',
            'description: Factory copy with a description but missing a name field.',
            '---',
          ].join('\n'),
        },
      }),
    ]);
  });

  it('uses precise labels for invalid frontmatter field constraints', () => {
    const skill = withDefinitionText(
      {
        ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill')!,
        detailDiagnostics: {
          ...representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill')!.detailDiagnostics,
          definitionIssues: [
            {
              type: 'invalid-field-value' as const,
              field: 'name' as const,
              detail: 'Invalid field: name must be at most 64 characters',
              path: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: {
                sourceId: 'sandbox-factory',
                label: 'Sandbox Factory',
                kind: 'agent' as const,
                scope: 'sandbox' as const,
                writable: true,
                canonical: false,
              },
            },
            {
              type: 'invalid-field-value' as const,
              field: 'name' as const,
              detail: 'Invalid field: name must use lowercase letters only',
              path: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: {
                sourceId: 'sandbox-factory',
                label: 'Sandbox Factory',
                kind: 'agent' as const,
                scope: 'sandbox' as const,
                writable: true,
                canonical: false,
              },
            },
            {
              type: 'invalid-field-value' as const,
              field: 'name' as const,
              detail: 'Invalid field: name may contain only lowercase letters, numbers, and hyphens',
              path: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: {
                sourceId: 'sandbox-factory',
                label: 'Sandbox Factory',
                kind: 'agent' as const,
                scope: 'sandbox' as const,
                writable: true,
                canonical: false,
              },
            },
            {
              type: 'invalid-field-value' as const,
              field: 'name' as const,
              detail: 'Invalid field: name must not start or end with a hyphen',
              path: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: {
                sourceId: 'sandbox-factory',
                label: 'Sandbox Factory',
                kind: 'agent' as const,
                scope: 'sandbox' as const,
                writable: true,
                canonical: false,
              },
            },
            {
              type: 'invalid-field-value' as const,
              field: 'description' as const,
              detail: 'Invalid field: description must be at most 1024 characters',
              path: packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'),
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: {
                sourceId: 'sandbox-factory',
                label: 'Sandbox Factory',
                kind: 'agent' as const,
                scope: 'sandbox' as const,
                writable: true,
                canonical: false,
              },
            },
          ],
        },
      },
      {
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: [
          '---',
          'name: -Invalid_Name_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-',
          `description: ${'x'.repeat(1025)}`,
          '---',
          '# Diagnostic rich skill',
          'Factory copy missing several constraints.',
        ].join('\n'),
      },
    );

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'invalid-definition',
      selectedVariantPath: null,
    }, agentIndex);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items.map((item) => item.label)).toEqual([
      'Invalid field: name must be at most 64 characters',
      'Invalid field: name must use lowercase letters only',
      'Invalid field: name may contain only lowercase letters, numbers, and hyphens',
      'Invalid field: name must not start or end with a hyphen',
      'Invalid field: description must be at most 1024 characters',
    ]);
  });

  it('builds a structural missing-from-agents problem from missing locations', () => {
    const mcp = findRepresentativeMcp('missing-from-agents-mcp');

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, agentIndex);

    expect(model.problemCountLabel).toBe('1 problem');
    expect(model.problemSections.map((section) => section.title)).toEqual(['Variant resolution', 'Structural repair']);
    const activeProblem = expectStructuralRepair(model.activeProblem);

    expect(activeProblem.title).toBe('Missing From Agents');
    expect(activeProblem.listTitle).toBe('Affected Agents');
    expect(activeProblem.items[0]).toMatchObject({
      label: 'Factory',
      path: '~/.skillindex/sandbox/.factory/mcp.json',
      pathExists: true,
    });
    expect(activeProblem.primaryActionLabel).toBe('Add MCP to Agents');
  });

  it('builds a variant repair problem for missing universal MCPs', () => {
    const mcp: RepresentativeMcp = {
      name: 'local-only-mcp',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['missing-universal'],
      locations: [
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          configName: 'local-only-mcp',
          transport: 'stdio',
          command: 'node',
          args: ['local-only.js'],
          definitionText: '{\n  "command": "node",\n  "args": ["local-only.js"],\n  "disabled": false\n}',
          definitionComparisonKey: 'local-only-mcp',
          nativeDefinition: {
            disabled: false,
          },
          agentLocalKey: 'factory',
        },
      ],
    };

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'missing-universal',
      selectedVariantPath: null,
    }, agentIndex, sourceIndex);

    const activeProblem = expectVariantResolution(model.activeProblem);
    expect(activeProblem.title).toBe('Missing Universal');
    expect(activeProblem.listTitle).toBe('Detected Definitions');
    expect(activeProblem.primaryActionLabel).toBe('Promote to Universal');
    expect(activeProblem.selectedVariant?.path).toBe('~/.skillindex/sandbox/.factory/mcp.json');
    expect(model.locations.find((section) => section.id === 'universal')?.title).toBe('Universal File');
    expect(model.locations.find((section) => section.id === 'universal')?.rows).toEqual([
      objectContaining({
        path: '~/.skillindex/sandbox/.agents/mcp.json',
        pathText: '~/.skillindex/sandbox/.agents/mcp.json',
        statusLabel: 'Missing Universal',
      }),
    ]);
    expect(activeProblem.definitionBreakdown?.ignoredSettings).toEqual([
      objectContaining({
        label: 'Disabled',
        sources: ['Factory'],
      }),
    ]);
  });

  it('marks missing-from-agents config paths nonexistent when the agent config file is absent', () => {
    const mcp = findRepresentativeMcp('missing-from-agents-mcp');
    const unavailableAgentIndex = new Map(agentIndex);
    const factoryAgent = unavailableAgentIndex.get('sandbox-factory') as AgentRecord;
    unavailableAgentIndex.set('sandbox-factory', {
      ...factoryAgent,
      mcpConfigLocation: {
        ...factoryAgent.mcpConfigLocation,
        exists: false,
      },
    });

    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, unavailableAgentIndex);

    const activeProblem = expectStructuralRepair(model.activeProblem);
    expect(activeProblem.items[0]).toMatchObject({
      label: 'Factory',
      path: '~/.skillindex/sandbox/.factory/mcp.json',
      pathExists: false,
    });
  });

  it('builds a healthy MCP empty state with the shared friendly copy', () => {
    const mcp = findRepresentativeMcp('healthy-mcp');

    const model = buildMcpInspectorModel(mcp, {}, agentIndex);

    expect(model.problems).toEqual([]);
    expect(expectStructuralRepair(model.activeProblem).healthySummary).toBe('Defined in every agent the exact same way.');
  });

  it('labels resolved plugin MCPs as mixed plugin and manual provenance', () => {
    const pluginConfigPath = '/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/.mcp.json';
    const manualConfigPath = '/tmp/skillindex/sandbox/.agents/mcp.json';
    const pluginLocation: RepresentativeMcp['locations'][number] = {
      agentId: 'plugin:sandbox:codex:signal-tools@sandbox-curated:2.0.0',
      agentLabel: 'Codex Plugin signal-tools',
      scope: 'sandbox',
      configPath: pluginConfigPath,
      transport: 'stdio',
      command: 'node',
      args: ['/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/servers/signal-map.js'],
      definitionText: '{"command":"node","args":["signal-map.js"]}',
      provenance: {
        kind: 'plugin',
        plugin: {
          host: 'codex',
          pluginId: 'signal-tools@sandbox-curated',
          version: '2.0.0',
        },
        sourcePath: pluginConfigPath,
        discoveredAt: '2026-05-15T12:00:00.000Z',
      },
      canonicalRole: 'canonical',
      mutability: 'read-only-managed',
    };
    const mcp: RepresentativeMcp = {
      name: 'signal-tools:signalMap',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: manualConfigPath,
          transport: 'stdio',
          command: 'node',
          args: ['/tmp/skillindex/sandbox/.codex/plugins/cache/sandbox-curated/signal-tools/2.0.0/servers/signal-map.js'],
          definitionText: '{"command":"node","args":["signal-map.js"]}',
          provenance: {
            kind: 'manual',
            sourcePath: manualConfigPath,
            discoveredAt: '2026-05-15T12:01:00.000Z',
          },
          canonicalRole: 'materialized-copy',
          mutability: 'writable',
        },
        pluginLocation,
      ],
    };

    const model = buildMcpInspectorModel(mcp, {}, agentIndex);

    expect(model.header.title).toBe('signalMap');
    expect(model.header.isLocked).toBe(true);
    expect(model.provenanceSummary).toEqual([
      {
        id: 'source-type',
        label: 'Source Type',
        value: 'Plugin + Manual',
      },
      {
        id: 'source',
        label: 'Source',
        value: 'signal-tools@sandbox-curated',
        action: {
          kind: 'plugin',
          host: 'codex',
          pluginId: 'signal-tools@sandbox-curated',
          version: '2.0.0',
        },
      },
    ]);

    const pluginOnlyModel = buildMcpInspectorModel({
      ...mcp,
      locations: [pluginLocation],
    }, {}, agentIndex);
    expect(pluginOnlyModel.header.isLocked).toBe(true);
    expect(pluginOnlyModel.provenanceSummary).toEqual([
      {
        id: 'source-type',
        label: 'Source Type',
        value: 'Plugin',
      },
      {
        id: 'source',
        label: 'Source',
        value: 'signal-tools@sandbox-curated',
        action: {
          kind: 'plugin',
          host: 'codex',
          pluginId: 'signal-tools@sandbox-curated',
          version: '2.0.0',
        },
      },
    ]);
  });
});

function expectVariantResolution(problem: InspectorActiveProblemModel): VariantResolutionProblemModel {
  expect(problem.kind).toBe('variant-resolution');
  return problem as VariantResolutionProblemModel;
}

function expectStructuralRepair(problem: InspectorActiveProblemModel): StructuralRepairProblemModel {
  expect(problem.kind).toBe('structural-repair');
  return problem as StructuralRepairProblemModel;
}

function buildPluginSource(
  host: NonNullable<SkillScanSource['plugin']>['host'],
  pluginId: string,
  label: string,
  rootPath: string,
): SkillScanSource {
  return {
    id: `plugin:sandbox:${host}:${pluginId}:1.0.0`,
    label,
    canonical: true,
    kind: 'plugin',
    writable: false,
    scope: 'sandbox',
    skillsDir: `${rootPath}/skills`,
    plugin: {
      host,
      pluginId,
      pluginName: pluginId.split('@')[0] ?? pluginId,
      version: '1.0.0',
      rootPath,
      manifestPath: `${rootPath}/${host === 'codex' ? '.codex-plugin' : '.claude-plugin'}/plugin.json`,
    },
  };
}

function buildPluginLocation(
  source: SkillScanSource,
  locationPath: string,
  contentHash: string,
): SkillRecord['locations'][number] {
  const plugin = source.plugin;
  if (!plugin) {
    throw new Error(`Expected ${source.id} to include plugin provenance.`);
  }

  return {
    path: locationPath,
    entrypointPath: `${locationPath}/SKILL.md`,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: '2026-05-01T12:00:00.000Z',
    canonical: false,
    resolvedPath: locationPath,
    contentHash,
    definitionText: [
      '---',
      'name: plural-copy',
      `description: ${source.label} variant.`,
      '---',
      '# Plural copy',
      source.label,
    ].join('\n'),
    provenance: {
      kind: 'plugin',
      plugin: {
        host: plugin.host,
        pluginId: plugin.pluginId,
        version: plugin.version,
      },
      sourcePath: locationPath,
      discoveredAt: '2026-05-01T12:00:00.000Z',
    },
    canonicalRole: 'canonical',
    mutability: 'read-only-managed',
  };
}

function withDefinitionText(skill: SkillRecord, contentByPath: Record<string, string>): SkillRecord {
  return {
    ...skill,
    detailDiagnostics: {
      ...skill.detailDiagnostics,
      duplicateCandidates: skill.detailDiagnostics.duplicateCandidates.map((candidate) => ({
        ...candidate,
        definitionText: contentByPath[candidate.path],
      })),
    },
  };
}

function createDuplicateCandidate(
  locationPath: string,
  sourceLabel: string,
  body: string,
  options: {
    modifiedAt: string;
    provenanceKind: 'manual' | 'plugin';
  },
): SkillRecord['detailDiagnostics']['duplicateCandidates'][number] {
  return {
    path: locationPath,
    entrypointPath: `${locationPath}/SKILL.md`,
    sourceId: sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sourceLabel,
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: options.modifiedAt,
    canonical: false,
    resolvedPath: locationPath,
    contentHash: `${locationPath}:hash`,
    definitionText: [
      '---',
      'name: handoff-notes-with-static',
      `description: ${sourceLabel} variant.`,
      '---',
      '',
      '# Handoff notes with static',
      body,
      '',
    ].join('\n'),
    installSource: {
      sourceId: sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label: sourceLabel,
      kind: options.provenanceKind === 'plugin' ? 'plugin' : 'agent',
      scope: 'sandbox',
      writable: options.provenanceKind !== 'plugin',
      canonical: sourceLabel === 'Universal',
    },
    provenance: options.provenanceKind === 'plugin'
      ? {
          kind: 'plugin',
          plugin: {
            host: sourceLabel.startsWith('Codex') ? 'codex' : 'claude',
            pluginId: 'example-workflow-kit@sandbox-curated',
            version: '5.1.0',
          },
          sourcePath: locationPath,
          discoveredAt: options.modifiedAt,
        }
      : {
          kind: 'manual',
          sourcePath: locationPath,
          discoveredAt: options.modifiedAt,
        },
    canonicalRole: sourceLabel === 'Universal' ? 'canonical' : 'materialized-copy',
    mutability: options.provenanceKind === 'plugin' ? 'read-only-managed' : 'writable',
  };
}

function withPackageFiles(
  skill: SkillRecord,
  filesByPath: Record<string, Record<string, string>>,
): SkillRecord {
  const createPackageFiles = (packagePath: string) => {
    const fileMap = filesByPath[packagePath] ?? {};
    return Object.entries(fileMap).map(([relativePath, text]) => ({
      relativePath,
      kind: 'text' as const,
      size: text.length,
      contentHash: `${relativePath}:${text}`,
      text,
    }));
  };

  return {
    ...skill,
    detailDiagnostics: {
      ...skill.detailDiagnostics,
      duplicateCandidates: skill.detailDiagnostics.duplicateCandidates.map((candidate) => ({
        ...candidate,
        definitionText: filesByPath[candidate.path]?.['SKILL.md'] ?? candidate.definitionText,
        packageFiles: createPackageFiles(candidate.path),
      })),
    },
  };
}
