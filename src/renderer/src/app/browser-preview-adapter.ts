import {
  type AddMcpServerRequest,
  type AddSkillRequest,
  APP_NAME,
  type DismissDriftRequest,
  type McpPresentation,
  type RemoveInventoryItemRequest,
  type ResolveIssueRequest,
  type SettingsState,
  type SkillDriftPresentation,
  type SkillInventorySnapshot,
  type SkillIndexDesktopApi,
  type SkillIndexDevApi,
  type SubagentPresentation,
} from '@shared/contracts';

import { representativeInventorySnapshot, representativeSeededFixtures } from '../representative-preview-data';

let browserPreviewSnapshot = cloneInventorySnapshot(representativeInventorySnapshot);
let browserPreviewSettingsState = createInitialSettingsState();
const PREVIEW_STARTUP_HOLD_MS = 2500;
const PREVIEW_RESCAN_HOLD_MS = 2500;

export function createInitialSettingsState(): SettingsState {
  return {
    customScanPaths: [],
    onboardingCompletedAt: null,
    preferredCanonicalSourcePath: null,
    showDevSidebarInventorySourceSwitcher: true,
  };
}

export function getBrowserPreviewDesktopApi(): SkillIndexDesktopApi {
  return browserPreviewApi;
}

export function getBrowserPreviewDevApi(): SkillIndexDevApi {
  return browserPreviewDevApi;
}

export function getBrowserPreviewInitialSnapshot(): SkillInventorySnapshot {
  return cloneInventorySnapshot(browserPreviewSnapshot);
}

