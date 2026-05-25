import { ipcRenderer } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS, type SkillInventorySnapshot } from '@shared/contracts';

import { readInitialInventoryBootstrapState } from './inventory-bootstrap';

vi.mock('electron', () => ({
  ipcRenderer: {
    sendSync: vi.fn(),
  },
}));

describe('readInitialInventoryBootstrapState', () => {
  it('reads the startup bootstrap snapshot from the main-process sync bootstrap channel', () => {
    const mockedIpcRenderer = vi.mocked(ipcRenderer);
    const inventorySnapshot: SkillInventorySnapshot = {
      scannedAt: '2026-04-14T00:00:00.000Z',
      sourceIds: [],
      sources: [],
      skills: [],
      counts: {
        totalSkills: 0,
        driftedSkills: 0,
        healthySkills: 0,
        missingSymlinkSkills: 0,
        singleSourceSkills: 0,
        identicalDriftSkills: 0,
        divergedDriftSkills: 0,
        dismissedDriftSkills: 0,
      },
      mcps: [],
      mcpCounts: {
        totalMcps: 0,
        attentionMcps: 0,
        healthyMcps: 0,
        dismissedAttentionMcps: 0,
      },
      agents: [],
      agentCounts: {
        totalAgents: 0,
        installedAgents: 0,
        notInstalledAgents: 0,
      },
      homeSummary: {
        skills: {
          total: 0,
          healthy: 0,
          needsAttention: 0,
        },
        mcps: {
          total: 0,
          healthy: 0,
          needsAttention: 0,
        },
        installedAgents: 0,
      },
    };

    mockedIpcRenderer.sendSync.mockReturnValue(inventorySnapshot);

    expect(readInitialInventoryBootstrapState()).toEqual({
      initialInventorySnapshot: inventorySnapshot,
    });
    expect(mockedIpcRenderer.sendSync.mock.calls).toContainEqual([
      IPC_CHANNELS.readInitialInventoryBootstrap,
    ]);
  });

  it('falls back to a null bootstrap snapshot if the sync channel is unavailable', () => {
    const mockedIpcRenderer = vi.mocked(ipcRenderer);
    mockedIpcRenderer.sendSync.mockImplementation(() => {
      throw new Error('no bootstrap');
    });

    expect(readInitialInventoryBootstrapState()).toEqual({
      initialInventorySnapshot: null,
    });
  });
});
