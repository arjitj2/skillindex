import { getInventoryMode } from '@main/inventory-mode-session';
import { isDevToolsEnabled } from '@main/dev-tools';
import { readCachedSkillInventory, scanSkillInventory, type ScanSkillInventoryOptions } from '@main/skill-inventory';
import type { InventorySourceMode, SkillInventorySnapshot } from '@shared/contracts';
import type { ResolveSkillIndexPathOptions, SkillIndexPaths } from '@shared/skill-index-paths';

interface EnsureRepresentativeSandboxOptions extends ResolveSkillIndexPathOptions {
  enabled?: boolean;
  inventoryMode?: InventorySourceMode;
  paths?: SkillIndexPaths;
}

export async function ensureRepresentativeSandboxFixturesForDev(
  options: EnsureRepresentativeSandboxOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? isDevToolsEnabled(env);
  const inventoryMode = options.inventoryMode ?? getInventoryMode();
  if (!enabled || inventoryMode !== 'sandbox') {
    return false;
  }

  const scanOptions: ScanSkillInventoryOptions = {
    paths: options.paths,
    env,
    homeDir: options.homeDir,
    includeSandboxSources: true,
    includeLiveSources: false,
  };

  const cachedSnapshot = await readCachedSkillInventory(scanOptions);
  if (hasInventory(cachedSnapshot)) {
    return false;
  }

  const diskSnapshot = await scanSkillInventory(scanOptions);
  if (hasInventory(diskSnapshot)) {
    return false;
  }

  const { seedRepresentativeFixtures } = await import('@main/sandbox-fixtures');
  await seedRepresentativeFixtures(scanOptions);
  await scanSkillInventory(scanOptions);
  return true;
}

function hasInventory(snapshot: SkillInventorySnapshot | null): boolean {
  return (snapshot?.counts.totalSkills ?? 0) > 0 || (snapshot?.mcpCounts?.totalMcps ?? 0) > 0;
}
