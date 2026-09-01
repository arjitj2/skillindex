# MCP Logical Identity Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Associate duplicate physical plugin MCP sources with one logical inventory identity, reject genuinely ambiguous promotion before writes, and roll back MCP writes when post-resolution validation fails.

**Architecture:** Change the plugin MCP index to group candidates by stable `pluginName:configName` identity and resolve non-plugin locations against distinct identity groups instead of physical candidate count. Add a resolver preflight for cross-plugin collisions and keep the MCP write transaction reversible until the post-resolution scan and assertion succeed.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Electron main process, Vitest, pnpm.

---

## File Structure

- Modify `src/main/mcp-inventory.ts`: represent physical plugin sources as logical identity groups and resolve non-plugin inventory names deterministically.
- Modify `src/main/plugin-inventory.test.ts`: cover duplicate physical sources, exact-match selection, and genuine logical ambiguity at scan time.
- Modify `src/main/issue-resolution.ts`: preflight ambiguous promotion and defer MCP transaction finalization until postcondition validation.
- Modify `src/main/issue-resolution.test.ts`: cover successful duplicate-source promotion, collision rejection without writes, and postcondition rollback.
- Verify `src/renderer/src/inventory-view-model.test.ts`: retain existing coverage that plugin-qualified internal names render unqualified.

### Task 1: Group plugin MCP candidates by logical identity

**Files:**
- Modify: `src/main/plugin-inventory.test.ts`
- Modify: `src/main/mcp-inventory.ts:64-70,269-311`

- [ ] **Step 1: Write a failing duplicate-source scan test**

Add a test beside `treats differing cached plugin MCP versions as ordinary definition alternatives` that creates two plugin cache roots with different plugin IDs but the same manifest name, `linear`, and identical `linear` MCP definitions. Add a Universal `linear` definition and assert there is one `linear:linear` record containing both managed locations and the Universal location, with no separate `linear` record:

```ts
it('groups identical physical plugin MCP sources with Universal by logical identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'skillindex-plugin-mcp-logical-identity-'));
  const homeDir = path.join(root, 'home');
  const paths = resolveSkillIndexPaths({ env: { SKILL_INDEX_DATA_DIR: path.join(root, 'data') }, homeDir });
  const curatedRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated', 'linear', '0.0.3');
  const remoteRoot = path.join(homeDir, '.codex', 'plugins', 'cache', 'openai-curated-remote', 'linear', '5.0.1');
  const definition = { type: 'http', url: 'https://mcp.linear.app/mcp' };

  await writeJson(path.join(curatedRoot, '.codex-plugin', 'plugin.json'), { name: 'linear', version: '0.0.3' });
  await writeJson(path.join(remoteRoot, '.codex-plugin', 'plugin.json'), { name: 'linear', version: '5.0.1' });
  await writeJson(path.join(curatedRoot, '.mcp.json'), { mcpServers: { linear: definition } });
  await writeJson(path.join(remoteRoot, '.mcp.json'), { mcpServers: { linear: definition } });
  await writeJson(path.join(homeDir, '.agents', 'mcp.json'), { servers: { linear: definition } });

  const inventory = await scanInventory({
    paths,
    homeDir,
    env: { SKILL_INDEX_AGENT_SUBSET: 'codex' },
    includeLiveSources: true,
    includeSandboxSources: false,
  });

  const linear = inventory.mcps?.find((mcp) => mcp.name === 'linear:linear');
  expect(inventory.mcps?.find((mcp) => mcp.name === 'linear')).toBeUndefined();
  expect(linear?.locations.filter((location) => location.canonicalRole === 'managed-source')).toHaveLength(2);
  expect(linear?.locations.some((location) => location.provenance?.kind === 'universal')).toBe(true);
  expect(linear?.issueReasons).not.toContain('missing-universal');
});
```

- [ ] **Step 2: Run the focused test and verify the current split**

Run:

```bash
pnpm test -- src/main/plugin-inventory.test.ts -t "groups identical physical plugin MCP sources with Universal by logical identity"
```

Expected: FAIL because the scanner creates separate `linear` and `linear:linear` records.

- [ ] **Step 3: Introduce logical identity groups**

Replace the flat plugin index entry array with identity groups:

```ts
interface PluginMcpIdentityGroup {
  inventoryName: string;
  coreDefinitionComparisonKeys: Set<string>;
}

type PluginMcpIndex = Map<string, PluginMcpIdentityGroup[]>;
```

In `buildPluginMcpIndex`, group physical entries by `inventoryName` while collecting all core keys:

```ts
const inventoryName = `${result.owner.plugin.pluginName}:${entry.name}`;
const groups = pluginMcpIndex.get(entry.name) ?? [];
const existing = groups.find((group) => group.inventoryName === inventoryName);
const comparisonKey = getMcpCoreDefinitionComparisonKey(entry.location);
if (existing) {
  existing.coreDefinitionComparisonKeys.add(comparisonKey);
} else {
  groups.push({ inventoryName, coreDefinitionComparisonKeys: new Set([comparisonKey]) });
}
pluginMcpIndex.set(entry.name, groups);
```

Update `createInventoryMcpName` to count matching logical groups:

```ts
const pluginIdentityGroups = pluginMcpIndex.get(entry.name) ?? [];
const comparisonKey = getMcpCoreDefinitionComparisonKey(entry.location);
const matchingGroups = pluginIdentityGroups.filter((group) =>
  group.coreDefinitionComparisonKeys.has(comparisonKey));

if (matchingGroups.length === 1) return matchingGroups[0].inventoryName;
if (pluginIdentityGroups.length === 1) return pluginIdentityGroups[0].inventoryName;
return entry.name;
```

- [ ] **Step 4: Run plugin inventory tests**

Run:

```bash
pnpm test -- src/main/plugin-inventory.test.ts
```

Expected: PASS, including existing differing-version behavior.

- [ ] **Step 5: Commit logical identity grouping**

```bash
git add src/main/mcp-inventory.ts src/main/plugin-inventory.test.ts
git commit -m "Fix plugin MCP logical identity grouping"
```

### Task 2: Reject genuinely ambiguous plugin promotion before mutation

**Files:**
- Modify: `src/main/issue-resolution.test.ts`
- Modify: `src/main/issue-resolution.ts:690-744`

- [ ] **Step 1: Write a failing preflight collision test**

Create two plugin roots whose manifest names differ but whose MCP config name and portable core are identical. Scan the plugin-only inventory, select one qualified record, capture Universal contents, attempt Missing Universal resolution, and assert an ambiguity error with unchanged Universal contents:

```ts
await expect(resolveInventoryIssue({
  entity: 'mcp',
  issue: 'missing-universal',
  mcpName: 'alpha-tools:shared',
  selectedVariantPath: alphaConfig,
}, scanOptions)).rejects.toThrow(/multiple plugin MCP identities.*shared/i);

expect(await readFile(universalPath, 'utf8')).toBe(universalBefore);
```

Also assert the competing inventory identities are `alpha-tools:shared` and `beta-tools:shared` so the test proves logical, not physical, ambiguity.

- [ ] **Step 2: Run the focused test and verify it fails after writing or at the postcondition**

Run:

```bash
pnpm test -- src/main/issue-resolution.test.ts -t "rejects ambiguous plugin MCP promotion before mutation"
```

Expected: FAIL because no preflight currently detects the collision.

- [ ] **Step 3: Add the collision preflight**

Before building mutation targets in `applyMcpResolution`, when `issue === 'missing-universal'` and the selected location is managed, compare the selected location against every other managed plugin location with the same `configName`. Collect distinct record names whose core comparison key equals the selected core key:

```ts
function assertMcpPromotionIdentityIsUnambiguous(
  snapshot: SkillInventorySnapshot,
  mcp: NonNullable<SkillInventorySnapshot['mcps']>[number],
  selected: McpLocationRecord,
): void {
  if (selected.canonicalRole !== 'managed-source' || !selected.configName) return;
  const selectedKey = getMcpPromotionCoreKey(selected);
  const identities = new Set((snapshot.mcps ?? []).flatMap((candidate) =>
    candidate.locations.some((location) =>
      location.canonicalRole === 'managed-source'
      && location.configName === selected.configName
      && getMcpPromotionCoreKey(location) === selectedKey)
      ? [candidate.name]
      : []));
  if (identities.size > 1) {
    throw new Error(`Cannot promote MCP "${mcp.name}": multiple plugin MCP identities match config key "${selected.configName}".`);
  }
}

function getMcpPromotionCoreKey(location: McpLocationRecord): string {
  return location.coreDefinitionComparisonKey
    ?? location.definitionComparisonKey
    ?? location.definitionText
    ?? `path:${location.configPath}`;
}
```

Call it immediately after selecting the variant and before reading or writing targets.

- [ ] **Step 4: Run the focused collision test**

Run:

```bash
pnpm test -- src/main/issue-resolution.test.ts -t "rejects ambiguous plugin MCP promotion before mutation"
```

Expected: PASS and Universal remains byte-for-byte unchanged.

- [ ] **Step 5: Commit ambiguity preflight**

```bash
git add src/main/issue-resolution.ts src/main/issue-resolution.test.ts
git commit -m "Guard ambiguous plugin MCP promotion"
```

### Task 3: Keep MCP writes reversible through postcondition validation

