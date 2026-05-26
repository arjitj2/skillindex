import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAuditLogService } from '@main/audit-log';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

describe('audit log service', () => {
  it('persists grouped operations with individual action rows', async () => {
    const { paths, root } = await createTempPaths('audit-grouping-');
    const service = createAuditLogService({ paths });
    const configPath = path.join(root, 'config.json');

    await service.runOperation({
      kind: 'settings-update',
      title: 'Updated settings',
      summary: 'Custom scan paths changed.',
      sourceMode: 'sandbox',
      entity: { type: 'settings' },
      affectedPaths: [configPath],
      undoable: true,
    }, async () => {
      await writeFile(configPath, '{"customScanPaths":["/tmp/skills"]}\n', 'utf8');
      return 'ok';
    });

    const operations = await service.readOperations();

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: 'settings-update',
      title: 'Updated settings',
      status: 'completed',
      undoState: 'available',
      actionCount: 1,
    });
    const [action] = operations[0].actions;
    expect(action).toMatchObject({
      kind: 'update-app-config',
      path: configPath,
      before: { kind: 'absent' },
    });
    expect(action?.after?.kind).toBe('config');

    const freshService = createAuditLogService({ paths, sessionId: 'fresh-session' });
    const persistedOperations = await freshService.readOperations();
    expect(persistedOperations).toHaveLength(1);
    expect(persistedOperations[0]).toMatchObject({
      kind: 'settings-update',
      undoState: 'expired',
      actionCount: 1,
    });
  });

  it('undoes a directory replaced by a symlink when the after-state is unchanged', async () => {
    const { paths, root } = await createTempPaths('audit-undo-');
    const service = createAuditLogService({ paths });
    const canonicalPath = path.join(root, 'canonical-skill');
    const linkedPath = path.join(root, 'agent-skill');

    await mkdir(canonicalPath, { recursive: true });
    await mkdir(linkedPath, { recursive: true });
    await writeFile(path.join(canonicalPath, 'SKILL.md'), 'name: canonical\n', 'utf8');
    await writeFile(path.join(linkedPath, 'SKILL.md'), 'name: previous\n', 'utf8');

    const { operation } = await service.runOperation({
      kind: 'resolve-skill-issue',
      title: 'Repaired symlink',
      summary: 'Replaced one copy with a symlink.',
      sourceMode: 'sandbox',
      entity: { type: 'skill', name: 'agent-skill' },
      affectedPaths: [linkedPath],
      undoable: true,
    }, async () => {
      await rm(linkedPath, { recursive: true, force: true });
      await symlink(canonicalPath, linkedPath);
    });

    const [action] = operation.actions;
    expect(action).toMatchObject({
      kind: 'replace-with-symlink',
    });
    expect(action?.before?.kind).toBe('directory');
    expect(action?.after).toMatchObject({ kind: 'symlink', symlinkTarget: canonicalPath });

    const result = await service.undoOperation(operation.id);

    expect((await lstat(linkedPath)).isDirectory()).toBe(true);
    await expect(readFile(path.join(linkedPath, 'SKILL.md'), 'utf8')).resolves.toBe('name: previous\n');
    expect(result.operation).toMatchObject({
      id: operation.id,
      status: 'undone',
      undoState: 'used',
    });
    expect(result.operation.actions[0]).toMatchObject({
      status: 'undone',
    });
  });

  it('blocks undo when the current path no longer matches the recorded after-state', async () => {
    const { paths, root } = await createTempPaths('audit-blocked-');
    const service = createAuditLogService({ paths });
    const canonicalPath = path.join(root, 'canonical-skill');
    const linkedPath = path.join(root, 'agent-skill');
    const externalPath = path.join(root, 'external-skill');

    await mkdir(canonicalPath, { recursive: true });
    await mkdir(externalPath, { recursive: true });
    await mkdir(linkedPath, { recursive: true });
    await writeFile(path.join(canonicalPath, 'SKILL.md'), 'name: canonical\n', 'utf8');
    await writeFile(path.join(externalPath, 'SKILL.md'), 'name: external\n', 'utf8');
    await writeFile(path.join(linkedPath, 'SKILL.md'), 'name: previous\n', 'utf8');

    const { operation } = await service.runOperation({
      kind: 'resolve-skill-issue',
      title: 'Repaired symlink',
      summary: 'Replaced one copy with a symlink.',
      sourceMode: 'sandbox',
      entity: { type: 'skill', name: 'agent-skill' },
      affectedPaths: [linkedPath],
      undoable: true,
    }, async () => {
      await rm(linkedPath, { recursive: true, force: true });
      await symlink(canonicalPath, linkedPath);
    });
    await rm(linkedPath, { force: true });
    await symlink(externalPath, linkedPath);

    const result = await service.undoOperation(operation.id);

    await expect(readFile(path.join(linkedPath, 'SKILL.md'), 'utf8')).resolves.toBe('name: external\n');
    expect(result.operation).toMatchObject({
      id: operation.id,
      status: 'undo-blocked',
      undoState: 'blocked',
    });
    expect(result.blockedPath).toBe(linkedPath);
  });

  it('skips malformed JSONL records while preserving readable audit entries', async () => {
    const { paths, root } = await createTempPaths('audit-malformed-');
    const service = createAuditLogService({ paths });
    const configPath = path.join(root, 'config.json');

    await service.runOperation({
      kind: 'settings-update',
      title: 'Updated settings',
      summary: 'Custom scan paths changed.',
      sourceMode: 'sandbox',
      entity: { type: 'settings' },
      affectedPaths: [configPath],
      undoable: true,
    }, async () => {
      await writeFile(configPath, '{"customScanPaths":["/tmp/skills"]}\n', 'utf8');
    });
    await writeFile(paths.auditLogFile, `${await readFile(paths.auditLogFile, 'utf8')}{not-json`, 'utf8');

    await expect(service.readOperations()).resolves.toHaveLength(1);
  });

  it('does not mark interrupted operations as completed', async () => {
    const { paths } = await createTempPaths('audit-interrupted-');
    const service = createAuditLogService({ paths });

    await mkdir(path.dirname(paths.auditLogFile), { recursive: true });
    await writeFile(paths.auditLogFile, `${JSON.stringify({
      recordKind: 'operation-started',
      operation: {
        id: 'started-only',
        kind: 'settings-update',
        title: 'Started only',
        summary: 'No completion record was written.',
        startedAt: '2026-05-16T00:00:00.000Z',
        actor: 'app',
        sourceMode: 'sandbox',
        undoable: true,
        sessionId: 'test-session',
      },
    })}\n`, 'utf8');

    const operations = await service.readOperations();
    expect(operations[0]).toMatchObject({
      id: 'started-only',
      status: 'failed',
      undoState: 'not-undoable',
    });
  });

  it('records file actions caused by failed operations', async () => {
    const { paths } = await createTempPaths('audit-failed-mutation-');
    const service = createAuditLogService({ paths });
    const dismissedSignature = JSON.stringify({
      name: 'codex:codex-result-handling',
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
      locations: [{
        path: '/plugins/codex/skills/codex-result-handling',
        fileType: 'real-file',
        resolvedPath: '/plugins/codex/skills/codex-result-handling',
        contentHash: 'same-content',
      }],
    });

    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeFile(paths.configFile, `${JSON.stringify({
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [dismissedSignature],
      dismissedMcpSignatures: [],
    }, null, 2)}\n`, 'utf8');
    await writeFile(paths.cacheFile, `${JSON.stringify({
      skills: [{
        name: 'codex:codex-result-handling',
        structuralState: 'missing-symlinks',
        issueReasons: ['missing-symlinks'],
        driftPresentation: 'active',
        driftSignature: dismissedSignature,
      }],
    })}\n`, 'utf8');

    await expect(service.runOperation({
      kind: 'resolve-skill-issue',
      title: 'Resolved codex result handling',
      summary: 'Repair failed after mutating config.',
      sourceMode: 'live',
      entity: { type: 'skill', name: 'codex:codex-result-handling' },
      affectedPaths: [paths.configFile],
      undoable: true,
    }, async () => {
      await writeFile(paths.configFile, `${JSON.stringify({
        customScanPaths: [],
        preferredCanonicalSourcePath: null,
        dismissedDriftSignatures: [],
        dismissedMcpSignatures: [],
      }, null, 2)}\n`, 'utf8');
      throw new Error('repair failed');
    })).rejects.toThrow('repair failed');

    const [operation] = await service.readOperations();
    expect(operation).toMatchObject({
      status: 'failed',
      actionCount: 1,
      undoState: 'not-undoable',
    });
    expect(operation.actions[0]?.diagnostics?.dismissedDriftSignatures?.removed[0]).toMatchObject({
      signature: {
        name: 'codex:codex-result-handling',
      },
      currentSkill: {
        name: 'codex:codex-result-handling',
        signatureMatches: true,
      },
    });
  });

  it('exposes failed operation error details for issue reports', async () => {
    const { paths } = await createTempPaths('audit-failure-trace-');
    const service = createAuditLogService({ paths });
    const error = new Error('MCP "stale-mcp" no longer has Missing From Agents.');

    await expect(service.runOperation({
      kind: 'resolve-mcp-issue',
      title: 'Resolved Missing From Agents for stale-mcp',
      summary: 'Resolution failed before mutating configs.',
      sourceMode: 'sandbox',
      entity: { type: 'mcp', name: 'stale-mcp' },
      affectedPaths: [],
      undoable: false,
    }, () => Promise.reject(error))).rejects.toThrow('MCP "stale-mcp" no longer has Missing From Agents.');

    const [operation] = await service.readOperations();
    expect(operation).toMatchObject({
      status: 'failed',
      failure: {
        message: 'MCP "stale-mcp" no longer has Missing From Agents.',
      },
    });
    expect(operation.failure?.trace).toContain('MCP "stale-mcp" no longer has Missing From Agents.');
    expect(operation.failure?.trace).toContain('audit-log.test.ts');
  });

  it('blocks undo when permissions changed after the audited write', async () => {
    const { paths, root } = await createTempPaths('audit-mode-change-');
    const service = createAuditLogService({ paths });
    const configPath = path.join(root, 'config.json');

    const { operation } = await service.runOperation({
      kind: 'settings-update',
      title: 'Updated settings',
      summary: 'Custom scan paths changed.',
      sourceMode: 'sandbox',
      entity: { type: 'settings' },
      affectedPaths: [configPath],
      undoable: true,
    }, async () => {
      await writeFile(configPath, '{"customScanPaths":["/tmp/skills"]}\n', { mode: 0o600 });
    });
    await chmod(configPath, 0o644);

    const result = await service.undoOperation(operation.id);

    expect(result.operation).toMatchObject({
      status: 'undo-blocked',
      undoState: 'blocked',
    });
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{"customScanPaths":["/tmp/skills"]}\n');
  });

  it('records oversized snapshots as not undoable summary actions', async () => {
    const { paths, root } = await createTempPaths('audit-oversized-');
    const service = createAuditLogService({ paths });
    const largePath = path.join(root, 'large-skill', 'SKILL.md');

    await service.runOperation({
      kind: 'add-skill',
      title: 'Added large skill',
      summary: 'One large file created.',
      sourceMode: 'sandbox',
      entity: { type: 'skill', name: 'large-skill' },
      affectedPaths: [path.dirname(largePath)],
      undoable: true,
    }, async () => {
      await mkdir(path.dirname(largePath), { recursive: true });
      await writeFile(largePath, 'x'.repeat(1024 * 1024 + 1), 'utf8');
    });

    const [operation] = await service.readOperations();
    expect(operation).toMatchObject({
      actionCount: 1,
      undoState: 'not-undoable',
    });
    expect(operation.actions[0]?.after).toMatchObject({
      kind: 'unknown',
    });
    await expect(readFile(paths.auditLogFile, 'utf8')).resolves.not.toContain('undoSnapshot');
  });

  it('records compact diagnostics when dismissed drift signatures are pruned', async () => {
    const { paths } = await createTempPaths('audit-dismissal-diagnostics-');
    const service = createAuditLogService({ paths });
    const dismissedSignature = JSON.stringify({
      name: 'tools:plugin-only',
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
      locations: [{
        path: '/plugins/tools/skills/plugin-only',
        fileType: 'real-file',
        resolvedPath: '/plugins/tools/skills/plugin-only',
        contentHash: 'old-content',
      }],
    });
    const currentSignature = JSON.stringify({
      name: 'tools:plugin-only',
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
      locations: [{
        path: '/plugins/tools/skills/plugin-only',
        fileType: 'real-file',
        resolvedPath: '/plugins/tools/skills/plugin-only',
        contentHash: 'new-content',
      }],
    });

    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeFile(paths.configFile, `${JSON.stringify({
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [dismissedSignature],
      dismissedMcpSignatures: [],
    }, null, 2)}\n`, 'utf8');
    await writeFile(paths.cacheFile, `${JSON.stringify({
      skills: [{
        name: 'tools:plugin-only',
        structuralState: 'missing-symlinks',
        issueReasons: ['missing-symlinks'],
        driftPresentation: 'active',
        driftSignature: currentSignature,
      }],
    })}\n`, 'utf8');

    const { operation } = await service.runOperation({
      kind: 'resolve-skill-issue',
      title: 'Resolved another skill',
      summary: 'Another skill was repaired.',
      sourceMode: 'live',
      entity: { type: 'skill', name: 'other-skill' },
      affectedPaths: [paths.configFile],
      undoable: true,
    }, async () => {
      await writeFile(paths.configFile, `${JSON.stringify({
        customScanPaths: [],
        preferredCanonicalSourcePath: null,
        dismissedDriftSignatures: [],
        dismissedMcpSignatures: [],
      }, null, 2)}\n`, 'utf8');
    });

    const [action] = operation.actions;
    expect(action?.diagnostics?.dismissedDriftSignatures?.removed[0]).toMatchObject({
      signature: {
        name: 'tools:plugin-only',
        issueReasons: ['missing-symlinks'],
        locations: [
          expect.objectContaining({ contentHash: 'old-content' }),
        ],
      },
      currentSkill: {
        name: 'tools:plugin-only',
        driftPresentation: 'active',
        signatureMatches: false,
        signatureDiffFields: ['locations./plugins/tools/skills/plugin-only.contentHash'],
        driftSignature: {
          locations: [
            expect.objectContaining({ contentHash: 'new-content' }),
          ],
        },
      },
    });
  });

  it('compares drift signature locations without paths by index', async () => {
    const { paths } = await createTempPaths('audit-dismissal-index-diagnostics-');
    const service = createAuditLogService({ paths });
    const dismissedSignature = JSON.stringify({
      name: 'tools:plugin-only',
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
      locations: [{
        fileType: 'real-file',
        resolvedPath: '/plugins/tools/skills/plugin-only',
        contentHash: 'same-content',
      }],
    });
    const currentSignature = JSON.stringify({
      name: 'tools:plugin-only',
      structuralState: 'missing-symlinks',
      issueReasons: ['missing-symlinks'],
      locations: [{
        fileType: 'real-file',
        resolvedPath: '/plugins/tools/skills/plugin-only',
        contentHash: 'same-content',
      }],
    });

    await mkdir(path.dirname(paths.configFile), { recursive: true });
    await writeFile(paths.configFile, `${JSON.stringify({
      customScanPaths: [],
      preferredCanonicalSourcePath: null,
      dismissedDriftSignatures: [dismissedSignature],
      dismissedMcpSignatures: [],
    }, null, 2)}\n`, 'utf8');
    await writeFile(paths.cacheFile, `${JSON.stringify({
      skills: [{
        name: 'tools:plugin-only',
        structuralState: 'missing-symlinks',
        issueReasons: ['missing-symlinks'],
        driftPresentation: 'active',
        driftSignature: currentSignature,
      }],
    })}\n`, 'utf8');

    const { operation } = await service.runOperation({
      kind: 'resolve-skill-issue',
      title: 'Resolved another skill',
      summary: 'Another skill was repaired.',
      sourceMode: 'live',
      entity: { type: 'skill', name: 'other-skill' },
      affectedPaths: [paths.configFile],
      undoable: true,
    }, async () => {
      await writeFile(paths.configFile, `${JSON.stringify({
        customScanPaths: [],
        preferredCanonicalSourcePath: null,
        dismissedDriftSignatures: [],
        dismissedMcpSignatures: [],
      }, null, 2)}\n`, 'utf8');
    });

    expect(operation.actions[0]?.diagnostics?.dismissedDriftSignatures?.removed[0]?.currentSkill?.signatureDiffFields)
      .toEqual([]);
  });
});

async function createTempPaths(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const paths = resolveSkillIndexPaths({
    env: {
      SKILL_INDEX_DATA_DIR: path.join(root, '.skillindex'),
      SKILL_INDEX_SANDBOX_ROOT: path.join(root, '.skillindex', 'sandbox'),
    },
    homeDir: root,
  });

  return { paths, root };
}
