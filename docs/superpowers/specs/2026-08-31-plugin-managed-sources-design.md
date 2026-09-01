# Plugin-Managed Sources Design

## Purpose

Skill Index currently discovers skills, subagents, and MCP definitions inside
versioned plugin cache directories. Those directories are managed by the plugin
host and can be replaced or removed without notice. Treating them as durable
canonical locations causes broken symlinks and makes multiple cached versions
look like conflicting user installations.

This change makes plugin-owned content a read-only source from which a user can
create or update a durable Universal copy. It does not make Skill Index a plugin
installer, choose a plugin version on the user's behalf, or modify plugin cache
contents.

## Shared Contract

Every discovered location has one of three operational roles:

- **Universal canonical:** the durable source of truth owned by the user.
- **Agent materialization:** a symlink, rendered file, or configuration entry
  derived from Universal for a compatible agent.
- **Plugin-managed source:** a read-only candidate that may be copied into
  Universal but is never canonical and is never an installation target.

The following rules apply to skills, subagents, and MCPs:

1. A plugin cache path is never a valid Universal path, symlink target, or
   durable dependency created by Skill Index.
2. A capability found only in one or more plugin-managed sources has the
   structural issue `Missing Universal`.
3. Multiple cached plugin versions are source alternatives. Differences among
   plugin-managed sources do not create `Diverged Copies` or `Definition
   Mismatch`.
4. The user explicitly selects the plugin source used by `Make Universal` or
   `Update Universal`. Skill Index does not infer correctness from version
   syntax, timestamps, hashes, or asset counts.
5. Skill Index may order or annotate candidates using current-state evidence,
   such as “Currently used by Codex Desktop,” “Currently used by Codex CLI,” or
   “Cached copy—usage unknown.” Such evidence is explanatory and does not claim
   that a version is correct.
6. Resolution copies or translates the selected source into Universal. It does
   not overwrite, delete, or otherwise mutate any plugin-managed source.
7. Once Universal exists and required agent materializations are satisfied, the
   capability is structurally healthy. A differing plugin source is a
   non-blocking `Plugin Update Available` advisory, not a structural issue.
8. Selecting `Update Universal` replaces only the Universal representation and
   refreshes derived writable agent materializations. Plugin sources remain
   untouched.
9. If an agent actively receives the capability from its native plugin, that
   native delivery satisfies the agent and Skill Index does not create a
   duplicate local materialization for that agent. Other compatible agents are
   materialized from Universal.
10. Skill Index reports mechanical compatibility evidence but does not decide
    whether a capability is semantically portable. When the representation can
    be copied or translated, an explicit user action is permitted to proceed
    despite dependency warnings.

## Skills

### Before

- Plugin skill roots are marked canonical.
- Agent skill symlinks may point directly into a versioned plugin cache.
- Replacing the cache leaves broken symlinks.
- Different cached plugin versions can contribute to copy divergence.

### After

- Only a user-owned Universal skills directory can be canonical.
- Plugin skill packages are read-only source candidates.
- A plugin-only skill reports `Missing Universal`, even when several cached
  versions contain it.
- `Make Universal` copies the complete selected skill package into Universal,
  then creates or repairs symlinks for compatible agents not already satisfied
  by active native plugin delivery.
- All symlinks created or repaired by Skill Index point to Universal.
- A legacy symlink into a deleted plugin cache remains a broken-link issue until
  the user selects a source. Resolution first ensures a real Universal package
  exists and then retargets writable links to it.
- A plugin package that differs from Universal produces only the update
  advisory. Choosing it for update replaces Universal and leaves cached copies
  unchanged.

All resolution behavior for non-plugin real-file copies, custom Universal
choices, missing agent installs, identical writable copies, diverged writable
copies, invalid definitions, and wrong symlink targets remains unchanged.

## Subagents

### Before

- Plugin subagents are already read-only import sources and can be promoted to
  Universal.
- Different cached versions can still contribute to definition mismatch.
- Provider or plugin dependencies are implicit.

### After

- Plugin subagents use the shared plugin-managed source role.
- A plugin-only subagent reports `Missing Universal`; differences between cached
  plugin versions do not add `Definition Mismatch`.
- `Make Universal` copies or translates the selected definition into the
  Universal Markdown representation, preserving existing namespacing and
  collision rules.
- Compatible agent definitions are produced using existing format-specific
  rendering and symlink rules. Active native plugin delivery satisfies the
  originating agent without a duplicate local definition.
- Syntax or format that cannot be read or rendered continues to use existing
  invalid/unsupported diagnostics.
- Detectable plugin-specific tool names, paths, or other dependencies are shown
  as compatibility evidence. They warn the user but do not claim the subagent is
  semantically nonportable.

## MCPs

### Before

- Plugin MCP definitions can be used to create Universal entries.
- Different cached definitions can contribute to definition mismatch.
- Plugin-root variables, paths, and bundled executables may be copied without a
  clear explanation of their dependency.
