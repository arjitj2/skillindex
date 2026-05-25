import type { AgentRecord, SeedRepresentativeFixturesResult, SkillInventorySnapshot } from '@shared/contracts';
import {
  KNOWN_AGENT_FAMILIES,
  deriveAgentDefaultHomeDir,
  resolveAgentHomeRelativePath,
} from '@shared/known-agent-catalog';

export const representativeInventorySnapshot: SkillInventorySnapshot = normalizeRepresentativeSkillPackagePaths({
  ...withSnapshotDetailDiagnostics({
  scannedAt: '2026-04-09T00:00:00.000Z',
  sourceIds: ['sandbox-agents', 'sandbox-codex', 'sandbox-cursor', 'sandbox-claude', 'sandbox-factory', 'sandbox-windsurf', 'sandbox-plugin-pack'],
  sources: [
    {
      id: 'sandbox-agents',
      label: 'Sandbox .agents',
      canonical: true,
      kind: 'canonical',
      writable: true,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.agents/skills',
    },
    {
      id: 'sandbox-codex',
      label: 'Sandbox .codex',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.codex/skills',
      ignoredSkillSubpaths: ['.system'],
    },
    {
      id: 'sandbox-cursor',
      label: 'Sandbox Cursor',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.cursor/skills',
    },
    {
      id: 'sandbox-claude',
      label: 'Sandbox Claude',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.claude/skills',
    },
    {
      id: 'sandbox-factory',
      label: 'Sandbox Factory',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.factory/skills',
    },
    {
      id: 'sandbox-windsurf',
      label: 'Sandbox Windsurf',
      canonical: false,
      kind: 'agent',
      writable: true,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/.codeium/windsurf/skills',
    },
    {
      id: 'sandbox-plugin-pack',
      label: 'Sandbox Plugin bundle',
      canonical: false,
      kind: 'plugin',
      writable: false,
      scope: 'sandbox',
      skillsDir: '~/.skillindex/sandbox/plugins/skills',
      plugin: {
        host: 'claude',
        pluginId: 'sandbox-plugin-pack',
        pluginName: 'sandbox-plugin-pack',
        version: '0.1.0',
        rootPath: '~/.skillindex/sandbox/plugins',
        manifestPath: '~/.skillindex/sandbox/plugins/.claude-plugin/plugin.json',
      },
    },
  ],
  plugins: [
    {
      host: 'claude',
      scope: 'sandbox',
      pluginId: 'sandbox-plugin-pack',
      pluginName: 'sandbox-plugin-pack',
      version: '0.1.0',
      rootPath: '~/.skillindex/sandbox/plugins',
      manifestPath: '~/.skillindex/sandbox/plugins/.claude-plugin/plugin.json',
      enabled: 'unknown',
      bundledSkills: [
        {
          name: 'mixed-plugin-skill',
          path: '~/.skillindex/sandbox/plugins/skills/mixed-plugin-skill.md',
          entrypointPath: '~/.skillindex/sandbox/plugins/skills/mixed-plugin-skill.md',
          sourceId: 'sandbox-plugin-pack',
        },
        {
          name: 'plugin-readonly-skill',
          path: '~/.skillindex/sandbox/plugins/skills/plugin-readonly-skill.md',
          entrypointPath: '~/.skillindex/sandbox/plugins/skills/plugin-readonly-skill.md',
          sourceId: 'sandbox-plugin-pack',
        },
      ],
      bundledMcps: [],
      unsupportedAssets: [
        {
          kind: 'hook',
          name: 'session-start',
          path: '~/.skillindex/sandbox/plugins/hooks/hooks.json',
          sourceId: 'sandbox-plugin-pack',
        },
      ],
      unsupportedHooksCount: 1,
      source: {
        repository: 'https://github.com/example/sandbox-plugin-pack',
      },
    },
  ],
  skills: [
    {
      name: 'diagnostic-rich-skill',
      structuralState: 'diverged-drift',
      isDrifted: true,
      driftPresentation: 'active',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-08T12:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md',
          contentHash: 'diag-a',
        },
        {
          path: '~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-08T12:00:02.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md',
          contentHash: 'diag-b',
        },
        {
          path: '~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md',
          sourceId: 'sandbox-factory',
          sourceLabel: 'Sandbox Factory',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-08T12:00:01.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md',
          contentHash: 'diag-c',
        },
      ],
      diff: {
        primaryPath: '~/.skillindex/sandbox/.claude/skills/diagnostic-rich-skill.md',
        primarySourceLabel: 'Sandbox Claude',
        comparisons: [
          {
            path: '~/.skillindex/sandbox/.agents/skills/diagnostic-rich-skill.md',
            sourceLabel: 'Sandbox .agents',
            lines: [
              {
                type: 'context',
                text: '---',
              },
              {
                type: 'context',
                text: 'name: diagnostic-rich-skill',
              },
              {
                type: 'removed',
                text: 'description: Canonical detail candidate.',
              },
              {
                type: 'added',
                text: 'description: Claude detail candidate.',
              },
              {
                type: 'context',
                text: '---',
              },
              {
                type: 'context',
                text: '# Diagnostic rich skill',
              },
              {
                type: 'removed',
                text: 'Canonical content.',
              },
              {
                type: 'added',
                text: 'Claude copy with its own description.',
              },
            ],
          },
          {
            path: '~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md',
            sourceLabel: 'Sandbox Factory',
            lines: [
              {
                type: 'context',
                text: '---',
              },
              {
                type: 'removed',
                text: 'description: Factory copy with a description but missing a name field.',
              },
              {
                type: 'added',
                text: 'name: diagnostic-rich-skill',
              },
              {
                type: 'added',
                text: 'description: Claude detail candidate.',
              },
              {
                type: 'context',
                text: '---',
              },
              {
                type: 'context',
                text: '# Diagnostic rich skill',
              },
              {
                type: 'removed',
                text: 'Factory copy missing the required name.',
              },
              {
                type: 'added',
                text: 'Claude copy with its own description.',
              },
            ],
          },
        ],
      },
    },
    {
      name: 'diverged-drift-skill',
      structuralState: 'diverged-drift',
      isDrifted: true,
      driftPresentation: 'active',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/diverged-drift-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T00:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/diverged-drift-skill.md',
          contentHash: 'aaa',
        },
        {
          path: '~/.skillindex/sandbox/.claude/skills/diverged-drift-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-04T00:00:02.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.claude/skills/diverged-drift-skill.md',
          contentHash: 'bbb',
        },
      ],
      diff: {
        primaryPath: '~/.skillindex/sandbox/.claude/skills/diverged-drift-skill.md',
        primarySourceLabel: 'Sandbox Claude',
        comparisons: [
          {
            path: '~/.skillindex/sandbox/.agents/skills/diverged-drift-skill.md',
            sourceLabel: 'Sandbox .agents',
            lines: [
              {
                type: 'context',
                text: '---',
              },
              {
                type: 'context',
                text: 'name: diverged-drift-skill',
              },
              {
                type: 'context',
                text: 'description: Canonical candidate content.',
              },
              {
                type: 'context',
                text: '---',
              },
              {
                type: 'context',
                text: '# Diverged drift skill',
              },
              {
                type: 'removed',
                text: 'Canonical candidate content.',
              },
              {
                type: 'added',
                text: 'Conflicting content from Claude.',
              },
            ],
          },
        ],
      },
    },
    {
      name: 'dismissed-drift-skill',
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'dismissed',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/dismissed-drift-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-05T00:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/dismissed-drift-skill.md',
          contentHash: 'fff',
        },
        {
          path: '~/.skillindex/sandbox/.claude/skills/dismissed-drift-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-05T00:00:01.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.claude/skills/dismissed-drift-skill.md',
          contentHash: 'fff',
        },
      ],
    },
    {
      name: 'healthy-skill',
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          contentHash: 'ccc',
        },
        {
          path: '~/.skillindex/sandbox/.codex/skills/healthy-skill.md',
          sourceId: 'sandbox-codex',
          sourceLabel: 'Sandbox .codex',
          sourceScope: 'sandbox',
          fileType: 'symlink',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          contentHash: 'ccc',
        },
        {
          path: '~/.skillindex/sandbox/.claude/skills/healthy-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'symlink',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          contentHash: 'ccc',
        },
        {
          path: '~/.skillindex/sandbox/.cursor/skills/healthy-skill.md',
          sourceId: 'sandbox-cursor',
          sourceLabel: 'Sandbox Cursor',
          sourceScope: 'sandbox',
          fileType: 'symlink',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          contentHash: 'ccc',
        },
        {
          path: '~/.skillindex/sandbox/.factory/skills/healthy-skill.md',
          sourceId: 'sandbox-factory',
          sourceLabel: 'Sandbox Factory',
          sourceScope: 'sandbox',
          fileType: 'symlink',
          modifiedAt: '2026-01-01T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          contentHash: 'ccc',
        },
      ],
    },
    {
      name: 'missing-symlink-skill',
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-02T12:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill.md',
          contentHash: 'msl-a',
        },
        {
          path: '~/.skillindex/sandbox/.claude/skills/missing-symlink-skill.md',
          sourceId: 'sandbox-claude',
          sourceLabel: 'Sandbox Claude',
          sourceScope: 'sandbox',
          fileType: 'symlink',
          modifiedAt: '2026-01-02T12:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill.md',
          contentHash: 'msl-a',
        },
      ],
    },
    {
      name: 'identical-drift-skill',
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'active',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/identical-drift-skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-03T00:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/identical-drift-skill.md',
          contentHash: 'ddd',
        },
        {
          path: '~/.skillindex/sandbox/.factory/skills/identical-drift-skill.md',
          sourceId: 'sandbox-factory',
          sourceLabel: 'Sandbox Factory',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-03T00:00:01.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.factory/skills/identical-drift-skill.md',
          contentHash: 'ddd',
        },
      ],
    },
    {
      name: 'MiXeD-Case-Skill',
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      locations: [
        {
          path: '~/.skillindex/sandbox/.agents/skills/MiXeD-Case-Skill.md',
          sourceId: 'sandbox-agents',
          sourceLabel: 'Sandbox .agents',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-06T00:00:00.000Z',
          canonical: true,
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/MiXeD-Case-Skill.md',
          contentHash: 'ggg',
        },
      ],
    },
    {
      name: 'mixed-plugin-skill',
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'active',
      locations: [
        {
          path: '~/.skillindex/sandbox/.factory/skills/mixed-plugin-skill.md',
          sourceId: 'sandbox-factory',
          sourceLabel: 'Sandbox Factory',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-06T00:00:30.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.factory/skills/mixed-plugin-skill.md',
          contentHash: 'jjj',
        },
        {
          path: '~/.skillindex/sandbox/plugins/skills/mixed-plugin-skill.md',
          sourceId: 'sandbox-plugin-pack',
          sourceLabel: 'Sandbox Plugin bundle',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-06T00:00:31.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/plugins/skills/mixed-plugin-skill.md',
          contentHash: 'jjj',
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'claude',
              pluginId: 'sandbox-plugin-pack',
              version: '0.1.0',
            },
            sourcePath: '~/.skillindex/sandbox/plugins/skills/mixed-plugin-skill.md',
            discoveredAt: '2026-01-06T00:00:31.000Z',
          },
          canonicalRole: 'canonical',
          mutability: 'read-only-managed',
        },
      ],
    },
    {
      name: 'plugin-readonly-skill',
      structuralState: 'single-source-noncanonical',
      isDrifted: false,
      driftPresentation: 'none',
      locations: [
        {
          path: '~/.skillindex/sandbox/plugins/skills/plugin-readonly-skill.md',
          sourceId: 'sandbox-plugin-pack',
          sourceLabel: 'Sandbox Plugin bundle',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-07T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/plugins/skills/plugin-readonly-skill.md',
          contentHash: 'iii',
          provenance: {
            kind: 'plugin',
            plugin: {
              host: 'claude',
              pluginId: 'sandbox-plugin-pack',
              version: '0.1.0',
            },
            sourcePath: '~/.skillindex/sandbox/plugins/skills/plugin-readonly-skill.md',
            discoveredAt: '2026-01-07T00:00:00.000Z',
          },
          canonicalRole: 'canonical',
          mutability: 'read-only-managed',
        },
      ],
    },
    {
      name: 'single-source-skill',
      structuralState: 'single-source-noncanonical',
      isDrifted: false,
      driftPresentation: 'none',
      locations: [
        {
          path: '~/.skillindex/sandbox/.codeium/windsurf/skills/single-source-skill.md',
          sourceId: 'sandbox-windsurf',
          sourceLabel: 'Sandbox Windsurf',
          sourceScope: 'sandbox',
          fileType: 'real-file',
          modifiedAt: '2026-01-02T00:00:00.000Z',
          canonical: false,
          resolvedPath: '~/.skillindex/sandbox/.codeium/windsurf/skills/single-source-skill.md',
          contentHash: 'eee',
          definitionText: [
            '---',
            'name: single-source-skill',
            'description: Installed in a single location outside the universal .agents folder.',
            '---',
            '# Single source skill',
            'Only Windsurf has this copy right now.',
          ].join('\n'),
        },
      ],
    },
  ],
  counts: {
    totalSkills: 10,
    driftedSkills: 5,
    healthySkills: 2,
    missingSymlinkSkills: 1,
    singleSourceSkills: 2,
    identicalDriftSkills: 3,
    divergedDriftSkills: 2,
    dismissedDriftSkills: 1,
  },
  mcps: [
    {
      name: 'broken-mcp',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch', 'invalid-definition'],
      signature: 'broken-mcp-signature',
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          args: ['missing-command.js'],
          invalidDetails: ['Missing connection target.'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "broken-mcp": {',
            '      "args": ["missing-command.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['recovered-command.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "broken-mcp": {',
            '      "command": "node",',
            '      "args": ["recovered-command.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'diagnostic-rich-mcp',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch'],
      signature: 'diagnostic-rich-mcp-signature',
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['canonical-server.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "node",',
            '      "args": ["canonical-server.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['claude-server.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "node",',
            '      "args": ["claude-server.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-codex',
          agentLabel: 'Sandbox Codex',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codex/config.toml',
          command: 'node',
          args: ['canonical-server.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "node",',
            '      "args": ["canonical-server.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-claude-desktop',
          agentLabel: 'Sandbox Claude Desktop',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/Library/Application Support/Claude/claude_desktop_config.json',
          command: 'node',
          args: ['canonical-server.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "node",',
            '      "args": ["canonical-server.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-cursor',
          agentLabel: 'Sandbox Cursor',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.cursor/mcp.json',
          command: 'node',
          args: ['canonical-server.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "node",',
            '      "args": ["canonical-server.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-windsurf',
          agentLabel: 'Sandbox Windsurf',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.codeium/windsurf/mcp_config.json',
          command: 'node',
          args: ['canonical-server.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "node",',
            '      "args": ["canonical-server.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          command: 'uvx',
          args: ['factory-server'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "diagnostic-rich-mcp": {',
            '      "command": "uvx",',
            '      "args": ["factory-server"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'muted-mcp',
      status: 'needs-attention',
      presentation: 'dismissed',
      issueReasons: ['definition-mismatch'],
      signature: 'muted-mcp-signature',
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['muted-server-v1.js'],
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          command: 'node',
          args: ['muted-server-v2.js'],
        },
      ],
    },
    {
      name: 'missing-from-agents-mcp',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['missing-from-agents'],
      expectedLocations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
        },
      ],
      missingLocations: [
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
        },
      ],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['missing-from-agents.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "missing-from-agents-mcp": {',
            '      "command": "node",',
            '      "args": ["missing-from-agents.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['missing-from-agents.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "missing-from-agents-mcp": {',
            '      "command": "node",',
            '      "args": ["missing-from-agents.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'claude-only-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      locations: [
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['claude-only-server.js'],
        },
      ],
    },
    {
      name: 'codex-only-mcp',
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
          args: ['codex-only-server.js'],
        },
      ],
    },
    {
      name: 'factory-only-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      locations: [
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          command: 'node',
          args: ['factory-only-server.js'],
        },
      ],
    },
    {
      name: 'healthy-mcp',
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
          args: ['healthy-server.js'],
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['healthy-server.js'],
        },
      ],
    },
    {
      name: 'healthy-remote-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          transport: 'http',
          url: 'https://example.test/mcp',
          args: [],
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          transport: 'http',
          url: 'https://example.test/mcp',
          args: [],
        },
      ],
      expectedLocations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
        },
        {
          agentId: 'sandbox-claude-desktop',
          agentLabel: 'Sandbox Claude Desktop',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/Library/Application Support/Claude/claude_desktop_config.json',
          supportStatus: 'unsupported',
          unsupportedReason: 'remote-mcp-not-supported',
          unsupportedTransport: 'http',
        },
      ],
      missingLocations: [],
    },
  ],
  mcpCounts: {
    totalMcps: 9,
    attentionMcps: 3,
    healthyMcps: 5,
    dismissedAttentionMcps: 1,
  },
  agents: buildRepresentativeAgents('~/.skillindex/sandbox', { cursorInstalled: true, windsurfInstalled: true }),
  agentCounts: buildAgentCounts(buildRepresentativeAgents('~/.skillindex/sandbox', { cursorInstalled: true, windsurfInstalled: true })),
  homeSummary: {
    skills: {
      total: 10,
      healthy: 4,
      needsAttention: 6,
    },
    mcps: {
      total: 9,
      healthy: 5,
      needsAttention: 4,
    },
    installedAgents: 6,
  },
  }),
});

