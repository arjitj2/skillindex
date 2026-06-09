import { createHash, randomUUID } from 'node:crypto';
import { appendFile, chmod, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AuditAction,
  AuditActionDiagnostics,
  AuditDismissedDriftSignatureDiagnostic,
  AuditDriftSignatureSummary,
  AuditFailureDiagnostic,
  AuditActionKind,
  AuditOperation,
  AuditOperationKind,
  AuditStateSummary,
  InventorySourceMode,
} from '@shared/contracts';
import type { SkillIndexPaths } from '@shared/skill-index-paths';

const DEFAULT_AUDIT_SESSION_ID = randomUUID();
const MAX_AUDIT_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_AUDIT_DIRECTORY_ENTRIES = 500;

interface CreateAuditLogServiceOptions {
  now?: () => Date;
  paths: SkillIndexPaths;
  sessionId?: string;
}

export interface AuditOperationRequest {
  affectedPaths: string[];
  entity?: AuditOperation['entity'];
  kind: AuditOperationKind;
  sourceMode: InventorySourceMode;
  summary: string;
  title: string;
  undoable: boolean;
}

export interface AuditOperationResult<T> {
  operation: AuditOperation;
  result: T;
}

export interface UndoAuditResult {
  blockedPath?: string;
  operation: AuditOperation;
}

interface OperationStartedRecord {
  operation: Omit<AuditOperation, 'actionCount' | 'actions' | 'status' | 'undoState'> & {
    sessionId: string;
    undoable: boolean;
  };
  recordKind: 'operation-started';
}

interface OperationCompletedRecord {
  completedAt: string;
  operationId: string;
  recordKind: 'operation-completed';
}

interface OperationFailedRecord {
  completedAt: string;
  error: string;
  trace?: string;
  operationId: string;
  recordKind: 'operation-failed';
}

interface ActionCompletedRecord {
  action: AuditAction;
  operationId: string;
  recordKind: 'action-completed';
  undoSnapshot?: {
    after: PathSnapshot;
    before: PathSnapshot;
  };
}

interface UndoStartedRecord {
  operationId: string;
  recordKind: 'undo-started';
  startedAt: string;
}

interface UndoActionCompletedRecord {
  actionId: string;
  completedAt: string;
  operationId: string;
  recordKind: 'undo-action-completed';
}

interface UndoCompletedRecord {
  completedAt: string;
  operationId: string;
  recordKind: 'undo-completed';
}

interface UndoBlockedRecord {
  blockedPath: string;
  completedAt: string;
  operationId: string;
  recordKind: 'undo-blocked';
}

interface UndoFailedRecord {
  completedAt: string;
  error: string;
  trace?: string;
  operationId: string;
  recordKind: 'undo-failed';
}

type AuditLogRecord =
  | OperationStartedRecord
  | OperationCompletedRecord
  | OperationFailedRecord
  | ActionCompletedRecord
  | UndoStartedRecord
  | UndoActionCompletedRecord
  | UndoCompletedRecord
  | UndoBlockedRecord
  | UndoFailedRecord;

interface AbsentSnapshot {
  kind: 'absent';
}

interface FileSnapshot {
  contentBase64: string;
  hash: string;
  kind: 'file';
  mode?: number;
  size: number;
}

interface SymlinkSnapshot {
  hash: string;
  kind: 'symlink';
  symlinkTarget: string;
}

interface DirectoryEntrySnapshot {
  contentBase64?: string;
  hash?: string;
  kind: 'directory' | 'file' | 'symlink';
  mode?: number;
  relativePath: string;
  size?: number;
  symlinkTarget?: string;
}

interface DirectorySnapshot {
  entries: DirectoryEntrySnapshot[];
  hash: string;
  itemCount: number;
  kind: 'directory';
  mode?: number;
  size: number;
}

interface OmittedSnapshot {
  kind: 'omitted';
  reason: string;
  size?: number;
}

type PathSnapshot = AbsentSnapshot | FileSnapshot | SymlinkSnapshot | DirectorySnapshot | OmittedSnapshot;

interface CacheSkillDriftRecord {
  driftPresentation?: 'none' | 'active' | 'dismissed';
  driftSignature?: string;
  issueReasons?: string[];
  name: string;
  structuralState?: string;
}

