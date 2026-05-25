// @vitest-environment node

import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpLocationRecord } from '@shared/contracts';

interface MockClientConnectCall {
  transport: unknown;
  options: unknown;
}

interface MockClientInstance {
  connectCalls: MockClientConnectCall[];
  closed: boolean;
}

interface CapturedStdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stderr?: string;
}

interface CapturedRemoteTransportOptions {
  requestInit?: RequestInit;
}

interface CapturedRemoteTransport {
  url: string;
  options?: CapturedRemoteTransportOptions;
}

const sdkRecords = vi.hoisted(() => ({
  clients: [] as MockClientInstance[],
  defaultEnvironment: {
    PATH: '/mock/bin',
    SKILL_INDEX_DEFAULT: '1',
  },
  sseTransports: [] as CapturedRemoteTransport[],
  stdioTransports: [] as CapturedStdioTransportOptions[],
  streamableHttpTransports: [] as CapturedRemoteTransport[],
}));
const expectedPosixPackageManagerBins = process.platform === 'win32'
  ? []
  : ['/opt/homebrew/bin', '/usr/local/bin'];

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class implements MockClientInstance {
    connectCalls: MockClientConnectCall[] = [];
    closed = false;

    constructor() {
      sdkRecords.clients.push(this);
    }

    connect(transport: unknown, options: unknown): Promise<void> {
      this.connectCalls.push({ transport, options });
      return Promise.resolve();
    }

    close(): Promise<void> {
      this.closed = true;
      return Promise.resolve();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: () => sdkRecords.defaultEnvironment,
  StdioClientTransport: class {
    constructor(options: CapturedStdioTransportOptions) {
      sdkRecords.stdioTransports.push(options);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(url: URL, options?: CapturedRemoteTransportOptions) {
      sdkRecords.sseTransports.push({
        url: url.toString(),
        options,
      });
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options?: CapturedRemoteTransportOptions) {
      sdkRecords.streamableHttpTransports.push({
        url: url.toString(),
        options,
      });
    }
  },
}));

const { verifyMcpConnection } = await import('@main/mcp-connectivity');

function mcpLocation(overrides: Partial<McpLocationRecord> = {}): McpLocationRecord {
  return {
    agentId: 'sandbox-agents',
    agentLabel: 'Sandbox .agents',
    scope: 'sandbox',
    configPath: '/tmp/.agents/mcp.json',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    ...overrides,
  };
}

function expectPathToContain(value: string | undefined, entries: string[]): void {
  expect(value?.split(path.delimiter)).toEqual(expect.arrayContaining(entries));
}

