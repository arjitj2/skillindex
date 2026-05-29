# Agent Catalog Architecture

Skill Index owns one canonical agent catalog:

| File | Owns |
| --- | --- |
| `src/shared/agent-catalog.ts` | Agent labels, aliases, install detection, skills locations, MCP config facts, subagent facts, parser/write dialects, icons, evidence URLs, and env-aware path resolvers. |
| `src/shared/skill-path-policy.ts` | Product-level canonical path constants such as `~/.agents/skills`. |

The product tracks skills, MCPs, subagents, and plugin-bundled assets, so agent
facts live together in `agent-catalog.ts`.

## Catalog Shape

Each entry in `AGENT_CATALOG` describes one agent family. Keep related facts
together in that entry:

- Skill facts: `defaultGlobalSkillsDir`, `nativeGlobalSkillsDir`,
  `compatibleGlobalSkillsDirs`, `defaultProjectSkillsDir`,
  `compatibleProjectSkillsDirs`, and `skillStorageKind`.
- MCP facts: `mcpConfigRelativeParts`, `mcpConfigKind`, `mcpParserKind`,
  `mcpWriteDialect`, and `mcpSupportedTransports`.
- Subagent facts: `subagentGlobalDirRelativeParts`, `subagentProjectDir`,
  `subagentConfigKind`, `subagentParserKind`, and `subagentWriteDialect`.
- Runtime facts: `resolveLiveSkillsDir`, config/subagent resolvers,
  `detectInstalled`, and `expectedExecutableNames`.
- Provenance: `metadataSources` and, when the source specifically proves skill
  directory behavior, `skillDirectoryMetadataSources`.

`agent(...)` normalizes entries at load time. It guarantees:

- `nativeGlobalSkillsDir` defaults to `defaultGlobalSkillsDir`.
- `compatibleGlobalSkillsDirs` always includes the default and native global
  skills directories.
- `compatibleProjectSkillsDirs` defaults to an empty array.
- `skillStorageKind` defaults to `local-directory`.
- skill-directory source notes are merged into `metadataSources`.

## Skill Directories

`defaultGlobalSkillsDir` is the directory Skill Index treats as the agent's
current primary global skills location.

`nativeGlobalSkillsDir` is the agent-owned global directory used for env-aware
live path resolution when it differs from Skill Index's canonical path.

For example, Codex has:

- `defaultGlobalSkillsDir: ~/.agents/skills`
- `nativeGlobalSkillsDir: ~/.codex/skills`
- `compatibleGlobalSkillsDirs: ~/.codex/skills`
- `resolveLiveSkillsDir` that honors `CODEX_HOME`

That lets the app show the canonical shared skills directory while still
resolving `~/.codex/skills` correctly in live and sandbox scans.

## MCP Metadata

MCP catalog metadata has two separate concerns:

- `mcpParserKind`: how Skill Index reads an agent config and extracts existing
  MCP definitions.
- `mcpWriteDialect`: how Skill Index materializes a normalized MCP definition
  back into that agent's documented config shape.

Do not infer the write dialect from the parser kind. Several agents share a
similar read container but require different remote-server output:

| Dialect | Example agents | Remote shape |
| --- | --- | --- |
| `json-type-url` | Claude Code, Factory, Roo Code | `{ "type": "http", "url": "..." }` or `{ "type": "streamable-http", "url": "..." }` |
| `json-url` | Amp, Cursor, Cline, Zencoder | `{ "url": "..." }` |
| `json-http-url` | Gemini CLI, Qwen Code | `{ "httpUrl": "..." }` for Streamable HTTP |
| `json-opencode` | OpenCode | `{ "type": "remote", "url": "..." }` |
| `json-openclaw` | OpenClaw | `{ "transport": "streamable-http", "url": "..." }` |
| `toml-codex` | Codex CLI | `url = "..."` under `[mcp_servers.<name>]` |
| `toml-transport-array` | Mistral Vibe | `transport = "streamable-http"` plus `url = "..."` under `[[mcp_servers]]` |

If docs only prove where MCP definitions live, add or update `mcpParserKind`
only. Add `mcpWriteDialect` only when official docs or source establish the
persisted write shape well enough for Skill Index to mutate that config safely.

## Subagent Metadata

Subagents are closer to skills than MCPs: they are usually portable files with a
documented directory. The catalog should record both where an agent stores them
and which format Skill Index can safely parse/write.

Use `subagentConfigKind: 'unknown'` or `subagentParserKind: 'unknown'` when docs
prove subagents exist but do not prove a local scanned path or file shape. Do not
guess.

## Updating The Catalog

When adding or changing an agent:

1. Edit `src/shared/agent-catalog.ts`.
2. Keep facts inside the relevant agent entry.
3. Include primary docs or source links in `metadataSources`.
4. Use `nativeGlobalSkillsDir` when an agent still has an agent-owned location
   that differs from `~/.agents/skills`.
5. Update focused tests in `src/shared/agent-catalog.test.ts` or the
   inventory tests when behavior changes.
6. Run the checks from `.agents/skills/skillindex-testing/SKILL.md`.
