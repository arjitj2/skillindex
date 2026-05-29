# Agent Catalog Maintenance

Skill Index owns its agent metadata directly in
`src/shared/agent-catalog.ts`. Agent docs, source files, and external catalogs
can be useful research inputs, but the checked-in source of truth is
`AGENT_CATALOG`.

## When To Update

Update the catalog when:

- an agent adds, removes, or renames skill directories
- an agent changes MCP config locations or persisted MCP shape
- an agent adds documented local subagent support
- an agent changes subagent file format or required fields
- install detection or env-aware config roots change
- icon assets or source links need correction

## How To Update

1. Find primary docs or source for the specific behavior.
2. Edit the relevant entry in `src/shared/agent-catalog.ts`.
3. Put source links in `metadataSources`.
4. Use `skillDirectoryMetadataSources` for evidence that specifically proves
   skill-directory behavior.
5. Use `nativeGlobalSkillsDir` when the agent has an agent-owned global skills
   directory that differs from Skill Index's canonical `~/.agents/skills`.
6. Use `unknown` or omit write dialects when docs do not prove the behavior.
7. Add or update focused tests for the behavior you changed.

## Verification

For catalog-only changes, usually run:

```bash
pnpm typecheck
pnpm test -- src/shared/agent-catalog.test.ts src/main/inventory-source-model.test.ts
```

Run broader inventory tests when paths, parser kinds, write dialects, or
resolution behavior changes:

```bash
pnpm test -- \
  src/main/scan-inventory.test.ts \
  src/main/subagent-inventory.test.ts \
  src/main/issue-resolution.test.ts
```

If visible labels, icons, or paths change in the UI, also verify the relevant
view in a real app session and capture a screenshot.
