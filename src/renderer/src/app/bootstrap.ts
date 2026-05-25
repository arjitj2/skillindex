import { type SkillInventorySnapshot, type SkillIndexDesktopApi, type SkillIndexDevApi } from '@shared/contracts';
import {
  getBrowserPreviewDesktopApi,
  getBrowserPreviewDevApi,
  getBrowserPreviewInitialSnapshot,
} from './browser-preview-adapter';

export { createInitialSettingsState } from './browser-preview-adapter';

const cachedInventorySnapshotPromises = new WeakMap<SkillIndexDesktopApi, Map<string, Promise<SkillInventorySnapshot | null>>>();
const inventorySnapshotPromises = new WeakMap<SkillIndexDesktopApi, Map<string, Promise<SkillInventorySnapshot>>>();

export function getDesktopApi(): SkillIndexDesktopApi {
  if (typeof window !== 'undefined' && window.skillIndex) {
    return window.skillIndex;
  }

  return getBrowserPreviewDesktopApi();
}

export function getDevApi(): SkillIndexDevApi | null {
  if (typeof window !== 'undefined' && window.skillIndexDev) {
    return window.skillIndexDev;
  }

  if (typeof window === 'undefined' || !window.skillIndex) {
    return getBrowserPreviewDevApi();
  }

  return null;
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
