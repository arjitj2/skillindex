import os from 'node:os';

import { APP_NAME, type AppShellState } from '@shared/contracts';
import { ensureSkillIndexLayout, resolveSkillIndexPaths } from '@shared/skill-index-paths';
import { getStartupScanDelayMs, getStartupScanHold } from '@main/startup-observation';
import { isDevToolsEnabled } from '@main/dev-tools';
import { getInventoryMode } from '@main/inventory-mode-session';

export async function getAppShellState(): Promise<AppShellState> {
  const paths = resolveSkillIndexPaths();
  await ensureSkillIndexLayout(paths);

  return {
    appName: APP_NAME,
    username: os.userInfo().username,
    dataDir: paths.dataDir,
    cacheFile: paths.cacheFile,
    configFile: paths.configFile,
    liveCanonicalUserSkillsDir: paths.liveCanonicalUserSkillsDir,
    ...(isDevToolsEnabled()
      ? {
          devTools: {
            sandboxEnabled: true,
            inventoryMode: getInventoryMode(),
            sandboxRoot: paths.sandboxRoot,
            sandboxAgentsDir: paths.sandboxAgentsDir,
            sandboxCanonicalUserSkillsDir: paths.sandboxCanonicalUserSkillsDir,
            sandboxAgentsSkillsDir: paths.sandboxAgentsSkillsDir,
            fixturesDir: paths.fixturesDir,
          },
        }
      : {}),
    startupObservationDelayMs: getStartupScanDelayMs(),
    startupObservationHold: getStartupScanHold(),
    preloadStatus: 'ready',
  };
}
