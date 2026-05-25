# Agent Catalog File Hierarchy

Skill Index separates where each fact comes from and what the app finally believes.

## Files

| File | Owns | Does not own |
| --- | --- | --- |
| `src/shared/upstream-agent-catalog.ts` | Vendored skill-directory facts from `vercel-labs/skills`, labels, aliases, and install detection. | Local corrections based on docs discovered outside the upstream refresh. |
| `src/shared/verified-agent-skill-directories.ts` | Primary-doc or source-verified skill-directory facts that supersede stale or incomplete upstream data. | Icons, MCP config paths, parser kinds, or other UI enrichment. |
| `src/shared/agent-catalog-overrides.ts` | Skill Index enrichment: icons, MCP/config metadata, parser kinds, MCP write dialects, env-aware config resolvers, ignored subpaths, executable hints. | Rewriting skill directories or marking agents canonical/universal. |
| `src/shared/known-agent-catalog.ts` | The merged app catalog. This is the source most app code should use. | Raw upstream refresh data as product truth. |
| `src/shared/sandbox-paths.ts` | Skill Index path policy, including the canonical user store display path `~/.agents/skills`. | Agent-specific directory facts. |

## Merge Order

1. Start with the vendored upstream family.
2. Apply verified skill-directory facts, if present.
3. Add Skill Index enrichment from overrides.
4. Expose the merged result through `KNOWN_AGENT_FAMILIES`.

The merged catalog intentionally exposes the resolved app truth:

- `defaultGlobalSkillsDir`: the primary global skills directory Skill Index should treat as the agent's current default.
- `compatibleGlobalSkillsDirs`: other global directories the agent can read or that are useful fallback/native locations.
- `defaultProjectSkillsDir` and `compatibleProjectSkillsDirs`: documented project/workspace locations. These are metadata only unless inventory explicitly starts scanning workspace paths.

The merged catalog also keeps `upstreamDefaultGlobalSkillsDir` for main-process resolution and tests, but renderer contracts should not ask the UI to choose between upstream and verified values. UI-facing records should show the resolved `defaultGlobalSkillsDir`.

## MCP Metadata

MCP catalog metadata has two separate concerns:

- `mcpParserKind`: how Skill Index reads an agent config and extracts existing MCP definitions.
- `mcpWriteDialect`: how Skill Index materializes a normalized MCP definition back into that agent's documented config shape.

Do not infer the write dialect from the parser kind. Several agents share a similar read container but require different remote-server output:

| Dialect | Example agents | Remote shape |
| --- | --- | --- |
| `json-type-url` | Claude Code, Factory, Roo Code | `{ "type": "http", "url": "..." }` or `{ "type": "streamable-http", "url": "..." }` |
| `json-url` | Amp, Cursor, Cline, Zencoder | `{ "url": "..." }` |
| `json-http-url` | Gemini CLI, Qwen Code | `{ "httpUrl": "..." }` for Streamable HTTP |
| `json-opencode` | OpenCode | `{ "type": "remote", "url": "..." }` |
| `json-openclaw` | OpenClaw | `{ "transport": "streamable-http", "url": "..." }` |
| `toml-codex` | Codex CLI | `url = "..."` under `[mcp_servers.<name>]` |
| `toml-transport-array` | Mistral Vibe | `transport = "streamable-http"` plus `url = "..."` under `[[mcp_servers]]` |

If docs only prove where MCP definitions live, add or update `mcpParserKind` only. Add `mcpWriteDialect` only when official docs or source establish the persisted write shape well enough for Skill Index to mutate that config safely.

## Canonical Store

`~/.agents/skills` has two meanings in the app:

1. It is Skill Index's canonical user store for real skill packages.
2. For agents with verified support, it is also their primary global skill directory.

Those are related but not identical. A non-verified agent can still be repaired by symlinking from its native global directory to the canonical store. A verified agent that reads `~/.agents/skills` directly should not need an extra per-agent symlink just to be considered healthy.

## Current Verified Global Readers

These agents currently have verified facts that make `~/.agents/skills` the merged `defaultGlobalSkillsDir`:

| Agent family | Primary global dir | Fallback/native global dirs |
| --- | --- | --- |
| `codex` | `~/.agents/skills` | `~/.codex/skills` |
| `cursor` | `~/.agents/skills` | `~/.cursor/skills` |
| `deepagents` | `~/.agents/skills` | `~/.deepagents/agent/skills` |
| `firebender` | `~/.agents/skills` | `~/.firebender/skills` |
| `gemini-cli` | `~/.agents/skills` | `~/.gemini/skills` |
| `github-copilot` | `~/.agents/skills` | `~/.copilot/skills` |
| `kimi-cli` | `~/.agents/skills` | `~/.config/agents/skills` |
| `opencode` | `~/.agents/skills` | `~/.config/opencode/skills`, `~/.claude/skills` |
| `warp` | `~/.agents/skills` | `~/.warp/skills` |

If a family is not listed here, Skill Index uses the upstream global directory as its merged default.

## Updating Metadata

- If `vercel-labs/skills` changes, refresh `src/shared/upstream-agent-catalog.ts` using `upstream-agent-catalog-refresh-guide.md`.
- If a primary doc or source proves an agent reads a different directory than upstream says, add or update `src/shared/verified-agent-skill-directories.ts`.
- If the app needs MCP/config/icon/parser/write-dialect metadata, update `src/shared/agent-catalog-overrides.ts`.
- Do not put skill-directory rewrites in `agent-catalog-overrides.ts`.