export const representativeSeededFixtures: SeedRepresentativeFixturesResult = {
  fixtureSet: 'representative-agent-scan-foundation',
  sandboxRoot: '~/.skillindex/sandbox',
  ignoredPaths: [],
  skills: [
    {
      name: 'healthy-skill',
      expectedState: 'healthy',
      expectedLocationCount: 5,
    },
    {
      name: 'single-source-skill',
      expectedState: 'single-source-noncanonical',
      expectedLocationCount: 1,
    },
    {
      name: 'missing-symlink-skill',
      expectedState: 'missing-symlinks',
      expectedLocationCount: 2,
    },
    {
      name: 'identical-drift-skill',
      expectedState: 'identical-drift',
      expectedLocationCount: 2,
    },
    {
      name: 'dismissed-drift-skill',
      expectedState: 'identical-drift',
      expectedLocationCount: 2,
    },
    {
      name: 'diverged-drift-skill',
      expectedState: 'diverged-drift',
      expectedLocationCount: 2,
    },
    {
      name: 'diagnostic-rich-skill',
      expectedState: 'diverged-drift',
      expectedLocationCount: 3,
    },
    {
      name: 'MiXeD-Case-Skill',
      expectedState: 'healthy',
      expectedLocationCount: 1,
    },
    {
      name: 'mixed-plugin-skill',
      expectedState: 'identical-drift',
      expectedLocationCount: 2,
    },
    {
      name: 'plugin-readonly-skill',
      expectedState: 'single-source-noncanonical',
      expectedLocationCount: 1,
    },
  ],
};

