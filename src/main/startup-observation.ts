const DEFAULT_STARTUP_SCAN_DELAY_MS = 0;

export const STARTUP_SCAN_DELAY_ENV = 'SKILL_INDEX_TEST_STARTUP_SCAN_DELAY_MS';
export const STARTUP_SCAN_HOLD_ENV = 'SKILL_INDEX_TEST_STARTUP_SCAN_HOLD';

export interface StartupObservationAid {
  beforeInitialReconciliation(): Promise<void>;
  releaseInitialReconciliation(): void;
}

interface CreateStartupObservationAidOptions {
  env?: NodeJS.ProcessEnv;
  wait?: (timeoutMs: number) => Promise<void>;
}

export function createStartupObservationAid(
  options: CreateStartupObservationAidOptions = {},
): StartupObservationAid {
  const startupScanDelayMs = getStartupScanDelayMs(options.env);
  const holdInitialReconciliation = getStartupScanHold(options.env);
  const wait = options.wait ?? waitForDelay;

  let startupDelayPromise: Promise<void> | null = null;
  let hasObservedInitialReconciliation = false;
  let releaseInitialReconciliation: (() => void) | null = null;
  const holdPromise = holdInitialReconciliation
    ? new Promise<void>((resolve) => {
      releaseInitialReconciliation = resolve;
    })
    : Promise.resolve();

  return {
    async beforeInitialReconciliation() {
      if (hasObservedInitialReconciliation || startupScanDelayMs <= 0) {
        await holdPromise;
        hasObservedInitialReconciliation = true;
        return;
      }

      startupDelayPromise ??= wait(startupScanDelayMs).then(async () => {
        await holdPromise;
        hasObservedInitialReconciliation = true;
      });

      await startupDelayPromise;
    },
    releaseInitialReconciliation() {
      releaseInitialReconciliation?.();
      releaseInitialReconciliation = null;
    },
  };
}

export function getStartupScanDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const rawDelay = env[STARTUP_SCAN_DELAY_ENV]?.trim();
  if (!rawDelay) {
    return DEFAULT_STARTUP_SCAN_DELAY_MS;
  }

  const parsedDelay = Number.parseInt(rawDelay, 10);
  if (!Number.isFinite(parsedDelay) || parsedDelay <= 0) {
    return DEFAULT_STARTUP_SCAN_DELAY_MS;
  }

  return parsedDelay;
}

export function getStartupScanHold(env: NodeJS.ProcessEnv = process.env): boolean {
  const rawHold = env[STARTUP_SCAN_HOLD_ENV]?.trim().toLowerCase();
  return rawHold === '1' || rawHold === 'true' || rawHold === 'yes';
}

async function waitForDelay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
