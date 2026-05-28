export const APP_NAME = 'Skill Index';

export const IPC_CHANNELS = {
  getShellState: 'app:get-shell-state',
  readUpdateStatus: 'app:update:read-status',
  checkForUpdates: 'app:update:check',
  installUpdate: 'app:update:install',
  updateStatusUpdated: 'app:update:status-updated',
  openPathInEditor: 'app:open-path-in-editor',
  revealPathInFinder: 'app:reveal-path-in-finder',
  chooseDirectory: 'app:choose-directory',
  readInitialInventoryBootstrap: 'inventory:read-bootstrap',
  readCachedInventory: 'inventory:read-cache',
  scanInventory: 'inventory:scan',
  rescanInventory: 'inventory:rescan',
  testMcpConnectivity: 'inventory:test-mcp-connectivity',
  addSkill: 'inventory:add-skill',
  addMcpServer: 'inventory:add-mcp-server',
  resolveIssue: 'inventory:resolve-issue',
  applyCapabilityAction: 'inventory:apply-capability-action',
  dismissDrift: 'inventory:dismiss-drift',
  readAuditLog: 'audit:list',
  undoAuditOperation: 'audit:undo-operation',
  auditUpdated: 'audit:updated',
  releaseStartupObservation: 'inventory:release-startup-observation',
  inventoryUpdated: 'inventory:updated',
  seedRepresentativeFixtures: 'dev:seed-representative-fixtures',
  setInventoryMode: 'dev:set-inventory-mode',
  readSettings: 'settings:read',
  addCustomScanPath: 'settings:add-custom-scan-path',
  removeCustomScanPath: 'settings:remove-custom-scan-path',
  setPreferredCanonicalSourcePath: 'settings:set-preferred-canonical-source-path',
  clearPreferredCanonicalSourcePath: 'settings:clear-preferred-canonical-source-path',
  setDevSidebarInventorySourceSwitcherVisible: 'settings:set-dev-sidebar-inventory-source-switcher-visible',
  completeOnboarding: 'settings:complete-onboarding',
  ping: 'app:ping',
} as const;

export interface AppShellState {
  appName: typeof APP_NAME;
  username: string;
  dataDir: string;
  cacheFile: string;
  configFile: string;
  liveCanonicalUserSkillsDir: string;
  devTools?: {
    sandboxEnabled: boolean;
    inventoryMode: InventorySourceMode;
    sandboxRoot: string;
    sandboxAgentsDir: string;
    sandboxCanonicalUserSkillsDir: string;
    sandboxAgentsSkillsDir: string;
    fixturesDir: string;
  };
  startupObservationDelayMs?: number;
  startupObservationHold?: boolean;
  preloadStatus: 'ready';
}

export interface SettingsState {
  customScanPaths: string[];
  onboardingCompletedAt: string | null;
  preferredCanonicalSourcePath: string | null;
  showDevSidebarInventorySourceSwitcher: boolean;
}

export interface ChooseDirectoryRequest {
  title?: string;
}

export interface CompleteOnboardingRequest {
  completedAt?: string;
  preferredCanonicalSourcePath?: string | null;
}

export type AutoUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error';

export interface AutoUpdateStatus {
  phase: AutoUpdatePhase;
  downloadProgress?: AutoUpdateDownloadProgress;
  version?: string;
  lastCheckedAt?: string;
  errorMessage?: string;
}

export interface AutoUpdateDownloadProgress {
  bytesPerSecond?: number;
  percent?: number;
  totalBytes?: number;
  transferredBytes?: number;
}

export type SkillSourceScope = 'sandbox' | 'live' | 'custom';
export type SkillSourceKind = 'canonical' | 'agent' | 'plugin' | 'custom';
export type SkillLocationType = 'real-file' | 'symlink';
export type SkillInstallKind = 'directory';
export type SkillPackageFileKind = 'text' | 'binary';
export type PluginHost = 'claude' | 'codex';
export type ProvenanceKind =
  | 'plugin'
  | 'npx'
  | 'manual'
  | 'universal'
  | 'agent-local'
  | 'symlink'
  | 'git'
  | 'unknown';
