import { type SkillInventorySnapshot, type SkillIndexDesktopApi, type SkillIndexDevApi } from '@shared/contracts';
import { unwrapIpcResponse } from '@shared/ipc-error';
import {
  getBrowserPreviewDesktopApi,
  getBrowserPreviewDevApi,
  getBrowserPreviewInitialSnapshot,
} from './browser-preview-adapter';

export { createInitialSettingsState } from './browser-preview-adapter';

const cachedInventorySnapshotPromises = new WeakMap<SkillIndexDesktopApi, Map<string, Promise<SkillInventorySnapshot | null>>>();
const inventorySnapshotPromises = new WeakMap<SkillIndexDesktopApi, Map<string, Promise<SkillInventorySnapshot>>>();
const diagnosticApiByBridge = new WeakMap<object, object>();

export function getDesktopApi(): SkillIndexDesktopApi {
  if (typeof window !== 'undefined' && window.skillIndex) {
    return withIpcErrorUnwrapping(window.skillIndex);
  }

  return getBrowserPreviewDesktopApi();
}

export function getDevApi(): SkillIndexDevApi | null {
  if (typeof window !== 'undefined' && window.skillIndexDev) {
    return withIpcErrorUnwrapping(window.skillIndexDev);
  }

  if (typeof window === 'undefined' || !window.skillIndex) {
    return getBrowserPreviewDevApi();
  }

  return null;
}

function withIpcErrorUnwrapping<T extends object>(api: T): T {
  const existingApi = diagnosticApiByBridge.get(api);
  if (existingApi) {
    return existingApi as T;
  }

  const diagnosticApi: Record<PropertyKey, unknown> = {};
  for (const property of Reflect.ownKeys(api)) {
    const value: unknown = Reflect.get(api, property);
    diagnosticApi[property] = typeof value === 'function'
      ? (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, api, args);
          return isPromiseLike(result)
            ? result.then((response) => unwrapIpcResponse(response))
            : result;
        }
      : value;
  }
  diagnosticApiByBridge.set(api, diagnosticApi);
  return diagnosticApi as T;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}

export function getInitialInventorySnapshot(): SkillInventorySnapshot | null {
  if (typeof window !== 'undefined' && window.skillIndexBootstrap) {
    return window.skillIndexBootstrap.initialInventorySnapshot;
  }

  if (typeof window === 'undefined' || !window.skillIndex) {
    return getBrowserPreviewInitialSnapshot();
  }

  return null;
}

async function waitForDelay(timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

export async function loadInventorySnapshot(
  desktopApi: SkillIndexDesktopApi,
): Promise<SkillInventorySnapshot> {
  return loadCachedApiResult(inventorySnapshotPromises, desktopApi, () => desktopApi.scanInventory());
}

export async function loadCachedInventorySnapshot(
  desktopApi: SkillIndexDesktopApi,
): Promise<SkillInventorySnapshot | null> {
  return loadCachedApiResult(cachedInventorySnapshotPromises, desktopApi, () => desktopApi.readCachedInventory());
}

function loadCachedApiResult<T>(
  cacheStore: WeakMap<SkillIndexDesktopApi, Map<string, Promise<T>>>,
  desktopApi: SkillIndexDesktopApi,
  load: () => Promise<T>,
): Promise<T> {
  const cacheKey = 'session';
  const cachedPromise = cacheStore.get(desktopApi)?.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const promise = load().catch((error) => {
    cacheStore.get(desktopApi)?.delete(cacheKey);
    throw error;
  });

  getPromiseCache(cacheStore, desktopApi).set(cacheKey, promise);
  return promise;
}

export function isOlderInventorySnapshot(currentSnapshot: SkillInventorySnapshot, nextSnapshot: SkillInventorySnapshot): boolean {
  return new Date(nextSnapshot.scannedAt).getTime() < new Date(currentSnapshot.scannedAt).getTime();
}

export async function waitForStartupObservation(timeoutMs: number): Promise<void> {
  await waitForDelay(timeoutMs);
}

function getPromiseCache<T>(
  cacheStore: WeakMap<SkillIndexDesktopApi, Map<string, Promise<T>>>,
  desktopApi: SkillIndexDesktopApi,
): Map<string, Promise<T>> {
  const existingCache = cacheStore.get(desktopApi);
  if (existingCache) {
    return existingCache;
  }

  const nextCache = new Map<string, Promise<T>>();
  cacheStore.set(desktopApi, nextCache);
  return nextCache;
}