function normalizeRepresentativeSkillPackagePaths(snapshot: SkillInventorySnapshot): SkillInventorySnapshot {
  return {
    ...snapshot,
    skills: snapshot.skills.map((skill) => {
      const locationPathAliases = new Map<string, string>();
      const normalizedLocations = skill.locations.map((location) => {
        const normalizedPath = normalizeSkillLocationPath(location.path, skill.name, location.sourceId, snapshot) ?? location.path;
        const normalizedResolvedPath = location.resolvedPath
          ? normalizeSkillLocationPath(location.resolvedPath, skill.name, location.sourceId, snapshot) ?? location.resolvedPath
          : undefined;
        const normalizedSymlinkTarget = location.symlinkTarget
          ? normalizeLooseSkillPackagePath(location.symlinkTarget)
          : undefined;

        locationPathAliases.set(location.path, normalizedPath);
        if (location.resolvedPath && normalizedResolvedPath) {
          locationPathAliases.set(location.resolvedPath, normalizedResolvedPath);
        }
        if (location.symlinkTarget && normalizedSymlinkTarget) {
          locationPathAliases.set(location.symlinkTarget, normalizedSymlinkTarget);
        }

        return {
          ...location,
          installKind: 'directory' as const,
          entrypointPath: `${normalizedPath}/SKILL.md`,
          path: normalizedPath,
          resolvedPath: normalizedResolvedPath,
          symlinkTarget: normalizedSymlinkTarget,
        };
      });

      return {
        ...skill,
        locations: normalizedLocations,
        diff: skill.diff
          ? {
              ...skill.diff,
              primaryPath: remapSkillPackagePath(skill.diff.primaryPath, locationPathAliases),
              baselinePath: remapSkillPackagePath(skill.diff.baselinePath, locationPathAliases),
              selectedPath: remapSkillPackagePath(skill.diff.selectedPath, locationPathAliases),
              comparisons: skill.diff.comparisons?.map((comparison) => ({
                ...comparison,
                path: remapSkillPackagePath(comparison.path, locationPathAliases) ?? comparison.path,
              })),
            }
          : skill.diff,
        detailDiagnostics: {
          ...skill.detailDiagnostics,
          duplicateCandidates: skill.detailDiagnostics.duplicateCandidates.map((candidate) => {
            const normalizedPath = normalizeSkillLocationPath(candidate.path, skill.name, candidate.sourceId, snapshot) ?? candidate.path;
            const normalizedResolvedPath = candidate.resolvedPath
              ? normalizeSkillLocationPath(candidate.resolvedPath, skill.name, candidate.sourceId, snapshot) ?? candidate.resolvedPath
              : undefined;
            const normalizedSymlinkTarget = candidate.symlinkTarget
              ? normalizeLooseSkillPackagePath(candidate.symlinkTarget)
              : undefined;

            locationPathAliases.set(candidate.path, normalizedPath);
            if (candidate.resolvedPath && normalizedResolvedPath) {
              locationPathAliases.set(candidate.resolvedPath, normalizedResolvedPath);
            }
            if (candidate.symlinkTarget && normalizedSymlinkTarget) {
              locationPathAliases.set(candidate.symlinkTarget, normalizedSymlinkTarget);
            }

            return {
              ...candidate,
              installKind: 'directory' as const,
              entrypointPath: `${normalizedPath}/SKILL.md`,
              path: normalizedPath,
              resolvedPath: normalizedResolvedPath,
              symlinkTarget: normalizedSymlinkTarget,
            };
          }),
          definitionIssues: skill.detailDiagnostics.definitionIssues?.map((issue) => ({
            ...issue,
            path: normalizeSkillLocationPath(issue.path, skill.name, issue.sourceId, snapshot) ?? issue.path,
            entrypointPath: normalizeSkillEntrypointPath(
              issue.entrypointPath ?? issue.path,
              skill.name,
              issue.sourceId,
              snapshot,
            ),
          })),
        },
      };
    }),
  };
}

