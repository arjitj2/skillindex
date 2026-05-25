import { type InventorySourceMode, type ScanInventoryOptions } from '@shared/contracts';
import { isDevToolsEnabled } from '@main/dev-tools';

let inventoryMode: InventorySourceMode = isDevToolsEnabled() ? 'sandbox' : 'live';

export function getInventoryMode(): InventorySourceMode {
  return inventoryMode;
}

export function setInventoryMode(mode: InventorySourceMode): InventorySourceMode {
  inventoryMode = mode;
  return inventoryMode;
}

export function resolveInventoryScanOptions(options?: ScanInventoryOptions): ScanInventoryOptions {
  return options ?? getScanInventoryOptionsForMode(inventoryMode);
}

function getScanInventoryOptionsForMode(mode: InventorySourceMode): ScanInventoryOptions {
  return mode === 'live'
    ? {
      includeSandboxSources: false,
      includeLiveSources: true,
    }
    : {
      includeSandboxSources: true,
      includeLiveSources: false,
    };
}
