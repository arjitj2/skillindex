# Upstream Agent Catalog Refresh

This repo vendors agent metadata from [`vercel-labs/skills`](https://github.com/vercel-labs/skills) instead of importing it at runtime.

Use this guide when upstream adds agents, changes supported skills directories, or updates install detection logic.

For the full catalog file hierarchy, see [agent-catalog-file-hierarchy.md](./agent-catalog-file-hierarchy.md).

## Source Of Truth Split

- Upstream owns agent-declared metadata from the `vercel-labs/skills` README and `src/agents.ts`:
  - agent labels
  - project `skillsDir`
  - global `globalSkillsDir`
  - install detection behavior
- Skill Index owns verified skill-directory facts in [src/shared/verified-agent-skill-directories.ts](/src/shared/verified-agent-skill-directories.ts):
  - primary-doc or source-confirmed global skill directories that supersede stale or incomplete upstream data
  - fallback/native global skill directories kept for compatibility
  - evidence URLs explaining the divergence
- Skill Index owns local overlay metadata in [src/shared/agent-catalog-overrides.ts](/src/shared/agent-catalog-overrides.ts):
  - MCP config paths
  - agent config paths
  - MCP parser kinds
  - MCP write dialects
  - icon metadata
  - researched source URLs and notes
- Skill Index owns product policy in [src/shared/sandbox-paths.ts](/src/shared/sandbox-paths.ts):
  - the canonical Skill Index user store, currently `~/.agents/skills`
  - the sandbox equivalent of that store
  - repair behavior that writes the canonical copy there and links agent-owned dirs to it

## Refresh Steps

1. Open the current upstream files:
   - `https://github.com/vercel-labs/skills#supported-agents`
   - `https://github.com/vercel-labs/skills/blob/main/src/agents.ts`
   - `https://github.com/vercel-labs/skills/blob/main/src/types.ts` if upstream types changed
2. Update [src/shared/upstream-agent-catalog.ts](/src/shared/upstream-agent-catalog.ts) to match upstream agent definitions and `detectInstalled()` behavior.
   - Treat upstream `skillsDir` as Skill Index `defaultProjectSkillsDir`.
   - Treat upstream `globalSkillsDir` as the upstream default global dir.
   - Do not reinterpret project `.agents/skills` as global `~/.agents/skills`.
3. If primary docs prove that an agent currently reads a different global directory than upstream says, update [src/shared/verified-agent-skill-directories.ts](/src/shared/verified-agent-skill-directories.ts) instead of editing the vendored upstream snapshot.
   - The merged `defaultGlobalSkillsDir` can differ from upstream when verified facts exist.
   - Keep the upstream/native directory as a compatible fallback when it is still useful.
4. Preserve Skill Index-specific browser-safe adaptations in the vendored file.
   - Keep `getBuiltinModule(...)` / lazy builtin access so renderer imports stay safe.
   - Keep local helper wrappers when they are required for shared-code execution in Electron renderer and main.
5. Reconcile intentional local divergences in:
   - [src/shared/verified-agent-skill-directories.ts](/src/shared/verified-agent-skill-directories.ts)
   - [src/shared/agent-catalog-overrides.ts](/src/shared/agent-catalog-overrides.ts)
   - [src/shared/known-agent-catalog.ts](/src/shared/known-agent-catalog.ts)
6. Re-check the evidence URLs and notes in [src/shared/agent-catalog-overrides.ts](/src/shared/agent-catalog-overrides.ts) and [src/shared/verified-agent-skill-directories.ts](/src/shared/verified-agent-skill-directories.ts) when:
   - an agent is added or renamed
   - a project/global skill path changed upstream
   - config/MCP behavior changed
7. If a refresh changes project/global skill paths, verify the downstream effects in:
   - `src/main/inventory-source-model.ts`
   - `src/main/skill-inventory.ts`
   - `src/main/skill-canonicalization.ts`

## Things To Be Careful About

- Do not move MCP/config/parser/icon data into the vendored upstream snapshot. That data remains local.
- Do not infer `mcpWriteDialect` from `mcpParserKind`; the read/write split is documented in [agent-catalog-file-hierarchy.md](./agent-catalog-file-hierarchy.md).
- Do not use overrides to rewrite upstream skill directories. If upstream is stale but primary docs are clearer, add verified facts in `verified-agent-skill-directories.ts`.
- Do not treat compatible alternate scan directories as upstream project/global directories.
- Keep `~/.agents/skills` as Skill Index's canonical global home for canonicalization/drift repair unless product direction changes. This is product policy, and it is also the primary global skills directory for agents with verified `~/.agents/skills` support.
- Remember that `.agents/skills` in the upstream table is a project-level path. It is distinct from global `~/.agents/skills`.
- Keep sandbox install detection aligned with the vendored upstream `detectInstalled()` behavior.

## Verification

Run:

```bash
pnpm typecheck
pnpm exec vitest run \
  src/shared/known-agent-catalog.test.ts \
  src/main/inventory-source-model.test.ts \
  src/main/skill-inventory.test.ts \
  src/main/skill-canonicalization.test.ts \
  src/main/issue-resolution.test.ts \
  src/renderer/src/lib/detail-inspector-model.test.ts \
  src/renderer/src/components/DetailInspectorPanel.test.tsx
```

If the refresh changes visible agent labels, directories, icons, or config paths, also do a live browser verification of the Agents view with Playwright.

## When To Review Overlay Metadata

Review local overlay metadata when:
- a new agent is added
- an MCP/config path changes
- parser behavior changes
- write shape or remote transport serialization changes
- icon sourcing changes
- a future maintainer would benefit from fresher source hints in the code
