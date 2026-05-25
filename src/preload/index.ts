import { contextBridge, ipcRenderer } from 'electron';

import { readInitialInventoryBootstrapState } from '@preload/inventory-bootstrap';
import { isDevToolsEnabledForBuild } from '@shared/build-flavor';
import { createSkillIndexDesktopApi, createSkillIndexDevApi } from '@shared/contracts';

const desktopApi = createSkillIndexDesktopApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      listener(...args);
    };

    ipcRenderer.on(channel, wrappedListener);

    return () => {
      ipcRenderer.off(channel, wrappedListener);
    };
  },
);
const bootstrapState = readInitialInventoryBootstrapState();

contextBridge.exposeInMainWorld('skillIndex', desktopApi);
if (isPreloadDevToolsEnabled()) {
  const devApi = createSkillIndexDevApi((channel, ...args) => ipcRenderer.invoke(channel, ...args));
  contextBridge.exposeInMainWorld('skillIndexDev', devApi);
}
contextBridge.exposeInMainWorld('skillIndexBootstrap', bootstrapState);

function isPreloadDevToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevToolsEnabledForBuild(env);
}