interface GroupedOperation {
  actionRecords: ActionCompletedRecord[];
  blockedPath?: string;
  completedAt?: string;
  failure?: AuditFailureDiagnostic;
  failedAt?: string;
  operation: OperationStartedRecord['operation'];
  status: AuditOperation['status'];
  undoActionIds: Set<string>;
}

export function createAuditLogService({
  now = () => new Date(),
  paths,
  sessionId = DEFAULT_AUDIT_SESSION_ID,
}: CreateAuditLogServiceOptions) {
  const appendRecord = async (record: AuditLogRecord) => {
    await mkdir(path.dirname(paths.auditLogFile), { recursive: true });
    await appendFile(paths.auditLogFile, `${JSON.stringify(record)}\n`, 'utf8');
    await chmod(paths.auditLogFile, 0o600);
  };

  const readRecords = async (): Promise<AuditLogRecord[]> => {
    let raw: string;
    try {
      raw = await readFile(paths.auditLogFile, 'utf8');
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    const records: AuditLogRecord[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }

      try {
        records.push(JSON.parse(line) as AuditLogRecord);
      } catch {
        continue;
      }
    }

    return records;
  };

  const readOperations = async (options: { limit?: number } = {}): Promise<AuditOperation[]> => {
    const operations = groupRecords(await readRecords(), sessionId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));

    return typeof options.limit === 'number' ? operations.slice(0, options.limit) : operations;
  };

  const runOperation = async <T>(
    request: AuditOperationRequest,
    run: () => Promise<T>,
  ): Promise<AuditOperationResult<T>> => {
    const operationId = randomUUID();
    const startedAt = now().toISOString();
    const uniqueAffectedPaths = dedupePaths(request.affectedPaths);
    await appendRecord({
      recordKind: 'operation-started',
      operation: {
        id: operationId,
        kind: request.kind,
        title: request.title,
        summary: request.summary,
        startedAt,
        actor: 'app',
        sourceMode: request.sourceMode,
        entity: request.entity,
        undoable: request.undoable,
        sessionId,
      },
    });

    const beforeSnapshots = new Map<string, PathSnapshot>();
    for (const affectedPath of uniqueAffectedPaths) {
      beforeSnapshots.set(affectedPath, await capturePathSnapshot(affectedPath));
    }

    let result: T;
    try {
      result = await run();
    } catch (error) {
      const failure = formatFailureDiagnostic(error);
      await appendChangedActionRecords(operationId, request.undoable, uniqueAffectedPaths, beforeSnapshots).catch(() => undefined);
      await appendRecord({
        recordKind: 'operation-failed',
        operationId,
        completedAt: now().toISOString(),
        error: failure.message,
        trace: failure.trace,
      });
      throw error;
    }

    let operation: AuditOperation | undefined;
    try {
      await appendChangedActionRecords(operationId, request.undoable, uniqueAffectedPaths, beforeSnapshots);
      await appendRecord({
        recordKind: 'operation-completed',
        operationId,
        completedAt: now().toISOString(),
      });

      operation = (await readOperations()).find((candidate) => candidate.id === operationId);
    } catch (error) {
      const failure = formatFailureDiagnostic(error, 'Audit finalization failed after mutation');
      await appendRecord({
        recordKind: 'operation-failed',
        operationId,
        completedAt: now().toISOString(),
        error: failure.message,
        trace: failure.trace,
      }).catch(() => undefined);
      operation = (await readOperations().catch(() => []))
        .find((candidate) => candidate.id === operationId);
    }

    return {
      operation: operation ?? buildFallbackOperation(request, operationId, startedAt),
      result,
    };
  };

  const appendChangedActionRecords = async (
    operationId: string,
    undoable: boolean,
    affectedPaths: string[],
    beforeSnapshots: Map<string, PathSnapshot>,
  ): Promise<void> => {
    const pendingActionRecords: Array<{
      action: AuditAction;
      after: PathSnapshot;
      before: PathSnapshot;
    }> = [];
    for (const affectedPath of affectedPaths) {
      const before = beforeSnapshots.get(affectedPath) ?? { kind: 'absent' };
      const after = await capturePathSnapshot(affectedPath);
      if (snapshotEquals(before, after)) {
        continue;
      }

      const completedAt = now().toISOString();
      const diagnostics = await buildActionDiagnostics(affectedPath, before, after, paths);
      pendingActionRecords.push({
        before,
        after,
        action: {
          id: randomUUID(),
          operationId,
          kind: deriveActionKind(affectedPath, before, after),
          title: buildActionTitle(before, after),
          summary: buildActionSummary(affectedPath, before, after),
          status: 'completed',
          path: affectedPath,
          targetPath: after.kind === 'symlink' ? after.symlinkTarget : undefined,
          before: summarizeSnapshot(before, affectedPath),
          after: summarizeSnapshot(after, affectedPath),
          diagnostics,
          completedAt,
        },
      });
    }

    const canStoreUndoSnapshots = undoable
      && pendingActionRecords.every(({ before, after }) => isRestorableSnapshot(before) && isRestorableSnapshot(after));
    for (const { action, before, after } of pendingActionRecords) {
      await appendRecord({
        recordKind: 'action-completed',
        operationId,
        action,
        undoSnapshot: canStoreUndoSnapshots ? { before, after } : undefined,
      });
    }
  };

  const undoOperation = async (operationId: string): Promise<UndoAuditResult> => {
    const records = await readRecords();
    const grouped = groupRawRecords(records).get(operationId);
    if (!grouped) {
      throw new Error(`Audit operation ${operationId} was not found.`);
    }

    const operation = groupRecords(records, sessionId).find((candidate) => candidate.id === operationId);
    if (!operation) {
      throw new Error(`Audit operation ${operationId} was not readable.`);
    }
    if (operation.undoState !== 'available') {
      throw new Error(`Audit operation ${operationId} is not available for undo.`);
    }

    await appendRecord({
      recordKind: 'undo-started',
      operationId,
      startedAt: now().toISOString(),
    });

    const undoableActionRecords = grouped.actionRecords.filter((record) => record.undoSnapshot);
    for (const actionRecord of undoableActionRecords) {
      const current = await capturePathSnapshot(actionRecord.action.path ?? '');
      if (!snapshotEquals(current, actionRecord.undoSnapshot!.after)) {
        await appendRecord({
          recordKind: 'undo-blocked',
          operationId,
          blockedPath: actionRecord.action.path ?? '',
          completedAt: now().toISOString(),
        });
        const blockedOperation = (await readOperations()).find((candidate) => candidate.id === operationId);
        if (!blockedOperation) {
          throw new Error(`Audit operation ${operationId} disappeared after blocked undo.`);
        }
        return {
          blockedPath: actionRecord.action.path,
          operation: blockedOperation,
        };
      }
    }

    try {
      for (const actionRecord of undoableActionRecords.slice().reverse()) {
        await restorePathSnapshot(actionRecord.action.path ?? '', actionRecord.undoSnapshot!.before);
        await appendRecord({
          recordKind: 'undo-action-completed',
          operationId,
          actionId: actionRecord.action.id,
          completedAt: now().toISOString(),
        });
      }
      await appendRecord({
        recordKind: 'undo-completed',
        operationId,
        completedAt: now().toISOString(),
      });
    } catch (error) {
      const failure = formatFailureDiagnostic(error);
      await appendRecord({
        recordKind: 'undo-failed',
        operationId,
        completedAt: now().toISOString(),
        error: failure.message,
        trace: failure.trace,
      });
      throw error;
    }

    const undoneOperation = (await readOperations()).find((candidate) => candidate.id === operationId);
    if (!undoneOperation) {
      throw new Error(`Audit operation ${operationId} disappeared after undo.`);
    }

    return {
      operation: undoneOperation,
    };
  };

  return {
    readOperations,
    runOperation,
    undoOperation,
  };
}

