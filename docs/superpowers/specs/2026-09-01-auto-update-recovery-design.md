# Auto-Update Recovery Design

## Problem

The renderer currently treats `AutoUpdateStatus.phase === "ready"` as if installation has already started. For users who completed onboarding, the main process only downloaded the update; it has not called `quitAndInstall`. Nevertheless, the renderer displays an undismissable “Relaunching Skill Index… / Download complete” modal over the sidebar’s actual Update button. The app therefore appears stuck even though the native install handoff never began.

After installation really begins, macOS `electron-updater` exposes the downloaded ZIP through a local proxy and asks native Squirrel/ShipIt to stage and install it. That second handoff can also fail to terminate the app, so the corrected UI needs a bounded recovery state rather than another permanent spinner.

The immediate settle-delay hotfix remains part of this work: a newly downloaded update waits six seconds before the first native install request. This design adds recovery for cases where that request still does not terminate the app.

## Approaches Considered

1. **Repeat `quitAndInstall` from the same process.** This is the smallest change, but each call can add another native updater listener. A later success could invoke multiple quit handlers, and it does not reset a wedged native updater.
2. **Watchdog plus a clean relaunch retry.** After a bounded wait, show recovery controls. A retry restarts Skill Index, records one pending retry, reacquires the cached update in a fresh updater process, waits for the settle window, and tries once automatically. This resets native updater state and prevents unbounded retry loops.
3. **Manual installer only.** This is the most dependable fallback, but unnecessarily sends every transient failure through a browser and DMG installation.

The selected approach is **watchdog plus one clean relaunch retry**, with a manual installer link and a dismiss option available from the recovery state.

## User Experience

The update dialog has four distinct states:

1. **Downloading:** Keep the existing progress display.
2. **Ready:** Show “Download complete” and a primary **Restart and apply update** button. Show **Not now** as a secondary action so the modal is never blocking; dismissing it leaves the sidebar Update button available. No install begins until the user presses the primary button, except when an existing pre-onboarding automatic-update rule intentionally initiates the same action.
3. **Installing:** After the button is pressed, show “Preparing to restart Skill Index…” with the completed progress bar. Controls are temporarily disabled while the native handoff has a 15-second watchdog window.
4. **Recovery:** If the process is still running when the watchdog expires, replace the spinner-only state with clear copy: “Skill Index couldn’t restart automatically. Your update is still downloaded.” Show:
   - **Quit and try again** as the primary action.
   - **Download installer manually** as a secondary action, opening the public Skill Index download page in the default browser.
   - **Not now** as a tertiary action, dismissing the modal while leaving the update ready in the sidebar.

The modal must never be permanently blocking in either `ready` or `recovery`. Keyboard focus moves to the state heading, and all actions have accessible names.

## Main-Process State and Data Flow

`AutoUpdateStatus` becomes the authoritative cross-process state. In addition to the existing phases, it gains:

- `installing`, with the target version and install start timestamp.
- `recovery`, with the target version, a user-facing recovery message, and whether the one-shot retry remains available.

When installation is requested, the main process:

1. Waits for any remaining portion of the six-second Squirrel settle window.
2. Publishes `installing`.
3. Calls `quitAndInstall(false, true)`.
4. Starts a 15-second watchdog.
5. If the process remains alive, publishes `recovery`.

Only one install attempt may be active in a process. Repeated IPC requests return the current status instead of registering duplicate native callbacks.

The recovery IPC actions are:

- `retryUpdateInstall`: persist a one-shot retry marker, then call `app.relaunch()` and `app.exit(0)`.
- `openManualUpdateDownload`: open `https://skillindex.app` through Electron’s external-shell API.
- `dismissUpdateRecovery`: return the status to `ready` without deleting the cached update. The renderer also dismisses the ready prompt for that version while leaving the sidebar action visible.

## One-Shot Retry

The retry marker is a small JSON file under Electron’s user-data directory containing the update version, creation timestamp, and attempt count. It contains no user data.

On the next launch, the updater performs its normal metadata check. When the matching version reaches `ready`, Skill Index consumes the marker, waits for the settle window, and starts exactly one automatic install attempt. The marker is deleted before that attempt begins so a crash or second failure cannot create a relaunch loop. A stale marker, a version mismatch, or malformed JSON is discarded.

If the retry fails, the dialog returns to `recovery`; the manual installer and **Not now** remain available, while **Quit and try again** is disabled because the one automatic retry has already been used for that version.

## Error Handling

- Updater errors during the settle or install window cancel the watchdog and publish the existing `error` status.
- A failed relaunch-marker write leaves the app in `recovery` and reports that the retry could not be prepared.
- Failure to open the download page is shown through the existing error-toast path.
- Dismissing either the ready prompt or recovery never clears the cached update or the sidebar update affordance.
- Shutdown logic clears timers so tests and normal exits do not leave active work behind.

## Testing and Verification

Automated coverage will include:

- Main-process fake-timer tests for the settle delay, single in-flight install, watchdog transition, dismissal, and retry-marker validation/consumption.
- IPC and preload contract tests for retry, manual download, and dismissal actions.
- Renderer tests proving that `ready` is labeled “Download complete” rather than “Relaunching,” that it invokes installation only after **Restart and apply update**, and that all four dialog states, dismissal behavior, retry availability, and accessible labels render correctly.
- Existing full typecheck, lint, Vitest, and production build checks.

Real-app verification will use a mocked updater status in a dev/Sandbox app to exercise `ready → installing → recovery → not now` and capture the final recovery dialog. The signed release should also be manually tested by updating an installed prior version before publishing the tag.

## Release and Existing-User Recovery

Ship this as a new signed and notarized patch release, not by replacing an existing release asset. Existing users whose old process is already stuck still need to Force Quit and reopen, or install the latest DMG manually; a new release cannot change code already executing in the old process. On reopening, normal update metadata points them to the new patch release.