function remapSkillPackagePath(value: string | undefined, aliases: Map<string, string>): string | undefined {
  if (!value) {
    return value;
  }

  return aliases.get(value) ?? normalizeLooseSkillPackagePath(value);
}

function normalizeSkillLocationPath(
  rawPath: string | undefined,
  skillName: string,
  sourceId: string,
  snapshot: SkillInventorySnapshot,
): string | undefined {
  if (!rawPath) {
    return undefined;
  }

  const normalizedLoosePath = normalizeLooseSkillPackagePath(rawPath);
  if (normalizedLoosePath !== rawPath) {
    return normalizedLoosePath;
  }

  const source = snapshot.sources.find((entry) => entry.id === sourceId);
  if (!source) {
    return rawPath;
  }

  const normalizedRawPath = rawPath.replace(/\/+$/, '');
  const normalizedSkillsDir = source.skillsDir.replace(/\/+$/, '');
  const normalizedSourceRoot = normalizedSkillsDir.endsWith('/skills')
    ? normalizedSkillsDir.slice(0, -'/skills'.length)
    : normalizedSkillsDir;

  if (normalizedRawPath === normalizedSkillsDir || normalizedRawPath === normalizedSourceRoot) {
    return `${normalizedSkillsDir}/${skillName}`;
  }

  return rawPath;
}

