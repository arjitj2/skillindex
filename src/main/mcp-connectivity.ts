import { homedir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type {
  McpConnectivityRecord,
  McpDefinitionObject,
  McpDefinitionValue,
  McpLocationRecord,
} from '@shared/contracts';

interface VerifyMcpConnectionOptions {
  checkedAt?: string;
  timeoutMs?: number;
  definition?: McpDefinitionObject;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const COMMON_POSIX_EXECUTABLE_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
] as const;

export async function verifyMcpConnection(
  location: McpLocationRecord,
  options: VerifyMcpConnectionOptions = {},
): Promise<McpConnectivityRecord> {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const transport = createTransport(location, options.definition);

  if (!transport) {
    return {
      status: 'skipped',
      checkedAt,
      error: 'No supported MCP connection target.',
    };
  }

  const client = new Client({
    name: 'skill-index-connectivity-check',
    version: '0.1.0',
  });

  try {
    await client.connect(transport, { timeout: timeoutMs, maxTotalTimeout: timeoutMs });
    return {
      status: 'verified',
      checkedAt,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      checkedAt,
      latencyMs: Date.now() - startedAt,
      error: formatConnectivityError(error),
    };
  } finally {
    await closeClient(client);
  }
}

function createTransport(location: McpLocationRecord, definition: McpDefinitionObject | undefined): Transport | null {
  if (isRemoteMcpTransport(location.transport)) {
    return createRemoteTransport(location, definition);
  }

  if (location.transport === 'stdio' || location.command) {
    if (!location.command) {
      return null;
    }

    return new StdioClientTransport({
      command: location.command,
      args: location.args,
      cwd: getOptionalString(definition?.cwd),
      env: buildStdioEnvironment(definition),
      stderr: 'pipe',
    });
  }

  return createRemoteTransport(location, definition);
}

function createRemoteTransport(location: McpLocationRecord, definition: McpDefinitionObject | undefined): Transport | null {
  if (!location.url) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(location.url);
  } catch {
    return null;
  }

  const requestInit = buildRequestInit(definition);
  if (location.transport === 'sse') {
    return new SSEClientTransport(url, { requestInit });
  }

  return new StreamableHTTPClientTransport(url, { requestInit });
}

function buildStdioEnvironment(definition: McpDefinitionObject | undefined): Record<string, string> {
  const defaultEnvironment = getDefaultEnvironment();
  const configuredEnvironment = getStringRecord(definition?.env) ?? getStringRecord(definition?.environment);
  const environment = {
    ...defaultEnvironment,
    ...configuredEnvironment,
  };
  const pathValue = buildStdioPath(defaultEnvironment, configuredEnvironment);
  delete environment.Path;

  if (pathValue) {
    environment.PATH = pathValue;
  }

  return environment;
}

function buildStdioPath(
  defaultEnvironment: Record<string, string>,
  configuredEnvironment: Record<string, string> | undefined,
): string | undefined {
  return joinUniquePathEntries([
    configuredEnvironment?.PATH,
    configuredEnvironment?.Path,
    defaultEnvironment.PATH,
    defaultEnvironment.Path,
    process.env.PATH,
    process.env.Path,
    ...getCommonExecutablePathEntries(),
  ]);
}

function getCommonExecutablePathEntries(): string[] {
  if (process.platform === 'win32') {
    return [];
  }

  const homeDir = homedir();
  const userExecutableDirs = homeDir
    ? [
        path.join(homeDir, '.local', 'bin'),
        path.join(homeDir, 'Library', 'pnpm'),
        path.join(homeDir, '.bun', 'bin'),
        path.join(homeDir, '.cargo', 'bin'),
        path.join(homeDir, '.volta', 'bin'),
        path.join(homeDir, '.asdf', 'shims'),
      ]
    : [];

  return [...COMMON_POSIX_EXECUTABLE_DIRS, ...userExecutableDirs];
}

function joinUniquePathEntries(pathValues: Array<string | undefined>): string | undefined {
  const entries: string[] = [];
  const seenEntries = new Set<string>();

  for (const value of pathValues) {
    if (!value) {
      continue;
    }

    for (const entry of value.split(path.delimiter)) {
      const trimmedEntry = entry.trim();
      if (!trimmedEntry || seenEntries.has(trimmedEntry)) {
        continue;
      }

      entries.push(trimmedEntry);
      seenEntries.add(trimmedEntry);
    }
  }

  return entries.length > 0 ? entries.join(path.delimiter) : undefined;
}

function buildRequestInit(definition: McpDefinitionObject | undefined): RequestInit | undefined {
  const headers = getStringRecord(definition?.headers) ?? getStringRecord(definition?.http_headers);
  if (!headers) {
    return undefined;
  }

  return { headers };
}

function getStringRecord(value: McpDefinitionValue | undefined): Record<string, string> | undefined {
  if (!isMcpDefinitionObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getOptionalString(value: McpDefinitionValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRemoteMcpTransport(transport: McpLocationRecord['transport']): boolean {
  return transport === 'http' || transport === 'streamable-http' || transport === 'sse';
}

function formatConnectivityError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'MCP connection failed.';
}

async function closeClient(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // A failed startup can leave the transport half-open; close best-effort only.
  }
}

function isMcpDefinitionObject(value: McpDefinitionValue | undefined): value is McpDefinitionObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
