import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRecord, McpRecord, SkillRecord, SkillIndexDesktopApi } from '@shared/contracts';

import { representativeInventorySnapshot } from '@renderer/representative-preview-data';
import { buildMcpInspectorModel, buildSkillInspectorModel, type InspectorModel } from '@renderer/lib/detail-inspector-model';

import { DetailInspectorPanel } from './DetailInspectorPanel';

const sourceIndex = new Map(representativeInventorySnapshot.sources.map((source) => [source.id, source]));
const agentIndex = new Map((representativeInventorySnapshot.agents ?? []).map((agent) => [agent.id, agent]));
const openPathInEditorMock = vi.fn<SkillIndexDesktopApi['openPathInEditor']>();
const packagePath = (value: string) => value.replace(/\.md$/, '');

describe('DetailInspectorPanel', () => {
  beforeEach(() => {
    openPathInEditorMock.mockReset();
    openPathInEditorMock.mockResolvedValue(undefined);

    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: {
        openPathInEditor: openPathInEditorMock,
      } as Pick<SkillIndexDesktopApi, 'openPathInEditor'> as SkillIndexDesktopApi,
      writable: true,
    });
  });

  it('renders the shared shell around a variant-resolution problem and forwards selections', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill');
    expect(skill).toBeDefined();

    const onClose = vi.fn();
    const onProblemSelect = vi.fn();
    const onVariantSelect = vi.fn();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
    }, agentIndex);
    const activeProblem = model.activeProblem.kind === 'variant-resolution' ? model.activeProblem : null;

    render(
      <DetailInspectorPanel
        ariaLabel="Shared detail"
        model={model}
        onClose={onClose}
        onProblemSelect={onProblemSelect}
        onVariantSelect={onVariantSelect}
      />,
    );

    expect(screen.getByRole('heading', { name: 'diagnostic-rich-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Canonical detail candidate.')).toBeInTheDocument();
    expect(screen.getByText('Updated Jan 8')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Problems/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Locations/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('2 problems')).toBeInTheDocument();
    expect(screen.getByText('Select one to inspect')).toBeInTheDocument();
    const problemList = screen.getByRole('list', { name: 'Problems' });
    expect(within(problemList).getAllByRole('listitem')).toHaveLength(model.problems.length);
    expect(screen.getByRole('button', { name: /Diverged Copies/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Invalid Definition/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Detected Versions')).toBeInTheDocument();
    const variantList = screen.getByRole('list', { name: 'Detected Versions' });
    expect(within(variantList).getAllByRole('listitem')).toHaveLength(activeProblem?.variants.length ?? 0);
    expect(screen.getByText('- description: Canonical detail candidate.')).toBeInTheDocument();
    expect(screen.getByText('+ description: Claude detail candidate.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Invalid Definition/i }));
    expect(onProblemSelect).toHaveBeenCalledWith('invalid-definition');

    fireEvent.click(screen.getByRole('button', {
      name: /Sandbox Factory.*diagnostic-rich-skill/i,
    }));
    expect(onVariantSelect).toHaveBeenCalledWith(packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md'));

    expect(openPathInEditorMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));
    expect(screen.getByRole('tab', { name: /Locations/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Detected Versions')).not.toBeInTheDocument();
    expect(screen.getByText('Universal Directory')).toBeInTheDocument();
    expect(screen.getByText('Installed Paths')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
    expect(screen.getByText('Local files not supported')).toBeInTheDocument();
    expect(screen.queryByText('Cloud account managed')).not.toBeInTheDocument();
    expect(screen.getByText('Invalid Definition')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows accepted plugin alternate status and splits plugin source labels in Locations', () => {
    const model: InspectorModel = {
      header: {
        title: 'handoff-notes',
        description: 'Codex plugin variant with a small wording difference.',
        updatedLabel: 'Updated May 15',
        metadata: [],
        isLocked: true,
      },
      definition: {
        listTitle: 'Detected Versions',
        variants: [],
        selectedVariant: null,
        selectedVariantPath: null,
        files: [],
        emptySummary: 'No definition available.',
      },
      locations: [{
        id: 'plugin-paths',
        title: 'Plugin Paths',
        rows: [{
          id: 'claude-plugin',
          label: 'Claude Plugin example-workflow-kit',
          path: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes',
          pathText: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes',
          statusLabel: 'Accepted Alternate',
          tone: 'healthy',
          action: {
            kind: 'choose-skill-universal-version',
            label: 'Make Universal',
            path: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes',
          },
        }],
      }],
      problemCountLabel: '0 problems',
      problems: [],
      problemSections: [],
      activeProblem: {
        kind: 'structural-repair',
        key: 'missing-symlinks',
        title: 'No problems',
        listTitle: 'Problems',
        items: [],
        healthySummary: 'This skill is canonical and fully linked.',
        primaryActionLabel: null,
      },
      selectedVariantPath: null,
      provenanceRows: [],
      provenanceSummary: [],
    };
    const onLocationAction = vi.fn();

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onLocationAction={onLocationAction}
        onProblemSelect={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));

    const pluginPaths = screen.getByRole('list', { name: 'Plugin Paths' });
    const row = within(pluginPaths).getByRole('listitem');
    expect(within(row).getByText('Claude Plugin')).toHaveClass(
      'detail-inspector-panel__location-label-line--plugin-host',
    );
    expect(within(row).getByText('example-workflow-kit')).toHaveClass(
      'detail-inspector-panel__location-label-line',
    );
    expect(within(row).getByText('Accepted Alternate')).toHaveClass(
      'detail-inspector-panel__location-status--visible',
      'detail-inspector-panel__location-status--healthy',
    );
    fireEvent.click(within(row).getByRole('button', { name: /Make Universal/i }));
    expect(onLocationAction).toHaveBeenCalledWith({
      kind: 'choose-skill-universal-version',
      label: 'Make Universal',
      path: '/tmp/skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes',
    });
  });

  it('renders healthy symlink location status', () => {
    const model: InspectorModel = {
      header: {
        title: 'repo-backed-skill',
        description: 'Repo-backed skill exposed through a symlink.',
        updatedLabel: 'Updated May 15',
        metadata: [],
        isLocked: false,
      },
      definition: {
        listTitle: 'Detected Versions',
        variants: [],
        selectedVariant: null,
        selectedVariantPath: null,
        files: [],
        emptySummary: 'No definition available.',
      },
      locations: [{
        id: 'universal',
        title: 'Universal Directory',
        rows: [{
          id: 'agents-symlink',
          label: '.agents',
          path: '/Users/tester/.agents/skills/repo-backed-skill',
          pathText: '/Users/tester/.agents/skills/repo-backed-skill',
          statusLabel: 'symlink',
          tone: 'healthy',
        }],
      }],
      problemCountLabel: '0 problems',
      problems: [],
      problemSections: [],
      activeProblem: {
        kind: 'structural-repair',
        key: 'missing-symlinks',
        title: 'No problems',
        listTitle: 'Problems',
        items: [],
        healthySummary: 'This skill is canonical and fully linked.',
        primaryActionLabel: null,
      },
      selectedVariantPath: null,
      provenanceRows: [],
      provenanceSummary: [],
    };

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));

    expect(screen.getByText('symlink')).toHaveClass(
      'detail-inspector-panel__location-status--visible',
      'detail-inspector-panel__location-status--healthy',
    );
  });

  it('renders all changed file diffs inline for diverged copies', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill');
    expect(baseSkill).toBeDefined();

    const skill: SkillRecord = {
      ...baseSkill!,
      diff: {
        baselinePath: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
        baselineSourceLabel: 'Sandbox .agents',
        selectedPath: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
        selectedSourceLabel: 'Sandbox Claude',
        files: [
          {
            relativePath: 'SKILL.md',
            status: 'changed',
            kind: 'text',
            lines: [
              { type: 'removed', text: 'description: Canonical detail candidate.' },
              { type: 'added', text: 'description: Claude detail candidate.' },
            ],
          },
          {
            relativePath: 'rules/example.py',
            status: 'added',
            kind: 'text',
            lines: [
              { type: 'added', text: 'print("hello")' },
            ],
          },
        ],
      },
    };

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md'),
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={() => undefined}
      />,
    );

    expect(screen.queryByText('Changed Files')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*diagnostic-rich-skill\/SKILL\.md in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*diagnostic-rich-skill\/rules\/example\.py in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByText('- description: Canonical detail candidate.')).toBeInTheDocument();
    expect(screen.getByText('+ description: Claude detail candidate.')).toBeInTheDocument();
    expect(screen.getByText('+ print("hello")')).toBeInTheDocument();
  });

  it('renders a Definition tab file picker when a skill has multiple versions', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill');
    expect(baseSkill).toBeDefined();
    const claudePath = packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md');
    const factoryPath = packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md');
    const skill = withPackageFiles(baseSkill!, {
      [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: {
        'SKILL.md': 'name: diagnostic-rich-skill\ncanonical definition\n',
      },
      [claudePath]: {
        'SKILL.md': 'name: diagnostic-rich-skill\nclaude definition\n',
        'references/claude.md': 'Claude supporting file.\n',
      },
      [factoryPath]: {
        'SKILL.md': 'name: diagnostic-rich-skill\nfactory definition\n',
      },
    });
    const onVariantSelect = vi.fn();
    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: claudePath,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={onVariantSelect}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Definition' }));

    expect(screen.getByText('Detected Versions')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Detected Versions' })).toBeInTheDocument();
    expect(screen.getByText('claude definition')).toBeInTheDocument();
    expect(screen.getByText('Claude supporting file.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: /Sandbox Factory.*diagnostic-rich-skill/i,
    }));
    expect(onVariantSelect).toHaveBeenCalledWith(factoryPath);
  });

  it('renders MCP definition variants as normalized definitions with source locations', () => {
    const mcp: McpRecord = {
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
          definitionText: '{"command":"/Users/tester/.blitz/iphone-mcp","args":["--mode","simulator"]}',
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
          definitionText: 'command = "/Users/tester/.blitz/iphone-mcp"',
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
          definitionText: '{"command":"/Users/tester/.blitz/iphone-mcp","args":["--mode","simulator"]}',
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
          definitionText: '{"command":"/Users/tester/.blitz/iphone-mcp","args":["--mode","device"]}',
          definitionComparisonKey: '{"args":["--mode","device"],"command":"/Users/tester/.blitz/iphone-mcp","transport":"stdio"}',
        },
      ],
    };
    const onVariantSelect = vi.fn();
    const model = buildMcpInspectorModel(mcp, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.augment/settings.json',
    }, agentIndex);

    render(
      <DetailInspectorPanel
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={onVariantSelect}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Definition' }));

    const variantList = screen.getByRole('list', { name: 'Detected Definitions' });
    expect(within(variantList).getByText('Augment, Codex, Claude Code')).toBeInTheDocument();
    expect(within(variantList).getByText('3 agents')).toBeInTheDocument();
    expect(within(variantList).getByText('Factory')).toBeInTheDocument();
    expect(within(variantList).getByText('1 agent')).toBeInTheDocument();
    expect(screen.getAllByText('Augment, Codex, Claude Code').length).toBeGreaterThan(1);
    expect(screen.queryByText('Normalized definition')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /Open .*\.augment\/settings\.json in the default editor/i,
    })).not.toBeInTheDocument();
    expect(screen.getByText((_content, element) =>
      element?.textContent === '  "command": "/Users/tester/.blitz/iphone-mcp",')).toBeInTheDocument();

    fireEvent.click(within(variantList).getByRole('button', { name: /Factory.*1 agent/i }));
    expect(onVariantSelect).toHaveBeenCalledWith('~/.skillindex/sandbox/.factory/mcp.json');
  });

  it('keeps the diverged changed-file superset visible when Universal is selected and still previews SKILL.md', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill');
    expect(baseSkill).toBeDefined();

    const skill = withPackageFiles(
      baseSkill!,
      {
        [packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md')]: {
          'SKILL.md': 'canonical skill\n',
          'rules/shared.md': 'shared\n',
          'scripts/check.py': 'print("canonical")\n',
        },
        [packagePath('~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md')]: {
          'SKILL.md': 'claude skill\n',
          'rules/shared.md': 'shared\n',
          'scripts/check.py': 'print("claude")\n',
        },
        [packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')]: {
          'SKILL.md': 'canonical skill\n',
          'rules/shared.md': 'factory-only support change\n',
          'scripts/check.py': 'print("canonical")\n',
        },
      },
    );

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: packagePath('~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md'),
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={() => undefined}
      />,
    );

    expect(screen.getByRole('button', {
      name: /Open .*diagnostic-rich-skill\/SKILL\.md in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*diagnostic-rich-skill\/scripts\/check\.py in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*diagnostic-rich-skill\/rules\/shared\.md in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByText('canonical skill')).toBeInTheDocument();
    expect(screen.getByText('shared')).toBeInTheDocument();
    expect(screen.getByText('print("canonical")')).toBeInTheDocument();
    expect(screen.queryByText('Selected version preview')).not.toBeInTheDocument();
    expect(screen.queryByText('Changed file')).not.toBeInTheDocument();
    expect(screen.queryByText('No change in selected version')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'This file is part of the affected package set, but it does not change for the currently selected version.',
      ),
    ).not.toBeInTheDocument();
  });

  it('renders a structural-repair surface with affected items and footer actions', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'identical-drift-skill');
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {
      selectedProblemKey: 'identical-copies',
      selectedVariantPath: null,
    }, agentIndex);

    const onFooterAction = vi.fn();

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        footerActions={[
          { label: 'Hide for now', onClick: onFooterAction, variant: 'subtle' },
          { label: 'Use as Universal', variant: 'strong' },
        ]}
      />,
    );

    expect(screen.getByText('Matching Copies')).toBeInTheDocument();
    expect(screen.queryByText('This will replace 1 writable copy with a symlink to the Universal version.')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Matching Copies' });
    expect(within(list).getByText('Factory')).toBeInTheDocument();
    expect(within(list).getByTitle(packagePath('~/.skillindex/sandbox/.factory/skills/identical-drift-skill.md'))).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', {
      name: /Open .*identical-drift-skill in the default editor/i,
    }));
    expect(openPathInEditorMock).toHaveBeenCalledWith(packagePath('~/.skillindex/sandbox/.factory/skills/identical-drift-skill.md'));

    fireEvent.click(screen.getByRole('button', { name: 'Hide for now' }));
    expect(onFooterAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Use as Universal' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));
    expect(screen.queryByRole('button', { name: 'Use as Universal' })).not.toBeInTheDocument();
    expect(screen.getByText('Installed Paths')).toBeInTheDocument();
    expect(screen.getByText('Factory')).toBeInTheDocument();
  });

  it('shows the missing symlink destination path for repair rows', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill');
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {
      selectedProblemKey: 'missing-symlinks',
      selectedVariantPath: null,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    const list = screen.getByRole('list', { name: 'Missing Symlinks' });
    expect(within(list).getByText('Factory')).toBeInTheDocument();
    expect(within(list).getByTitle(packagePath('~/.skillindex/sandbox/.factory/skills/missing-symlink-skill.md'))).toBeInTheDocument();
  });

  it('renders broken symlink rows with the compact missing-symlink style', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill');
    if (!baseSkill) {
      throw new Error('Missing representative skill fixture: missing-symlink-skill');
    }
    const [canonicalLocation, claudeLocation] = baseSkill.locations;
    expect(canonicalLocation).toBeDefined();
    expect(claudeLocation).toBeDefined();

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

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    const list = screen.getByRole('list', { name: 'Broken Symlink' });
    expect(within(list).getByText('Claude Code')).toBeInTheDocument();
    expect(within(list).getByTitle(packagePath('~/.skillindex/sandbox/.claude/skills/broken-symlink-skill.md'))).toBeInTheDocument();
    expect(within(list).queryByRole('button', {
      name: /Open .*broken-symlink-skill in the default editor/i,
    })).not.toBeInTheDocument();
    expect(screen.queryByText(/Broken:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expected/i)).not.toBeInTheDocument();
  });

  it('renders wrong symlink target rows with the compact path and current target underneath', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'missing-symlink-skill');
    if (!baseSkill) {
      throw new Error('Missing representative skill fixture: missing-symlink-skill');
    }
    const [canonicalLocation, claudeLocation] = baseSkill.locations;
    expect(canonicalLocation).toBeDefined();
    expect(claudeLocation).toBeDefined();

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

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    const list = screen.getByRole('list', { name: 'Wrong Symlink Target' });
    expect(within(list).getByText('Claude Code')).toBeInTheDocument();
    expect(within(list).getByTitle(packagePath('~/.skillindex/sandbox/.claude/skills/wrong-symlink-target-skill.md'))).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', {
      name: /Open .*wrong-symlink-target-skill in the default editor/i,
    }));
    expect(openPathInEditorMock).toHaveBeenCalledWith(packagePath('~/.skillindex/sandbox/.claude/skills/wrong-symlink-target-skill.md'));
    expect(within(list).getByText('Points to', { exact: false })).toBeInTheDocument();
    expect(within(list).queryByTitle(`Points to ${packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md')}`)).not.toBeInTheDocument();
    expect(within(list).getByTitle(packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md'))).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', {
      name: /Open .*healthy-skill in the default editor/i,
    }));
    expect(openPathInEditorMock).toHaveBeenCalledWith(packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md'));
    expect(screen.queryByText(/Current target:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expected/i)).not.toBeInTheDocument();
  });

  it('renders a selected-version code block for missing universal skills and makes its filepath clickable', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'single-source-skill');
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath: null,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={() => undefined}
      />,
    );

    expect(screen.getByText('Detected Versions')).toBeInTheDocument();
    expect(screen.queryByText('Changed Files')).not.toBeInTheDocument();
    expect(screen.queryByText('Diff: Selected Version vs Universal')).not.toBeInTheDocument();
    expect(screen.getByText('name: single-source-skill')).toBeInTheDocument();
    expect(screen.getByText('Only Windsurf has this copy right now.')).toBeInTheDocument();

    const diffHeaderButton = document.querySelector('.detail-inspector-panel__diff-file-path-button');
    expect(diffHeaderButton).not.toBeNull();
    fireEvent.click(diffHeaderButton as HTMLButtonElement);
    expect(openPathInEditorMock).toHaveBeenCalledWith(`${packagePath('~/.skillindex/sandbox/.codeium/windsurf/skills/single-source-skill.md')}/SKILL.md`);
  });

  it('renders every changed file inline for missing universal skills', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'single-source-skill');
    expect(baseSkill).toBeDefined();
    const singleSourceLocation = baseSkill!.locations[0];
    expect(singleSourceLocation).toBeDefined();
    const installSource = baseSkill!.detailDiagnostics.installSources[0];
    expect(installSource).toBeDefined();

    const skill = withPackageFiles({
      ...baseSkill!,
      detailDiagnostics: {
        ...baseSkill!.detailDiagnostics,
        duplicateCandidates: [{
          ...singleSourceLocation,
          installSource,
        }],
      },
    }, {
      [packagePath('~/.skillindex/sandbox/.codeium/windsurf/skills/single-source-skill.md')]: {
        'SKILL.md': 'name: single-source-skill\ndescription: Windsurf only\n',
        'rules/example.md': 'Only Windsurf ships this helper.\n',
      },
    });

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: 'missing-canonical',
      selectedVariantPath: null,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={() => undefined}
      />,
    );

    expect(screen.queryByText('Changed Files')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*single-source-skill\/SKILL\.md in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*single-source-skill\/rules\/example\.md in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.getByText('name: single-source-skill')).toBeInTheDocument();
    expect(screen.getByText('description: Windsurf only')).toBeInTheDocument();
    expect(screen.getByText('Only Windsurf ships this helper.')).toBeInTheDocument();
  });

  it('keeps healthy skill inspectors minimal', () => {
    const baseSkill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'healthy-skill');
    expect(baseSkill).toBeDefined();
    const healthyPath = packagePath('~/.skillindex/sandbox/.agents/skills/healthy-skill.md');
    const skill = withPackageFiles(baseSkill!, {
      [healthyPath]: {
        'SKILL.md': [
          '---',
          'name: healthy-skill',
          'description: Healthy across every installed location.',
          '---',
          '# Healthy skill',
          'Healthy skill definition body.',
        ].join('\n'),
        'references/notes.md': 'Healthy supplemental notes.\n',
      },
    });
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill, sourceIndex, {
      selectedProblemKey: null,
      selectedVariantPath: null,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Problems')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selected detail')).toBeInTheDocument();
    expect(screen.getByText('No problems')).toBeInTheDocument();
    expect(screen.getByText('This skill is canonical and fully linked.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Definition' }));
    expect(screen.queryByText('No problems')).not.toBeInTheDocument();
    expect(screen.getByText('Healthy skill definition body.')).toBeInTheDocument();
    expect(screen.getByText('Healthy supplemental notes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {
      name: /Open .*healthy-skill\/references\/notes\.md in the default editor/i,
    }));
    expect(openPathInEditorMock).toHaveBeenCalledWith(`${healthyPath}/references/notes.md`);
  });

  it('renders MCP mismatch details with the same shared shell treatment', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'diagnostic-rich-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.claude.json',
    }, agentIndex);

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'diagnostic-rich-mcp', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Updated recently')).toBeInTheDocument();
    expect(screen.getAllByText('Definition Mismatch').length).toBeGreaterThan(0);
    expect(screen.getByText('1 problem')).toBeInTheDocument();
    expect(screen.getByText('Detected Definitions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claude Code .*\.claude\.json/i })).toBeInTheDocument();
    expect(screen.getByText('Definition Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Compared Fields')).toBeInTheDocument();
    expect(screen.getByText('Raw Configs')).toBeInTheDocument();
    expect(screen.getByText('claude-server.js')).toBeInTheDocument();
    expect(screen.getByText('canonical-server.js')).toBeInTheDocument();
    expect(screen.queryByText('Diff: Selected Definition vs Reference')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));
    expect(screen.getByText('Universal File')).toBeInTheDocument();
    expect(screen.getByText('Installed Paths')).toBeInTheDocument();
    expect(screen.queryByText('MCP Configs')).not.toBeInTheDocument();
    expect(screen.getAllByText('Definition Mismatch').length).toBeGreaterThan(0);
  });

  it('does not throw when open-path actions are clicked without the desktop bridge', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'diagnostic-rich-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '~/.skillindex/sandbox/.claude.json',
    }, agentIndex);

    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
        onVariantSelect={() => undefined}
      />,
    );

    const diffHeaderButton = document.querySelector('.detail-inspector-panel__diff-file-path-button');
    expect(diffHeaderButton).not.toBeNull();
    expect(() => fireEvent.click(diffHeaderButton as HTMLButtonElement)).not.toThrow();
  });

  it('renders disabled footer action reasons visibly', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'missing-from-agents-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, agentIndex);
    const reason = 'This MCP uses cwd, which OpenCode configs cannot preserve during resolution.';

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        footerActions={[{
          disabled: true,
          label: 'Add MCP to Agents',
          title: reason,
          variant: 'strong',
        }]}
        model={model}
        onClose={() => undefined}
      />,
    );

    const action = screen.getByRole('button', { name: /^Add MCP to Agents$/i });
    expect(action).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(action).toHaveAccessibleDescription(reason);
  });

  it('uses the summary slot only for disabled primary action reasons', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'identical-drift-skill');
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {
      selectedProblemKey: 'identical-copies',
      selectedVariantPath: null,
    }, agentIndex);
    const reason = 'Choose a Universal version first. Symlink repairs need a Universal target.';

    render(
      <DetailInspectorPanel
        footerActions={[{
          disabled: true,
          label: 'Convert Copies to Symlinks',
          title: reason,
          variant: 'strong',
        }]}
        model={model}
        onClose={() => undefined}
      />,
    );

    const action = screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i });
    const summary = document.querySelector('.detail-inspector-panel__action-summary');

    expect(summary).toHaveTextContent(reason);
    expect(screen.queryByText('This will replace 1 writable copy with a symlink to the Universal version.')).not.toBeInTheDocument();
    expect(action).toHaveAccessibleDescription(reason);
  });

  it('renders note footer actions as neutral guidance instead of buttons', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'broken-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'invalid-definition',
      selectedVariantPath: null,
    }, agentIndex);
    const helpText = 'Click a file name above to open it, then fix the definition.';

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        footerActions={[{
          label: helpText,
          variant: 'note',
        }]}
        model={model}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole('note')).toHaveTextContent(helpText);
    expect(screen.queryByRole('button', { name: helpText })).not.toBeInTheDocument();
  });

  it('marks a remove-only healthy detail footer action as end aligned', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'healthy-skill');
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {}, agentIndex);

    render(
      <DetailInspectorPanel
        footerActions={[{ label: 'Remove', shortcut: 'R', variant: 'danger' }]}
        model={model}
        onClose={() => undefined}
      />,
    );

    const footer = document.querySelector('.detail-inspector-panel__footer-block');
    const removeGroup = screen.getByRole('button', { name: /^Remove$/i })
      .closest('.detail-inspector-panel__footer-action-group');

    expect(screen.getByText('No problems')).toBeInTheDocument();
    expect(footer).toHaveClass('detail-inspector-panel__footer-block--with-remove');
    expect(removeGroup).toHaveClass(
      'detail-inspector-panel__footer-action-group--danger',
      'detail-inspector-panel__footer-action-group--end',
    );
  });

  it('renders dismiss and remove footer actions as a two-third and one-third action row', () => {
    const skill = representativeInventorySnapshot.skills.find((entry) => entry.name === 'identical-drift-skill');
    expect(skill).toBeDefined();

    const model = buildSkillInspectorModel(skill!, sourceIndex, {
      selectedProblemKey: 'identical-copies',
      selectedVariantPath: null,
    }, agentIndex);
    const onDismiss = vi.fn();
    const onRemove = vi.fn();

    render(
      <DetailInspectorPanel
        footerActions={[
          { label: 'Dismiss issues with this skill', onClick: onDismiss, shortcut: 'D', variant: 'subtle' },
          { label: 'Remove', onClick: onRemove, shortcut: 'R', variant: 'danger' },
        ]}
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    const footer = document.querySelector('.detail-inspector-panel__footer-block');
    const dismissButton = screen.getByRole('button', { name: /^Dismiss issues with this skill$/i });
    const removeButton = screen.getByRole('button', { name: /^Remove$/i });

    expect(footer).toHaveClass('detail-inspector-panel__footer-block--with-remove');
    expect(dismissButton.closest('.detail-inspector-panel__footer-action-group')).toHaveClass(
      'detail-inspector-panel__footer-action-group--secondary',
    );
    expect(removeButton.closest('.detail-inspector-panel__footer-action-group')).toHaveClass(
      'detail-inspector-panel__footer-action-group--danger',
    );
    expect(dismissButton).toHaveAttribute('aria-keyshortcuts', 'D');
    expect(removeButton).toHaveAttribute('aria-keyshortcuts', 'R');

    fireEvent.keyDown(window, { key: 'r' });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('renders MCP invalid-definition rows as a focused code surface', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'broken-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'invalid-definition',
      selectedVariantPath: null,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    expect(screen.getByText('Definition Issues')).toBeInTheDocument();
    expect(screen.getByText('Missing connection target.')).toBeInTheDocument();
    expect(screen.getByText('Universal')).toBeInTheDocument();
    expect(screen.getByText('~/.skillindex/sandbox/.agents/mcp.json')).toBeInTheDocument();
    expect(screen.getByText(/"broken-mcp"/i)).toBeInTheDocument();

    const snippetHeaderButton = document.querySelector('.detail-inspector-panel__inline-snippet .detail-inspector-panel__diff-file-path-button');
    expect(snippetHeaderButton).not.toBeNull();
    fireEvent.click(snippetHeaderButton as HTMLButtonElement);
    expect(openPathInEditorMock).toHaveBeenCalledWith('~/.skillindex/sandbox/.agents/mcp.json');
  });

  it('renders missing-from-agents rows with a clickable config path', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'missing-from-agents-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, agentIndex);

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    expect(screen.getByText('Affected Agents')).toBeInTheDocument();
    expect(screen.getByText('Factory')).toBeInTheDocument();
    expect(screen.queryByText('sandbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {
      name: /Open .*\.factory\/mcp\.json in the default editor/i,
    }));
    expect(openPathInEditorMock).toHaveBeenCalledWith('~/.skillindex/sandbox/.factory/mcp.json');
  });

  it('renders nonexistent missing-from-agents config paths as muted text', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'missing-from-agents-mcp');
    expect(mcp).toBeDefined();
    const unavailableAgentIndex = new Map(agentIndex);
    const factoryAgent = unavailableAgentIndex.get('sandbox-factory') as AgentRecord;
    unavailableAgentIndex.set('sandbox-factory', {
      ...factoryAgent,
      mcpConfigLocation: {
        ...factoryAgent.mcpConfigLocation,
        exists: false,
      },
    });

    const model = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'missing-from-agents',
      selectedVariantPath: null,
    }, unavailableAgentIndex);

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', {
      name: /Open .*\.factory\/mcp\.json in the default editor/i,
    })).not.toBeInTheDocument();
    expect(screen.getByText('~/.skillindex/sandbox/.factory/mcp.json')).toHaveClass('detail-inspector-panel__structural-path--missing');
  });

  it('renders the healthy MCP state with the same happy-state shell as skills', () => {
    const mcp = representativeInventorySnapshot.mcps?.find((entry) => entry.name === 'healthy-mcp');
    expect(mcp).toBeDefined();

    const model = buildMcpInspectorModel(mcp!, {}, agentIndex);

    render(
      <DetailInspectorPanel
        ariaLabel="MCP detail"
        entityKind="mcp"
        model={model}
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByLabelText('Problems')).not.toBeInTheDocument();
    expect(screen.getByText('No problems')).toBeInTheDocument();
    expect(screen.getByText('Defined in every agent the exact same way.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Definition' }));
    expect(screen.queryByText('No problems')).not.toBeInTheDocument();
    expect(screen.getByText('"healthy-server.js"')).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /Open .*\.agents\/mcp\.json in the default editor/i,
    })).not.toBeInTheDocument();
  });

  it('renders a focused frontmatter code surface for skill definition issues', () => {
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

    render(
      <DetailInspectorPanel
        model={model}
        onClose={() => undefined}
        onProblemSelect={() => undefined}
      />,
    );

    expect(screen.getByText('Definition Issues')).toBeInTheDocument();
    expect(screen.getByText('Missing required field: name')).toBeInTheDocument();
    expect(screen.getByText('Factory')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Open .*diagnostic-rich-skill\/SKILL\.md in the default editor/i,
    })).toBeInTheDocument();
    expect(screen.queryByText('Frontmatter')).not.toBeInTheDocument();
    expect(screen.getByText(/description: Factory copy with a description but missing a name field\./i)).toBeInTheDocument();

    const snippetHeaderButton = document.querySelector('.detail-inspector-panel__inline-snippet .detail-inspector-panel__diff-file-path-button');
    expect(snippetHeaderButton).not.toBeNull();
    fireEvent.click(snippetHeaderButton as HTMLButtonElement);
    expect(openPathInEditorMock).toHaveBeenCalledWith(`${packagePath('~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md')}/SKILL.md`);
  });
});

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