export type CanonicalRole =
  | 'canonical'
  | 'materialized-copy';
export type Mutability = 'writable' | 'read-only-managed' | 'unknown';
export type SkillStructuralState =
  | 'healthy'
  | 'missing-symlinks'
  | 'single-source-noncanonical'
  | 'identical-drift'
  | 'diverged-drift';
export type SkillDriftPresentation = 'none' | 'active' | 'dismissed';
export type SkillIssueReason =
  | 'missing-symlinks'
  | 'missing-canonical'
  | 'identical-copies'
  | 'diverged-copies'
  | 'broken-symlink'
  | 'wrong-symlink-target'
  | 'invalid-definition';

export interface SkillScanSource {
  id: string;
  label: string;
  canonical: boolean;
  kind: SkillSourceKind;
  writable: boolean;
  scope: SkillSourceScope;
  skillsDir: string;
  preferredCanonical?: boolean;
  compatibleAgentFamilies?: string[];
  ignoredSkillSubpaths?: string[];
  plugin?: PluginSourceRef;
  mcpConfigPath?: string;
}

export interface PluginSourceRef {
  host: PluginHost;
  pluginId: string;
  pluginName: string;
  version?: string;
  rootPath: string;
  manifestPath?: string;
}

export interface SkillProvenance {
  kind: ProvenanceKind;
  plugin?: {
    host: PluginHost;
    pluginId: string;
    version?: string;
  };
  npx?: {
    packageName: string;
    source?: string;
    sourceType?: string;
    sourceUrl?: string;
    skillPath?: string;
    lockFilePath?: string;
  };
  sourcePath?: string;
  discoveredAt: string;
}

export type SkillUniversalDecisionState = 'policy' | 'user-confirmed';
export type SkillUniversalAlternateReason = 'kept-separate';

export type SkillUniversalOrigin =
  | {
    kind: 'plugin';
    host: PluginHost;
    pluginId: string;
    pluginVersion?: string;
    pluginSkillName: string;
  }
  | {
    kind: 'path';
    sourceId: string;
    path: string;
  };

export interface SkillUniversalAlternate {
  kind: 'plugin' | 'path';
  path?: string;
  sourceId?: string;
  host?: PluginHost;
  pluginId?: string;
  pluginVersion?: string;
  pluginSkillName?: string;
  reason: SkillUniversalAlternateReason;
}

export interface SkillUniversalDecision {
  id: string;
  skillName: string;
  state: SkillUniversalDecisionState;
  universal: SkillUniversalOrigin;
  acceptedAlternates: SkillUniversalAlternate[];
  updatedAt: string;
}

export interface PluginSkillRef {
  name: string;
  path: string;
  entrypointPath: string;
  sourceId: string;
}

export interface PluginMcpRef {
  name: string;
  configPath: string;
  sourceId: string;
}

export interface PluginUnsupportedAssetRef {
  kind: 'hook';
  name: string;
  path: string;
  sourceId: string;
}

export interface PluginRecord {
  host: PluginHost;
  scope?: SkillSourceScope;
  pluginId: string;
  pluginName: string;
  version?: string;
  rootPath: string;
  manifestPath?: string;
  enabled: boolean | 'unknown';
  skillRoots?: string[];
  bundledSkills: PluginSkillRef[];
  bundledMcps: PluginMcpRef[];
  unsupportedAssets?: PluginUnsupportedAssetRef[];
  unsupportedHooksCount?: number;
  source?: {
    marketplace?: string;
    repository?: string;
  };
}

