import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Undo2 } from 'lucide-react';

import {
  type AddSkillRequest,
  type AddMcpServerRequest,
  APP_NAME,
  type AppShellState,
  type AuditOperation,
  type AutoUpdateStatus,
  type CapabilityActionRequest,
  type DismissDriftRequest,
  type InventorySourceMode,
  type McpIssueReason,
  type PluginRecord,
  type ResolveIssueRequest,
  type SettingsState,
  type SkillInventorySnapshot,
  type SkillIssueReason,
} from '@shared/contracts';
import { CANONICAL_USER_SKILLS_DISPLAY_PATH } from '@shared/skill-path-policy';

import skillIndexMark from './assets/skill-index-mark.svg';
import {
  createInitialSettingsState,
  getDevApi,
  getDesktopApi,
  getInitialInventorySnapshot,
  isOlderInventorySnapshot,
  loadCachedInventorySnapshot,
  loadInventorySnapshot,
  waitForStartupObservation,
} from './app/bootstrap';
import { getAutoResolvableMcpRequests, getAutoResolvableSkillRequests } from './lib/issue-resolution';
import type { PendingInventoryOperation } from './lib/pending-inventory-operation';
import { AppSidebar } from './components/AppSidebar';
import {
  buildMcpInspectorModel,
  buildSkillInspectorModel,
  type InspectorProvenanceSummaryRow,
} from './lib/detail-inspector-model';
import {
  compareAgentsForTable,
  filterMcpRowsByStatus,
  filterSkillRowsByStatus,
  formatLastScanLabel,
  type McpStatusFilter,
  type SkillStatusFilter,
} from './lib/inventory-presentation';
import {
  filterAgentRows,
  filterMcpRows,
  filterPluginRows,
  filterSkillRows,
  getHomeSummary,
  getMcpTableRows,
  getSkillTableRows,
  type PrimaryTab,
} from './inventory-view-model';
import { AgentsWorkspaceView } from './views/AgentsWorkspaceView';
import { AuditWorkspaceView } from './views/AuditWorkspaceView';
import { HomeDashboard } from './views/HomeDashboard';
import { McpWorkspaceView } from './views/McpWorkspaceView';
import { OnboardingFlow } from './views/OnboardingFlow';
import { PluginsWorkspaceView } from './views/PluginsWorkspaceView';
import { SettingsWorkspaceView } from './views/SettingsWorkspaceView';
import { SkillsWorkspaceView } from './views/SkillsWorkspaceView';

function getAutoResolvableRequestsForSnapshot(snapshot: SkillInventorySnapshot): ResolveIssueRequest[] {
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));

  return [
    ...getAutoResolvableSkillRequests(snapshot, sourceIndex),
    ...getAutoResolvableMcpRequests(snapshot),
  ];
}

function getResolveIssueRequestKey(request: ResolveIssueRequest): string {
  return [
    request.entity,
    request.skillName ?? request.mcpName,
    request.issue,
    request.selectedVariantPath ?? '',
  ].join(':');
}

function comparePluginsForTable(left: PluginRecord, right: PluginRecord): number {
  return left.host.localeCompare(right.host)
    || left.pluginName.localeCompare(right.pluginName, undefined, { sensitivity: 'base' })
    || (left.version ?? '').localeCompare(right.version ?? '', undefined, { sensitivity: 'base' })
    || left.rootPath.localeCompare(right.rootPath);
}

function getPluginSelectionKey(plugin: PluginRecord): string {
  return [
    plugin.host,
    plugin.scope ?? '',
    plugin.pluginId,
    plugin.version ?? '',
    plugin.rootPath,
  ].join(':');
}

const MIN_RESOLVE_PENDING_MS = 200;

async function waitForResolvePendingPaintWindow(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, MIN_RESOLVE_PENDING_MS);
  });
}

