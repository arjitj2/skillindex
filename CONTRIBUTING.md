# Contributing

Thanks for helping improve Skill Index. The most useful contributions keep agent
metadata accurate as agents change their skill directories, config files, MCP
formats, and install behavior.

## What We Welcome Most

- Agent-specific fixes backed by current primary docs or source links.
- Updates for MCP config paths, parser formats, icons, executable names, and
  skill-directory behavior.
- Small, focused PRs that change one logical thing and are easy to review.

For non-agent-specific product or architecture changes, please open a GitHub
issue first. Those changes may or may not be accepted, depending on product
direction and maintenance cost.

## Where Agent Changes Go

- `src/shared/agent-catalog.ts` is the canonical source for agent facts:
  labels, aliases, install detection, skill directories, MCP config paths,
  parser/write dialects, subagent directories/formats, icons, and source notes.
  Keep related facts inside the relevant agent entry.
- `docs/reference/agent-catalog-file-hierarchy.md` explains the catalog
  architecture. Update it when the maintenance workflow changes.
- `docs/reference/agent-catalog-maintenance-guide.md` gives the review and test
  checklist for agent metadata changes.
- `.agents/skills/skillindex-testing/SKILL.md` is this repo's agent testing
  guide. Keep it project-focused and free of machine-specific paths.

External catalogs can be useful research inputs, but Skill Index does not vendor
or refresh them directly. Fold documented facts into `src/shared/agent-catalog.ts`
with primary source links.

## Pull Requests

- Keep PRs small and focused.
- State the model used to create or assist the change, including provider and
  exact model name/version. If no AI was used, write `None`.
- Include the source links used for agent metadata changes.
- Run the relevant checks before opening the PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
```