export interface SkillLocationRecord {
  path: string;
  entrypointPath?: string;
  sourceId: string;
  sourceLabel: string;
  sourceScope: SkillSourceScope;
  installKind?: SkillInstallKind;
  fileType: SkillLocationType;
  modifiedAt: string;
  canonical: boolean;
  fileCount?: number;
  resolvedPath?: string;
  symlinkTarget?: string;
  contentHash?: string;
  definitionText?: string;
  packageFiles?: SkillPackageFileRecord[];
  provenance?: SkillProvenance;
  canonicalRole?: CanonicalRole;
  mutability?: Mutability;
}

export interface SkillDiffLine {
  type: 'context' | 'added' | 'removed';
  text: string;
}

export interface SkillPackageFileRecord {
  relativePath: string;
  kind: SkillPackageFileKind;
  size: number;
  contentHash?: string;
  text?: string;
}

export type SkillDiffFileStatus = 'changed' | 'added' | 'removed' | 'binary';

export interface SkillDiffFileRecord {
  relativePath: string;
  status: SkillDiffFileStatus;
  kind: SkillPackageFileKind;
  lines?: SkillDiffLine[];
}

export interface SkillDiffRecord {
  primaryPath?: string;
  primarySourceLabel?: string;
  comparisons?: Array<{
    path: string;
    sourceLabel: string;
    lines: SkillDiffLine[];
  }>;
  baselinePath?: string;
  baselineSourceLabel?: string;
  selectedPath?: string;
  selectedSourceLabel?: string;
  files?: SkillDiffFileRecord[];
}

export interface SkillInstallSource {
  sourceId: string;
  label: string;
  kind: SkillSourceKind;
  scope: SkillSourceScope;
  writable: boolean;
  canonical: boolean;
}

export interface SkillDuplicateCandidate extends SkillLocationRecord {
  definitionText?: string;
  installSource: SkillInstallSource;
}

export type SkillFrontMatterRequiredField = 'name' | 'description';
export type SkillDefinitionIssueType =
  | 'missing-required-field'
  | 'invalid-field-value'
  | 'malformed-front-matter'
  | 'unreadable-file';

export interface SkillDefinitionIssue {
  type: SkillDefinitionIssueType;
  field?: SkillFrontMatterRequiredField;
  path: string;
  entrypointPath?: string;
  sourceId: string;
  sourceLabel: string;
  sourceScope: SkillSourceScope;
  installSource: SkillInstallSource;
  detail?: string;
}

export interface SkillDetailDiagnostics {
  duplicateCandidates: SkillDuplicateCandidate[];
  installSources: SkillInstallSource[];
  missingInstallSources?: SkillInstallSource[];
  definitionIssues?: SkillDefinitionIssue[];
  universalDecision?: SkillUniversalDecision;
  acceptedAlternates?: SkillUniversalAlternate[];
}

export interface SkillRecord {
  name: string;
  displayName?: string | null;
  description?: string | null;
  structuralState: SkillStructuralState;
  isDrifted: boolean;
  driftPresentation: SkillDriftPresentation;
  issueReasons?: SkillIssueReason[];
  locations: SkillLocationRecord[];
  detailDiagnostics: SkillDetailDiagnostics;
  driftSignature?: string;
  diff?: SkillDiffRecord;
}

export interface SkillInventoryCounts {
  totalSkills: number;
  driftedSkills: number;
  healthySkills: number;
  missingSymlinkSkills?: number;
  singleSourceSkills: number;
  identicalDriftSkills: number;
  divergedDriftSkills: number;
  dismissedDriftSkills: number;
}

export interface AgentLocationRecord {
  state: 'available' | 'unavailable';
  exists: boolean;
  path?: string;
  displayPath?: string;
  reason?: 'account-managed' | 'not-supported';
}

export type AgentInstallState = 'installed' | 'not-installed';

