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

- `src/shared/upstream-agent-catalog.ts` is a vendored snapshot from
  `vercel-labs/skills` `src/agents.ts`. Refresh it from upstream when upstream
  adds agents or changes declared skill directories/install detection, and
  before each release-readiness sweep. Do not use it for Skill Index-only
  corrections.
- `src/shared/verified-agent-skill-directories.ts` is where primary-doc or
  source-verified skill-directory facts override stale or incomplete upstream
  data. Include evidence URLs.
- `src/shared/agent-catalog-overrides.ts` is for Skill Index enrichment:
  MCP/config paths, parser kinds, icons, ignored subpaths, executable hints, and
  source notes. Do not rewrite skill directories here.
- `src/shared/known-agent-catalog.ts` merges upstream, verified facts, and
  overrides. App code should read from this file, but contributors usually
  should not hard-code new facts here.
- `docs/reference/agent-catalog-file-hierarchy.md` explains which source files
  own each layer of agent catalog data. Update it when the maintenance workflow
  changes.
- `.agents/skills/skillindex-testing/SKILL.md` is this repo's agent testing
  guide. Keep it project-focused and free of machine-specific paths.

Follow `docs/reference/upstream-agent-catalog-refresh-guide.md` when rerunning the
`vercel-labs/skills` refresh. Preserve the local browser-safe adaptations in the
vendored file.

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