function normalizeLooseSkillPackagePath(rawPath: string | undefined): string {
  if (!rawPath) {
    return '';
  }

  return rawPath.endsWith('.md') ? rawPath.slice(0, -'.md'.length) : rawPath;
}

function normalizeSkillEntrypointPath(
  rawPath: string | undefined,
  skillName: string,
  sourceId: string,
  snapshot: SkillInventorySnapshot,
): string | undefined {
  if (!rawPath) {
    return undefined;
  }

  const packageRoot = rawPath.endsWith('/SKILL.md')
    ? rawPath.slice(0, -'/SKILL.md'.length)
    : rawPath;
  const normalizedPackageRoot = normalizeSkillLocationPath(packageRoot, skillName, sourceId, snapshot) ?? normalizeLooseSkillPackagePath(packageRoot);
  return normalizedPackageRoot ? `${normalizedPackageRoot}/SKILL.md` : rawPath;
}

type SkillRecordWithoutDetailDiagnostics = Omit<SkillInventorySnapshot['skills'][number], 'detailDiagnostics'>;
type SnapshotWithoutDetailDiagnostics = Omit<SkillInventorySnapshot, 'skills'> & {
  skills: SkillRecordWithoutDetailDiagnostics[];
};

function withSnapshotDetailDiagnostics(snapshot: SnapshotWithoutDetailDiagnostics): SkillInventorySnapshot {
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));

  return {
    ...snapshot,
    skills: snapshot.skills.map((skill) => ({
      ...skill,
      description: skill.description ?? getRepresentativeSkillDescription(skill.name),
        detailDiagnostics: {
          duplicateCandidates: skill.locations.length > 1
          ? skill.locations.map((location) => ({
            ...location,
            definitionText: location.definitionText ?? getRepresentativeSkillDefinitionText(skill.name, location.sourceId),
            installSource: createInstallSource(location, sourceIndex),
          }))
          : [],
        installSources: dedupeInstallSources(skill.locations, sourceIndex),
        missingInstallSources: getRepresentativeMissingInstallSources(skill.name, sourceIndex),
        definitionIssues: skill.name === 'diagnostic-rich-skill'
          ? [
            {
              type: 'missing-required-field' as const,
              field: 'name' as const,
              path: '~/.skillindex/sandbox/.factory/skills/diagnostic-rich-skill.md',
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: createInstallSource(skill.locations[2], sourceIndex),
            },
          ]
          : [],
      },
    })),
  };
}

