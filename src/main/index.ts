import { app, BrowserWindow } from 'electron';

import { getAppShellState } from '@main/app-shell';
import { registerAutoUpdateLifecycle } from '@main/auto-update';
import { ensureRepresentativeSandboxFixturesForDev } from '@main/dev-sandbox-bootstrap';
import { registerIpcHandlers } from '@main/ipc';
import { createMainWindow } from '@main/window';

let hasRegisteredHandlers = false;

async function bootstrap(): Promise<void> {
  await app.whenReady();
  app.setName('Skill Index');

  if (!hasRegisteredHandlers) {
    registerIpcHandlers();
    hasRegisteredHandlers = true;
  }

  await ensureRepresentativeSandboxFixturesForDev();
  await getAppShellState();
  createMainWindow();
  registerAutoUpdateLifecycle();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      registerAutoUpdateLifecycle();
    }
  });
}

void bootstrap();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
