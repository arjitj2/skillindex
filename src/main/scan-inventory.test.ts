// @vitest-environment node

import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { AGENT_CATALOG } from '@shared/agent-catalog';
import {
  dismissDrift,
  readCachedInventory,
  readCachedInventorySync,
  scanInventory,
} from '@main/scan-inventory';
import { reconcileWatchedSkillInventoryEvent } from '@main/skill-inventory';
import { resolveSandboxSkillIndexPaths, resolveSkillIndexPaths, writeSkillIndexConfig } from '@shared/skill-index-paths';

function anyValue(value: ArrayConstructor): unknown {
  return expect.any(value);
}

function arrayContaining(values: Parameters<typeof expect.arrayContaining>[0]): unknown {
  return expect.arrayContaining(values);
}

function objectContaining(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}

function stringContaining(value: string): unknown {
  return expect.stringContaining(value);
}

function stringMatching(pattern: RegExp): unknown {
  return expect.stringMatching(pattern);
}

describe('representative-agent scan foundation', () => {
  it('reads Codex MCP definitions from config.toml and treats empty Codex configs as parseable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-codex-mcp-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), [
      'model = "gpt-5"',
      '',
      '[mcp_servers.codexLocal]',
      'command = "node"',
      'args = ["codex-local.js", "--verbose"]',
      '',
      '[mcp_servers.openaiDeveloperDocs]',
      'url = "https://developers.openai.com/mcp"',
      '',
    ].join('\n'), 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'codexLocal')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-codex',
          command: 'node',
          args: ['codex-local.js', '--verbose'],
          transport: 'stdio',
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'openaiDeveloperDocs')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-codex',
          url: 'https://developers.openai.com/mcp',
          transport: 'http',
        }),
      ],
    });

    await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
      servers: {
        sharedOnly: {
          command: 'node',
          args: ['shared-only.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), 'model = "gpt-5"\n', 'utf8');

    const missingInventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(missingInventory.mcps?.find((mcp) => mcp.name === 'sharedOnly')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      missingLocations: arrayContaining([
        objectContaining({ agentId: 'sandbox-codex' }),
      ]),
    });
    expect(missingInventory.mcps?.find((mcp) => mcp.name === 'Codex MCP config')).toBeUndefined();
  });

  it('does not require Claude Desktop locations for remote MCPs while still requiring local MCPs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-claude-desktop-remote-mcp-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
      SKILL_INDEX_AGENT_SUBSET: 'codex,claude-desktop',
    };
    const paths = resolveSkillIndexPaths({ env });
    const claudeDesktopConfigPath = path.join(
      paths.sandboxRoot,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );

    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
    await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
    await mkdir(path.dirname(claudeDesktopConfigPath), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
      servers: {
        remoteDocs: {
          type: 'http',
          url: 'https://example.test/mcp',
        },
        localDocs: {
          command: 'node',
          args: ['local-docs.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), [
      '[mcp_servers.remoteDocs]',
      'url = "https://example.test/mcp"',
      '',
      '[mcp_servers.localDocs]',
      'command = "node"',
      'args = ["local-docs.js"]',
      '',
    ].join('\n'), 'utf8');
    await writeFile(claudeDesktopConfigPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'remoteDocs')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      missingLocations: [],
      expectedLocations: arrayContaining([
        objectContaining({
          agentId: 'sandbox-claude-desktop',
          supportStatus: 'unsupported',
          unsupportedReason: 'remote-mcp-not-supported',
        }),
      ]),
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'localDocs')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      missingLocations: arrayContaining([
        objectContaining({
          agentId: 'sandbox-claude-desktop',
          configPath: claudeDesktopConfigPath,
        }),
      ]),
    });
  });

  it('distinguishes unsupported remote transports from agents with no remote MCP support', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-partial-remote-mcp-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
      SKILL_INDEX_AGENT_SUBSET: 'codex,claude-desktop',
    };
    const paths = resolveSkillIndexPaths({ env });
    const claudeDesktopConfigPath = path.join(
      paths.sandboxRoot,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
    const claudeDesktopFamily = AGENT_CATALOG.find((family) => family.family === 'claude-desktop');
    if (!claudeDesktopFamily) {
      throw new Error('Missing Claude Desktop catalog entry.');
    }
    const previousSupportedTransports = claudeDesktopFamily.mcpSupportedTransports;

    try {
      (claudeDesktopFamily as { mcpSupportedTransports?: string[] }).mcpSupportedTransports = ['stdio', 'streamable-http'];
      await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
      await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
      await mkdir(path.dirname(claudeDesktopConfigPath), { recursive: true });
      await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
        servers: {
          eventStreamDocs: {
            transport: 'sse',
            url: 'https://example.test/sse',
          },
        },
      }, null, 2)}\n`, 'utf8');
      await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), [
        '[mcp_servers.eventStreamDocs]',
        'transport = "sse"',
        'url = "https://example.test/sse"',
        '',
      ].join('\n'), 'utf8');
      await writeFile(claudeDesktopConfigPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, 'utf8');

      const inventory = await scanInventory({
        paths,
        env,
        includeSandboxSources: true,
        includeLiveSources: false,
      });

      expect(inventory.mcps?.find((mcp) => mcp.name === 'eventStreamDocs')).toMatchObject({
        status: 'healthy',
        issueReasons: [],
        missingLocations: [],
        expectedLocations: arrayContaining([
          objectContaining({
            agentId: 'sandbox-claude-desktop',
            supportStatus: 'unsupported',
            unsupportedReason: 'transport-not-supported',
            unsupportedTransport: 'sse',
          }),
        ]),
      });
    } finally {
      (claudeDesktopFamily as { mcpSupportedTransports?: readonly string[] }).mcpSupportedTransports = previousSupportedTransports;
    }
  });

  it('reads OpenCode MCP definitions from the current command-array schema', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-opencode-mcp-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
        SKILL_INDEX_AGENT_SUBSET: 'opencode',
      },
    });
    const opencodeConfigPath = path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json');

    await mkdir(path.dirname(opencodeConfigPath), { recursive: true });
    await writeFile(opencodeConfigPath, `${JSON.stringify({
      mcp: {
        localDocs: {
          type: 'local',
          command: ['npx', '-y', 'local-docs-mcp'],
          environment: {
            DOCS_TOKEN: 'secret',
          },
        },
        remoteDocs: {
          type: 'remote',
          url: 'https://docs.example.test/mcp',
          headers: {
            Authorization: 'Bearer token',
          },
        },
      },
    }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'opencode',
      },
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'localDocs')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-opencode',
          command: 'npx',
          args: ['-y', 'local-docs-mcp'],
          transport: 'stdio',
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'remoteDocs')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-opencode',
          url: 'https://docs.example.test/mcp',
          transport: 'http',
        }),
      ],
    });
  });

  it('marks MCPs with failed connectivity as needing attention', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-connectivity-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
      servers: {
        failingConnection: {
          command: 'node',
          args: ['failing-server.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      verifyMcpConnectivity: () => Promise.resolve({
        status: 'failed',
        checkedAt: '2026-05-04T12:00:00.000Z',
        latencyMs: 42,
        error: 'Process exited before initialization.',
      }),
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'failingConnection')).toMatchObject({
      status: 'needs-attention',
      issueReasons: arrayContaining(['connection-failed']),
      locations: arrayContaining([
        objectContaining({
          connectivity: {
            status: 'failed',
            checkedAt: '2026-05-04T12:00:00.000Z',
            latencyMs: 42,
            error: 'Process exited before initialization.',
          },
        }),
      ]),
    });
  });

  it('does not probe MCP definitions that are already statically invalid', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-invalid-skip-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    let probeCount = 0;

    await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
      servers: {
        invalidConnection: {
          type: 'stdio',
        },
      },
    }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      verifyMcpConnectivity: () => {
        probeCount += 1;
        return Promise.resolve({
          status: 'verified',
          checkedAt: '2026-05-04T12:00:00.000Z',
          latencyMs: 1,
        });
      },
    });

    expect(probeCount).toBe(0);
    const invalidMcp = inventory.mcps?.find((mcp) => mcp.name === 'invalidConnection');
    expect(invalidMcp).toMatchObject({
      status: 'needs-attention',
      issueReasons: arrayContaining(['invalid-definition']),
    });
    expect(invalidMcp?.locations[0]?.connectivity).toBeUndefined();
  });

  it('treats native MCP metadata as healthy when universal agentLocal records it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-metadata-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
    await mkdir(path.join(paths.sandboxRoot, '.claude'), { recursive: true });
    await mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
      servers: {
        stitch: {
          type: 'http',
          url: 'https://stitch.googleapis.com/mcp',
          headers: {
            'X-Goog-Api-Key': 'test-key',
          },
          agentLocal: {
            factory: {
              disabled: false,
            },
          },
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.claude.json'), `${JSON.stringify({
      mcpServers: {
        stitch: {
          type: 'http',
          url: 'https://stitch.googleapis.com/mcp',
          headers: {
            'X-Goog-Api-Key': 'test-key',
          },
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'mcp.json'), `${JSON.stringify({
      mcpServers: {
        stitch: {
          disabled: false,
          type: 'http',
          url: 'https://stitch.googleapis.com/mcp',
          headers: {
            'X-Goog-Api-Key': 'test-key',
          },
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const stitch = inventory.mcps?.find((mcp) => mcp.name === 'stitch');

    expect(stitch).toMatchObject({
      status: 'healthy',
      issueReasons: [],
    });
    expect(stitch?.locations.find((location) => location.agentId === 'sandbox-factory')?.definitionText)
      .toContain('"disabled": false');
  });

  it('marks agent-only MCP definitions as missing universal instead of missing from agents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-missing-universal-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const factoryConfigPath = path.join(paths.sandboxRoot, '.factory', 'mcp.json');

    await mkdir(path.dirname(factoryConfigPath), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');
    await writeFile(factoryConfigPath, `${JSON.stringify({
      mcpServers: {
        localOnly: {
          command: 'node',
          args: ['local-only.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'localOnly')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      missingLocations: [],
    });
  });

  it('treats agent-specific native field drift as agreement when core fields match', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-native-mismatch-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const factoryConfigPath = path.join(paths.sandboxRoot, '.factory', 'mcp.json');

    await mkdir(path.dirname(agentsConfigPath), { recursive: true });
    await mkdir(path.dirname(factoryConfigPath), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');
    await writeFile(agentsConfigPath, `${JSON.stringify({
      servers: {
        nativeMismatch: {
          command: 'node',
          args: ['server.js'],
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(factoryConfigPath, `${JSON.stringify({
      mcpServers: {
        nativeMismatch: {
          command: 'node',
          args: ['server.js'],
          disabled: false,
        },
      },
    }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'nativeMismatch')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      locations: arrayContaining([
        objectContaining({
          agentId: 'sandbox-factory',
          agentLocalKey: 'factory',
          nativeDefinition: {
            disabled: false,
          },
        }),
      ]),
    });
  });

  it('ignores universal agentLocal drift in MCP dismissal signatures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-agent-local-signature-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
      SKILL_INDEX_AGENT_SUBSET: 'codex,factory',
    };
    const paths = resolveSkillIndexPaths({ env });
    const agentsConfigPath = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const codexConfigPath = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const factoryConfigPath = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const writeUniversalConfig = async (timeoutMs: number) => {
      await writeFile(agentsConfigPath, `${JSON.stringify({
        servers: {
          nativeMismatch: {
            command: 'node',
            args: ['server.js'],
            agentLocal: {
              factory: {
                startup_timeout_ms: timeoutMs,
              },
            },
          },
        },
      }, null, 2)}\n`, 'utf8');
    };

    await mkdir(path.dirname(agentsConfigPath), { recursive: true });
    await mkdir(path.dirname(codexConfigPath), { recursive: true });
    await mkdir(path.dirname(factoryConfigPath), { recursive: true });
    await writeFile(codexConfigPath, 'model = "gpt-5"\n', 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');
    await writeUniversalConfig(1_000);
    await writeFile(factoryConfigPath, `${JSON.stringify({
      mcpServers: {
        nativeMismatch: {
          command: 'node',
          args: ['server.js'],
          startup_timeout_ms: 2_000,
        },
      },
    }, null, 2)}\n`, 'utf8');

    const firstInventory = await scanInventory({
      paths,
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const firstSignature = firstInventory.mcps?.find((mcp) => mcp.name === 'nativeMismatch')?.signature;

    await writeUniversalConfig(3_000);
    const secondInventory = await scanInventory({
      paths,
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const secondSignature = secondInventory.mcps?.find((mcp) => mcp.name === 'nativeMismatch')?.signature;

    expect(firstInventory.mcps?.find((mcp) => mcp.name === 'nativeMismatch')?.issueReasons)
      .toEqual(['missing-from-agents']);
    expect(secondInventory.mcps?.find((mcp) => mcp.name === 'nativeMismatch')?.issueReasons)
      .toEqual(['missing-from-agents']);
    expect(firstSignature).toBeTruthy();
    expect(secondSignature).toBeTruthy();
    expect(secondSignature).toBe(firstSignature);
  });

  it('compares MCP definitions using portable launch, cwd, and auth fields only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-mcp-portable-fields-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
    await mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), [
      '[mcp_servers.blitz-macos]',
      'command = "/Users/tester/.blitz/blitz-macos-mcp"',
      'cwd = "/Users/tester/.blitz/mcps"',
      'enabled_tools = ["app_get_state", "project_open"]',
      'tool_timeout_sec = 120',
      '',
    ].join('\n'), 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'mcp.json'), `${JSON.stringify({
      mcpServers: {
        'blitz-macos': {
          type: 'stdio',
          command: '/Users/tester/.blitz/blitz-macos-mcp',
          args: [],
          cwd: '/Users/tester/.blitz/mcps',
          disabled: false,
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const blitz = inventory.mcps?.find((mcp) => mcp.name === 'blitz-macos');
    expect(blitz).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
    });
    expect(new Set(blitz?.locations.map((location) => location.coreDefinitionComparisonKey)).size).toBe(1);
  });

  it('treats Codex nested auth headers and implied HTTP transport as equivalent to JSON MCP definitions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-codex-remote-mcp-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.agents', 'mcp.json'), `${JSON.stringify({
      servers: {
        stitch: {
          headers: {
            'X-Goog-Api-Key': 'secret',
          },
          type: 'http',
          url: 'https://stitch.googleapis.com/mcp',
        },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), [
      '[mcp_servers.stitch]',
      'url = "https://stitch.googleapis.com/mcp"',
      '',
      '[mcp_servers.stitch.http_headers]',
      '"X-Goog-Api-Key" = "secret"',
      '',
    ].join('\n'), 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const stitch = inventory.mcps?.find((mcp) => mcp.name === 'stitch');
    expect(stitch).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      locations: arrayContaining([
        objectContaining({
          agentId: 'sandbox-codex',
          transport: 'http',
          url: 'https://stitch.googleapis.com/mcp',
          definitionText: JSON.stringify({
            headers: {
              'X-Goog-Api-Key': 'secret',
            },
            url: 'https://stitch.googleapis.com/mcp',
          }, null, 2),
        }),
      ]),
    });
  });

  it('seeds deterministic sandbox fixtures and classifies grouped markdown inventory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const seeded = await seedRepresentativeFixtures({ paths });
    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(seeded.fixtureSet).toBe('representative-agent-scan-foundation');
    expect(seeded.ignoredPaths).toHaveLength(2);
    expect(inventory.skills).toHaveLength(89);
    expect(inventory.skills.map((skill) => skill.name)).toEqual(expect.arrayContaining([
      'broken-symlink-skill',
      'double-broken-symlink-skill',
      'double-diverged-copies-skill',
      'double-identical-copies-skill',
      'double-invalid-definition-skill',
      'double-missing-canonical-skill',
      'double-missing-symlink-skill',
      'double-wrong-symlink-target-skill',
      'diagnostic-rich-skill',
      'dismissed-drift-skill',
      'diverged-drift-skill',
      'healthy-skill',
      'identical-drift-skill',
      'invalid-definition-skill',
      'invalid-description-length-skill',
      'invalid-name-leading-hyphen-skill',
      'invalid-name-length-skill',
      'invalid-name-special-char-skill',
      'invalid-name-trailing-hyphen-skill',
      'invalid-name-uppercase-skill',
      'MiXeD-Case-Skill',
      'multi-invalid-definition-skill',
      'multi-file-combo-drift-skill',
      'multi-file-entrypoint-drift-skill',
      'multi-file-support-drift-skill',
      'missing-symlink-skill',
      'mixed-plugin-skill',
      'partial-folder-symlink-drift-skill',
      'partial-folder-symlink-skill',
      'plugin-manual-diverged-skill',
      'plugin-manual-identical-skill',
      'plugin-readonly-skill',
      'example-workflow-kit:idea-shaping',
      'example-workflow-kit:handoff-notes',
      'example-workflow-kit:handoff-notes-with-static',
      'example-workflow-kit:handoff-notes-with-two-statics',
      'example-workflow-kit:overlap-check',
      'signal-tools:signal-mapping',
      'signal-tools:static-plugin-choice',
      'data-lens:data-sketch',
      'alloy-kit:alloy-planner',
      'alloy-kit:release-notes',
      'version-shadow-kit:cache-shadow',
      'single-source-skill',
      'wrong-symlink-target-skill',
      'representative-healthy-skill-37',
      'representative-identical-drift-skill-04',
      'representative-diverged-drift-skill-02',
      'representative-dismissed-drift-skill-01',
    ]));
    expect(inventory.skills.find((skill) => skill.name === 'diagnostic-rich-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      locations: anyValue(Array),
    });
    expect(inventory.skills.find((skill) => skill.name === 'healthy-skill')).toBeDefined();
    const claudeExamplePlugin = (inventory.plugins ?? []).find((plugin) =>
      plugin.host === 'claude' && plugin.pluginName === 'example-workflow-kit');
    expect(claudeExamplePlugin).toMatchObject({
      scope: 'sandbox',
      pluginId: 'example-workflow-kit@sandbox-gallery',
      pluginName: 'example-workflow-kit',
    });
    expect(inventory.plugins ?? []).toEqual(arrayContaining([
      objectContaining({
        host: 'codex',
        pluginId: 'example-workflow-kit@sandbox-curated',
        bundledSkills: arrayContaining([
          objectContaining({ name: 'idea-shaping' }),
          objectContaining({ name: 'overlap-check' }),
        ]),
      }),
      objectContaining({
        host: 'codex',
        pluginId: 'signal-tools@sandbox-curated',
        bundledSkills: arrayContaining([objectContaining({ name: 'signal-mapping' })]),
        bundledMcps: arrayContaining([objectContaining({ name: 'signalMap' })]),
        unsupportedHooksCount: 2,
      }),
      objectContaining({
        host: 'codex',
        pluginId: 'hook-lab@sandbox-curated',
        bundledSkills: [],
        bundledMcps: [],
        unsupportedHooksCount: 2,
      }),
      objectContaining({
        host: 'claude',
        pluginId: 'data-lens@sandbox-gallery',
        bundledSkills: arrayContaining([objectContaining({ name: 'data-sketch' })]),
        bundledMcps: [],
        unsupportedHooksCount: 0,
      }),
      objectContaining({
        host: 'claude',
        pluginId: 'relay-hub@sandbox-gallery',
        bundledSkills: [],
        bundledMcps: arrayContaining([objectContaining({ name: 'relayHub' })]),
        unsupportedHooksCount: 0,
      }),
      objectContaining({
        host: 'claude',
        pluginId: 'alloy-kit@sandbox-gallery',
        bundledSkills: arrayContaining([
          objectContaining({ name: 'alloy-planner' }),
          objectContaining({ name: 'release-notes' }),
        ]),
        bundledMcps: arrayContaining([objectContaining({ name: 'alloyPlanner' })]),
        unsupportedHooksCount: 2,
      }),
      objectContaining({
        host: 'claude',
        pluginId: 'version-shadow-kit@sandbox-gallery',
        bundledSkills: arrayContaining([objectContaining({ name: 'cache-shadow' })]),
        bundledMcps: [],
        unsupportedHooksCount: 0,
      }),
    ]));
    expect((inventory.plugins ?? []).filter((plugin) => plugin.pluginName === 'example-workflow-kit')
      .map((plugin) => plugin.host).sort()).toEqual(['claude', 'codex']);
    const examplePluginSkill = inventory.skills.find((skill) => skill.name === 'example-workflow-kit:idea-shaping');
    expect(examplePluginSkill?.structuralState).toBe('missing-symlinks');
    expect(examplePluginSkill?.isDrifted).toBe(true);
    expect(examplePluginSkill?.issueReasons).toEqual(['missing-symlinks']);
    expect(examplePluginSkill?.locations).toHaveLength(2);
    expect(examplePluginSkill?.locations.map((location) => location.provenance?.plugin?.host).sort()).toEqual(['claude', 'codex']);
    const versionShadowSkill = inventory.skills.find((skill) => skill.name === 'version-shadow-kit:cache-shadow');
    expect(versionShadowSkill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
    });
    expect(versionShadowSkill?.locations).toHaveLength(2);
    expect(versionShadowSkill?.locations
      .map((location) => location.provenance?.plugin?.version)
      .sort()).toEqual(['1.0.0', '1.1.0']);
    expect(versionShadowSkill?.detailDiagnostics.duplicateCandidates).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'mixed-plugin-skill')).toMatchObject({
      structuralState: 'identical-drift',
      issueReasons: arrayContaining(['identical-copies']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'plugin-manual-identical-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
    });
    expect(inventory.skills.find((skill) => skill.name === 'plugin-manual-diverged-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies', 'missing-symlinks']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'example-workflow-kit:overlap-check')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies', 'missing-symlinks']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'example-workflow-kit:handoff-notes')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies', 'missing-symlinks']),
      locations: arrayContaining([
        objectContaining({
          provenance: objectContaining({
            plugin: objectContaining({ host: 'codex' }),
          }),
        }),
        objectContaining({
          provenance: objectContaining({
            plugin: objectContaining({ host: 'claude' }),
          }),
        }),
      ]),
    });
    const twoPluginsOneStaticSkill = inventory.skills.find((skill) => skill.name === 'example-workflow-kit:handoff-notes-with-static');
    expect(twoPluginsOneStaticSkill).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies', 'missing-symlinks']),
    });
    expect(twoPluginsOneStaticSkill?.locations).toHaveLength(3);
    expect(twoPluginsOneStaticSkill?.locations.map((location) => location.sourceId)).toEqual(expect.arrayContaining([
      'sandbox-agents',
    ]));
    expect(twoPluginsOneStaticSkill?.locations
      .filter((location) => location.provenance?.kind === 'plugin')
      .map((location) => location.provenance?.plugin?.host)
      .sort()).toEqual(['claude', 'codex']);

    const twoPluginsTwoStaticsSkill = inventory.skills.find((skill) => skill.name === 'example-workflow-kit:handoff-notes-with-two-statics');
    expect(twoPluginsTwoStaticsSkill).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies', 'missing-symlinks']),
    });
    expect(twoPluginsTwoStaticsSkill?.locations).toHaveLength(4);
    expect(twoPluginsTwoStaticsSkill?.locations.map((location) => location.sourceId)).toEqual(expect.arrayContaining([
      'sandbox-agents',
      'sandbox-factory',
    ]));
    expect(twoPluginsTwoStaticsSkill?.locations
      .filter((location) => location.provenance?.kind === 'plugin')
      .map((location) => location.provenance?.plugin?.host)
      .sort()).toEqual(['claude', 'codex']);

    const twoStaticsOnePluginSkill = inventory.skills.find((skill) => skill.name === 'signal-tools:static-plugin-choice');
    expect(twoStaticsOnePluginSkill).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies', 'missing-symlinks']),
    });
    expect(twoStaticsOnePluginSkill?.locations).toHaveLength(3);
    expect(twoStaticsOnePluginSkill?.locations.map((location) => location.sourceId)).toEqual(expect.arrayContaining([
      'sandbox-agents',
      'sandbox-factory',
    ]));
    expect(twoStaticsOnePluginSkill?.locations
      .filter((location) => location.provenance?.kind === 'plugin')
      .map((location) => location.provenance?.plugin?.host)).toEqual(['codex']);
    expect(inventory.skills.find((skill) => skill.name === 'single-source-skill')).toMatchObject({
      structuralState: 'single-source-noncanonical',
    });
    expect(inventory.counts.totalSkills).toBeGreaterThan(0);
    expect(inventory.counts.driftedSkills).toBeGreaterThan(0);
    expect(inventory.counts.healthySkills).toBeGreaterThanOrEqual(0);
    expect((inventory.mcps ?? []).length).toBeGreaterThan(0);
    expect((inventory.mcps ?? []).map((mcp) => mcp.name)).toEqual(expect.arrayContaining([
      'broken-mcp',
      'double-definition-mismatch-mcp',
      'double-invalid-definition-mcp',
      'double-missing-from-agents-mcp',
      'missing-from-agents-mcp',
      'muted-mcp',
      'healthy-mcp',
      'healthy-remote-mcp',
      'codex-only-mcp',
      'claude-only-mcp',
      'factory-only-mcp',
      'signal-tools:signalMap',
      'relay-hub:relayHub',
      'alloy-kit:alloyPlanner',
      'broken-shared-mcp-01',
      'mismatch-shared-mcp-01',
      'mismatch-shared-mcp-02',
      'muted-extra-mcp',
      'shared-stable-mcp-01',
      'shared-stable-mcp-02',
    ]));
    expect(inventory.mcps?.find((mcp) => mcp.name === 'missing-from-agents-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      missingLocations: arrayContaining([
        objectContaining({
          agentId: 'sandbox-cursor',
        }),
        objectContaining({
          agentId: 'sandbox-factory',
        }),
        objectContaining({
          agentId: 'sandbox-windsurf',
        }),
      ]),
    });
    expect(inventory.mcpCounts?.totalMcps ?? 0).toBeGreaterThan(0);
    expect(inventory.mcpCounts?.attentionMcps ?? 0).toBeGreaterThan(0);
    expect(inventory.mcpCounts?.healthyMcps ?? 0).toBeGreaterThanOrEqual(0);
    expect(inventory.mcpCounts?.dismissedAttentionMcps ?? 0).toBeGreaterThanOrEqual(0);
    const codexAgent = inventory.agents?.find((agent) => agent.id === 'sandbox-codex');
    expect(codexAgent).toMatchObject({
      installState: 'installed',
      mcpConfigLocation: { path: path.join(paths.sandboxRoot, '.codex', 'config.toml'), state: 'available' },
      configLocation: { path: path.join(paths.sandboxRoot, '.codex', 'config.toml') },
      executableLocation: { path: path.join(paths.sandboxRoot, 'bin', 'codex') },
    });
    expect(codexAgent?.skillsLocation.path).toMatch(/\/\.(agents|codex)\/skills$/);
    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-claude')).toMatchObject({
      label: 'Claude Code',
      installState: 'installed',
      skillsLocation: { path: path.join(paths.sandboxRoot, '.claude', 'skills') },
      mcpConfigLocation: { path: path.join(paths.sandboxRoot, '.claude.json'), state: 'available' },
      configLocation: { path: path.join(paths.sandboxRoot, '.claude', 'settings.json') },
      executableLocation: { path: path.join(paths.sandboxRoot, 'bin', 'claude') },
    });
    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-claude-desktop')).toMatchObject({
      label: 'Claude Desktop',
      installState: 'installed',
      skillsLocation: { state: 'unavailable', reason: 'account-managed' },
      mcpConfigLocation: {
        path: path.join(paths.sandboxRoot, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        state: 'available',
      },
      configLocation: { state: 'unavailable' },
      executableLocation: { state: 'unavailable' },
    });
    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-factory')).toMatchObject({
      installState: 'installed',
      skillsLocation: { path: path.join(paths.sandboxRoot, '.factory', 'skills') },
      mcpConfigLocation: { path: path.join(paths.sandboxRoot, '.factory', 'mcp.json'), state: 'available' },
      configLocation: { path: path.join(paths.sandboxRoot, '.factory', 'settings.json') },
      executableLocation: { path: path.join(paths.sandboxRoot, 'bin', 'factory') },
    });
    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-warp')).toMatchObject({
      installState: 'not-installed',
      skillsLocation: { path: path.join(paths.sandboxRoot, '.agents', 'skills') },
      mcpConfigLocation: { state: 'unavailable' },
      configLocation: { path: path.join(paths.sandboxRoot, '.config', 'warp-terminal', 'user_preferences.json') },
    });
    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-windsurf')).toMatchObject({
      installState: 'installed',
      defaultGlobalSkillsDir: '~/.codeium/windsurf/skills',
      skillsLocation: { path: path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills') },
      mcpConfigLocation: { path: path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'mcp_config.json'), state: 'available' },
    });
    expect(inventory.agents?.some((agent) => agent.installState === 'not-installed')).toBe(true);
    expect(inventory.agentCounts?.totalAgents).toBe(AGENT_CATALOG.length);
    expect(inventory.agentCounts?.installedAgents).toBeGreaterThan(0);
    expect(inventory.agentCounts?.notInstalledAgents).toBeGreaterThanOrEqual(0);
    expect(inventory.homeSummary?.installedAgents).toBe(inventory.agentCounts?.installedAgents);
    expect(inventory.homeSummary?.skills.total).toBe(inventory.counts.totalSkills);
    expect(inventory.skills.every((skill) => typeof skill.description === 'string' && skill.description.trim().length > 0)).toBe(true);
    expect(inventory.skills.find((skill) => skill.name === 'healthy-skill')?.description).toBe('Healthy across every installed location.');
    expect(inventory.skills.find((skill) => skill.name === 'healthy-skill')).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
      detailDiagnostics: {
        missingInstallSources: [],
      },
    });
    expect(inventory.skills.every((skill) =>
      !(skill.detailDiagnostics.missingInstallSources ?? []).some((source) => source.sourceId === 'sandbox-claude-desktop'))).toBe(true);
    expect(inventory.skills.find((skill) => skill.name === 'missing-symlink-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
      detailDiagnostics: {
        missingInstallSources: arrayContaining([
          objectContaining({
            sourceId: 'sandbox-factory',
            label: 'Factory',
          }),
          objectContaining({
            sourceId: 'sandbox-windsurf',
            label: 'Windsurf',
          }),
        ]),
      },
    });
    const brokenSymlinkSkill = inventory.skills.find((skill) => skill.name === 'broken-symlink-skill');
    expect(brokenSymlinkSkill).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: arrayContaining(['broken-symlink']),
    });
    expect(brokenSymlinkSkill?.locations.find((location) =>
      location.sourceId === 'sandbox-claude' && location.fileType === 'symlink' && !location.resolvedPath,
    )).toMatchObject({
      symlinkTarget: path.join(paths.sandboxRoot, '.agents', 'skills', 'missing-broken-symlink-target'),
    });
    expect(inventory.skills.find((skill) => skill.name === 'wrong-symlink-target-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: arrayContaining(['wrong-symlink-target']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-definition-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'missing-required-field',
            field: 'name',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-name-length-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'invalid-field-value',
            field: 'name',
            detail: 'Invalid field: name must be at most 64 characters',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-description-length-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'invalid-field-value',
            field: 'description',
            detail: 'Invalid field: description must be at most 1024 characters',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-name-uppercase-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'invalid-field-value',
            field: 'name',
            detail: 'Invalid field: name must not start or end with whitespace',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-name-special-char-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'invalid-field-value',
            field: 'name',
            detail: 'Invalid field: name must not start or end with whitespace',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-name-leading-hyphen-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'invalid-field-value',
            field: 'name',
            detail: 'Invalid field: name must not start or end with whitespace',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'invalid-name-trailing-hyphen-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'invalid-field-value',
            field: 'name',
            detail: 'Invalid field: name must not start or end with whitespace',
          }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'multi-invalid-definition-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'multi-invalid-definition-skill')?.detailDiagnostics.definitionIssues)
      .toEqual(expect.arrayContaining([
        objectContaining({
          type: 'invalid-field-value',
          field: 'name',
          detail: 'Invalid field: name must be at most 64 characters',
        }),
        objectContaining({
          type: 'invalid-field-value',
          field: 'name',
          detail: 'Invalid field: name must not start or end with whitespace',
        }),
        objectContaining({
          type: 'invalid-field-value',
          field: 'description',
          detail: 'Invalid field: description must be at most 1024 characters',
        }),
      ]));
    expect(inventory.skills.find((skill) => skill.name === 'double-missing-symlink-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: arrayContaining(['missing-symlinks']),
      detailDiagnostics: {
        missingInstallSources: arrayContaining([
          objectContaining({ sourceId: 'sandbox-claude' }),
          objectContaining({ sourceId: 'sandbox-factory' }),
          objectContaining({ sourceId: 'sandbox-windsurf' }),
        ]),
      },
    });
    expect(inventory.skills.find((skill) => skill.name === 'double-missing-canonical-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['missing-canonical']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'double-missing-canonical-skill')?.locations).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'double-identical-copies-skill')).toMatchObject({
      structuralState: 'identical-drift',
      issueReasons: arrayContaining(['identical-copies']),
    });
    expect(
      inventory.skills.find((skill) => skill.name === 'double-identical-copies-skill')
        ?.detailDiagnostics.duplicateCandidates.filter((candidate) => candidate.fileType === 'real-file' && !candidate.canonical),
    ).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'double-diverged-copies-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies']),
    });
    expect(
      inventory.skills.find((skill) => skill.name === 'double-diverged-copies-skill')
        ?.detailDiagnostics.duplicateCandidates.filter((candidate) => candidate.fileType === 'real-file' && !candidate.canonical),
    ).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'double-broken-symlink-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: arrayContaining(['broken-symlink']),
    });
    expect(
      inventory.skills.find((skill) => skill.name === 'double-broken-symlink-skill')
        ?.locations.filter((location) => !location.canonical && location.fileType === 'symlink' && !location.resolvedPath),
    ).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'double-wrong-symlink-target-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      issueReasons: arrayContaining(['wrong-symlink-target']),
    });
    const doubleWrongTargetSkill = inventory.skills.find((skill) => skill.name === 'double-wrong-symlink-target-skill');
    const doubleWrongTargetCanonicalPath = doubleWrongTargetSkill?.locations.find((location) => location.canonical)?.path;
    expect(
      doubleWrongTargetSkill
        ?.locations.filter((location) => !location.canonical && location.fileType === 'symlink'
          && location.resolvedPath
          && path.basename(location.resolvedPath) !== path.basename(doubleWrongTargetCanonicalPath ?? '')),
    ).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'double-invalid-definition-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['invalid-definition']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'double-invalid-definition-skill')?.detailDiagnostics.definitionIssues).toHaveLength(2);
    expect(inventory.skills.find((skill) => skill.name === 'multi-file-entrypoint-drift-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'multi-file-support-drift-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'multi-file-combo-drift-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'partial-folder-symlink-skill')).toMatchObject({
      structuralState: 'identical-drift',
      issueReasons: arrayContaining(['identical-copies']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'partial-folder-symlink-drift-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies']),
    });
    expect(inventory.skills.find((skill) => skill.name === 'single-source-skill')?.description).toBe('Installed in a single location outside the universal .agents folder.');
    expect(inventory.skills.find((skill) => skill.name === 'healthy-skill')?.locations.map((location) => location.fileType)).toEqual([
      'real-file',
      'symlink',
      'symlink',
      'symlink',
      'symlink',
      'symlink',
    ]);
    expect(inventory.skills.find((skill) => skill.name === 'healthy-skill')?.isDrifted).toBe(false);
    expect(inventory.skills.find((skill) => skill.name === 'single-source-skill')?.isDrifted).toBe(true);
    expect(inventory.mcps?.find((mcp) => mcp.name === 'healthy-mcp')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'healthy-remote-mcp')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
      locations: arrayContaining([
        objectContaining({
          transport: 'http',
          url: 'https://example.test/mcp',
          command: undefined,
        }),
      ]),
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'broken-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: arrayContaining(['definition-mismatch', 'invalid-definition']),
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'double-definition-mismatch-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['definition-mismatch'],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'double-definition-mismatch-mcp')?.locations.length ?? 0)
      .toBeGreaterThanOrEqual(6);
    expect(inventory.mcps?.find((mcp) => mcp.name === 'double-missing-from-agents-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      missingLocations: arrayContaining([
        objectContaining({ agentId: 'sandbox-claude' }),
        objectContaining({ agentId: 'sandbox-codex' }),
        objectContaining({ agentId: 'sandbox-cursor' }),
        objectContaining({ agentId: 'sandbox-factory' }),
        objectContaining({ agentId: 'sandbox-windsurf' }),
      ]),
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'double-invalid-definition-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: arrayContaining(['invalid-definition']),
    });
    expect(
      inventory.mcps?.find((mcp) => mcp.name === 'double-invalid-definition-mcp')
        ?.locations.reduce((total, location) => total + (location.invalidDetails?.length ?? 0), 0),
    ).toBe(2);
    expect(new Set(inventory.skills.flatMap((skill) => skill.issueReasons ?? []))).toEqual(new Set([
      'missing-symlinks',
      'missing-canonical',
      'identical-copies',
      'diverged-copies',
      'broken-symlink',
      'wrong-symlink-target',
      'invalid-definition',
    ]));
    expect(new Set((inventory.mcps ?? []).flatMap((mcp) => mcp.issueReasons))).toEqual(new Set([
      'definition-mismatch',
      'missing-universal',
      'missing-from-agents',
      'invalid-definition',
    ]));
  });

  it('seeds an opt-in parser-shape MCP matrix for supported sandbox agent config formats', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-parser-shape-matrix-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const matrixEnv = {
      SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX: '1',
    };

    await seedRepresentativeFixtures({ paths, env: matrixEnv });
    const inventory = await scanInventory({
      paths,
      env: matrixEnv,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.agents).toEqual(expect.arrayContaining([
      objectContaining({ id: 'sandbox-amp', installState: 'installed' }),
      objectContaining({ id: 'sandbox-codebuddy', installState: 'installed' }),
      objectContaining({ id: 'sandbox-codex', installState: 'installed' }),
      objectContaining({ id: 'sandbox-claude', installState: 'installed' }),
      objectContaining({ id: 'sandbox-claude-desktop', installState: 'installed' }),
      objectContaining({ id: 'sandbox-crush', installState: 'installed' }),
      objectContaining({ id: 'sandbox-cursor', installState: 'installed' }),
      objectContaining({ id: 'sandbox-factory', installState: 'installed' }),
      objectContaining({ id: 'sandbox-mistral-vibe', installState: 'installed' }),
      objectContaining({ id: 'sandbox-mux', installState: 'installed' }),
      objectContaining({ id: 'sandbox-openclaw', installState: 'installed' }),
      objectContaining({ id: 'sandbox-opencode', installState: 'installed' }),
      objectContaining({ id: 'sandbox-pochi', installState: 'installed' }),
      objectContaining({ id: 'sandbox-windsurf', installState: 'installed' }),
      objectContaining({ id: 'sandbox-zencoder', installState: 'installed' }),
    ]));
    expect(inventory.mcps?.find((mcp) => mcp.name === 'healthy-mcp')).toMatchObject({
      status: 'healthy',
      issueReasons: [],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'parser-shape-matrix-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      locations: [
        objectContaining({ agentId: 'sandbox-agents' }),
      ],
      missingLocations: arrayContaining([
        objectContaining({ agentId: 'sandbox-amp' }),
        objectContaining({ agentId: 'sandbox-codebuddy' }),
        objectContaining({ agentId: 'sandbox-codex' }),
        objectContaining({ agentId: 'sandbox-claude' }),
        objectContaining({ agentId: 'sandbox-crush' }),
        objectContaining({ agentId: 'sandbox-cursor' }),
        objectContaining({ agentId: 'sandbox-factory' }),
        objectContaining({ agentId: 'sandbox-mistral-vibe' }),
        objectContaining({ agentId: 'sandbox-mux' }),
        objectContaining({ agentId: 'sandbox-openclaw' }),
        objectContaining({ agentId: 'sandbox-opencode' }),
        objectContaining({ agentId: 'sandbox-pochi' }),
        objectContaining({ agentId: 'sandbox-windsurf' }),
        objectContaining({ agentId: 'sandbox-zencoder' }),
      ]),
    });

    const generatedHealthySkills = inventory.skills.filter((skill) =>
      skill.name.startsWith('representative-healthy-skill-'));
    expect(generatedHealthySkills).toHaveLength(37);
    expect(generatedHealthySkills.map((skill) => ({
      name: skill.name,
      structuralState: skill.structuralState,
      issueReasons: skill.issueReasons,
      missingInstallSourceIds: skill.detailDiagnostics.missingInstallSources?.map((source) => source.sourceId),
    }))).toEqual(generatedHealthySkills.map((skill) => ({
      name: skill.name,
      structuralState: 'healthy',
      issueReasons: [],
      missingInstallSourceIds: [],
    })));
  });

  it('records installed agent ids for missing skill links whose skills dir is not scanned yet', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-parser-shape-skill-links-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const matrixEnv = {
      SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX: '1',
    };

    await seedRepresentativeFixtures({ paths, env: matrixEnv });
    const inventory = await scanInventory({
      paths,
      env: matrixEnv,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const diagnosticSkill = inventory.skills.find((skill) => skill.name === 'diagnostic-rich-skill');
    expect(diagnosticSkill?.detailDiagnostics.missingInstallSources).toEqual(expect.arrayContaining([
      objectContaining({
        sourceId: 'sandbox-amp',
        label: 'Amp',
      }),
      objectContaining({
        sourceId: 'sandbox-mistral-vibe',
        label: 'Mistral Vibe',
      }),
    ]));
    expect(diagnosticSkill?.detailDiagnostics.missingInstallSources).not.toEqual(expect.arrayContaining([
      objectContaining({ sourceId: 'sandbox-config-agents' }),
      objectContaining({ sourceId: 'sandbox-vibe' }),
    ]));
    expect(inventory.sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      'sandbox-config-agents',
      'sandbox-vibe',
    ]));
  });

  it('discovers skills from alternate compatible dirs and reports missing canonical rather than missing symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(
      path.join(paths.sandboxRoot, '.claude', 'skills'),
      'alternate-only-skill',
      '# Alternate only skill\n',
      '2026-04-09T00:00:00.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const skill = inventory.skills.find((entry) => entry.name === 'alternate-only-skill');

    expect(inventory.sourceIds).toEqual(expect.arrayContaining(['sandbox-agents', 'sandbox-claude']));
    expect(skill).toMatchObject({
      structuralState: 'single-source-noncanonical',
      isDrifted: true,
    });
    expect(skill?.issueReasons).toEqual(expect.arrayContaining(['missing-canonical']));
    expect(skill?.detailDiagnostics.missingInstallSources).toEqual([]);
  });

  it('parses jsonc MCP configs with trailing commas for installed agents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.pochi'), { recursive: true });
    await writeFile(
      path.join(paths.sandboxRoot, '.pochi', 'config.jsonc'),
      `{
  // Pochi allows JSONC here.
  "mcp": {
    "jsonc-trailing-comma": {
      "command": "echo",
    },
  },
}
`,
      'utf8',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-pochi')).toMatchObject({
      installState: 'installed',
      mcpConfigLocation: {
        path: path.join(paths.sandboxRoot, '.pochi', 'config.jsonc'),
        exists: true,
      },
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'jsonc-trailing-comma')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-pochi',
          command: 'echo',
        }),
      ],
    });
  });

  it('parses OpenCode MCP configs from the documented top-level mcp object', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-opencode-mcp-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await mkdir(path.join(paths.sandboxRoot, '.config', 'opencode'), { recursive: true });
    await writeFile(
      path.join(paths.sandboxRoot, '.config', 'opencode', 'opencode.json'),
      `{
  "$schema": "https://opencode.ai/config.json",
  // OpenCode documents MCP servers under "mcp", not "mcpServers".
  "mcp": {
    "opencode-local": {
      "type": "local",
      "command": ["bun", "x", "opencode-mcp"],
      "enabled": true,
    },
    "opencode-remote": {
      "type": "remote",
      "url": "https://example.test/opencode-mcp",
    },
  },
  "mcpServers": {
    "wrong-shape": {
      "command": "node"
    }
  },
}
`,
      'utf8',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'opencode-local')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-opencode',
          command: 'bun',
          args: ['x', 'opencode-mcp'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'opencode-remote')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-universal'],
      locations: [
        expect.objectContaining({
          agentId: 'sandbox-opencode',
          url: 'https://example.test/opencode-mcp',
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'wrong-shape')).toBeUndefined();
  });

  it('parses documented non-generic MCP shapes for installed agents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-agent-mcp-shapes-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await Promise.all([
      writeNestedSkillFile(
        path.join(paths.sandboxRoot, '.config', 'amp', 'settings.json'),
        `${JSON.stringify({
          'amp.mcpServers': {
            'amp-dotted': {
              command: 'node',
              args: ['amp.js'],
            },
          },
          mcpServers: {
            'amp-wrong-shape': {
              command: 'node',
            },
          },
        }, null, 2)}\n`,
        '2026-05-04T00:00:00.000Z',
      ),
      writeNestedSkillFile(
        path.join(paths.sandboxRoot, '.codebuddy', '.mcp.json'),
        `{
  // CodeBuddy documents JSONC-compatible MCP files.
  "mcpServers": {
    "codebuddy-jsonc": {
      "command": "node",
      "args": ["codebuddy.js"],
    },
  },
}
`,
        '2026-05-04T00:00:00.000Z',
      ),
      writeNestedSkillFile(
        path.join(paths.sandboxRoot, '.vibe', 'config.toml'),
        [
          'model = "codestral"',
          '',
          '[[mcp_servers]]',
          'name = "vibe-array"',
          'command = "node"',
          'args = ["vibe.js"]',
          '',
        ].join('\n'),
        '2026-05-04T00:00:00.000Z',
      ),
      writeNestedSkillFile(
        path.join(paths.sandboxRoot, '.openclaw', 'openclaw.json'),
        `{
  // OpenClaw nests MCP servers under mcp.servers.
  "mcp": {
    "servers": {
      "openclaw-nested": {
        "command": "node",
        "args": ["openclaw.js"],
      },
    },
  },
}
`,
        '2026-05-04T00:00:00.000Z',
      ),
      writeNestedSkillFile(
        path.join(paths.sandboxRoot, '.zencoder', 'settings.json'),
        `${JSON.stringify({
          'zencoder.mcpServers': {
            'zencoder-dotted': {
              url: 'https://example.test/zencoder-mcp',
            },
          },
        }, null, 2)}\n`,
        '2026-05-04T00:00:00.000Z',
      ),
    ]);

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'amp-dotted')).toMatchObject({
      locations: [expect.objectContaining({ agentId: 'sandbox-amp', command: 'node' })],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'amp-wrong-shape')).toBeUndefined();
    expect(inventory.mcps?.find((mcp) => mcp.name === 'codebuddy-jsonc')).toMatchObject({
      locations: [expect.objectContaining({ agentId: 'sandbox-codebuddy', args: ['codebuddy.js'] })],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'vibe-array')).toMatchObject({
      locations: [expect.objectContaining({ agentId: 'sandbox-mistral-vibe', args: ['vibe.js'] })],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'openclaw-nested')).toMatchObject({
      locations: [expect.objectContaining({ agentId: 'sandbox-openclaw', args: ['openclaw.js'] })],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'zencoder-dotted')).toMatchObject({
      locations: [expect.objectContaining({ agentId: 'sandbox-zencoder', url: 'https://example.test/zencoder-mcp' })],
    });
  });

  it('treats installed supported agents as expected MCP destinations even before their config file exists', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const factoryConfigPath = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const claudeConfigPath = path.join(paths.sandboxRoot, '.claude.json');
    const claudeInstallPath = path.join(paths.sandboxRoot, '.claude');

    await mkdir(path.dirname(factoryConfigPath), { recursive: true });
    await mkdir(path.join(paths.sandboxRoot, '.agents'), { recursive: true });
    await mkdir(path.dirname(claudeConfigPath), { recursive: true });
    await mkdir(claudeInstallPath, { recursive: true });
    await writeFile(
      path.join(paths.sandboxRoot, '.agents', 'mcp.json'),
      `${JSON.stringify({
        servers: {
          'factory-only-installed-agent-mcp': {
            command: 'uvx',
            args: ['factory-only-installed-agent-mcp'],
          },
        },
      }, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      factoryConfigPath,
      `${JSON.stringify({
        mcpServers: {
          'factory-only-installed-agent-mcp': {
            command: 'uvx',
            args: ['factory-only-installed-agent-mcp'],
          },
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.agents?.find((agent) => agent.id === 'sandbox-claude')).toMatchObject({
      installState: 'installed',
      mcpConfigLocation: {
        path: claudeConfigPath,
        exists: false,
      },
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'factory-only-installed-agent-mcp')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['missing-from-agents'],
      locations: arrayContaining([
        expect.objectContaining({
          agentId: 'sandbox-factory',
        }),
      ]),
      missingLocations: arrayContaining([
        objectContaining({
          agentId: 'sandbox-claude',
          configPath: claudeConfigPath,
        }),
      ]),
    });
  });

  it('classifies parsed MCP definitions using transport-aware connection targets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const configPath = path.join(paths.sandboxAgentsDir, 'mcp.json');

    await mkdir(paths.sandboxAgentsSkillsDir, { recursive: true });
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({
        servers: {
          'stdio-server': {
            command: 'node',
            args: ['server.js'],
          },
          'remote-server': {
            url: 'https://example.test/mcp',
          },
          'http-url-server': {
            httpUrl: 'https://example.test/http-url',
          },
          'empty-transport-with-url': {
            transport: '',
            url: 'https://example.test/empty-transport',
          },
          'unknown-transport-with-command': {
            transport: 'websocket',
            command: 'node',
          },
          'explicit-stdio-missing-command': {
            type: 'stdio',
            args: ['server.js'],
          },
          'explicit-sse-missing-url': {
            type: 'sse',
            command: 'node',
          },
          'explicit-streamable-http-missing-url': {
            transport: 'streamable-http',
          },
          'explicit-http-missing-url': {
            type: 'http',
          },
          'empty-command': {
            command: '',
          },
          'non-object-server': 'broken',
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.mcps?.find((mcp) => mcp.name === 'stdio-server')).toMatchObject({
      status: 'healthy',
      locations: [
        expect.objectContaining({
          transport: 'stdio',
          command: 'node',
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'remote-server')).toMatchObject({
      status: 'healthy',
      locations: [
        expect.objectContaining({
          transport: 'http',
          url: 'https://example.test/mcp',
          command: undefined,
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'http-url-server')).toMatchObject({
      status: 'healthy',
      locations: [
        expect.objectContaining({
          transport: 'streamable-http',
          url: 'https://example.test/http-url',
          command: undefined,
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'empty-transport-with-url')).toMatchObject({
      status: 'healthy',
      locations: [
        expect.objectContaining({
          transport: 'http',
          url: 'https://example.test/empty-transport',
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'unknown-transport-with-command')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          transport: 'stdio',
          command: 'node',
          invalidDetails: ['Unsupported transport "websocket".'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'explicit-stdio-missing-command')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          invalidDetails: ['Missing command for stdio server.'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'explicit-sse-missing-url')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          invalidDetails: ['Missing url for remote server.'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'explicit-streamable-http-missing-url')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          invalidDetails: ['Missing url for remote server.'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'explicit-http-missing-url')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          invalidDetails: ['Missing url for remote server.'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'empty-command')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          invalidDetails: ['Missing connection target.'],
        }),
      ],
    });
    expect(inventory.mcps?.find((mcp) => mcp.name === 'non-object-server')).toMatchObject({
      status: 'needs-attention',
      issueReasons: ['invalid-definition'],
      locations: [
        expect.objectContaining({
          invalidDetails: ['Unsupported server definition. Expected an object. Missing connection target.'],
        }),
      ],
    });
  });

  it('counts installed agents as expected linked sources even when their skills dir is not yet scanned', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'missing-link-skill', '# Missing link skill\n', '2026-04-09T00:00:00.000Z');
    await mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const skill = inventory.skills.find((entry) => entry.name === 'missing-link-skill');

    expect(inventory.sourceIds).toEqual(['sandbox-agents']);
    expect(skill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
    });
    expect(skill?.issueReasons).toEqual(expect.arrayContaining(['missing-symlinks']));
    expect(skill?.detailDiagnostics.missingInstallSources).toEqual([
      expect.objectContaining({
        sourceId: 'sandbox-factory',
        label: 'Factory',
        kind: 'agent',
        scope: 'sandbox',
        writable: true,
        canonical: false,
      }),
    ]);
  });

  it('indexes only markdown files from installed representative sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const seeded = await seedRepresentativeFixtures({ paths });
    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.some((skill) => skill.name === 'ignore-me')).toBe(false);
    expect(inventory.skills.some((skill) => skill.name === 'README')).toBe(false);
    expect(inventory.skills.some((skill) => skill.name === 'MiXeD-Case-Skill')).toBe(true);
    expect(inventory.skills.some((skill) => skill.name === 'representative-healthy-skill-37')).toBe(true);
    expect(inventory.sourceIds).toEqual(expect.arrayContaining([
      'sandbox-agents',
      'sandbox-claude',
      'sandbox-factory',
      'sandbox-windsurf',
      'sandbox-plugin-pack',
    ]));
    expect(inventory.plugins).toContainEqual(expect.objectContaining({
      host: 'claude',
      scope: 'sandbox',
      pluginId: 'sandbox-plugin-pack',
      pluginName: 'sandbox-plugin-pack',
      enabled: true,
      rootPath: path.join(paths.sandboxRoot, '.claude', 'plugins', 'sandbox-plugin-pack'),
      manifestPath: path.join(paths.sandboxRoot, '.claude', 'plugins', 'sandbox-plugin-pack', '.claude-plugin', 'plugin.json'),
    }));
    expect(seeded.skills).toHaveLength(78);
    expect(seeded.skills).toEqual(expect.arrayContaining([
      {
        name: 'healthy-skill',
        expectedState: 'healthy',
        expectedLocationCount: 4,
      },
      {
        name: 'diagnostic-rich-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 3,
      },
      {
        name: 'representative-healthy-skill-37',
        expectedState: 'healthy',
        expectedLocationCount: 4,
      },
      {
        name: 'representative-identical-drift-skill-04',
        expectedState: 'identical-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'plugin-manual-identical-skill',
        expectedState: 'identical-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'plugin-manual-diverged-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'representative-diverged-drift-skill-02',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'representative-dismissed-drift-skill-01',
        expectedState: 'identical-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'missing-symlink-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 2,
      },
      {
        name: 'double-missing-symlink-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 1,
      },
      {
        name: 'broken-symlink-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 4,
      },
      {
        name: 'double-broken-symlink-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 4,
      },
      {
        name: 'wrong-symlink-target-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 4,
      },
      {
        name: 'double-wrong-symlink-target-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 3,
      },
      {
        name: 'invalid-definition-skill',
        expectedState: 'missing-symlinks',
        expectedLocationCount: 4,
      },
      {
        name: 'double-invalid-definition-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'double-identical-copies-skill',
        expectedState: 'identical-drift',
        expectedLocationCount: 3,
      },
      {
        name: 'double-diverged-copies-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 3,
      },
      {
        name: 'double-missing-canonical-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'multi-file-entrypoint-drift-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'multi-file-support-drift-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'multi-file-combo-drift-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'partial-folder-symlink-skill',
        expectedState: 'identical-drift',
        expectedLocationCount: 2,
      },
      {
        name: 'partial-folder-symlink-drift-skill',
        expectedState: 'diverged-drift',
        expectedLocationCount: 2,
      },
    ]));
  });

  it('indexes only root skill entry files and ignores nested markdown inside skill folders', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');
    const directorySkillPath = path.join(customSkillsDir, 'vercel-react-best-practices', 'SKILL.md');
    const nestedDocPath = path.join(customSkillsDir, 'vercel-react-best-practices', 'rules', 'async-api-routes.md');

    await writeSkillFile(
      customSkillsDir,
      'flat-skill',
      [
        '---',
        'name: flat-skill',
        'description: Flat skill description.',
        '---',
        '',
        '# Flat skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeSkillFile(
      customSkillsDir,
      'vercel-react-best-practices',
      [
        '---',
        'name: vercel-react-best-practices',
        'description: Directory skill description.',
        '---',
        '',
        '# Vercel React Best Practices',
        '',
      ].join('\n'),
      '2026-04-09T00:01:00.000Z',
    );
    await mkdir(path.dirname(nestedDocPath), { recursive: true });
    await writeFile(nestedDocPath, '# Nested rules doc\n', 'utf8');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const customSource = inventory.sources.find((source) => source.id === `custom:${customSkillsDir}`);

    expect(inventory.sourceIds).toEqual(['sandbox-agents', `custom:${customSkillsDir}`]);
    expect(inventory.skills.map((skill) => skill.name)).toEqual([
      'flat-skill',
      'vercel-react-best-practices',
    ]);
    expect(inventory.skills.some((skill) => skill.name === 'async-api-routes')).toBe(false);
    expect(inventory.skills.find((skill) => skill.name === 'vercel-react-best-practices')).toMatchObject({
      description: 'Directory skill description.',
      locations: [
        expect.objectContaining({
          path: path.dirname(directorySkillPath),
          entrypointPath: directorySkillPath,
          installKind: 'directory',
        }),
      ],
    });

    const afterNestedDocEvent = await reconcileWatchedSkillInventoryEvent(
      inventory,
      {
        source: customSource!,
        filePath: nestedDocPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect({
      ...afterNestedDocEvent,
      scannedAt: inventory.scannedAt,
    }).toEqual(inventory);
  });

  it('marks skills recorded in the skills CLI lock file as NPX-installed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const skillName = 'npx-installed-skill';
    const skillRoot = path.join(paths.sandboxAgentsSkillsDir, skillName);

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      skillName,
      [
        '---',
        `name: ${skillName}`,
        'description: Skill installed through the skills CLI.',
        '---',
        '',
        '# NPX installed skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeFile(path.join(paths.sandboxAgentsDir, '.skill-lock.json'), `${JSON.stringify({
      version: 3,
      skills: {
        [skillName]: {
          source: 'acme/agent-skills',
          sourceType: 'github',
          sourceUrl: 'https://github.com/acme/agent-skills.git',
          skillPath: 'skills/npx-installed-skill/SKILL.md',
          skillFolderHash: 'abc123',
          installedAt: '2026-04-09T00:00:00.000Z',
          updatedAt: '2026-04-09T00:00:00.000Z',
          pluginName: '@acme/agent-skills',
        },
      },
    }, null, 2)}\n`, 'utf8');

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === skillName)?.locations[0]).toMatchObject({
      provenance: {
        kind: 'npx',
        npx: {
          packageName: '@acme/agent-skills',
          source: 'acme/agent-skills',
          sourceType: 'github',
          sourceUrl: 'https://github.com/acme/agent-skills.git',
          skillPath: 'skills/npx-installed-skill/SKILL.md',
          lockFilePath: path.join(paths.sandboxAgentsDir, '.skill-lock.json'),
        },
        sourcePath: skillRoot,
      },
      mutability: 'writable',
      canonicalRole: 'canonical',
    });
  });

  it('recursively discovers nested runtime skill packages without indexing container directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');
    const slidesPath = path.join(customSkillsDir, 'codex-primary-runtime', 'slides', 'SKILL.md');
    const spreadsheetsPath = path.join(customSkillsDir, 'codex-primary-runtime', 'spreadsheets', 'SKILL.md');
    const openAiDocsPath = path.join(customSkillsDir, '.system', 'openai-docs', 'SKILL.md');

    await writeSkillFile(
      customSkillsDir,
      'playwright',
      [
        '---',
        'name: playwright',
        'description: Browser automation.',
        '---',
        '',
        '# Playwright',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeNestedSkillFile(
      slidesPath,
      [
        '---',
        'name: slides',
        'description: Slide runtime.',
        '---',
        '',
        '# Slides',
        '',
      ].join('\n'),
      '2026-04-09T00:01:00.000Z',
    );
    await writeNestedSkillFile(
      spreadsheetsPath,
      [
        '---',
        'name: spreadsheets',
        'description: Spreadsheet runtime.',
        '---',
        '',
        '# Spreadsheets',
        '',
      ].join('\n'),
      '2026-04-09T00:02:00.000Z',
    );
    await writeNestedSkillFile(
      openAiDocsPath,
      [
        '---',
        'name: openai-docs',
        'description: Official docs helper.',
        '---',
        '',
        '# OpenAI Docs',
        '',
      ].join('\n'),
      '2026-04-09T00:03:00.000Z',
    );
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.map((skill) => skill.name)).toEqual([
      'openai-docs',
      'playwright',
      'slides',
      'spreadsheets',
    ]);
    expect(inventory.skills.find((skill) => skill.name === 'slides')).toMatchObject({
      locations: [
        expect.objectContaining({
          path: path.dirname(slidesPath),
          entrypointPath: slidesPath,
        }),
      ],
    });
    expect(inventory.skills.find((skill) => skill.name === 'spreadsheets')).toMatchObject({
      locations: [
        expect.objectContaining({
          path: path.dirname(spreadsheetsPath),
          entrypointPath: spreadsheetsPath,
        }),
      ],
    });
    expect(inventory.skills.find((skill) => skill.name === 'openai-docs')).toMatchObject({
      locations: [
        expect.objectContaining({
          path: path.dirname(openAiDocsPath),
          entrypointPath: openAiDocsPath,
        }),
      ],
    });
    expect(inventory.skills.some((skill) => skill.name === 'codex-primary-runtime')).toBe(false);
    expect(inventory.skills.some((skill) => skill.name === '.system')).toBe(false);
  });

  it('skips agent-owned ignored subpaths when scanning Codex skill sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const codexSkillsDir = path.join(paths.sandboxRoot, '.codex', 'skills');
    const openAiDocsPath = path.join(codexSkillsDir, '.system', 'openai-docs', 'SKILL.md');

    await writeSkillFile(
      codexSkillsDir,
      'playwright',
      [
        '---',
        'name: playwright',
        'description: Browser automation.',
        '---',
        '',
        '# Playwright',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeNestedSkillFile(
      openAiDocsPath,
      [
        '---',
        'name: openai-docs',
        'description: Official docs helper.',
        '---',
        '',
        '# OpenAI Docs',
        '',
      ].join('\n'),
      '2026-04-09T00:03:00.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'codex',
      },
    });

    expect(inventory.sourceIds).toContain('sandbox-codex');
    expect(inventory.sources.find((source) => source.id === 'sandbox-codex')).toMatchObject({
      id: 'sandbox-codex',
      ignoredSkillSubpaths: ['.system'],
    });
    expect(inventory.skills.map((skill) => skill.name)).toEqual(['playwright']);
    expect(inventory.skills.some((skill) => skill.name === 'openai-docs')).toBe(false);
  });

  it('ignores legacy flat-file skill symlinks instead of treating them as directory packages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');
    const legacyCanonicalPath = path.join(customSkillsDir, 'legacy-flat-skill.md');
    const legacyLinkedPath = path.join(customSkillsDir, 'legacy-linked-skill.md');

    await mkdir(customSkillsDir, { recursive: true });
    await writeFile(legacyCanonicalPath, '# Legacy flat skill\n', 'utf8');
    await symlink(legacyCanonicalPath, legacyLinkedPath);
    await writeSkillFile(
      customSkillsDir,
      'real-skill',
      [
        '---',
        'name: real-skill',
        'description: Real package skill.',
        '---',
        '',
        '# Real skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.map((skill) => skill.name)).toEqual(['real-skill']);
  });

  it('preserves canonical symlink targets inside the sandbox fixture tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });

    const linkTarget = await readlink(path.join(paths.sandboxRoot, '.claude', 'skills', 'healthy-skill'));

    expect(linkTarget).toBe(path.join(paths.sandboxRoot, '.agents', 'skills', 'healthy-skill'));
  });

  it('marks dismissed drift from config and anchors diverged diffs on the newest real file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    const sandboxPaths = resolveSandboxSkillIndexPaths({ paths });
    const inventory = await scanInventory({
      paths: sandboxPaths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const dismissedSkill = inventory.skills.find((skill) => skill.name === 'dismissed-drift-skill');
    const divergedSkill = inventory.skills.find((skill) => skill.name === 'diverged-drift-skill');

    expect(dismissedSkill?.driftPresentation).toBe('dismissed');
    expect(divergedSkill?.driftPresentation).toBe('active');
    expect(divergedSkill?.diff?.selectedPath).toBe(path.join(paths.sandboxRoot, '.claude', 'skills', 'diverged-drift-skill'));
    expect(divergedSkill?.diff?.files?.[0]?.lines).toEqual([
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
    ]);
  });

  it('captures multi-file package drift across entrypoint-only, support-only, and mixed package changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const entrypointOnly = inventory.skills.find((skill) => skill.name === 'multi-file-entrypoint-drift-skill');
    const supportOnly = inventory.skills.find((skill) => skill.name === 'multi-file-support-drift-skill');
    const combo = inventory.skills.find((skill) => skill.name === 'multi-file-combo-drift-skill');

    expect(entrypointOnly?.diff?.selectedPath).toBe(path.join(paths.sandboxRoot, '.claude', 'skills', 'multi-file-entrypoint-drift-skill'));
    expect(entrypointOnly?.diff?.files?.map((file) => file.relativePath)).toEqual(['SKILL.md']);
    expect(entrypointOnly?.diff?.files?.[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', text: 'description: Package where only the entrypoint drifted across installs.' }),
        expect.objectContaining({ type: 'added', text: 'description: Package where only the Claude entrypoint drifted.' }),
      ]),
    );

    expect(supportOnly?.diff?.selectedPath).toBe(path.join(paths.sandboxRoot, '.factory', 'skills', 'multi-file-support-drift-skill'));
    expect(supportOnly?.diff?.files?.map((file) => file.relativePath)).toEqual(['rules/usage.md']);
    expect(supportOnly?.diff?.files?.[0]?.lines).toEqual([
      {
        type: 'context',
        text: '# Usage',
      },
      {
        type: 'removed',
        text: 'Use the canonical support flow.',
      },
      {
        type: 'added',
        text: 'Factory rewrote the support flow for its own package copy.',
      },
    ]);

    expect(combo?.diff?.selectedPath).toBe(path.join(paths.sandboxRoot, '.claude', 'skills', 'multi-file-combo-drift-skill'));
    expect(combo?.diff?.files?.map((file) => file.relativePath)).toEqual(['scripts/build.py', 'SKILL.md']);
    expect(combo?.diff?.files?.find((file) => file.relativePath === 'scripts/build.py')?.lines).toEqual([
      {
        type: 'removed',
        text: 'print("canonical build")',
      },
      {
        type: 'added',
        text: 'print("claude build override")',
      },
    ]);
    expect(combo?.diff?.files?.find((file) => file.relativePath === 'SKILL.md')?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', text: 'description: Package where both the entrypoint and support files drifted.' }),
        expect.objectContaining({ type: 'added', text: 'description: Claude changed the entrypoint and one of the support files.' }),
      ]),
    );
  });

  it('treats folders with internal file symlinks as issues when the package root itself is not symlinked', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const identicalPartialSymlink = inventory.skills.find((skill) => skill.name === 'partial-folder-symlink-skill');
    const divergedPartialSymlink = inventory.skills.find((skill) => skill.name === 'partial-folder-symlink-drift-skill');

    expect(await readlink(path.join(paths.sandboxRoot, '.claude', 'skills', 'partial-folder-symlink-skill', 'SKILL.md'))).toBe(
      path.join(paths.sandboxRoot, '.agents', 'skills', 'partial-folder-symlink-skill', 'SKILL.md'),
    );
    expect(identicalPartialSymlink?.locations.map((location) => location.fileType)).toEqual(['real-file', 'real-file', 'symlink', 'symlink']);
    expect(identicalPartialSymlink?.structuralState).toBe('identical-drift');
    expect(identicalPartialSymlink?.diff).toBeUndefined();

    expect(await readlink(path.join(paths.sandboxRoot, '.factory', 'skills', 'partial-folder-symlink-drift-skill', 'SKILL.md'))).toBe(
      path.join(paths.sandboxRoot, '.agents', 'skills', 'partial-folder-symlink-drift-skill', 'SKILL.md'),
    );
    expect(divergedPartialSymlink?.locations.map((location) => location.fileType)).toEqual(['real-file', 'symlink', 'symlink', 'real-file']);
    expect(divergedPartialSymlink?.structuralState).toBe('diverged-drift');
    expect(divergedPartialSymlink?.diff?.files?.map((file) => file.relativePath)).toEqual(['rules/usage.md']);
  });

  it('keeps scanning when a skill folder contains a stale SKILL.md symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-stale-entrypoint-symlink-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const skillDir = path.join(paths.sandboxAgentsSkillsDir, 'stale-entrypoint-symlink-skill');
    const missingEntrypointTarget = path.join(root, 'removed-source', 'stale-entrypoint-symlink-skill', 'SKILL.md');

    await mkdir(skillDir, { recursive: true });
    await symlink(missingEntrypointTarget, path.join(skillDir, 'SKILL.md'));

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'stale-entrypoint-symlink-skill')).toMatchObject({
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'unreadable-file',
            entrypointPath: path.join(skillDir, 'SKILL.md'),
          }),
        ]),
      },
    });
  });

  it('keeps scanning the live Claude skills folder when SKILL.md points at a removed nested skill', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-live-claude-stale-entrypoint-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const env = {
      SKILL_INDEX_AGENT_SUBSET: 'claude',
    };
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const claudeSkillsDir = path.join(homeDir, '.claude', 'skills');
    const autoplanDir = path.join(claudeSkillsDir, 'autoplan');
    const missingNestedEntrypoint = path.join(claudeSkillsDir, 'gstack', 'autoplan', 'SKILL.md');

    await mkdir(autoplanDir, { recursive: true });
    await symlink(missingNestedEntrypoint, path.join(autoplanDir, 'SKILL.md'));

    const inventory = await scanInventory({
      paths,
      homeDir,
      env,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'autoplan')).toMatchObject({
      locations: arrayContaining([
        objectContaining({
          path: autoplanDir,
          entrypointPath: path.join(autoplanDir, 'SKILL.md'),
          sourceId: 'live-claude',
        }),
      ]),
      issueReasons: arrayContaining(['invalid-definition']),
      detailDiagnostics: {
        definitionIssues: arrayContaining([
          objectContaining({
            type: 'unreadable-file',
            entrypointPath: path.join(autoplanDir, 'SKILL.md'),
          }),
        ]),
      },
    });
  });

  it('keeps scanning valid skills when discovery reaches an unreadable nested directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-unreadable-discovery-dir-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');
    const unreadableDir = path.join(customSkillsDir, 'archived');

    await writeSkillFile(
      customSkillsDir,
      'healthy-custom-skill',
      [
        '---',
        'name: healthy-custom-skill',
        'description: Healthy custom skill.',
        '---',
        '',
        '# Healthy custom skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await mkdir(unreadableDir, { recursive: true });
    await chmod(unreadableDir, 0o000);
    try {
      await writeSkillIndexConfig(paths.configFile, {
        customScanPaths: [customSkillsDir],
        preferredCanonicalSourcePath: null,
        dismissedDriftSignatures: [],
        dismissedMcpSignatures: [],
      });

      const inventory = await scanInventory({
        paths,
        includeSandboxSources: false,
        includeLiveSources: false,
      });

      expect(inventory.skills.find((skill) => skill.name === 'healthy-custom-skill')).toMatchObject({
        issueReasons: arrayContaining(['missing-canonical']),
      });
    } finally {
      await chmod(unreadableDir, 0o700).catch(() => undefined);
    }
  });

  it('keeps a skill readable when an unreadable support directory cannot be walked', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-unreadable-support-dir-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const skillDir = path.join(paths.sandboxAgentsSkillsDir, 'support-dir-permission-skill');
    const unreadableSupportDir = path.join(skillDir, 'private');

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'support-dir-permission-skill',
      [
        '---',
        'name: support-dir-permission-skill',
        'description: Skill with a private support directory.',
        '---',
        '',
        '# Support dir permission skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await mkdir(unreadableSupportDir, { recursive: true });
    await chmod(unreadableSupportDir, 0o000);
    try {
      const inventory = await scanInventory({
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      });

      expect(inventory.skills.find((skill) => skill.name === 'support-dir-permission-skill')).toMatchObject({
        description: 'Skill with a private support directory.',
        detailDiagnostics: {
          definitionIssues: [],
        },
      });
    } finally {
      await chmod(unreadableSupportDir, 0o700).catch(() => undefined);
    }
  });

  it('keeps scanning when discovery encounters a symlinked directory cycle', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-discovery-cycle-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');

    await writeSkillFile(
      customSkillsDir,
      'cycle-neighbor-skill',
      [
        '---',
        'name: cycle-neighbor-skill',
        'description: Neighbor skill next to a directory loop.',
        '---',
        '',
        '# Cycle neighbor skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await symlink(customSkillsDir, path.join(customSkillsDir, 'loop'));
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: false,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'cycle-neighbor-skill')).toMatchObject({
      description: 'Neighbor skill next to a directory loop.',
    });
  });

  it('keeps a skill readable when its support files contain a symlinked directory cycle', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-package-cycle-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const skillDir = path.join(paths.sandboxAgentsSkillsDir, 'support-dir-cycle-skill');

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'support-dir-cycle-skill',
      [
        '---',
        'name: support-dir-cycle-skill',
        'description: Skill with a support directory cycle.',
        '---',
        '',
        '# Support dir cycle skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await symlink(skillDir, path.join(skillDir, 'loop'));

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'support-dir-cycle-skill')).toMatchObject({
      description: 'Skill with a support directory cycle.',
      detailDiagnostics: {
        definitionIssues: [],
      },
    });
  });

  it('keeps repeated support-directory aliases in package files when they are not recursive cycles', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-package-aliases-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const skillDir = path.join(paths.sandboxAgentsSkillsDir, 'support-dir-alias-skill');
    const sharedSupportDir = path.join(skillDir, 'shared-support');

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'support-dir-alias-skill',
      [
        '---',
        'name: support-dir-alias-skill',
        'description: Skill with repeated support directory aliases.',
        '---',
        '',
        '# Support dir alias skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeNestedSkillFile(
      path.join(sharedSupportDir, 'guide.md'),
      '# Shared support guide\n',
      '2026-04-09T00:00:01.000Z',
    );
    await symlink(sharedSupportDir, path.join(skillDir, 'alias-a'));
    await symlink(sharedSupportDir, path.join(skillDir, 'alias-b'));

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(
      inventory.skills
        .find((skill) => skill.name === 'support-dir-alias-skill')
        ?.locations.find((location) => location.path === skillDir)
        ?.packageFiles?.map((file) => file.relativePath),
    ).toEqual([
      'alias-a/guide.md',
      'alias-b/guide.md',
      'shared-support/guide.md',
      'SKILL.md',
    ].sort((left, right) => left.localeCompare(right)));
  });

  it('treats identical zero-byte markdown copies as identical drift with stable hashes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'empty-identical-skill', '', '2026-01-07T00:00:00.000Z');
    await writeSkillFile(
      path.join(paths.sandboxRoot, '.factory', 'skills'),
      'empty-identical-skill',
      '',
      '2026-01-07T00:00:01.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const emptySkill = inventory.skills.find((skill) => skill.name === 'empty-identical-skill');

    expect(emptySkill?.structuralState).toBe('identical-drift');
    expect(emptySkill?.isDrifted).toBe(true);
    expect(emptySkill?.diff).toBeUndefined();
    const contentHashes = new Set((emptySkill?.locations ?? []).map((location) => location.contentHash));
    expect(contentHashes.size).toBe(1);
    expect([...contentHashes][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps diverged empty-vs-nonempty copies visible in the diff output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'empty-to-full-skill', '', '2026-01-08T00:00:00.000Z');
    await writeSkillFile(
      path.join(paths.sandboxRoot, '.claude', 'skills'),
      'empty-to-full-skill',
      'Only content.\n',
      '2026-01-08T00:00:01.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const divergedSkill = inventory.skills.find((skill) => skill.name === 'empty-to-full-skill');

    expect(divergedSkill?.structuralState).toBe('diverged-drift');
    expect(divergedSkill?.diff?.selectedPath).toBe(path.join(paths.sandboxRoot, '.claude', 'skills', 'empty-to-full-skill'));
    expect(divergedSkill?.diff?.files?.[0]?.lines).toEqual([
      {
        type: 'added',
        text: 'Only content.',
      },
    ]);
  });

  it('builds first-class detail diagnostics for duplicate candidates, install sources, and missing required front matter fields', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'diagnostic-rich-skill',
      [
        '---',
        'name: diagnostic-rich-skill',
        'description: Canonical detail candidate.',
        '---',
        '',
        '# Diagnostic rich skill',
        'Canonical content.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await writeSkillFile(
      path.join(paths.sandboxRoot, '.claude', 'skills'),
      'diagnostic-rich-skill',
      [
        '---',
        'name: diagnostic-rich-skill',
        '---',
        '',
        '# Diagnostic rich skill',
        'Claude copy without a description.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:02.000Z',
    );
    await writeSkillFile(
      path.join(paths.sandboxRoot, '.factory', 'skills'),
      'diagnostic-rich-skill',
      [
        '---',
        'description: Factory copy without a name field.',
        '---',
        '',
        '# Diagnostic rich skill',
        'Factory copy missing the required name.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:01.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const skill = inventory.skills.find((entry) => entry.name === 'diagnostic-rich-skill');

    expect(skill).toMatchObject({
      description: 'Canonical detail candidate.',
      structuralState: 'diverged-drift',
    });
    expect(skill?.detailDiagnostics.duplicateCandidates.map((candidate) => candidate.sourceId)).toEqual(
      expect.arrayContaining(['sandbox-agents', 'sandbox-claude', 'sandbox-factory']),
    );
    expect(skill?.detailDiagnostics.duplicateCandidates).toEqual(
      expect.arrayContaining([
        objectContaining({
          path: path.join(paths.sandboxRoot, '.agents', 'skills', 'diagnostic-rich-skill'),
          definitionText: stringContaining('name: diagnostic-rich-skill'),
        }),
        objectContaining({
          path: path.join(paths.sandboxRoot, '.claude', 'skills', 'diagnostic-rich-skill'),
          definitionText: stringContaining('Claude copy without a description.'),
        }),
      ]),
    );
    expect(skill?.detailDiagnostics.duplicateCandidates.every(
      (candidate) => typeof candidate.definitionText === 'string' && candidate.definitionText.length > 0,
    )).toBe(true);
    expect(skill?.detailDiagnostics.installSources.map((source) => source.sourceId)).toEqual(
      expect.arrayContaining(['sandbox-agents', 'sandbox-claude', 'sandbox-factory']),
    );
    expect(skill?.detailDiagnostics.definitionIssues?.map((issue) => issue.sourceId)).toEqual(
      expect.arrayContaining(['sandbox-claude', 'sandbox-factory']),
    );
    expect(skill?.detailDiagnostics).not.toHaveProperty('skillNameIssues');
    expect(skill?.detailDiagnostics).not.toHaveProperty('updatesPending');
  });

  it('prefers a canonical quoted frontmatter description when building skill rows', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'quoted-description-skill',
      [
        '---',
        'name: quoted-description-skill',
        'description: "Quoted canonical description."',
        '---',
        '',
        '# Quoted description skill',
        'Canonical content.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await writeSkillFile(
      path.join(paths.sandboxRoot, '.claude', 'skills'),
      'quoted-description-skill',
      [
        '---',
        'name: quoted-description-skill',
        'description: Secondary description.',
        '---',
        '',
        '# Quoted description skill',
        'Secondary content.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:01.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'quoted-description-skill')?.description).toBe('Quoted canonical description.');
  });

  it('prefers a folded canonical frontmatter description when building skill rows', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'folded-description-skill',
      [
        '---',
        'name: folded-description-skill',
        'description: >-',
        '  Build, profile, debug, and refine iOS apps',
        '  with SwiftUI and Xcode workflows.',
        '---',
        '',
        '# Folded description skill',
        'Canonical content.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'folded-description-skill')?.description).toBe(
      'Build, profile, debug, and refine iOS apps with SwiftUI and Xcode workflows.',
    );
  });

  it('uses the frontmatter name as the skill display name and backfills it from legacy cached snapshots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'slides',
      [
        '---',
        'name: "PowerPoint"',
        'description: "Deck workflow"',
        '---',
        '',
        '# PowerPoint',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'slides')).toMatchObject({
      displayName: 'PowerPoint',
      name: 'slides',
    });
    expect(inventory.skills.find((skill) => skill.name === 'slides')?.issueReasons).not.toContain('invalid-definition');

    const legacySnapshot = {
      ...inventory,
      skills: inventory.skills.map((skill) => {
        const { displayName, ...legacySkill } = skill;
        void displayName;
        return legacySkill;
      }),
    };
    await writeFile(paths.cacheFile, `${JSON.stringify(legacySnapshot, null, 2)}\n`, 'utf8');

    const cachedInventory = await readCachedInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(cachedInventory?.skills.find((skill) => skill.name === 'slides')?.displayName).toBe('PowerPoint');
  });

  it('preserves unchanged middle lines when diverged copies contain separated edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'multi-hunk-skill',
      ['# Multi hunk skill', 'keep one', 'old alpha', 'stable bridge', 'old omega', 'keep end', ''].join('\n'),
      '2026-01-09T00:00:00.000Z',
    );
    await writeSkillFile(
      path.join(paths.sandboxRoot, '.claude', 'skills'),
      'multi-hunk-skill',
      ['# Multi hunk skill', 'keep one', 'new alpha', 'stable bridge', 'new omega', 'keep end', ''].join('\n'),
      '2026-01-09T00:00:01.000Z',
    );

    const inventory = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const divergedSkill = inventory.skills.find((skill) => skill.name === 'multi-hunk-skill');

    expect(divergedSkill?.structuralState).toBe('diverged-drift');
    expect(divergedSkill?.diff?.files?.[0]?.lines).toEqual([
      {
        type: 'context',
        text: '# Multi hunk skill',
      },
      {
        type: 'context',
        text: 'keep one',
      },
      {
        type: 'removed',
        text: 'old alpha',
      },
      {
        type: 'added',
        text: 'new alpha',
      },
      {
        type: 'context',
        text: 'stable bridge',
      },
      {
        type: 'removed',
        text: 'old omega',
      },
      {
        type: 'added',
        text: 'new omega',
      },
      {
        type: 'context',
        text: 'keep end',
      },
    ]);
  });

  it('creates bootstrap cache/config files on first launch and persists the first live snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'fresh-launch-skill', '# Fresh launch\n', '2026-01-10T00:00:00.000Z');

    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toBeNull();
    await expect(readFile(paths.cacheFile, 'utf8')).resolves.toBe('{}\n');
    await expect(readFile(paths.configFile, 'utf8')).resolves.toContain('"customScanPaths": []');

    const liveSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toEqual(liveSnapshot);
  });

  it('hydrates custom scan path inventory from config and drops it again after the path is removed from config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'base-skill', '# Base skill\n', '2026-04-09T00:00:00.000Z');
    await writeSkillFile(customSkillsDir, 'custom-only-skill', '# Custom skill\n', '2026-04-09T00:01:00.000Z');
    await writeSkillFile(customSkillsDir, 'base-skill', '# Base skill duplicate\n', '2026-04-09T00:02:00.000Z');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const inventoryWithCustomPath = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(inventoryWithCustomPath.sourceIds).toEqual(['sandbox-agents', `custom:${customSkillsDir}`]);
    expect(inventoryWithCustomPath.skills.map((skill) => [skill.name, skill.structuralState, skill.locations.length])).toEqual([
      ['base-skill', 'diverged-drift', 2],
      ['custom-only-skill', 'single-source-noncanonical', 1],
    ]);
    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toEqual(inventoryWithCustomPath);

    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const cachedAfterRemoval = await readCachedInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(cachedAfterRemoval?.sourceIds).toEqual(['sandbox-agents']);
    expect(cachedAfterRemoval?.skills.map((skill) => [skill.name, skill.structuralState, skill.locations.length])).toEqual([
      ['base-skill', 'healthy', 1],
    ]);

    const rescannedAfterRemoval = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(rescannedAfterRemoval.sourceIds).toEqual(['sandbox-agents']);
    expect(rescannedAfterRemoval.skills.map((skill) => [skill.name, skill.structuralState, skill.locations.length])).toEqual([
      ['base-skill', 'healthy', 1],
    ]);
  });

  it('hydrates home-relative custom scan path inventory from config on scan and relaunch', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const customSkillsDir = path.join(homeDir, 'custom-skills');

    await writeSkillFile(customSkillsDir, 'home-relative-skill', '# Home-relative skill\n', '2026-04-09T00:01:00.000Z');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: ['~/custom-skills'],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const scannedSnapshot = await scanInventory({
      paths,
      homeDir,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(scannedSnapshot.sourceIds).toEqual(['sandbox-agents', `custom:${customSkillsDir}`]);
    expect(scannedSnapshot.skills.map((skill) => [skill.name, skill.structuralState, skill.locations.length])).toEqual([
      ['home-relative-skill', 'single-source-noncanonical', 1],
    ]);

    await expect(
      readCachedInventory({
        paths,
        homeDir,
        includeSandboxSources: true,
        includeLiveSources: false,
      }),
    ).resolves.toEqual(scannedSnapshot);
  });

  it('treats a configured preferred canonical repo as the source of truth when a matching live skill exists there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const preferredRepoRoot = path.join(homeDir, 'repos', 'arjit-skills');
    const preferredSkillsDir = path.join(preferredRepoRoot, 'skills');
    const canonicalSkillPath = path.join(preferredSkillsDir, 'repo-backed-skill');
    const agentsSkillPath = path.join(homeDir, '.agents', 'skills', 'repo-backed-skill');
    const claudeSkillPath = path.join(homeDir, '.claude', 'skills', 'repo-backed-skill');

    await writeSkillFile(
      preferredSkillsDir,
      'repo-backed-skill',
      [
        '---',
        'name: repo-backed-skill',
        'description: Preferred canonical repo skill.',
        '---',
        '',
        '# Repo backed skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await mkdir(path.dirname(agentsSkillPath), { recursive: true });
    await mkdir(path.dirname(claudeSkillPath), { recursive: true });
    await symlink(canonicalSkillPath, agentsSkillPath);
    await symlink(canonicalSkillPath, claudeSkillPath);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [preferredRepoRoot],
      preferredCanonicalSourcePath: preferredRepoRoot,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const snapshot = await scanInventory({
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });

    expect(snapshot.sourceIds).toEqual(expect.arrayContaining([
      `preferred-canonical:${preferredRepoRoot}`,
      'live-agents',
      'live-claude',
    ]));
    expect(snapshot.sourceIds).not.toContain(`custom:${preferredRepoRoot}`);

    expect(snapshot.skills.find((skill) => skill.name === 'repo-backed-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      locations: arrayContaining([
        objectContaining({
          path: canonicalSkillPath,
          canonical: true,
          fileType: 'real-file',
        }),
        objectContaining({
          path: agentsSkillPath,
          canonical: false,
          fileType: 'symlink',
          resolvedPath: stringMatching(/repos\/arjit-skills\/skills\/repo-backed-skill$/),
        }),
        objectContaining({
          path: claudeSkillPath,
          canonical: false,
          fileType: 'symlink',
          resolvedPath: stringMatching(/repos\/arjit-skills\/skills\/repo-backed-skill$/),
        }),
      ]),
    });
  });

  it('marks plugin-only skills as needing Universal links', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-universal-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'foo',
      [
        '---',
        'name: foo',
        'description: Plugin foo.',
        '---',
        '',
        '# Foo',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await mkdir(path.join(homeDir, '.agents', 'skills'), { recursive: true });
    await mkdir(path.join(homeDir, '.factory'), { recursive: true });
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    const skill = inventory.skills.find((entry) => entry.name === 'tools:foo');
    expect(skill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
    });
    expect(skill?.detailDiagnostics.missingInstallSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'live-agents', canonical: false, writable: true }),
      expect.objectContaining({ sourceId: 'live-factory', kind: 'agent', writable: true }),
    ]));
  });

  it('does not report identical copies for read-only plugin cache versions with matching content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-cache-identical-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const firstPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const secondPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.1.0');
    const pluginSkillContent = [
      '---',
      'name: foo',
      'description: Plugin foo.',
      '---',
      '',
      '# Foo',
      'Plugin content shared by two cached versions.',
      '',
    ].join('\n');

    for (const [pluginRoot, version] of [[firstPluginRoot, '1.0.0'], [secondPluginRoot, '1.1.0']] as const) {
      await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
      await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
        name: 'tools',
        version,
      }, null, 2), 'utf8');
      await writeSkillFile(
        path.join(pluginRoot, 'skills'),
        'foo',
        pluginSkillContent,
        version === '1.0.0' ? '2026-01-08T00:00:00.000Z' : '2026-01-08T00:01:00.000Z',
      );
    }
    await mkdir(path.join(homeDir, '.agents', 'skills'), { recursive: true });
    await mkdir(path.join(homeDir, '.factory'), { recursive: true });
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    const skill = inventory.skills.find((entry) => entry.name === 'tools:foo');
    expect(skill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
    });
    expect(skill?.issueReasons).not.toContain('identical-copies');
    expect(skill?.detailDiagnostics.duplicateCandidates).toHaveLength(2);
    expect(skill?.detailDiagnostics.missingInstallSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'live-agents', canonical: false, writable: true }),
      expect.objectContaining({ sourceId: 'live-factory', kind: 'agent', writable: true }),
    ]));
  });

  it('groups a same-slug plugin skill with the matching local skill as diverged copies', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-self-named-plugin-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'frontend-design', '1.0.0');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'frontend-design',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'frontend-design',
      [
        '---',
        'name: frontend-design',
        'description: Plugin frontend design guidance.',
        '---',
        '',
        '# Frontend Design',
        'Plugin version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await writeSkillFile(
      path.join(homeDir, '.agents', 'skills'),
      'frontend-design',
      [
        '---',
        'name: frontend-design',
        'description: Local frontend design guidance.',
        '---',
        '',
        '# Frontend Design',
        'Local version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:01.000Z',
    );

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.skills.find((entry) => entry.name === 'frontend-design:frontend-design')).toBeUndefined();
    expect(inventory.skills.find((entry) => entry.name === 'frontend-design')).toMatchObject({
      displayName: 'frontend-design',
      structuralState: 'diverged-drift',
      isDrifted: true,
      issueReasons: arrayContaining(['diverged-copies']),
      locations: arrayContaining([
        objectContaining({
          provenance: objectContaining({
            kind: 'plugin',
            plugin: objectContaining({ pluginId: 'frontend-design@official' }),
          }),
        }),
        objectContaining({
          sourceId: 'live-agents',
          provenance: objectContaining({ kind: 'universal' }),
        }),
      ]),
      detailDiagnostics: {
        duplicateCandidates: arrayContaining([
          objectContaining({
            fileType: 'real-file',
            provenance: objectContaining({ kind: 'plugin' }),
          }),
          objectContaining({
            fileType: 'real-file',
            sourceId: 'live-agents',
          }),
        ]),
      },
    });
  });

  it('groups stale plugin-qualified mirrors with the matching same-slug plugin skill', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-qualified-display-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'linear', 'current-revision');
    const staleLinkPaths = [
      path.join(homeDir, '.agents', 'skills', 'linear:linear'),
      path.join(homeDir, '.codex', 'skills', 'linear:linear'),
    ];
    const missingPluginPath = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'linear', 'old-revision', 'skills', 'linear');

    await mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'linear',
      version: 'current-revision',
      skills: './skills',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'linear',
      [
        '---',
        'name: linear',
        'description: Plugin Linear workflow.',
        '---',
        '',
        '# Linear',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    for (const staleLinkPath of staleLinkPaths) {
      await mkdir(path.dirname(staleLinkPath), { recursive: true });
      await symlink(missingPluginPath, staleLinkPath);
    }

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    const linearSkill = inventory.skills.find((entry) => entry.name === 'linear');
    expect(inventory.skills.find((entry) => entry.name === 'linear:linear')).toBeUndefined();
    expect(linearSkill).toMatchObject({
      displayName: 'linear',
      issueReasons: arrayContaining(['broken-symlink']),
      locations: arrayContaining([
        objectContaining({
          path: path.join(pluginRoot, 'skills', 'linear'),
          provenance: objectContaining({ kind: 'plugin' }),
        }),
        objectContaining({
          path: staleLinkPaths[0],
          fileType: 'symlink',
        }),
        objectContaining({
          path: staleLinkPaths[1],
          fileType: 'symlink',
        }),
      ]),
    });
  });

  it('treats a different plugin skill as a healthy accepted alternate when local Universal wins', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-alternate-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'foo',
      [
        '---',
        'name: foo',
        'description: Plugin foo.',
        '---',
        '',
        '# Foo',
        'Plugin version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await writeSkillFile(
      path.join(homeDir, '.agents', 'skills'),
      'foo',
      [
        '---',
        'name: foo',
        'description: Local foo.',
        '---',
        '',
        '# Foo',
        'Local version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:01.000Z',
    );
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(universalPath, claudePath);
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(universalPath, factoryPath);
    await mkdir(path.join(homeDir, '.factory'), { recursive: true });
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');
    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
      skillUniversalDecisions: [{
        id: 'skill:foo:local',
        skillName: 'foo',
        state: 'user-confirmed',
        universal: { kind: 'path', sourceId: 'live-agents', path: universalPath },
        acceptedAlternates: [{
          kind: 'plugin',
          host: 'claude',
          pluginId: 'tools@official',
          pluginVersion: '1.0.0',
          pluginSkillName: 'foo',
          reason: 'kept-separate',
        }],
        updatedAt: '2026-05-07T00:00:00.000Z',
      }],
    });

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    const localSkill = inventory.skills.find((entry) => entry.name === 'foo');
    expect(localSkill).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
      detailDiagnostics: {
        acceptedAlternates: [
          expect.objectContaining({
            kind: 'plugin',
            pluginId: 'tools@official',
            reason: 'kept-separate',
          }),
        ],
      },
    });
    expect(inventory.skills.find((entry) => entry.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });

    const cachedInventory = await readCachedInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: true,
    });
    expect(cachedInventory?.skills.find((entry) => entry.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });
  });

  it('does not treat a different plugin version as a healthy accepted alternate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-alternate-version-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '2.0.0');
    const universalPath = path.join(homeDir, '.agents', 'skills', 'foo');
    const claudePath = path.join(homeDir, '.claude', 'skills', 'foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '2.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'foo',
      [
        '---',
        'name: foo',
        'description: Plugin foo v2.',
        '---',
        '',
        '# Foo',
        'Plugin version two.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await writeSkillFile(
      path.join(homeDir, '.agents', 'skills'),
      'foo',
      [
        '---',
        'name: foo',
        'description: Local foo.',
        '---',
        '',
        '# Foo',
        'Local version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:01.000Z',
    );
    await mkdir(path.dirname(claudePath), { recursive: true });
    await symlink(universalPath, claudePath);
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(universalPath, factoryPath);
    await mkdir(path.join(homeDir, '.factory'), { recursive: true });
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');
    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
      skillUniversalDecisions: [{
        id: 'skill:foo:local',
        skillName: 'foo',
        state: 'user-confirmed',
        universal: { kind: 'path', sourceId: 'live-agents', path: universalPath },
        acceptedAlternates: [{
          kind: 'plugin',
          host: 'claude',
          pluginId: 'tools@official',
          pluginVersion: '1.0.0',
          pluginSkillName: 'foo',
          reason: 'kept-separate',
        }],
        updatedAt: '2026-05-07T00:00:00.000Z',
      }],
    });

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.skills.find((entry) => entry.name === 'foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });
    expect(inventory.skills.find((entry) => entry.name === 'tools:foo')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      issueReasons: ['missing-symlinks'],
    });
  });

  it('treats symlinks to an explicitly selected plugin Universal as healthy for a manual skill name', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-manual-symlink-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'foo');

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'foo',
      [
        '---',
        'name: foo',
        'description: Plugin foo.',
        '---',
        '',
        '# Foo',
        'Plugin version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await symlink(pluginSkillPath, agentsPath);
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(pluginSkillPath, factoryPath);
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');
    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
      skillUniversalDecisions: [{
        id: 'skill:foo:plugin',
        skillName: 'foo',
        state: 'user-confirmed',
        universal: {
          kind: 'plugin',
          host: 'claude',
          pluginId: 'tools@official',
          pluginVersion: '1.0.0',
          pluginSkillName: 'foo',
        },
        acceptedAlternates: [],
        updatedAt: '2026-05-07T00:00:00.000Z',
      }],
    });

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });
    const resolvedPluginSkillPath = await realpath(pluginSkillPath);

    expect(inventory.skills.find((entry) => entry.name === 'foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });
    expect(inventory.skills.find((entry) => entry.name === 'foo')?.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: agentsPath,
        fileType: 'symlink',
        resolvedPath: resolvedPluginSkillPath,
        canonical: false,
      }),
      expect.objectContaining({
        path: factoryPath,
        fileType: 'symlink',
        resolvedPath: resolvedPluginSkillPath,
        canonical: false,
      }),
    ]));
  });

  it('treats symlink-only skills pointing at one plugin cache skill as healthy', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-symlink-only-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const pluginSkillPath = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0', 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');
    const factoryPath = path.join(homeDir, '.factory', 'skills', 'tools:foo');

    await writeSkillFile(
      path.dirname(pluginSkillPath),
      path.basename(pluginSkillPath),
      [
        '---',
        'name: foo',
        'description: Plugin foo.',
        '---',
        '',
        '# Foo',
        'Plugin version.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await symlink(pluginSkillPath, agentsPath);
    await mkdir(path.dirname(factoryPath), { recursive: true });
    await symlink(pluginSkillPath, factoryPath);
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.skills.find((entry) => entry.name === 'tools:foo')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      issueReasons: [],
    });
  });

  it('marks symlinks to old plugin cache paths as wrong Universal links', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-cache-repair-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
      },
      homeDir,
    });
    const oldSkillPath = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0', 'skills', 'foo');
    const newPluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '2.0.0');
    const newSkillPath = path.join(newPluginRoot, 'skills', 'foo');
    const agentsPath = path.join(homeDir, '.agents', 'skills', 'tools:foo');

    await mkdir(path.join(newPluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(newPluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '2.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.dirname(newSkillPath),
      path.basename(newSkillPath),
      [
        '---',
        'name: foo',
        'description: Plugin foo v2.',
        '---',
        '',
        '# Foo',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await writeSkillFile(
      path.dirname(oldSkillPath),
      path.basename(oldSkillPath),
      [
        '---',
        'name: foo',
        'description: Plugin foo v1.',
        '---',
        '',
        '# Foo',
        '',
      ].join('\n'),
      '2026-01-07T00:00:00.000Z',
    );
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await symlink(oldSkillPath, agentsPath);
    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
      skillUniversalDecisions: [{
        id: 'skill:tools-foo:plugin',
        skillName: 'tools:foo',
        state: 'policy',
        universal: {
          kind: 'plugin',
          host: 'claude',
          pluginId: 'tools@official',
          pluginSkillName: 'foo',
        },
        acceptedAlternates: [],
        updatedAt: '2026-05-07T00:00:00.000Z',
      }],
    });

    const inventory = await scanInventory({
      paths,
      homeDir,
      includeLiveSources: true,
      includeSandboxSources: false,
    });

    expect(inventory.skills.find((skill) => skill.name === 'tools:foo')).toMatchObject({
      issueReasons: arrayContaining(['wrong-symlink-target']),
    });
  });

  it('treats the shared .agents symlink as satisfying agents whose global skills directory resolves there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const preferredRepoRoot = path.join(homeDir, 'repos', 'arjit-skills');
    const preferredSkillsDir = path.join(preferredRepoRoot, 'skills');
    const canonicalSkillPath = path.join(preferredSkillsDir, 'shared-agents-backed-skill');
    const agentsSkillPath = path.join(homeDir, '.agents', 'skills', 'shared-agents-backed-skill');

    await writeSkillFile(
      preferredSkillsDir,
      'shared-agents-backed-skill',
      [
        '---',
        'name: shared-agents-backed-skill',
        'description: Preferred canonical repo skill linked through shared agents.',
        '---',
        '',
        '# Shared agents backed skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await mkdir(path.join(homeDir, '.codex'), { recursive: true });
    await mkdir(path.join(homeDir, '.cursor'), { recursive: true });
    await mkdir(path.join(homeDir, '.config', 'opencode'), { recursive: true });
    await mkdir(path.dirname(agentsSkillPath), { recursive: true });
    await symlink(canonicalSkillPath, agentsSkillPath);
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [preferredRepoRoot],
      preferredCanonicalSourcePath: preferredRepoRoot,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const scanOptions = {
      paths,
      homeDir,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'codex,cursor,opencode',
      },
      includeSandboxSources: false,
      includeLiveSources: true,
    } as const;
    const snapshot = await scanInventory(scanOptions);

    const skill = snapshot.skills.find((candidate) => candidate.name === 'shared-agents-backed-skill');
    expect(skill).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
      detailDiagnostics: {
        missingInstallSources: [],
      },
    });

    const cachedSnapshot = await readCachedInventory(scanOptions);
    expect(cachedSnapshot?.skills.find((candidate) => candidate.name === 'shared-agents-backed-skill')).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
      detailDiagnostics: {
        missingInstallSources: [],
      },
    });
  });

  it('uses preferred canonical repo real files as diverged version candidates instead of linked agent symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-preferred-diverged-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const skillName = 'frontend-design';
    const preferredRepoRoot = path.join(homeDir, 'repos', 'arjit-skills');
    const preferredSkillsDir = path.join(preferredRepoRoot, 'skills');
    const repoSkillPath = path.join(preferredSkillsDir, skillName);
    const agentsSkillPath = path.join(homeDir, '.agents', 'skills', skillName);
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'claude-unknown', skillName, '1.0.0');
    const pluginSkillPath = path.join(pluginRoot, 'skills', skillName);

    await writeSkillFile(
      preferredSkillsDir,
      skillName,
      [
        '---',
        `name: ${skillName}`,
        'description: Repo-backed frontend design skill.',
        '---',
        '',
        '# Frontend design',
        'Repo version.',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await mkdir(path.dirname(agentsSkillPath), { recursive: true });
    await symlink(repoSkillPath, agentsSkillPath);
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: skillName,
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      skillName,
      [
        '---',
        `name: ${skillName}`,
        'description: Plugin frontend design skill.',
        '---',
        '',
        '# Frontend design',
        'Plugin version.',
        '',
      ].join('\n'),
      '2026-04-09T00:01:00.000Z',
    );
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [preferredRepoRoot],
      preferredCanonicalSourcePath: preferredRepoRoot,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const snapshot = await scanInventory({
      paths,
      homeDir,
      includeSandboxSources: false,
      includeLiveSources: true,
    });
    const skill = snapshot.skills.find((candidate) => candidate.name === skillName);

    expect(skill).toMatchObject({
      structuralState: 'diverged-drift',
      issueReasons: arrayContaining(['diverged-copies']),
    });
    expect(skill?.locations).toEqual(arrayContaining([
      objectContaining({
        path: repoSkillPath,
        canonical: true,
        fileType: 'real-file',
      }),
      objectContaining({
        path: agentsSkillPath,
        canonical: false,
        fileType: 'symlink',
        resolvedPath: stringMatching(/repos\/arjit-skills\/skills\/frontend-design$/),
      }),
      objectContaining({
        path: pluginSkillPath,
        canonical: false,
        fileType: 'real-file',
      }),
    ]));
    expect(skill?.detailDiagnostics.duplicateCandidates.map((candidate) => ({
      path: candidate.path,
      fileType: candidate.fileType,
      canonical: candidate.canonical,
    })).sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      {
        path: pluginSkillPath,
        fileType: 'real-file',
        canonical: false,
      },
      {
        path: repoSkillPath,
        fileType: 'real-file',
        canonical: true,
      },
    ].sort((left, right) => left.path.localeCompare(right.path)));
  });

  it('hydrates from the saved cache and rewrites it to reconciled live disk truth after refresh', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const initialSnapshot = await seedRepresentativeFixtures({ paths }).then(() =>
      scanInventory({
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      }),
    );

    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toEqual(initialSnapshot);

    await rm(path.join(paths.sandboxRoot, '.factory', 'skills', 'identical-drift-skill'), { recursive: true, force: true });

    const reconciledSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(reconciledSnapshot.counts.driftedSkills).toBeGreaterThan(0);
    expect(reconciledSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
    });
    const cachedSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    expect(cachedSnapshot).toEqual(reconciledSnapshot);
    expect(cachedSnapshot?.skills.find((skill) => skill.name === 'identical-drift-skill')?.locations).toHaveLength(3);
  });

  it('reapplies newly dismissed drift signatures when hydrating an unchanged cached source set', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const initialSnapshot = await seedRepresentativeFixtures({ paths }).then(() =>
      scanInventory({
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      }),
    );

    expect(initialSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')?.driftPresentation).toBe('active');

    await dismissDrift(
      {
        skillName: 'identical-drift-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const cachedSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });

    expect(cachedSnapshot?.sourceIds).toEqual(initialSnapshot.sourceIds);
    expect(cachedSnapshot?.skills.find((skill) => skill.name === 'identical-drift-skill')).toMatchObject({
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'dismissed',
    });
    expect(cachedSnapshot?.counts.dismissedDriftSkills).toBe(initialSnapshot.counts.dismissedDriftSkills + 1);
    expect(cachedSnapshot?.counts.driftedSkills).toBe(initialSnapshot.counts.driftedSkills - 1);
  });

  it('keeps dismissed drift signatures when a source is temporarily unavailable during a scan', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');
    const skillName = 'temporarily-unavailable-dismissed-skill';

    await writeSkillFile(customSkillsDir, skillName, '# Temporarily unavailable dismissed skill\n', '2026-04-09T00:01:00.000Z');
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const initialSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const initialSkill = initialSnapshot.skills.find((skill) => skill.name === skillName);

    expect(initialSkill).toMatchObject({
      structuralState: 'single-source-noncanonical',
      isDrifted: true,
      driftPresentation: 'active',
    });

    const dismissedSnapshot = await dismissDrift(
      {
        skillName,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );
    const dismissedSignature = dismissedSnapshot.skills.find((skill) => skill.name === skillName)?.driftSignature;

    expect(dismissedSnapshot.skills.find((skill) => skill.name === skillName)?.driftPresentation).toBe('dismissed');
    expect(dismissedSignature).toBeDefined();

    await rm(customSkillsDir, { recursive: true, force: true });

    const unavailableSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(unavailableSnapshot.skills.find((skill) => skill.name === skillName)).toBeUndefined();
    const configWhileUnavailable = JSON.parse(await readFile(paths.configFile, 'utf8')) as {
      dismissedDriftSignatures: string[];
    };
    expect(configWhileUnavailable.dismissedDriftSignatures).toContain(dismissedSignature);

    await writeSkillFile(customSkillsDir, skillName, '# Temporarily unavailable dismissed skill\n', '2026-04-09T00:01:00.000Z');

    const restoredSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(restoredSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'single-source-noncanonical',
      isDrifted: true,
      driftPresentation: 'dismissed',
    });
  });

  it('keeps dismissed missing-symlink plugin skills hidden when managed plugin content changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-dismissal-'));
    const homeDir = path.join(root, 'home');
    const dataDir = path.join(root, 'data');
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: dataDir,
        SKILL_INDEX_AGENT_SUBSET: 'factory',
      },
      homeDir,
    });
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'official', 'tools', '1.0.0');
    const skillName = 'tools:plugin-only';

    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'tools',
      version: '1.0.0',
    }, null, 2), 'utf8');
    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'plugin-only',
      [
        '---',
        'name: plugin-only',
        'description: Plugin only.',
        '---',
        '',
        '# Plugin Only',
        'Initial content.',
        '',
      ].join('\n'),
      '2026-01-08T00:00:00.000Z',
    );
    await mkdir(path.join(homeDir, '.factory'), { recursive: true });
    await writeFile(path.join(homeDir, '.factory', 'settings.json'), '{}\n', 'utf8');

    const scanOptions = {
      paths,
      homeDir,
      env: {
        SKILL_INDEX_AGENT_SUBSET: 'factory',
      },
      includeLiveSources: true,
      includeSandboxSources: false,
    };
    const initialSnapshot = await scanInventory(scanOptions);
    expect(initialSnapshot.skills.find((skill) => skill.name === skillName)).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
    });

    const dismissedSnapshot = await dismissDrift({ skillName }, scanOptions);
    const dismissedSignature = dismissedSnapshot.skills.find((skill) => skill.name === skillName)?.driftSignature;
    expect(dismissedSnapshot.skills.find((skill) => skill.name === skillName)?.driftPresentation).toBe('dismissed');

    await writeSkillFile(
      path.join(pluginRoot, 'skills'),
      'plugin-only',
      [
        '---',
        'name: plugin-only',
        'description: Plugin only.',
        '---',
        '',
        '# Plugin Only',
        'Managed plugin content changed.',
        '',
      ].join('\n'),
      '2026-01-08T00:01:00.000Z',
    );

    const rescannedSnapshot = await scanInventory(scanOptions);
    const rescannedSkill = rescannedSnapshot.skills.find((skill) => skill.name === skillName);
    expect(rescannedSkill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'dismissed',
    });
    expect(rescannedSkill?.driftSignature).not.toBe(dismissedSignature);
    const configAfterRescan = JSON.parse(await readFile(paths.configFile, 'utf8')) as {
      dismissedDriftSignatures: string[];
    };
    expect(configAfterRescan.dismissedDriftSignatures).toContain(dismissedSignature);
  });

  it('undismisses a previously dismissed skill back into active drift', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });

    const dismissedSnapshot = await dismissDrift(
      {
        skillName: 'identical-drift-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(dismissedSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')?.driftPresentation).toBe('dismissed');

    const restoredSnapshot = await dismissDrift(
      {
        skillName: 'identical-drift-skill',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(restoredSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')?.driftPresentation).toBe('active');
  });

  it('toggles dismissed presentation for attention MCPs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });

    const dismissedSnapshot = await dismissDrift(
      {
        mcpName: 'diagnostic-rich-mcp',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(dismissedSnapshot.mcps?.find((mcp) => mcp.name === 'diagnostic-rich-mcp')?.presentation).toBe('dismissed');
    expect(dismissedSnapshot.mcpCounts?.dismissedAttentionMcps).toBeGreaterThan(0);
    const persistedConfig = JSON.parse(await readFile(paths.configFile, 'utf8')) as { dismissedMcpSignatures?: string[] };
    const persistedMcpSignature = persistedConfig.dismissedMcpSignatures?.[0] ?? '';
    expect(persistedMcpSignature).not.toContain('"transport"');
    expect(persistedMcpSignature).not.toContain('"url"');

    const restoredSnapshot = await dismissDrift(
      {
        mcpName: 'diagnostic-rich-mcp',
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(restoredSnapshot.mcps?.find((mcp) => mcp.name === 'diagnostic-rich-mcp')?.presentation).toBe('active');
  });

  it('filters cached inventory down to currently installed sources before launch hydration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    const initialSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await rm(path.join(paths.sandboxRoot, '.factory'), { recursive: true, force: true });
    const cachedSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });

    expect(cachedSnapshot?.sourceIds).toEqual(expect.arrayContaining(['sandbox-agents', 'sandbox-claude', 'sandbox-windsurf', 'sandbox-plugin-pack']));
    expect(cachedSnapshot?.sources.map((source) => source.id)).not.toContain('sandbox-factory');
    expect(cachedSnapshot?.counts.driftedSkills).toBeGreaterThan(0);
    expect(cachedSnapshot?.skills.find((skill) => skill.name === 'identical-drift-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
    });
    expect(cachedSnapshot?.skills.find((skill) => skill.name === 'identical-drift-skill')?.locations.map((location) => location.sourceId)).toEqual([
      'sandbox-agents',
      'sandbox-codex',
      'sandbox-cursor',
    ]);
    expect(cachedSnapshot?.skills.find((skill) => skill.name === 'identical-drift-skill')?.locations).toEqual(
      initialSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')?.locations.filter((location) =>
        location.sourceId === 'sandbox-agents' || location.sourceId === 'sandbox-codex' || location.sourceId === 'sandbox-cursor'),
    );
    expect(cachedSnapshot?.skills.some((skill) => skill.locations.some((location) => location.sourceId === 'sandbox-factory'))).toBe(false);
  });

  it('reconciles removed Windsurf install state and cached skills before warm-launch hydration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    const initialSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await rm(path.join(paths.sandboxRoot, '.codeium', 'windsurf'), { recursive: true, force: true });
    const asyncSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const syncSnapshot = readCachedInventorySync({ paths, includeSandboxSources: true, includeLiveSources: false });

    expect(asyncSnapshot).toEqual(syncSnapshot);
    expect(syncSnapshot).not.toBeNull();
    expect(syncSnapshot?.sourceIds).not.toContain('sandbox-windsurf');
    expect(syncSnapshot?.skills.some((skill) => skill.name === 'single-source-skill')).toBe(false);
    expect(syncSnapshot!.agents!.find((agent) => agent.id === 'sandbox-windsurf')).toMatchObject({
      installState: 'not-installed',
      skillsLocation: {
        exists: false,
      },
    });
    expect(syncSnapshot!.agentCounts!.installedAgents).toBe(initialSnapshot.agentCounts!.installedAgents - 1);
    expect(syncSnapshot!.homeSummary!.installedAgents).toBe(syncSnapshot!.agentCounts!.installedAgents);
  });

  it('matches synchronous preload cache hydration to the async truthful cached snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    await rm(path.join(paths.sandboxRoot, '.factory'), { recursive: true, force: true });
    const asyncSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const syncSnapshot = readCachedInventorySync({ paths, includeSandboxSources: true, includeLiveSources: false });

    expect(syncSnapshot).toEqual(asyncSnapshot);
    expect(syncSnapshot?.sourceIds).toEqual(expect.arrayContaining(['sandbox-agents', 'sandbox-claude', 'sandbox-windsurf', 'sandbox-plugin-pack']));
    expect(syncSnapshot?.counts.driftedSkills).toBeGreaterThan(0);
  });

  it('preserves package diff records during cached hydration when an unrelated source disappears', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await rm(path.join(paths.sandboxRoot, '.factory'), { recursive: true, force: true });
    const cachedSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const divergedSkill = cachedSnapshot?.skills.find((skill) => skill.name === 'diverged-drift-skill');

    expect(divergedSkill?.diff).toMatchObject({
      baselinePath: path.join(paths.sandboxRoot, '.agents', 'skills', 'diverged-drift-skill'),
      selectedPath: path.join(paths.sandboxRoot, '.claude', 'skills', 'diverged-drift-skill'),
    });
    expect(divergedSkill?.diff?.files?.length).toBeGreaterThan(0);
  });

  it('preserves cached front matter diagnostics for surviving locations when installed sources disappear', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await rm(path.join(paths.sandboxRoot, '.claude'), { recursive: true, force: true });
    const cachedSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const diagnosticSkill = cachedSnapshot?.skills.find((skill) => skill.name === 'diagnostic-rich-skill');

    expect(diagnosticSkill?.locations.map((location) => location.sourceId)).toEqual([
      'sandbox-agents',
      'sandbox-codex',
      'sandbox-cursor',
      'sandbox-factory',
    ]);
    expect(diagnosticSkill?.detailDiagnostics.definitionIssues?.map((issue) => [issue.sourceId, issue.field])).toEqual([
      ['sandbox-factory', 'name'],
    ]);
  });

  it('drops cached front matter diagnostics for removed locations without inventing new issues for healthy survivors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await seedRepresentativeFixtures({ paths });
    await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await Promise.all([
      rm(path.join(paths.sandboxRoot, '.claude'), { recursive: true, force: true }),
      rm(path.join(paths.sandboxRoot, '.factory'), { recursive: true, force: true }),
      rm(path.join(paths.sandboxRoot, '.codeium', 'windsurf'), { recursive: true, force: true }),
    ]);
    const cachedSnapshot = await readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false });
    const diagnosticSkill = cachedSnapshot?.skills.find((skill) => skill.name === 'diagnostic-rich-skill');

    expect(diagnosticSkill).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });
    expect(diagnosticSkill?.locations.map((location) => location.sourceId)).toEqual([
      'sandbox-agents',
      'sandbox-codex',
      'sandbox-cursor',
    ]);
    expect(diagnosticSkill?.detailDiagnostics.definitionIssues).toEqual([]);
  });

  it('reconciles watcher-driven create, edit, and delete events for custom scan paths while rewriting cache state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-scan-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const customSkillsDir = path.join(root, 'custom-skills');
    const customSkillPath = path.join(customSkillsDir, 'watched-skill', 'SKILL.md');

    await mkdir(customSkillsDir, { recursive: true });
    await writeSkillFile(
      paths.sandboxAgentsSkillsDir,
      'watched-skill',
      [
        '---',
        'name: watched-skill',
        'description: Watched skill',
        '---',
        '',
        '# Watched skill',
        '',
      ].join('\n'),
      '2026-04-09T00:00:00.000Z',
    );
    await writeSkillIndexConfig(paths.configFile, {
      customScanPaths: [customSkillsDir],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [],
      dismissedMcpSignatures: [],
    });

    const initialSnapshot = await scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const customSource = initialSnapshot.sources.find((source) => source.id === `custom:${customSkillsDir}`);

    expect(customSource).toBeDefined();
    expect(initialSnapshot.skills.find((skill) => skill.name === 'watched-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
    });

    await writeSkillFile(
      customSkillsDir,
      'watched-skill',
      [
        '---',
        'name: watched-skill',
        'description: Watched skill',
        '---',
        '',
        '# Watched skill',
        '',
      ].join('\n'),
      '2026-04-09T00:01:00.000Z',
    );

    const afterCreate = await reconcileWatchedSkillInventoryEvent(
      initialSnapshot,
      {
        source: customSource!,
        filePath: customSkillPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(afterCreate.skills.find((skill) => skill.name === 'watched-skill')).toMatchObject({
      structuralState: 'identical-drift',
      isDrifted: true,
    });
    expect(afterCreate.skills.find((skill) => skill.name === 'watched-skill')?.locations).toHaveLength(2);
    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toEqual(afterCreate);

    await writeSkillFile(
      customSkillsDir,
      'watched-skill',
      [
        '---',
        'name: watched-skill',
        'description: Watched skill',
        '---',
        '',
        '# Diverged watched skill',
        '',
      ].join('\n'),
      '2026-04-09T00:02:00.000Z',
    );

    const afterEdit = await reconcileWatchedSkillInventoryEvent(
      afterCreate,
      {
        source: customSource!,
        filePath: customSkillPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(afterEdit.skills.find((skill) => skill.name === 'watched-skill')).toMatchObject({
      structuralState: 'diverged-drift',
      isDrifted: true,
    });
    expect(afterEdit.skills.find((skill) => skill.name === 'watched-skill')?.diff?.selectedPath).toBe(path.join(customSkillsDir, 'watched-skill'));
    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toEqual(afterEdit);

    await rm(customSkillPath);

    const afterDelete = await reconcileWatchedSkillInventoryEvent(
      afterEdit,
      {
        source: customSource!,
        filePath: customSkillPath,
      },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      },
    );

    expect(afterDelete.skills.find((skill) => skill.name === 'watched-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
    });
    expect(afterDelete.skills.find((skill) => skill.name === 'watched-skill')?.locations).toHaveLength(1);
    expect(afterDelete.counts.driftedSkills).toBe(0);
    await expect(readCachedInventory({ paths, includeSandboxSources: true, includeLiveSources: false })).resolves.toEqual(afterDelete);
  });
});

async function writeSkillFile(rootDir: string, skillName: string, content: string, modifiedAt: string): Promise<void> {
  const filePath = path.join(rootDir, skillName, 'SKILL.md');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  const timestamp = new Date(modifiedAt);
  await utimes(filePath, timestamp, timestamp);
}

async function writeNestedSkillFile(filePath: string, content: string, modifiedAt: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  const timestamp = new Date(modifiedAt);
  await utimes(filePath, timestamp, timestamp);
}