export default function App() {
  const desktopApi = useMemo(() => getDesktopApi(), []);
  const devApi = useMemo(() => getDevApi(), []);
  const initialInventorySnapshot = useRef<SkillInventorySnapshot | null>(getInitialInventorySnapshot()).current;
  const skillSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mcpSearchInputRef = useRef<HTMLInputElement | null>(null);
  const agentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pluginSearchInputRef = useRef<HTMLInputElement | null>(null);
  const auditSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [shellState, setShellState] = useState<AppShellState | null>(null);
  const [settingsState, setSettingsState] = useState<SettingsState>(() => createInitialSettingsState());
  const [hasLoadedStartupState, setHasLoadedStartupState] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] = useState<SkillInventorySnapshot | null>(initialInventorySnapshot);
  const latestInventorySnapshotRef = useRef<SkillInventorySnapshot | null>(initialInventorySnapshot);
  const mcpConnectivityRunIdRef = useRef(0);
  const mcpConnectivityErrorMessageRef = useRef<string | null>(null);
  const [inventorySourceMode, setInventorySourceMode] = useState<InventorySourceMode>('live');
  const [activeTab, setActiveTab] = useState<PrimaryTab>('home');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [pluginSearchQuery, setPluginSearchQuery] = useState('');
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditOperations, setAuditOperations] = useState<AuditOperation[]>([]);
  const [selectedPluginKey, setSelectedPluginKey] = useState<string | null>(null);
  const [skillStatusFilter, setSkillStatusFilter] = useState<SkillStatusFilter>('all');
  const [mcpStatusFilter, setMcpStatusFilter] = useState<McpStatusFilter>('all');
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [selectedMcpName, setSelectedMcpName] = useState<string | null>(null);
  const [customScanPathInput, setCustomScanPathInput] = useState('');
  const [preferredCanonicalSourcePathInput, setPreferredCanonicalSourcePathInput] = useState('');
  const [, setSettingsMessage] = useState<string | null>(null);
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isSeedingFixtures, setIsSeedingFixtures] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [isTestingMcpConnectivity, setIsTestingMcpConnectivity] = useState(false);
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [isAddingMcpServer, setIsAddingMcpServer] = useState(false);
  const [appToast, setAppToast] = useState<{
    description: string;
    id: number;
    tone: 'error' | 'success';
    title: string;
    undoOperationId?: string;
  } | null>(null);
  const [isUndoingToastOperation, setIsUndoingToastOperation] = useState(false);
  const [pendingInventoryOperation, setPendingInventoryOperation] = useState<PendingInventoryOperation | null>(null);
  const [isAutoResolving, setIsAutoResolving] = useState(false);
  const [isResolvingIssue, setIsResolvingIssue] = useState(false);
  const [isApplyingCapabilityAction, setIsApplyingCapabilityAction] = useState(false);
  const [isDismissingDrift, setIsDismissingDrift] = useState(false);
  const [, setLastScanClockTick] = useState(0);
  const [pendingDriftTransitionSkillName, setPendingDriftTransitionSkillName] = useState<string | null>(null);
  const [selectionOverrideSkillName, setSelectionOverrideSkillName] = useState<string | null>(null);
  const [selectedSkillProblemKey, setSelectedSkillProblemKey] = useState<SkillIssueReason | null>(null);
  const [selectedSkillVariantPath, setSelectedSkillVariantPath] = useState<string | null>(null);
  const [selectedMcpProblemKey, setSelectedMcpProblemKey] = useState<McpIssueReason | null>(null);
  const [selectedMcpVariantPath, setSelectedMcpVariantPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<AutoUpdateStatus>({ phase: 'disabled' });
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [isPreviewingOnboarding, setIsPreviewingOnboarding] = useState(false);
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
  const [onboardingErrorMessage, setOnboardingErrorMessage] = useState<string | null>(null);

  const applyInventorySnapshot = useCallback(
    (nextInventorySnapshot: SkillInventorySnapshot, preferredSkillName?: string | null) => {
      const latestInventorySnapshot = latestInventorySnapshotRef.current;
      if (latestInventorySnapshot && isOlderInventorySnapshot(latestInventorySnapshot, nextInventorySnapshot)) {
        return;
      }

      const transitionedSkillName = preferredSkillName ?? pendingDriftTransitionSkillName;
      const transitionedSkill = transitionedSkillName
        ? nextInventorySnapshot.skills.find((skill) => skill.name === transitionedSkillName)
        : null;

      if (transitionedSkillName && transitionedSkill && transitionedSkill.driftPresentation !== 'active') {
        setSelectedSkillName(transitionedSkillName);
        setSelectionOverrideSkillName(transitionedSkillName);
        setSelectedSkillProblemKey(null);
        setSelectedSkillVariantPath(null);
        setPendingDriftTransitionSkillName(null);
      }

      latestInventorySnapshotRef.current = nextInventorySnapshot;
      setInventorySnapshot(nextInventorySnapshot);
    },
    [pendingDriftTransitionSkillName],
  );

  const appToastIdRef = useRef(0);

  const refreshAuditLog = useCallback(async () => {
    const nextAuditOperations = await desktopApi.readAuditLog();
    setAuditOperations(nextAuditOperations);
    return nextAuditOperations;
  }, [desktopApi]);

  const showAppToast = useCallback((
    title: string,
    description: string,
    undoOperation?: AuditOperation | null,
    tone: 'error' | 'success' = 'success',
  ) => {
    appToastIdRef.current += 1;
    setAppToast({
      id: appToastIdRef.current,
      tone,
      title,
      description,
      undoOperationId: undoOperation?.undoState === 'available' ? undoOperation.id : undefined,
    });
  }, []);

  const showAppToastWithLatestUndo = useCallback(async (
    title: string,
    description: string,
    options: { includeUndo?: boolean } = {},
  ) => {
    let undoOperation: AuditOperation | null = null;
    try {
      const nextAuditOperations = await refreshAuditLog();
      undoOperation = options.includeUndo === false
        ? null
        : nextAuditOperations.find((operation) => operation.undoState === 'available') ?? null;
    } catch {
      undoOperation = null;
    }
    showAppToast(title, description, undoOperation);
  }, [refreshAuditLog, showAppToast]);

  const startMcpConnectivityTest = useCallback(() => {
    const runId = mcpConnectivityRunIdRef.current + 1;
    mcpConnectivityRunIdRef.current = runId;
    setIsTestingMcpConnectivity(true);
    setErrorMessage((currentMessage) =>
      currentMessage === mcpConnectivityErrorMessageRef.current ? null : currentMessage);
    mcpConnectivityErrorMessageRef.current = null;

    void desktopApi.testMcpConnectivity()
      .then((nextInventorySnapshot) => {
        if (runId !== mcpConnectivityRunIdRef.current) {
          return;
        }
        applyInventorySnapshot(nextInventorySnapshot);
        setErrorMessage((currentMessage) =>
          currentMessage === mcpConnectivityErrorMessageRef.current ? null : currentMessage);
      })
      .catch((error) => {
        if (runId !== mcpConnectivityRunIdRef.current) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unknown preload error';
        mcpConnectivityErrorMessageRef.current = message;
        setErrorMessage(message);
      })
      .finally(() => {
        if (runId !== mcpConnectivityRunIdRef.current) {
          return;
        }
        setIsTestingMcpConnectivity(false);
      });
  }, [applyInventorySnapshot, desktopApi]);

  const triggerRescan = useCallback(async ({
    pendingOperation = null,
    shouldManagePendingOperation = true,
    showSuccessToast = false,
    verifyMcpConnectivity,
  }: {
    pendingOperation?: PendingInventoryOperation | null;
    shouldManagePendingOperation?: boolean;
    showSuccessToast?: boolean;
    verifyMcpConnectivity?: boolean;
  } = {}) => {
    setIsRescanning(true);
    if (shouldManagePendingOperation) {
      setPendingInventoryOperation(pendingOperation ?? {
        area: 'development',
        title: 'Refreshing inventory',
        kind: 'refresh-inventory',
        detail: 'Updating results from the current inventory source.',
      });
    }
    if (showSuccessToast) {
      setAppToast(null);
    }

    try {
      const nextInventorySnapshot = await desktopApi.rescanInventory(
        verifyMcpConnectivity === undefined ? undefined : { verifyMcpConnectivity },
      );
      applyInventorySnapshot(nextInventorySnapshot);
      setErrorMessage(null);
      if (showSuccessToast) {
        showAppToast('Inventory refreshed', 'Manual rescan completed successfully.');
      }
    } catch (error) {
      if (showSuccessToast) {
        setAppToast(null);
      }
      setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
    } finally {
      setIsRescanning(false);
      if (shouldManagePendingOperation) {
        setPendingInventoryOperation(null);
      }
    }
  }, [applyInventorySnapshot, desktopApi, showAppToast]);

  const triggerManualRescan = useCallback(async () => {
    await triggerRescan({ showSuccessToast: true });
  }, [triggerRescan]);

  useEffect(() => {
    if (!appToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAppToast((currentToast) => (currentToast?.id === appToast.id ? null : currentToast));
    }, 2800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [appToast]);

  useEffect(() => {
    if (!inventorySnapshot?.scannedAt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setLastScanClockTick((currentTick) => currentTick + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [inventorySnapshot?.scannedAt]);

  useEffect(() => {
    let isMounted = true;

    const shellStatePromise = desktopApi.getShellState();
    const settingsStatePromise = desktopApi.readSettings();
    const startupStatePromise = Promise.all([shellStatePromise, settingsStatePromise]);
    const waitForStartupObservationWindow = async () => {
      const nextShellState = await shellStatePromise;
      await waitForStartupObservation(nextShellState.startupObservationDelayMs ?? 0);
    };
    const loadStartupState = async () => {
      try {
        const [nextShellState, nextSettingsState] = await startupStatePromise;

        if (!isMounted) {
          return;
        }

        setShellState(nextShellState);
        setSettingsState(nextSettingsState);
        setInventorySourceMode(nextShellState.devTools?.inventoryMode ?? 'live');
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
      } finally {
        if (isMounted) {
          setHasLoadedStartupState(true);
        }
      }
    };

    const hydrateInventory = async () => {
      try {
        const [nextShellState, nextSettingsState] = await startupStatePromise;
        if (nextSettingsState.onboardingCompletedAt === null) {
          return;
        }
        if (nextShellState.devTools && devApi) {
          await devApi.setInventoryMode(nextShellState.devTools.inventoryMode);
        }
        const cachedSnapshot = await loadCachedInventorySnapshot(desktopApi);

        if (!isMounted) {
          return;
        }

        if (cachedSnapshot) {
          applyInventorySnapshot(cachedSnapshot);
          await waitForStartupObservationWindow();
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
      }

      try {
        const nextInventorySnapshot = await loadInventorySnapshot(desktopApi);

        if (!isMounted) {
          return;
        }

        applyInventorySnapshot(nextInventorySnapshot);
        setErrorMessage(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
      }
    };

    void loadStartupState();
    void hydrateInventory();

    return () => {
      isMounted = false;
    };
  }, [applyInventorySnapshot, desktopApi, devApi]);

  useEffect(() => {
    return desktopApi.onInventoryUpdated((nextInventorySnapshot) => {
      applyInventorySnapshot(nextInventorySnapshot);
      setIsResolvingIssue(false);
      setIsDismissingDrift(false);
      setErrorMessage(null);
    });
  }, [applyInventorySnapshot, desktopApi]);

  useEffect(() => {
    let isMounted = true;
    void desktopApi.readUpdateStatus()
      .then((nextStatus) => {
        if (isMounted) {
          setAutoUpdateStatus(nextStatus);
        }
      })
      .catch(() => undefined);

    const unsubscribe = desktopApi.onUpdateStatusUpdated((nextStatus) => {
      setAutoUpdateStatus(nextStatus);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [desktopApi]);

  useEffect(() => {
    let isMounted = true;
    void desktopApi.readAuditLog()
      .then((nextAuditOperations) => {
        if (isMounted) {
          setAuditOperations(nextAuditOperations);
        }
      })
      .catch(() => undefined);

    const unsubscribe = desktopApi.onAuditUpdated((nextAuditOperations) => {
      setAuditOperations(nextAuditOperations);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [desktopApi]);

  const updateSettingsAndRescan = useCallback(
    async (
      runUpdate: () => Promise<SettingsState>,
      successMessage: string,
      pendingOperation: PendingInventoryOperation,
    ) => {
      setIsUpdatingSettings(true);
      setPendingInventoryOperation(pendingOperation);
      setSettingsMessage(null);

      try {
        const nextSettingsState = await runUpdate();
        setSettingsState(nextSettingsState);
        await triggerRescan({
          shouldManagePendingOperation: false,
          verifyMcpConnectivity: false,
        });
        if (inventorySourceMode === 'live') {
          startMcpConnectivityTest();
        }
        setSettingsMessage(successMessage);
        await showAppToastWithLatestUndo('Settings updated', successMessage);
      } catch (error) {
        setSettingsMessage(null);
        setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
      } finally {
        setIsUpdatingSettings(false);
        setPendingInventoryOperation(null);
      }
    },
    [inventorySourceMode, showAppToastWithLatestUndo, startMcpConnectivityTest, triggerRescan],
  );

  const handleAddCustomScanPath = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const requestedPath = customScanPathInput;

      await updateSettingsAndRescan(
        async () => {
          const nextSettingsState = await desktopApi.addCustomScanPath(requestedPath);
          setCustomScanPathInput('');
          return nextSettingsState;
        },
        `Added ${requestedPath.trim()}. We'll include it in future scans.`,
        {
          area: 'scan-paths',
          title: 'Adding scan path',
          kind: 'add-scan-path',
          detail: 'Refreshing inventory with the new directory.',
        },
      );
    },
    [customScanPathInput, desktopApi, updateSettingsAndRescan],
  );

  const handleRemoveCustomScanPath = useCallback(
    async (scanPath: string) => {
      await updateSettingsAndRescan(
        () => desktopApi.removeCustomScanPath(scanPath),
        `Removed ${scanPath}. We won't scan it again unless you add it back.`,
        {
          area: 'scan-paths',
          title: 'Removing scan path',
          kind: 'remove-scan-path',
          detail: 'Refreshing inventory without that directory.',
        },
      );
    },
    [desktopApi, updateSettingsAndRescan],
  );

  const handleSetPreferredCanonicalSourcePath = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const requestedPath = preferredCanonicalSourcePathInput;

      await updateSettingsAndRescan(
        async () => {
          const nextSettingsState = await desktopApi.setPreferredCanonicalSourcePath(requestedPath);
          setPreferredCanonicalSourcePathInput('');
          return nextSettingsState;
        },
        `We'll prefer ${requestedPath.trim()} whenever a matching skill exists there.`,
        {
          area: 'scan-paths',
          title: 'Updating canonical path',
          kind: 'set-canonical-path',
          detail: 'Refreshing links and issue state after the canonical change.',
        },
      );
    },
    [desktopApi, preferredCanonicalSourcePathInput, updateSettingsAndRescan],
  );

  const handleSetPreferredCanonicalSourcePathValue = useCallback(
    async (requestedPath: string) => {
      await updateSettingsAndRescan(
        async () => {
          const nextSettingsState = await desktopApi.setPreferredCanonicalSourcePath(requestedPath);
          setPreferredCanonicalSourcePathInput('');
          return nextSettingsState;
        },
        `We'll prefer ${requestedPath.trim()} whenever a matching skill exists there.`,
        {
          area: 'scan-paths',
          title: 'Updating canonical path',
          kind: 'set-canonical-path',
          detail: 'Refreshing links and issue state after the canonical change.',
        },
      );
    },
    [desktopApi, updateSettingsAndRescan],
  );

  const handleClearPreferredCanonicalSourcePath = useCallback(
    async () => {
      const configuredPath = settingsState.preferredCanonicalSourcePath;
      await updateSettingsAndRescan(
        () => desktopApi.clearPreferredCanonicalSourcePath(),
        configuredPath
          ? `Cleared ${configuredPath}. ~/.agents is the fallback universal home again.`
          : 'Cleared the preferred canonical source.',
        {
          area: 'scan-paths',
          title: 'Clearing canonical path',
          kind: 'clear-canonical-path',
          detail: 'Refreshing links and issue state after returning to the fallback.',
        },
      );
    },
    [desktopApi, settingsState.preferredCanonicalSourcePath, updateSettingsAndRescan],
  );

  const handleSetDevSidebarInventorySourceSwitcherVisible = useCallback(
    async (visible: boolean) => {
      setIsUpdatingSettings(true);
      setSettingsMessage(null);
      setErrorMessage(null);

      try {
        const nextSettingsState = await desktopApi.setDevSidebarInventorySourceSwitcherVisible(visible);
        setSettingsState(nextSettingsState);
        const successMessage = visible
          ? 'Sidebar source switcher is visible in dev mode.'
          : 'Sidebar source switcher is hidden in dev mode.';
        setSettingsMessage(successMessage);
        await showAppToastWithLatestUndo('Settings updated', successMessage);
      } catch (error) {
        setSettingsMessage(null);
        setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
      } finally {
        setIsUpdatingSettings(false);
      }
    },
    [desktopApi, showAppToastWithLatestUndo],
  );

  const handleSeedRepresentativeFixtures = useCallback(async () => {
    if (!devApi) {
      setErrorMessage('Representative sandbox controls are only available in development.');
      return;
    }

    setIsSeedingFixtures(true);
    setPendingInventoryOperation({
      area: 'development',
      title: 'Resetting sandbox',
      kind: 'reset-sandbox',
      detail: 'Rebuilding fixtures and rescanning the representative sandbox.',
    });
    setSettingsMessage(null);
    setErrorMessage(null);

    try {
      const seededFixtures = await devApi.seedRepresentativeFixtures();
      const nextInventorySnapshot = await desktopApi.rescanInventory({ verifyMcpConnectivity: false });
      applyInventorySnapshot(nextInventorySnapshot);
      setSettingsMessage(
        `Reset the representative sandbox fixtures in ${seededFixtures.sandboxRoot}. ${seededFixtures.skills.length} skills are ready for testing.`,
      );
      await showAppToastWithLatestUndo('Sandbox reset', 'Representative fixtures were reset.');
    } catch (error) {
      setSettingsMessage(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
    } finally {
      setIsSeedingFixtures(false);
      setPendingInventoryOperation(null);
    }
  }, [applyInventorySnapshot, desktopApi, devApi, showAppToastWithLatestUndo]);

  const handleAddSkill = useCallback(async (request: AddSkillRequest) => {
    setIsAddingSkill(true);
    setErrorMessage(null);

    try {
      const nextInventorySnapshot = await desktopApi.addSkill(request);
      applyInventorySnapshot(nextInventorySnapshot);
      setErrorMessage(null);
      await showAppToastWithLatestUndo(
        'Skill added',
        request.sourceType === 'markdown'
          ? `${request.skillName.trim()} was added.`
          : 'The skill install completed.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preload error';
      setErrorMessage(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsAddingSkill(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo]);

  const handleAddMcpServer = useCallback(async (request: AddMcpServerRequest) => {
    setIsAddingMcpServer(true);
    setErrorMessage(null);

    try {
      const nextInventorySnapshot = await desktopApi.addMcpServer(request);
      applyInventorySnapshot(nextInventorySnapshot);
      setSelectedMcpName(request.name.trim());
      setErrorMessage(null);
      await showAppToastWithLatestUndo('MCP server added', `${request.name.trim()} was added.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preload error';
      setErrorMessage(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsAddingMcpServer(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo]);

  const sourceIndex = useMemo(
    () => new Map(inventorySnapshot?.sources.map((source) => [source.id, source]) ?? []),
    [inventorySnapshot],
  );

  const autoResolvableRequests = useMemo(
    () => (inventorySnapshot ? getAutoResolvableRequestsForSnapshot(inventorySnapshot) : []),
    [inventorySnapshot],
  );

  const homeSummary = useMemo(() => getHomeSummary(inventorySnapshot), [inventorySnapshot]);
  const allSkillRows = useMemo(
    () => (inventorySnapshot ? getSkillTableRows(inventorySnapshot) : []),
    [inventorySnapshot],
  );
  const skillRows = useMemo(
    () => filterSkillRows(filterSkillRowsByStatus(allSkillRows, skillStatusFilter), skillSearchQuery),
    [allSkillRows, skillSearchQuery, skillStatusFilter],
  );
  const allMcpRows = useMemo(
    () => (inventorySnapshot ? getMcpTableRows(inventorySnapshot) : []),
    [inventorySnapshot],
  );
  const mcpRows = useMemo(
    () => filterMcpRows(filterMcpRowsByStatus(allMcpRows, mcpStatusFilter), mcpSearchQuery),
    [allMcpRows, mcpSearchQuery, mcpStatusFilter],
  );
  const agentRows = useMemo(
    () => filterAgentRows((inventorySnapshot?.agents ?? []).slice().sort(compareAgentsForTable), agentSearchQuery),
    [agentSearchQuery, inventorySnapshot?.agents],
  );
  const pluginRows = useMemo(
    () => filterPluginRows((inventorySnapshot?.plugins ?? []).slice().sort(comparePluginsForTable), pluginSearchQuery),
    [inventorySnapshot?.plugins, pluginSearchQuery],
  );
  const selectedPlugin = useMemo(
    () => (inventorySnapshot?.plugins ?? []).find((plugin) => getPluginSelectionKey(plugin) === selectedPluginKey) ?? null,
    [inventorySnapshot?.plugins, selectedPluginKey],
  );
  const agentIndex = useMemo(
    () => new Map((inventorySnapshot?.agents ?? []).map((agent) => [agent.id, agent])),
    [inventorySnapshot?.agents],
  );

  const effectiveSelectedSkillName = selectedSkillName ?? selectionOverrideSkillName;

  const selectedSkill = useMemo(
    () =>
      skillRows.find((skill) => skill.name === effectiveSelectedSkillName)
      ?? (selectionOverrideSkillName
        ? inventorySnapshot?.skills.find((skill) => skill.name === selectionOverrideSkillName) ?? null
        : null),
    [effectiveSelectedSkillName, inventorySnapshot?.skills, selectionOverrideSkillName, skillRows],
  );
  const selectedSkillInspectorModel = useMemo(
    () => selectedSkill
      ? buildSkillInspectorModel(selectedSkill, sourceIndex, {
        selectedProblemKey: selectedSkillProblemKey,
        selectedVariantPath: selectedSkillVariantPath,
      }, agentIndex)
      : null,
    [agentIndex, selectedSkill, selectedSkillProblemKey, selectedSkillVariantPath, sourceIndex],
  );

  const selectedMcp = useMemo(
    () => inventorySnapshot?.mcps?.find((mcp) => mcp.name === selectedMcpName) ?? null,
    [inventorySnapshot?.mcps, selectedMcpName],
  );
  const selectedMcpInspectorModel = useMemo(
    () => selectedMcp
      ? buildMcpInspectorModel(selectedMcp, {
        selectedProblemKey: selectedMcpProblemKey,
        selectedVariantPath: selectedMcpVariantPath,
      }, agentIndex)
      : null,
    [agentIndex, selectedMcp, selectedMcpProblemKey, selectedMcpVariantPath],
  );
  useEffect(() => {
    setSelectedSkillProblemKey(null);
    setSelectedSkillVariantPath(null);
  }, [selectedSkillName]);

  useEffect(() => {
    setSelectedMcpProblemKey(null);
    setSelectedMcpVariantPath(null);
  }, [selectedMcpName]);

  useEffect(() => {
    if (!selectionOverrideSkillName) {
      return;
    }

    const skillStillExists = inventorySnapshot?.skills.some((skill) => skill.name === selectionOverrideSkillName) ?? false;
    if (!skillStillExists) {
      setSelectionOverrideSkillName(null);
      setSelectedSkillProblemKey(null);
      setSelectedSkillVariantPath(null);
      return;
    }

    if (activeTab === 'skills' && skillRows.some((skill) => skill.name === selectionOverrideSkillName)) {
      setSelectionOverrideSkillName(null);
    }
  }, [activeTab, inventorySnapshot?.skills, selectionOverrideSkillName, skillRows]);

  useEffect(() => {
    if (activeTab !== 'skills' || !selectedSkillName) {
      return;
    }

    if (selectionOverrideSkillName) {
      return;
    }

    if (!skillRows.some((skill) => skill.name === selectedSkillName)) {
      setSelectedSkillName(null);
    }
  }, [activeTab, selectedSkillName, selectionOverrideSkillName, skillRows]);

  useEffect(() => {
    if (activeTab !== 'mcps' || !selectedMcpName) {
      return;
    }

    const mcpStillExists = inventorySnapshot?.mcps?.some((mcp) => mcp.name === selectedMcpName) ?? false;
    if (!mcpStillExists) {
      setSelectedMcpName(null);
    }
  }, [activeTab, inventorySnapshot?.mcps, selectedMcpName]);

  const handleResolveIssue = useCallback(
    async (request: ResolveIssueRequest) => {
      const skillName = request.entity === 'skill' ? request.skillName : null;
      setIsResolvingIssue(true);
      setPendingDriftTransitionSkillName(skillName);
      setErrorMessage(null);

      try {
        const nextInventorySnapshot = await desktopApi.resolveIssue(request);
        applyInventorySnapshot(nextInventorySnapshot, skillName ?? undefined);
        if (request.entity === 'skill') {
          await showAppToastWithLatestUndo('Skill updated', `${request.skillName} was updated.`);
        } else {
          await showAppToastWithLatestUndo('MCP server updated', `${request.mcpName} was updated.`);
        }
      } catch (error) {
        setPendingDriftTransitionSkillName(null);
        const message = error instanceof Error ? error.message : 'Unknown preload error';
        setErrorMessage(message);
        showAppToast('Resolution failed', message, null, 'error');
      } finally {
        await waitForResolvePendingPaintWindow();
        setIsResolvingIssue(false);
      }
    },
    [applyInventorySnapshot, desktopApi, showAppToast, showAppToastWithLatestUndo],
  );

  const handleCapabilityAction = useCallback(async (request: CapabilityActionRequest) => {
    setIsApplyingCapabilityAction(true);
    setErrorMessage(null);

    try {
      const nextInventorySnapshot = await desktopApi.applyCapabilityAction(request);
      applyInventorySnapshot(nextInventorySnapshot);
      await showAppToastWithLatestUndo('Capability updated', `${request.skillName} metadata was updated.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
    } finally {
      setIsApplyingCapabilityAction(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo]);

  const handleDismissDrift = useCallback(
    async (request: DismissDriftRequest) => {
      const skillName = 'skillName' in request ? request.skillName ?? null : null;
      setIsDismissingDrift(true);
      setPendingDriftTransitionSkillName(skillName);
      if (skillName) {
        setSelectionOverrideSkillName(skillName);
      }
      setErrorMessage(null);

      try {
      const nextInventorySnapshot = await desktopApi.dismissDrift(request);
      applyInventorySnapshot(nextInventorySnapshot, skillName ?? undefined);
      await showAppToastWithLatestUndo(
        'Dismissal updated',
        skillName ? `${skillName} dismissal state changed.` : `${request.mcpName} dismissal state changed.`,
      );
    } catch (error) {
      setPendingDriftTransitionSkillName(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
    } finally {
      setIsDismissingDrift(false);
    }
  },
    [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo],
  );

  const handleAutoResolve = useCallback(async () => {
    const startingSnapshot = latestInventorySnapshotRef.current;
    if (!startingSnapshot) {
      return;
    }

    let remainingRequests = getAutoResolvableRequestsForSnapshot(startingSnapshot);
    if (remainingRequests.length === 0) {
      return;
    }
    const plannedRepairCount = remainingRequests.length;

    setIsAutoResolving(true);
    setErrorMessage(null);

    try {
      const attemptedRequestKeys = new Set<string>();
      while (remainingRequests.length > 0) {
        const request = remainingRequests.find((candidate) => !attemptedRequestKeys.has(getResolveIssueRequestKey(candidate)));
        if (!request) {
          break;
        }

        attemptedRequestKeys.add(getResolveIssueRequestKey(request));
        const nextInventorySnapshot = await desktopApi.resolveIssue(request);
        applyInventorySnapshot(nextInventorySnapshot);
        remainingRequests = getAutoResolvableRequestsForSnapshot(nextInventorySnapshot);
      }
      await showAppToastWithLatestUndo(
        'Repairs applied',
        `${plannedRepairCount} ${plannedRepairCount === 1 ? 'repair was' : 'repairs were'} applied.`,
        { includeUndo: plannedRepairCount === 1 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown preload error';
      setErrorMessage(message);
      showAppToast('Repairs failed', message, null, 'error');
    } finally {
      setIsAutoResolving(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToast, showAppToastWithLatestUndo]);

  const resetSkillSelection = useCallback(() => {
    setSelectedSkillName(null);
    setSelectionOverrideSkillName(null);
    setSelectedSkillProblemKey(null);
    setSelectedSkillVariantPath(null);
  }, []);

  const resetMcpSelection = useCallback(() => {
    setSelectedMcpName(null);
    setSelectedMcpProblemKey(null);
    setSelectedMcpVariantPath(null);
  }, []);

  const handleUndoToastOperation = useCallback(async (operationId: string) => {
    setIsUndoingToastOperation(true);
    setErrorMessage(null);

    try {
      const result = await desktopApi.undoAuditOperation(operationId);
      setAuditOperations(result.auditLog);
      if (result.inventorySnapshot) {
        applyInventorySnapshot(result.inventorySnapshot);
      }
      if (result.settingsState) {
        setSettingsState(result.settingsState);
      }
      const operation = result.auditLog.find((candidate) => candidate.id === operationId);
      if (operation?.status === 'undo-blocked' || operation?.status === 'undo-failed' || operation?.undoState === 'blocked') {
        showAppToast('Undo blocked', 'The last change could not be undone because the current state has changed.');
      } else {
        showAppToast('Undo applied', 'The last change was undone.');
      }
    } catch (error) {
      showAppToast('Undo blocked', error instanceof Error ? error.message : 'The last change could not be undone.');
    } finally {
      setIsUndoingToastOperation(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToast]);

  const openPluginFromProvenance = useCallback((
    action: NonNullable<InspectorProvenanceSummaryRow['action']>,
  ) => {
    const plugin = (inventorySnapshot?.plugins ?? []).find((candidate) =>
      candidate.host === action.host
      && candidate.pluginId === action.pluginId
      && (!action.version || candidate.version === action.version));
    if (!plugin) {
      setErrorMessage(`Could not find plugin ${action.pluginId} in the current inventory.`);
      return;
    }

    setPluginSearchQuery('');
    setSelectedPluginKey(getPluginSelectionKey(plugin));
    resetSkillSelection();
    resetMcpSelection();
    setActiveTab('plugins');
  }, [inventorySnapshot?.plugins, resetMcpSelection, resetSkillSelection]);

  const handleInventorySourceModeChange = useCallback(async (nextMode: InventorySourceMode) => {
    if (nextMode === inventorySourceMode) {
      return;
    }

    setInventorySourceMode(nextMode);
    setPendingInventoryOperation({
      area: 'development',
      title: `Switching to ${nextMode === 'live' ? 'Live' : 'Sandbox'}`,
      kind: 'switch-inventory-source',
      detail: `Refreshing inventory before showing ${nextMode === 'live' ? 'live agent locations' : 'sandbox fixtures'}.`,
    });
    setErrorMessage(null);
    resetSkillSelection();
    resetMcpSelection();

    try {
      await devApi?.setInventoryMode(nextMode);
      const nextSettingsState = await desktopApi.readSettings();
      setSettingsState(nextSettingsState);
      setSettingsMessage(
        nextMode === 'live'
          ? 'Now scanning live agent locations for this session.'
          : 'Now scanning the representative sandbox for this session.',
      );
      await triggerRescan({
        shouldManagePendingOperation: false,
        verifyMcpConnectivity: false,
      });
      const nextAuditOperations = await desktopApi.readAuditLog();
      setAuditOperations(nextAuditOperations);
      if (nextMode === 'live') {
        startMcpConnectivityTest();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown preload error');
    } finally {
      setPendingInventoryOperation(null);
    }
  }, [desktopApi, devApi, inventorySourceMode, resetMcpSelection, resetSkillSelection, startMcpConnectivityTest, triggerRescan]);

  const navigateToSkills = useCallback(() => {
    resetSkillSelection();
    resetMcpSelection();
    setSkillSearchQuery('');
    setSkillStatusFilter('active');
    setActiveTab('skills');
  }, [resetMcpSelection, resetSkillSelection]);

  const openSkillFromHome = useCallback((skillName: string) => {
    setSkillSearchQuery('');
    setSkillStatusFilter('all');
    setSelectionOverrideSkillName(null);
    setSelectedSkillProblemKey(null);
    setSelectedSkillVariantPath(null);
    setSelectedSkillName(skillName);
    setActiveTab('skills');
  }, []);

  const openMcpFromHome = useCallback((mcpName: string) => {
    setMcpSearchQuery('');
    setMcpStatusFilter('all');
    setSelectedMcpProblemKey(null);
    setSelectedMcpVariantPath(null);
    setSelectedMcpName(mcpName);
    setActiveTab('mcps');
  }, []);

  const focusActiveSearch = useCallback(() => {
    const activeSearchInput = activeTab === 'skills'
      ? skillSearchInputRef.current
      : activeTab === 'mcps'
        ? mcpSearchInputRef.current
      : activeTab === 'agents'
        ? agentSearchInputRef.current
        : activeTab === 'plugins'
          ? pluginSearchInputRef.current
          : activeTab === 'audit'
            ? auditSearchInputRef.current
          : null;

    if (!activeSearchInput) {
      return false;
    }

    activeSearchInput.focus();
    activeSearchInput.select();
    return true;
  }, [activeTab]);

  const blurActiveSearch = useCallback(() => {
    const activeSearchInput = activeTab === 'skills'
      ? skillSearchInputRef.current
      : activeTab === 'mcps'
        ? mcpSearchInputRef.current
      : activeTab === 'agents'
        ? agentSearchInputRef.current
        : activeTab === 'plugins'
          ? pluginSearchInputRef.current
          : activeTab === 'audit'
            ? auditSearchInputRef.current
          : null;

    if (!activeSearchInput || document.activeElement !== activeSearchInput) {
      return false;
    }

    activeSearchInput.blur();
    return true;
  }, [activeTab]);

  const navigateActiveInventoryList = useCallback((direction: 1 | -1, step: number) => {
    if (activeTab === 'skills') {
      const nextSkillName = getNavigatedInventoryName(
        skillRows.map((skill) => skill.name),
        selectedSkill?.name ?? null,
        direction,
        step,
      );
      if (!nextSkillName) {
        return false;
      }

      setSelectionOverrideSkillName(null);
      setSelectedSkillName(nextSkillName);
      return true;
    }

    if (activeTab === 'mcps') {
      const nextMcpName = getNavigatedInventoryName(
        mcpRows.map((mcp) => mcp.name),
        selectedMcp?.name ?? null,
        direction,
        step,
      );
      if (!nextMcpName) {
        return false;
      }

      setSelectedMcpName(nextMcpName);
      return true;
    }

    return false;
  }, [activeTab, mcpRows, selectedMcp?.name, selectedSkill?.name, skillRows]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (blurActiveSearch()) {
          event.preventDefault();
        }
        return;
      }

      if (
        !event.defaultPrevented
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && !isKeyboardEventFromEditableElement(event)
        && (event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'k')
      ) {
        const direction = event.key.toLowerCase() === 'j' ? -1 : 1;
        if (navigateActiveInventoryList(direction, 1)) {
          event.preventDefault();
        }
        return;
      }

      const modifierPressed = event.metaKey || event.ctrlKey;
      if (event.key.toLowerCase() !== 'f' || !modifierPressed || event.altKey || event.shiftKey || (event.metaKey && event.ctrlKey)) {
        return;
      }

      if (focusActiveSearch()) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [blurActiveSearch, focusActiveSearch, navigateActiveInventoryList]);

  const navItems = useMemo(
    () => [
      { tab: 'home' as const, label: 'Home', icon: 'home' as const },
      {
        tab: 'skills' as const,
        label: 'Skills',
        icon: 'skills' as const,
        badge: inventorySnapshot?.counts.driftedSkills ?? 0,
        meta: inventorySnapshot?.counts.totalSkills ?? 0,
        tone: 'attention' as const,
      },
      {
        tab: 'mcps' as const,
        label: 'MCPs',
        icon: 'mcps' as const,
        badge: inventorySnapshot?.mcpCounts?.attentionMcps ?? 0,
        meta: inventorySnapshot?.mcpCounts?.totalMcps ?? 0,
        tone: 'attention' as const,
      },
      {
        tab: 'plugins' as const,
        label: 'Plugins',
        icon: 'plugins' as const,
        meta: inventorySnapshot?.plugins?.length ?? 0,
      },
      {
        tab: 'agents' as const,
        label: 'Agents',
        icon: 'agents' as const,
        meta: inventorySnapshot?.agentCounts?.installedAgents ?? 0,
      },
    ],
    [
      inventorySnapshot?.agentCounts?.installedAgents,
      inventorySnapshot?.counts.driftedSkills,
      inventorySnapshot?.counts.totalSkills,
      inventorySnapshot?.mcpCounts?.attentionMcps,
      inventorySnapshot?.mcpCounts?.totalMcps,
      inventorySnapshot?.plugins?.length,
    ],
  );

  const handleTabChange = useCallback((nextTab: PrimaryTab) => {
    resetSkillSelection();
    resetMcpSelection();
    setActiveTab(nextTab);
  }, [resetMcpSelection, resetSkillSelection]);

  const handleInstallUpdate = useCallback(async () => {
    setIsInstallingUpdate(true);
    try {
      const nextStatus = await desktopApi.installUpdate();
      setAutoUpdateStatus(nextStatus);
    } catch (error) {
      setIsInstallingUpdate(false);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to install update.');
    }
  }, [desktopApi]);

  const chooseOnboardingPreferredSource = useCallback(async () => {
    setOnboardingErrorMessage(null);
    try {
      return await desktopApi.chooseDirectory({
        title: 'Choose a preferred skills source',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open the folder picker.';
      setOnboardingErrorMessage(message);
      return null;
    }
  }, [desktopApi]);

  const completeOnboarding = useCallback(async (preferredSourcePath: string | null) => {
    setIsCompletingOnboarding(true);
    setOnboardingErrorMessage(null);
    setErrorMessage(null);

    try {
      if (shellState?.devTools && devApi) {
        await devApi.setInventoryMode(shellState.devTools.inventoryMode);
      }

      const nextSettingsState = await desktopApi.completeOnboarding(
        preferredSourcePath
          ? { preferredCanonicalSourcePath: preferredSourcePath }
          : {},
      );
      const nextInventorySnapshot = await desktopApi.scanInventory();

      setSettingsState(nextSettingsState);
      setIsPreviewingOnboarding(false);
      applyInventorySnapshot(nextInventorySnapshot);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to complete onboarding.';
      setOnboardingErrorMessage(message);
      setErrorMessage(message);
    } finally {
      setIsCompletingOnboarding(false);
    }
  }, [applyInventorySnapshot, desktopApi, devApi, shellState?.devTools]);

  const openOnboardingFromDevelopment = useCallback(() => {
    setOnboardingErrorMessage(null);
    setIsPreviewingOnboarding(true);
  }, []);

  const isInventoryRefreshActive = isRescanning;
  const isRescanActionBusy = isRescanning || isTestingMcpConnectivity;
  if (!hasLoadedStartupState) {
    return <StartupScreen appName={APP_NAME} />;
  }

  const shouldShowOnboarding = isPreviewingOnboarding || settingsState.onboardingCompletedAt === null;

  let mainContent: ReactElement;
  switch (activeTab) {
    case 'home':
      mainContent = (
        <HomeDashboard
          autoResolvableRequests={autoResolvableRequests}
          errorMessage={errorMessage}
          homeSummary={homeSummary}
          inventorySnapshot={inventorySnapshot}
          isAutoResolving={isAutoResolving}
          isRescanning={isRescanActionBusy}
          onAutoResolve={() => { void handleAutoResolve(); }}
          onNavigateToSkills={navigateToSkills}
          onSelectMcp={openMcpFromHome}
          onRescan={triggerManualRescan}
          onSelectSkill={openSkillFromHome}
        />
      );
      break;
    case 'skills':
      mainContent = (
        <SkillsWorkspaceView
          isAddingSkill={isAddingSkill}
          errorMessage={errorMessage}
          inventorySnapshot={inventorySnapshot}
          isDismissingDrift={isDismissingDrift}
          isResolvingIssue={isResolvingIssue}
          isApplyingCapabilityAction={isApplyingCapabilityAction}
          isRescanning={isRescanActionBusy}
          onAddSkill={handleAddSkill}
          onDismissDrift={handleDismissDrift}
          onResolveIssue={handleResolveIssue}
          onApplyCapabilityAction={handleCapabilityAction}
          onOpenPluginSource={openPluginFromProvenance}
          onRescan={triggerManualRescan}
          rows={skillRows}
          searchInputRef={skillSearchInputRef}
          searchQuery={skillSearchQuery}
          selectedSkill={selectedSkill}
          selectedSkillInspectorModel={selectedSkillInspectorModel}
          selectedSkillProblemKey={selectedSkillProblemKey}
          sandboxRoot={shellState?.devTools?.sandboxRoot ?? null}
          onClearSelection={resetSkillSelection}
          setSearchQuery={setSkillSearchQuery}
          setSelectedSkillProblemKey={setSelectedSkillProblemKey}
          setSelectedSkillName={setSelectedSkillName}
          setSelectedSkillVariantPath={setSelectedSkillVariantPath}
          setSelectionOverrideSkillName={setSelectionOverrideSkillName}
          setStatusFilter={setSkillStatusFilter}
          sourceIndex={sourceIndex}
          statusFilter={skillStatusFilter}
        />
      );
      break;
    case 'mcps':
      mainContent = (
        <McpWorkspaceView
          errorMessage={errorMessage}
          inventorySnapshot={inventorySnapshot}
          isAddingMcpServer={isAddingMcpServer}
          isDismissingDrift={isDismissingDrift}
          isResolvingIssue={isResolvingIssue}
          isRescanning={isRescanActionBusy}
          mcp={selectedMcp}
          mcpInspectorModel={selectedMcpInspectorModel}
          sandboxRoot={shellState?.devTools?.sandboxRoot ?? null}
          onAddMcpServer={handleAddMcpServer}
          onClearSelection={resetMcpSelection}
          onDismissDrift={handleDismissDrift}
          onResolveIssue={handleResolveIssue}
          onRescan={triggerManualRescan}
          onSearchQueryChange={setMcpSearchQuery}
          onSelectMcp={setSelectedMcpName}
          onSelectProblem={setSelectedMcpProblemKey}
          onSelectVariant={setSelectedMcpVariantPath}
          onStatusFilterChange={setMcpStatusFilter}
          rows={mcpRows}
          searchInputRef={mcpSearchInputRef}
          searchQuery={mcpSearchQuery}
          statusFilter={mcpStatusFilter}
        />
      );
      break;
    case 'agents':
      mainContent = (
        <AgentsWorkspaceView
          errorMessage={errorMessage}
          inventorySnapshot={inventorySnapshot}
          isRescanning={isRescanActionBusy}
          onRescan={triggerManualRescan}
          onSearchQueryChange={setAgentSearchQuery}
          rows={agentRows}
          searchInputRef={agentSearchInputRef}
          searchQuery={agentSearchQuery}
        />
      );
      break;
    case 'plugins':
      mainContent = (
        <PluginsWorkspaceView
          errorMessage={errorMessage}
          inventorySnapshot={inventorySnapshot}
          isRescanning={isRescanActionBusy}
          onRescan={triggerManualRescan}
          onSearchQueryChange={setPluginSearchQuery}
          onSelectMcpAsset={openMcpFromHome}
          onSelectPlugin={(plugin) => {
            setSelectedPluginKey(getPluginSelectionKey(plugin));
          }}
          onSelectSkillAsset={openSkillFromHome}
          onClearSelection={() => {
            setSelectedPluginKey(null);
          }}
          rows={pluginRows}
          selectedPlugin={selectedPlugin}
          selectedPluginKey={selectedPluginKey}
          sandboxRoot={shellState?.devTools?.sandboxRoot ?? null}
          searchInputRef={pluginSearchInputRef}
          searchQuery={pluginSearchQuery}
        />
      );
      break;
    case 'audit':
      mainContent = (
        <AuditWorkspaceView
          auditOperations={auditOperations}
          isRescanning={isRescanActionBusy}
          isUndoingOperation={isUndoingToastOperation}
          onUndoOperation={(operationId) => {
            void handleUndoToastOperation(operationId);
          }}
          onRescan={triggerManualRescan}
          searchInputRef={auditSearchInputRef}
          searchQuery={auditSearchQuery}
          setSearchQuery={setAuditSearchQuery}
        />
      );
      break;
    case 'settings':
      mainContent = (
        <SettingsWorkspaceView
          customScanPathInput={customScanPathInput}
          errorMessage={errorMessage}
          handleAddCustomScanPath={handleAddCustomScanPath}
          handleClearPreferredCanonicalSourcePath={handleClearPreferredCanonicalSourcePath}
          inventorySourceMode={inventorySourceMode}
          isSwitchingInventorySource={isInventoryRefreshActive}
          handleInventorySourceModeChange={handleInventorySourceModeChange}
          handleRemoveCustomScanPath={handleRemoveCustomScanPath}
          handleSetDevSidebarInventorySourceSwitcherVisible={handleSetDevSidebarInventorySourceSwitcherVisible}
          handleSetPreferredCanonicalSourcePath={handleSetPreferredCanonicalSourcePath}
          handleSetPreferredCanonicalSourcePathValue={handleSetPreferredCanonicalSourcePathValue}
          handleSeedRepresentativeFixtures={handleSeedRepresentativeFixtures}
          devToolsEnabled={shellState?.devTools?.sandboxEnabled === true && Boolean(devApi)}
          isRescanning={isRescanActionBusy}
          isSeedingFixtures={isSeedingFixtures}
          isUpdatingSettings={isUpdatingSettings}
          inventorySnapshot={inventorySnapshot}
          onOpenOnboarding={openOnboardingFromDevelopment}
          onRescan={triggerManualRescan}
          pendingInventoryOperation={pendingInventoryOperation}
          preferredCanonicalSourcePathInput={preferredCanonicalSourcePathInput}
          settingsState={settingsState}
          setCustomScanPathInput={setCustomScanPathInput}
          setPreferredCanonicalSourcePathInput={setPreferredCanonicalSourcePathInput}
          shellState={shellState}
        />
      );
      break;
  }

  if (shouldShowOnboarding) {
    return (
      <OnboardingFlow
        errorMessage={onboardingErrorMessage}
        isCompleting={isCompletingOnboarding}
        universalSkillsPath={CANONICAL_USER_SKILLS_DISPLAY_PATH}
        onChoosePreferredSource={chooseOnboardingPreferredSource}
        onComplete={completeOnboarding}
      />
    );
  }

  return (
    <div className="app-frame">
      <header className="window-chrome">
        <div className="window-title">{shellState?.appName ?? APP_NAME}</div>
      </header>

      <div className="app-shell">
        <AppSidebar
          activeTab={activeTab}
          appName={shellState?.appName ?? APP_NAME}
          devInventorySource={
            shellState?.devTools?.sandboxEnabled === true
              && devApi
              && settingsState.showDevSidebarInventorySourceSwitcher
              ? {
                  isBusy: isInventoryRefreshActive,
                  mode: inventorySourceMode,
                  onChange: (mode) => {
                    void handleInventorySourceModeChange(mode);
                  },
                  pendingOperation: pendingInventoryOperation?.area === 'development' ? pendingInventoryOperation : null,
                }
              : undefined
          }
          inventorySnapshot={inventorySnapshot}
          lastScanLabel={formatLastScanLabel(inventorySnapshot?.scannedAt)}
          navItems={navItems}
          autoUpdateStatus={autoUpdateStatus}
          isInstallingUpdate={isInstallingUpdate}
          onInstallUpdate={() => {
            void handleInstallUpdate();
          }}
          onSelectTab={handleTabChange}
        />

        <div className="app-main">{mainContent}</div>
      </div>

      {appToast ? (
        <div aria-live="polite" className="app-toast-region" role="status">
          <section className={`app-toast app-toast--${appToast.tone}`} aria-label={appToast.title}>
            <div className="app-toast-icon" aria-hidden="true">
              <span>{appToast.tone === 'error' ? '!' : '✓'}</span>
            </div>
            <div className="app-toast-copy">
              <strong>{appToast.title}</strong>
              <p>{appToast.description}</p>
            </div>
            {appToast.undoOperationId ? (
              <button
                className="app-toast-action"
                disabled={isUndoingToastOperation}
                type="button"
                onClick={() => {
                  if (appToast.undoOperationId) {
                    void handleUndoToastOperation(appToast.undoOperationId);
                  }
                }}
              >
                <Undo2 className="app-toast-action-icon" aria-hidden="true" strokeWidth={2} />
                <span>{isUndoingToastOperation ? 'Undoing...' : 'Undo'}</span>
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function StartupScreen({ appName }: { appName: string }) {
  return (
    <div className="startup-stage" role="status" aria-label={`Loading ${appName}`}>
      <div className="startup-titlebar">
        <div className="traffic-light traffic-light--red" />
        <div className="traffic-light traffic-light--yellow" />
        <div className="traffic-light traffic-light--green" />
        <div className="startup-window-title">{appName}</div>
      </div>
      <div className="startup-body">
        <img className="startup-mark" src={skillIndexMark} alt="" />
        <div className="startup-copy">
          <strong>{appName}</strong>
          <span>Loading local configuration...</span>
        </div>
      </div>
    </div>
  );
}

function getNavigatedInventoryName(
  names: string[],
  currentName: string | null,
  direction: 1 | -1,
  step: number,
): string | null {
  if (names.length === 0) {
    return null;
  }

  const currentIndex = currentName ? names.indexOf(currentName) : -1;
  if (currentIndex === -1) {
    return direction === 1 ? names[0] : names[names.length - 1];
  }

  const nextIndex = Math.min(Math.max(currentIndex + direction * step, 0), names.length - 1);
  return names[nextIndex];
}

function isKeyboardEventFromEditableElement(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}
