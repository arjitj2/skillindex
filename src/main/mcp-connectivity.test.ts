// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { verifyMcpConnection } from '@main/mcp-connectivity';
import type { McpLocationRecord } from '@shared/contracts';

function stdioLocation(overrides: Partial<McpLocationRecord> = {}): McpLocationRecord {
  return {
    agentId: 'sandbox-agents',
    agentLabel: 'Sandbox .agents',
    scope: 'sandbox',
    configPath: '/tmp/.agents/mcp.json',
    transport: 'stdio',
    command: 'definitely-not-a-real-mcp-command',
    args: [],
    ...overrides,
  };
}

describe('verifyMcpConnection', () => {
  it('returns a failed result when a stdio MCP command cannot be launched', async () => {
    const result = await verifyMcpConnection(stdioLocation(), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      timeoutMs: 500,
    });

    expect(result).toMatchObject({
      status: 'failed',
      checkedAt: '2026-05-04T12:00:00.000Z',
    });
    expect(result.error).toMatch(/definitely-not-a-real-mcp-command|ENOENT|spawn/u);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it('skips definitions without a supported connection target', async () => {
    const result = await verifyMcpConnection(stdioLocation({
      command: undefined,
      transport: undefined,
    }), {
      checkedAt: '2026-05-04T12:00:00.000Z',
      timeoutMs: 500,
    });

    expect(result).toEqual({
      status: 'skipped',
      checkedAt: '2026-05-04T12:00:00.000Z',
      error: 'No supported MCP connection target.',
    });
  });
});
