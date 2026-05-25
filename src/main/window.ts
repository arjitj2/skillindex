import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, nativeTheme, shell } from 'electron';

import { triggerInventoryRescan } from '@main/ipc';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#050505' : '#f3efe8',
    titleBarStyle: 'hidden',
    title: 'Skill Index',
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  registerManualRescanShortcut(window, async () => {
    await triggerInventoryRescan();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(currentDir, '../renderer/index.html'));
  }

  return window;
}

export function registerManualRescanShortcut(
  window: Pick<BrowserWindow, 'webContents'>,
  onManualRescan: () => Promise<void> | void,
): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (!isManualRescanShortcut(input)) {
      return;
    }

    event.preventDefault();
    void Promise.resolve(onManualRescan()).catch((error) => {
      console.error('Failed to run manual inventory rescan from keyboard shortcut.', error);
    });
  });
}

function isManualRescanShortcut(input: Electron.Input): boolean {
  return input.type === 'keyDown' && input.key.toLowerCase() === 'r' && (input.meta || input.control);
}