function groupRecords(records: AuditLogRecord[], currentSessionId: string): AuditOperation[] {
  const groupedRecords = groupRawRecords(records);
  const latestCurrentSessionCompletedOperationId = [...groupedRecords.values()]
    .filter((record) => record.completedAt && record.operation.sessionId === currentSessionId)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0]?.operation.id;

  return [...groupedRecords.values()].map((record) => {
    const actions = record.actionRecords.map(({ action }) => ({
      ...action,
      status: record.status === 'undone' && record.undoActionIds.has(action.id) ? 'undone' as const : action.status,
    }));
    const undoable = record.operation.undoable && record.actionRecords.some((actionRecord) => actionRecord.undoSnapshot);
    const undoState = deriveUndoState({
      currentSessionId,
      latestCurrentSessionCompletedOperationId,
      record,
      undoable,
    });

    return {
      id: record.operation.id,
      kind: record.operation.kind,
      title: record.operation.title,
      summary: record.operation.summary,
      startedAt: record.operation.startedAt,
      completedAt: record.completedAt,
      status: record.status,
      actor: record.operation.actor,
      sourceMode: record.operation.sourceMode,
      entity: record.operation.entity,
      failure: record.failure,
      undoState,
      actionCount: actions.length,
      actions,
    };
  });
}

