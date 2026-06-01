import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Undo2, X } from 'lucide-react';

import {
  type AddSkillRequest,
  type AddMcpServerRequest,
  type AddSubagentRequest,
  APP_NAME,
  type AppShellState,
  type AuditOperation,
  type AutoUpdateStatus,
  type CapabilityActionRequest,
  type DismissDriftRequest,
  type InventorySourceMode,
  type McpIssueReason,
  type PluginRecord,
  type RemoveInventoryItemRequest,
  type ResolveIssueRequest,
  type SettingsState,
  type SkillInventorySnapshot,
  type SkillIssueReason,
  type SubagentIssueReason,
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
import { getAutoResolvableMcpRequests, getAutoResolvableSkillRequests, getAutoResolvableSubagentRequests } from './lib/issue-resolution';
import type { PendingInventoryOperation } from './lib/pending-inventory-operation';
import { AppSidebar } from './components/AppSidebar';
import { AddActionDropdown, type AddActionDropdownItem } from './components/ui';
import {
  buildMcpInspectorModel,
  buildSkillInspectorModel,
  buildSubagentInspectorModel,
  type InspectorProvenanceSummaryRow,
} from './lib/detail-inspector-model';
import {
  compareAgentsForTable,
  filterMcpRowsByStatus,
  filterSubagentRowsByStatus,
  filterSkillRowsByStatus,
  formatLastScanLabel,
  type McpStatusFilter,
  type SkillStatusFilter,
  type SubagentStatusFilter,
} from './lib/inventory-presentation';
import {
  filterAgentRows,
  filterMcpRows,
  filterPluginRows,
  filterSkillRows,
  filterSubagentRows,
  getHomeSummary,
  getMcpTableRows,
  getSkillTableRows,
  getSubagentTableRows,
  type PrimaryTab,
} from './inventory-view-model';
import { AgentsWorkspaceView } from './views/AgentsWorkspaceView';
import { AuditWorkspaceView } from './views/AuditWorkspaceView';
import { HomeDashboard } from './views/HomeDashboard';
import { AddServerModal, McpWorkspaceView } from './views/McpWorkspaceView';
import { OnboardingFlow } from './views/OnboardingFlow';
import { PluginsWorkspaceView } from './views/PluginsWorkspaceView';
import { SettingsWorkspaceView } from './views/SettingsWorkspaceView';
import { AddSkillModal, SkillsWorkspaceView } from './views/SkillsWorkspaceView';
import { AddSubagentModal, SubagentsWorkspaceView } from './views/SubagentsWorkspaceView';

function getAutoResolvableRequestsForSnapshot(snapshot: SkillInventorySnapshot): ResolveIssueRequest[] {
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));

  return [
    ...getAutoResolvableSkillRequests(snapshot, sourceIndex),
    ...getAutoResolvableMcpRequests(snapshot),
    ...getAutoResolvableSubagentRequests(snapshot),
  ];
}

interface OnboardingPreferredSourceSelection {
  didChangePreferredSource: boolean;
  preferredSourcePath: string | null;
}

interface PendingRemoveItem {
  label: string;
  request: RemoveInventoryItemRequest;
}