export type AgentMcpConfigKind = 'dedicated-file' | 'agent-config' | 'directory' | 'mixed' | 'none' | 'unknown';
export type AgentMcpParserKind =
  | 'json-servers'
  | 'json-mcpServers'
  | 'json-mcp'
  | 'jsonc-mcpServers'
  | 'jsonc-mcp'
  | 'jsonc-dotted-amp-mcpServers'
  | 'jsonc-dotted-zencoder-mcpServers'
  | 'jsonc-mcp-servers'
  | 'jsonc-opencode-mcp'
  | 'yaml'
  | 'toml'
  | 'toml-mcpServers-array'
  | 'none'
  | 'unknown';
export type AgentMcpSupportedTransport = 'stdio' | 'streamable-http' | 'sse' | 'http';
export type AgentMcpWriteDialect =
  | 'json-url'
  | 'json-type-url'
  | 'json-http-url'
  | 'json-opencode'
  | 'json-openclaw'
  | 'toml-codex'
  | 'toml-transport-array'
  | 'yaml-typed'
  | 'none'
  | 'unknown';

export interface AgentMetadataSource {
  url: string;
  note?: string;
}

export interface AgentIconRecord {
  assetUrl?: string;
  format?: string;
  assetPathInArchive?: string;
  note?: string;
}

export interface AgentRecord {
  id: string;
  family: string;
  label: string;
  writable: boolean;
  scope: SkillSourceScope;
  installState: AgentInstallState;
  defaultProjectSkillsDir: string;
  defaultGlobalSkillsDir: string;
  defaultHomeDir: string;
  mcpConfigKind?: AgentMcpConfigKind;
  mcpParserKind?: AgentMcpParserKind;
  mcpWriteDialect?: AgentMcpWriteDialect;
  mcpSupportedTransports?: AgentMcpSupportedTransport[];
  metadataSources?: AgentMetadataSource[];
  icon?: AgentIconRecord;
  skillsLocation: AgentLocationRecord;
  mcpConfigLocation: AgentLocationRecord;
  configLocation?: AgentLocationRecord;
  executableLocation?: AgentLocationRecord;
}

export interface AgentInventoryCounts {
  totalAgents: number;
  installedAgents: number;
  notInstalledAgents: number;
}

export type McpTransportKind = AgentMcpSupportedTransport | 'unknown';
export type McpConfiguredTransportKind = AgentMcpSupportedTransport;
export type RemoteMcpTransportKind = Exclude<McpConfiguredTransportKind, 'stdio'>;
export type McpConnectivityStatus = 'verified' | 'failed' | 'skipped' | 'unknown';

export type McpDefinitionValue =
  | string
  | number
  | boolean
  | null
  | McpDefinitionValue[]
  | McpDefinitionObject;

export interface McpDefinitionObject {
  [key: string]: McpDefinitionValue | undefined;
}

export interface McpServerDefinition extends McpDefinitionObject {
  transport?: string;
  type?: string;
  command?: string;
  args?: McpDefinitionValue[];
  env?: McpDefinitionObject;
  cwd?: string;
  url?: string;
  headers?: McpDefinitionObject;
  http_headers?: McpDefinitionObject;
  env_http_headers?: McpDefinitionObject;
  bearer_token_env_var?: string;
}

export type McpServerDefinitions = Record<string, McpDefinitionValue>;

export interface McpConnectivityRecord {
  status: McpConnectivityStatus;
  checkedAt?: string;
  latencyMs?: number;
  error?: string;
  capabilities?: {
    tools?: number;
    resources?: number;
    prompts?: number;
  };
}

export interface McpLocationRecord {
  agentId: string;
  agentLabel: string;
  scope: SkillSourceScope;
  configPath: string;
  configName?: string;
  transport?: McpTransportKind;
  command?: string;
  url?: string;
  args: string[];
  definitionText?: string;
  definitionComparisonKey?: string;
  invalidDetails?: string[];
  connectivity?: McpConnectivityRecord;
  provenance?: SkillProvenance;
  canonicalRole?: CanonicalRole;
  mutability?: Mutability;
}

