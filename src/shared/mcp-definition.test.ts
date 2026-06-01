import { describe, expect, it } from 'vitest';

import { buildPortableMcpDefinition, normalizeMcpDefinitionForComparison, splitMcpDefinitionForComparison } from './mcp-definition';

describe('MCP definition normalization', () => {
  it('compares stdio definitions by launch and environment fields only', () => {
    expect(normalizeMcpDefinitionForComparison({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      cwd: '/Users/tester/project',
      disabled: false,
      env: {
        API_KEY: 'secret',
      },
      tool_timeout_sec: 120,
    })).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      cwd: '/Users/tester/project',
      env: {
        API_KEY: 'secret',
      },
    });
  });

  it('compares remote definitions across transport aliases and auth field spellings', () => {
    expect(normalizeMcpDefinitionForComparison({
      type: 'streamable_http',
      url: 'https://example.test/mcp',
      http_headers: {
        Authorization: 'Bearer token',
      },
      env_http_headers: {
        'X-Api-Key': 'API_KEY',
      },
      bearer_token_env_var: 'MCP_TOKEN',
      enabled_tools: ['search'],
    })).toEqual({
      transport: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
      env_http_headers: {
        'X-Api-Key': 'API_KEY',
      },
      bearer_token_env_var: 'MCP_TOKEN',
    });
  });

  it('recognizes httpUrl as a streamable HTTP remote URL', () => {
    expect(normalizeMcpDefinitionForComparison({
      httpUrl: 'https://example.test/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    })).toEqual({
      transport: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    });
  });

  it('uses parsed connection hints when the raw definition omits transport fields', () => {
    expect(normalizeMcpDefinitionForComparison({
      args: ['server.js'],
    }, {
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    })).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    expect(normalizeMcpDefinitionForComparison({
      headers: {
        'X-Api-Key': 'secret',
      },
    }, {
      transport: 'http',
      url: 'https://example.test/mcp',
    })).toEqual({
      transport: 'http',
      url: 'https://example.test/mcp',
      headers: {
        'X-Api-Key': 'secret',
      },
    });
  });

  it('splits portable core from agent-specific native fields', () => {
    expect(splitMcpDefinitionForComparison({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      cwd: '/Users/tester/project',
      env: {
        API_KEY: 'secret',
      },
      disabled: false,
      enabled_tools: ['search'],
      tool_timeout_sec: 120,
    })).toEqual({
      core: {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        cwd: '/Users/tester/project',
        env: {
          API_KEY: 'secret',
        },
      },
      native: {
        disabled: false,
        enabled_tools: ['search'],
        tool_timeout_sec: 120,
      },
      agentLocal: {},
    });
  });

  it('keeps agentLocal out of core and native fields', () => {
    expect(splitMcpDefinitionForComparison({
      command: 'node',
      args: ['server.js'],
      agentLocal: {
        codex: {
          startup_timeout_ms: 20000,
        },
      },
    })).toEqual({
      core: {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
      native: {},
      agentLocal: {
        codex: {
          startup_timeout_ms: 20000,
        },
      },
    });
  });

  it('filters core and dialect fields out of agentLocal blocks', () => {
    expect(splitMcpDefinitionForComparison({
      url: 'https://example.test/mcp',
      agentLocal: {
        codex: {
          command: 'node',
          transport: 'stdio',
          enabled_tools: ['search'],
        },
      },
    })).toEqual({
      core: {
        transport: 'http',
        url: 'https://example.test/mcp',
      },
      native: {},
      agentLocal: {
        codex: {
          enabled_tools: ['search'],
        },
      },
    });
  });
});

describe('portable MCP definitions', () => {
  it('keeps only portable stdio resolution fields', () => {
    expect(buildPortableMcpDefinition({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      cwd: '/Users/tester/project',
      disabled: false,
      env: {
        API_KEY: 'secret',
      },
    })).toEqual({
      command: 'node',
      args: ['server.js'],
      cwd: '/Users/tester/project',
      env: {
        API_KEY: 'secret',
      },
    });
  });

  it('keeps portable remote transport and auth fields for resolution writes', () => {
    expect(buildPortableMcpDefinition({
      transport: 'sse',
      url: 'https://example.test/sse',
      http_headers: {
        Authorization: 'Bearer token',
      },
      env_http_headers: {
        'X-Api-Key': 'API_KEY',
      },
      bearer_token_env_var: 'MCP_TOKEN',
      disabled: false,
      tool_timeout_sec: 120,
    })).toEqual({
      type: 'sse',
      url: 'https://example.test/sse',
      headers: {
        Authorization: 'Bearer token',
      },
      env_http_headers: {
        'X-Api-Key': 'API_KEY',
      },
      bearer_token_env_var: 'MCP_TOKEN',
    });
  });

  it('writes inferred HTTP remotes with an explicit type for JSON config consumers', () => {
    expect(buildPortableMcpDefinition({
      headers: {
        Authorization: 'Bearer token',
      },
      url: 'https://example.test/mcp',
    }, {
      transport: 'http',
      url: 'https://example.test/mcp',
    })).toEqual({
      type: 'http',
      url: 'https://example.test/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    });
  });

  it('writes httpUrl remotes as portable streamable HTTP definitions', () => {
    expect(buildPortableMcpDefinition({
      httpUrl: 'https://example.test/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    })).toEqual({
      type: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: {
        Authorization: 'Bearer token',
      },
    });
  });
});