describe('verifyMcpConnection transport setup', () => {
  beforeEach(() => {
    sdkRecords.clients.splice(0, sdkRecords.clients.length);
    sdkRecords.sseTransports.splice(0, sdkRecords.sseTransports.length);
    sdkRecords.stdioTransports.splice(0, sdkRecords.stdioTransports.length);
    sdkRecords.streamableHttpTransports.splice(0, sdkRecords.streamableHttpTransports.length);
  });

  it('adds common user package-manager bins to stdio PATH even without server env', async () => {
    await verifyMcpConnection(mcpLocation({
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
    });

    expectPathToContain(sdkRecords.stdioTransports[0]?.env?.PATH, ['/mock/bin', ...expectedPosixPackageManagerBins]);
  });

  it('passes stdio command options, cwd, merged string env, and timeouts to the MCP client', async () => {
    const result = await verifyMcpConnection(mcpLocation(), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      timeoutMs: 1234,
      definition: {
        cwd: '/Users/tester/project',
        env: {
          API_KEY: 'secret',
          IGNORED_NUMBER: 42,
        },
      },
    });

    expect(result).toMatchObject({
      status: 'verified',
      checkedAt: '2026-05-04T12:00:00.000Z',
    });
    expect(sdkRecords.stdioTransports).toMatchObject([
      {
        command: 'node',
        args: ['server.js'],
        cwd: '/Users/tester/project',
        env: {
          SKILL_INDEX_DEFAULT: '1',
          API_KEY: 'secret',
        },
        stderr: 'pipe',
      },
    ]);
    expectPathToContain(sdkRecords.stdioTransports[0]?.env?.PATH, ['/mock/bin', ...expectedPosixPackageManagerBins.slice(0, 1)]);
    expect(sdkRecords.clients[0]?.connectCalls[0]?.options).toEqual({
      timeout: 1234,
      maxTotalTimeout: 1234,
    });
    expect(sdkRecords.clients[0]?.closed).toBe(true);
  });

  it('uses OpenCode-style environment fields for stdio transports', async () => {
    await verifyMcpConnection(mcpLocation({
      command: 'bun',
      args: ['x', 'opencode-mcp'],
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      definition: {
        type: 'local',
        command: ['bun', 'x', 'opencode-mcp'],
        environment: {
          DOCS_TOKEN: 'secret',
          IGNORED_NUMBER: 42,
        },
      },
    });

    expect(sdkRecords.stdioTransports).toMatchObject([
      {
        command: 'bun',
        args: ['x', 'opencode-mcp'],
        cwd: undefined,
        env: {
          SKILL_INDEX_DEFAULT: '1',
          DOCS_TOKEN: 'secret',
        },
        stderr: 'pipe',
      },
    ]);
    expectPathToContain(sdkRecords.stdioTransports[0]?.env?.PATH, ['/mock/bin', ...expectedPosixPackageManagerBins.slice(0, 1)]);
  });

  it('normalizes alternate Path casing into the computed stdio PATH', async () => {
    await verifyMcpConnection(mcpLocation(), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      definition: {
        env: {
          API_KEY: 'secret',
          Path: '/configured/bin',
        },
      },
    });

    expect(sdkRecords.stdioTransports[0]?.env?.Path).toBeUndefined();
    expect(sdkRecords.stdioTransports[0]?.env?.API_KEY).toBe('secret');
    expectPathToContain(sdkRecords.stdioTransports[0]?.env?.PATH, ['/configured/bin', '/mock/bin']);
  });

  it('prefers the resolved remote transport over stray command fields', async () => {
    await verifyMcpConnection(mcpLocation({
      transport: 'http',
      command: 'node',
      url: 'https://example.test/mixed',
      args: ['server.js'],
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      definition: {
        type: 'remote',
        command: 'node',
        url: 'https://example.test/mixed',
      },
    });

    expect(sdkRecords.stdioTransports).toEqual([]);
    expect(sdkRecords.streamableHttpTransports).toEqual([
      {
        url: 'https://example.test/mixed',
        options: {
          requestInit: undefined,
        },
      },
    ]);
  });

  it('passes static remote headers to SSE transports', async () => {
    const result = await verifyMcpConnection(mcpLocation({
      transport: 'sse',
      command: undefined,
      url: 'https://example.test/sse',
      args: [],
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      definition: {
        http_headers: {
          Authorization: 'Bearer token',
          Ignored: 42,
        },
      },
    });

    expect(result.status).toBe('verified');
    expect(sdkRecords.sseTransports).toEqual([
      {
        url: 'https://example.test/sse',
        options: {
          requestInit: {
            headers: {
              Authorization: 'Bearer token',
            },
          },
        },
      },
    ]);
    expect(sdkRecords.streamableHttpTransports).toEqual([]);
  });

  it('uses streamable HTTP transports for non-SSE remote MCP locations', async () => {
    await verifyMcpConnection(mcpLocation({
      transport: 'streamable-http',
      command: undefined,
      url: 'https://example.test/mcp',
      args: [],
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      definition: {
        headers: {
          'X-Api-Key': 'secret',
        },
      },
    });

    expect(sdkRecords.streamableHttpTransports).toEqual([
      {
        url: 'https://example.test/mcp',
        options: {
          requestInit: {
            headers: {
              'X-Api-Key': 'secret',
            },
          },
        },
      },
    ]);
    expect(sdkRecords.sseTransports).toEqual([]);
  });

  it('skips malformed remote URLs before opening a client connection', async () => {
    const result = await verifyMcpConnection(mcpLocation({
      command: undefined,
      url: 'not a url',
      args: [],
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
    });

    expect(result).toEqual({
      status: 'skipped',
      checkedAt: '2026-05-04T12:00:00.000Z',
      error: 'No supported MCP connection target.',
    });
    expect(sdkRecords.clients).toEqual([]);
    expect(sdkRecords.sseTransports).toEqual([]);
    expect(sdkRecords.streamableHttpTransports).toEqual([]);
  });
});
