import { describe, expect, it, vi } from 'vitest';

import { registerManualRescanShortcut } from '@main/window';

describe('registerManualRescanShortcut', () => {
  it('prevents the default reload and triggers manual rescan for Cmd/Ctrl+R', async () => {
    let beforeInputListener:
      | ((event: { preventDefault: () => void }, input: Electron.Input) => void)
      | undefined;
    const webContents = {
      on: vi.fn((eventName: string, listener: typeof beforeInputListener) => {
        if (eventName === 'before-input-event') {
          beforeInputListener = listener;
        }
      }),
    };
    const onManualRescan = vi.fn().mockResolvedValue(undefined);

    registerManualRescanShortcut({ webContents } as never, onManualRescan);

    const preventDefault = vi.fn();
    beforeInputListener?.({ preventDefault }, { type: 'keyDown', key: 'r', control: true } as Electron.Input);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onManualRescan).toHaveBeenCalledOnce();
  });

  it('ignores non-rescan keyboard input', () => {
    let beforeInputListener:
      | ((event: { preventDefault: () => void }, input: Electron.Input) => void)
      | undefined;
    const webContents = {
      on: vi.fn((eventName: string, listener: typeof beforeInputListener) => {
        if (eventName === 'before-input-event') {
          beforeInputListener = listener;
        }
      }),
    };
    const onManualRescan = vi.fn();

    registerManualRescanShortcut({ webContents } as never, onManualRescan);

    const preventDefault = vi.fn();
    beforeInputListener?.({ preventDefault }, { type: 'keyDown', key: 'k', meta: true } as Electron.Input);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onManualRescan).not.toHaveBeenCalled();
  });
});