export interface McpExpectedLocationRecord {
  agentId: string;
  agentLabel: string;
  scope: SkillSourceScope;
  configPath?: string;
  supportStatus?: 'supported' | 'unsupported';
  unsupportedReason?: 'remote-mcp-not-supported' | 'transport-not-supported';
  unsupportedTransport?: McpConfiguredTransportKind;
}

export type McpIssueReason = 'definition-mismatch' | 'missing-from-agents' | 'invalid-definition' | 'connection-failed';
export type McpStatus = 'healthy' | 'needs-attention';
export type McpPresentation = 'none' | 'active' | 'dismissed';

export interface McpRecord {
  name: string;
  status: McpStatus;
  presentation: McpPresentation;
  locations: McpLocationRecord[];
  expectedLocations?: McpExpectedLocationRecord[];
  missingLocations?: McpExpectedLocationRecord[];
  issueReasons: McpIssueReason[];
  signature?: string;
}

export interface McpInventoryCounts {
  totalMcps: number;
  attentionMcps: number;
  healthyMcps: number;
  dismissedAttentionMcps: number;
}

export interface HomeSummaryMetric {
  total: number;
  healthy: number;
  needsAttention: number;
}

export interface HomeSummary {
  skills: HomeSummaryMetric;
  mcps: HomeSummaryMetric;
  installedAgents: number;
}

export interface SkillInventorySnapshot {
  scannedAt: string;
  sourceIds: string[];
  sources: SkillScanSource[];
  plugins?: PluginRecord[];
  skills: SkillRecord[];
  counts: SkillInventoryCounts;
  mcps?: McpRecord[];
  mcpCounts?: McpInventoryCounts;
  agents?: AgentRecord[];
  agentCounts?: AgentInventoryCounts;
  homeSummary?: HomeSummary;
}

export interface SkillIndexBootstrapState {
  initialInventorySnapshot: SkillInventorySnapshot | null;
}

export interface ScanInventoryOptions {
  includeSandboxSources?: boolean;
  includeLiveSources?: boolean;
  customScanPaths?: string[];
}

export interface RescanInventoryRequest {
  verifyMcpConnectivity?: boolean;
}

export type SkillResolvableIssue =
  | 'missing-symlinks'
  | 'missing-canonical'
  | 'identical-copies'
  | 'diverged-copies'
  | 'broken-symlink'
  | 'wrong-symlink-target';

export type McpResolvableIssue = 'definition-mismatch' | 'missing-from-agents';

export type ResolveIssueRequest =
  | {
    entity: 'skill';
    skillName: string;
    issue: SkillResolvableIssue;
    selectedVariantPath?: string;
    mcpName?: never;
  }
  | {
    entity: 'mcp';
    mcpName: string;
    issue: McpResolvableIssue;
    selectedVariantPath?: string;
    skillName?: never;
  };

export type CapabilityActionRequest = {
  entity: 'skill';
  action: 'choose-universal-version';
  skillName: string;
  selectedVariantPath: string;
};

export type InventorySourceMode = 'sandbox' | 'live';

export type DismissDriftRequest =
  | {
    skillName: string;
    mcpName?: never;
  }
  | {
    mcpName: string;
    skillName?: never;
  };

export interface SeededFixtureExpectation {
  name: string;
  expectedState: SkillStructuralState;
  expectedLocationCount: number;
}

export interface SeedRepresentativeFixturesResult {
  fixtureSet: 'representative-agent-scan-foundation';
  sandboxRoot: string;
  ignoredPaths: string[];
  skills: SeededFixtureExpectation[];
}

export type AddSkillRequest =
  | {
    sourceType: 'url';
    source: string;
    skillName?: never;
    markdown?: never;
  }
  | {
    sourceType: 'markdown';
    skillName: string;
    markdown: string;
    source?: never;
  };

export type AddMcpServerRequest =
  | {
    name: string;
    transport: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    url?: never;
    headers?: never;
  }
  | {
    name: string;
    transport: RemoteMcpTransportKind;
    url: string;
    headers?: Record<string, string>;
    command?: never;
    args?: never;
    env?: never;
  };