**Files:**
- Modify: `src/main/issue-resolution.test.ts`
- Modify: `src/main/issue-resolution.ts:151-190,676-744,875-919`

- [ ] **Step 1: Add a deterministic postcondition failure seam and failing rollback test**

Extend `ResolveIssueOptions` with a test-only flag:

```ts
/** Test-only failure after MCP writes and rescan, before transaction commit. */
testFailMcpPostcondition?: boolean;
```

Create a Missing Universal plugin promotion test that captures every intended target, invokes resolution with `testFailMcpPostcondition: true`, and verifies all target contents match their originals after rejection:

```ts
await expect(resolveInventoryIssue(request, {
  ...scanOptions,
  testFailMcpPostcondition: true,
})).rejects.toThrow('Forced MCP postcondition failure.');

for (const [targetPath, original] of originals) {
  expect(await readFile(targetPath, 'utf8')).toBe(original);
}
```

- [ ] **Step 2: Run the focused rollback test**

Run:

```bash
pnpm test -- src/main/issue-resolution.test.ts -t "rolls back MCP writes when postcondition validation fails"
```

Expected: FAIL because the current MCP transaction has already finalized when the postcondition throws.

- [ ] **Step 3: Return a reversible MCP transaction handle**

Define:

```ts
interface McpResolutionTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

Refactor the existing writer so the low-level transaction returns a handle after successful writes. Its rollback restores `originalContents` in reverse order; its commit marks the transaction finalized. Preserve `writeMcpDefinitionsTransaction` behavior by staging and immediately committing its returned transaction.

Make `resolveMcpIssueIfCurrent` and `applyMcpResolution` return the handle. In `resolveInventoryIssue`, hold the MCP transaction across a cache-free rescan:

```ts
const { preparedSnapshot, testFailMcpPostcondition, ...scanOptions } = options;
let mcpTransaction: McpResolutionTransaction | undefined;
try {
  if (request.entity === 'skill') {
    await resolveSkillIssueIfCurrent(snapshot, request, { ...scanOptions, paths });
  } else if (request.entity === 'mcp') {
    mcpTransaction = await resolveMcpIssueIfCurrent(snapshot, request, { ...scanOptions, paths });
  } else {
    await resolveSubagentIssueIfCurrent(snapshot, request, { ...scanOptions, paths });
  }
  const nextSnapshot = await scanInventory({
    ...scanOptions,
    paths,
    ...(mcpTransaction ? { writeCache: false } : {}),
  });
  if (testFailMcpPostcondition && mcpTransaction) {
    throw new Error('Forced MCP postcondition failure.');
  }
  assertResolutionIssueWasResolved(nextSnapshot, request);
  if (mcpTransaction && scanOptions.writeCache !== false) {
    await writeInventorySnapshotCache(nextSnapshot, { ...scanOptions, paths });
  }
  await mcpTransaction?.commit();
  return nextSnapshot;
} catch (error) {
  if (mcpTransaction) {
    try {
      await mcpTransaction.rollback();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'MCP resolution failed and rollback was incomplete.');
    }
  }
  throw error;
}
```

Import `writeInventorySnapshotCache` from `@main/scan-inventory`.

- [ ] **Step 4: Keep plugin update actions compatible**

`updateMcpUniversalFromPluginSource` is not the issue-resolution postcondition path. Have it await `applyMcpResolution`, then immediately commit the returned transaction so existing capability-action behavior remains unchanged:

```ts
const transaction = await applyMcpResolution(snapshot, mcp, 'missing-universal', selectedVariantPath, options);
await transaction.commit();
```

- [ ] **Step 5: Run MCP resolution tests**

Run:

```bash
pnpm test -- src/main/issue-resolution.test.ts
```

Expected: PASS, including existing staged mutation and pre-commit rollback tests.

- [ ] **Step 6: Commit postcondition transaction support**

```bash
git add src/main/issue-resolution.ts src/main/issue-resolution.test.ts
git commit -m "Rollback MCP resolution postcondition failures"
```

### Task 4: Verify the complete behavior

**Files:**
- Verify: `src/main/plugin-inventory.test.ts`
- Verify: `src/main/issue-resolution.test.ts`
- Verify: `src/renderer/src/inventory-view-model.test.ts`
- Verify: `src/main/scan-inventory.test.ts`
- Verify: repository-wide checks

- [ ] **Step 1: Run focused MCP and display suites**

```bash
pnpm test -- src/main/plugin-inventory.test.ts src/main/issue-resolution.test.ts src/renderer/src/inventory-view-model.test.ts src/main/scan-inventory.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static checks**

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all test files pass.

- [ ] **Step 4: Inspect final changes**

```bash
git diff --check
git status --short
git log --oneline --decorate -5
```

Expected: no whitespace errors; only intentional plan or implementation changes remain.
