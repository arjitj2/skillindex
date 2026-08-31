# Plugin-Managed Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plugin-owned skills, subagents, and MCP definitions read-only source candidates that can be copied into Universal without ever becoming canonical paths or symlink targets.

**Architecture:** Add an explicit `managed-source` location role and shared plugin-candidate metadata, then make each inventory classifier calculate structural health from Universal and writable agent locations while retaining plugin locations for selection and advisories. Resolution always materializes the selected plugin representation into Universal before updating writable agent locations; the renderer exposes the existing Missing Universal flow plus non-blocking plugin-update and dependency evidence.

**Tech Stack:** TypeScript, Electron, React, Vitest, filesystem-backed Sandbox fixtures, Computer Use or Playwright for real-app verification.

---

## File Map

- Create `src/main/plugin-managed-sources.ts`: shared location partitioning, candidate evidence, dependency detection, and native-provider satisfaction helpers.
- Create `src/main/plugin-managed-sources.test.ts`: focused tests for the shared helper contract.
- Modify `src/shared/contracts.ts`: managed-source role, candidate/advisory metadata, and update action request types.
- Modify `src/main/plugin-inventory.ts`: emit noncanonical plugin skill sources and carry enabled-state evidence.
- Modify `src/main/skill-inventory.ts`: exclude plugin candidates from structural copy drift while retaining them for selection and update advisories.
- Modify `src/main/skill-canonicalization.ts`: always copy selected plugin packages into Universal and link only to Universal.
- Modify `src/main/skill-universal-decisions.ts`: persist the real Universal path rather than a plugin cache origin; continue reading legacy decisions safely.
- Modify `src/main/issue-resolution.ts`: enforce Universal materialization for skill, subagent, and MCP plugin sources and support explicit plugin updates.
- Modify `src/main/subagent-inventory.ts`: exclude plugin/plugin differences from definition mismatch and expose candidates.
- Modify `src/main/mcp-inventory.ts`: exclude plugin/plugin differences from definition mismatch and detect plugin-bound configuration evidence.
- Modify `src/main/capability-actions.ts`: dispatch explicit `update-universal-from-plugin` actions for all three asset types.
- Modify `src/main/inventory-runtime.ts`: audit the new update action.
- Modify `src/renderer/src/lib/detail-inspector-model.ts`: present managed sources, evidence labels, dependency warnings, and update actions.
- Modify `src/renderer/src/lib/issue-resolution.ts`: build explicit update requests without turning advisories into issues.
- Modify `src/renderer/src/components/DetailInspectorPanel.tsx`: render update/dependency advisory content and action state.
- Modify `src/renderer/src/views/SkillsWorkspaceView.tsx`: submit the new capability action.
- Modify `src/renderer/src/lib/inventory-presentation.ts`: format managed-source and advisory labels.
- Modify the adjacent renderer tests named in the tasks below.
- Modify `src/main/sandbox-fixtures.ts`: add deterministic plugin-cache scenarios for skills, subagents, and MCPs.
- Modify `src/main/scan-inventory.test.ts`, `src/main/plugin-inventory.test.ts`, `src/main/issue-resolution.test.ts`, and `src/main/subagent-inventory.test.ts`: filesystem and classification regressions.
- Modify `docs/reference/inventory-resolution-model.md`: document the implemented contract.

### Task 1: Add the managed-source contract and shared helpers

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `src/main/plugin-managed-sources.ts`
- Create: `src/main/plugin-managed-sources.test.ts`

- [ ] **Step 1: Write failing contract/helper tests**

Add tests covering operational partitioning, evidence, dependency warnings, and native-provider satisfaction:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPluginManagedSourceCandidate,
  detectPluginDependencyWarnings,
  getOperationalLocations,
  isAgentSatisfiedByNativePlugin,
  isPluginManagedTarget,
  annotateComparableVersionEvidence,
} from '@main/plugin-managed-sources';