function getResolveIssueRequestKey(request: ResolveIssueRequest): string {
  return [
    request.entity,
    request.skillName ?? request.mcpName ?? request.subagentName,
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

function getErrorTrace(error: unknown): string | null {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : null;
    const message = 'message' in error && typeof error.message === 'string' ? error.message : null;
    return stack ?? message;
  }

  return typeof error === 'string' ? error : null;
}

function normalizeTraceText(trace: string): string {
  return trace
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
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
  const subagentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const agentSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pluginSearchInputRef = useRef<HTMLInputElement | null>(null);
  const auditSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [shellState, setShellState] = useState<AppShellState | null>(null);
  const [settingsState, setSettingsState] = useState<SettingsState>(() => createInitialSettingsState());
  const [hasLoadedStartupState, setHasLoadedStartupState] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] = useState<SkillInventorySnapshot | null>(initialInventorySnapshot);
  const latestInventorySnapshotRef = useRef<SkillInventorySnapshot | null>(initialInventorySnapshot);
  const mcpConnectivityRunIdRef = useRef(0);
  const [inventorySourceMode, setInventorySourceMode] = useState<InventorySourceMode>('live');
  const [activeTab, setActiveTab] = useState<PrimaryTab>('home');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [subagentSearchQuery, setSubagentSearchQuery] = useState('');
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [pluginSearchQuery, setPluginSearchQuery] = useState('');
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditOperations, setAuditOperations] = useState<AuditOperation[]>([]);
  const [selectedPluginKey, setSelectedPluginKey] = useState<string | null>(null);
  const [skillStatusFilter, setSkillStatusFilter] = useState<SkillStatusFilter>('all');
  const [mcpStatusFilter, setMcpStatusFilter] = useState<McpStatusFilter>('all');
  const [subagentStatusFilter, setSubagentStatusFilter] = useState<SubagentStatusFilter>('all');
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [selectedMcpName, setSelectedMcpName] = useState<string | null>(null);
  const [selectedSubagentName, setSelectedSubagentName] = useState<string | null>(null);
  const [customScanPathInput, setCustomScanPathInput] = useState('');
  const [preferredCanonicalSourcePathInput, setPreferredCanonicalSourcePathInput] = useState('');
  const [, setSettingsMessage] = useState<string | null>(null);
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isSeedingFixtures, setIsSeedingFixtures] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [isTestingMcpConnectivity, setIsTestingMcpConnectivity] = useState(false);
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [isAddingMcpServer, setIsAddingMcpServer] = useState(false);
  const [isAddingSubagent, setIsAddingSubagent] = useState(false);
  const [activeAddModal, setActiveAddModal] = useState<'skill' | 'mcp' | 'subagent' | null>(null);
  const [appToast, setAppToast] = useState<{
    description: string;
    id: number;
    tone: 'error' | 'success';
    title: string;
    trace?: string;
    undoOperationId?: string;
  } | null>(null);
  const [expandedToastTraceId, setExpandedToastTraceId] = useState<number | null>(null);
  const [toastTraceCopyState, setToastTraceCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [isUndoingToastOperation, setIsUndoingToastOperation] = useState(false);
  const [pendingInventoryOperation, setPendingInventoryOperation] = useState<PendingInventoryOperation | null>(null);
  const [isAutoResolving, setIsAutoResolving] = useState(false);
  const [isResolvingIssue, setIsResolvingIssue] = useState(false);
  const [isApplyingCapabilityAction, setIsApplyingCapabilityAction] = useState(false);
  const [isDismissingDrift, setIsDismissingDrift] = useState(false);
  const [isRemovingInventoryItem, setIsRemovingInventoryItem] = useState(false);
  const [pendingRemoveItem, setPendingRemoveItem] = useState<PendingRemoveItem | null>(null);
  const [, setLastScanClockTick] = useState(0);
  const [pendingDriftTransitionSkillName, setPendingDriftTransitionSkillName] = useState<string | null>(null);
  const [selectionOverrideSkillName, setSelectionOverrideSkillName] = useState<string | null>(null);
  const [selectedSkillProblemKey, setSelectedSkillProblemKey] = useState<SkillIssueReason | null>(null);
  const [selectedSkillVariantPath, setSelectedSkillVariantPath] = useState<string | null>(null);
  const [selectedMcpProblemKey, setSelectedMcpProblemKey] = useState<McpIssueReason | null>(null);
  const [selectedMcpVariantPath, setSelectedMcpVariantPath] = useState<string | null>(null);
  const [selectedSubagentProblemKey, setSelectedSubagentProblemKey] = useState<SubagentIssueReason | null>(null);
  const [selectedSubagentVariantPath, setSelectedSubagentVariantPath] = useState<string | null>(null);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<AutoUpdateStatus>({ phase: 'disabled' });
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const didRequestUpdateInstallRef = useRef(false);
  const [isPreviewingOnboarding, setIsPreviewingOnboarding] = useState(false);
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);

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
    trace?: string | null,
  ) => {
    appToastIdRef.current += 1;
    setExpandedToastTraceId(null);
    setToastTraceCopyState('idle');
    setAppToast({
      id: appToastIdRef.current,
      tone,
      title,
      description,
      trace: trace ? normalizeTraceText(trace) : undefined,
      undoOperationId: undoOperation?.undoState === 'available' ? undoOperation.id : undefined,
    });
  }, []);

  const showErrorToast = useCallback((
    title: string,
    error: unknown,
    fallbackMessage = 'Unknown preload error',
    traceOverride?: string | null,
  ): string => {
    const description = typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : fallbackMessage;
    showAppToast(title, description, null, 'error', traceOverride ?? getErrorTrace(error));
    return description;
  }, [showAppToast]);

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

    void desktopApi.testMcpConnectivity()
      .then((nextInventorySnapshot) => {
        if (runId !== mcpConnectivityRunIdRef.current) {
          return;
        }
        applyInventorySnapshot(nextInventorySnapshot);
      })
      .catch((error) => {
        if (runId !== mcpConnectivityRunIdRef.current) {
          return;
        }

        showErrorToast('MCP connectivity failed', error);
      })
      .finally(() => {
        if (runId !== mcpConnectivityRunIdRef.current) {
          return;
        }
        setIsTestingMcpConnectivity(false);
      });
  }, [applyInventorySnapshot, desktopApi, showErrorToast]);

  const cancelMcpConnectivityTest = useCallback(() => {
    mcpConnectivityRunIdRef.current += 1;
    setIsTestingMcpConnectivity(false);

    void desktopApi.cancelMcpConnectivityTest()
      .catch((error) => {
        showErrorToast('MCP connectivity cancellation failed', error);
      });
  }, [desktopApi, showErrorToast]);

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
      if (showSuccessToast) {
        showAppToast('Inventory refreshed', 'Manual rescan completed successfully.');
      }
      return true;
    } catch (error) {
      if (showSuccessToast) {
        setAppToast(null);
      }
      showErrorToast('Inventory refresh failed', error);
      return false;
    } finally {
      setIsRescanning(false);
      if (shouldManagePendingOperation) {
        setPendingInventoryOperation(null);
      }
    }
  }, [applyInventorySnapshot, desktopApi, showAppToast, showErrorToast]);

  const triggerManualRescan = useCallback(async () => {
    const didRescan = await triggerRescan({
      showSuccessToast: true,
      verifyMcpConnectivity: false,
    });

    if (didRescan && inventorySourceMode === 'live') {
      startMcpConnectivityTest();
    }
  }, [inventorySourceMode, startMcpConnectivityTest, triggerRescan]);

  useEffect(() => {
    if (!appToast) {
      return;
    }
    if (appToast.trace && expandedToastTraceId === appToast.id) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAppToast((currentToast) => (currentToast?.id === appToast.id ? null : currentToast));
    }, appToast.trace ? 8000 : 2800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [appToast, expandedToastTraceId]);

  useEffect(() => {
    if (toastTraceCopyState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToastTraceCopyState('idle');
    }, toastTraceCopyState === 'copied' ? 1800 : 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toastTraceCopyState]);

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

        showErrorToast('Startup failed', error);
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

        showErrorToast('Inventory cache failed', error);
      }

      try {
        const nextInventorySnapshot = await loadInventorySnapshot(desktopApi);

        if (!isMounted) {
          return;
        }

        applyInventorySnapshot(nextInventorySnapshot);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        showErrorToast('Inventory load failed', error);
      }
    };

    void loadStartupState();
    void hydrateInventory();

    return () => {
      isMounted = false;
    };
  }, [applyInventorySnapshot, desktopApi, devApi, showErrorToast]);

  useEffect(() => {
    return desktopApi.onInventoryUpdated((nextInventorySnapshot) => {
      applyInventorySnapshot(nextInventorySnapshot);
      setIsResolvingIssue(false);
      setIsDismissingDrift(false);
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
        showErrorToast('Settings update failed', error);
      } finally {
        setIsUpdatingSettings(false);
        setPendingInventoryOperation(null);
      }
    },
    [inventorySourceMode, showAppToastWithLatestUndo, showErrorToast, startMcpConnectivityTest, triggerRescan],
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
        showErrorToast('Settings update failed', error);
      } finally {
        setIsUpdatingSettings(false);
      }
    },
    [desktopApi, showAppToastWithLatestUndo, showErrorToast],
  );

  const handleSeedRepresentativeFixtures = useCallback(async () => {
    if (!devApi) {
      showErrorToast('Sandbox reset unavailable', 'Representative sandbox controls are only available in development.');
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
      showErrorToast('Sandbox reset failed', error);
    } finally {
      setIsSeedingFixtures(false);
      setPendingInventoryOperation(null);
    }
  }, [applyInventorySnapshot, desktopApi, devApi, showAppToastWithLatestUndo, showErrorToast]);

  const handleAddSkill = useCallback(async (request: AddSkillRequest) => {
    setIsAddingSkill(true);

    try {
      const nextInventorySnapshot = await desktopApi.addSkill(request);
      applyInventorySnapshot(nextInventorySnapshot);
      await showAppToastWithLatestUndo(
        'Skill added',
        request.sourceType === 'markdown'
          ? `${request.skillName.trim()} was added.`
          : 'The skill install completed.',
      );
    } catch (error) {
      const message = showErrorToast('Skill add failed', error);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsAddingSkill(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast]);

  const handleAddMcpServer = useCallback(async (request: AddMcpServerRequest) => {
    setIsAddingMcpServer(true);

    try {
      const nextInventorySnapshot = await desktopApi.addMcpServer(request);
      applyInventorySnapshot(nextInventorySnapshot);
      setSelectedMcpName(request.name.trim());
      await showAppToastWithLatestUndo('MCP server added', `${request.name.trim()} was added.`);
    } catch (error) {
      const message = showErrorToast('MCP server add failed', error);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsAddingMcpServer(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast]);

  const handleAddSubagent = useCallback(async (request: AddSubagentRequest) => {
    setIsAddingSubagent(true);

    try {
      const previousSnapshot = latestInventorySnapshotRef.current;
      const nextInventorySnapshot = await desktopApi.addSubagent(request);
      const addedSubagentName = getAddedSubagentName(request, previousSnapshot, nextInventorySnapshot);
      applyInventorySnapshot(nextInventorySnapshot);
      setSelectedSubagentName(addedSubagentName);
      await showAppToastWithLatestUndo('Subagent added', `${addedSubagentName} was added.`);
    } catch (error) {
      const message = showErrorToast('Subagent add failed', error);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsAddingSubagent(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast]);

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
  const allSubagentRows = useMemo(
    () => (inventorySnapshot ? getSubagentTableRows(inventorySnapshot) : []),
    [inventorySnapshot],
  );
  const subagentRows = useMemo(
    () => filterSubagentRows(filterSubagentRowsByStatus(allSubagentRows, subagentStatusFilter), subagentSearchQuery),
    [allSubagentRows, subagentSearchQuery, subagentStatusFilter],
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
  const selectedSubagent = useMemo(
    () => inventorySnapshot?.subagents?.find((subagent) => subagent.name === selectedSubagentName) ?? null,
    [inventorySnapshot?.subagents, selectedSubagentName],
  );
  const selectedSubagentInspectorModel = useMemo(
    () => selectedSubagent
      ? buildSubagentInspectorModel(selectedSubagent, {
        selectedProblemKey: selectedSubagentProblemKey,
        selectedVariantPath: selectedSubagentVariantPath,
      }, agentIndex)
      : null,
    [agentIndex, selectedSubagent, selectedSubagentProblemKey, selectedSubagentVariantPath],
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
    setSelectedSubagentProblemKey(null);
    setSelectedSubagentVariantPath(null);
  }, [selectedSubagentName]);

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

  useEffect(() => {
    if (activeTab !== 'subagents' || !selectedSubagentName) {
      return;
    }

    const subagentStillExists = inventorySnapshot?.subagents?.some((subagent) => subagent.name === selectedSubagentName) ?? false;
    if (!subagentStillExists) {
      setSelectedSubagentName(null);
    }
  }, [activeTab, inventorySnapshot?.subagents, selectedSubagentName]);

  const handleResolveIssue = useCallback(
    async (request: ResolveIssueRequest) => {
      const skillName = request.entity === 'skill' ? request.skillName : null;
      setIsResolvingIssue(true);
      setPendingDriftTransitionSkillName(skillName);

      try {
        const nextInventorySnapshot = await desktopApi.resolveIssue(request);
        applyInventorySnapshot(nextInventorySnapshot, skillName ?? undefined);
        if (request.entity === 'skill') {
          await showAppToastWithLatestUndo('Skill updated', `${request.skillName} was updated.`);
        } else if (request.entity === 'mcp') {
          await showAppToastWithLatestUndo('MCP server updated', `${request.mcpName} was updated.`);
        } else {
          await showAppToastWithLatestUndo('Subagent updated', `${request.subagentName} was updated.`);
        }
      } catch (error) {
        setPendingDriftTransitionSkillName(null);
        showErrorToast('Resolution failed', error);
      } finally {
        await waitForResolvePendingPaintWindow();
        setIsResolvingIssue(false);
      }
    },
    [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast],
  );

  const handleCapabilityAction = useCallback(async (request: CapabilityActionRequest) => {
    setIsApplyingCapabilityAction(true);

    try {
      const nextInventorySnapshot = await desktopApi.applyCapabilityAction(request);
      applyInventorySnapshot(nextInventorySnapshot);
      await showAppToastWithLatestUndo('Capability updated', `${request.skillName} metadata was updated.`);
    } catch (error) {
      showErrorToast('Capability update failed', error);
    } finally {
      setIsApplyingCapabilityAction(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast]);

  const handleDismissDrift = useCallback(
    async (request: DismissDriftRequest) => {
      const skillName = 'skillName' in request ? request.skillName ?? null : null;
      setIsDismissingDrift(true);
      setPendingDriftTransitionSkillName(skillName);
      if (skillName) {
        setSelectionOverrideSkillName(skillName);
      }

      try {
        const nextInventorySnapshot = await desktopApi.dismissDrift(request);
        applyInventorySnapshot(nextInventorySnapshot, skillName ?? undefined);
        await showAppToastWithLatestUndo(
          'Dismissal updated',
          skillName
            ? `${skillName} dismissal state changed.`
            : 'mcpName' in request
              ? `${request.mcpName} dismissal state changed.`
              : `${request.subagentName} dismissal state changed.`,
        );
      } catch (error) {
        setPendingDriftTransitionSkillName(null);
        showErrorToast('Dismissal failed', error);
      } finally {
        setIsDismissingDrift(false);
      }
    },
    [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast],
  );

  const handleRequestRemoveInventoryItem = useCallback((request: RemoveInventoryItemRequest, label: string) => {
    setPendingRemoveItem({
      label,
      request,
    });
  }, []);

  const handleConfirmRemoveInventoryItem = useCallback(async () => {
    if (!pendingRemoveItem) {
      return;
    }

    const { label, request } = pendingRemoveItem;
    setIsRemovingInventoryItem(true);

    try {
      const nextInventorySnapshot = await desktopApi.removeInventoryItem(request);
      applyInventorySnapshot(nextInventorySnapshot);
      if (request.entity === 'skill') {
        setSelectedSkillName(null);
        setSelectionOverrideSkillName(null);
        setSelectedSkillProblemKey(null);
        setSelectedSkillVariantPath(null);
      } else if (request.entity === 'mcp') {
        setSelectedMcpName(null);
        setSelectedMcpProblemKey(null);
        setSelectedMcpVariantPath(null);
      } else {
        setSelectedSubagentName(null);
        setSelectedSubagentProblemKey(null);
        setSelectedSubagentVariantPath(null);
      }
      setPendingRemoveItem(null);
      await showAppToastWithLatestUndo(
        'Item removed',
        `${label} was removed from all tracked locations.`,
      );
    } catch (error) {
      showErrorToast('Remove failed', error);
    } finally {
      setIsRemovingInventoryItem(false);
    }
  }, [
    applyInventorySnapshot,
    desktopApi,
    pendingRemoveItem,
    showAppToastWithLatestUndo,
    showErrorToast,
  ]);

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
      showErrorToast('Repairs failed', error);
    } finally {
      setIsAutoResolving(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToastWithLatestUndo, showErrorToast]);

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

  const resetSubagentSelection = useCallback(() => {
    setSelectedSubagentName(null);
    setSelectedSubagentProblemKey(null);
    setSelectedSubagentVariantPath(null);
  }, []);

  const handleUndoToastOperation = useCallback(async (operationId: string) => {
    setIsUndoingToastOperation(true);

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
        showAppToast('Undo blocked', 'The last change could not be undone because the current state has changed.', null, 'error');
      } else {
        showAppToast('Undo applied', 'The last change was undone.');
      }
    } catch (error) {
      showErrorToast('Undo blocked', error, 'The last change could not be undone.');
    } finally {
      setIsUndoingToastOperation(false);
    }
  }, [applyInventorySnapshot, desktopApi, showAppToast, showErrorToast]);

  const openPluginFromProvenance = useCallback((
    action: NonNullable<InspectorProvenanceSummaryRow['action']>,
  ) => {
    const plugin = (inventorySnapshot?.plugins ?? []).find((candidate) =>
      candidate.host === action.host
      && candidate.pluginId === action.pluginId
      && (!action.version || candidate.version === action.version));
    if (!plugin) {
      showErrorToast('Plugin not found', `Could not find plugin ${action.pluginId} in the current inventory.`);
      return;
    }

    setPluginSearchQuery('');
    setSelectedPluginKey(getPluginSelectionKey(plugin));
    resetSkillSelection();
    resetMcpSelection();
    resetSubagentSelection();
    setActiveTab('plugins');
  }, [inventorySnapshot?.plugins, resetMcpSelection, resetSkillSelection, resetSubagentSelection, showErrorToast]);

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
    resetSkillSelection();
    resetMcpSelection();
    resetSubagentSelection();

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
      showErrorToast('Inventory source switch failed', error);
    } finally {
      setPendingInventoryOperation(null);
    }
  }, [desktopApi, devApi, inventorySourceMode, resetMcpSelection, resetSkillSelection, resetSubagentSelection, showErrorToast, startMcpConnectivityTest, triggerRescan]);

  const navigateToSkills = useCallback(() => {
    resetSkillSelection();
    resetMcpSelection();
    resetSubagentSelection();
    setSkillSearchQuery('');
    setSkillStatusFilter('active');
    setActiveTab('skills');
  }, [resetMcpSelection, resetSkillSelection, resetSubagentSelection]);

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

  const openSubagentFromHome = useCallback((subagentName: string) => {
    setSubagentSearchQuery('');
    setSubagentStatusFilter('all');
    setSelectedSubagentProblemKey(null);
    setSelectedSubagentVariantPath(null);
    setSelectedSubagentName(subagentName);
    setActiveTab('subagents');
  }, []);

  const focusActiveSearch = useCallback(() => {
    const activeSearchInput = activeTab === 'skills'
      ? skillSearchInputRef.current
      : activeTab === 'mcps'
        ? mcpSearchInputRef.current
        : activeTab === 'subagents'
          ? subagentSearchInputRef.current
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
        : activeTab === 'subagents'
          ? subagentSearchInputRef.current
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

    if (activeTab === 'subagents') {
      const nextSubagentName = getNavigatedInventoryName(
        subagentRows.map((subagent) => subagent.name),
        selectedSubagent?.name ?? null,
        direction,
        step,
      );
      if (!nextSubagentName) {
        return false;
      }

      setSelectedSubagentName(nextSubagentName);
      return true;
    }

    return false;
  }, [activeTab, mcpRows, selectedMcp?.name, selectedSkill?.name, selectedSubagent?.name, skillRows, subagentRows]);

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
        tab: 'subagents' as const,
        label: 'Subagents',
        icon: 'subagents' as const,
        badge: inventorySnapshot?.subagentCounts?.attentionSubagents ?? 0,
        meta: inventorySnapshot?.subagentCounts?.totalSubagents ?? 0,
        tone: 'attention' as const,
      },
      {
        tab: 'plugins' as const,
        label: 'Plugins',
        icon: 'plugins' as const,
        meta: inventorySnapshot?.plugins?.length ?? 0,
      },
    ],
    [
      inventorySnapshot?.counts.driftedSkills,
      inventorySnapshot?.counts.totalSkills,
      inventorySnapshot?.mcpCounts?.attentionMcps,
      inventorySnapshot?.mcpCounts?.totalMcps,
      inventorySnapshot?.plugins?.length,
      inventorySnapshot?.subagentCounts?.attentionSubagents,
      inventorySnapshot?.subagentCounts?.totalSubagents,
    ],
  );

  const handleTabChange = useCallback((nextTab: PrimaryTab) => {
    resetSkillSelection();
    resetMcpSelection();
    resetSubagentSelection();
    setActiveTab(nextTab);
  }, [resetMcpSelection, resetSkillSelection, resetSubagentSelection]);

  const handleInstallUpdate = useCallback(async () => {
    if (didRequestUpdateInstallRef.current) {
      return;
    }

    didRequestUpdateInstallRef.current = true;
    setIsInstallingUpdate(true);
    try {
      const nextStatus = await desktopApi.installUpdate();
      setAutoUpdateStatus(nextStatus);
    } catch (error) {
      didRequestUpdateInstallRef.current = false;
      setIsInstallingUpdate(false);
      showErrorToast('Update install failed', error, 'Failed to install update.');
    }
  }, [desktopApi, showErrorToast]);

  useEffect(() => {
    if (autoUpdateStatus.phase !== 'ready' || didRequestUpdateInstallRef.current) {
      return;
    }

    void handleInstallUpdate();
  }, [autoUpdateStatus.phase, handleInstallUpdate]);

  useEffect(() => {
    if (autoUpdateStatus.phase === 'downloading' || autoUpdateStatus.phase === 'ready') {
      return;
    }

    didRequestUpdateInstallRef.current = false;
    setIsInstallingUpdate(false);
  }, [autoUpdateStatus.phase]);

  const chooseOnboardingPreferredSource = useCallback(async () => {
    try {
      return await desktopApi.chooseDirectory({
        title: 'Choose a preferred skills source',
      });
    } catch (error) {
      showErrorToast('Folder picker failed', error, 'Failed to open the folder picker.');
      return null;
    }
  }, [desktopApi, showErrorToast]);

  const readLatestFailedAuditTrace = useCallback(async () => {
    try {
      const latestOperations = await desktopApi.readAuditLog({ limit: 1 });
      return latestOperations.find((operation) => operation.status === 'failed' && operation.failure?.trace)
        ?.failure?.trace ?? null;
    } catch {
      return null;
    }
  }, [desktopApi]);

  const completeOnboarding = useCallback(async ({
    didChangePreferredSource,
    preferredSourcePath,
  }: OnboardingPreferredSourceSelection) => {
    setIsCompletingOnboarding(true);
    let failureTrace: string | null = null;

    try {
      if (shellState?.devTools && devApi) {
        await devApi.setInventoryMode(shellState.devTools.inventoryMode);
      }

      if (didChangePreferredSource) {
        if (preferredSourcePath) {
          await desktopApi.setPreferredCanonicalSourcePath(preferredSourcePath);
        } else {
          await desktopApi.clearPreferredCanonicalSourcePath();
        }
      }
      let nextInventorySnapshot: SkillInventorySnapshot;
      try {
        nextInventorySnapshot = await desktopApi.rescanInventory();
      } catch (scanError) {
        failureTrace = await readLatestFailedAuditTrace() ?? getErrorTrace(scanError);
        throw scanError;
      }
      const nextSettingsState = await desktopApi.completeOnboarding({});

      setSettingsState(nextSettingsState);
      setIsPreviewingOnboarding(false);
      applyInventorySnapshot(nextInventorySnapshot);
    } catch (error) {
      showErrorToast('Onboarding failed', error, 'Failed to complete onboarding.', failureTrace);
    } finally {
      setIsCompletingOnboarding(false);
    }
  }, [applyInventorySnapshot, desktopApi, devApi, readLatestFailedAuditTrace, shellState?.devTools, showErrorToast]);

  const openOnboardingFromDevelopment = useCallback(() => {
    setAppToast(null);
    setIsPreviewingOnboarding(true);
  }, []);

  const isInventoryRefreshActive = isRescanning;
  const isRescanActionBusy = isRescanning || isTestingMcpConnectivity;
  const onCancelMcpConnectivityTest = isTestingMcpConnectivity ? cancelMcpConnectivityTest : undefined;
  const addActionItems = useMemo<AddActionDropdownItem[]>(() => [
    {
      id: 'skill',
      label: 'Skill',
      onSelect: () => setActiveAddModal('skill'),
    },
    {
      id: 'mcp',
      label: 'MCP',
      onSelect: () => setActiveAddModal('mcp'),
    },
    {
      id: 'subagent',
      label: 'Subagent',
      onSelect: () => setActiveAddModal('subagent'),
    },
  ], []);
  const renderAddActionControl = useCallback((defaultItemId?: 'skill' | 'mcp' | 'subagent') => (
    <AddActionDropdown defaultItemId={defaultItemId} items={addActionItems} />
  ), [addActionItems]);

  if (!hasLoadedStartupState) {
    return <StartupScreen appName={APP_NAME} />;
  }

  const shouldShowOnboarding = isPreviewingOnboarding || settingsState.onboardingCompletedAt === null;

  let mainContent: ReactElement;
  switch (activeTab) {
    case 'home':
      mainContent = (
        <HomeDashboard
          addActionControl={renderAddActionControl()}
          autoResolvableRequests={autoResolvableRequests}
          homeSummary={homeSummary}
          inventorySnapshot={inventorySnapshot}
          isAutoResolving={isAutoResolving}
          isRescanning={isRescanActionBusy}
          onAutoResolve={() => { void handleAutoResolve(); }}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
          onNavigateToSkills={navigateToSkills}
          onSelectMcp={openMcpFromHome}
          onRescan={triggerManualRescan}
          onSelectSkill={openSkillFromHome}
          onSelectSubagent={openSubagentFromHome}
        />
      );
      break;
    case 'skills':
      mainContent = (
        <SkillsWorkspaceView
          addActionControl={renderAddActionControl('skill')}
          inventorySnapshot={inventorySnapshot}
          isDismissingDrift={isDismissingDrift}
          isResolvingIssue={isResolvingIssue}
          isRemovingInventoryItem={isRemovingInventoryItem}
          isApplyingCapabilityAction={isApplyingCapabilityAction}
          isRescanning={isRescanActionBusy}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
          onDismissDrift={handleDismissDrift}
          onResolveIssue={handleResolveIssue}
          onApplyCapabilityAction={handleCapabilityAction}
          onOpenPluginSource={openPluginFromProvenance}
          onRequestRemove={handleRequestRemoveInventoryItem}
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
          addActionControl={renderAddActionControl('mcp')}
          inventorySnapshot={inventorySnapshot}
          isDismissingDrift={isDismissingDrift}
          isResolvingIssue={isResolvingIssue}
          isRemovingInventoryItem={isRemovingInventoryItem}
          isRescanning={isRescanActionBusy}
          mcp={selectedMcp}
          mcpInspectorModel={selectedMcpInspectorModel}
          sandboxRoot={shellState?.devTools?.sandboxRoot ?? null}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
          onClearSelection={resetMcpSelection}
          onDismissDrift={handleDismissDrift}
          onOpenPluginSource={openPluginFromProvenance}
          onRequestRemove={handleRequestRemoveInventoryItem}
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
    case 'subagents':
      mainContent = (
        <SubagentsWorkspaceView
          addActionControl={renderAddActionControl('subagent')}
          inventorySnapshot={inventorySnapshot}
          isDismissingDrift={isDismissingDrift}
          isResolvingIssue={isResolvingIssue}
          isRemovingInventoryItem={isRemovingInventoryItem}
          isRescanning={isRescanActionBusy}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
          onClearSelection={resetSubagentSelection}
          onDismissDrift={handleDismissDrift}
          onOpenPluginSource={openPluginFromProvenance}
          onRequestRemove={handleRequestRemoveInventoryItem}
          onResolveIssue={handleResolveIssue}
          onRescan={triggerManualRescan}
          onSearchQueryChange={setSubagentSearchQuery}
          onSelectProblem={setSelectedSubagentProblemKey}
          onSelectSubagent={setSelectedSubagentName}
          onSelectVariant={setSelectedSubagentVariantPath}
          onStatusFilterChange={setSubagentStatusFilter}
          rows={subagentRows}
          sandboxRoot={shellState?.devTools?.sandboxRoot ?? null}
          searchInputRef={subagentSearchInputRef}
          searchQuery={subagentSearchQuery}
          selectedSubagent={selectedSubagent}
          selectedSubagentInspectorModel={selectedSubagentInspectorModel}
          selectedSubagentProblemKey={selectedSubagentProblemKey}
          statusFilter={subagentStatusFilter}
        />
      );
      break;
    case 'agents':
      mainContent = (
        <AgentsWorkspaceView
          addActionControl={renderAddActionControl()}
          inventorySnapshot={inventorySnapshot}
          isRescanning={isRescanActionBusy}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
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
          addActionControl={renderAddActionControl()}
          inventorySnapshot={inventorySnapshot}
          isRescanning={isRescanActionBusy}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
          onRescan={triggerManualRescan}
          onSearchQueryChange={setPluginSearchQuery}
          onSelectMcpAsset={openMcpFromHome}
          onSelectPlugin={(plugin) => {
            setSelectedPluginKey(getPluginSelectionKey(plugin));
          }}
          onSelectSkillAsset={openSkillFromHome}
          onSelectSubagentAsset={openSubagentFromHome}
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
          addActionControl={renderAddActionControl()}
          auditOperations={auditOperations}
          isRescanning={isRescanActionBusy}
          isUndoingOperation={isUndoingToastOperation}
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
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
          addActionControl={renderAddActionControl()}
          customScanPathInput={customScanPathInput}
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
          onCancelMcpConnectivityTest={onCancelMcpConnectivityTest}
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

  const appToastTrace = appToast?.trace && appToast.trace !== appToast.description ? appToast.trace : null;
  const appToastTraceElementId = appToast ? `app-toast-trace-${appToast.id}` : undefined;
  const isAppToastTraceExpanded = Boolean(appToast && expandedToastTraceId === appToast.id);
  const copyAppToastTrace = (trace: string) => {
    if (!navigator.clipboard?.writeText) {
      setToastTraceCopyState('failed');
      return;
    }

    void navigator.clipboard.writeText(trace)
      .then(() => setToastTraceCopyState('copied'))
      .catch(() => setToastTraceCopyState('failed'));
  };

  const appToastRegion = appToast ? (
    <div aria-live="polite" className="app-toast-region" role="status">
      <section className={`app-toast app-toast--${appToast.tone}`} aria-label={appToast.title}>
        <div className="app-toast-icon" aria-hidden="true">
          <span>{appToast.tone === 'error' ? '!' : '✓'}</span>
        </div>
        <div className="app-toast-copy">
          <strong>{appToast.title}</strong>
          <p>{appToast.description}</p>
          {appToastTrace && appToastTraceElementId ? (
            <div className="app-toast-trace-actions">
              <button
                aria-expanded={isAppToastTraceExpanded}
                aria-label={isAppToastTraceExpanded ? 'Hide failure trace' : 'Show failure trace'}
                aria-controls={appToastTraceElementId}
                className="app-toast-trace-button"
                title={isAppToastTraceExpanded ? 'Hide failure trace' : 'Show failure trace'}
                type="button"
                onClick={() => {
                  setExpandedToastTraceId(isAppToastTraceExpanded ? null : appToast.id);
                }}
              >
                {isAppToastTraceExpanded
                  ? <ChevronUp aria-hidden="true" size={13} />
                  : <ChevronDown aria-hidden="true" size={13} />}
                <span>{isAppToastTraceExpanded ? 'Hide trace' : 'Show trace'}</span>
              </button>
              <button
                aria-label={toastTraceCopyState === 'copied'
                  ? 'Failure trace copied'
                  : toastTraceCopyState === 'failed'
                    ? 'Copy failure trace failed'
                    : 'Copy failure trace'}
                className={[
                  'audit-copy-trace-button',
                  'app-toast-copy-trace-button',
                  toastTraceCopyState === 'copied' ? 'audit-copy-trace-button--copied' : '',
                  toastTraceCopyState === 'failed' ? 'audit-copy-trace-button--failed' : '',
                ].filter(Boolean).join(' ')}
                title="Copy failure trace"
                type="button"
                onClick={() => copyAppToastTrace(appToastTrace)}
              >
                <span className="audit-copy-trace-button__icon" aria-hidden="true">
                  <Copy className="audit-copy-trace-button__glyph audit-copy-trace-button__glyph--copy" strokeWidth={2} />
                  <Check className="audit-copy-trace-button__glyph audit-copy-trace-button__glyph--check" strokeWidth={2.3} />
                </span>
                <span>{toastTraceCopyState === 'failed' ? 'Copy failed' : 'Copy trace'}</span>
              </button>
            </div>
          ) : null}
          {appToastTrace && appToastTraceElementId && isAppToastTraceExpanded ? (
            <pre className="app-toast-trace" id={appToastTraceElementId}>{appToastTrace}</pre>
          ) : null}
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
  ) : null;
  const addModalElement = activeAddModal === 'skill' ? (
    <AddSkillModal
      isSubmitting={isAddingSkill}
      onClose={() => {
        if (!isAddingSkill) {
          setActiveAddModal(null);
        }
      }}
      onSubmit={async (request) => {
        await handleAddSkill(request);
        setActiveAddModal(null);
      }}
    />
  ) : activeAddModal === 'mcp' ? (
    <AddServerModal
      isSubmitting={isAddingMcpServer}
      onClose={() => {
        if (!isAddingMcpServer) {
          setActiveAddModal(null);
        }
      }}
      onSubmit={async (request) => {
        await handleAddMcpServer(request);
        setActiveAddModal(null);
      }}
    />
  ) : activeAddModal === 'subagent' ? (
    <AddSubagentModal
      isSubmitting={isAddingSubagent}
      onClose={() => {
        if (!isAddingSubagent) {
          setActiveAddModal(null);
        }
      }}
      onSubmit={async (request) => {
        await handleAddSubagent(request);
        setActiveAddModal(null);
      }}
    />
  ) : null;

  const removeItemDialog = pendingRemoveItem ? (
    <RemoveItemDialog
      isRemoving={isRemovingInventoryItem}
      item={pendingRemoveItem}
      onCancel={() => {
        if (!isRemovingInventoryItem) {
          setPendingRemoveItem(null);
        }
      }}
      onConfirm={() => {
        void handleConfirmRemoveInventoryItem();
      }}
    />
  ) : null;

  if (shouldShowOnboarding) {
    return (
      <>
        <OnboardingFlow
          isCompleting={isCompletingOnboarding}
          universalSkillsPath={CANONICAL_USER_SKILLS_DISPLAY_PATH}
          onChoosePreferredSource={chooseOnboardingPreferredSource}
          onComplete={completeOnboarding}
        />
        <AutoUpdateDialog
          appName={shellState?.appName ?? APP_NAME}
          isInstallingUpdate={isInstallingUpdate}
          status={autoUpdateStatus}
        />
        {appToastRegion}
        {removeItemDialog}
      </>
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

      {addModalElement}
      {appToastRegion}
      {removeItemDialog}

      <AutoUpdateDialog
        appName={shellState?.appName ?? APP_NAME}
        isInstallingUpdate={isInstallingUpdate}
        status={autoUpdateStatus}
      />
    </div>
  );
}

function RemoveItemDialog({
  isRemoving,
  item,
  onCancel,
  onConfirm,
}: {
  isRemoving: boolean;
  item: PendingRemoveItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const itemKind = formatRemoveItemKind(item.request);
  const title = `Remove ${itemKind}`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isRemoving) {
        return;
      }

      event.preventDefault();
      onCancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRemoving, onCancel]);

  return (
    <div className="remove-item-dialog-root" role="presentation">
      <div className="remove-item-dialog-backdrop" />
      <section aria-label={title} aria-modal="true" className="remove-item-dialog" role="dialog">
        <div className="remove-item-dialog__header">
          <div>
            <h3>{title}</h3>
          </div>
          <button
            aria-label="Close remove dialog"
            className="remove-item-dialog__close"
            disabled={isRemoving}
            type="button"
            onClick={onCancel}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="remove-item-dialog__body">
          <p>
            <strong>{item.label}</strong>
            {' will be removed from every location Skill Index currently tracks.'}
          </p>
          <p>
            {getRemoveItemRecoveryCopy(item.request)}
          </p>
        </div>
        <div className="remove-item-dialog__actions">
          <button
            className="remove-item-dialog__button remove-item-dialog__button--secondary"
            disabled={isRemoving}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="remove-item-dialog__button remove-item-dialog__button--danger"
            disabled={isRemoving}
            type="button"
            onClick={onConfirm}
          >
            {isRemoving ? 'Removing...' : 'Yes, remove'}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatRemoveItemKind(request: RemoveInventoryItemRequest): string {
  switch (request.entity) {
    case 'skill':
      return 'skill';
    case 'mcp':
      return 'MCP';
    case 'subagent':
      return 'subagent';
  }
}

function getRemoveItemRecoveryCopy(request: RemoveInventoryItemRequest): string {
  if (request.entity === 'mcp') {
    return 'MCP config entries are removed from their config files. There are no files to move to Trash.';
  }

  return 'Files are moved to Trash so you can recover them from Finder. This can affect every agent using it.';
}

function AutoUpdateDialog({
  appName,
  isInstallingUpdate,
  status,
}: {
  appName: string;
  isInstallingUpdate: boolean;
  status: AutoUpdateStatus;
}) {
  if (status.phase !== 'downloading' && status.phase !== 'ready' && !isInstallingUpdate) {
    return null;
  }

  const isRelaunching = status.phase === 'ready' || isInstallingUpdate;
  const progressPercent = getUpdateDownloadPercent(status);
  const visualProgressPercent = isRelaunching ? 100 : progressPercent ?? 22;
  const sizeLabel = getUpdateDownloadSizeLabel(status);
  const progressValue = progressPercent === null ? undefined : Math.round(progressPercent);

  return (
    <div className="auto-update-dialog-root">
      <section
        aria-labelledby="auto-update-dialog-title"
        aria-modal="true"
        className="auto-update-dialog"
        role="dialog"
      >
        <header className="auto-update-dialog__titlebar">
          <h2 id="auto-update-dialog-title">Updating {appName}</h2>
        </header>
        <div className="auto-update-dialog__body">
          <div className="auto-update-dialog__mark" aria-hidden="true">
            <img src={skillIndexMark} alt="" />
          </div>
          <div className="auto-update-dialog__content">
            <h3>{isRelaunching ? `Relaunching ${appName}...` : 'Downloading update...'}</h3>
            <div
              aria-label="Update download progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressValue}
              aria-valuetext={sizeLabel ?? (progressValue === undefined ? 'Preparing download' : `${progressValue}% downloaded`)}
              className={`auto-update-dialog__progress${progressPercent === null && !isRelaunching ? ' auto-update-dialog__progress--indeterminate' : ''}`}
              role="progressbar"
            >
              <div style={{ width: `${visualProgressPercent}%` }} />
            </div>
            <strong className="auto-update-dialog__bytes">
              {isRelaunching ? 'Download complete' : sizeLabel ?? 'Preparing download...'}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function getUpdateDownloadPercent(status: AutoUpdateStatus): number | null {
  const percent = status.downloadProgress?.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return null;
  }

  return Math.min(Math.max(percent, 0), 100);
}

function getUpdateDownloadSizeLabel(status: AutoUpdateStatus): string | null {
  const transferredBytes = status.downloadProgress?.transferredBytes;
  const totalBytes = status.downloadProgress?.totalBytes;

  if (typeof transferredBytes === 'number' && Number.isFinite(transferredBytes)
    && typeof totalBytes === 'number' && Number.isFinite(totalBytes)) {
    return `${formatMegabytes(transferredBytes)} of ${formatMegabytes(totalBytes)}`;
  }

  if (typeof transferredBytes === 'number' && Number.isFinite(transferredBytes)) {
    return `${formatMegabytes(transferredBytes)} downloaded`;
  }

  if (typeof totalBytes === 'number' && Number.isFinite(totalBytes)) {
    return `${formatMegabytes(totalBytes)} update`;
  }

  return null;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function getAddedSubagentName(
  request: AddSubagentRequest,
  previousSnapshot: SkillInventorySnapshot | null,
  nextInventorySnapshot: SkillInventorySnapshot,
): string {
  const requestedName = request.name.trim();
  const previousNames = new Set(previousSnapshot?.subagents?.map((subagent) => subagent.name) ?? []);
  const addedSubagent = nextInventorySnapshot.subagents?.find((subagent) => !previousNames.has(subagent.name));
  if (addedSubagent) {
    return addedSubagent.name;
  }

  if (nextInventorySnapshot.subagents?.some((subagent) => subagent.name === requestedName)) {
    return requestedName;
  }

  return requestedName;
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
