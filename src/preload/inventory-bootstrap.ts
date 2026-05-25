import { ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type SkillIndexBootstrapState,
} from '@shared/contracts';

export function readInitialInventoryBootstrapState(): SkillIndexBootstrapState {
  try {
    return {
      initialInventorySnapshot:
        (ipcRenderer.sendSync(
          IPC_CHANNELS.readInitialInventoryBootstrap,
        ) as SkillIndexBootstrapState['initialInventorySnapshot']) ?? null,
    };
  } catch {
    return {
      initialInventorySnapshot: null,
    };
  }
}
