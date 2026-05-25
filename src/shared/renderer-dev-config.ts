import { getRenderableAgentIconOrigins } from './agent-catalog-overrides';

export const DEFAULT_RENDERER_PORT = 5600;
export const RENDERER_CONNECT_SRC_PLACEHOLDER = '__SKILL_INDEX_RENDERER_CONNECT_SRC__';
export const RENDERER_IMG_SRC_PLACEHOLDER = '__SKILL_INDEX_RENDERER_IMG_SRC__';
const MAX_RENDERER_PORT_CHECKS = 100;
const ALLOWED_RENDERER_IMG_ORIGINS = getRenderableAgentIconOrigins();

export type PortAvailabilityCheck = (port: number) => Promise<boolean>;

export function resolveRendererPort(portValue: string | undefined): number {
  const parsedPort = Number(portValue ?? DEFAULT_RENDERER_PORT);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    return DEFAULT_RENDERER_PORT;
  }

  return parsedPort;
}

export async function resolveRendererDevPort(
  portValue: string | undefined,
  isPortAvailable: PortAvailabilityCheck,
): Promise<number> {
  const startingPort = resolveRendererPort(portValue);

  for (let attempt = 0; attempt < MAX_RENDERER_PORT_CHECKS; attempt += 1) {
    const candidatePort = startingPort + attempt;

    if (await isPortAvailable(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(
    `Could not find an open renderer port after checking ${MAX_RENDERER_PORT_CHECKS} ports starting at ${startingPort}.`,
  );
}

export function buildRendererConnectSrc(port: number): string {
  return `'self' ws://127.0.0.1:${port} http://127.0.0.1:${port}`;
}

export function buildRendererImgSrc(): string {
  return `'self' data: ${ALLOWED_RENDERER_IMG_ORIGINS.join(' ')}`;
}

export function injectRendererConnectSrc(html: string, port: number): string {
  return html.replace(RENDERER_CONNECT_SRC_PLACEHOLDER, buildRendererConnectSrc(port));
}

export function injectRendererImgSrc(html: string): string {
  return html.replace(RENDERER_IMG_SRC_PLACEHOLDER, buildRendererImgSrc());
}
