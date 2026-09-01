# MCP Logical Identity Resolution Design

## Problem

Skill Index currently counts physical plugin MCP sources when associating Universal and agent-local definitions with plugin-qualified inventory records. If the same logical plugin MCP appears in more than one cache, version, registry, or host installation, a portable definition can match multiple physical candidates even though every candidate has the same logical inventory identity.

On the affected machine, both `linear@openai-curated` and `linear@openai-curated-remote` expose a `linear` MCP. Both physical sources map to the internal identity `linear:linear` and have the same portable core. The current scanner sees two matching candidates, declines to associate the Universal `linear` definition with either, and produces separate `linear` and `linear:linear` records. Resolution writes the portable `linear` definition successfully, but the post-resolution scan preserves the split and reports that `linear:linear` still lacks Universal.

Plugin qualifiers remain internal identity information. The renderer continues to display the unqualified MCP name when a record has a managed plugin location.

## Goals

- Treat repeated physical occurrences of one plugin MCP as sources for one logical inventory identity.
- Preserve every physical source as selectable provenance and version evidence.
- Continue detecting definition differences among sources for the same logical identity.
- Avoid merging genuinely distinct plugin identities merely because they use the same config key.
- Refuse ambiguous promotion before modifying user configuration.
- Roll back configuration writes when post-resolution validation fails.
- Keep portable config keys unqualified and compatible with existing agent dialects.

## Non-goals

- Changing user-facing MCP labels.
- Removing stale plugin caches or selecting a preferred registry automatically.
- Persisting arbitrary plugin-to-Universal identity bindings.
- Adding a user-facing alias workflow for genuine cross-plugin name collisions.
- Changing MCP connectivity or authentication behavior.

## Logical Identity Model

The scanner will distinguish logical identities from physical sources:

```text
config name
  -> logical identity (`pluginName:configName`)
    -> physical sources (host, plugin ID, registry, version, path)
```

For example:

```text
linear
  -> linear:linear
    -> linear@openai-curated / 0.0.3
    -> linear@openai-curated-remote / 5.0.1
```

The plugin MCP index will group candidates by `inventoryName`. Candidate cardinality will no longer stand in for identity cardinality.

## Association Rules

For each non-plugin MCP location, the scanner will look up logical plugin identity groups sharing its unqualified config name.

1. Compute the portable core comparison key for the non-plugin location.
2. Find logical identity groups containing at least one physical source with the same core key.
3. If exactly one distinct logical identity matches, associate the location with that identity.
4. If no identity matches but exactly one logical identity exists for the config name, associate the location with that identity. Existing mismatch classification will then expose the differing definitions.
5. If multiple distinct logical identities remain possible, keep the non-plugin location unqualified. Do not guess which plugin owns it.

These rules are deterministic and independent of scan order, cache path, registry name, enabled state, and the number of physical plugin occurrences.

## Resolution Flow

Missing Universal resolution continues to select one readable physical source and write its unqualified `configName` into Universal and compatible writable agent configs.

Before writing, resolution will determine whether the resulting unqualified definition can associate uniquely with the selected plugin record under the logical identity rules. If another distinct logical plugin identity makes the association ambiguous, resolution will stop with an actionable collision error and leave every target unchanged.

After staging writes, resolution will rescan and validate that the requested issue is gone from the requested logical record. The mutation transaction will not be finalized until this postcondition passes. If writing, rescanning, or postcondition validation fails, the transaction will restore all changed targets before returning the error. Rollback failures will be reported together with the original failure.

## Error Behavior

- Duplicate physical sources for one logical identity are normal and do not block resolution.
- Distinct logical plugin identities competing for one portable key produce an explicit ambiguity error before mutation.
- A postcondition failure produces the underlying resolution error after rollback, rather than leaving a failed operation's writes installed.
- Existing unsupported-target, unsafe-path, parsing, and transport errors retain their current behavior.

## Testing

Add regression coverage for:

1. Two identical physical plugin sources from different plugin IDs or registries that share one `pluginName:configName`; an existing Universal definition joins the qualified record.
2. Multiple versions of one logical identity with differing cores; they remain one record and surface Definition Mismatch.
3. Missing Universal promotion from either identical physical source; the unqualified key is written and the qualified record no longer reports Missing Universal.
4. Multiple distinct logical plugin identities with the same config name where exactly one core matches; the non-plugin location joins the matching identity.
5. Multiple distinct logical identities with indistinguishable cores; resolution fails before writes with an ambiguity error.
6. A forced postcondition failure; all staged configuration changes are rolled back.
7. Renderer display behavior; a qualified internal MCP identity still renders as the unqualified name.
8. Existing JSON, JSONC, TOML, and agent-specific MCP rendering behavior remains unchanged.

## Why This Is Generic

Plugin caches, upgrades, registry migrations, and installations across multiple hosts create repeated physical sources on ordinary machines. Those occurrences are provenance, not separate MCP identities. Grouping by the stable logical identity handles those configurations without vendor-specific URLs, Linear-specific names, or registry-specific exceptions.

At the same time, retaining distinct logical identities prevents unrelated plugins from being merged solely because they chose the same config key. Explicit ambiguity handling makes uncommon collisions safe, while the common case remains automatic. Keeping the portable write key unqualified preserves compatibility across agent configuration formats and leaves presentation behavior unchanged.