const browserPreviewApi: SkillIndexDesktopApi = {
  getShellState: () =>
    Promise.resolve({
      appName: APP_NAME,
      username: 'arjitjaiswal',
      dataDir: '~/.skillindex',
      cacheFile: '~/.skillindex/cache.json',
      configFile: '~/.skillindex/config.json',
      liveCanonicalUserSkillsDir: '~/.agents/skills',
      devTools: {
        sandboxEnabled: true,
        inventoryMode: 'sandbox',
        sandboxRoot: '~/.skillindex/sandbox',
        sandboxAgentsDir: '~/.skillindex/sandbox/.agents',
        sandboxCanonicalUserSkillsDir: '~/.skillindex/sandbox/.agents/skills',
        sandboxAgentsSkillsDir: '~/.skillindex/sandbox/.agents/skills',
        fixturesDir: '~/.skillindex/fixtures',
      },
      startupObservationDelayMs: 0,
      startupObservationHold: false,
      preloadStatus: 'ready',
    }),
  openPathInEditor: () => Promise.resolve(),
  readUpdateStatus: () => Promise.resolve(getBrowserPreviewUpdateStatus()),
  checkForUpdates: () => Promise.resolve(getBrowserPreviewUpdateStatus()),
  installUpdate: () => Promise.resolve(getBrowserPreviewUpdateStatus()),
  revealPathInFinder: () => Promise.resolve(),
  chooseDirectory: () => Promise.resolve('/Users/arjitjaiswal/repos/my-skills'),
  readSettings: () => resolveWithOptionalStartupHold(cloneSettingsState(browserPreviewSettingsState)),
  readCachedInventory: () => Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot)),
  scanInventory: () => Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot)),
  rescanInventory: () => resolveWithOptionalPreviewHold(cloneInventorySnapshot(browserPreviewSnapshot)),
  testMcpConnectivity: () => resolveWithOptionalPreviewHold(cloneInventorySnapshot(browserPreviewSnapshot)),
  cancelMcpConnectivityTest: () => Promise.resolve(),
  addSkill: (request: AddSkillRequest) => {
    void request;
    return Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot));
  },
  addMcpServer: (request: AddMcpServerRequest) => {
    void request;
    return Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot));
  },
  resolveIssue: (request: ResolveIssueRequest) => {
    void request;
    return Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot));
  },
  applyCapabilityAction: (request) => {
    void request;
    return Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot));
  },
  dismissDrift: (request) => {
    browserPreviewSnapshot = toggleBrowserPreviewDismissal(browserPreviewSnapshot, request);
    return Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot));
  },
  removeInventoryItem: (request) => {
    browserPreviewSnapshot = removeBrowserPreviewItem(browserPreviewSnapshot, request);
    return Promise.resolve(cloneInventorySnapshot(browserPreviewSnapshot));
  },
  readAuditLog: () => Promise.resolve([]),
  undoAuditOperation: () => Promise.resolve({
    auditLog: [],
    inventorySnapshot: cloneInventorySnapshot(browserPreviewSnapshot),
    settingsState: cloneSettingsState(browserPreviewSettingsState),
  }),
  releaseStartupObservation: () => Promise.resolve(),
  onUpdateStatusUpdated: () => () => undefined,
  onInventoryUpdated: () => () => undefined,
  onAuditUpdated: () => () => undefined,
  addCustomScanPath: () => Promise.resolve(cloneSettingsState(browserPreviewSettingsState)),
  removeCustomScanPath: () => Promise.resolve(cloneSettingsState(browserPreviewSettingsState)),
  setPreferredCanonicalSourcePath: (scanPath) => {
    browserPreviewSettingsState = {
      ...browserPreviewSettingsState,
      customScanPaths: browserPreviewSettingsState.customScanPaths.includes(scanPath)
        ? browserPreviewSettingsState.customScanPaths
        : [...browserPreviewSettingsState.customScanPaths, scanPath],
      preferredCanonicalSourcePath: scanPath,
    };
    return Promise.resolve(cloneSettingsState(browserPreviewSettingsState));
  },
  clearPreferredCanonicalSourcePath: () => {
    browserPreviewSettingsState = {
      ...browserPreviewSettingsState,
      preferredCanonicalSourcePath: null,
    };
    return Promise.resolve(cloneSettingsState(browserPreviewSettingsState));
  },
  setDevSidebarInventorySourceSwitcherVisible: (visible) => {
    browserPreviewSettingsState = {
      ...browserPreviewSettingsState,
      showDevSidebarInventorySourceSwitcher: visible,
    };
    return Promise.resolve(cloneSettingsState(browserPreviewSettingsState));
  },
  completeOnboarding: (request) => {
    const hasPreferredCanonicalSourcePathRequest = Object.hasOwn(request, 'preferredCanonicalSourcePath');
    const preferredCanonicalSourcePath = hasPreferredCanonicalSourcePathRequest
      ? request.preferredCanonicalSourcePath ?? null
      : browserPreviewSettingsState.preferredCanonicalSourcePath;
    const customScanPaths = hasPreferredCanonicalSourcePathRequest
      && preferredCanonicalSourcePath
      && !browserPreviewSettingsState.customScanPaths.includes(preferredCanonicalSourcePath)
      ? [...browserPreviewSettingsState.customScanPaths, preferredCanonicalSourcePath]
      : browserPreviewSettingsState.customScanPaths;
    browserPreviewSettingsState = {
      ...browserPreviewSettingsState,
      customScanPaths,
      onboardingCompletedAt: new Date().toISOString(),
      preferredCanonicalSourcePath,
    };
    return Promise.resolve(cloneSettingsState(browserPreviewSettingsState));
  },
  ping: () => Promise.resolve('browser-preview'),
};

const browserPreviewDevApi: SkillIndexDevApi = {
  seedRepresentativeFixtures: () => {
    browserPreviewSnapshot = cloneInventorySnapshot(representativeInventorySnapshot);
    return Promise.resolve(representativeSeededFixtures);
  },
  setInventoryMode: (mode) => Promise.resolve(mode),
};

function cloneInventorySnapshot(snapshot: SkillInventorySnapshot): SkillInventorySnapshot {
  return structuredClone(snapshot);
}

function cloneSettingsState(settingsState: SettingsState): SettingsState {
  return structuredClone(settingsState);
}

async function resolveWithOptionalPreviewHold<T>(value: T): Promise<T> {
  const holdMs = getPreviewRescanHoldMs();
  if (holdMs === 0) {
    return value;
  }

  await new Promise((resolve) => {
    window.setTimeout(resolve, holdMs);
  });
  return value;
}

