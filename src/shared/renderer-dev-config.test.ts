import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RENDERER_PORT,
  RENDERER_CONNECT_SRC_PLACEHOLDER,
  RENDERER_IMG_SRC_PLACEHOLDER,
  buildRendererConnectSrc,
  buildRendererImgSrc,
  injectRendererConnectSrc,
  injectRendererImgSrc,
  resolveRendererDevPort,
  resolveRendererPort,
} from '@shared/renderer-dev-config';

describe('resolveRendererPort', () => {
  it('defaults to the mission renderer port when PORT is unset', () => {
    expect(resolveRendererPort(undefined)).toBe(DEFAULT_RENDERER_PORT);
  });

  it('uses the configured renderer port when PORT is set', () => {
    expect(resolveRendererPort('5607')).toBe(5607);
  });
});

describe('injectRendererConnectSrc', () => {
  it('replaces the CSP connect-src placeholder with the configured websocket and http origins', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="connect-src ${RENDERER_CONNECT_SRC_PLACEHOLDER};" />`;

    expect(injectRendererConnectSrc(html, 5607)).toContain(
      `connect-src ${buildRendererConnectSrc(5607)};`,
    );
  });
});

describe('injectRendererImgSrc', () => {
  it('replaces the CSP img-src placeholder with the configured image origin allowlist', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="img-src ${RENDERER_IMG_SRC_PLACEHOLDER};" />`;

    expect(injectRendererImgSrc(html)).toContain(
      `img-src ${buildRendererImgSrc()};`,
    );
  });

  it('includes every renderable icon origin referenced by the agent overrides', () => {
    const imgSrc = buildRendererImgSrc();

    expect(imgSrc).toContain('https://ampcode.com');
    expect(imgSrc).toContain('https://cline.bot');
    expect(imgSrc).toContain('https://cursor.com');
    expect(imgSrc).toContain('https://deepagents.org');
    expect(imgSrc).toContain('https://lf-cdn.trae.com.cn');
    expect(imgSrc).toContain('https://opencode.ai');
    expect(imgSrc).toContain('https://www.continue.dev');
  });
});

describe('resolveRendererDevPort', () => {
  it('uses the default renderer port when it is available', async () => {
    await expect(resolveRendererDevPort(undefined, () => Promise.resolve(true))).resolves.toBe(
      DEFAULT_RENDERER_PORT,
    );
  });

  it('falls back to the next port when the default renderer port is occupied', async () => {
    const checkedPorts: number[] = [];

    const resolvedPort = await resolveRendererDevPort(undefined, (candidatePort) => {
      checkedPorts.push(candidatePort);
      return Promise.resolve(candidatePort !== DEFAULT_RENDERER_PORT);
    });

    expect(resolvedPort).toBe(DEFAULT_RENDERER_PORT + 1);
    expect(checkedPorts).toEqual([DEFAULT_RENDERER_PORT, DEFAULT_RENDERER_PORT + 1]);
  });

  it('starts from the configured PORT value and probes upward until it finds a free port', async () => {
    const occupiedPorts = new Set([5607, 5608]);

    await expect(
      resolveRendererDevPort('5607', (candidatePort) =>
        Promise.resolve(!occupiedPorts.has(candidatePort)),
      ),
    ).resolves.toBe(5609);
  });
});
