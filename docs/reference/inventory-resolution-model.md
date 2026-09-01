# Inventory Resolution Model

Source of truth for inventory item types, issue names, candidate comparisons, and
repair behavior. Keep this document aligned with `src/shared/contracts.ts`, the
inventory scanners, resolution tests, and representative Sandbox fixtures.

## Universal, Agent, and Plugin-Managed Roles

Skill Index uses this user-owned Universal structure by default:

```text
~/.agents/
  skills/
  agents/
  mcp.json
```

Every discovered location has one operational role:

| Role | Meaning | May Skill Index write there? |
| --- | --- | --- |
| Universal canonical | The durable, user-owned source of truth. | Yes, when it is in the active scope and writable. |
| Agent materialization | A symlink, rendered file, or config entry derived from Universal. | Yes, when the compatible agent location is writable. |
| `managed-source` | A plugin cache source candidate. It is visible for inspection and user selection, but never canonical or an installation target. | No. |

A plugin cache path is never a Universal path, a symlink target, or a durable
dependency created by Skill Index. Resolution copies or translates the selected
source into Universal first; it never overwrites, deletes, or otherwise mutates
the cache. Filesystem safeguards reject cache-backed mutation destinations and
symlink targets, including through filesystem aliases.

| Item type | Universal source | Agent-local representation |
| --- | --- | --- |
| Skills | Preferred canonical skills directory, default `~/.agents/skills` | Skill package in each agent skills directory, normally a symlink to Universal |
| Subagents | `~/.agents/agents` | One rendered subagent file per agent, in that agent's supported format |
| MCPs | `~/.agents/mcp.json` | One server entry inside each agent's MCP config |

## Plugin Candidates and Explicit Choice

A capability that exists only in one or more plugin-managed sources has the
structural issue **Missing Universal**. Cache versions are alternatives for the
user to inspect and select; they are not installed copies to compare for drift.
Therefore differences among plugin candidates never create **Diverged Copies**
for skills or **Definition Mismatch** for subagents or MCPs while Universal is
missing.

Use **Use as Universal** to export a selected plugin candidate into Universal.
Once Universal exists, any plugin candidate with different content participates
in the ordinary **Diverged Copies** or **Definition Mismatch** issue alongside
Universal. Selecting a plugin version replaces only Universal and refreshes
derived, writable agent materializations. The cache remains untouched.

Candidate labels describe current scan evidence only:

- **Currently used in Codex** or **Currently used in Claude** means the
  matching host has that source enabled.
- **Usage unknown** means there is no stronger current-state evidence.

Skill Index does not order cache versions. Version syntax, hashes, timestamps,
package or skill counts, and content differences do not establish which source
is newest or correct. If two hosts actively use different versions, each
candidate is labeled separately; Skill Index does not recommend one. The user
selects the source whenever Universal is created or changed.

An enabled native plugin satisfies only that exact agent family for that exact
capability. Skill Index does not create a duplicate local materialization in
that host, while other compatible writable agents can still receive the
Universal representation.

## Refresh and Cached Startup

Automatic file watching covers changes inside skill roots that are already in
the inventory. Plugin topology changes, including newly added sibling versions,
and plugin MCP or subagent changes are discovered on startup or after a manual
**Rescan**. Resolution and capability actions do not trust the displayed
snapshot for writes: each action performs a fresh full scan and revalidates the
selected managed-source candidate before changing Universal or agent locations.

Skill Index may initially paint its cached inventory while asynchronous startup
hydration discovers current plugin state. A removed plugin skill source can
therefore remain visible briefly. Hydration removes that stale candidate; if a
user acts before it does, fresh validation rejects the vanished source without
modifying Universal, agent locations, or plugin cache files.

## Skills

| Reason | Label | When it appears | Resolution |
| --- | --- | --- | --- |
| `missing-symlinks` | Missing Symlinks | Universal exists, but one or more compatible writable agent installs are absent. | Create symlinks to Universal in the writable missing installs. |
| `missing-canonical` | Missing Universal | A skill exists outside Universal, including only as one or more plugin candidates, and no Universal package is present. | Select a readable source, copy the complete package into Universal, then replace or create writable agent links to Universal. |
| `identical-copies` | Identical Copies | Multiple writable real-file copies have the same content instead of symlinking. | Keep or create Universal, then replace duplicate writable copies with symlinks. |
| `diverged-copies` | Diverged Copies | A writable non-plugin real-file copy or plugin-managed candidate differs from Universal. | Make the selected real-file version Universal and replace existing writable copies with symlinks. Plugin-managed candidates remain untouched. |
| `broken-symlink` | Broken Symlink | A skill symlink has no target. | Retarget the writable link to a real Universal package. Repair is disabled until Universal exists, so a legacy link into a deleted plugin cache first requires resolving **Missing Universal**. |
| `wrong-symlink-target` | Wrong Symlink Target | A skill symlink points somewhere other than Universal. | Retarget the writable link to Universal. |
| `invalid-definition` | Invalid Definition | Required skill metadata or files are invalid. | Diagnostic only. |

All links created or repaired by Skill Index target a Universal package, never a
plugin cache. A differing managed source after Universal exists is ordinary
**Diverged Copies** drift.

## Subagents

