// @vitest-environment node

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addCustomScanPath,
  clearPreferredCanonicalSourcePath,
  completeOnboarding,
  readSettingsState,
  removeCustomScanPath,
  setDevSidebarInventorySourceSwitcherVisible,
  setPreferredCanonicalSourcePath,
} from '@main/settings-state';
import { resolveSkillIndexPaths, resolveSkillIndexPathsForScanOptions } from '@shared/skill-index-paths';

describe('settings state custom scan paths', () => {
  it('persists normalized custom scan paths and removes them cleanly', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await expect(readSettingsState({ paths })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });

    const addedState = await addCustomScanPath(`${root}/../${path.basename(root)}/custom-skills`, { paths });

    expect(addedState).toEqual({
      customScanPaths: [path.join(root, 'custom-skills')],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(readFile(paths.configFile, 'utf8')).resolves.toContain(`"${path.join(root, 'custom-skills')}"`);

    const dedupedState = await addCustomScanPath(path.join(root, 'custom-skills'), { paths });
    expect(dedupedState).toEqual(addedState);

    const removedState = await removeCustomScanPath(path.join(root, 'custom-skills'), { paths });
    expect(removedState).toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(readSettingsState({ paths })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('expands home-relative custom scan paths before persistence and removal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });

    const expandedPath = path.join(homeDir, 'custom-skills');
    const addedState = await addCustomScanPath('~/custom-skills', { paths, homeDir });

    expect(addedState).toEqual({
      customScanPaths: [expandedPath],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(readFile(paths.configFile, 'utf8')).resolves.toContain(`"${expandedPath}"`);

    await expect(removeCustomScanPath('~/custom-skills', { paths, homeDir })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('persists and clears the preferred canonical source path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const expandedPath = path.join(homeDir, 'repos', 'arjit-skills');

    await expect(setPreferredCanonicalSourcePath('~/repos/arjit-skills', { paths, homeDir })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: expandedPath,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(readFile(paths.configFile, 'utf8')).resolves.toContain(`"preferredCanonicalSourcePath": "${expandedPath}"`);

    await expect(clearPreferredCanonicalSourcePath({ paths })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('completes onboarding while adding an optional preferred repo before the first scan', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const expandedPath = path.join(homeDir, 'repos', 'published-skills');

    await expect(completeOnboarding({
      completedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: '~/repos/published-skills',
    }, { paths, homeDir })).resolves.toEqual({
      customScanPaths: [expandedPath],
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: expandedPath,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(readSettingsState({ paths })).resolves.toEqual({
      customScanPaths: [expandedPath],
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: expandedPath,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('preserves an existing preferred canonical source when onboarding completes without a source payload', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });
    const expandedPath = path.join(homeDir, 'repos', 'published-skills');

    await setPreferredCanonicalSourcePath('~/repos/published-skills', { paths, homeDir });

    await expect(completeOnboarding({
      completedAt: '2026-05-19T06:30:00.000Z',
    }, { paths, homeDir })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: expandedPath,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('clears an existing preferred canonical source when onboarding explicitly submits a blank source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const homeDir = await mkdtemp(path.join(tmpdir(), 'skillindex-home-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
      homeDir,
    });

    await setPreferredCanonicalSourcePath('~/repos/published-skills', { paths, homeDir });

    await expect(completeOnboarding({
      completedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: '   ',
    }, { paths, homeDir })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('rejects blank custom scan paths before writing config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-'));
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: root,
      },
    });

    await expect(addCustomScanPath('   ', { paths })).rejects.toThrow('Enter a custom scan path before saving.');
  });

  it('uses sandbox app state for sandbox custom scan paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-sandbox-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
    };
    const livePaths = resolveSkillIndexPaths({ env });
    const customSkillsDir = path.join(root, 'custom-skills');

    await expect(addCustomScanPath(customSkillsDir, {
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    } as Parameters<typeof addCustomScanPath>[1])).resolves.toEqual({
      customScanPaths: [customSkillsDir],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });

    await expect(readSettingsState({
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    } as Parameters<typeof readSettingsState>[0])).resolves.toEqual({
      customScanPaths: [customSkillsDir],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await expect(readSettingsState({ paths: livePaths })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
  });

  it('stores the dev sidebar source switcher preference in root app state even while sandbox scanning is active', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-settings-sandbox-'));
    const env = {
      SKILL_INDEX_DATA_DIR: root,
    };
    const sandboxOptions = {
      env,
      includeSandboxSources: true,
      includeLiveSources: false,
    } satisfies Parameters<typeof readSettingsState>[0];
    const livePaths = resolveSkillIndexPaths({ env });
    const sandboxPaths = resolveSkillIndexPathsForScanOptions(sandboxOptions);
    const explicitSandboxOptions = {
      ...sandboxOptions,
      paths: sandboxPaths,
    };
    const customSkillsDir = path.join(root, 'sandbox-custom-skills');

    await addCustomScanPath(customSkillsDir, sandboxOptions);

    await expect(setDevSidebarInventorySourceSwitcherVisible(false, explicitSandboxOptions)).resolves.toEqual({
      customScanPaths: [customSkillsDir],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: false,
    });
    await expect(readSettingsState(explicitSandboxOptions)).resolves.toEqual({
      customScanPaths: [customSkillsDir],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: false,
    });
    await expect(readSettingsState({ env })).resolves.toEqual({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: false,
    });

    await expect(readFile(livePaths.configFile, 'utf8')).resolves.toContain(
      '"showDevSidebarInventorySourceSwitcher": false',
    );
    await expect(readFile(sandboxPaths.configFile, 'utf8')).resolves.toContain(
      '"showDevSidebarInventorySourceSwitcher": true',
    );
  });
});
