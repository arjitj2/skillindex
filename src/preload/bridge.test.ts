import { describe, expect, it, vi } from 'vitest';

import {
  type AddMcpServerRequest,
  type AddSkillRequest,
  type AuditOperation,
  type CapabilityActionRequest,
  IPC_CHANNELS,
  createSkillIndexDevApi,
  createSkillIndexDesktopApi,
  type AppShellState,
  type AutoUpdateStatus,
  type SettingsState,
  type SeedRepresentativeFixturesResult,
  type SkillInventorySnapshot,
} from '@shared/contracts';

describe('createSkillIndexDesktopApi', () => {
  it('invokes the expected preload channels through ipcRenderer', async () => {
    const shellState: AppShellState = {
      appName: 'Skill Index',
      username: 'arjitjaiswal',
      dataDir: '/tmp/skillindex',
      cacheFile: '/tmp/skillindex/cache.json',
      configFile: '/tmp/skillindex/config.json',
      liveCanonicalUserSkillsDir: '/Users/arjitjaiswal/.agents/skills',
      devTools: {
        sandboxEnabled: true,
        inventoryMode: 'sandbox',
        sandboxRoot: '/tmp/skillindex/sandbox',
        sandboxAgentsDir: '/tmp/skillindex/sandbox/.agents',
        sandboxCanonicalUserSkillsDir: '/tmp/skillindex/sandbox/.agents/skills',
        sandboxAgentsSkillsDir: '/tmp/skillindex/sandbox/.agents/skills',
        fixturesDir: '/tmp/skillindex/fixtures',
      },
      startupObservationDelayMs: 0,
      startupObservationHold: false,
      preloadStatus: 'ready',
    };
    const inventorySnapshot: SkillInventorySnapshot = {
      scannedAt: '2026-04-09T00:00:00.000Z',
      sourceIds: ['sandbox-agents'],
      sources: [
        {
          id: 'sandbox-agents',
          label: 'Sandbox .agents',
          canonical: true,
          kind: 'canonical',
          writable: true,
          scope: 'sandbox',
          skillsDir: '/tmp/skillindex/sandbox/.agents/skills',
        },
      ],
      skills: [
        {
          name: 'healthy-skill',
          structuralState: 'healthy',
          isDrifted: false,
          driftPresentation: 'none',
          locations: [
            {
              path: '/tmp/skillindex/sandbox/.agents/skills/healthy-skill',
              sourceId: 'sandbox-agents',
              sourceLabel: 'Sandbox .agents',
              sourceScope: 'sandbox',
              fileType: 'real-file',
              modifiedAt: '2026-04-09T00:00:00.000Z',
              canonical: true,
              contentHash: 'abc123',
            },
          ],
          detailDiagnostics: {
            duplicateCandidates: [],
            installSources: [
              {
                sourceId: 'sandbox-agents',
                label: 'Sandbox .agents',
                kind: 'canonical',
                scope: 'sandbox',
                writable: true,
                canonical: true,
              },
            ],
            missingInstallSources: [],
            definitionIssues: [],
          },
        },
      ],
      counts: {
        totalSkills: 1,
        driftedSkills: 0,
        healthySkills: 1,
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
          total: 1,
          healthy: 1,
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
    const seededFixtures: SeedRepresentativeFixturesResult = {
      fixtureSet: 'representative-agent-scan-foundation',
      sandboxRoot: '/tmp/skillindex/sandbox',
      ignoredPaths: ['/tmp/skillindex/sandbox/.claude/skills/ignore-me.txt'],
      skills: [
        {
          name: 'healthy-skill',
          expectedState: 'healthy',
          expectedLocationCount: 2,
        },
      ],
    };
    const settingsState: SettingsState = {
      customScanPaths: ['/tmp/skillindex/custom'],
      onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
      showDevSidebarInventorySourceSwitcher: true,
    };
    const updateStatus: AutoUpdateStatus = {
      phase: 'ready',
      version: '0.2.0',
      lastCheckedAt: '2026-05-17T00:00:00.000Z',
    };
    const auditOperations: AuditOperation[] = [
      {
        id: 'audit-operation-1',
        kind: 'settings-update',
        title: 'Updated settings',
        summary: 'Custom scan paths changed.',
        startedAt: '2026-05-16T00:00:00.000Z',
        completedAt: '2026-05-16T00:00:01.000Z',
        status: 'completed',
        actor: 'app',
        sourceMode: 'sandbox',
        entity: {
          type: 'settings',
        },
        undoState: 'available',
        actionCount: 1,
        actions: [
          {
            id: 'audit-action-1',
            operationId: 'audit-operation-1',
            kind: 'update-app-config',
            title: 'Updated app config',
            summary: 'config.json changed.',
            status: 'completed',
            path: '/tmp/skillindex/config.json',
            before: { kind: 'config', hash: 'before' },
            after: { kind: 'config', hash: 'after' },
            completedAt: '2026-05-16T00:00:01.000Z',
          },
        ],
      },
    ];
    const invoke = vi.fn((channel: string) => {
      if (channel === IPC_CHANNELS.getShellState) return Promise.resolve(shellState);
      if (channel === IPC_CHANNELS.readUpdateStatus) return Promise.resolve(updateStatus);
      if (channel === IPC_CHANNELS.checkForUpdates) return Promise.resolve(updateStatus);
      if (channel === IPC_CHANNELS.installUpdate) return Promise.resolve(updateStatus);
      if (channel === IPC_CHANNELS.openPathInEditor) return Promise.resolve(undefined);
      if (channel === IPC_CHANNELS.revealPathInFinder) return Promise.resolve(undefined);
      if (channel === IPC_CHANNELS.chooseDirectory) return Promise.resolve('/tmp/skillindex/repos/arjit-skills');
      if (channel === IPC_CHANNELS.readSettings) return Promise.resolve(settingsState);
      if (channel === IPC_CHANNELS.readCachedInventory) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.scanInventory) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.rescanInventory) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.testMcpConnectivity) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.cancelMcpConnectivityTest) return Promise.resolve(undefined);
      if (channel === IPC_CHANNELS.addSkill) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.addMcpServer) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.resolveIssue) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.applyCapabilityAction) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.dismissDrift) return Promise.resolve(inventorySnapshot);
      if (channel === IPC_CHANNELS.readAuditLog) return Promise.resolve(auditOperations);
      if (channel === IPC_CHANNELS.undoAuditOperation) return Promise.resolve({
        auditLog: auditOperations,
        inventorySnapshot,
        settingsState,
      });
      if (channel === IPC_CHANNELS.releaseStartupObservation) return Promise.resolve(undefined);
      if (channel === IPC_CHANNELS.seedRepresentativeFixtures) return Promise.resolve(seededFixtures);
      if (channel === IPC_CHANNELS.setInventoryMode) return Promise.resolve('live');
      if (channel === IPC_CHANNELS.addCustomScanPath) return Promise.resolve(settingsState);
      if (channel === IPC_CHANNELS.removeCustomScanPath) return Promise.resolve({
        customScanPaths: [] satisfies string[],
        onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
        preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
        showDevSidebarInventorySourceSwitcher: true,
      });
      if (channel === IPC_CHANNELS.setPreferredCanonicalSourcePath) return Promise.resolve(settingsState);
      if (channel === IPC_CHANNELS.clearPreferredCanonicalSourcePath) return Promise.resolve({
        customScanPaths: ['/tmp/skillindex/custom'],
        onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
        preferredCanonicalSourcePath: null,
        showDevSidebarInventorySourceSwitcher: true,
      });
      if (channel === IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible) return Promise.resolve({
        customScanPaths: ['/tmp/skillindex/custom'],
        onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
        preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
        showDevSidebarInventorySourceSwitcher: false,
      });
      if (channel === IPC_CHANNELS.completeOnboarding) return Promise.resolve(settingsState);
      if (channel === IPC_CHANNELS.ping) return Promise.resolve('pong');
      return Promise.reject(new Error(`unexpected channel ${channel}`));
    });
    const subscribe = vi.fn(() => () => undefined);

    const api = createSkillIndexDesktopApi(invoke, subscribe);
    const devApi = createSkillIndexDevApi(invoke);

    await expect(api.getShellState()).resolves.toEqual(shellState);
    await expect(api.readUpdateStatus()).resolves.toEqual(updateStatus);
    await expect(api.checkForUpdates()).resolves.toEqual(updateStatus);
    await expect(api.installUpdate()).resolves.toEqual(updateStatus);
    await expect(api.openPathInEditor('/tmp/skillindex/sandbox/.agents/skills/healthy-skill')).resolves.toBeUndefined();
    await expect(api.revealPathInFinder('/tmp/skillindex/plugins/github')).resolves.toBeUndefined();
    await expect(api.chooseDirectory({ title: 'Choose a preferred skills source' })).resolves.toBe('/tmp/skillindex/repos/arjit-skills');
    await expect(api.readSettings()).resolves.toEqual(settingsState);
    await expect(api.readCachedInventory()).resolves.toEqual(inventorySnapshot);
    await expect(api.scanInventory()).resolves.toEqual(inventorySnapshot);
    await expect(api.rescanInventory({ verifyMcpConnectivity: false })).resolves.toEqual(inventorySnapshot);
    await expect((api as unknown as { testMcpConnectivity(): Promise<SkillInventorySnapshot> }).testMcpConnectivity()).resolves.toEqual(inventorySnapshot);
    await expect(api.cancelMcpConnectivityTest()).resolves.toBeUndefined();
    await expect(api.addSkill({
      sourceType: 'url',
      source: 'https://github.com/vercel-labs/agent-skills',
    } satisfies AddSkillRequest)).resolves.toEqual(inventorySnapshot);
    await expect(api.addMcpServer({
      name: 'github',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    } satisfies AddMcpServerRequest)).resolves.toEqual(inventorySnapshot);
    await expect(api.resolveIssue({
      entity: 'skill',
      issue: 'identical-copies',
      skillName: 'healthy-skill',
    })).resolves.toEqual(inventorySnapshot);
    await expect(api.applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'healthy-skill',
      selectedVariantPath: '/tmp/skillindex/sandbox/.agents/skills/healthy-skill',
    } satisfies CapabilityActionRequest)).resolves.toEqual(inventorySnapshot);
    await expect(api.dismissDrift({ skillName: 'healthy-skill' })).resolves.toEqual(inventorySnapshot);
    await expect(api.dismissDrift({ mcpName: 'healthy-mcp' })).resolves.toEqual(inventorySnapshot);
    await expect(api.readAuditLog()).resolves.toEqual(auditOperations);
    await expect(api.undoAuditOperation('audit-operation-1')).resolves.toEqual({
      auditLog: auditOperations,
      inventorySnapshot,
      settingsState,
    });
    await expect(api.releaseStartupObservation()).resolves.toBeUndefined();
    await expect(devApi.seedRepresentativeFixtures()).resolves.toEqual(seededFixtures);
    await expect(devApi.setInventoryMode('live')).resolves.toBe('live');
    await expect(api.addCustomScanPath('/tmp/skillindex/custom')).resolves.toEqual(settingsState);
    await expect(api.removeCustomScanPath('/tmp/skillindex/custom')).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(api.setPreferredCanonicalSourcePath('/tmp/skillindex/repos/arjit-skills')).resolves.toEqual(settingsState);
    await expect(api.clearPreferredCanonicalSourcePath()).resolves.toEqual({
      customScanPaths: ['/tmp/skillindex/custom'],
      onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(api.setDevSidebarInventorySourceSwitcherVisible(false)).resolves.toEqual({
      customScanPaths: ['/tmp/skillindex/custom'],
      onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
      showDevSidebarInventorySourceSwitcher: false,
    });
    await expect(api.completeOnboarding({
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
    })).resolves.toEqual(settingsState);
    await expect(api.ping()).resolves.toBe('pong');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.getShellState);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.readUpdateStatus);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.checkForUpdates);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.installUpdate);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.openPathInEditor, '/tmp/skillindex/sandbox/.agents/skills/healthy-skill');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.revealPathInFinder, '/tmp/skillindex/plugins/github');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.chooseDirectory, { title: 'Choose a preferred skills source' });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.readSettings);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.readCachedInventory);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.scanInventory);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.rescanInventory, { verifyMcpConnectivity: false });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.testMcpConnectivity);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.cancelMcpConnectivityTest);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.addSkill, {
      sourceType: 'url',
      source: 'https://github.com/vercel-labs/agent-skills',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.addMcpServer, {
      name: 'github',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.resolveIssue, {
      entity: 'skill',
      issue: 'identical-copies',
      skillName: 'healthy-skill',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.applyCapabilityAction, {
      entity: 'skill',
      action: 'choose-universal-version',
      skillName: 'healthy-skill',
      selectedVariantPath: '/tmp/skillindex/sandbox/.agents/skills/healthy-skill',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.dismissDrift, {
      skillName: 'healthy-skill',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.dismissDrift, {
      mcpName: 'healthy-mcp',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.readAuditLog);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.undoAuditOperation, 'audit-operation-1');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.releaseStartupObservation);
    const unsubscribeUpdate = api.onUpdateStatusUpdated(() => undefined);
    expect(subscribe).toHaveBeenCalledWith(IPC_CHANNELS.updateStatusUpdated, expect.any(Function));
    unsubscribeUpdate();
    const unsubscribe = api.onInventoryUpdated(() => undefined);
    expect(subscribe).toHaveBeenCalledWith(IPC_CHANNELS.inventoryUpdated, expect.any(Function));
    unsubscribe();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.seedRepresentativeFixtures);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.setInventoryMode, 'live');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.addCustomScanPath, '/tmp/skillindex/custom');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.removeCustomScanPath, '/tmp/skillindex/custom');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.setPreferredCanonicalSourcePath, '/tmp/skillindex/repos/arjit-skills');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.clearPreferredCanonicalSourcePath);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible, false);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.completeOnboarding, {
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.ping);
  });
});