| Reason | Label | When it appears | Resolution |
| --- | --- | --- | --- |
| `missing-universal` | Missing Universal | A subagent exists in an agent location or plugin-managed source, but not in Universal. | Select a valid definition; write or translate it into Universal Markdown frontmatter, then render compatible writable agent files. |
| `missing-from-agents` | Missing From Agents | Universal exists, but supported installed agents not satisfied by native plugin delivery are missing it. | Write Universal to writable agent locations, using symlinks where the format supports them. |
| `definition-mismatch` | Definition Mismatch | A valid writable agent-local or plugin-managed definition differs from Universal. | Apply the selected definition to Universal and differing writable agent files while preserving target-local extras. Plugin-managed candidates remain untouched. |
| `identical-copies` | Identical Copies | A writable Markdown copy matches Universal but is not a symlink. | Replace the duplicate copy with a symlink to Universal. |
| `broken-symlink` | Broken Symlink | A subagent symlink has no target. | Replace the writable link with a Universal-compatible target. |
| `wrong-symlink-target` | Wrong Symlink Target | A subagent symlink points somewhere other than Universal. | Replace the writable link with a Universal-compatible target. |
| `invalid-definition` | Invalid Definition | Required subagent fields or syntax are invalid. | Diagnostic only. |

Plugin definitions are `managed-source` candidates. Their syntax can still be
invalid or unsupported. Different plugin candidates do not create a Definition
Mismatch while Universal is missing; after Universal exists, a differing plugin
definition participates in the ordinary mismatch choice. Detectable
plugin-specific tools, paths, and other dependencies are shown as evidence;
they warn but do not prevent an explicit user export that can be mechanically
written.

## MCPs

Universal MCP entries use this shape:

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

| Reason | Label | When it appears | Resolution |
| --- | --- | --- | --- |
| `missing-universal` | Missing Universal | A server exists in an agent config or plugin-managed source, but not in `~/.agents/mcp.json`. | Select the definition, write its portable core to Universal, and capture that family's native fields in `agentLocal`. |
| `missing-from-agents` | Missing From Agents | Universal exists, but supported installed agents not satisfied by native plugin delivery are missing the server. | Write the Universal core plus only each target family's `agentLocal` block to writable supported configs. |
| `definition-mismatch` | Definition Mismatch | A writable or plugin-managed portable core differs from Universal, or a writable family's native fields differ from `agentLocal.<family>`. | Apply the selected core, preserve target native fields, and capture native fields back into Universal `agentLocal`. Plugin-managed candidates remain untouched. |
| `invalid-definition` | Invalid Definition | A server entry cannot be parsed as a supported MCP definition. | Diagnostic only. |
| `connection-failed` | Connection Failed | A valid server definition failed optional connectivity verification. | Diagnostic only. |

Plugin MCP candidates are configuration sources only: Skill Index never copies a
plugin-bundled executable or server implementation. Plugin-root variables,
absolute cache paths, plugin-contained commands, and provider-specific fields
are shown as **Detected dependency** warnings before export. These warnings are
compatibility evidence, not a portability verdict, and do not disable an
explicit export when the configuration is writable. A remote URL alone is not a
plugin-path dependency.

MCP comparison ignores dialect-only differences. Native fields are compared only
against the same family's `agentLocal` block; one family's native fields are
never copied into another family. A structurally healthy Universal and agent
configuration does not guarantee a provider-specific MCP will run everywhere;
existing validation and connectivity diagnostics cover runtime behavior.

## Transactions, Undo, and Sandbox Bootstrap

Resolution stages filesystem updates and rolls back a partial operation when a
later write fails. Completed file-changing operations are recorded in the local
Audit view and may offer **Undo** when a safe before/after snapshot is available.
Undo is blocked rather than overwriting an independently changed file. Neither a
transaction nor Undo ever treats plugin cache files as mutable targets.

The representative Sandbox is a disposable deterministic mirror of the user
filesystem. **Reset representative sandbox** restores its initial tree,
including plugin cache candidates and the intentionally broken legacy link, and
removes prior generated Universal/materialization results. It does not install,
update, purge, or modify live plugins.

Current managed-source fixture IDs include:

- Skills: `plugin-single-source-skill`, `plugin-version-choice-skill`,
  `plugin-incomparable-version-skill`, `plugin-update-skill`, and
  `legacy-plugin-link-skill`.
- Subagents: `plugin-version-choice-subagent:plugin-version-choice-subagent`
  and `plugin-update-subagent:plugin-update-subagent`.
- MCPs: `plugin-remote-mcp:plugin-remote-mcp`,
  `plugin-bound-mcp:plugin-bound-mcp`, and
  `plugin-update-mcp:plugin-update-mcp`.
- Enabled-native delivery: `native-plugin-delivery:native-plugin-skill`,
  `native-plugin-delivery:native-plugin-subagent`, and
  `native-plugin-delivery:native-plugin-mcp`.

## Shared Rules

- Resolution is scoped to one inventory source mode at a time, such as Live or
  Sandbox.
- Managed sources participate in inventory visibility and explicit selection.
  Once Universal exists, differing managed sources participate in ordinary
  divergence or definition mismatch without becoming writable install targets.
- Unsupported formats and transports are not written. MCP missing-agent repair
  writes any writable supported targets and leaves unwritable targets unresolved.
- Config writers preserve unrelated file fields and unrelated MCP server entries.
- Auto-resolve stays conservative: exporting a plugin candidate or using one to
  change Universal requires an explicit selection. It does not infer a choice
  from a cache version or candidate count.