describe('plugin managed sources', () => {
  it('keeps plugin locations visible but outside operational copies', () => {
    const locations = [
      { path: '/home/.agents/skills/foo', canonicalRole: 'canonical' as const },
      { path: '/home/.codex/plugins/cache/tools/1.0.0/skills/foo', canonicalRole: 'managed-source' as const },
    ];
    expect(getOperationalLocations(locations)).toEqual([locations[0]]);
  });

  it('labels enabled and unreferenced cache candidates without choosing correctness', () => {
    expect(buildPluginManagedSourceCandidate({
      path: '/cache/tools/1.0.0/skills/foo',
      plugin: { host: 'codex', pluginId: 'tools@official', pluginName: 'tools', version: '1.0.0', rootPath: '/cache/tools/1.0.0', enabled: true },
      comparisonKey: 'old',
      universalComparisonKey: null,
      dependencyWarnings: [],
    }).evidence).toBe('enabled-installation');
    expect(buildPluginManagedSourceCandidate({
      path: '/cache/tools/2.0.0/skills/foo',
      plugin: { host: 'codex', pluginId: 'tools@official', pluginName: 'tools', version: '2.0.0', rootPath: '/cache/tools/2.0.0', enabled: 'unknown' },
      comparisonKey: 'new',
      universalComparisonKey: null,
      dependencyWarnings: [],
    }).evidence).toBe('cached-unknown');
  });

  it('reports plugin-root and cache dependencies as evidence', () => {
    expect(detectPluginDependencyWarnings({
      text: 'node ${CODEX_PLUGIN_ROOT}/server.js /cache/tools/1.0.0/data.json',
      pluginRoot: '/cache/tools/1.0.0',
      providerSpecificFields: ['startup_timeout_ms'],
    }).map((warning) => warning.kind)).toEqual([
      'plugin-root-variable',
      'plugin-contained-path',
      'provider-specific-field',
    ]);
  });

  it('hints only within a comparable semantic-version family', () => {
    const candidates = [
      { version: '1.0.0', evidence: 'cached-unknown' as const },
      { version: '1.1.0', evidence: 'cached-unknown' as const },
    ];
    expect(annotateComparableVersionEvidence(candidates)[1]?.evidence)
      .toBe('newer-comparable-version');
    expect(annotateComparableVersionEvidence([
      { version: 'd6169bef', evidence: 'cached-unknown' as const },
      { version: '0.21.4', evidence: 'cached-unknown' as const },
    ]).every((candidate) => candidate.evidence === 'cached-unknown')).toBe(true);
  });

  it('treats an enabled native plugin as satisfying only its host family', () => {
    const plugin = { host: 'codex' as const, enabled: true as const };
    expect(isAgentSatisfiedByNativePlugin('codex', [plugin])).toBe(true);
    expect(isAgentSatisfiedByNativePlugin('claude', [plugin])).toBe(false);
  });

  it('recognizes plugin cache targets from source ownership', () => {
    expect(isPluginManagedTarget('/cache/tools/skills/foo', [{
      kind: 'plugin',
      skillsDir: '/cache/tools/skills',
    }])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm test -- src/main/plugin-managed-sources.test.ts`

Expected: FAIL because the module, `managed-source` role, and candidate contracts do not exist.

- [ ] **Step 3: Add the shared types and helper implementation**

Extend `CanonicalRole` and `PluginSourceRef`, and add shared candidate metadata:

```ts
export type CanonicalRole = 'canonical' | 'materialized-copy' | 'managed-source';
export type PluginSourceEvidence =
  | 'enabled-installation'
  | 'newer-comparable-version'
  | 'cached-unknown';
export type PluginDependencyWarningKind =
  | 'plugin-root-variable'
  | 'plugin-contained-path'
  | 'provider-specific-field';

export interface PluginDependencyWarning {
  kind: PluginDependencyWarningKind;
  detail: string;
}

export interface PluginManagedSourceCandidate {
  path: string;
  plugin: PluginSourceRef;
  evidence: PluginSourceEvidence;
  relationship: 'universal-missing' | 'matches-universal' | 'differs-from-universal';
  dependencyWarnings: PluginDependencyWarning[];
}
```

Add `enabled: boolean | 'unknown'` to `PluginSourceRef`, and add optional
`managedSourceCandidates?: PluginManagedSourceCandidate[]` to `SkillRecord`,
`SubagentRecord`, and `McpRecord`.

Implement `plugin-managed-sources.ts` with these complete behaviors:

```ts
export function getOperationalLocations<T extends { canonicalRole?: CanonicalRole }>(locations: T[]): T[] {
  return locations.filter((location) => location.canonicalRole !== 'managed-source');
}

export function isAgentSatisfiedByNativePlugin(
  family: string | undefined,
  plugins: Array<Pick<PluginSourceRef, 'host' | 'enabled'>>,
): boolean {
  return plugins.some((plugin) => plugin.enabled === true && plugin.host === family);
}

export function isPluginManagedTarget(
  targetPath: string,
  sources: Array<Pick<SkillScanSource, 'kind' | 'skillsDir'>>,
): boolean {
  const normalizedTarget = path.normalize(targetPath);
  return sources.some((source) => {
    if (source.kind !== 'plugin') return false;
    const normalizedRoot = path.normalize(source.skillsDir);
    return normalizedTarget === normalizedRoot
      || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

export function buildPluginManagedSourceCandidate({
  path: sourcePath,
  plugin,
  comparisonKey,
  universalComparisonKey,
  dependencyWarnings,
}: {
  path: string;
  plugin: PluginSourceRef;
  comparisonKey: string;
  universalComparisonKey: string | null;
  dependencyWarnings: PluginDependencyWarning[];
}): PluginManagedSourceCandidate {
  return {
    path: sourcePath,
    plugin,
    evidence: plugin.enabled === true ? 'enabled-installation' : 'cached-unknown',
    relationship: universalComparisonKey === null
      ? 'universal-missing'
      : comparisonKey === universalComparisonKey
        ? 'matches-universal'
        : 'differs-from-universal',
    dependencyWarnings,
  };
}

export function annotateComparableVersionEvidence<
  T extends { version?: string; evidence: PluginSourceEvidence },
>(candidates: T[]): T[] {
  if (candidates.some((candidate) => candidate.evidence === 'enabled-installation')) return candidates;
  const parsed = candidates.map((candidate) => ({ candidate, version: parseComparableVersion(candidate.version) }));
  if (parsed.some((entry) => entry.version === null)) return candidates;
  const greatest = parsed.slice().sort((left, right) => compareVersionParts(right.version!, left.version!))[0];
  return candidates.map((candidate) => candidate === greatest?.candidate
    ? { ...candidate, evidence: 'newer-comparable-version' }
    : candidate);
}

function parseComparableVersion(value: string | undefined): [number, number, number] | null {
  const match = value?.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersionParts(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function detectPluginDependencyWarnings({
  text,
  pluginRoot,
  providerSpecificFields = [],
}: {
  text: string;
  pluginRoot: string;
  providerSpecificFields?: string[];
}): PluginDependencyWarning[] {
  const warnings: PluginDependencyWarning[] = [];
  if (/\$\{?(?:CODEX|CLAUDE)_PLUGIN_ROOT\}?/u.test(text)) {
    warnings.push({ kind: 'plugin-root-variable', detail: 'References a plugin-root environment variable.' });
  }
  if (text.includes(pluginRoot)) {
    warnings.push({ kind: 'plugin-contained-path', detail: `References a path inside ${pluginRoot}.` });
  }
  if (providerSpecificFields.length > 0) {
    warnings.push({
      kind: 'provider-specific-field',
      detail: `Uses provider-specific fields: ${providerSpecificFields.sort().join(', ')}.`,
    });
  }
  return warnings;
}
```

`buildPluginManagedSourceCandidate` returns `enabled-installation` only for
`enabled === true`. After candidates for one host/plugin/asset are collected,
`annotateComparableVersionEvidence` marks the greatest valid `major.minor.patch`
version as `newer-comparable-version` only when no candidate is known enabled.
Hash-like and mixed-scheme versions remain `cached-unknown`. Candidate
relationship is derived by comparing supplied content keys, without using
timestamps or asset counts.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `pnpm test -- src/main/plugin-managed-sources.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the shared contract**

```bash
git add src/shared/contracts.ts src/main/plugin-managed-sources.ts src/main/plugin-managed-sources.test.ts
git commit -m "Add plugin managed source contract"
```

### Task 2: Make plugin skill roots noncanonical and preserve source evidence

**Files:**
- Modify: `src/main/plugin-inventory.ts`
- Modify: `src/main/plugin-inventory.test.ts`
- Modify: `src/main/skill-inventory.ts`
- Modify: `src/main/scan-inventory.test.ts`

- [ ] **Step 1: Change existing tests to the new before/after contract**

Update the plugin inventory expectations so a plugin skill location has:

```ts
expect(pluginSkill?.locations[0]).toMatchObject({
  canonical: false,
  canonicalRole: 'managed-source',
  mutability: 'read-only-managed',
});
expect(pluginSkill).toMatchObject({
  structuralState: 'single-source-noncanonical',
  issueReasons: ['missing-canonical'],
});
```

Add a scan test with two differing plugin versions and assert:

```ts
expect(skill?.issueReasons).toEqual(['missing-canonical']);
expect(skill?.issueReasons).not.toContain('diverged-copies');
expect(skill?.detailDiagnostics.duplicateCandidates).toEqual([]);
expect(skill?.managedSourceCandidates).toHaveLength(2);
```

- [ ] **Step 2: Run focused tests and verify the old behavior fails**

Run: `pnpm test -- src/main/plugin-inventory.test.ts src/main/scan-inventory.test.ts`

Expected: FAIL because plugin sources are still canonical and plugin real files still participate in duplicate drift.

- [ ] **Step 3: Emit managed plugin skill sources**

In `buildPluginSkillScanSources`, set `canonical: false`, retain
`writable: false`, and include `plugin.enabled`. In `buildSkillLocation`, assign:

```ts
canonicalRole: source.kind === 'plugin'
  ? 'managed-source'
  : source.canonical
    ? 'canonical'
    : 'materialized-copy',
```

Build plugin candidates from plugin locations and attach them to `SkillRecord`.
Pass only `getOperationalLocations(locations)` to copy-divergence,
duplicate-candidate, canonical, and structural-health calculations. Continue to
pass all locations to display metadata, source selection, definition diagnostics,
and candidate construction.

- [ ] **Step 4: Preserve non-plugin classification regressions**

Add explicit assertions that two differing writable non-plugin copies still
produce `diverged-copies`, identical writable copies still produce
`identical-copies`, and a non-plugin single source still produces
`missing-canonical`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm test -- src/main/plugin-managed-sources.test.ts src/main/plugin-inventory.test.ts src/main/scan-inventory.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit skill classification**

```bash
git add src/main/plugin-inventory.ts src/main/plugin-inventory.test.ts src/main/skill-inventory.ts src/main/scan-inventory.test.ts
git commit -m "Treat plugin skills as managed sources"
```

### Task 3: Always materialize plugin skills into Universal

**Files:**
- Modify: `src/main/skill-canonicalization.ts`
- Modify: `src/main/skill-universal-decisions.ts`
- Modify: `src/main/issue-resolution.ts`
- Modify: `src/main/issue-resolution.test.ts`
- Modify: `src/main/skill-canonicalization.test.ts`

- [ ] **Step 1: Add failing filesystem tests**

Cover these cases with temporary homes:

1. Choosing one of two plugin versions copies its full package to
   `.agents/skills/<inventory-name>`.
2. Plugin cache directories remain byte-for-byte unchanged.
3. Every created or repaired skill symlink resolves to the Universal package.
4. A broken legacy symlink to a deleted cache is replaced only after a selected
   real plugin source is copied to Universal.
5. Updating Universal from the other plugin version changes Universal content
   while both cache directories remain unchanged.

The core assertions are:

```ts
expect(await readFile(path.join(universalPath, 'SKILL.md'), 'utf8')).toContain('Selected plugin version');
expect(await realpath(claudePath)).toBe(await realpath(universalPath));
expect(await realpath(factoryPath)).toBe(await realpath(universalPath));
expect(await readFile(oldPluginSkill, 'utf8')).toBe(oldPluginBefore);
expect(await readFile(newPluginSkill, 'utf8')).toBe(newPluginBefore);
expect(resolvedSkill?.issueReasons).not.toContain('missing-canonical');
expect(resolvedSkill?.managedSourceCandidates?.some((candidate) =>
  candidate.relationship === 'differs-from-universal')).toBe(true);
```

- [ ] **Step 2: Run the tests and verify direct-cache targeting fails them**

Run: `pnpm test -- src/main/issue-resolution.test.ts src/main/skill-canonicalization.test.ts`

Expected: FAIL because plugin selections currently skip copying and use the cache path as the symlink target.

- [ ] **Step 3: Remove plugin canonical shortcuts**

In `makeSkillCanonical`, always set `universalTargetPath = canonicalPath` and
always create the canonical decision location at that path. Change
`materializeCanonicalFile` to copy any selected source—including plugin sources—
unless it is already the canonical real-file path.

In `ensureCanonicalSkillPackage`, delete `resolvePluginCanonicalSkillLocation`.
Always resolve the Universal path, copy the selected real-file package there,
and return the Universal path/location.

Persist new decisions with `SkillUniversalOrigin.kind === 'path'`. Continue to
parse legacy plugin-origin decisions, but never resolve them as canonical; use
their matching plugin location only as a preselected candidate for a new
Universal copy.

- [ ] **Step 4: Enforce the invariant at the filesystem boundary**

Before creating a symlink in both `skill-canonicalization.ts` and
`issue-resolution.ts`, reject a target whose matching source has
`kind === 'plugin'` or whose location has `canonicalRole === 'managed-source'`:

```ts
if (isPluginManagedTarget(canonicalPath, snapshot)) {
  throw new Error('Skill symlinks must target a Universal skill package, not a plugin-managed source.');
}
```

Add a direct-call test proving a plugin target is rejected even when a caller
bypasses the normal resolver.

- [ ] **Step 5: Run the focused skill tests**

Run: `pnpm test -- src/main/plugin-inventory.test.ts src/main/scan-inventory.test.ts src/main/skill-canonicalization.test.ts src/main/issue-resolution.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit durable skill materialization**

```bash
git add src/main/skill-canonicalization.ts src/main/skill-universal-decisions.ts src/main/issue-resolution.ts src/main/issue-resolution.test.ts src/main/skill-canonicalization.test.ts
git commit -m "Copy plugin skills into Universal"
```

### Task 4: Apply the managed-source contract to subagents

**Files:**
- Modify: `src/main/subagent-inventory.ts`
- Modify: `src/main/subagent-inventory.test.ts`
- Modify: `src/main/issue-resolution.ts`

- [ ] **Step 1: Add failing multi-version and native-provider tests**

Create two cached versions of one plugin subagent with differing prompts and
assert that the record has only `missing-universal`, two managed candidates, and
no `definition-mismatch`. Add a Universal copy matching one version and assert
the record is structurally healthy with a differing update candidate.

Add an enabled Codex plugin plus installed Codex and Claude agents; after
resolution, assert the Claude target is materialized while no duplicate Codex
subagent file is created.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm test -- src/main/subagent-inventory.test.ts`

Expected: FAIL because all valid plugin definitions currently contribute to the mismatch key set and native delivery does not satisfy an expected owner.

- [ ] **Step 3: Partition operational and managed locations**

Assign plugin locations `canonicalRole: 'managed-source'`. Calculate
`validComparisonKeys`, duplicate copies, broken/wrong symlinks, and mismatch
from operational locations only. Build `managedSourceCandidates` from all plugin
locations using each parsed definition comparison key.

When building expected owners, omit an owner only when its family matches an
enabled plugin source for this exact subagent record. Preserve existing
unsupported-format and namespaced filename behavior.

- [ ] **Step 4: Keep resolution translation behavior and warnings**

Continue using `readPortableSubagentDefinitionFromFile` and the existing
format-specific writers. Attach dependency warnings detected from the source
definition text, but permit an explicit selected plugin source to be copied.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test -- src/main/plugin-managed-sources.test.ts src/main/subagent-inventory.test.ts src/main/issue-resolution.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit subagent behavior**

```bash
git add src/main/subagent-inventory.ts src/main/subagent-inventory.test.ts src/main/issue-resolution.ts
git commit -m "Treat plugin subagents as managed sources"
```

### Task 5: Apply the managed-source contract to MCP definitions

**Files:**
- Modify: `src/main/mcp-inventory.ts`
- Modify: `src/main/plugin-inventory.test.ts`
- Modify: `src/main/issue-resolution.ts`
- Modify: `src/main/issue-resolution.test.ts`

- [ ] **Step 1: Add failing MCP contract tests**

Add tests for:

- two differing cached plugin MCP definitions producing only
  `missing-universal`;
- a Universal definition matching one version remaining healthy while another
  version is an update candidate;
- `${CODEX_PLUGIN_ROOT}` and absolute plugin-contained command arguments
  producing dependency warnings;
- a remote URL producing no plugin-path warning;
- resolving an explicitly selected warned definition while leaving both plugin
  configs unchanged;
- an enabled native provider preventing a duplicate entry in that provider's
  agent config while other supported agents receive it.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm test -- src/main/plugin-inventory.test.ts src/main/issue-resolution.test.ts`

Expected: FAIL because plugin definitions currently contribute to mismatch and are labeled canonical.

- [ ] **Step 3: Partition MCP comparison and expected owners**

Assign plugin locations `canonicalRole: 'managed-source'`. In
`classifyMcpLocations`, calculate invalid-definition, connectivity,
definition-mismatch, and missing-agent work from operational locations, while
retaining plugin locations for namespacing, source selection, and candidates.

If Universal is absent, plugin-only records still receive `missing-universal`.
If Universal exists, differing plugin definitions add candidates with
`differs-from-universal` but do not add `definition-mismatch`.

Exclude a target owner only when its family matches an enabled native plugin
source for this exact MCP record.

- [ ] **Step 4: Add dependency evidence without claiming portability**

Run dependency detection against `definitionText` and the plugin root. Preserve
the selected MCP definition exactly through the existing portable-core and
`agentLocal` writers. Do not copy plugin server files. Permit explicit resolution
despite warnings.

- [ ] **Step 5: Run focused MCP tests and typecheck**

Run: `pnpm test -- src/main/plugin-managed-sources.test.ts src/main/plugin-inventory.test.ts src/main/issue-resolution.test.ts src/main/mcp-connectivity-transport.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit MCP behavior**

```bash
git add src/main/mcp-inventory.ts src/main/plugin-inventory.test.ts src/main/issue-resolution.ts src/main/issue-resolution.test.ts
git commit -m "Treat plugin MCPs as managed sources"
```

### Task 6: Add explicit plugin-update actions and renderer advisories

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/capability-actions.ts`
- Modify: `src/main/inventory-runtime.ts`
- Modify: `src/main/issue-resolution.test.ts`
- Modify: `src/renderer/src/lib/detail-inspector-model.ts`
- Modify: `src/renderer/src/lib/detail-inspector-model.test.ts`
- Modify: `src/renderer/src/lib/issue-resolution.ts`
- Modify: `src/renderer/src/lib/issue-resolution.test.ts`
- Modify: `src/renderer/src/components/DetailInspectorPanel.tsx`
- Modify: `src/renderer/src/components/DetailInspectorPanel.test.tsx`
- Modify: `src/renderer/src/views/SkillsWorkspaceView.tsx`
- Modify: `src/renderer/src/app-shell.test.tsx`

- [ ] **Step 1: Add failing action and view-model tests**

Extend `CapabilityActionRequest` with:

```ts
| {
    entity: 'skill' | 'subagent' | 'mcp';
    action: 'update-universal-from-plugin';
    capabilityName: string;
    selectedVariantPath: string;
  }
```

Test that a healthy record with a `differs-from-universal` candidate produces a
non-problem advisory labeled `Plugin Update Available`, shows the candidate's
evidence and dependency warnings, and builds the action request above. Assert
the record remains in the Healthy count and does not enter Home auto-repair.

- [ ] **Step 2: Run renderer and action tests to verify failure**

Run: `pnpm test -- src/main/issue-resolution.test.ts src/renderer/src/lib/detail-inspector-model.test.ts src/renderer/src/lib/issue-resolution.test.ts src/renderer/src/components/DetailInspectorPanel.test.tsx src/renderer/src/app-shell.test.tsx`

Expected: FAIL because update advisories and the generic action do not exist.

- [ ] **Step 3: Implement update dispatch**

In `capability-actions.ts`, validate that the selected path is a current
`managed-source` candidate and that a writable Universal target exists for the
record's scope. Dispatch to the same entity-specific copy/translation routines
used by Missing Universal, but replace the existing Universal representation
and refresh only writable derived materializations. Never treat the advisory as
an issue reason or add it to auto-repair.

Update `inventory-runtime.ts` so the audit title is
`Update <capabilityName> Universal from plugin source`.

- [ ] **Step 4: Render advisory evidence and action**

In the inspector model, expose an advisory section only when at least one
candidate has `relationship === 'differs-from-universal'`. Use these exact labels:

- `Plugin Update Available`
- `Currently enabled in Codex` or `Currently enabled in Claude`
- `Newer comparable plugin version`
- `Cached copy—usage unknown`
- `Detected dependency` for each warning
- `Update Universal from this version` for the action

If multiple surfaces are enabled, label each candidate independently and do not
preselect a universal recommendation. Dependency warnings do not disable the
explicit action.

- [ ] **Step 5: Run focused action and renderer tests**

Run: `pnpm test -- src/main/issue-resolution.test.ts src/renderer/src/lib/detail-inspector-model.test.ts src/renderer/src/lib/issue-resolution.test.ts src/renderer/src/components/DetailInspectorPanel.test.tsx src/renderer/src/app-shell.test.tsx && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit update advisories**

```bash
git add src/shared/contracts.ts src/main/capability-actions.ts src/main/inventory-runtime.ts src/main/issue-resolution.test.ts src/renderer/src/lib/detail-inspector-model.ts src/renderer/src/lib/detail-inspector-model.test.ts src/renderer/src/lib/issue-resolution.ts src/renderer/src/lib/issue-resolution.test.ts src/renderer/src/components/DetailInspectorPanel.tsx src/renderer/src/components/DetailInspectorPanel.test.tsx src/renderer/src/views/SkillsWorkspaceView.tsx src/renderer/src/app-shell.test.tsx
git commit -m "Add plugin update advisories"
```

### Task 7: Expand and validate representative Sandbox fixtures

**Files:**
- Modify: `src/main/sandbox-fixtures.ts`
- Modify: `src/main/scan-inventory.test.ts`
- Modify: `src/main/issue-resolution.test.ts`
- Modify: `src/main/subagent-inventory.test.ts`
- Modify: `src/renderer/src/representative-preview-data.ts`

- [ ] **Step 1: Add deterministic fixture scenarios**

Extend `writeSandboxExamplePluginBundles` with uniquely named fixtures for:

- `plugin-single-source-skill`;
- `plugin-version-choice-skill` with differing `1.0.0` and `1.1.0` packages;
- `plugin-update-skill` with a Universal package matching `1.0.0` and a differing
  `1.1.0` cache candidate;
- `legacy-plugin-link-skill` whose writable agent links point to a deliberately
  absent cache root;
- `plugin-version-choice-subagent` in two differing plugin versions;
- `plugin-remote-mcp` using an HTTPS URL;
- `plugin-bound-mcp` using `${CODEX_PLUGIN_ROOT}` and a server path under the
  fixture plugin root;
- enabled native-provider cases for one skill, one subagent, and one MCP;
- existing non-plugin identical, diverged, broken-link, and wrong-target cases.

Write different text into each plugin version so a clicked choice is observable
in Universal after resolution.

- [ ] **Step 2: Add reset and inventory assertions**

Test that `seedRepresentativeFixtures` recreates both cached versions after a
resolution mutates Universal, restores the absent legacy target condition, and
removes all Universal copies created by the earlier run.

Assert the seeded snapshot contains the exact statuses, candidate counts,
evidence labels, and warnings from the design contract.

- [ ] **Step 3: Run Sandbox-focused tests**

Run: `pnpm test -- src/main/scan-inventory.test.ts src/main/plugin-inventory.test.ts src/main/issue-resolution.test.ts src/main/subagent-inventory.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit representative fixtures**

```bash
git add src/main/sandbox-fixtures.ts src/main/scan-inventory.test.ts src/main/issue-resolution.test.ts src/main/subagent-inventory.test.ts src/renderer/src/representative-preview-data.ts
git commit -m "Expand plugin resolution sandbox fixtures"
```

### Task 8: Update documentation and run automated regressions

**Files:**
- Modify: `docs/reference/inventory-resolution-model.md`

- [ ] **Step 1: Update the reference model**

Document `managed-source`, candidate-only comparison, Missing Universal,
Universal-only symlink targets, dependency evidence, native delivery
satisfaction, explicit updates, and the fact that structural health is not a
semantic portability guarantee.

- [ ] **Step 2: Install dependencies with a supported Node runtime if needed**

The current worktree was previously missing `node_modules`, and Node 25 was
outside the package's declared engine range. Activate Node `22.22.2`, `24.15.0`,
or `>=26`, then run:

```bash
pnpm install --frozen-lockfile
```

Expected: dependencies install without changing `pnpm-lock.yaml`.

- [ ] **Step 3: Run the testing ladder's automated portion**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test -- src/main/plugin-managed-sources.test.ts src/main/plugin-inventory.test.ts src/main/scan-inventory.test.ts src/main/skill-canonicalization.test.ts src/main/issue-resolution.test.ts src/main/subagent-inventory.test.ts src/main/mcp-connectivity-transport.test.ts src/renderer/src/lib/inventory-presentation.test.ts src/renderer/src/lib/detail-inspector-model.test.ts src/renderer/src/lib/issue-resolution.test.ts src/renderer/src/components/DetailInspectorPanel.test.tsx src/renderer/src/app-shell.test.tsx
pnpm test
pnpm build
```

Expected: all commands PASS. If an unrelated pre-existing failure appears, rerun
the failing test independently, record its output, and keep it separate from
feature verification.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/reference/inventory-resolution-model.md
git commit -m "Document plugin managed source resolution"
```

### Task 9: Click through every Sandbox behavior in the real app

**Files:**
- Create: `output/skillindex-verification/plugin-missing-universal.png`
- Create: `output/skillindex-verification/plugin-version-choice.png`
- Create: `output/skillindex-verification/plugin-update-advisory.png`
- Create: `output/skillindex-verification/plugin-dependency-warning.png`

- [ ] **Step 1: Start the Electron app and reset Sandbox**

Run `pnpm dev`. With Computer Use, open Settings, select Sandbox inventory, and
click `Reset representative sandbox`.

Expected: the reset completes and the plugin fixtures appear in Skills,
Subagents, and MCPs.

- [ ] **Step 2: Verify single-source and multi-version skill flows**

Click `plugin-single-source-skill`, confirm `Missing Universal`, select its plugin
source, and click the primary action. Reset Sandbox, then click
`plugin-version-choice-skill`, inspect both versions and their evidence, select
`1.1.0`, and resolve it.

Verify with the shell:

```bash
readlink ~/.skillindex/sandbox/.claude/skills/plugin-version-choice-skill
readlink ~/.skillindex/sandbox/.factory/skills/plugin-version-choice-skill
rg -n "1.1.0 selected content" ~/.skillindex/sandbox/.agents/skills/plugin-version-choice-skill/SKILL.md
```

Expected: both links target the Sandbox Universal package, selected content is
present, and both cache versions still exist unchanged.

- [ ] **Step 3: Verify legacy broken-link repair and update advisory**

Reset Sandbox. Open `legacy-plugin-link-skill`, confirm the broken link plus
Missing Universal state, choose a live plugin source, and resolve. Open
`plugin-update-skill`, confirm it is structurally Healthy while showing `Plugin
Update Available`, then update Universal from `1.1.0`.

Expected: the legacy link now resolves to Universal; the update changes
Universal content without adding a structural issue or changing either cache.

- [ ] **Step 4: Verify subagent and MCP flows**

Reset Sandbox. Resolve `plugin-version-choice-subagent` from each version in
separate reset cycles and verify the rendered Universal Markdown plus supported
agent files. Open `plugin-remote-mcp` and confirm no plugin dependency warning.
Open `plugin-bound-mcp`, confirm both detected dependency warnings, explicitly
export it, and verify the warning did not block the action.

Expected: cached definitions are unchanged, native plugin hosts have no duplicate
local entry, and other supported agents receive the selected Universal form.

- [ ] **Step 5: Verify watcher stability and reset determinism**

Remain on each resolved detail pane through the watcher rescan. Confirm the item
settles on Healthy or Healthy plus the expected advisory without reverting to a
cache-backed canonical path. Reset Sandbox once more and confirm every initial
scenario returns.

- [ ] **Step 6: Capture screenshot evidence**

Capture the four named screenshots with Computer Use, Playwright, or
`screencapture`. Each screenshot must clearly show the changed status, candidate
versions/evidence, action, or dependency warning.

- [ ] **Step 7: Inspect the final diff and commit verification-facing changes**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -10
```

Commit any test or fixture correction made during real-app verification in a
focused commit. Do not commit generated screenshots unless the repository's
existing policy tracks `output/` artifacts.

## Completion Report

Report:

- the final before/after behavior for all three asset types;
- every automated command run and whether it passed;
- every Sandbox click flow completed;
- filesystem assertions proving Universal ownership and untouched caches;
- any test or flow not run and why;
- unrelated failures, separated from feature failures;
- fresh Markdown image attachments for all materially different UI states.