function groupRawRecords(records: AuditLogRecord[]): Map<string, GroupedOperation> {
  const grouped = new Map<string, GroupedOperation>();

  for (const record of records) {
    if (record.recordKind === 'operation-started') {
      grouped.set(record.operation.id, {
        actionRecords: [],
        operation: record.operation,
        status: 'failed',
        undoActionIds: new Set<string>(),
      });
      continue;
    }

    const operationId = 'operationId' in record ? record.operationId : null;
    const groupedOperation = operationId ? grouped.get(operationId) : undefined;
    if (!groupedOperation) {
      continue;
    }

    switch (record.recordKind) {
      case 'action-completed':
        groupedOperation.actionRecords.push(record);
        break;
      case 'operation-completed':
        groupedOperation.completedAt = record.completedAt;
        groupedOperation.status = 'completed';
        break;
      case 'operation-failed':
        groupedOperation.failedAt = record.completedAt;
        groupedOperation.completedAt = record.completedAt;
        groupedOperation.failure = {
          message: record.error,
          trace: record.trace ?? record.error,
        };
        groupedOperation.status = 'failed';
        break;
      case 'undo-action-completed':
        groupedOperation.undoActionIds.add(record.actionId);
        break;
      case 'undo-completed':
        groupedOperation.status = 'undone';
        groupedOperation.completedAt = record.completedAt;
        break;
      case 'undo-blocked':
        groupedOperation.status = 'undo-blocked';
        groupedOperation.blockedPath = record.blockedPath;
        break;
      case 'undo-failed':
        groupedOperation.status = 'undo-failed';
        groupedOperation.completedAt = record.completedAt;
        groupedOperation.failure = {
          message: record.error,
          trace: record.trace ?? record.error,
        };
        break;
      case 'undo-started':
        break;
    }
  }

  return grouped;
}

function deriveUndoState({
  currentSessionId,
  latestCurrentSessionCompletedOperationId,
  record,
  undoable,
}: {
  currentSessionId: string;
  latestCurrentSessionCompletedOperationId: string | undefined;
  record: GroupedOperation;
  undoable: boolean;
}): AuditOperation['undoState'] {
  if (record.status === 'undone') {
    return 'used';
  }
  if (record.status === 'undo-blocked' || record.status === 'undo-failed') {
    return 'blocked';
  }
  if (!undoable || record.status !== 'completed') {
    return 'not-undoable';
  }
  if (record.operation.sessionId !== currentSessionId || record.operation.id !== latestCurrentSessionCompletedOperationId) {
    return 'expired';
  }

  return 'available';
}

async function capturePathSnapshot(targetPath: string): Promise<PathSnapshot> {
  let stats;
  try {
    stats = await lstat(targetPath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { kind: 'absent' };
    }

    throw error;
  }

  if (stats.isSymbolicLink()) {
    const symlinkTarget = await readlink(targetPath);
    return {
      kind: 'symlink',
      symlinkTarget,
      hash: hashString(symlinkTarget),
    };
  }

  if (stats.isDirectory()) {
    return captureDirectorySnapshot(targetPath, stats.mode);
  }

  if (stats.isFile()) {
    if (stats.size > MAX_AUDIT_SNAPSHOT_BYTES) {
      return { kind: 'omitted', reason: 'file-too-large', size: stats.size };
    }
    const content = await readFile(targetPath);
    return {
      kind: 'file',
      contentBase64: content.toString('base64'),
      hash: hashBuffer(content),
      mode: stats.mode,
      size: stats.size,
    };
  }

  return { kind: 'absent' };
}

