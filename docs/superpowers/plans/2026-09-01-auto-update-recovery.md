# Auto-Update Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Skill Index 0.2.4 with an actionable downloaded-update dialog, a bounded native-install watchdog, recovery actions, and a prominent README incident notice.

**Architecture:** The main process owns update lifecycle phases and the watchdog; the shared/preload contract exposes recovery actions; the renderer only presents state and records when a ready prompt was dismissed. A one-shot marker in Electron user data allows one clean-process automatic retry without creating a relaunch loop.

**Tech Stack:** Electron, electron-updater/Squirrel.Mac, React, TypeScript, Vitest, Testing Library, GitHub Actions.

---

### Task 1: Extend update contracts

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/preload/bridge.test.ts`

- [ ] Add failing bridge assertions for `retryUpdateInstall`, `openManualUpdateDownload`, and `dismissUpdateRecovery`, and for `installing`/`recovery` status fields.
- [ ] Run `pnpm exec vitest run src/preload/bridge.test.ts` and confirm the new API assertions fail.
- [ ] Add IPC channel constants and desktop API methods; extend `AutoUpdateStatus.phase` with `installing` and `recovery`, plus `installStartedAt`, `errorMessage`, and `retryAvailable` where applicable.
- [ ] Re-run the preload test and confirm it passes.

### Task 2: Implement the main-process watchdog and recovery actions

**Files:**
- Modify: `src/main/auto-update.ts`
- Modify: `src/main/auto-update.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/ipc.test.ts`

- [ ] Add failing fake-timer tests proving: the six-second settle delay remains; only one install request runs; install publishes `installing`; 15 seconds without exit publishes `recovery`; dismissal returns to `ready`; retry writes a one-shot marker and relaunches; a matching marker is consumed once.
- [ ] Run `pnpm exec vitest run src/main/auto-update.test.ts src/main/ipc.test.ts` and confirm the new assertions fail for missing behavior.
- [ ] Implement a single in-flight install promise and watchdog timer in `auto-update.ts`; clear both on error, dismissal, and lifecycle reset.
- [ ] Implement retry-marker parsing with `{ version, createdAt, attemptCount: 1 }`, a 24-hour stale cutoff, deletion before automatic retry, and no second retry for the same process/version.
- [ ] Register IPC handlers that call `retryReadyAutoUpdate`, `openManualUpdateDownload`, and `dismissAutoUpdateRecovery`.
- [ ] Re-run the focused main/IPC tests and confirm they pass.

### Task 3: Make the update dialog actionable

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/app-shell.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/app/browser-preview-adapter.ts`

- [ ] Add failing renderer tests proving `ready` says “Download complete,” does not say “Relaunching,” and exposes **Restart and apply update** plus **Not now**; `installing` shows the bounded waiting state; `recovery` exposes retry, manual download, and dismissal actions.
- [ ] Run the focused app-shell tests and confirm they fail against the current spinner-only dialog.
- [ ] Add dialog callbacks and a per-version dismissed-ready-prompt ref/state; wire the three recovery desktop API methods and existing error-toast handling.
- [ ] Add compact action-row styles matching the existing update dialog and reduced-motion behavior.
- [ ] Extend browser preview mocks so `?mock-update=ready`, `installing`, and `recovery` can render each state without a packaged updater.
- [ ] Re-run the focused renderer tests and confirm they pass.

### Task 4: Add the incident notice and bump 0.2.4

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Add a blockquote immediately below the README title: users stuck on “Download complete” in 0.2.2/0.2.3 should Force Quit, download the latest DMG from `https://skillindex.app`, replace the app in Applications, and keep their existing `~/.skillindex` data.
- [ ] Run `pnpm version 0.2.4 --no-git-tag-version` and verify both package manifests report `0.2.4`.
- [ ] Check `git diff --check` and confirm the notice is the first substantive README content.

### Task 5: Verify UI and release build

**Files:**
- Create: `output/skillindex-verification/update-recovery.png`

- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test -- --maxWorkers=4`, and `pnpm build`; require zero failures.
- [ ] Run the dev app in Sandbox mode, render the mocked recovery status, exercise **Not now**, and capture the recovery dialog screenshot at the artifact path above.
- [ ] Run `git diff --check`, inspect the full diff, and confirm only updater, documentation, version, and plan/spec files changed.

### Task 6: Commit, tag, publish, and monitor

**Files:**
- No additional source files.

- [ ] Commit the updater implementation, tests, README notice, version bump, and plan with message `Fix auto-update recovery flow`.
- [ ] Confirm the repository is on a branch suitable for pushing; if the worktree is detached, create `arjit/auto-update-recovery-0.2.4` at the verified commit.
- [ ] Push the branch and ensure CI passes, then fast-forward or merge it to `main` without rewriting unrelated history.
- [ ] Create annotated tag `v0.2.4` at the verified main commit and push it.
- [ ] Monitor `.github/workflows/release.yml` through signing, notarization, smoke launch, and GitHub asset publication.
- [ ] Verify the release contains the universal DMG, stable DMG alias, ZIP, ZIP blockmap, and `latest-mac.yml`, then report the release URL and any remaining manual prior-version update limitation.
