// @vitest-environment node

import { mkdirSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInventoryRuntime } from '@main/inventory-runtime';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import type { AuditOperation, McpConnectivityRecord, SkillInventorySnapshot } from '@shared/contracts';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

interface FakeWatcher {
  close(): void;
  emit(filePath?: string): void;
  closed: boolean;
}

describe('inventory runtime', () => {
  const runtimes: Array<ReturnType<typeof createInventoryRuntime>> = [];

  afterEach(() => {
    for (const runtime of runtimes.splice(0)) {
      runtime.dispose();
    }
  });

  it('discovers newly available sources on rescan, rewrites cache, and starts watcher coverage immediately', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    const updates: string[][] = [];
    runtime.onDidUpdate((snapshot) => {
      updates.push(snapshot.skills.map((skill) => skill.name));
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'existing-skill', '# Existing skill\n', '2026-04-09T00:00:00.000Z');

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(initialSnapshot.sourceIds).toEqual(['sandbox-agents']);
    expect(fakeWatchers.has('sandbox-agents')).toBe(true);

    const factorySkillsDir = path.join(paths.sandboxRoot, '.factory', 'skills');
    await writeSkillFile(factorySkillsDir, 'discovered-skill', '# Discovered after launch\n', '2026-04-09T00:01:00.000Z');

    const rescannedSnapshot = await runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(rescannedSnapshot.sourceIds).toEqual(['sandbox-agents', 'sandbox-factory']);
    expect(rescannedSnapshot.skills.map((skill) => skill.name)).toEqual(['discovered-skill', 'existing-skill']);
    expect(fakeWatchers.has('sandbox-factory')).toBe(true);

    const cacheAfterRescan = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      sourceIds: string[];
      skills: Array<{ name: string }>;
    };
    expect(cacheAfterRescan.sourceIds).toEqual(['sandbox-agents', 'sandbox-factory']);
    expect(cacheAfterRescan.skills.map((skill) => skill.name)).toEqual(['discovered-skill', 'existing-skill']);

    await writeSkillFile(factorySkillsDir, 'watcher-added-skill', '# Added after rescan\n', '2026-04-09T00:02:00.000Z');
    fakeWatchers.get('sandbox-factory')?.emit();

    await waitFor(() => {
      expect(updates.at(-1)).toEqual(['discovered-skill', 'existing-skill', 'watcher-added-skill']);
    });

    const cacheAfterWatch = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      skills: Array<{ name: string }>;
    };
    expect(cacheAfterWatch.skills.map((skill) => skill.name)).toEqual([
      'discovered-skill',
      'existing-skill',
      'watcher-added-skill',
    ]);
  });

  it('returns the queued full refresh when a rescan is requested during an in-flight refresh', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-queued-refresh-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    const queuedRescan: { current?: Promise<SkillInventorySnapshot> } = {};
    runtime.onDidUpdate((snapshot) => {
      if (queuedRescan.current || !snapshot.skills.some((skill) => skill.name === 'existing-skill')) {
        return;
      }

      const queuedSkillDir = path.join(paths.sandboxAgentsSkillsDir, 'queued-skill');
      mkdirSync(queuedSkillDir, { recursive: true });
      writeFileSync(path.join(queuedSkillDir, 'SKILL.md'), '# Queued skill\n', 'utf8');
      queuedRescan.current = runtime.rescanInventory({
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
      });
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'existing-skill', '# Existing skill\n', '2026-04-09T00:00:00.000Z');

    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    if (!queuedRescan.current) {
      throw new Error('Expected the in-flight update callback to request a queued rescan.');
    }
    const queuedSnapshot = await queuedRescan.current;
    expect(queuedSnapshot.skills.map((skill) => skill.name)).toContain('queued-skill');
  });

  it('keeps installed-but-undiscovered agent dirs in missing-symlink state until the dir appears', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'pending-source-skill', '# Pending source skill\n', '2026-04-09T00:00:00.000Z');
    await mkdir(path.join(paths.sandboxRoot, '.factory'), { recursive: true });
    await writeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n', 'utf8');

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(initialSnapshot.sourceIds).toEqual(['sandbox-agents']);
    expect(initialSnapshot.skills.find((skill) => skill.name === 'pending-source-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
    });
    expect(fakeWatchers.has('sandbox-factory')).toBe(false);

    const factorySkillsDir = path.join(paths.sandboxRoot, '.factory', 'skills');
    await writeSkillFile(factorySkillsDir, 'pending-source-skill', '# Pending source skill\n', '2026-04-09T00:00:01.000Z');

    const rescannedSnapshot = await runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(rescannedSnapshot.sourceIds).toEqual(['sandbox-agents', 'sandbox-factory']);
    expect(rescannedSnapshot.skills.find((skill) => skill.name === 'pending-source-skill')).toMatchObject({
      structuralState: 'identical-drift',
      isDrifted: true,
    });
    expect(fakeWatchers.has('sandbox-factory')).toBe(true);
  });

  it('drops disappeared sources on rescan, prunes cache, detaches watchers, and ignores later filesystem activity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    const updateSnapshots: string[][] = [];
    runtime.onDidUpdate((snapshot) => {
      updateSnapshots.push(snapshot.skills.map((skill) => skill.name));
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'stable-skill', '# Stable skill\n', '2026-04-09T00:00:00.000Z');
    const factorySkillsDir = path.join(paths.sandboxRoot, '.factory', 'skills');
    await writeSkillFile(factorySkillsDir, 'removed-source-skill', '# Removed source skill\n', '2026-04-09T00:01:00.000Z');

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(initialSnapshot.sourceIds).toEqual(['sandbox-agents', 'sandbox-factory']);
    const removedWatcher = fakeWatchers.get('sandbox-factory');
    expect(removedWatcher).toBeDefined();

    await rm(path.join(paths.sandboxRoot, '.factory'), { recursive: true, force: true });

    const rescannedSnapshot = await runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(rescannedSnapshot.sourceIds).toEqual(['sandbox-agents']);
    expect(rescannedSnapshot.skills.map((skill) => skill.name)).toEqual(['stable-skill']);
    expect(removedWatcher?.closed).toBe(true);

    const cacheAfterRemoval = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      sourceIds: string[];
      skills: Array<{ name: string }>;
    };
    expect(cacheAfterRemoval.sourceIds).toEqual(['sandbox-agents']);
    expect(cacheAfterRemoval.skills.map((skill) => skill.name)).toEqual(['stable-skill']);

    const updateCountBeforeIgnoredEvent = updateSnapshots.length;
    await writeSkillFile(factorySkillsDir, 'should-stay-hidden', '# Hidden until rescan\n', '2026-04-09T00:02:00.000Z');
    removedWatcher?.emit();

    await delay(25);

    expect(updateSnapshots).toHaveLength(updateCountBeforeIgnoredEvent);
    const cacheAfterIgnoredEvent = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      sourceIds: string[];
      skills: Array<{ name: string }>;
    };
    expect(cacheAfterIgnoredEvent.sourceIds).toEqual(['sandbox-agents']);
    expect(cacheAfterIgnoredEvent.skills.map((skill) => skill.name)).toEqual(['stable-skill']);
  });

  it('incrementally reconciles watcher create, edit, and delete events for active agent-managed sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    const updates: Array<{ driftedSkills: number; structuralState: string }> = [];
    runtime.onDidUpdate((snapshot) => {
      const watchedSkill = snapshot.skills.find((skill) => skill.name === 'watched-skill');
      if (watchedSkill) {
        updates.push({
          driftedSkills: snapshot.counts.driftedSkills,
          structuralState: watchedSkill.structuralState,
        });
      }
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'watched-skill', '# Watched skill\n', '2026-04-09T00:00:00.000Z');
    const factorySkillsDir = path.join(paths.sandboxRoot, '.factory', 'skills');
    await mkdir(factorySkillsDir, { recursive: true });

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(initialSnapshot.skills.find((skill) => skill.name === 'watched-skill')).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
    });
    expect(fakeWatchers.has('sandbox-factory')).toBe(true);

    const watchedSkillPath = path.join(factorySkillsDir, 'watched-skill', 'SKILL.md');
    await writeSkillFile(factorySkillsDir, 'watched-skill', '# Watched skill\n', '2026-04-09T00:01:00.000Z');
    fakeWatchers.get('sandbox-factory')?.emit(watchedSkillPath);

    await waitFor(() => {
      expect(updates.at(-1)).toEqual({
        driftedSkills: 1,
        structuralState: 'identical-drift',
      });
    });

    await writeSkillFile(factorySkillsDir, 'watched-skill', '# Diverged watched skill\n', '2026-04-09T00:02:00.000Z');
    fakeWatchers.get('sandbox-factory')?.emit(watchedSkillPath);

    await waitFor(() => {
      expect(updates.at(-1)).toEqual({
        driftedSkills: 1,
        structuralState: 'diverged-drift',
      });
    });

    await rm(watchedSkillPath);
    fakeWatchers.get('sandbox-factory')?.emit(watchedSkillPath);

    await waitFor(() => {
      expect(updates.at(-1)).toEqual({
        driftedSkills: 1,
        structuralState: 'missing-symlinks',
      });
    });

    const cachedSnapshot = JSON.parse(await readFile(paths.cacheFile, 'utf8')) as {
      counts: { driftedSkills: number };
      skills: Array<{ name: string; structuralState: string; locations: Array<{ path: string }> }>;
    };
    expect(cachedSnapshot.counts.driftedSkills).toBe(1);
    expect(cachedSnapshot.skills.find((skill) => skill.name === 'watched-skill')).toMatchObject({
      name: 'watched-skill',
      structuralState: 'missing-symlinks',
      locations: [
        {
          path: path.join(paths.sandboxAgentsSkillsDir, 'watched-skill'),
        },
      ],
    });
  });

  it('uses the startup observation aid only for the initial scan and not manual rescans', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'observed-skill', '# Observed skill\n', '2026-04-09T00:00:00.000Z');

    const startupObservationAid = {
      beforeInitialReconciliation: vi.fn().mockResolvedValue(undefined),
      releaseInitialReconciliation: vi.fn(),
    };
    const runtime = createInventoryRuntime({
      startupObservationAid,
    });
    runtimes.push(runtime);

    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    await runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(startupObservationAid.beforeInitialReconciliation).toHaveBeenCalledTimes(1);
  });

  it('persists dismissed drift across rescans and re-shows it after a watcher-driven signature change', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);
    const updates: Array<{ driftPresentation: string; driftedSkills: number; dismissedDriftSkills: number; driftSignature?: string }> = [];
    runtime.onDidUpdate((snapshot) => {
      const watchedSkill = snapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill');
      if (watchedSkill) {
        updates.push({
          driftPresentation: watchedSkill.driftPresentation,
          driftedSkills: snapshot.counts.driftedSkills,
          dismissedDriftSkills: snapshot.counts.dismissedDriftSkills,
          driftSignature: watchedSkill.driftSignature,
        });
      }
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'dismissed-runtime-skill', '# Dismissed runtime skill\n', '2026-04-09T00:00:00.000Z');
    const factorySkillsDir = path.join(paths.sandboxRoot, '.factory', 'skills');
    const factorySkillPath = path.join(factorySkillsDir, 'dismissed-runtime-skill', 'SKILL.md');
    await writeSkillFile(factorySkillsDir, 'dismissed-runtime-skill', '# Dismissed runtime skill\n', '2026-04-09T00:00:01.000Z');

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const initialSkill = initialSnapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill');

    expect(initialSkill).toMatchObject({
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'active',
    });

    const beforeDismissFileSnapshot = await readFile(factorySkillPath, 'utf8');
    const dismissedSnapshot = await runtime.dismissDrift({
      skillName: 'dismissed-runtime-skill',
    });
    const dismissedSkill = dismissedSnapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill');

    expect(dismissedSkill).toMatchObject({
      structuralState: 'identical-drift',
      isDrifted: true,
      driftPresentation: 'dismissed',
    });
    expect(dismissedSnapshot.counts).toMatchObject({
      driftedSkills: 0,
      dismissedDriftSkills: 1,
    });
    expect(await readFile(factorySkillPath, 'utf8')).toBe(beforeDismissFileSnapshot);
    const configAfterDismiss = JSON.parse(await readFile(paths.configFile, 'utf8')) as {
      dismissedDriftSignatures: string[];
    };
    expect(configAfterDismiss.dismissedDriftSignatures).toContain(initialSkill?.driftSignature);
    expect(dismissedSkill?.driftSignature).toBe(initialSkill?.driftSignature);

    const rescannedSnapshot = await runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    expect(rescannedSnapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill')?.driftPresentation).toBe('dismissed');

    await writeSkillFile(factorySkillsDir, 'dismissed-runtime-skill', '# Changed after dismissal\n', '2026-04-09T00:00:02.000Z');
    fakeWatchers.get('sandbox-factory')?.emit(factorySkillPath);

    await waitFor(() => {
      expect(updates.at(-1)).toMatchObject({
        driftPresentation: 'active',
        driftedSkills: 1,
        dismissedDriftSkills: 0,
      });
    });

    const reappearedSnapshot = await runtime.readCachedInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const reappearedSkill = reappearedSnapshot?.skills.find((skill) => skill.name === 'dismissed-runtime-skill');
    expect(reappearedSkill?.driftPresentation).toBe('active');
    expect(reappearedSkill?.driftSignature).not.toBe(initialSkill?.driftSignature);
  });

  it('clears stale dismissal state after resolution so the same drift signature reappears as active when rediscovered later', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    const updates: Array<{ driftPresentation: string; driftSignature?: string }> = [];
    runtime.onDidUpdate((snapshot) => {
      const watchedSkill = snapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill');
      if (watchedSkill) {
        updates.push({
          driftPresentation: watchedSkill.driftPresentation,
          driftSignature: watchedSkill.driftSignature,
        });
      }
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'dismissed-runtime-skill', '# Dismissed runtime skill\n', '2026-04-09T00:00:00.000Z');
    const factorySkillsDir = path.join(paths.sandboxRoot, '.factory', 'skills');
    const factorySkillRoot = path.join(factorySkillsDir, 'dismissed-runtime-skill');
    const factorySkillPath = path.join(factorySkillsDir, 'dismissed-runtime-skill', 'SKILL.md');
    await writeSkillFile(factorySkillsDir, 'dismissed-runtime-skill', '# Dismissed runtime skill\n', '2026-04-09T00:00:01.000Z');

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const initialSkill = initialSnapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill');
    expect(initialSkill?.driftSignature).toBeDefined();

    await runtime.dismissDrift({
      skillName: 'dismissed-runtime-skill',
    });

    const resolvedSnapshot = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'identical-copies',
      skillName: 'dismissed-runtime-skill',
    });
    expect(resolvedSnapshot.skills.find((skill) => skill.name === 'dismissed-runtime-skill')).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });

    const configAfterResolution = JSON.parse(await readFile(paths.configFile, 'utf8')) as {
      dismissedDriftSignatures: string[];
    };
    expect(configAfterResolution.dismissedDriftSignatures).not.toContain(initialSkill?.driftSignature);

    await rm(factorySkillRoot, { recursive: true, force: true });
    await writeSkillFile(factorySkillsDir, 'dismissed-runtime-skill', '# Dismissed runtime skill\n', '2026-04-09T00:00:03.000Z');
    fakeWatchers.get('sandbox-factory')?.emit(factorySkillPath);

    await waitFor(() => {
      expect(updates.at(-1)).toMatchObject({
        driftPresentation: 'active',
        driftSignature: initialSkill?.driftSignature,
      });
    });
  });

  it('re-seeds the representative sandbox after resolving a skill and restores the seeded issue on rescan', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    await seedRepresentativeFixtures({ paths });

    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const initialSkill = initialSnapshot.skills.find((skill) => skill.name === 'wrong-symlink-target-skill');

    expect(initialSkill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
    });

    const resolvedSnapshot = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'wrong-symlink-target',
      skillName: 'wrong-symlink-target-skill',
    });
    const resolvedSkill = resolvedSnapshot.skills.find((skill) => skill.name === 'wrong-symlink-target-skill');

    expect(resolvedSkill).toMatchObject({
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
    });

    await seedRepresentativeFixtures({ paths });

    const resetSnapshot = await runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    const resetSkill = resetSnapshot.skills.find((skill) => skill.name === 'wrong-symlink-target-skill');

    expect(resetSkill).toMatchObject({
      structuralState: 'missing-symlinks',
      isDrifted: true,
      driftPresentation: 'active',
    });
    expect(fakeWatchers.has('sandbox-agents')).toBe(true);
    expect(fakeWatchers.has('sandbox-factory')).toBe(true);
  }, 10000);

  it('lets issue dismissal finish while MCP connectivity testing is still running', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-passive-mcp-connectivity-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const connectivityDeferred = createDeferred<McpConnectivityRecord>();
    let connectivityProbeStarted = false;

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    await seedRepresentativeFixtures({ paths });
    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    expect(initialSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')).toMatchObject({
      driftPresentation: 'active',
      structuralState: 'identical-drift',
    });

    const connectivityPromise = runtime.testMcpConnectivity({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      mcpConnectivityConcurrency: 1,
      verifyMcpConnectivity: async () => {
        connectivityProbeStarted = true;
        return connectivityDeferred.promise;
      },
    });

    await waitFor(() => {
      expect(connectivityProbeStarted).toBe(true);
    });

    const dismissPromise = runtime.dismissDrift({
      skillName: 'identical-drift-skill',
    });
    let dismissedSnapshot: SkillInventorySnapshot | undefined;
    void dismissPromise.then(
      (snapshot) => {
        dismissedSnapshot = snapshot;
      },
      () => undefined,
    );

    try {
      await waitFor(() => {
        expect(dismissedSnapshot).toBeDefined();
      }, 1000);
    } finally {
      connectivityDeferred.resolve({
        status: 'verified',
        checkedAt: new Date().toISOString(),
      });
      await Promise.all([connectivityPromise, dismissPromise]);
    }

    const finalDismissedSnapshot = dismissedSnapshot ?? await dismissPromise;
    expect(finalDismissedSnapshot.skills.find((skill) => skill.name === 'identical-drift-skill')).toMatchObject({
      driftPresentation: 'dismissed',
      structuralState: 'identical-drift',
    });
  }, 10000);

  it('keeps accepted plugin alternates during watcher refresh after creating missing symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const fakeWatchers = new Map<string, FakeWatcher>();

    const runtime = createInventoryRuntime({
      watchDebounceMs: 0,
      watchSource: (source, onChange) => {
        const watcher = createFakeWatcher(onChange);
        fakeWatchers.set(source.id, watcher);
        return watcher;
      },
    });
    runtimes.push(runtime);

    const updates: SkillInventorySnapshot[] = [];
    runtime.onDidUpdate((snapshot) => {
      updates.push(snapshot);
    });

    await seedRepresentativeFixtures({ paths });
    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const skillName = 'example-workflow-kit:handoff-notes-with-static';
    const agentsPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);

    const afterDivergedResolution = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'diverged-copies',
      skillName,
      selectedVariantPath: agentsPath,
    });
    const afterDivergedSkill = afterDivergedResolution.skills.find((skill) => skill.name === skillName);

    expect(afterDivergedSkill).toMatchObject({
      issueReasons: ['missing-symlinks'],
    });
    expect(afterDivergedSkill?.detailDiagnostics.acceptedAlternates).toHaveLength(2);

    const afterMissingResolution = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'missing-symlinks',
      skillName,
    });
    const afterMissingSkill = afterMissingResolution.skills.find((skill) => skill.name === skillName);

    expect(afterMissingSkill).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
      driftPresentation: 'none',
    });
    expect(afterMissingSkill?.detailDiagnostics.acceptedAlternates).toHaveLength(2);

    const previousUpdateCount = updates.length;
    fakeWatchers.get('sandbox-claude')?.emit(claudePath);

    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(previousUpdateCount);
    });

    const watchedSkill = updates.at(-1)?.skills.find((skill) => skill.name === skillName);
    expect(watchedSkill).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
      driftPresentation: 'none',
    });
    expect(watchedSkill?.detailDiagnostics.acceptedAlternates).toHaveLength(2);
  });

  it('audits and undoes a missing symlink repair with individual path actions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-audit-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    await seedRepresentativeFixtures({ paths });
    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const skillName = 'missing-symlink-skill';
    const canonicalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    await expect(pathExists(factoryPath)).resolves.toBe(false);

    const resolvedSnapshot = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'missing-symlinks',
      skillName,
    });

    expect(await readlink(factoryPath)).toBe(canonicalPath);
    expect(resolvedSnapshot.skills.find((skill) => skill.name === skillName)?.issueReasons).not.toContain('missing-symlinks');

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      kind: 'resolve-skill-issue',
      title: 'Resolved Missing Symlinks for missing-symlink-skill',
      undoState: 'available',
    });
    expect(operation.actionCount).toBeGreaterThanOrEqual(1);
    const factoryAction = operation.actions.find((action) => action.path === factoryPath);
    expect(factoryAction).toMatchObject({
      kind: 'create-symlink',
      path: factoryPath,
      targetPath: canonicalPath,
      before: { kind: 'absent' },
    });
    expect(factoryAction?.after).toMatchObject({ kind: 'symlink', symlinkTarget: canonicalPath });

    const undoResult = await runtime.undoAuditOperation(operation.id);

    await expect(pathExists(factoryPath)).resolves.toBe(false);
    expect(undoResult.auditLog[0]).toMatchObject({
      id: operation.id,
      status: 'undone',
      undoState: 'used',
    });
    expect(undoResult.inventorySnapshot?.skills.find((skill) => skill.name === skillName)?.issueReasons).toContain('missing-symlinks');
  });

  it('audits Universal decision config writes when resolving plugin-backed skills', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-plugin-audit-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    await seedRepresentativeFixtures({ paths });
    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const skillName = 'example-workflow-kit:handoff-notes-with-static';
    const agentsPath = path.join(paths.sandboxAgentsSkillsDir, skillName);

    await runtime.resolveIssue({
      entity: 'skill',
      issue: 'diverged-copies',
      skillName,
      selectedVariantPath: agentsPath,
    });

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      kind: 'resolve-skill-issue',
      title: `Resolved Diverged Copies for ${skillName}`,
    });
    expect(operation.actions.some((action) => action.path === paths.configFile && action.kind === 'update-app-config')).toBe(true);
  });

  it('writes sandbox audit operations to the sandbox app-state log', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-sandbox-audit-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
    };
    const paths = resolveSkillIndexPaths({ env });
    const sandboxAuditLogFile = path.join(root, 'sandbox-state', 'audit-log.jsonl');

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    await runtime.scanInventory({
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    await runtime.addSkill({
      sourceType: 'markdown',
      skillName: 'sandbox-only-skill',
      markdown: '# Sandbox only skill\n',
    }, {
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await expect(pathExists(paths.auditLogFile)).resolves.toBe(false);
    await expect(pathExists(sandboxAuditLogFile)).resolves.toBe(true);
    const auditLog = await runtime.readAuditLog();
    expect(auditLog[0]).toMatchObject({
      kind: 'add-skill',
      sourceMode: 'sandbox',
      title: 'Added sandbox-only-skill',
    });
  });

  it('audits failed issue resolutions with a shareable failure trace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-failed-resolution-audit-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const auditUpdates: AuditOperation[][] = [];
    runtime.onDidAuditUpdate((operations) => {
      auditUpdates.push(operations);
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'healthy-skill', '# Healthy skill\n', '2026-04-09T00:00:00.000Z');
    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    await expect(runtime.resolveIssue({
      entity: 'skill',
      issue: 'missing-symlinks',
      skillName: 'healthy-skill',
    })).rejects.toThrow('Skill "healthy-skill" no longer has Missing Symlinks.');

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      kind: 'resolve-skill-issue',
      status: 'failed',
      entity: { type: 'skill', name: 'healthy-skill' },
      failure: {
        message: 'Skill "healthy-skill" no longer has Missing Symlinks. Refresh inventory and try again if it still needs attention.',
      },
    });
    expect(operation.failure?.trace).toContain('Skill "healthy-skill" no longer has Missing Symlinks.');
    expect(auditUpdates.at(-1)?.[0]).toMatchObject({
      kind: 'resolve-skill-issue',
      status: 'failed',
      failure: {
        message: 'Skill "healthy-skill" no longer has Missing Symlinks. Refresh inventory and try again if it still needs attention.',
      },
    });
  });

  it('audits failed manual rescans with a shareable failure trace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-failed-rescan-audit-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const auditUpdates: AuditOperation[][] = [];
    runtime.onDidAuditUpdate((operations) => {
      auditUpdates.push(operations);
    });

    await writeSkillFile(paths.sandboxAgentsSkillsDir, 'healthy-skill', '# Healthy skill\n', '2026-04-09T00:00:00.000Z');
    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    await writeFile(paths.configFile, '{not-json', 'utf8');

    await expect(runtime.rescanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    })).rejects.toThrow('Failed to parse Skill Index config');

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      kind: 'inventory-rescan',
      title: 'Inventory rescan failed',
      status: 'failed',
      undoState: 'not-undoable',
    });
    expect(operation.failure?.message).toContain('Failed to parse Skill Index config');
    expect(operation.failure?.trace).toContain('Failed to parse Skill Index config');
    expect(auditUpdates.at(-1)?.[0]).toMatchObject({
      kind: 'inventory-rescan',
      status: 'failed',
    });
    expect(auditUpdates.at(-1)?.[0]?.failure?.message).toContain('Failed to parse Skill Index config');
  });
});

function createFakeWatcher(onChange: (event: { filePath?: string }) => void): FakeWatcher {
  let closed = false;

  return {
    close() {
      closed = true;
    },
    emit(filePath) {
      if (!closed) {
        onChange({ filePath });
      }
    },
    get closed() {
      return closed;
    },
  };
}

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await delay(10);
    }
  }

  assertion();
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

async function writeSkillFile(rootDir: string, skillName: string, content: string, modifiedAt: string): Promise<void> {
  const filePath = path.join(rootDir, skillName, 'SKILL.md');
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalizedContent = content.trimEnd();
  const markdown = normalizedContent.startsWith('---\n')
    ? `${normalizedContent}\n`
    : [
        '---',
        `name: ${skillName}`,
        `description: ${skillName}`,
        '---',
        '',
        normalizedContent,
        '',
      ].join('\n');
  await writeFile(filePath, markdown, 'utf8');
  const timestamp = new Date(modifiedAt);
  await utimes(filePath, timestamp, timestamp);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}
