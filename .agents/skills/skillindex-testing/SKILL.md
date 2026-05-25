---
name: skillindex-testing
description: Use when changing Skill Index code and deciding what tests or manual verification to run, especially for UI, Electron, Sandbox, plugin resolution, filesystem, watcher, or cross-view behavior changes.
---

# Skill Index Testing

Use this skill whenever you modify this repo. Pick the smallest test set that gives real confidence, then report exactly what you ran and what you did not run.

For any visual/UI change, the final response to the user must attach a screenshot proving the rendered result. Attach it as a Markdown image using an absolute local path, for example `![verification screenshot](/absolute/path/to/screenshot.png)`. Do not only describe the visual result or only list a screenshot path.

## Testing Ladder

Run these from lowest cost to highest confidence:

1. `pnpm typecheck`
2. Focused Vitest for the files or layer you changed
3. Computer Use against the Electron app with Sandbox enabled when available
4. Playwright against the live app for UI changes, layout checks, or when Computer Use is unavailable
5. Broader suite only when the change crosses boundaries or the focused checks are not enough

## What To Run

### Logic, contracts, and filesystem behavior

Use focused Vitest for `src/main`, `src/preload`, and `src/shared`.

Examples:

```bash
pnpm typecheck
pnpm test -- src/main/skill-inventory.test.ts
pnpm test -- src/shared/renderer-dev-config.test.ts
```

### Renderer component behavior

Use focused Vitest for isolated component and view behavior in `src/renderer/src/**`.

Examples:

```bash
pnpm typecheck
pnpm test -- src/renderer/src/views/AgentsWorkspaceView.test.tsx
pnpm test -- src/renderer/src/components/ui.test.tsx
```

Use this for:

- conditional rendering
- filtering and search behavior
- section grouping
- button states
- text/content changes

Do not treat these tests as proof of layout correctness. JSDOM can verify structure, not actual rendered alignment.

### Cross-view renderer behavior

Use broader renderer tests like `src/renderer/src/app-shell.test.tsx` when a change affects:

- tab switching
- shared app state
- navigation between panes
- interactions spanning multiple views

If there are known unrelated failures, do not hide that. Run the most relevant focused tests, then clearly report the unrelated failing suite.

## Real App Verification Requirement

Use a real running app whenever the change affects actual presentation or multi-step interaction, not just DOM structure.

This is required for:

- column/header alignment
- spacing
- truncation and overflow
- sticky headers
- responsive behavior
- visual ordering
- click flows that need a real browser
- regressions that are easier to see than infer
- Electron-only flows, settings changes, filesystem-backed flows, watcher behavior, or Sandbox fixture interactions

If the question is "does this line up on screen?" or "does this actually look right?", use a real app check.

### Screenshot Evidence For Visual Changes

After every visual/UI change, capture a fresh screenshot of the final rendered state and include it directly in the final response to the user. The screenshot should show the changed area clearly enough for the user to verify spacing, ordering, visibility, and copy. Save screenshots under a stable local artifact path such as `output/skillindex-verification/`, then attach them with Markdown image syntax and an absolute filesystem path.

If the change affects more than one important state or viewport, attach one screenshot per state/viewport. If a screenshot truly cannot be captured, explicitly say why in the final response and provide the strongest available artifact or measurement instead.

## Representative Sandbox

Skill Index dev mode uses a generated filesystem mirror instead of the contributor's live agent directories. By default, the mirror is rooted at `~/.skillindex/sandbox/`; `SKILL_INDEX_SANDBOX_ROOT` can point it somewhere else. The fixture recipe lives in `src/main/sandbox-fixtures.ts`, so the sandbox can be rebuilt deterministically from repo-owned test data.

Treat Sandbox mode as the default for verification because repair actions can create directories, replace files with symlinks, update app config, and trigger filesystem watchers. The sandbox lets agents exercise those behaviors against representative `.agents`, plugin cache, MCP, and agent-specific paths without touching real skills or installed plugins in the user's home directory.

Use the app's `Reset representative sandbox` action before reproducing fixture-dependent bugs, after a repair mutates sandbox state, or whenever the observed inventory no longer matches the expected seeded scenarios. Only switch to Live mode when the task explicitly requires validating real local data, and call that out in the final report.