function getRepresentativeSkillDescription(skillName: string): string | null {
  const descriptions: Record<string, string> = {
    'diagnostic-rich-skill': 'Canonical detail candidate.',
    'diverged-drift-skill': 'Canonical candidate content.',
    'dismissed-drift-skill': 'Shared copy currently hidden from review.',
    'healthy-skill': 'Healthy across every installed location.',
    'identical-drift-skill': 'Two file copies currently match exactly.',
    'missing-symlink-skill': 'Universal copy exists but one installed link is still missing.',
    'mixed-plugin-skill': 'Plugin-managed copy with an extra installed file.',
    'plugin-readonly-skill': 'Read-only plugin skill outside the universal .agents folder.',
    'single-source-skill': 'Installed in a single location outside the universal .agents folder.',
    'MiXeD-Case-Skill': 'Case-sensitive install that still resolves cleanly.',
  };

  return descriptions[skillName] ?? null;
}

function getRepresentativeSkillDefinitionText(skillName: string, sourceId: string): string | undefined {
  const definitions: Record<string, Record<string, string>> = {
    'diagnostic-rich-skill': {
      'sandbox-agents': [
        '---',
        'name: diagnostic-rich-skill',
        'description: Canonical detail candidate.',
        '---',
        '# Diagnostic rich skill',
        'Canonical content.',
      ].join('\n'),
      'sandbox-claude': [
        '---',
        'name: diagnostic-rich-skill',
        'description: Claude detail candidate.',
        '---',
        '# Diagnostic rich skill',
        'Claude copy with its own description.',
      ].join('\n'),
      'sandbox-factory': [
        '---',
        'description: Factory copy with a description but missing a name field.',
        '---',
        '# Diagnostic rich skill',
        'Factory copy missing the required name.',
      ].join('\n'),
    },
    'diverged-drift-skill': {
      'sandbox-agents': [
        '---',
        'name: diverged-drift-skill',
        'description: Canonical candidate content.',
        '---',
        '# Diverged drift skill',
        'Canonical candidate content.',
      ].join('\n'),
      'sandbox-claude': [
        '---',
        'name: diverged-drift-skill',
        'description: Canonical candidate content.',
        '---',
        '# Diverged drift skill',
        'Conflicting content from Claude.',
      ].join('\n'),
    },
  };

  return definitions[skillName]?.[sourceId];
}