async function resolveWithOptionalStartupHold<T>(value: T): Promise<T> {
  const holdMs = getPreviewStartupHoldMs();
  if (holdMs === 0) {
    return value;
  }

  await new Promise((resolve) => {
    window.setTimeout(resolve, holdMs);
  });
  return value;
}

function getPreviewStartupHoldMs(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const holdParam = new URLSearchParams(window.location.search).get('hold-startup');
  if (holdParam === null) {
    return 0;
  }

  const holdMs = Number(holdParam);
  return Number.isFinite(holdMs) && holdMs > 0 ? holdMs : PREVIEW_STARTUP_HOLD_MS;
}

function getPreviewRescanHoldMs(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  const holdParam = new URLSearchParams(window.location.search).get('hold-rescan');
  if (holdParam === null) {
    return 0;
  }

  const holdMs = Number(holdParam);
  return Number.isFinite(holdMs) && holdMs > 0 ? holdMs : PREVIEW_RESCAN_HOLD_MS;
}

function getBrowserPreviewUpdateStatus() {
  if (typeof window === 'undefined') {
    return { phase: 'disabled' as const };
  }

  const mockUpdate = new URLSearchParams(window.location.search).get('mock-update');
  if (mockUpdate === 'ready') {
    return {
      phase: 'ready' as const,
      version: '0.2.0',
      lastCheckedAt: new Date().toISOString(),
    };
  }
  if (mockUpdate === 'downloading') {
    return {
      downloadProgress: {
        bytesPerSecond: 1_024_000,
        percent: 23.5714,
        totalBytes: 28_000_000,
        transferredBytes: 6_600_000,
      },
      phase: 'downloading' as const,
      version: '0.2.0',
      lastCheckedAt: new Date().toISOString(),
    };
  }

  return { phase: 'disabled' as const };
}

function toggleBrowserPreviewDismissal(snapshot: SkillInventorySnapshot, request: DismissDriftRequest): SkillInventorySnapshot {
  const nextSnapshot = cloneInventorySnapshot(snapshot);
  nextSnapshot.scannedAt = new Date().toISOString();

  if ('skillName' in request) {
    nextSnapshot.skills = nextSnapshot.skills.map((skill) => skill.name === request.skillName
      ? {
        ...skill,
        driftPresentation: toggleSkillPresentation(skill.driftPresentation),
      }
      : skill);
    nextSnapshot.counts = recomputeSkillCounts(nextSnapshot);
  } else if ('mcpName' in request) {
    nextSnapshot.mcps = (nextSnapshot.mcps ?? []).map((mcp) => mcp.name === request.mcpName
      ? {
        ...mcp,
        presentation: toggleMcpPresentation(mcp.presentation),
      }
      : mcp);
    nextSnapshot.mcpCounts = recomputeMcpCounts(nextSnapshot);
  } else {
    nextSnapshot.subagents = (nextSnapshot.subagents ?? []).map((subagent) => subagent.name === request.subagentName
      ? {
        ...subagent,
        presentation: toggleSubagentPresentation(subagent.presentation),
      }
      : subagent);
    nextSnapshot.subagentCounts = recomputeSubagentCounts(nextSnapshot);
  }

  nextSnapshot.homeSummary = recomputeHomeSummary(nextSnapshot);

  return nextSnapshot;
}

function removeBrowserPreviewItem(snapshot: SkillInventorySnapshot, request: RemoveInventoryItemRequest): SkillInventorySnapshot {
  const nextSnapshot = cloneInventorySnapshot(snapshot);
  nextSnapshot.scannedAt = new Date().toISOString();

  if (request.entity === 'skill') {
    nextSnapshot.skills = nextSnapshot.skills.filter((skill) => skill.name !== request.skillName);
    nextSnapshot.counts = recomputeSkillCounts(nextSnapshot);
  } else if (request.entity === 'mcp') {
    nextSnapshot.mcps = (nextSnapshot.mcps ?? []).filter((mcp) => mcp.name !== request.mcpName);
    nextSnapshot.mcpCounts = recomputeMcpCounts(nextSnapshot);
  } else {
    nextSnapshot.subagents = (nextSnapshot.subagents ?? []).filter((subagent) => subagent.name !== request.subagentName);
    nextSnapshot.subagentCounts = recomputeSubagentCounts(nextSnapshot);
  }

  nextSnapshot.homeSummary = recomputeHomeSummary(nextSnapshot);
  return nextSnapshot;
}

