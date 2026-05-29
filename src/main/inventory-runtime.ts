import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { addSkill as addSkillToInventory } from '@main/add-skill';
import { createAuditLogService, type AuditOperationRequest } from '@main/audit-log';
import { applyCapabilityAction as applyCapabilityActionToInventory } from '@main/capability-actions';
import {
  dismissSkillDrift,
  readCachedSkillInventory,
  reconcileWatchedSkillInventoryEvent,
  scanSkillInventory,
  writeSkillInventorySnapshotCache,
  type ScanSkillInventoryOptions,
} from '@main/skill-inventory';
import { addMcpServer as addMcpServerToInventory, resolveInventoryIssue } from '@main/issue-resolution';
import type {
  AddMcpServerRequest,
  AddSkillRequest,
  AuditOperation,
  CapabilityActionRequest,
  DismissDriftRequest,
  ResolveIssueRequest,
  SkillInventorySnapshot,
  SkillRecord,
  SkillScanSource,
  UndoAuditOperationResult,
} from '@shared/contracts';
import { resolveSkillIndexPathsForScanOptions, type SkillIndexPaths } from '@shared/skill-index-paths';
import { createStartupObservationAid, type StartupObservationAid } from '@main/startup-observation';

interface ClosableWatcher {
  close(): void;
}

type InventoryUpdateListener = (snapshot: SkillInventorySnapshot) => void;
type AuditUpdateListener = (operations: AuditOperation[]) => void;

interface WatchedSourceChange {
  source: SkillScanSource;
  filePath?: string;
}

interface QueuedFullRefreshWaiter {
  resolve(snapshot: SkillInventorySnapshot): void;
  reject(error: unknown): void;
}

interface WatchSourceEvent {
  filePath?: string;
}

type InventoryRescanAuditTrigger = 'manual' | 'watch';

type WatchSource = (source: SkillScanSource, onChange: (event: WatchSourceEvent) => void) => ClosableWatcher;

interface CreateInventoryRuntimeOptions {
  watchDebounceMs?: number;
  watchSource?: WatchSource;
  startupObservationAid?: StartupObservationAid;
  verifyMcpConnectivityOnFullScan?: boolean;
}

