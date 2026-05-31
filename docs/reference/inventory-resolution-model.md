# Inventory Resolution Model

Source of truth for inventory item types, issue names, and repair behavior. Keep
this document aligned with `src/shared/contracts.ts`, inventory scanners, and
resolution tests.

## Universal Sources

| Item type | Universal source | Agent-local representation |
| --- | --- | --- |
| Skills | Preferred canonical skills directory, default `~/.agents/skills` | Skill package in each agent skills directory, usually a symlink to Universal |
| Subagents | `~/.agents/agents` | One subagent file per agent, written in that agent's supported format |
| MCPs | `~/.agents/mcp.json` | One server entry inside each agent MCP config |

MCP Universal entries use this shape:

```json
{
  "servers": {
    "name": {
      "command": "node",
      "args": ["server.js"],
      "agentLocal": {
        "codex": { "startup_timeout_ms": 20000 }
      }
    }
  }
}
```

`agentLocal` stores native fields by agent family. Core fields win; native fields
inside `agentLocal` cannot override the portable Universal core.

## Skills

| Reason | Label | When it appears | Resolution |
| --- | --- | --- | --- |
| `missing-symlinks` | Missing Symlinks | Universal exists, but one or more compatible agent installs are absent. | Ensure Universal exists, then create symlinks in writable missing installs. |
| `missing-canonical` | Missing Universal | A skill exists outside Universal and no Universal copy is present. | Copy the selected real-file version into Universal and replace existing writable copies with symlinks. |
| `identical-copies` | Identical Copies | Multiple writable real-file copies have the same content instead of symlinking. | Keep or create Universal, then replace duplicate writable copies with symlinks. |
| `diverged-copies` | Diverged Copies | Multiple real-file copies differ. | Make the selected real-file version Universal and replace existing writable copies with symlinks. |
| `broken-symlink` | Broken Symlink | A skill symlink has no target. | Replace writable broken symlinks with symlinks to Universal. |
| `wrong-symlink-target` | Wrong Symlink Target | A skill symlink points somewhere other than Universal. | Retarget writable wrong symlinks to Universal. |
| `invalid-definition` | Invalid Definition | Required skill metadata or files are invalid. | Diagnostic only. |

## Subagents

| Reason | Label | When it appears | Resolution |
| --- | --- | --- | --- |
| `missing-universal` | Missing Universal | A subagent exists in an agent location, but not in Universal. | Write the selected valid definition to Universal as Markdown frontmatter; replace identical compatible Markdown copies with symlinks. |
| `missing-from-agents` | Missing From Agents | Universal exists, but supported installed agents are missing it. | Write Universal to writable missing agent locations, using symlinks when their format supports it. |
| `definition-mismatch` | Definition Mismatch | Valid Universal and agent-local definitions differ. | Apply the selected portable definition to Universal and differing writable agent files; preserve existing target-local extras. |
| `identical-copies` | Identical Copies | A writable Markdown copy matches Universal but is not a symlink. | Replace the duplicate copy with a symlink to Universal. |
| `broken-symlink` | Broken Symlink | A subagent symlink has no target. | Replace writable broken symlinks with Universal-compatible targets. |
| `wrong-symlink-target` | Wrong Symlink Target | A subagent symlink points somewhere other than Universal. | Replace writable wrong symlinks with Universal-compatible targets. |
| `invalid-definition` | Invalid Definition | Required subagent fields or syntax are invalid. | Diagnostic only. |

## MCPs

| Reason | Label | When it appears | Resolution |
| --- | --- | --- | --- |
| `missing-universal` | Missing Universal | A server exists in an agent or plugin config, but not in `~/.agents/mcp.json`. | Write the selected portable core to Universal and capture that family's native fields in `agentLocal`. |
| `missing-from-agents` | Missing From Agents | Universal exists, but supported installed agents are missing the server. | Write Universal core plus only each target family's `agentLocal` block to writable supported configs. |
| `definition-mismatch` | Definition Mismatch | Portable core differs from Universal, or a family's native fields differ from `agentLocal.<family>`. | Apply the selected core, preserve each target's native fields, and capture native fields back into Universal `agentLocal`. |
| `invalid-definition` | Invalid Definition | A server entry cannot be parsed as a supported MCP definition. | Diagnostic only. |
| `connection-failed` | Connection Failed | A valid server definition failed optional connectivity verification. | Diagnostic only. |

MCP comparison ignores dialect-only differences. Native fields are compared only
against the same family's `agentLocal` block; one family's native fields are never
copied into another family.

## Shared Rules

- Resolution is scoped to one inventory source mode at a time, such as Live or
  Sandbox.
- Plugin-managed files are read-only. They may be selected as a source when the
  resolver supports it, but Skill Index does not mutate plugin files.
- Unsupported formats and transports are not written. MCP missing-agent repair
  writes any writable supported targets and leaves unwritable targets unresolved.
- Config writers preserve unrelated file fields and unrelated MCP server entries.
- Auto-resolve stays conservative: skills auto-resolve only issues with an
  inferable Universal choice; MCPs auto-resolve only safe `missing-from-agents`;
  subagents auto-resolve simple missing, identical-copy, and broken-symlink cases.
