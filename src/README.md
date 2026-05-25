# Source Layout

`src/` is split by Electron process boundary first, then by shared contracts and pure helpers. When adding or changing behavior, start in the area that owns the side effect or user-facing surface, then follow the shared types back across the boundary.

## Process Areas

| Area | Owns | Look here for |
| --- | --- | --- |
| `main/` | Electron main process, privileged Node/Electron APIs, filesystem work, app lifecycle, IPC handlers, inventory mutation, audit logging, and dev sandbox setup. | Startup flow in `main/index.ts`, window creation in `main/window.ts`, renderer-facing handlers in `main/ipc.ts`, inventory orchestration in `main/inventory-runtime.ts`, skill scanning in `main/skill-inventory.ts`, plugin scanning in `main/plugin-inventory.ts`, settings in `main/settings-state.ts`, and audit/undo behavior in `main/audit-log.ts`. |
| `preload/` | The narrow bridge between Electron and the renderer. It exposes safe APIs with `contextBridge`, adapts `ipcRenderer`, and reads synchronous startup bootstrap state. | Renderer API exposure in `preload/index.ts`, initial inventory bootstrap loading in `preload/inventory-bootstrap.ts`, and bridge-focused tests. |
| `renderer/` | React UI, view state, presentation models, browser-preview fallbacks, CSS, and component/view tests. | App orchestration in `renderer/src/App.tsx`, React entry in `renderer/src/main.tsx`, desktop/browser API selection in `renderer/src/app/bootstrap.ts`, browser preview data in `renderer/src/app/browser-preview-adapter.ts`, table/filter/sort models in `renderer/src/inventory-view-model.ts`, reusable UI in `renderer/src/components/`, and workspace screens in `renderer/src/views/`. |
| `shared/` | Types and pure logic that must be usable from more than one process. This folder should stay free of Electron process side effects. | IPC channel names, request/response types, and API factories in `shared/contracts.ts`; path policy in `shared/skill-index-paths.ts` and `shared/skill-path-policy.ts`; MCP/TOML parsing helpers; build flavor checks; text diffing; and the known agent catalog. |

## Dependency Direction

- `main/`, `preload/`, and `renderer/` may import from `shared/`.
- `renderer/` should talk to privileged behavior through the `SkillIndexDesktopApi` exposed by preload, not by importing `main/`.
- `preload/` should stay thin: bridge IPC and bootstrap state, but keep app behavior in `main/` or pure helpers in `shared/`.
- `shared/` should not import from `main/`, `preload/`, or `renderer/`.

## Tests

Tests live next to the code they cover. For narrow changes, run the closest `*.test.ts` or `*.test.tsx` file first. For cross-boundary changes, expect to touch tests in more than one area because `shared/contracts.ts` connects the main process, preload bridge, and renderer.
