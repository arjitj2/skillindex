import { describe, expect, it } from 'vitest';

import {
  parseTomlMcpServerArray,
  parseTomlMcpServers,
  updateTomlMcpServerArray,
  updateTomlMcpServers,
} from '@shared/toml-mcp';

describe('toml MCP helpers', () => {
  it('reads Codex nested HTTP header tables as server headers', () => {
    expect(parseTomlMcpServers([
      '[mcp_servers.stitch]',
      'url = "https://stitch.googleapis.com/mcp"',
      '',
      '[mcp_servers.stitch.http_headers]',
      '"X-Goog-Api-Key" = "secret"',
      '',
    ].join('\n'))).toEqual({
      stitch: {
        headers: {
          'X-Goog-Api-Key': 'secret',
        },
        url: 'https://stitch.googleapis.com/mcp',
      },
    });
  });

  it('writes server headers back to Codex http_headers tables', () => {
    expect(updateTomlMcpServers('model = "gpt-5"\n', {
      stitch: {
        headers: {
          'X-Goog-Api-Key': 'secret',
        },
        url: 'https://stitch.googleapis.com/mcp',
      },
    })).toBe([
      'model = "gpt-5"',
      '',
      '[mcp_servers.stitch]',
      'url = "https://stitch.googleapis.com/mcp"',
      '',
      '[mcp_servers.stitch.http_headers]',
      'X-Goog-Api-Key = "secret"',
      '',
    ].join('\n'));
  });

  it('reads Mistral Vibe MCP server arrays keyed by name', () => {
    expect(parseTomlMcpServerArray([
      'model = "codestral"',
      '',
      '[[mcp_servers]]',
      'name = "vibe-local"',
      'command = "node"',
      'args = ["server.js"]',
      '',
      '[[mcp_servers]]',
      'name = "vibe-remote"',
      'url = "https://example.test/mcp"',
      '',
    ].join('\n'))).toEqual({
      'vibe-local': {
        command: 'node',
        args: ['server.js'],
      },
      'vibe-remote': {
        url: 'https://example.test/mcp',
      },
    });
  });

  it('reads Mistral Vibe MCP array subtables into the current server', () => {
    expect(parseTomlMcpServerArray([
      '[[mcp_servers]]',
      'name = "vibe-remote"',
      'url = "https://example.test/mcp"',
      '',
      '[mcp_servers.http_headers]',
      'Authorization = "Bearer token"',
      '',
      '[[mcp_servers]]',
      'name = "vibe-local"',
      'command = "node"',
      '',
      '[mcp_servers.environment]',
      'NODE_ENV = "test"',
      '',
    ].join('\n'))).toEqual({
      'vibe-local': {
        command: 'node',
        environment: {
          NODE_ENV: 'test',
        },
      },
      'vibe-remote': {
        headers: {
          Authorization: 'Bearer token',
        },
        url: 'https://example.test/mcp',
      },
    });
  });

  it('writes Mistral Vibe MCP server arrays while preserving non-MCP settings', () => {
    expect(updateTomlMcpServerArray('model = "codestral"\n', {
      'vibe-local': {
        command: 'node',
        args: ['server.js'],
      },
    })).toBe([
      'model = "codestral"',
      '',
      '[[mcp_servers]]',
      'name = "vibe-local"',
      'args = ["server.js"]',
      'command = "node"',
      '',
    ].join('\n'));
  });

  it('rewrites Mistral Vibe MCP array subtables without leaving stale nested config', () => {
    expect(updateTomlMcpServerArray([
      'model = "codestral"',
      '',
      '[[mcp_servers]]',
      'name = "old-remote"',
      'url = "https://old.example/mcp"',
      '',
      '[mcp_servers.http_headers]',
      'Authorization = "Bearer old"',
      '',
      '[editor]',
      'theme = "dark"',
      '',
    ].join('\n'), {
      'vibe-remote': {
        headers: {
          Authorization: 'Bearer new',
        },
        url: 'https://example.test/mcp',
      },
    })).toBe([
      'model = "codestral"',
      '',
      '[editor]',
      'theme = "dark"',
      '',
      '[[mcp_servers]]',
      'name = "vibe-remote"',
      'url = "https://example.test/mcp"',
      '',
      '[mcp_servers.http_headers]',
      'Authorization = "Bearer new"',
      '',
    ].join('\n'));
  });
});
