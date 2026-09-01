// @vitest-environment node

import { mkdirSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInventoryRuntime } from '@main/inventory-runtime';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import type { AuditOperation, McpConnectivityRecord, SkillInventorySnapshot } from '@shared/contracts';
import { defaultConfig, resolveSkillIndexPaths } from '@shared/skill-index-paths';

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

  it('rejects malformed capability actions before creating an audit operation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-invalid-action-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    await expect(runtime.applyCapabilityAction({
      entity: 'unknown', action: 'update-universal-from-plugin', capabilityName: 'demo', selectedVariantPath: '/tmp/demo',
    } as never, { paths, includeSandboxSources: true, includeLiveSources: false })).rejects.toThrow('Invalid plugin update request.');
    expect(await runtime.readAuditLog({}, { paths, includeSandboxSources: true, includeLiveSources: false })).toEqual([]);
  });

  it.each([
    { entity: 'skill' as const, issue: 'missing-canonical' as const, capabilityName: 'runtime-ambiguous:foo', selection: undefined },
    { entity: 'skill' as const, issue: 'missing-canonical' as const, capabilityName: 'runtime-ambiguous:foo', selection: '/stale/plugin/skill' },
    { entity: 'mcp' as const, issue: 'missing-universal' as const, capabilityName: 'runtime-ambiguous:service', selection: undefined },
    { entity: 'mcp' as const, issue: 'missing-universal' as const, capabilityName: 'runtime-ambiguous:service', selection: '/stale/plugin/.mcp.json' },
    { entity: 'subagent' as const, issue: 'missing-universal' as const, capabilityName: 'runtime-ambiguous:reviewer', selection: undefined },
    { entity: 'subagent' as const, issue: 'missing-universal' as const, capabilityName: 'runtime-ambiguous:reviewer', selection: '/stale/plugin/reviewer.md' },
  ])('requires an explicit current candidate for ambiguous plugin-only $entity promotion ($selection)', async ({
    entity,
    issue,
    capabilityName,
    selection,
  }) => {
    const root = await mkdtemp(path.join(tmpdir(), `skillindex-runtime-ambiguous-${entity}-`));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoots = ['1.0.0', '1.1.0'].map((version) =>
      path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-ambiguous', version));
    const pluginFiles: string[] = [];
    await Promise.all([
      mkdir(paths.sandboxAgentsSkillsDir, { recursive: true }),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), 'model = "gpt-5"\n'),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
      ...pluginRoots.flatMap((pluginRoot, index) => {
        const version = index === 0 ? '1.0.0' : '1.1.0';
        const skillPath = path.join(pluginRoot, 'skills', 'foo', 'SKILL.md');
        const subagentPath = path.join(pluginRoot, 'agents', 'reviewer.md');
        const mcpPath = path.join(pluginRoot, '.mcp.json');
        pluginFiles.push(skillPath, subagentPath, mcpPath);
        return [
          writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-ambiguous', version })),
          writeRuntimeFile(skillPath, `---\nname: foo\ndescription: Plugin foo ${version}\n---\nSkill ${version}.\n`),
          writeRuntimeFile(subagentPath, `---\nname: reviewer\ndescription: Plugin reviewer ${version}\n---\nReview ${version}.\n`),
          writeRuntimeFile(mcpPath, `${JSON.stringify({ mcpServers: { service: { command: 'node', args: [`service-${version}.js`] } } }, null, 2)}\n`),
        ];
      }),
    ]);
    const scanOptions = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' },
    } as const;
    const before = await runtime.scanInventory(scanOptions);
    const cacheBytesBefore = await Promise.all(pluginFiles.map((filePath) => readFile(filePath)));
    expect(entity === 'skill'
      ? before.skills.find((record) => record.name === capabilityName)?.managedSourceCandidates
      : entity === 'mcp'
        ? before.mcps?.find((record) => record.name === capabilityName)?.managedSourceCandidates
        : before.subagents?.find((record) => record.name === capabilityName)?.managedSourceCandidates).toHaveLength(2);

    const request = entity === 'skill'
      ? { entity, issue, skillName: capabilityName, ...(selection ? { selectedVariantPath: selection } : {}) }
      : entity === 'mcp'
        ? { entity, issue, mcpName: capabilityName, ...(selection ? { selectedVariantPath: selection } : {}) }
        : { entity, issue, subagentName: capabilityName, ...(selection ? { selectedVariantPath: selection } : {}) };
    await expect(runtime.resolveIssue(request)).rejects.toThrow(/select|selected|candidate/i);

    expect((await runtime.readAuditLog()).every((operation) => operation.status === 'failed')).toBe(true);
    await expect(pathExists(path.join(paths.sandboxRoot, '.agents', 'skills', capabilityName))).resolves.toBe(false);
    await expect(pathExists(path.join(paths.sandboxRoot, '.agents', 'agents', 'runtime-ambiguous-reviewer.md'))).resolves.toBe(false);
    await expect(pathExists(path.join(paths.sandboxRoot, '.agents', 'mcp.json'))).resolves.toBe(false);
    for (const [index, filePath] of pluginFiles.entries()) {
      expect(await readFile(filePath)).toEqual(cacheBytesBefore[index]);
    }
  });

  it('does not create an audit operation or mutate files when the fresh action scan fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-action-scan-failure-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'scan-failure-tools', '1.0.0');
    const pluginSkill = path.join(pluginRoot, 'skills', 'reviewer');
    const universal = path.join(paths.sandboxRoot, '.agents', 'skills', 'scan-failure-tools:reviewer');
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false, env: { SKILL_INDEX_AGENT_SUBSET: 'codex' } } as const;
    await Promise.all([
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'scan-failure-tools', version: '1.0.0' })),
      writeRuntimeFile(path.join(pluginSkill, 'SKILL.md'), '# Plugin reviewer\n'),
      writeRuntimeFile(path.join(universal, 'SKILL.md'), '# Universal reviewer\n'),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), '[plugins."scan-failure-tools@official"]\nenabled = true\n'),
    ]);
    await runtime.scanInventory(scanOptions);
    const universalBefore = await readFile(path.join(universal, 'SKILL.md'), 'utf8');
    const cacheBefore = await readFile(paths.cacheFile, 'utf8');

    await expect(runtime.applyCapabilityAction({
      entity: 'skill', action: 'update-universal-from-plugin', capabilityName: 'scan-failure-tools:reviewer', selectedVariantPath: pluginSkill,
    }, {
      ...scanOptions,
      paths: { ...paths, configFile: paths.sandboxRoot },
    })).rejects.toThrow(/Failed to read Skill Index config/i);

    expect(await runtime.readAuditLog({}, scanOptions)).toEqual([]);
    expect(await readFile(path.join(universal, 'SKILL.md'), 'utf8')).toBe(universalBefore);
    expect(await readFile(paths.cacheFile, 'utf8')).toBe(cacheBefore);
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
    const connectivityProbeStarted = createDeferred<void>();

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
        connectivityProbeStarted.resolve();
        return connectivityDeferred.promise;
      },
    });

    await connectivityProbeStarted.promise;

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

  it('cancels MCP connectivity testing without publishing failed connection results', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-cancel-mcp-connectivity-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const connectivityDeferred = createDeferred<McpConnectivityRecord>();
    const connectivityProbeStarted = createDeferred<void>();

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    const updates: SkillInventorySnapshot[] = [];
    runtime.onDidUpdate((snapshot) => {
      updates.push(snapshot);
    });

    await seedRepresentativeFixtures({ paths });
    const initialSnapshot = await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const connectivityPromise = runtime.testMcpConnectivity({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      mcpConnectivityConcurrency: 1,
      verifyMcpConnectivity: async () => {
        connectivityProbeStarted.resolve();
        return connectivityDeferred.promise;
      },
    });

    await connectivityProbeStarted.promise;

    runtime.cancelMcpConnectivityTest();

    connectivityDeferred.resolve({
      status: 'failed',
      checkedAt: '2026-05-28T12:00:00.000Z',
      error: 'Canceled run should not publish this failure.',
    });

    const canceledSnapshot = await connectivityPromise;

    expect(canceledSnapshot).toBe(initialSnapshot);
    expect(updates).toHaveLength(1);
    expect((updates[0].mcps ?? []).flatMap((mcp) => mcp.issueReasons)).not.toContain('connection-failed');
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
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);

    const afterDivergedResolution = await runtime.applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName,
      selectedVariantPath: agentsPath,
    });
    const afterDivergedSkill = afterDivergedResolution.skills.find((skill) => skill.name === skillName);

    expect(afterDivergedSkill).toMatchObject({ issueReasons: [] });
    expect(afterDivergedSkill?.detailDiagnostics.acceptedAlternates).toHaveLength(2);

    const afterMissingResolution = afterDivergedResolution;
    const afterMissingSkill = afterMissingResolution.skills.find((skill) => skill.name === skillName);

    expect(afterMissingSkill).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
      driftPresentation: 'none',
    });
    expect(afterMissingSkill?.detailDiagnostics.acceptedAlternates).toHaveLength(2);

    const previousUpdateCount = updates.length;
    fakeWatchers.get('sandbox-factory')?.emit(factoryPath);

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

  it('audits and undoes removing a skill package moved to Trash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-remove-audit-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });
    const trashedPaths: string[] = [];

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    const skillName = 'trashable-skill';
    const skillPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    await writeSkillFile(paths.sandboxAgentsSkillsDir, skillName, '# Trashable skill\n', '2026-04-09T00:00:00.000Z');
    await runtime.scanInventory({
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const removedSnapshot = await runtime.removeInventoryItem(
      { entity: 'skill', skillName },
      {
        paths,
        includeSandboxSources: true,
        includeLiveSources: false,
        trashItem: async (targetPath) => {
          trashedPaths.push(targetPath);
          await rm(targetPath, { recursive: true, force: true });
        },
      },
    );

    expect(trashedPaths).toEqual([skillPath]);
    expect(removedSnapshot.skills.some((skill) => skill.name === skillName)).toBe(false);
    await expect(pathExists(skillPath)).resolves.toBe(false);

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      kind: 'remove-inventory-item',
      title: `Removed ${skillName}`,
      undoState: 'available',
    });
    expect(operation.actions).toHaveLength(1);
    expect(operation.actions[0]).toMatchObject({
      kind: 'delete-path',
      path: skillPath,
      before: { kind: 'directory' },
      after: { kind: 'absent' },
    });

    const undoResult = await runtime.undoAuditOperation(operation.id);

    await expect(pathExists(path.join(skillPath, 'SKILL.md'))).resolves.toBe(true);
    expect(undoResult.auditLog[0]).toMatchObject({
      id: operation.id,
      status: 'undone',
      undoState: 'used',
    });
    expect(undoResult.inventorySnapshot?.skills.some((skill) => skill.name === skillName)).toBe(true);
  });

  it('excludes managed plugin cache candidates from mixed removal audit actions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-remove-plugin-audit-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const skillName = 'audit-plugin:shared-skill';
    const universalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const pluginPath = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'audit-plugin', '1.0.0', 'skills', 'shared-skill');
    const trashedPaths: string[] = [];

    await Promise.all([
      writeSkillFile(paths.sandboxAgentsSkillsDir, skillName, '# Universal shared skill\n', '2026-08-31T00:00:00.000Z'),
      writeRuntimeFile(path.join(pluginPath, 'SKILL.md'), '# Plugin shared skill\n'),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'audit-plugin', '1.0.0', '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'audit-plugin', version: '1.0.0' })),
    ]);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false } as const;
    await runtime.scanInventory(scanOptions);
    const pluginBefore = await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8');

    await runtime.removeInventoryItem({ entity: 'skill', skillName }, {
      ...scanOptions,
      trashItem: async (targetPath) => {
        trashedPaths.push(targetPath);
        await rm(targetPath, { recursive: true, force: true });
      },
    });

    expect(trashedPaths).toEqual([universalPath]);
    expect(await readFile(path.join(pluginPath, 'SKILL.md'), 'utf8')).toBe(pluginBefore);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual([universalPath]);
  });

  it.each([
    { entity: 'skill' as const, capabilityName: 'remove-links:shared-skill' },
    { entity: 'subagent' as const, capabilityName: 'remove-links:shared-agent' },
  ])('removes and restores a live plugin-targeted $entity agent symlink without touching its referent', async ({
    entity,
    capabilityName,
  }) => {
    const root = await mkdtemp(path.join(tmpdir(), `skillindex-runtime-remove-live-plugin-link-${entity}-`));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'remove-links', '1.0.0');
    const pluginTarget = entity === 'skill'
      ? path.join(pluginRoot, 'skills', 'shared-skill')
      : path.join(pluginRoot, 'agents', 'shared-agent.md');
    const universalPath = entity === 'skill'
      ? path.join(paths.sandboxAgentsSkillsDir, capabilityName)
      : path.join(paths.sandboxRoot, '.agents', 'agents', 'remove-links-shared-agent.md');
    const agentLink = entity === 'skill'
      ? path.join(paths.sandboxRoot, '.claude', 'skills', capabilityName)
      : path.join(paths.sandboxRoot, '.claude', 'agents', 'remove-links-shared-agent.md');
    const pluginText = entity === 'skill'
      ? '---\nname: shared-skill\ndescription: Plugin skill\n---\nPlugin skill body.\n'
      : '---\nname: shared-agent\ndescription: Plugin agent\n---\nPlugin agent body.\n';
    const universalText = entity === 'skill'
      ? '---\nname: remove-links:shared-skill\ndescription: Universal skill\n---\nUniversal skill body.\n'
      : '---\nname: shared-agent\ndescription: Universal agent\n---\nUniversal agent body.\n';

    await Promise.all([
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'remove-links', version: '1.0.0' })),
      writeRuntimeFile(entity === 'skill' ? path.join(pluginTarget, 'SKILL.md') : pluginTarget, pluginText),
      writeRuntimeFile(entity === 'skill' ? path.join(universalPath, 'SKILL.md') : universalPath, universalText),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.claude', 'settings.json'), '{}\n'),
      mkdir(path.dirname(agentLink), { recursive: true }),
    ]);
    await symlink(pluginTarget, agentLink);
    const scanOptions = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'claude' },
    } as const;
    await runtime.scanInventory(scanOptions);
    const pluginBytesBefore = await readFile(entity === 'skill' ? path.join(pluginTarget, 'SKILL.md') : pluginTarget);

    await runtime.removeInventoryItem(entity === 'skill'
      ? { entity, skillName: capabilityName }
      : { entity, subagentName: capabilityName }, {
      ...scanOptions,
      trashItem: async (targetPath) => rm(targetPath, { recursive: true, force: true }),
    });

    await expect(pathExists(universalPath)).resolves.toBe(false);
    await expect(pathExists(agentLink)).resolves.toBe(false);
    expect(await readFile(entity === 'skill' ? path.join(pluginTarget, 'SKILL.md') : pluginTarget)).toEqual(pluginBytesBefore);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([universalPath, agentLink]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);

    await runtime.undoAuditOperation(operation.id);
    expect((await lstat(agentLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(agentLink)).toBe(pluginTarget);
    await expect(pathExists(universalPath)).resolves.toBe(true);
    expect(await readFile(entity === 'skill' ? path.join(pluginTarget, 'SKILL.md') : pluginTarget)).toEqual(pluginBytesBefore);
  });

  it('uses sandbox state and preserves root state while removing and undoing without explicit paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-remove-sandbox-state-'));
    const env = { SKILL_INDEX_DATA_DIR: root };
    const paths = resolveSkillIndexPaths({ env });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const skillName = 'sandbox-only-removal';
    const skillPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const rootConfigBefore = `${JSON.stringify({ ...defaultConfig, preferredCanonicalSourcePath: '/root-state-sentinel' }, null, 2)}\n`;
    const rootCacheBefore = 'root-cache-sentinel\n';
    await Promise.all([
      writeSkillFile(paths.sandboxAgentsSkillsDir, skillName, '# Sandbox only\n', '2026-08-31T00:00:00.000Z'),
      writeRuntimeFile(paths.configFile, rootConfigBefore),
      writeRuntimeFile(paths.cacheFile, rootCacheBefore),
    ]);
    await runtime.scanInventory({ env, includeSandboxSources: true, includeLiveSources: false });

    await runtime.removeInventoryItem({ entity: 'skill', skillName }, {
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
      trashItem: async (targetPath) => rm(targetPath, { recursive: true, force: true }),
    });
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toContain(skillPath);
    expect(await readFile(paths.configFile, 'utf8')).toBe(rootConfigBefore);
    expect(await readFile(paths.cacheFile, 'utf8')).toBe(rootCacheBefore);

    await runtime.undoAuditOperation(operation.id);
    await expect(pathExists(path.join(skillPath, 'SKILL.md'))).resolves.toBe(true);
    expect(await readFile(paths.configFile, 'utf8')).toBe(rootConfigBefore);
    expect(await readFile(paths.cacheFile, 'utf8')).toBe(rootCacheBefore);
  });

  it('freshens removal planning so a newly writable location is included in Undo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-remove-fresh-plan-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const skillName = 'newly-writable-removal';
    const universalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);
    const scanOptions = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'factory' },
    } as const;
    await writeSkillFile(paths.sandboxAgentsSkillsDir, skillName, '# Universal before removal\n', '2026-08-31T00:00:00.000Z');
    await runtime.scanInventory(scanOptions);
    await Promise.all([
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
      writeSkillFile(path.join(paths.sandboxRoot, '.factory', 'skills'), skillName, '# Factory appeared later\n', '2026-08-31T00:01:00.000Z'),
    ]);

    await runtime.removeInventoryItem({ entity: 'skill', skillName }, {
      ...scanOptions,
      trashItem: async (targetPath) => rm(targetPath, { recursive: true, force: true }),
    });
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([universalPath, factoryPath]));
    await expect(pathExists(universalPath)).resolves.toBe(false);
    await expect(pathExists(factoryPath)).resolves.toBe(false);

    await runtime.undoAuditOperation(operation.id);
    await expect(readFile(path.join(universalPath, 'SKILL.md'), 'utf8')).resolves.toContain('Universal before removal');
    await expect(readFile(path.join(factoryPath, 'SKILL.md'), 'utf8')).resolves.toContain('Factory appeared later');
  });

  it('audits and undoes MCP removal through physical config referents without replacing plugin or config symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-remove-mcp-symlinks-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'remove-mcp', '1.0.0');
    const pluginConfig = path.join(pluginRoot, '.mcp.json');
    const universal = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const factory = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const universalReferent = path.join(paths.sandboxRoot, 'config-referents', 'remove-universal.json');
    const factoryReferent = path.join(paths.sandboxRoot, 'config-referents', 'remove-factory.json');
    const universalBefore = `${JSON.stringify({ servers: { service: { command: 'node', args: ['service.js'] } } }, null, 2)}\n`;
    const factoryBefore = `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['service.js'] } } }, null, 2)}\n`;
    const pluginBefore = `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['service.js'] } } }, null, 2)}\n`;
    await Promise.all([
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'remove-mcp', version: '1.0.0' })),
      writeRuntimeFile(pluginConfig, pluginBefore),
      writeRuntimeFile(universalReferent, universalBefore),
      writeRuntimeFile(factoryReferent, factoryBefore),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), '[plugins."remove-mcp@official"]\nenabled = true\n'),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
      mkdir(path.dirname(universal), { recursive: true }),
    ]);
    await Promise.all([symlink(universalReferent, universal), symlink(factoryReferent, factory)]);
    const scanOptions = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' },
    } as const;
    await runtime.scanInventory(scanOptions);

    await runtime.removeInventoryItem({ entity: 'mcp', mcpName: 'remove-mcp:service' }, scanOptions);
    expect(await readFile(universalReferent, 'utf8')).not.toContain('service.js');
    expect(await readFile(factoryReferent, 'utf8')).not.toContain('service.js');
    expect(await readFile(pluginConfig, 'utf8')).toBe(pluginBefore);
    expect((await lstat(universal)).isSymbolicLink()).toBe(true);
    expect((await lstat(factory)).isSymbolicLink()).toBe(true);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      await realpath(universalReferent),
      await realpath(factoryReferent),
    ]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);

    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(universalReferent, 'utf8')).toBe(universalBefore);
    expect(await readFile(factoryReferent, 'utf8')).toBe(factoryBefore);
    expect(await readFile(pluginConfig, 'utf8')).toBe(pluginBefore);
    expect(await readlink(universal)).toBe(universalReferent);
    expect(await readlink(factory)).toBe(factoryReferent);
  });

  it('audits and undoes plugin Universal skill updates without capturing plugin caches', async () => {
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

    const initialized = await runtime.applyCapabilityAction({
      entity: 'skill',
      action: 'choose-universal-version',
      skillName,
      selectedVariantPath: agentsPath,
    });

    const pluginPath = initialized.skills.find((skill) => skill.name === skillName)
      ?.managedSourceCandidates?.find((candidate) => candidate.relationship === 'differs-from-universal')?.path;
    expect(pluginPath).toBeDefined();
    const universalPath = path.join(agentsPath, 'SKILL.md');
    const beforeUpdate = await readFile(universalPath, 'utf8');

    await runtime.applyCapabilityAction({
      entity: 'skill',
      action: 'update-universal-from-plugin',
      capabilityName: skillName,
      selectedVariantPath: pluginPath!,
    });

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      kind: 'capability-action',
    });
    expect(operation.actions.some((action) => action.path === agentsPath)).toBe(true);
    expect(operation.actions.some((action) => action.path === pluginPath)).toBe(false);
    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(universalPath, 'utf8')).toBe(beforeUpdate);
  });

  it('promotes a selected plugin-only skill through the public action and distributes every writable agent link atomically', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-plugin-promotion-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false } as const;

    await seedRepresentativeFixtures({ paths });
    const before = await runtime.scanInventory(scanOptions);
    const skillName = 'plugin-version-choice-skill';
    const skill = before.skills.find((entry) => entry.name === skillName);
    const selectedCandidate = skill?.managedSourceCandidates?.find((candidate) => candidate.plugin.version === '1.1.0');
    expect(selectedCandidate).toBeDefined();
    expect(skill).toMatchObject({ issueReasons: ['missing-canonical'] });

    const pluginCacheContents = await Promise.all(
      (skill?.managedSourceCandidates ?? []).map(async (candidate) => ({
        path: candidate.path,
        contents: await readFile(path.join(candidate.path, 'SKILL.md'), 'utf8'),
      })),
    );
    const universalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const expectedLinks = [
      path.join(paths.sandboxRoot, '.claude', 'skills', skillName),
      path.join(paths.sandboxRoot, '.factory', 'skills', skillName),
      path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName),
    ];

    const promoted = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'missing-canonical',
      skillName,
      selectedVariantPath: selectedCandidate!.path,
    });

    await expect(readFile(path.join(universalPath, 'SKILL.md'), 'utf8')).resolves.toContain('version 1.1.0 selected content');
    for (const linkPath of expectedLinks) {
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath)).toBe(universalPath);
    }
    expect(promoted.skills.find((entry) => entry.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
    });
    for (const candidate of pluginCacheContents) {
      expect(await readFile(path.join(candidate.path, 'SKILL.md'), 'utf8')).toBe(candidate.contents);
    }

    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      universalPath,
      ...expectedLinks,
    ]));
    expect(operation.actions.some((action) => pluginCacheContents.some((candidate) => action.path?.startsWith(candidate.path)))).toBe(false);

    await runtime.undoAuditOperation(operation.id);
    await expect(pathExists(universalPath)).resolves.toBe(false);
    for (const linkPath of expectedLinks) {
      await expect(pathExists(linkPath)).resolves.toBe(false);
    }
    for (const candidate of pluginCacheContents) {
      expect(await readFile(path.join(candidate.path, 'SKILL.md'), 'utf8')).toBe(candidate.contents);
    }
  });

  it('keeps sandbox dismissals and Universal decisions in sandbox state across public plugin promotion and Undo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-plugin-sandbox-state-'));
    const env = { SKILL_INDEX_DATA_DIR: root };
    const rootPaths = resolveSkillIndexPaths({ env });
    const sandboxConfigPath = path.join(root, 'sandbox-state', 'config.json');
    const rootConfig = `${JSON.stringify({
      ...defaultConfig,
      dismissedDriftSignatures: ['root-state-sentinel'],
    }, null, 2)}\n`;
    await writeRuntimeFile(rootPaths.configFile, rootConfig);
    await seedRepresentativeFixtures({ env });
    const sandboxConfigBefore = await readFile(sandboxConfigPath, 'utf8');
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const scanOptions = { env, includeSandboxSources: true, includeLiveSources: false } as const;
    const before = await runtime.scanInventory(scanOptions);
    const skillName = 'plugin-version-choice-skill';
    const candidate = before.skills.find((entry) => entry.name === skillName)
      ?.managedSourceCandidates?.find((entry) => entry.plugin.version === '1.1.0');
    const dismissedCountsBefore = {
      skills: before.counts.dismissedDriftSkills,
      mcps: before.mcpCounts?.dismissedAttentionMcps,
      subagents: before.subagentCounts?.dismissedAttentionSubagents,
    };

    const promoted = await runtime.resolveIssue({
      entity: 'skill', issue: 'missing-canonical', skillName, selectedVariantPath: candidate!.path,
    });
    expect(promoted.skills.find((entry) => entry.name === skillName)).toMatchObject({ structuralState: 'healthy', issueReasons: [] });
    expect({
      skills: promoted.counts.dismissedDriftSkills,
      mcps: promoted.mcpCounts?.dismissedAttentionMcps,
      subagents: promoted.subagentCounts?.dismissedAttentionSubagents,
    }).toEqual(dismissedCountsBefore);
    expect(await readFile(rootPaths.configFile, 'utf8')).toBe(rootConfig);
    const sandboxConfigAfter = JSON.parse(await readFile(sandboxConfigPath, 'utf8')) as {
      skillUniversalDecisions?: Array<{ skillName: string }>;
    };
    expect(sandboxConfigAfter.skillUniversalDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillName }),
    ]));

    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toContain(sandboxConfigPath);
    expect(operation.actions.map((action) => action.path)).not.toContain(rootPaths.configFile);
    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(sandboxConfigPath, 'utf8')).toBe(sandboxConfigBefore);
    expect(await readFile(rootPaths.configFile, 'utf8')).toBe(rootConfig);
  });

  it.each([
    { entity: 'mcp' as const, capabilityName: 'plugin-update-mcp:plugin-update-mcp' },
    { entity: 'subagent' as const, capabilityName: 'plugin-update-subagent:plugin-update-subagent' },
  ])('keeps sandbox presentation state isolated during $entity plugin updates', async ({ entity, capabilityName }) => {
    const root = await mkdtemp(path.join(tmpdir(), `skillindex-runtime-${entity}-sandbox-state-`));
    const env = { SKILL_INDEX_DATA_DIR: root };
    const rootPaths = resolveSkillIndexPaths({ env });
    const rootConfig = `${JSON.stringify({ ...defaultConfig, dismissedDriftSignatures: ['root-state-sentinel'] }, null, 2)}\n`;
    await writeRuntimeFile(rootPaths.configFile, rootConfig);
    await seedRepresentativeFixtures({ env });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const scanOptions = { env, includeSandboxSources: true, includeLiveSources: false } as const;
    const before = await runtime.scanInventory(scanOptions);
    const record = entity === 'mcp'
      ? before.mcps?.find((entry) => entry.name === capabilityName)
      : before.subagents?.find((entry) => entry.name === capabilityName);
    const candidate = record?.managedSourceCandidates?.find((entry) => entry.relationship === 'differs-from-universal');
    const dismissedCountsBefore = [
      before.counts.dismissedDriftSkills,
      before.mcpCounts?.dismissedAttentionMcps,
      before.subagentCounts?.dismissedAttentionSubagents,
    ];

    const after = await runtime.applyCapabilityAction({
      entity, action: 'update-universal-from-plugin', capabilityName, selectedVariantPath: candidate!.path,
    });
    expect([
      after.counts.dismissedDriftSkills,
      after.mcpCounts?.dismissedAttentionMcps,
      after.subagentCounts?.dismissedAttentionSubagents,
    ]).toEqual(dismissedCountsBefore);
    expect(await readFile(rootPaths.configFile, 'utf8')).toBe(rootConfig);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).not.toContain(rootPaths.configFile);
    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(rootPaths.configFile, 'utf8')).toBe(rootConfig);
  });

  it('freshens plugin promotion planning so a newly writable agent is included in Undo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-plugin-promotion-race-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false } as const;
    const skillName = 'plugin-single-source-skill';
    const factoryPath = path.join(paths.sandboxRoot, '.factory', 'skills', skillName);

    await seedRepresentativeFixtures({ paths });
    await rm(path.join(paths.sandboxRoot, '.factory'), { recursive: true, force: true });
    const stale = await runtime.scanInventory(scanOptions);
    const candidate = stale.skills.find((entry) => entry.name === skillName)?.managedSourceCandidates?.[0];
    expect(stale.agents?.find((agent) => agent.id === 'sandbox-factory')?.installState).toBe('not-installed');
    await writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n');

    await runtime.resolveIssue({
      entity: 'skill', issue: 'missing-canonical', skillName, selectedVariantPath: candidate!.path,
    });
    expect(await readlink(factoryPath)).toBe(path.join(paths.sandboxAgentsSkillsDir, skillName));
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toContain(factoryPath);

    await runtime.undoAuditOperation(operation.id);
    await expect(pathExists(factoryPath)).resolves.toBe(false);
  });

  it.each([
    { skillName: 'plugin-single-source-skill', issue: 'missing-canonical' as const },
    { skillName: 'legacy-plugin-link-skill', issue: 'broken-symlink' as const },
  ])('uses the complete managed-source promotion route for $skillName', async ({ skillName, issue }) => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-plugin-route-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false } as const;
    await seedRepresentativeFixtures({ paths });
    const before = await runtime.scanInventory(scanOptions);
    const candidate = before.skills.find((entry) => entry.name === skillName)?.managedSourceCandidates?.[0];
    expect(candidate).toBeDefined();

    const after = await runtime.resolveIssue({
      entity: 'skill',
      issue,
      skillName,
      selectedVariantPath: candidate!.path,
    });
    const universalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    for (const linkPath of [
      path.join(paths.sandboxRoot, '.claude', 'skills', skillName),
      path.join(paths.sandboxRoot, '.factory', 'skills', skillName),
      path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName),
    ]) {
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath)).toBe(universalPath);
    }
    expect(after.skills.find((entry) => entry.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
    });
  });

  it('excludes only the exact enabled native plugin host when promoting a plugin skill', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-native-plugin-promotion-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false } as const;
    const skillName = 'native-plugin-delivery:native-plugin-skill';
    const universalPath = path.join(paths.sandboxAgentsSkillsDir, skillName);
    const claudePath = path.join(paths.sandboxRoot, '.claude', 'skills', skillName);

    await seedRepresentativeFixtures({ paths });
    await Promise.all([
      rm(universalPath, { recursive: true, force: true }),
      rm(path.join(paths.sandboxRoot, '.codex', 'skills', skillName), { recursive: true, force: true }),
      rm(path.join(paths.sandboxRoot, '.cursor', 'skills', skillName), { recursive: true, force: true }),
      rm(path.join(paths.sandboxRoot, '.factory', 'skills', skillName), { recursive: true, force: true }),
      rm(path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName), { recursive: true, force: true }),
    ]);
    const before = await runtime.scanInventory(scanOptions);
    const skill = before.skills.find((entry) => entry.name === skillName);
    const candidate = skill?.managedSourceCandidates?.find((entry) => entry.plugin.enabled === true);
    expect(skill?.issueReasons).toContain('missing-canonical');
    expect(candidate?.plugin.host).toBe('claude');

    const after = await runtime.resolveIssue({
      entity: 'skill',
      issue: 'missing-canonical',
      skillName,
      selectedVariantPath: candidate!.path,
    });

    await expect(pathExists(claudePath)).resolves.toBe(false);
    for (const linkPath of [
      path.join(paths.sandboxRoot, '.factory', 'skills', skillName),
      path.join(paths.sandboxRoot, '.codeium', 'windsurf', 'skills', skillName),
    ]) {
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath)).toBe(universalPath);
    }
    expect(after.skills.find((entry) => entry.name === skillName)).toMatchObject({
      structuralState: 'healthy',
      issueReasons: [],
    });
  });

  it('audits and undoes an MCP plugin update without touching either plugin cache', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-mcp-plugin-update-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const oldRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-mcp', '1.0.0');
    const newRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-mcp', '1.1.0');
    const oldConfig = path.join(oldRoot, '.mcp.json');
    const newConfig = path.join(newRoot, '.mcp.json');
    const universal = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const factory = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const universalReferent = path.join(paths.sandboxRoot, 'config-referents', 'universal-mcp.json');
    const factoryReferent = path.join(paths.sandboxRoot, 'config-referents', 'factory-mcp.json');
    const codexConfig = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const oldText = `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['old.js'] } } }, null, 2)}\n`;
    const newText = `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['new.js'] } } }, null, 2)}\n`;
    await Promise.all([
      writeRuntimeFile(path.join(oldRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-mcp', version: '1.0.0' })),
      writeRuntimeFile(path.join(newRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-mcp', version: '1.1.0' })),
      writeRuntimeFile(oldConfig, oldText), writeRuntimeFile(newConfig, newText),
      writeRuntimeFile(universalReferent, `${JSON.stringify({ servers: { service: { command: 'node', args: ['old.js'] } } }, null, 2)}\n`),
      writeRuntimeFile(factoryReferent, `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['old.js'] } } }, null, 2)}\n`),
      writeRuntimeFile(codexConfig, '[plugins."runtime-mcp@official"]\nenabled = true\n'),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
      mkdir(path.dirname(universal), { recursive: true }),
    ]);
    await Promise.all([
      symlink(universalReferent, universal),
      symlink(factoryReferent, factory),
    ]);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false, env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' } } as const;
    await runtime.scanInventory(scanOptions);
    const universalBefore = await readFile(universal, 'utf8');
    const factoryBefore = await readFile(factoryReferent, 'utf8');
    const codexBefore = await readFile(codexConfig, 'utf8');
    const codexMode = (await lstat(codexConfig)).mode;
    await runtime.applyCapabilityAction({ entity: 'mcp', action: 'update-universal-from-plugin', capabilityName: 'runtime-mcp:service', selectedVariantPath: newConfig });
    expect(await readFile(universal, 'utf8')).toContain('new.js');
    expect(await readFile(factory, 'utf8')).toContain('new.js');
    expect((await lstat(factory)).isSymbolicLink()).toBe(true);
    expect(await readFile(codexConfig, 'utf8')).toBe(codexBefore);
    expect((await lstat(codexConfig)).mode).toBe(codexMode);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      await realpath(universalReferent),
      await realpath(factoryReferent),
    ]));
    expect(operation.actions.map((action) => action.path)).not.toEqual(expect.arrayContaining([universal, factory]));
    expect(operation.actions.some((action) => action.path?.startsWith(oldRoot) || action.path?.startsWith(newRoot))).toBe(false);
    expect(await readFile(oldConfig, 'utf8')).toBe(oldText);
    expect(await readFile(newConfig, 'utf8')).toBe(newText);
    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(universalReferent, 'utf8')).toBe(universalBefore);
    expect(await readFile(factoryReferent, 'utf8')).toBe(factoryBefore);
    expect((await lstat(universal)).isSymbolicLink()).toBe(true);
    expect((await lstat(factory)).isSymbolicLink()).toBe(true);
    expect(await readlink(universal)).toBe(universalReferent);
    expect(await readlink(factory)).toBe(factoryReferent);
    expect(await readFile(codexConfig, 'utf8')).toBe(codexBefore);
    expect((await lstat(codexConfig)).mode).toBe(codexMode);
  });

  it('audits and undoes an initial plugin MCP promotion across Universal and derived configs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-mcp-plugin-promotion-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-promotion-mcp', '1.0.0');
    const pluginConfig = path.join(pluginRoot, '.mcp.json');
    const universal = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const codexConfig = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const factoryConfig = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const universalReferent = path.join(paths.sandboxRoot, 'config-referents', 'universal-mcp.json');
    const factoryReferent = path.join(paths.sandboxRoot, 'config-referents', 'factory-mcp.json');
    const universalBefore = '{"servers":{}}\n';
    const factoryBefore = '{"mcpServers":{}}\n';
    const codexBefore = 'model = "gpt-5"\n';
    const pluginBefore = `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['plugin.js'] } } }, null, 2)}\n`;
    await Promise.all([
      mkdir(paths.sandboxAgentsSkillsDir, { recursive: true }),
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-promotion-mcp', version: '1.0.0' })),
      writeRuntimeFile(pluginConfig, pluginBefore),
      writeRuntimeFile(universalReferent, universalBefore),
      writeRuntimeFile(factoryReferent, factoryBefore),
      writeRuntimeFile(codexConfig, codexBefore),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
    ]);
    await Promise.all([
      symlink(universalReferent, universal),
      symlink(factoryReferent, factoryConfig),
    ]);
    const scanOptions = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' },
    } as const;
    const before = await runtime.scanInventory(scanOptions);
    const mcpName = 'runtime-promotion-mcp:service';
    expect(before.mcps?.find((mcp) => mcp.name === mcpName)?.issueReasons).toContain('missing-universal');

    const promoted = await runtime.resolveIssue({
      entity: 'mcp', issue: 'missing-universal', mcpName, selectedVariantPath: pluginConfig,
    });
    expect(promoted.mcps?.find((mcp) => mcp.name === mcpName)).toMatchObject({ status: 'healthy', issueReasons: [] });
    await expect(readFile(universal, 'utf8')).resolves.toContain('plugin.js');
    await expect(readFile(codexConfig, 'utf8')).resolves.toContain('plugin.js');
    await expect(readFile(factoryConfig, 'utf8')).resolves.toContain('plugin.js');
    await expect(readFile(pluginConfig, 'utf8')).resolves.toBe(pluginBefore);

    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      await realpath(universalReferent),
      await realpath(codexConfig),
      await realpath(factoryReferent),
    ]));
    expect(operation.actions.map((action) => action.path)).not.toEqual(expect.arrayContaining([universal, factoryConfig]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);

    await runtime.undoAuditOperation(operation.id);
    await expect(readFile(universalReferent, 'utf8')).resolves.toBe(universalBefore);
    await expect(readFile(factoryReferent, 'utf8')).resolves.toBe(factoryBefore);
    expect((await lstat(universal)).isSymbolicLink()).toBe(true);
    expect((await lstat(factoryConfig)).isSymbolicLink()).toBe(true);
    expect(await readlink(universal)).toBe(universalReferent);
    expect(await readlink(factoryConfig)).toBe(factoryReferent);
    await expect(readFile(codexConfig, 'utf8')).resolves.toBe(codexBefore);
    await expect(readFile(pluginConfig, 'utf8')).resolves.toBe(pluginBefore);
  });

  it('audits and undoes a subagent plugin update without touching either plugin cache', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-subagent-plugin-update-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const oldRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-agents', '1.0.0');
    const newRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-agents', '1.1.0');
    const oldDefinition = path.join(oldRoot, 'agents', 'reviewer.md');
    const newDefinition = path.join(newRoot, 'agents', 'reviewer.md');
    const universal = path.join(paths.sandboxRoot, '.agents', 'agents', 'runtime-agents-reviewer.md');
    const factory = path.join(paths.sandboxRoot, '.factory', 'droids', 'runtime-agents-reviewer.md');
    const codexDerived = path.join(paths.sandboxRoot, '.codex', 'agents', 'runtime-agents-reviewer.toml');
    const oldText = '---\nname: reviewer\ndescription: Old reviewer\n---\nOld rules.\n';
    const newText = '---\nname: reviewer\ndescription: New reviewer\n---\nNew rules.\n';
    await Promise.all([
      writeRuntimeFile(path.join(oldRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-agents', version: '1.0.0' })),
      writeRuntimeFile(path.join(newRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-agents', version: '1.1.0' })),
      writeRuntimeFile(oldDefinition, oldText), writeRuntimeFile(newDefinition, newText),
      writeRuntimeFile(universal, oldText),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), '[plugins."runtime-agents@official"]\nenabled = true\n'),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
    ]);
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false, env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' } } as const;
    await runtime.scanInventory(scanOptions);
    const universalBefore = await readFile(universal, 'utf8');
    const universalMode = (await lstat(universal)).mode;
    await runtime.applyCapabilityAction({ entity: 'subagent', action: 'update-universal-from-plugin', capabilityName: 'runtime-agents:reviewer', selectedVariantPath: newDefinition });
    expect(await readFile(universal, 'utf8')).toContain('New rules.');
    expect(await readFile(factory, 'utf8')).toContain('New rules.');
    expect((await lstat(factory)).isSymbolicLink()).toBe(true);
    expect(await readlink(factory)).toBe(universal);
    expect(await pathExists(codexDerived)).toBe(false);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      universal,
      factory,
    ]));
    expect(operation.actions.some((action) => action.path?.startsWith(oldRoot) || action.path?.startsWith(newRoot))).toBe(false);
    expect(await readFile(oldDefinition, 'utf8')).toBe(oldText);
    expect(await readFile(newDefinition, 'utf8')).toBe(newText);
    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(universal, 'utf8')).toBe(universalBefore);
    expect((await lstat(universal)).mode).toBe(universalMode);
    expect((await lstat(universal)).isSymbolicLink()).toBe(false);
    expect(await pathExists(factory)).toBe(false);
    expect(await pathExists(codexDerived)).toBe(false);
  });

  it('audits and undoes an initial plugin subagent promotion across Universal and derived definitions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-subagent-plugin-promotion-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-promotion-agents', '1.0.0');
    const pluginDefinition = path.join(pluginRoot, 'agents', 'reviewer.md');
    const universal = path.join(paths.sandboxRoot, '.agents', 'agents', 'runtime-promotion-agents-reviewer.md');
    const codexConfig = path.join(paths.sandboxRoot, '.codex', 'config.toml');
    const codexDerived = path.join(paths.sandboxRoot, '.codex', 'agents', 'runtime-promotion-agents-reviewer.toml');
    const factoryDerived = path.join(paths.sandboxRoot, '.factory', 'droids', 'runtime-promotion-agents-reviewer.md');
    const codexBefore = 'model = "gpt-5"\n';
    const pluginBefore = '---\nname: reviewer\ndescription: Plugin reviewer\n---\nPromoted rules.\n';
    await Promise.all([
      mkdir(paths.sandboxAgentsSkillsDir, { recursive: true }),
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-promotion-agents', version: '1.0.0' })),
      writeRuntimeFile(pluginDefinition, pluginBefore),
      writeRuntimeFile(codexConfig, codexBefore),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n'),
    ]);
    const scanOptions = {
      paths,
      includeSandboxSources: true,
      includeLiveSources: false,
      env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' },
    } as const;
    const before = await runtime.scanInventory(scanOptions);
    const subagentName = 'runtime-promotion-agents:reviewer';
    expect(before.subagents?.find((subagent) => subagent.name === subagentName)?.issueReasons).toContain('missing-universal');

    const promoted = await runtime.resolveIssue({
      entity: 'subagent', issue: 'missing-universal', subagentName, selectedVariantPath: pluginDefinition,
    });
    expect(promoted.subagents?.find((subagent) => subagent.name === subagentName)).toMatchObject({ status: 'healthy', issueReasons: [] });
    await expect(readFile(universal, 'utf8')).resolves.toContain('Promoted rules.');
    await expect(readFile(codexDerived, 'utf8')).resolves.toContain('Promoted rules.');
    expect(await readlink(factoryDerived)).toBe(universal);
    await expect(readFile(pluginDefinition, 'utf8')).resolves.toBe(pluginBefore);

    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      universal,
      codexDerived,
      factoryDerived,
    ]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);

    await runtime.undoAuditOperation(operation.id);
    await expect(pathExists(universal)).resolves.toBe(false);
    await expect(pathExists(codexDerived)).resolves.toBe(false);
    await expect(pathExists(factoryDerived)).resolves.toBe(false);
    await expect(readFile(pluginDefinition, 'utf8')).resolves.toBe(pluginBefore);
  });

  it('refreshes a stale snapshot before auditing a plugin skill update', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-stale-skill-update-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-tools', '1.0.0');
    const pluginSkill = path.join(pluginRoot, 'skills', 'reviewer');
    const universal = path.join(paths.sandboxRoot, '.agents', 'skills', 'runtime-tools:reviewer');
    const factory = path.join(paths.sandboxRoot, '.factory', 'skills', 'runtime-tools:reviewer');
    const pluginText = '# Plugin reviewer\n';
    const universalText = '# Universal reviewer\n';
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false, env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' } } as const;
    await Promise.all([
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-tools', version: '1.0.0' })),
      writeRuntimeFile(path.join(pluginSkill, 'SKILL.md'), pluginText),
      writeRuntimeFile(path.join(universal, 'SKILL.md'), universalText),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), '[plugins."runtime-tools@official"]\nenabled = true\n'),
    ]);
    await runtime.scanInventory(scanOptions);

    // This agent is absent from currentSnapshot, but present when the action is invoked.
    await writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n');
    await runtime.applyCapabilityAction({
      entity: 'skill', action: 'update-universal-from-plugin', capabilityName: 'runtime-tools:reviewer', selectedVariantPath: pluginSkill,
    });

    expect(await readFile(path.join(universal, 'SKILL.md'), 'utf8')).toBe(pluginText);
    expect(await readlink(factory)).toBe(universal);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([universal, factory]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);
    expect(await readFile(path.join(pluginSkill, 'SKILL.md'), 'utf8')).toBe(pluginText);

    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(path.join(universal, 'SKILL.md'), 'utf8')).toBe(universalText);
    expect(await pathExists(factory)).toBe(false);
    expect(await readFile(path.join(pluginSkill, 'SKILL.md'), 'utf8')).toBe(pluginText);
  });

  it('refreshes a stale snapshot before auditing a plugin MCP update', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-stale-mcp-update-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-mcp-race', '1.0.0');
    const pluginConfig = path.join(pluginRoot, '.mcp.json');
    const universal = path.join(paths.sandboxRoot, '.agents', 'mcp.json');
    const factory = path.join(paths.sandboxRoot, '.factory', 'mcp.json');
    const pluginText = `${JSON.stringify({ mcpServers: { service: { command: 'node', args: ['plugin.js'] } } }, null, 2)}\n`;
    const universalText = `${JSON.stringify({ servers: { service: { command: 'node', args: ['universal.js'] } } }, null, 2)}\n`;
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false, env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' } } as const;
    await Promise.all([
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-mcp-race', version: '1.0.0' })),
      writeRuntimeFile(pluginConfig, pluginText),
      writeRuntimeFile(universal, universalText),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), '[plugins."runtime-mcp-race@official"]\nenabled = true\n'),
    ]);
    await runtime.scanInventory(scanOptions);

    await writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n');
    await runtime.applyCapabilityAction({
      entity: 'mcp', action: 'update-universal-from-plugin', capabilityName: 'runtime-mcp-race:service', selectedVariantPath: pluginConfig,
    });

    expect(await readFile(universal, 'utf8')).toContain('plugin.js');
    expect(await readFile(factory, 'utf8')).toContain('plugin.js');
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      await realpath(universal),
      await realpath(factory),
    ]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);
    expect(await readFile(pluginConfig, 'utf8')).toBe(pluginText);

    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(universal, 'utf8')).toBe(universalText);
    expect(await pathExists(factory)).toBe(false);
    expect(await readFile(pluginConfig, 'utf8')).toBe(pluginText);
  });

  it('refreshes a stale snapshot before auditing a plugin subagent update', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-stale-subagent-update-'));
    const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: root } });
    const runtime = createInventoryRuntime();
    runtimes.push(runtime);
    const pluginRoot = path.join(paths.sandboxRoot, '.codex', 'plugins', 'cache', 'official', 'runtime-agents-race', '1.0.0');
    const pluginDefinition = path.join(pluginRoot, 'agents', 'reviewer.md');
    const universal = path.join(paths.sandboxRoot, '.agents', 'agents', 'runtime-agents-race-reviewer.md');
    const factory = path.join(paths.sandboxRoot, '.factory', 'droids', 'runtime-agents-race-reviewer.md');
    const pluginText = '---\nname: reviewer\ndescription: Plugin reviewer\n---\nPlugin rules.\n';
    const universalText = '---\nname: reviewer\ndescription: Universal reviewer\n---\nUniversal rules.\n';
    const scanOptions = { paths, includeSandboxSources: true, includeLiveSources: false, env: { SKILL_INDEX_AGENT_SUBSET: 'codex,factory' } } as const;
    await Promise.all([
      writeRuntimeFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'runtime-agents-race', version: '1.0.0' })),
      writeRuntimeFile(pluginDefinition, pluginText),
      writeRuntimeFile(universal, universalText),
      writeRuntimeFile(path.join(paths.sandboxRoot, '.codex', 'config.toml'), '[plugins."runtime-agents-race@official"]\nenabled = true\n'),
    ]);
    await runtime.scanInventory(scanOptions);

    await writeRuntimeFile(path.join(paths.sandboxRoot, '.factory', 'settings.json'), '{}\n');
    await runtime.applyCapabilityAction({
      entity: 'subagent', action: 'update-universal-from-plugin', capabilityName: 'runtime-agents-race:reviewer', selectedVariantPath: pluginDefinition,
    });

    expect(await readFile(universal, 'utf8')).toContain('Plugin rules.');
    expect((await lstat(factory)).isSymbolicLink()).toBe(true);
    expect(await readlink(factory)).toBe(universal);
    const [operation] = await runtime.readAuditLog();
    expect(operation.actions.map((action) => action.path)).toEqual(expect.arrayContaining([universal, factory]));
    expect(operation.actions.some((action) => action.path?.startsWith(pluginRoot))).toBe(false);
    expect(await readFile(pluginDefinition, 'utf8')).toBe(pluginText);

    await runtime.undoAuditOperation(operation.id);
    expect(await readFile(universal, 'utf8')).toBe(universalText);
    expect(await pathExists(factory)).toBe(false);
    expect(await readFile(pluginDefinition, 'utf8')).toBe(pluginText);
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

  it('audits pasted subagent definitions under the parsed subagent name', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-runtime-subagent-audit-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
    };
    const paths = resolveSkillIndexPaths({ env });

    const runtime = createInventoryRuntime();
    runtimes.push(runtime);

    await mkdir(path.join(paths.sandboxRoot, '.codex'), { recursive: true });
    await runtime.scanInventory({
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });
    await runtime.addSubagent({
      sourceType: 'definition',
      name: 'fallback-reviewer',
      format: 'codex-toml',
      definition: [
        'name = "codex-reviewer"',
        'description = "Reviews Codex changes."',
        'developer_instructions = "Use Codex-specific review guidance."',
        '',
      ].join('\n'),
    }, {
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    });

    const [operation] = await runtime.readAuditLog();
    expect(operation).toMatchObject({
      entity: { type: 'subagent', name: 'codex-reviewer' },
      kind: 'add-subagent',
      sourceMode: 'sandbox',
      title: 'Added subagent codex-reviewer',
    });
    expect(operation.actions.map((action) => action.path)).toContain(
      path.join(paths.sandboxRoot, '.agents', 'agents', 'codex-reviewer.md'),
    );
    expect(operation.actions.map((action) => action.path)).not.toContain(
      path.join(paths.sandboxRoot, '.agents', 'agents', 'fallback-reviewer.md'),
    );
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

async function writeRuntimeFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}