export type AuditOperationKind =
  | 'resolve-skill-issue'
  | 'resolve-mcp-issue'
  | 'add-skill'
  | 'add-mcp-server'
  | 'settings-update'
  | 'capability-action'
  | 'dismiss-drift'
  | 'seed-representative-fixtures'
  | 'undo';

export type AuditActionKind =
  | 'create-file'
  | 'overwrite-file'
  | 'delete-path'
  | 'create-symlink'
  | 'replace-with-symlink'
  | 'copy-directory'
  | 'write-config'
  | 'update-app-config'
  | 'run-external-installer'
  | 'reset-directory'
  | 'update-cache'
  | 'unknown-change';

export type AuditOperationStatus = 'completed' | 'failed' | 'undone' | 'undo-blocked' | 'undo-failed';
export type AuditActionStatus = 'completed' | 'failed' | 'undone' | 'undo-blocked';
export type AuditUndoState = 'available' | 'expired' | 'not-undoable' | 'used' | 'blocked';

export interface AuditStateSummary {
  kind: 'absent' | 'file' | 'directory' | 'symlink' | 'config' | 'unknown';
  hash?: string;
  size?: number;
  itemCount?: number;
  symlinkTarget?: string;
}

export interface AuditAction {
  id: string;
  operationId: string;
  kind: AuditActionKind;
  title: string;
  summary: string;
  status: AuditActionStatus;
  path?: string;
  targetPath?: string;
  before?: AuditStateSummary;
  after?: AuditStateSummary;
  diagnostics?: AuditActionDiagnostics;
  completedAt: string;
}

export interface AuditDriftSignatureSummary {
  signatureHash: string;
  name?: string;
  structuralState?: string;
  issueReasons?: string[];
  locations?: Array<{
    contentHash?: string | null;
    fileType?: string;
    path?: string;
    resolvedPath?: string | null;
  }>;
  parseError?: string;
}

export interface AuditDismissedDriftSignatureDiagnostic {
  currentSkill?: {
    driftPresentation?: string;
    driftSignature?: AuditDriftSignatureSummary;
    issueReasons?: string[];
    name: string;
    signatureDiffFields?: string[];
    signatureMatches: boolean;
    structuralState?: string;
  };
  signature: AuditDriftSignatureSummary;
}

export interface AuditActionDiagnostics {
  dismissedDriftSignatures?: {
    added: AuditDismissedDriftSignatureDiagnostic[];
    removed: AuditDismissedDriftSignatureDiagnostic[];
  };
}

export interface AuditFailureDiagnostic {
  message: string;
  trace: string;
}

export interface AuditOperation {
  id: string;
  kind: AuditOperationKind;
  title: string;
  summary: string;
  startedAt: string;
  completedAt?: string;
  status: AuditOperationStatus;
  actor: 'app';
  sourceMode: InventorySourceMode;
  entity?: { type: 'skill' | 'mcp' | 'settings' | 'sandbox'; name?: string };
  failure?: AuditFailureDiagnostic;
  undoState: AuditUndoState;
  actionCount: number;
  actions: AuditAction[];
}

export interface UndoAuditOperationResult {
  auditLog: AuditOperation[];
  inventorySnapshot: SkillInventorySnapshot | null;
  settingsState?: SettingsState;
}