async function captureDirectorySnapshot(rootPath: string, rootMode?: number): Promise<DirectorySnapshot | OmittedSnapshot> {
  const entries: DirectoryEntrySnapshot[] = [];
  let totalSize = 0;

  const visit = async (currentPath: string, relativeRoot: string) => {
    const names = await readdir(currentPath);
    for (const name of names.sort((left, right) => left.localeCompare(right))) {
      if (entries.length >= MAX_AUDIT_DIRECTORY_ENTRIES || totalSize > MAX_AUDIT_SNAPSHOT_BYTES) {
        throw new SnapshotLimitError('directory-too-large', totalSize);
      }

      const entryPath = path.join(currentPath, name);
      const relativePath = path.join(relativeRoot, name);
      const stats = await lstat(entryPath);

      if (stats.isSymbolicLink()) {
        const symlinkTarget = await readlink(entryPath);
        entries.push({
          kind: 'symlink',
          relativePath,
          symlinkTarget,
          hash: hashString(symlinkTarget),
        });
      } else if (stats.isDirectory()) {
        entries.push({
          kind: 'directory',
          relativePath,
          mode: stats.mode,
        });
        await visit(entryPath, relativePath);
      } else if (stats.isFile()) {
        totalSize += stats.size;
        if (totalSize > MAX_AUDIT_SNAPSHOT_BYTES) {
          throw new SnapshotLimitError('directory-too-large', totalSize);
        }
        const content = await readFile(entryPath);
        entries.push({
          kind: 'file',
          relativePath,
          contentBase64: content.toString('base64'),
          hash: hashBuffer(content),
          mode: stats.mode,
          size: stats.size,
        });
      }
    }
  };

  try {
    await visit(rootPath, '');
  } catch (error) {
    if (error instanceof SnapshotLimitError) {
      return { kind: 'omitted', reason: error.reason, size: error.size };
    }

    throw error;
  }

  return {
    kind: 'directory',
    entries,
    itemCount: entries.length,
    mode: rootMode,
    size: totalSize,
    hash: hashString(JSON.stringify(entries.map((entry) => ({
      hash: entry.hash,
      kind: entry.kind,
      mode: entry.mode,
      relativePath: entry.relativePath,
      size: entry.size,
      symlinkTarget: entry.symlinkTarget,
    })))),
  };
}

async function restorePathSnapshot(targetPath: string, snapshot: PathSnapshot): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });

  if (snapshot.kind === 'absent') {
    return;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });

  if (snapshot.kind === 'symlink') {
    await symlink(snapshot.symlinkTarget, targetPath);
    return;
  }

  if (snapshot.kind === 'file') {
    await writeFile(targetPath, Buffer.from(snapshot.contentBase64, 'base64'));
    if (snapshot.mode) {
      await chmod(targetPath, snapshot.mode);
    }
    return;
  }

  if (snapshot.kind === 'omitted') {
    throw new Error(`Cannot restore omitted audit snapshot: ${snapshot.reason}`);
  }

  await mkdir(targetPath, { recursive: true });
  const directories = snapshot.entries.filter((entry) => entry.kind === 'directory');
  for (const entry of directories) {
    const directoryPath = path.join(targetPath, entry.relativePath);
    await mkdir(directoryPath, { recursive: true });
    if (entry.mode) {
      await chmod(directoryPath, entry.mode).catch(() => undefined);
    }
  }

  for (const entry of snapshot.entries.filter((candidate) => candidate.kind !== 'directory')) {
    const entryPath = path.join(targetPath, entry.relativePath);
    await mkdir(path.dirname(entryPath), { recursive: true });
    if (entry.kind === 'symlink') {
      await symlink(entry.symlinkTarget ?? '', entryPath);
    } else {
      await writeFile(entryPath, Buffer.from(entry.contentBase64 ?? '', 'base64'));
      if (entry.mode) {
        await chmod(entryPath, entry.mode);
      }
    }
  }
}