## Computer Use + Sandbox Workflow

When Computer Use is available, prefer it for realistic Skill Index flows. It exercises the Electron app, real IPC, the real filesystem sandbox, watcher refreshes, toasts, Settings controls, and detail-pane interactions more faithfully than browser-only checks.

Use this for:

- issue-resolution flows such as Diverged Copies, Missing Symlinks, Missing Universal, and plugin alternates
- Settings-tab actions, especially Reset representative sandbox
- flows involving `~/.skillindex/sandbox`, symlinks, plugin cache paths, or watcher-driven refreshes
- confirming that UI state does not regress after a background rescan or filesystem mutation

Typical loop:

1. Start the app with `pnpm dev`.
2. Open the Electron app with Computer Use.
3. In Settings, ensure Inventory source is Sandbox.
4. Use Reset representative sandbox before reproducing fixture-based bugs.
5. Walk the user-facing flow with clicks, tabs, and real detail panes.
6. Verify final UI state with Computer Use and, when relevant, verify filesystem state with shell commands such as `readlink`.
7. For visual/UI changes, save a screenshot artifact of the final app state and attach it in the final response. If Computer Use does not provide a file artifact, use Playwright or `screencapture` to create one.

Report the exact manual flow, the final UI state, and any filesystem assertions. If Computer Use is not available to the agent, use Playwright instead.

## Playwright Workflow

Playwright remains the portable real-browser option and is still preferred for agents without Computer Use access, for precise browser layout measurements, and for screenshot artifacts.

For UI changes verified with Playwright, capture a screenshot artifact and attach it in the final report as a Markdown image using its absolute local path so the visual result is visible in the conversation.

Start the app:

```bash
pnpm dev
```

Use the renderer URL printed by `electron-vite dev`, then drive it with the Playwright CLI wrapper:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"

"$PWCLI" open http://127.0.0.1:PORT/ --headed
"$PWCLI" snapshot
```

Typical loop:

1. Open the live app in a headed browser.
2. Navigate to the affected page.
3. Inspect the real UI with `snapshot`.
4. If layout is the concern, measure element positions with `eval`.
5. Capture a screenshot in `output/playwright/`.
6. Re-run after the fix and compare.
7. Attach the final screenshot in the final response as `![verification screenshot](/absolute/path/to/output/playwright/example.png)`.

Useful examples:

```bash
"$PWCLI" click e34
"$PWCLI" snapshot
"$PWCLI" eval '() => [...document.querySelectorAll(".agent-status-row")].length'
"$PWCLI" screenshot output/playwright/agents-page.png
```

For layout verification, prefer direct measurements over eyeballing when possible.

Example pattern:

```bash
"$PWCLI" eval '() => {
  const header = document.querySelector(".some-header");
  const cell = document.querySelector(".some-row-cell");
  if (!header || !cell) return null;
  const h = header.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  return { headerLeft: Math.round(h.left), cellLeft: Math.round(c.left) };
}'
```

## Validation Rules

- Do not claim a UI fix is complete if you only ran JSDOM tests for a layout issue.
- Do not claim a logic fix is complete if you only checked it manually in the browser.
- Do not claim an Electron/Sandbox interaction is complete if you only reasoned from unit tests and did not run the flow when Computer Use was available.
- Prefer focused tests first; expand only when the change touches shared behavior.
- If a command fails for unrelated reasons, say so explicitly and separate it from the change you validated.

## Default Recommendation Matrix

- Non-UI code: `pnpm typecheck` + targeted Vitest
- Renderer behavior change: `pnpm typecheck` + targeted renderer Vitest
- UI/layout/polish change: `pnpm typecheck` + targeted renderer Vitest + Computer Use or Playwright
- Cross-view app behavior: `pnpm typecheck` + targeted tests + app-shell coverage as needed + Computer Use when available
- Electron/Sandbox/filesystem flow: `pnpm typecheck` + targeted main/runtime Vitest + Computer Use with Sandbox reset when available

## Completion Note

When reporting back, include:

- what changed
- exact commands run
- what passed
- what was not run
- for visual/UI changes, a Markdown image attachment of the verification screenshot, or a clear explanation for why no screenshot could be captured
- any unrelated failing suites that still exist