- Plugin MCP locations may be labeled canonical internally even though the
  classifier recognizes only the Universal entry as Universal.

### After

- Plugin MCP definitions use the shared plugin-managed source role. Only the
  Universal MCP entry is canonical.
- A plugin-only MCP reports `Missing Universal`; differences among cached plugin
  definitions do not add `Definition Mismatch`.
- `Make Universal` copies the selected MCP configuration into Universal and
  uses existing dialect-preserving writers to materialize it for compatible
  agents not already satisfied by active native plugin delivery.
- Skill Index copies configuration only. It does not copy a plugin-bundled MCP
  executable or server implementation.
- Detectable dependencies—including plugin-root environment variables,
  absolute cache paths, plugin-contained commands, and provider-specific
  fields—are disclosed before resolution. They warn but do not prevent an
  explicit export when the configuration is mechanically writable.
- Structural health means the Universal and agent configurations are
  synchronized. It does not guarantee that a provider-specific MCP works on
  every agent; existing validation and connectivity diagnostics remain
  responsible for runtime failures.

## Candidate Evidence and Selection

Candidate hints are derived from current state on every scan. No historical
provenance receipt is required. Evidence is ordered from strongest to weakest:

1. The exact path reported as active by a host or installation registry.
2. A version associated with an enabled installation for that host and
   marketplace.
3. A newer semantic version within the same host, marketplace, and comparable
   version scheme.
4. An unreferenced cached copy whose usage is unknown.

When different surfaces actively use different versions, each candidate is
labeled with its surface and no single candidate is recommended. Hashes and
semantic versions are not compared across version schemes.

## Inventory and Resolution Boundaries

The implementation will represent source role directly rather than infer it
from writability or path patterns. Classification must separate:

- source candidates used for selection and update advisories;
- Universal and writable agent locations used for structural health and drift;
- expected agent locations used for missing-install issues.

Plugin-managed candidates participate in inventory visibility and source
selection, but not in installed-copy divergence. Resolution must reject plugin
paths as mutation targets and canonical destinations at the lowest shared
filesystem boundary, even if a caller supplies one directly.

## Refresh and Cached Startup

File watching refreshes changes inside already-discovered skill roots. Changes
to plugin topology—including a new sibling plugin version—as well as plugin MCP
and subagent files are discovered by the startup scan or a manual **Rescan**.
Every mutation performs a fresh scan and revalidates the selected managed-source
candidate before planning any writes.

The first startup paint may use a cached inventory snapshot while asynchronous
hydration discovers the current plugin state. A plugin skill whose cache source
was removed may therefore appear briefly until hydration completes. This cached
view is presentation-only: a resolution attempted during that interval still
uses the fresh action scan, rejects a vanished candidate, and leaves Universal,
agent locations, and the plugin cache unchanged.

## Sandbox Fixtures

The representative Sandbox will include deterministic plugin scenarios for all
three asset types:

- a plugin-only capability with one cached version;
- a plugin-only capability with two differing cached versions;
- a Universal capability matching one plugin version while another differs;
- a Universal capability with a later plugin update advisory;
- agent skill symlinks pointing to a deleted plugin cache;
- an active native plugin capability that must not be duplicated into its host;
- a subagent requiring format translation;
- an MCP using a remote URL with no detected plugin dependency;
- an MCP using a plugin-root variable and plugin-contained command;
- unrelated healthy and diverged non-plugin capabilities proving existing
  resolution behavior is preserved.

Resetting the representative Sandbox must restore every scenario and remove the
effects of earlier resolutions.

## Verification

Verification follows the `skillindex-testing` ladder:

1. Run `pnpm typecheck`.
2. Run focused Vitest coverage for plugin inventory, skill inventory,
   resolution, subagent inventory, MCP inventory behavior, Sandbox fixtures,
   renderer view models, and resolution controls changed by the implementation.
3. Run broader main and renderer suites because source-role classification is
   shared across inventory types.
4. Start the Electron app in Sandbox mode, reset the representative Sandbox,
   and click through each plugin scenario.
5. For each resolution flow, verify the resulting filesystem state: Universal
   contains a real copy, writable symlinks target Universal, plugin caches are
   byte-for-byte untouched, and native plugin hosts do not receive duplicates.
6. Confirm watcher-driven rescans within existing skill roots settle on the
   expected structural status and advisory state; use startup or manual Rescan
   to verify new plugin versions, plugin MCPs, and plugin subagents.
7. Capture fresh screenshots of every materially changed UI state and include
   them in the final report.

The final report will list every command and manual flow run, what passed, what
was not run, and any unrelated failures.

## Out of Scope

- Installing, updating, or purging plugins.
- Selecting a universally “correct” plugin version.
- Persisting historical plugin provenance receipts.
- Copying plugin-bundled executables or recreating plugin runtimes.
- Guaranteeing semantic portability across providers.
- Changing non-plugin resolution semantics except where required to preserve
  their existing behavior under the new source-role model.