export interface InventoryRuntime {
  readCachedInventory(options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot | null>;
  scanInventory(options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot>;
  rescanInventory(options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot>;
  testMcpConnectivity(options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot>;
  cancelMcpConnectivityTest(): void;
  addSkill(request: AddSkillRequest, options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot>;
  addMcpServer(request: AddMcpServerRequest, options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot>;
  resolveIssue(request: ResolveIssueRequest): Promise<SkillInventorySnapshot>;
  applyCapabilityAction(request: CapabilityActionRequest, options?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot>;
  dismissDrift(request: DismissDriftRequest): Promise<SkillInventorySnapshot>;
  readAuditLog(options?: { limit?: number }, scanOptions?: ScanSkillInventoryOptions): Promise<AuditOperation[]>;
  undoAuditOperation(operationId: string): Promise<UndoAuditOperationResult>;
  releaseStartupObservation(): void;
  onDidUpdate(listener: InventoryUpdateListener): () => void;
  onDidAuditUpdate(listener: AuditUpdateListener): () => void;
  dispose(): void;
}

export function createInventoryRuntime(options: CreateInventoryRuntimeOptions = {}): InventoryRuntime {
  const subscribers = new Set<InventoryUpdateListener>();
  const auditSubscribers = new Set<AuditUpdateListener>();
  const auditServicesByLogFile = new Map<string, ReturnType<typeof createAuditLogService>>();
  const watcherBySourceId = new Map<string, ClosableWatcher>();
  const watchSource = options.watchSource ?? defaultWatchSource;
  const watchDebounceMs = options.watchDebounceMs ?? 75;
  const startupObservationAid = options.startupObservationAid ?? createStartupObservationAid();
  const verifyMcpConnectivityOnFullScan = options.verifyMcpConnectivityOnFullScan ?? false;

  let lastScanOptions: ScanSkillInventoryOptions = {};
  let currentSnapshot: SkillInventorySnapshot | null = null;
  let queuedFullRefresh = false;
  let queuedVerifyMcpConnectivity: ScanSkillInventoryOptions['verifyMcpConnectivity'] | undefined;
  const queuedFullRefreshWaiters: QueuedFullRefreshWaiter[] = [];
  const queuedWatchEvents: WatchedSourceChange[] = [];
  const pendingWatchEvents: WatchedSourceChange[] = [];
  let refreshInFlight: Promise<SkillInventorySnapshot> | null = null;
  let committedSnapshotRevision = 0;
  let watchRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let mcpConnectivityRunId = 0;
  let activeMcpConnectivityAbortController: AbortController | null = null;

  const emit = (snapshot: SkillInventorySnapshot) => {
    for (const subscriber of subscribers) {
      subscriber(snapshot);
    }
  };

  const resolveAuditPaths = (scanOptions: ScanSkillInventoryOptions = lastScanOptions): SkillIndexPaths => {
    return resolveSkillIndexPathsForScanOptions(scanOptions);
  };

  const getAuditService = (scanOptions: ScanSkillInventoryOptions = lastScanOptions) => {
    const paths = resolveAuditPaths(scanOptions);
    const existingService = auditServicesByLogFile.get(paths.auditLogFile);
    if (existingService) {
      return existingService;
    }

    const service = createAuditLogService({ paths });
    auditServicesByLogFile.set(paths.auditLogFile, service);
    return service;
  };

  const emitAudit = async (scanOptions: ScanSkillInventoryOptions = lastScanOptions) => {
    const operations = await getAuditService(scanOptions).readOperations();
    for (const subscriber of auditSubscribers) {
      subscriber(operations);
    }
    return operations;
  };

  const auditFailedInventoryRescan = async (
    error: unknown,
    scanOptions: ScanSkillInventoryOptions,
    trigger: InventoryRescanAuditTrigger,
  ) => {
    const isManual = trigger === 'manual';
    const auditService = getAuditService(scanOptions);
    await auditService.runOperation({
      kind: 'inventory-rescan',
      title: isManual ? 'Inventory rescan failed' : 'Background inventory rescan failed',
      summary: isManual
        ? 'Manual inventory rescan failed before the latest snapshot could be saved.'
        : 'File watcher-triggered inventory rescan failed before the latest snapshot could be saved.',
      sourceMode: resolveAuditSourceMode(scanOptions),
      affectedPaths: [],
      undoable: false,
    }, () => Promise.reject(error instanceof Error ? error : new Error(String(error)))).catch(() => undefined);
    await emitAudit(scanOptions).catch(() => undefined);
  };

  const syncWatchers = (sources: SkillScanSource[]) => {
    const nextSourceIds = new Set(sources.map((source) => source.id));

    for (const [sourceId, watcher] of watcherBySourceId) {
      if (nextSourceIds.has(sourceId)) {
        continue;
      }

      watcher.close();
      watcherBySourceId.delete(sourceId);
    }

    for (const source of sources) {
      if (watcherBySourceId.has(source.id)) {
        continue;
      }

      watcherBySourceId.set(
        source.id,
        watchSource(source, (event) => {
          scheduleWatchRefresh({
            source,
            filePath: event.filePath,
          });
        }),
      );
    }
  };

  const commitSnapshot = (snapshot: SkillInventorySnapshot): SkillInventorySnapshot => {
    committedSnapshotRevision += 1;
    currentSnapshot = snapshot;
    syncWatchers(snapshot.sources);
    emit(snapshot);
    return snapshot;
  };

  const runScan = async (
    verifyMcpConnectivityOverride?: ScanSkillInventoryOptions['verifyMcpConnectivity'],
  ): Promise<SkillInventorySnapshot> => {
    const snapshot = await scanSkillInventory({
      ...lastScanOptions,
      verifyMcpConnectivity: verifyMcpConnectivityOverride ?? verifyMcpConnectivityOnFullScan,
    });
    return commitSnapshot(snapshot);
  };

  const runPassiveMcpConnectivityScan = async (optionsOverride: ScanSkillInventoryOptions = {}): Promise<SkillInventorySnapshot> => {
    const { verifyMcpConnectivity, ...persistentOptionsOverride } = optionsOverride;
    delete persistentOptionsOverride.writeCache;
    delete persistentOptionsOverride.mcpConnectivityAbortSignal;
    activeMcpConnectivityAbortController?.abort();
    const abortController = new AbortController();
    activeMcpConnectivityAbortController = abortController;
    const runId = mcpConnectivityRunId + 1;
    mcpConnectivityRunId = runId;
    const scanOptions: ScanSkillInventoryOptions = {
      ...lastScanOptions,
      ...persistentOptionsOverride,
      verifyMcpConnectivity: verifyMcpConnectivity ?? true,
      mcpConnectivityAbortSignal: abortController.signal,
      writeCache: false,
    };
    const revisionAtStart = committedSnapshotRevision;

    try {
      const snapshot = await scanSkillInventory(scanOptions);

      if (abortController.signal.aborted || runId !== mcpConnectivityRunId) {
        return currentSnapshot ?? snapshot;
      }

      if (committedSnapshotRevision !== revisionAtStart && currentSnapshot) {
        await writeSkillInventorySnapshotCache(currentSnapshot, lastScanOptions);
        return currentSnapshot;
      }

      lastScanOptions = { ...lastScanOptions, ...persistentOptionsOverride };
      commitSnapshot(snapshot);
      await writeSkillInventorySnapshotCache(snapshot, lastScanOptions);
      return snapshot;
    } finally {
      if (activeMcpConnectivityAbortController === abortController) {
        activeMcpConnectivityAbortController = null;
      }
    }
  };

  const cancelMcpConnectivityTest = () => {
    if (!activeMcpConnectivityAbortController) {
      return;
    }

    activeMcpConnectivityAbortController.abort();
    activeMcpConnectivityAbortController = null;
    mcpConnectivityRunId += 1;
  };

  const resolvePersistentRefreshOptions = (optionsOverride?: ScanSkillInventoryOptions): ScanSkillInventoryOptions => {
    const persistentOptionsOverride = { ...(optionsOverride ?? {}) };
    delete persistentOptionsOverride.verifyMcpConnectivity;
    return optionsOverride ? { ...lastScanOptions, ...persistentOptionsOverride } : { ...lastScanOptions };
  };

  const refreshInventory = async (optionsOverride?: ScanSkillInventoryOptions): Promise<SkillInventorySnapshot> => {
    // Connectivity probing is an explicit one-shot choice; keep source options sticky without making later watcher refreshes inherit probe cost.
    const verifyMcpConnectivity = optionsOverride?.verifyMcpConnectivity;
    lastScanOptions = resolvePersistentRefreshOptions(optionsOverride);

    if (refreshInFlight) {
      queuedFullRefresh = true;
      if (verifyMcpConnectivity !== undefined) {
        queuedVerifyMcpConnectivity = verifyMcpConnectivity;
      }
      return new Promise<SkillInventorySnapshot>((resolve, reject) => {
        queuedFullRefreshWaiters.push({ resolve, reject });
      });
    }

    refreshInFlight = runScan(verifyMcpConnectivity)
      .finally(() => {
        refreshInFlight = null;
        drainQueuedRefreshes();
      });

    return refreshInFlight;
  };

  const refreshFromWatchEvents = async (events: WatchedSourceChange[]): Promise<SkillInventorySnapshot> => {
    if (!currentSnapshot || events.some((event) => event.filePath === undefined)) {
      return runScan();
    }

    let nextSnapshot = currentSnapshot;
    let hasChanges = false;
    const coalescedEvents = coalesceWatchEvents(events);

    for (const event of coalescedEvents) {
      if (!event.filePath || !nextSnapshot.sources.some((source) => source.id === event.source.id)) {
        continue;
      }

      const updatedSnapshot = await reconcileWatchedSkillInventoryEvent(nextSnapshot, {
        source: event.source,
        filePath: event.filePath,
      }, lastScanOptions);

      if (updatedSnapshot !== nextSnapshot) {
        nextSnapshot = updatedSnapshot;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      commitSnapshot(nextSnapshot);
    }

    return nextSnapshot;
  };

  const runWatchRefresh = async (events: WatchedSourceChange[]): Promise<SkillInventorySnapshot> => {
    if (refreshInFlight) {
      queuedWatchEvents.push(...events);
      return refreshInFlight;
    }

    const auditScanOptions = { ...lastScanOptions };
    refreshInFlight = refreshFromWatchEvents(events)
      .catch(async (error: unknown) => {
        await auditFailedInventoryRescan(error, auditScanOptions, 'watch');
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
        drainQueuedRefreshes();
      });

    return refreshInFlight;
  };

  const drainQueuedRefreshes = () => {
    if (refreshInFlight) {
      return;
    }

    if (queuedFullRefresh) {
      queuedFullRefresh = false;
      const verifyMcpConnectivity = queuedVerifyMcpConnectivity;
      queuedVerifyMcpConnectivity = undefined;
      const waiters = queuedFullRefreshWaiters.splice(0, queuedFullRefreshWaiters.length);
      void refreshInventory(verifyMcpConnectivity === undefined ? undefined : { verifyMcpConnectivity })
        .then((snapshot) => {
          for (const waiter of waiters) {
            waiter.resolve(snapshot);
          }
        })
        .catch((error: unknown) => {
          for (const waiter of waiters) {
            waiter.reject(error);
          }
        });
      return;
    }

    if (queuedWatchEvents.length > 0) {
      const queuedEvents = queuedWatchEvents.splice(0, queuedWatchEvents.length);
      void runWatchRefresh(queuedEvents).catch(() => undefined);
    }
  };

  const scheduleWatchRefresh = (event: WatchedSourceChange) => {
    pendingWatchEvents.push(event);

    if (watchRefreshTimer) {
      return;
    }

    watchRefreshTimer = setTimeout(() => {
      watchRefreshTimer = null;
      const queuedEvents = pendingWatchEvents.splice(0, pendingWatchEvents.length);
      void runWatchRefresh(queuedEvents).catch(() => undefined);
    }, watchDebounceMs);
  };

  return {
    async readCachedInventory(optionsOverride = {}) {
      lastScanOptions = { ...lastScanOptions, ...optionsOverride };
      return readCachedSkillInventory(lastScanOptions);
    },
    async scanInventory(optionsOverride = {}) {
      await startupObservationAid.beforeInitialReconciliation();
      return refreshInventory(optionsOverride);
    },
    async rescanInventory(optionsOverride = {}) {
      const auditScanOptions = resolvePersistentRefreshOptions(optionsOverride);
      try {
        return await refreshInventory(optionsOverride);
      } catch (error) {
        await auditFailedInventoryRescan(error, auditScanOptions, 'manual');
        throw error;
      }
    },
    async testMcpConnectivity(optionsOverride = {}) {
      return runPassiveMcpConnectivityScan(optionsOverride);
    },
    cancelMcpConnectivityTest,
    async addSkill(request, optionsOverride = {}) {
      if (refreshInFlight) {
        await refreshInFlight;
      }

      lastScanOptions = { ...lastScanOptions, ...optionsOverride };
      const beforeSnapshot = currentSnapshot ?? await scanSkillInventory(lastScanOptions);
      const { result: nextSnapshot } = await getAuditService(lastScanOptions).runOperation(
        buildAddSkillAuditRequest(request, beforeSnapshot, lastScanOptions),
        () => addSkillToInventory(request, lastScanOptions),
      );
      commitSnapshot(nextSnapshot);
      await emitAudit(lastScanOptions);
      return nextSnapshot;
    },
    async addMcpServer(request, optionsOverride = {}) {
      if (refreshInFlight) {
        await refreshInFlight;
      }

      lastScanOptions = { ...lastScanOptions, ...optionsOverride };
      const beforeSnapshot = currentSnapshot ?? await scanSkillInventory(lastScanOptions);
      const { result: nextSnapshot } = await getAuditService(lastScanOptions).runOperation(
        buildAddMcpServerAuditRequest(request, beforeSnapshot, lastScanOptions),
        () => addMcpServerToInventory(request, lastScanOptions),
      );
      commitSnapshot(nextSnapshot);
      await emitAudit(lastScanOptions);
      return nextSnapshot;
    },
    async resolveIssue(request) {
      if (refreshInFlight) {
        await refreshInFlight;
      }

      const beforeSnapshot = currentSnapshot ?? await scanSkillInventory(lastScanOptions);
      const auditRequest = buildResolveIssueAuditRequest(request, beforeSnapshot, lastScanOptions);
      try {
        const { result: nextSnapshot } = await getAuditService(lastScanOptions).runOperation(
          auditRequest,
          () => resolveInventoryIssue(request, lastScanOptions),
        );
        commitSnapshot(nextSnapshot);
        await emitAudit(lastScanOptions);
        return nextSnapshot;
      } catch (error) {
        await emitAudit(lastScanOptions).catch(() => undefined);
        throw error;
      }
    },
    async applyCapabilityAction(request, optionsOverride = {}) {
      if (refreshInFlight) {
        await refreshInFlight;
      }

      lastScanOptions = { ...lastScanOptions, ...optionsOverride };
      const { result: nextSnapshot } = await getAuditService(lastScanOptions).runOperation(
        buildConfigAuditRequest({
          kind: 'capability-action',
          title: buildCapabilityActionAuditTitle(request),
          summary: 'Skill Index capability metadata changed.',
          sourceMode: resolveAuditSourceMode(lastScanOptions),
          entity: { type: 'skill', name: request.skillName },
          paths: resolveAuditPaths(lastScanOptions),
          includeCache: false,
        }),
        () => applyCapabilityActionToInventory(request, lastScanOptions),
      );
      commitSnapshot(nextSnapshot);
      await emitAudit(lastScanOptions);
      return nextSnapshot;
    },
    async dismissDrift(request) {
      if (refreshInFlight) {
        await refreshInFlight;
      }

      const { result: nextSnapshot } = await getAuditService(lastScanOptions).runOperation(
        buildConfigAuditRequest({
          kind: 'dismiss-drift',
          title: 'Updated dismissal state',
          summary: 'Dismissed issue metadata changed.',
          sourceMode: resolveAuditSourceMode(lastScanOptions),
          entity: 'skillName' in request
            ? { type: 'skill', name: request.skillName }
            : 'mcpName' in request
              ? { type: 'mcp', name: request.mcpName }
              : { type: 'subagent', name: request.subagentName },
          paths: resolveAuditPaths(lastScanOptions),
          includeCache: true,
        }),
        () => dismissSkillDrift(request, {
          ...lastScanOptions,
          snapshot: currentSnapshot ?? undefined,
        }),
      );
      commitSnapshot(nextSnapshot);
      await emitAudit(lastScanOptions);
      return nextSnapshot;
    },
    async readAuditLog(optionsOverride = {}, scanOptionsOverride) {
      return getAuditService(scanOptionsOverride ? { ...lastScanOptions, ...scanOptionsOverride } : lastScanOptions)
        .readOperations(optionsOverride);
    },
    async undoAuditOperation(operationId) {
      await getAuditService(lastScanOptions).undoOperation(operationId);
      const nextSnapshot = await refreshInventory();
      const auditLog = await emitAudit(lastScanOptions);

      return {
        auditLog,
        inventorySnapshot: nextSnapshot,
      };
    },
    releaseStartupObservation() {
      startupObservationAid.releaseInitialReconciliation();
    },
    onDidUpdate(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    onDidAuditUpdate(listener) {
      auditSubscribers.add(listener);
      return () => {
        auditSubscribers.delete(listener);
      };
    },
    dispose() {
      cancelMcpConnectivityTest();

      if (watchRefreshTimer) {
        clearTimeout(watchRefreshTimer);
        watchRefreshTimer = null;
      }

      pendingWatchEvents.splice(0, pendingWatchEvents.length);
      queuedWatchEvents.splice(0, queuedWatchEvents.length);
      for (const watcher of watcherBySourceId.values()) {
        watcher.close();
      }
      watcherBySourceId.clear();
      subscribers.clear();
      auditSubscribers.clear();
    },
  };
}

function buildResolveIssueAuditRequest(
  request: ResolveIssueRequest,
  snapshot: SkillInventorySnapshot,
  options: ScanSkillInventoryOptions,
): AuditOperationRequest {
  const sourceMode = resolveAuditSourceMode(options);

  if (request.entity === 'mcp') {
    const mcp = (snapshot.mcps ?? []).find((entry) => entry.name === request.mcpName);
    const affectedPaths = mcp
      ? getMcpResolutionAffectedPaths(request, mcp)
      : [];

    return {
      kind: 'resolve-mcp-issue',
      title: `Resolved ${formatIssueLabel(request.issue)} for ${request.mcpName}`,
      summary: `${affectedPaths.length} ${affectedPaths.length === 1 ? 'config' : 'configs'} changed.`,
      sourceMode,
      entity: { type: 'mcp', name: request.mcpName },
      affectedPaths,
      undoable: affectedPaths.length > 0,
    };
  }

  if (request.entity === 'subagent') {
    const subagent = (snapshot.subagents ?? []).find((entry) => entry.name === request.subagentName);
    const affectedPaths = subagent
      ? getSubagentResolutionAffectedPaths(request, subagent, snapshot, options)
      : [];

    return {
      kind: 'resolve-subagent-issue',
      title: `Resolved ${formatIssueLabel(request.issue)} for ${request.subagentName}`,
      summary: `${affectedPaths.length} ${affectedPaths.length === 1 ? 'path' : 'paths'} changed.`,
      sourceMode,
      entity: { type: 'subagent', name: request.subagentName },
      affectedPaths,
      undoable: affectedPaths.length > 0,
    };
  }

  const skill = snapshot.skills.find((entry) => entry.name === request.skillName);
  const affectedPaths = skill
    ? dedupePaths([
        ...getSkillResolutionAffectedPaths(request, skill, snapshot),
        ...(shouldAuditSkillUniversalDecisionConfig(skill) ? [resolveAuditPathsForOptions(options).configFile] : []),
      ])
    : [];

  return {
    kind: 'resolve-skill-issue',
    title: `Resolved ${formatIssueLabel(request.issue)} for ${request.skillName}`,
    summary: `${affectedPaths.length} ${affectedPaths.length === 1 ? 'path' : 'paths'} changed.`,
    sourceMode,
    entity: { type: 'skill', name: request.skillName },
    affectedPaths,
    undoable: affectedPaths.length > 0,
  };
}

function buildAddSkillAuditRequest(
  request: AddSkillRequest,
  snapshot: SkillInventorySnapshot,
  options: ScanSkillInventoryOptions,
): AuditOperationRequest {
  const sourceMode = resolveAuditSourceMode(options);
  if (request.sourceType === 'url') {
    return {
      kind: 'add-skill',
      title: 'Added skill from external source',
      summary: request.source.trim(),
      sourceMode,
      entity: { type: 'skill' },
      affectedPaths: [],
      undoable: false,
    };
  }

  const skillName = request.skillName.trim();
  const paths = resolveAuditPathsForOptions(options);
  const canonicalSkillsDir = sourceMode === 'sandbox'
    ? paths.sandboxAgentsSkillsDir
    : paths.liveCanonicalUserSkillsDir || path.join(options.homeDir ?? homedir(), '.agents', 'skills');
  const canonicalPath = path.join(canonicalSkillsDir, skillName);
  const linkedPaths = (snapshot.agents ?? [])
    .filter((agent) =>
      agent.scope === sourceMode
      && agent.installState === 'installed'
      && agent.skillsLocation.state === 'available'
      && Boolean(agent.skillsLocation.path)
      && path.normalize(agent.skillsLocation.path as string) !== path.normalize(canonicalSkillsDir))
    .map((agent) => path.join(agent.skillsLocation.path as string, skillName));

  return {
    kind: 'add-skill',
    title: `Added ${skillName}`,
    summary: `${1 + linkedPaths.length} ${linkedPaths.length === 0 ? 'path' : 'paths'} created.`,
    sourceMode,
    entity: { type: 'skill', name: skillName },
    affectedPaths: dedupePaths([canonicalPath, ...linkedPaths]),
    undoable: true,
  };
}

function buildAddMcpServerAuditRequest(
  request: AddMcpServerRequest,
  snapshot: SkillInventorySnapshot,
  options: ScanSkillInventoryOptions,
): AuditOperationRequest {
  const affectedPaths = dedupePaths([
    ...snapshot.sources
      .filter((source) => source.canonical && source.writable)
      .map((source) => path.join(path.dirname(source.skillsDir), 'mcp.json')),
    ...(snapshot.agents ?? [])
      .filter((agent) =>
        agent.installState === 'installed'
        && agent.writable
        && agent.mcpConfigLocation.state === 'available'
        && Boolean(agent.mcpConfigLocation.path))
      .map((agent) => agent.mcpConfigLocation.path as string),
  ]);

  return {
    kind: 'add-mcp-server',
    title: `Added MCP server ${request.name.trim()}`,
    summary: `${affectedPaths.length} ${affectedPaths.length === 1 ? 'config' : 'configs'} changed.`,
    sourceMode: resolveAuditSourceMode(options),
    entity: { type: 'mcp', name: request.name.trim() },
    affectedPaths,
    undoable: affectedPaths.length > 0,
  };
}

function buildConfigAuditRequest({
  entity,
  includeCache,
  kind,
  paths,
  sourceMode,
  summary,
  title,
}: {
  entity?: AuditOperationRequest['entity'];
  includeCache: boolean;
  kind: AuditOperationRequest['kind'];
  paths: SkillIndexPaths;
  sourceMode: AuditOperationRequest['sourceMode'];
  summary: string;
  title: string;
}): AuditOperationRequest {
  return {
    kind,
    title,
    summary,
    sourceMode,
    entity,
    affectedPaths: includeCache ? [paths.configFile, paths.cacheFile] : [paths.configFile],
    undoable: true,
  };
}

function buildCapabilityActionAuditTitle(request: CapabilityActionRequest): string {
  switch (request.action) {
    case 'choose-universal-version':
      return `Chose Universal version for ${request.skillName}`;
  }
}

function getMcpResolutionAffectedPaths(
  request: Extract<ResolveIssueRequest, { entity: 'mcp' }>,
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
): string[] {
  const locations = request.issue === 'definition-mismatch'
    ? mcp.locations
    : mcp.missingLocations ?? [];

  return dedupePaths(
    locations
      .map((location) => location.configPath)
      .filter((configPath): configPath is string => typeof configPath === 'string' && configPath.length > 0),
  );
}

function getSubagentResolutionAffectedPaths(
  request: Extract<ResolveIssueRequest, { entity: 'subagent' }>,
  subagent: NonNullable<SkillInventorySnapshot['subagents']>[number],
  snapshot: SkillInventorySnapshot,
  options: ScanSkillInventoryOptions,
): string[] {
  const canonicalPath = resolveCanonicalSubagentPathForAudit(subagent, request.selectedVariantPath, options);

  switch (request.issue) {
    case 'missing-universal':
      return dedupePaths([canonicalPath]);
    case 'missing-from-agents':
      return dedupePaths((subagent.missingLocations ?? [])
        .filter((location) => isWritableSubagentTarget(location.agentId, snapshot))
        .map((location) => location.path)
        .filter((targetPath): targetPath is string => Boolean(targetPath)));
    case 'definition-mismatch':
      return dedupePaths([
        canonicalPath,
        ...subagent.locations
          .filter((location) => !location.canonical && !location.agentId.startsWith('plugin:') && location.mutability === 'writable')
          .map((location) => location.path),
        ...(subagent.missingLocations ?? [])
          .filter((location) => isWritableSubagentTarget(location.agentId, snapshot))
          .map((location) => location.path)
          .filter((targetPath): targetPath is string => Boolean(targetPath)),
      ]);
    case 'identical-copies':
      return dedupePaths(subagent.locations
        .filter((location) =>
          location.fileType === 'real-file'
          && !location.canonical
          && !location.agentId.startsWith('plugin:')
          && location.mutability === 'writable')
        .map((location) => location.path));
    case 'broken-symlink':
      return dedupePaths(subagent.locations
        .filter((location) => location.fileType === 'symlink' && location.resolvedPath === undefined)
        .map((location) => location.path));
    case 'wrong-symlink-target':
      return dedupePaths(subagent.locations
        .filter((location) =>
          location.fileType === 'symlink'
          && location.resolvedPath !== undefined
          && path.normalize(location.resolvedPath) !== path.normalize(canonicalPath))
        .map((location) => location.path));
  }
}

function getSkillResolutionAffectedPaths(
  request: Extract<ResolveIssueRequest, { entity: 'skill' }>,
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
): string[] {
  const canonicalPath = resolveCanonicalSkillPathForAudit(skill, snapshot, request.selectedVariantPath);

  switch (request.issue) {
    case 'missing-symlinks':
      return dedupePaths(
        (skill.detailDiagnostics.missingInstallSources ?? [])
          .map((source) => resolveMissingSkillInstallPathForAudit(skill.name, source.sourceId, snapshot))
          .filter((targetPath): targetPath is string => Boolean(targetPath))
          .filter((targetPath) => path.normalize(targetPath) !== path.normalize(canonicalPath)),
      );
    case 'broken-symlink':
      return dedupePaths(skill.locations
        .filter((location) => location.fileType === 'symlink' && location.resolvedPath === undefined)
        .map((location) => location.path));
    case 'wrong-symlink-target':
      return dedupePaths(skill.locations
        .filter((location) =>
          location.fileType === 'symlink'
          && location.resolvedPath !== undefined
          && path.normalize(location.resolvedPath) !== path.normalize(canonicalPath))
        .map((location) => location.path));
    case 'identical-copies':
      return dedupePaths(skill.locations
        .filter((location) =>
          location.fileType === 'real-file'
          && path.normalize(location.path) !== path.normalize(canonicalPath)
          && location.provenance?.kind !== 'plugin')
        .map((location) => location.path));
    case 'missing-canonical':
    case 'diverged-copies': {
      const duplicatePaths = skill.locations
        .filter((location) =>
          location.fileType === 'real-file'
          && path.normalize(location.path) !== path.normalize(canonicalPath)
          && location.provenance?.kind !== 'plugin')
        .map((location) => location.path);
      return dedupePaths([canonicalPath, ...duplicatePaths]);
    }
  }
}

function resolveCanonicalSubagentPathForAudit(
  subagent: NonNullable<SkillInventorySnapshot['subagents']>[number],
  selectedVariantPath: string | undefined,
  options: ScanSkillInventoryOptions,
): string {
  const existingCanonicalLocation = subagent.locations.find((location) => location.canonical);
  if (existingCanonicalLocation) {
    return existingCanonicalLocation.path;
  }

  const selectedScope = selectedVariantPath
    ? subagent.locations.find((location) => location.path === selectedVariantPath)?.scope
    : undefined;
  const scope = selectedScope
    ?? subagent.locations[0]?.scope
    ?? 'live';
  const paths = resolveAuditPathsForOptions(options);
  const canonicalSkillsDir = scope === 'sandbox'
    ? paths.sandboxCanonicalUserSkillsDir
    : paths.liveCanonicalUserSkillsDir;
  return path.join(path.dirname(canonicalSkillsDir), 'agents', `${subagent.name.replace(/[^A-Za-z0-9._-]+/gu, '-')}.md`);
}

function isWritableSubagentTarget(agentId: string, snapshot: SkillInventorySnapshot): boolean {
  const agent = (snapshot.agents ?? []).find((entry) => entry.id === agentId);
  return Boolean(agent?.writable && agent.subagentsLocation?.state === 'available' && agent.subagentsLocation.path);
}

function shouldAuditSkillUniversalDecisionConfig(skill: SkillRecord): boolean {
  return skill.locations.some((location) => location.provenance?.kind === 'plugin');
}

function resolveMissingSkillInstallPathForAudit(
  skillName: string,
  sourceId: string,
  snapshot: SkillInventorySnapshot,
): string | null {
  const source = snapshot.sources.find((entry) => entry.id === sourceId);
  if (source) {
    return source.writable ? path.join(source.skillsDir, skillName) : null;
  }

  const agent = (snapshot.agents ?? []).find((entry) => entry.id === sourceId);
  if (!agent || !agent.writable || agent.installState !== 'installed' || agent.skillsLocation.state !== 'available' || !agent.skillsLocation.path) {
    return null;
  }

  return path.join(agent.skillsLocation.path, skillName);
}

function resolveCanonicalSkillPathForAudit(
  skill: SkillRecord,
  snapshot: SkillInventorySnapshot,
  selectedVariantPath: string | undefined,
): string {
  if (selectedVariantPath) {
    const selectedLocation = skill.locations.find((location) => location.path === selectedVariantPath);
    if (selectedLocation?.provenance?.kind === 'plugin') {
      return selectedLocation.path;
    }
  }

  const selectedScope = selectedVariantPath
    ? skill.locations.find((location) => location.path === selectedVariantPath)?.sourceScope
    : undefined;
  const scope = selectedScope
    ?? skill.locations.find((location) => location.canonical)?.sourceScope
    ?? skill.locations[0]?.sourceScope
    ?? 'live';
  const preferredSource = snapshot.sources.find((source) => source.preferredCanonical && source.scope === scope);
  if (preferredSource) {
    const preferredLocation = skill.locations.find((location) => location.sourceId === preferredSource.id);
    return preferredLocation?.path ?? path.join(preferredSource.skillsDir, skill.name);
  }

  const canonicalSource = snapshot.sources.find((source) => source.canonical && source.scope === scope);
  return canonicalSource ? path.join(canonicalSource.skillsDir, skill.name) : skill.locations[0]?.path ?? skill.name;
}

function formatIssueLabel(issue: ResolveIssueRequest['issue']): string {
  return issue
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveAuditSourceMode(options: ScanSkillInventoryOptions): 'sandbox' | 'live' {
  return options.includeSandboxSources === true && options.includeLiveSources === false ? 'sandbox' : 'live';
}

function resolveAuditPathsForOptions(options: ScanSkillInventoryOptions): SkillIndexPaths {
  return resolveSkillIndexPathsForScanOptions(options);
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.map((targetPath) => path.normalize(targetPath)))];
}

function defaultWatchSource(source: SkillScanSource, onChange: (event: WatchSourceEvent) => void): ClosableWatcher {
  const watcher: FSWatcher = watch(source.skillsDir, { recursive: true }, (_eventType, filename) => {
    const filePath = filename ? path.join(source.skillsDir, filename.toString()) : undefined;
    onChange({ filePath });
  });

  watcher.on('error', () => {
    onChange({});
  });

  return watcher;
}

function coalesceWatchEvents(events: WatchedSourceChange[]): WatchedSourceChange[] {
  const coalescedEvents = new Map<string, WatchedSourceChange>();

  for (const event of events) {
    if (!event.filePath) {
      return [event];
    }

    coalescedEvents.set(`${event.source.id}:${event.filePath}`, event);
  }

  return [...coalescedEvents.values()];
}