function toggleSkillPresentation(presentation: SkillDriftPresentation): SkillDriftPresentation {
  return presentation === 'dismissed' ? 'active' : 'dismissed';
}

function toggleMcpPresentation(presentation: McpPresentation): McpPresentation {
  return presentation === 'dismissed' ? 'active' : 'dismissed';
}

function toggleSubagentPresentation(presentation: SubagentPresentation): SubagentPresentation {
  return presentation === 'dismissed' ? 'active' : 'dismissed';
}

function recomputeSkillCounts(snapshot: SkillInventorySnapshot): SkillInventorySnapshot['counts'] {
  return {
    totalSkills: snapshot.skills.length,
    driftedSkills: snapshot.skills.filter((skill) => skill.driftPresentation === 'active').length,
    healthySkills: snapshot.skills.filter((skill) => skill.driftPresentation === 'none').length,
    missingSymlinkSkills: snapshot.skills.filter((skill) => skill.structuralState === 'missing-symlinks').length,
    singleSourceSkills: snapshot.skills.filter((skill) => skill.structuralState === 'single-source-noncanonical').length,
    identicalDriftSkills: snapshot.skills.filter((skill) => skill.structuralState === 'identical-drift').length,
    divergedDriftSkills: snapshot.skills.filter((skill) => skill.structuralState === 'diverged-drift').length,
    dismissedDriftSkills: snapshot.skills.filter((skill) => skill.driftPresentation === 'dismissed').length,
  };
}

function recomputeMcpCounts(snapshot: SkillInventorySnapshot): NonNullable<SkillInventorySnapshot['mcpCounts']> {
  const mcps = snapshot.mcps ?? [];
  return {
    totalMcps: mcps.length,
    attentionMcps: mcps.filter((mcp) => mcp.status === 'needs-attention' && mcp.presentation === 'active').length,
    healthyMcps: mcps.filter((mcp) => mcp.status === 'healthy').length,
    dismissedAttentionMcps: mcps.filter((mcp) => mcp.status === 'needs-attention' && mcp.presentation === 'dismissed').length,
  };
}

function recomputeSubagentCounts(snapshot: SkillInventorySnapshot): NonNullable<SkillInventorySnapshot['subagentCounts']> {
  const subagents = snapshot.subagents ?? [];
  return {
    totalSubagents: subagents.length,
    attentionSubagents: subagents.filter((subagent) => subagent.status === 'needs-attention' && subagent.presentation === 'active').length,
    healthySubagents: subagents.filter((subagent) => subagent.status === 'healthy').length,
    dismissedAttentionSubagents: subagents.filter((subagent) => subagent.status === 'needs-attention' && subagent.presentation === 'dismissed').length,
  };
}

function recomputeHomeSummary(snapshot: SkillInventorySnapshot): NonNullable<SkillInventorySnapshot['homeSummary']> {
  return {
    skills: {
      total: snapshot.counts.totalSkills,
      healthy: snapshot.counts.healthySkills,
      needsAttention: snapshot.counts.driftedSkills,
    },
    mcps: {
      total: snapshot.mcpCounts?.totalMcps ?? 0,
      healthy: snapshot.mcpCounts?.healthyMcps ?? 0,
      needsAttention: snapshot.mcpCounts?.attentionMcps ?? 0,
    },
    subagents: snapshot.subagentCounts
      ? {
          total: snapshot.subagentCounts.totalSubagents,
          healthy: snapshot.subagentCounts.healthySubagents,
          needsAttention: snapshot.subagentCounts.attentionSubagents,
        }
      : undefined,
    installedAgents: snapshot.homeSummary?.installedAgents ?? 0,
  };
}