export interface SkillIndexDesktopApi {
  getShellState(): Promise<AppShellState>;
  readUpdateStatus(): Promise<AutoUpdateStatus>;
  checkForUpdates(): Promise<AutoUpdateStatus>;
  installUpdate(): Promise<AutoUpdateStatus>;
  openPathInEditor(filePath: string): Promise<void>;
  revealPathInFinder(filePath: string): Promise<void>;
  chooseDirectory(request?: ChooseDirectoryRequest): Promise<string | null>;
  readSettings(): Promise<SettingsState>;
  readCachedInventory(): Promise<SkillInventorySnapshot | null>;
  scanInventory(): Promise<SkillInventorySnapshot>;
  rescanInventory(request?: RescanInventoryRequest): Promise<SkillInventorySnapshot>;
  testMcpConnectivity(): Promise<SkillInventorySnapshot>;
  addSkill(request: AddSkillRequest): Promise<SkillInventorySnapshot>;
  addMcpServer(request: AddMcpServerRequest): Promise<SkillInventorySnapshot>;
  resolveIssue(request: ResolveIssueRequest): Promise<SkillInventorySnapshot>;
  applyCapabilityAction(request: CapabilityActionRequest): Promise<SkillInventorySnapshot>;
  dismissDrift(request: DismissDriftRequest): Promise<SkillInventorySnapshot>;
  readAuditLog(options?: { limit?: number }): Promise<AuditOperation[]>;
  undoAuditOperation(operationId: string): Promise<UndoAuditOperationResult>;
  releaseStartupObservation(): Promise<void>;
  onUpdateStatusUpdated(listener: (status: AutoUpdateStatus) => void): () => void;
  onInventoryUpdated(listener: (snapshot: SkillInventorySnapshot) => void): () => void;
  onAuditUpdated(listener: (operations: AuditOperation[]) => void): () => void;
  addCustomScanPath(scanPath: string): Promise<SettingsState>;
  removeCustomScanPath(scanPath: string): Promise<SettingsState>;
  setPreferredCanonicalSourcePath(scanPath: string): Promise<SettingsState>;
  clearPreferredCanonicalSourcePath(): Promise<SettingsState>;
  setDevSidebarInventorySourceSwitcherVisible(visible: boolean): Promise<SettingsState>;
  completeOnboarding(request: CompleteOnboardingRequest): Promise<SettingsState>;
  ping(): Promise<string>;
}

export interface SkillIndexDevApi {
  seedRepresentativeFixtures(): Promise<SeedRepresentativeFixturesResult>;
  setInventoryMode(mode: InventorySourceMode): Promise<InventorySourceMode>;
}

type InvokeLike = (channel: string, ...args: unknown[]) => Promise<unknown>;
type SubscribeLike = (channel: string, listener: (...args: unknown[]) => void) => () => void;

