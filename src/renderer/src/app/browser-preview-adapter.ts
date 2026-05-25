import {
  type AddMcpServerRequest,
  type AddSkillRequest,
  APP_NAME,
  type DismissDriftRequest,
  type McpPresentation,
  type ResolveIssueRequest,
  type SettingsState,
  type SkillDriftPresentation,
  type SkillInventorySnapshot,
  type SkillIndexDesktopApi,
  type SkillIndexDevApi,
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
  setPreferredCanonicalSourcePath: () => Promise.resolve(cloneSettingsState(browserPreviewSettingsState)),
  clearPreferredCanonicalSourcePath: () => Promise.resolve(cloneSettingsState(browserPreviewSettingsState)),
  setDevSidebarInventorySourceSwitcherVisible: (visible) => {
    browserPreviewSettingsState = {
      ...browserPreviewSettingsState,
      showDevSidebarInventorySourceSwitcher: visible,
    };
    return Promise.resolve(cloneSettingsState(browserPreviewSettingsState));
  },
  completeOnboarding: (request) => {
    browserPreviewSettingsState = {
      ...browserPreviewSettingsState,
      customScanPaths: request.preferredCanonicalSourcePath ? [request.preferredCanonicalSourcePath] : [],
      onboardingCompletedAt: new Date().toISOString(),
      preferredCanonicalSourcePath: request.preferredCanonicalSourcePath ?? null,
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
  } else {
    nextSnapshot.mcps = (nextSnapshot.mcps ?? []).map((mcp) => mcp.name === request.mcpName
      ? {
        ...mcp,
        presentation: toggleMcpPresentation(mcp.presentation),
      }
      : mcp);
    nextSnapshot.mcpCounts = recomputeMcpCounts(nextSnapshot);
  }

  nextSnapshot.homeSummary = {
    skills: {
      total: nextSnapshot.counts.totalSkills,
      healthy: nextSnapshot.counts.healthySkills,
      needsAttention: nextSnapshot.counts.driftedSkills,
    },
    mcps: {
      total: nextSnapshot.mcpCounts?.totalMcps ?? 0,
      healthy: nextSnapshot.mcpCounts?.healthyMcps ?? 0,
      needsAttention: nextSnapshot.mcpCounts?.attentionMcps ?? 0,
    },
    installedAgents: nextSnapshot.homeSummary?.installedAgents ?? 0,
  };

  return nextSnapshot;
}

function toggleSkillPresentation(presentation: SkillDriftPresentation): SkillDriftPresentation {
  return presentation === 'dismissed' ? 'active' : 'dismissed';
}

function toggleMcpPresentation(presentation: McpPresentation): McpPresentation {
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