function summarizeSnapshot(snapshot: PathSnapshot, targetPath: string): AuditStateSummary {
  if (snapshot.kind === 'absent') {
    return { kind: 'absent' };
  }
  if (snapshot.kind === 'omitted') {
    return {
      kind: 'unknown',
      size: snapshot.size,
    };
  }
  if (snapshot.kind === 'directory') {
    return {
      kind: 'directory',
      hash: snapshot.hash,
      itemCount: snapshot.itemCount,
    };
  }
  if (snapshot.kind === 'symlink') {
    return {
      kind: 'symlink',
      hash: snapshot.hash,
      symlinkTarget: snapshot.symlinkTarget,
    };
  }

  return {
    kind: isConfigPath(targetPath) ? 'config' : 'file',
    hash: snapshot.hash,
    size: snapshot.size,
  };
}

function deriveActionKind(targetPath: string, before: PathSnapshot, after: PathSnapshot): AuditActionKind {
  if (after.kind === 'absent') {
    return 'delete-path';
  }
  if (after.kind === 'symlink') {
    return before.kind === 'absent' ? 'create-symlink' : 'replace-with-symlink';
  }
  if (after.kind === 'omitted') {
    return 'unknown-change';
  }
  if (after.kind === 'directory') {
    return before.kind === 'absent' ? 'copy-directory' : 'unknown-change';
  }
  if (isConfigPath(targetPath)) {
    return targetPath.endsWith('config.json') ? 'update-app-config' : 'write-config';
  }
  if (before.kind === 'absent') {
    return 'create-file';
  }
  return 'overwrite-file';
}

function buildActionTitle(before: PathSnapshot, after: PathSnapshot): string {
  if (after.kind === 'symlink') {
    return before.kind === 'absent' ? 'Created symlink' : 'Replaced with symlink';
  }
  if (after.kind === 'absent') {
    return 'Deleted path';
  }
  if (after.kind === 'omitted') {
    return 'Updated path';
  }
  if (before.kind === 'absent') {
    return after.kind === 'directory' ? 'Created directory' : 'Created file';
  }
  return 'Updated path';
}

function buildActionSummary(targetPath: string, before: PathSnapshot, after: PathSnapshot): string {
  if (after.kind === 'symlink') {
    return `${targetPath} now points to ${after.symlinkTarget}.`;
  }
  if (after.kind === 'absent') {
    return `${targetPath} was removed.`;
  }
  if (after.kind === 'omitted') {
    return `${targetPath} changed; the snapshot was too large to store for undo.`;
  }
  if (before.kind === 'absent') {
    return `${targetPath} was created.`;
  }
  return `${targetPath} changed.`;
}

async function buildActionDiagnostics(
  targetPath: string,
  before: PathSnapshot,
  after: PathSnapshot,
  paths: SkillIndexPaths,
): Promise<AuditActionDiagnostics | undefined> {
  if (path.normalize(targetPath) !== path.normalize(paths.configFile)) {
    return undefined;
  }

  const dismissedDriftSignatures = await buildDismissedDriftSignatureDiagnostics(before, after, paths);
  if (!dismissedDriftSignatures) {
    return undefined;
  }

  return {
    dismissedDriftSignatures,
  };
}