export function createSkillIndexDesktopApi(invoke: InvokeLike, subscribe: SubscribeLike): SkillIndexDesktopApi {
  return {
    async getShellState() {
      return invoke(IPC_CHANNELS.getShellState) as Promise<AppShellState>;
    },
    async readUpdateStatus() {
      return invoke(IPC_CHANNELS.readUpdateStatus) as Promise<AutoUpdateStatus>;
    },
    async checkForUpdates() {
      return invoke(IPC_CHANNELS.checkForUpdates) as Promise<AutoUpdateStatus>;
    },
    async installUpdate() {
      return invoke(IPC_CHANNELS.installUpdate) as Promise<AutoUpdateStatus>;
    },
    async openPathInEditor(filePath) {
      await invoke(IPC_CHANNELS.openPathInEditor, filePath);
    },
    async revealPathInFinder(filePath) {
      await invoke(IPC_CHANNELS.revealPathInFinder, filePath);
    },
    async chooseDirectory(request) {
      return request === undefined
        ? invoke(IPC_CHANNELS.chooseDirectory) as Promise<string | null>
        : invoke(IPC_CHANNELS.chooseDirectory, request) as Promise<string | null>;
    },
    async readSettings() {
      return invoke(IPC_CHANNELS.readSettings) as Promise<SettingsState>;
    },
    async readCachedInventory() {
      return invoke(IPC_CHANNELS.readCachedInventory) as Promise<SkillInventorySnapshot | null>;
    },
    async scanInventory() {
      return invoke(IPC_CHANNELS.scanInventory) as Promise<SkillInventorySnapshot>;
    },
    async rescanInventory(request) {
      return request === undefined
        ? invoke(IPC_CHANNELS.rescanInventory) as Promise<SkillInventorySnapshot>
        : invoke(IPC_CHANNELS.rescanInventory, request) as Promise<SkillInventorySnapshot>;
    },
    async testMcpConnectivity() {
      return invoke(IPC_CHANNELS.testMcpConnectivity) as Promise<SkillInventorySnapshot>;
    },
    async addSkill(request) {
      return invoke(IPC_CHANNELS.addSkill, request) as Promise<SkillInventorySnapshot>;
    },
    async addMcpServer(request) {
      return invoke(IPC_CHANNELS.addMcpServer, request) as Promise<SkillInventorySnapshot>;
    },
    async resolveIssue(request) {
      return invoke(IPC_CHANNELS.resolveIssue, request) as Promise<SkillInventorySnapshot>;
    },
    async applyCapabilityAction(request) {
      return invoke(IPC_CHANNELS.applyCapabilityAction, request) as Promise<SkillInventorySnapshot>;
    },
    async dismissDrift(request) {
      return invoke(IPC_CHANNELS.dismissDrift, request) as Promise<SkillInventorySnapshot>;
    },
    async readAuditLog(options) {
      return options === undefined
        ? invoke(IPC_CHANNELS.readAuditLog) as Promise<AuditOperation[]>
        : invoke(IPC_CHANNELS.readAuditLog, options) as Promise<AuditOperation[]>;
    },
    async undoAuditOperation(operationId) {
      return invoke(IPC_CHANNELS.undoAuditOperation, operationId) as Promise<UndoAuditOperationResult>;
    },
    async releaseStartupObservation() {
      await invoke(IPC_CHANNELS.releaseStartupObservation);
    },
    onUpdateStatusUpdated(listener) {
      return subscribe(IPC_CHANNELS.updateStatusUpdated, (status) => {
        listener(status as AutoUpdateStatus);
      });
    },
    onInventoryUpdated(listener) {
      return subscribe(IPC_CHANNELS.inventoryUpdated, (snapshot) => {
        listener(snapshot as SkillInventorySnapshot);
      });
    },
    onAuditUpdated(listener) {
      return subscribe(IPC_CHANNELS.auditUpdated, (operations) => {
        listener(operations as AuditOperation[]);
      });
    },
    async addCustomScanPath(scanPath) {
      return invoke(IPC_CHANNELS.addCustomScanPath, scanPath) as Promise<SettingsState>;
    },
    async removeCustomScanPath(scanPath) {
      return invoke(IPC_CHANNELS.removeCustomScanPath, scanPath) as Promise<SettingsState>;
    },
    async setPreferredCanonicalSourcePath(scanPath) {
      return invoke(IPC_CHANNELS.setPreferredCanonicalSourcePath, scanPath) as Promise<SettingsState>;
    },
    async clearPreferredCanonicalSourcePath() {
      return invoke(IPC_CHANNELS.clearPreferredCanonicalSourcePath) as Promise<SettingsState>;
    },
    async setDevSidebarInventorySourceSwitcherVisible(visible) {
      return invoke(IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible, visible) as Promise<SettingsState>;
    },
    async completeOnboarding(request) {
      return invoke(IPC_CHANNELS.completeOnboarding, request) as Promise<SettingsState>;
    },
    async ping() {
      return invoke(IPC_CHANNELS.ping) as Promise<string>;
    },
  };
}

export function createSkillIndexDevApi(invoke: InvokeLike): SkillIndexDevApi {
  return {
    async seedRepresentativeFixtures() {
      return invoke(IPC_CHANNELS.seedRepresentativeFixtures) as Promise<SeedRepresentativeFixturesResult>;
    },
    async setInventoryMode(mode) {
      return invoke(IPC_CHANNELS.setInventoryMode, mode) as Promise<InventorySourceMode>;
    },
  };
}