function getRepresentativeMissingInstallSources(
  skillName: string,
  sourceIndex: Map<string, SkillInventorySnapshot['sources'][number]>,
) {
  if (skillName !== 'missing-symlink-skill') {
    return [];
  }

  const source = sourceIndex.get('sandbox-factory');
  if (!source) {
    return [];
  }

  return [
    {
      sourceId: source.id,
      label: source.label,
      kind: source.kind,
      scope: source.scope,
      writable: source.writable,
      canonical: source.canonical,
    },
  ];
}

function dedupeInstallSources(
  locations: SkillInventorySnapshot['skills'][number]['locations'],
  sourceIndex: Map<string, SkillInventorySnapshot['sources'][number]>,
) {
  const installSources = new Map<string, ReturnType<typeof createInstallSource>>();

  for (const location of locations) {
    if (!installSources.has(location.sourceId)) {
      installSources.set(location.sourceId, createInstallSource(location, sourceIndex));
    }
  }

  return [...installSources.values()];
}

function createInstallSource(
  location: SkillInventorySnapshot['skills'][number]['locations'][number],
  sourceIndex: Map<string, SkillInventorySnapshot['sources'][number]>,
) {
  const source = sourceIndex.get(location.sourceId);

  return {
    sourceId: location.sourceId,
    label: location.sourceLabel,
    kind: source?.kind ?? 'custom',
    scope: location.sourceScope,
    writable: source?.writable ?? false,
    canonical: location.canonical,
  };
}