async function buildDismissedDriftSignatureDiagnostics(
  before: PathSnapshot,
  after: PathSnapshot,
  paths: SkillIndexPaths,
): Promise<AuditActionDiagnostics['dismissedDriftSignatures'] | undefined> {
  const beforeConfig = parseJsonSnapshot(before);
  const afterConfig = parseJsonSnapshot(after);
  if (!isRecord(beforeConfig) || !isRecord(afterConfig)) {
    return undefined;
  }

  const beforeSignatures = getStringArray(beforeConfig.dismissedDriftSignatures);
  const afterSignatures = getStringArray(afterConfig.dismissedDriftSignatures);
  const afterSignatureSet = new Set(afterSignatures);
  const beforeSignatureSet = new Set(beforeSignatures);
  const removedSignatures = beforeSignatures.filter((signature) => !afterSignatureSet.has(signature));
  const addedSignatures = afterSignatures.filter((signature) => !beforeSignatureSet.has(signature));
  if (removedSignatures.length === 0 && addedSignatures.length === 0) {
    return undefined;
  }

  const currentSkills = removedSignatures.length > 0 ? await readCacheSkillDriftRecords(paths.cacheFile) : new Map<string, CacheSkillDriftRecord>();

  return {
    added: addedSignatures.map((signature) => ({ signature: summarizeDriftSignature(signature) })),
    removed: removedSignatures.map((signature) => buildRemovedDismissedDriftSignatureDiagnostic(signature, currentSkills)),
  };
}

function buildRemovedDismissedDriftSignatureDiagnostic(
  signature: string,
  currentSkills: Map<string, CacheSkillDriftRecord>,
): AuditDismissedDriftSignatureDiagnostic {
  const signatureSummary = summarizeDriftSignature(signature);
  const currentSkill = signatureSummary.name ? currentSkills.get(signatureSummary.name) : undefined;
  if (!currentSkill) {
    return { signature: signatureSummary };
  }

  const currentSignatureSummary = currentSkill.driftSignature
    ? summarizeDriftSignature(currentSkill.driftSignature)
    : undefined;

  return {
    signature: signatureSummary,
    currentSkill: {
      name: currentSkill.name,
      structuralState: currentSkill.structuralState,
      driftPresentation: currentSkill.driftPresentation,
      issueReasons: currentSkill.issueReasons,
      driftSignature: currentSignatureSummary,
      signatureMatches: currentSkill.driftSignature === signature,
      signatureDiffFields: currentSkill.driftSignature
        ? compareDriftSignatures(signatureSummary, currentSignatureSummary)
        : undefined,
    },
  };
}

async function readCacheSkillDriftRecords(cacheFile: string): Promise<Map<string, CacheSkillDriftRecord>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(cacheFile, 'utf8')) as unknown;
  } catch {
    return new Map();
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.skills)) {
    return new Map();
  }

  const skills = new Map<string, CacheSkillDriftRecord>();
  for (const skill of parsed.skills) {
    if (!isRecord(skill) || typeof skill.name !== 'string') {
      continue;
    }

    skills.set(skill.name, {
      name: skill.name,
      structuralState: typeof skill.structuralState === 'string' ? skill.structuralState : undefined,
      driftPresentation: isSkillDriftPresentation(skill.driftPresentation) ? skill.driftPresentation : undefined,
      issueReasons: getStringArray(skill.issueReasons),
      driftSignature: typeof skill.driftSignature === 'string' ? skill.driftSignature : undefined,
    });
  }

  return skills;
}

function summarizeDriftSignature(signature: string): AuditDriftSignatureSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(signature) as unknown;
  } catch (error) {
    return {
      signatureHash: hashString(signature),
      parseError: formatError(error),
    };
  }

  if (!isRecord(parsed)) {
    return {
      signatureHash: hashString(signature),
      parseError: 'Signature did not parse to an object.',
    };
  }

  const locations = Array.isArray(parsed.locations)
    ? parsed.locations
      .filter(isRecord)
      .map((location) => ({
        path: typeof location.path === 'string' ? location.path : undefined,
        fileType: typeof location.fileType === 'string' ? location.fileType : undefined,
        resolvedPath: typeof location.resolvedPath === 'string' || location.resolvedPath === null ? location.resolvedPath : undefined,
        contentHash: typeof location.contentHash === 'string' || location.contentHash === null ? location.contentHash : undefined,
      }))
    : undefined;

  return {
    signatureHash: hashString(signature),
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    structuralState: typeof parsed.structuralState === 'string' ? parsed.structuralState : undefined,
    issueReasons: getStringArray(parsed.issueReasons),
    locations,
  };
}

function compareDriftSignatures(
  left: AuditDriftSignatureSummary,
  right: AuditDriftSignatureSummary | undefined,
): string[] | undefined {
  if (!right) {
    return undefined;
  }

  const diffFields: string[] = [];
  if (left.name !== right.name) {
    diffFields.push('name');
  }
  if (left.structuralState !== right.structuralState) {
    diffFields.push('structuralState');
  }
  if (JSON.stringify(left.issueReasons ?? []) !== JSON.stringify(right.issueReasons ?? [])) {
    diffFields.push('issueReasons');
  }

  const leftLocations = left.locations ?? [];
  const rightLocations = right.locations ?? [];
  if (leftLocations.length !== rightLocations.length) {
    diffFields.push('locations.length');
  }

  const rightByPath = new Map(rightLocations.map((location, index) => [getDriftLocationComparisonKey(location, index), location]));
  for (const [index, leftLocation] of leftLocations.entries()) {
    const locationKey = getDriftLocationComparisonKey(leftLocation, index);
    const rightLocation = rightByPath.get(locationKey);
    if (!rightLocation) {
      diffFields.push(`locations.${locationKey}`);
      continue;
    }
    if (leftLocation.fileType !== rightLocation.fileType) {
      diffFields.push(`locations.${locationKey}.fileType`);
    }
    if (leftLocation.resolvedPath !== rightLocation.resolvedPath) {
      diffFields.push(`locations.${locationKey}.resolvedPath`);
    }
    if (leftLocation.contentHash !== rightLocation.contentHash) {
      diffFields.push(`locations.${locationKey}.contentHash`);
    }
  }

  return diffFields;
}

function getDriftLocationComparisonKey(
  location: NonNullable<AuditDriftSignatureSummary['locations']>[number],
  index: number,
): string {
  return location.path ?? `index:${index}`;
}

function parseJsonSnapshot(snapshot: PathSnapshot): unknown {
  if (snapshot.kind !== 'file') {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(snapshot.contentBase64, 'base64').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSkillDriftPresentation(value: unknown): value is CacheSkillDriftRecord['driftPresentation'] {
  return value === 'none' || value === 'active' || value === 'dismissed';
}

function snapshotEquals(left: PathSnapshot, right: PathSnapshot): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'absent':
      return true;
    case 'file':
      return right.kind === 'file' && left.hash === right.hash && left.size === right.size && left.mode === right.mode;
    case 'symlink':
      return right.kind === 'symlink' && left.symlinkTarget === right.symlinkTarget;
    case 'directory':
      return right.kind === 'directory' && left.hash === right.hash && left.itemCount === right.itemCount && left.mode === right.mode;
    case 'omitted':
      return right.kind === 'omitted' && left.reason === right.reason && left.size === right.size;
  }
}

function isRestorableSnapshot(snapshot: PathSnapshot): boolean {
  return snapshot.kind !== 'omitted';
}

function buildFallbackOperation(
  request: AuditOperationRequest,
  operationId: string,
  startedAt: string,
): AuditOperation {
  return {
    id: operationId,
    kind: request.kind,
    title: request.title,
    summary: request.summary,
    startedAt,
    status: 'failed',
    actor: 'app',
    sourceMode: request.sourceMode,
    entity: request.entity,
    undoState: 'not-undoable',
    actionCount: 0,
    actions: [],
  };
}

class SnapshotLimitError extends Error {
  constructor(
    readonly reason: string,
    readonly size: number,
  ) {
    super(reason);
  }
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.filter((targetPath) => targetPath.trim().length > 0).map((targetPath) => path.normalize(targetPath)))];
}

function isConfigPath(targetPath: string): boolean {
  const basename = path.basename(targetPath);
  return basename.endsWith('.json')
    || basename.endsWith('.jsonc')
    || basename.endsWith('.toml')
    || basename === 'config';
}

function hashBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashString(value: string): string {
  return hashBuffer(Buffer.from(value));
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatFailureDiagnostic(error: unknown, prefix?: string): AuditFailureDiagnostic {
  const message = formatError(error);
  const prefixedMessage = prefix ? `${prefix}: ${message}` : message;
  const trace = error instanceof Error && error.stack
    ? error.stack
    : prefixedMessage;

  return {
    message: prefixedMessage,
    trace: prefix && trace !== prefixedMessage ? `${prefix}: ${trace}` : trace,
  };
}