function buildRepresentativeAgents(
  rootDir: string,
  options: { cursorInstalled?: boolean; windsurfInstalled?: boolean } = {},
): AgentRecord[] {
  return KNOWN_AGENT_FAMILIES.map((family) => {
    const id = `sandbox-${family.family}`;
    const installState: AgentRecord['installState'] =
      family.family === 'codex'
      || family.family === 'claude'
      || family.family === 'claude-desktop'
      || (family.family === 'cursor' && options.cursorInstalled)
      || family.family === 'factory'
      || (family.family === 'windsurf' && options.windsurfInstalled)
        ? 'installed'
        : 'not-installed';

    return {
      id,
      family: family.family,
      label: family.label,
      writable: true,
      scope: 'sandbox',
      installState,
      defaultProjectSkillsDir: family.defaultProjectSkillsDir,
      defaultGlobalSkillsDir: family.defaultGlobalSkillsDir,
      defaultHomeDir: family.skillStorageKind === 'local-directory'
        ? deriveAgentDefaultHomeDir(family.defaultProjectSkillsDir, family.defaultGlobalSkillsDir)
        : '',
      mcpConfigKind: family.mcpConfigKind,
      mcpParserKind: family.mcpParserKind,
      mcpSupportedTransports: family.mcpSupportedTransports,
      metadataSources: family.metadataSources,
      icon: family.icon,
      skillsLocation: family.skillStorageKind === 'local-directory'
        ? {
            state: 'available',
            path: resolveAgentHomeRelativePath(rootDir, family.defaultGlobalSkillsDir),
            exists: installState === 'installed',
          }
        : {
            state: 'unavailable',
            exists: false,
            reason: 'account-managed',
          },
      mcpConfigLocation: family.mcpConfigRelativeParts
        ? {
            state: 'available',
            path: joinPreviewPath(rootDir, ...family.mcpConfigRelativeParts),
            exists: installState === 'installed',
          }
        : {
            state: 'unavailable',
            exists: false,
            reason: 'not-supported',
          },
      configLocation: family.agentConfigRelativeParts
        ? {
            state: 'available',
            path: joinPreviewPath(rootDir, ...family.agentConfigRelativeParts),
            exists: installState === 'installed',
          }
        : {
            state: 'unavailable',
            exists: false,
            reason: 'not-supported',
          },
      executableLocation: family.expectedExecutableNames?.[0]
        ? {
            state: 'available',
            path: joinPreviewPath(rootDir, 'bin', family.expectedExecutableNames[0]),
            exists: installState === 'installed',
          }
        : {
            state: 'unavailable',
            exists: false,
            reason: 'not-supported',
          },
    };
  });
}

function buildAgentCounts(agents: AgentRecord[]) {
  return {
    totalAgents: agents.length,
    installedAgents: agents.filter((agent) => agent.installState === 'installed').length,
    notInstalledAgents: agents.filter((agent) => agent.installState === 'not-installed').length,
  };
}

function joinPreviewPath(rootDir: string, ...parts: string[]): string {
  return [rootDir.replace(/\/+$/, ''), ...parts].join('/');
}
