import type {
  AgentRecord,
  McpDefinitionObject,
  McpDefinitionValue,
  McpIssueReason,
  McpLocationRecord,
  McpRecord,
  McpServerDefinition,
  McpTransportKind,
  PluginHost,
  SkillDefinitionIssue,
  SkillDiffFileRecord,
  SkillDiffLine,
  SkillDuplicateCandidate,
  SkillInstallSource,
  SkillIssueReason,
  SkillLocationRecord,
  SkillProvenance,
  SkillPackageFileKind,
  SkillPackageFileRecord,
  SkillRecord,
  SkillScanSource,
  SkillUniversalAlternate,
  SubagentIssueReason,
  SubagentLocationRecord,
  SubagentRecord,
} from '@shared/contracts';
import { buildTextDiffLines } from '@shared/text-diff';
import { isMcpDefinitionObject, normalizeMcpDefinitionForComparison } from '@shared/mcp-definition';

import {
  compareNewestCandidate,
  formatAgeLabel,
  formatCompactDate,
  formatMcpIssueReason,
  formatMcpSupportingCopy,
  formatSkillIssueReason,
  formatSubagentIssueReason,
  getDisplaySkillIssueReasons,
  getSkillRowDescription,
} from './inventory-presentation';
import { getMcpDisplayName, getSkillDisplayName, getSubagentDisplayName } from '../inventory-view-model';

type InspectorProblemKey = SkillIssueReason | McpIssueReason | SubagentIssueReason;
type InspectorSectionTitle = 'Variant resolution' | 'Structural repair';

export const DETAIL_DIFF_TITLE = 'Diff: Selected Version vs Universal';
export const MCP_DETAIL_DIFF_TITLE = 'Diff: Selected Definition vs Reference';
const SKILL_ACTION_LABELS = {
  useAsUniversal: 'Use as Universal',
  convertCopiesToSymlinks: 'Convert Copies to Symlinks',
  createMissingSymlinks: 'Create Missing Symlinks',
  repairSymlinks: 'Repair Symlinks',
} as const;
const MCP_ACTION_LABELS = {
  promoteToUniversal: 'Promote to Universal',
  applySelectedDefinition: 'Apply Selected Definition Across Agents',
  addToAgents: 'Add MCP to Agents',
} as const;
const SUBAGENT_ACTION_LABELS = {
  addToUniversal: 'Add to Universal',
  addToAgents: 'Add to Agents',
  applySelectedDefinition: 'Apply Selected Definition',
  convertCopiesToSymlinks: 'Convert Copies to Symlinks',
  repairSymlinks: 'Repair Symlinks',
} as const;

export interface InspectorMetadataRow {
  label: 'Selected version' | 'Universal' | 'Selected definition' | 'Reference definition' | 'Locations';
  value: string;
  path: string | null;
}

export interface InspectorHeaderModel {
  title: string;
  description: string | null;
  updatedLabel: string;
  metadata: InspectorMetadataRow[];
  isLocked?: boolean;
}

export interface InspectorProblemListItem {
  key: InspectorProblemKey;
  label: string;
  detail: string;
  summary: string;
  isActive: boolean;
}

export interface InspectorProblemSectionModel {
  title: InspectorSectionTitle;
  problemKeys: InspectorProblemKey[];
}

export type InspectorLocationTone = 'healthy' | 'warning' | 'danger' | 'muted';

export interface InspectorLocationAction {
  kind: 'choose-skill-universal-version';
  label: string;
  path: string;
}

export interface InspectorLocationRow {
  id: string;
  label: string | null;
  path: string | null;
  pathText: string;
  statusLabel?: string;
  tone: InspectorLocationTone;
  action?: InspectorLocationAction;
}

export interface InspectorLocationSectionModel {
  id: string;
  title: string;
  rows: InspectorLocationRow[];
}

export interface InspectorVariantModel {
  id: string;
  path: string;
  label: string;
  secondaryLabel: string;
  badge?: 'Universal' | 'Selected Version' | 'Reference Definition';
  isBaseline: boolean;
  locations: Array<{ label: string; path: string }>;
  updatedLabel: string;
  definitionText?: string;
}

export interface InspectorChangedFileModel {
  path: string;
  absolutePath: string;
  status: 'changed' | 'added' | 'removed' | 'binary';
  displayKind: 'diff' | 'preview' | 'unchanged';
  hasInlineDiff: boolean;
  diffLines: SkillDiffLine[];
}

export type InspectorDefinitionFieldStatus = 'same' | 'different' | 'selected-only' | 'reference-only';

export interface InspectorDefinitionFieldComparison {
  key: string;
  label: string;
  status: InspectorDefinitionFieldStatus;
  selectedValue: string[];
  referenceValue: string[];
}

export interface InspectorIgnoredDefinitionSetting {
  key: string;
  label: string;
  sources: string[];
}

export interface InspectorRawConfigSnippet {
  label: 'Selected definition' | 'Reference definition';
  path: string;
  text: string;
}

export interface InspectorDefinitionBreakdown {
  comparedFields: InspectorDefinitionFieldComparison[];
  ignoredSettings: InspectorIgnoredDefinitionSetting[];
  rawConfigs: InspectorRawConfigSnippet[];
}

export interface InspectorDefinitionFileModel {
  relativePath: string;
  absolutePath: string;
  displayPath?: string;
  openPath?: string | null;
  kind: SkillPackageFileKind;
  text: string | null;
}

export interface InspectorDefinitionModel {
  listTitle: 'Detected Versions' | 'Detected Definitions';
  variants: InspectorVariantModel[];
  selectedVariant: InspectorVariantModel | null;
  selectedVariantPath: string | null;
  files: InspectorDefinitionFileModel[];
  emptySummary: string;
}

export interface InspectorStructuralItem {
  id: string;
  label: string;
  path: string;
  pathExists?: boolean;
  detail?: string;
  snippet?: {
    title: string;
    text: string;
  };
}

export interface VariantResolutionProblemModel {
  kind: 'variant-resolution';
  key: InspectorProblemKey;
  title: string;
  listTitle: string;
  variants: InspectorVariantModel[];
  changedFiles: InspectorChangedFileModel[];
  selectedVariant: InspectorVariantModel | null;
  baselineVariant: InspectorVariantModel | null;
  diffTitle: string;
  diffLines: SkillDiffLine[];
  diffPath: string | null;
  definitionBreakdown?: InspectorDefinitionBreakdown;
  primaryActionLabel: string | null;
  actionSummary?: string | null;
}

export interface StructuralRepairProblemModel {
  kind: 'structural-repair';
  key: InspectorProblemKey;
  title: string;
  listTitle: string;
  items: InspectorStructuralItem[];
  healthySummary: string | null;
  primaryActionLabel: string | null;
  actionSummary?: string | null;
}

export type InspectorActiveProblemModel = VariantResolutionProblemModel | StructuralRepairProblemModel;

export interface InspectorProvenanceRow {
  id: string;
  label: 'Selected version' | 'Universal' | 'Variant' | 'Selected definition' | 'Reference definition' | 'Definition';
  sourceLabel: string;
  path: string;
  detail: string;
  isSelected: boolean;
  isCanonical: boolean;
}

export interface InspectorProvenanceSummaryRow {
  id: string;
  label: 'Source Type' | 'Source';
  value: string;
  href?: string;
  action?: {
    kind: 'plugin';
    host: PluginHost;
    pluginId: string;
    version?: string;
  };
}

export interface InspectorModel {
  header: InspectorHeaderModel;
  definition: InspectorDefinitionModel;
  locations: InspectorLocationSectionModel[];
  problemCountLabel: string;
  problems: InspectorProblemListItem[];
  problemSections: InspectorProblemSectionModel[];
  activeProblem: InspectorActiveProblemModel;
  selectedVariantPath: string | null;
  provenanceRows: InspectorProvenanceRow[];
  provenanceSummary: InspectorProvenanceSummaryRow[];
}

interface SkillVariantGroup {
  id: string;
  definitionText?: string;
  locations: SkillDuplicateCandidate[];
  representative: SkillDuplicateCandidate;
}

interface McpVariantGroup {
  id: string;
  definitionText?: string;
  locations: McpLocationRecord[];
  representative: McpLocationRecord;
}

interface SubagentVariantGroup {
  id: string;
  definitionText?: string;
  locations: SubagentLocationRecord[];
  representative: SubagentLocationRecord;
}

type InternalSkillDiffFileRecord = SkillDiffFileRecord & {
  __displayKind?: InspectorChangedFileModel['displayKind'];
};

export function buildSkillInspectorModel(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
  selection: {
    selectedProblemKey?: SkillIssueReason | null;
    selectedVariantPath?: string | null;
  } = {},
  agentIndex: Map<string, AgentRecord> = new Map(),
): InspectorModel {
  const problemKeys = getSkillProblemKeys(skill);
  let activeProblem = problemKeys.length > 0
    ? buildSkillProblemModel(skill, selectProblemKey(problemKeys, selection.selectedProblemKey), selection.selectedVariantPath, sourceIndex, agentIndex)
    : buildHealthySkillProblem(skill);
  if (!selection.selectedProblemKey && shouldPreferInspectionProblem(activeProblem)) {
    const inspectionProblemKey = getInspectionRequiredProblemKey(problemKeys);
    if (inspectionProblemKey) {
      activeProblem = buildSkillProblemModel(skill, inspectionProblemKey, selection.selectedVariantPath, sourceIndex, agentIndex);
    }
  }
  const selectedVariantPath = getPreferredSelectedVariantPath(selection.selectedVariantPath, activeProblem);
  const provenanceRows = buildSkillProvenanceRows(skill, selectedVariantPath);
  const provenanceSummary = buildSkillProvenanceSummary(skill, selectedVariantPath, sourceIndex);
  const definition = buildSkillDefinitionModel(skill, selectedVariantPath, sourceIndex);

  return {
    header: {
      title: getSkillDisplayName(skill),
      description: getSkillRowDescription(skill),
      updatedLabel: `Updated ${formatCompactDate(skill.locations[0]?.modifiedAt)}`,
      metadata: buildMetadataRows(provenanceRows, getCanonicalSkillPath(skill), skill.locations.length),
      isLocked: hasPluginSkillLocation(skill, sourceIndex),
    },
    definition,
    locations: buildSkillLocationSections(skill, sourceIndex, agentIndex),
    problemCountLabel: formatProblemCount(problemKeys.length),
    problems: problemKeys.map((key) => ({
      key,
      label: formatSkillIssueReason(key),
      detail: getSkillProblemDetail(skill, key),
      summary: getSkillProblemSummary(skill, key),
      isActive: key === activeProblem.key,
    })),
    problemSections: buildProblemSections(problemKeys),
    activeProblem,
    selectedVariantPath,
    provenanceRows,
    provenanceSummary,
  };
}

export function buildMcpInspectorModel(
  mcp: McpRecord,
  selection: {
    selectedProblemKey?: McpIssueReason | null;
    selectedVariantPath?: string | null;
  } = {},
  agentIndex: Map<string, AgentRecord> = new Map(),
  sourceIndex: Map<string, SkillScanSource> = new Map(),
): InspectorModel {
  const problemKeys: McpIssueReason[] = mcp.issueReasons.length > 0 ? mcp.issueReasons : [];
  let activeProblem = problemKeys.length > 0
    ? buildMcpProblemModel(mcp, selectProblemKey(problemKeys, selection.selectedProblemKey), selection.selectedVariantPath, agentIndex)
    : buildHealthyMcpProblem();
  if (!selection.selectedProblemKey && shouldPreferInspectionProblem(activeProblem)) {
    const inspectionProblemKey = getInspectionRequiredProblemKey(problemKeys);
    if (inspectionProblemKey) {
      activeProblem = buildMcpProblemModel(mcp, inspectionProblemKey, selection.selectedVariantPath, agentIndex);
    }
  }
  const selectedVariantPath = getPreferredSelectedVariantPath(selection.selectedVariantPath, activeProblem);
  const referencePath = activeProblem.key === 'missing-universal'
    ? null
    : getActiveProblemBaselineVariantPath(activeProblem) ?? getMcpReferencePath(mcp);
  const provenanceRows = buildMcpProvenanceRows(mcp, selectedVariantPath, referencePath, agentIndex);
  const provenanceSummary = buildMcpProvenanceSummary(mcp, selectedVariantPath, referencePath);
  const definition = buildMcpDefinitionModel(mcp, selectedVariantPath, agentIndex);

  return {
    header: {
      title: getMcpDisplayName(mcp),
      description: formatMcpSupportingCopy(mcp),
      updatedLabel: 'Updated recently',
      metadata: buildMcpMetadataRows(provenanceRows, referencePath, mcp.locations.length),
      isLocked: hasPluginMcpLocation(mcp),
    },
    definition,
    locations: buildMcpLocationSections(mcp, agentIndex, sourceIndex),
    problemCountLabel: formatProblemCount(problemKeys.length),
    problems: problemKeys.map((key) => ({
      key,
      label: formatMcpIssueReason(key),
      detail: getMcpProblemDetail(mcp, key, agentIndex),
      summary: getMcpProblemSummary(mcp, key),
      isActive: key === activeProblem.key,
    })),
    problemSections: buildProblemSections(problemKeys),
    activeProblem,
    selectedVariantPath,
    provenanceRows,
    provenanceSummary,
  };
}

export function buildSubagentInspectorModel(
  subagent: SubagentRecord,
  selection: {
    selectedProblemKey?: SubagentIssueReason | null;
    selectedVariantPath?: string | null;
  } = {},
  agentIndex: Map<string, AgentRecord> = new Map(),
): InspectorModel {
  const problemKeys: SubagentIssueReason[] = subagent.issueReasons.length > 0 ? subagent.issueReasons : [];
  let activeProblem = problemKeys.length > 0
    ? buildSubagentProblemModel(subagent, selectProblemKey(problemKeys, selection.selectedProblemKey), selection.selectedVariantPath, agentIndex)
    : buildHealthySubagentProblem(subagent);
  if (!selection.selectedProblemKey && shouldPreferInspectionProblem(activeProblem)) {
    const inspectionProblemKey = getInspectionRequiredProblemKey(problemKeys);
    if (inspectionProblemKey) {
      activeProblem = buildSubagentProblemModel(subagent, inspectionProblemKey, selection.selectedVariantPath, agentIndex);
    }
  }
  const selectedVariantPath = getPreferredSelectedVariantPath(selection.selectedVariantPath, activeProblem);
  const referencePath = getActiveProblemBaselineVariantPath(activeProblem) ?? getCanonicalSubagentPath(subagent);
  const provenanceRows = buildSubagentProvenanceRows(subagent, selectedVariantPath, referencePath, agentIndex);
  const provenanceSummary = buildSubagentProvenanceSummary(subagent, selectedVariantPath, referencePath);
  const definition = buildSubagentDefinitionModel(subagent, selectedVariantPath);

  return {
    header: {
      title: getSubagentDisplayName(subagent),
      description: subagent.description ?? null,
      updatedLabel: `Updated ${formatCompactDate(subagent.locations[0]?.modifiedAt)}`,
      metadata: buildMcpMetadataRows(provenanceRows, referencePath, subagent.locations.length),
      isLocked: hasPluginSubagentLocation(subagent),
    },
    definition,
    locations: buildSubagentLocationSections(subagent, agentIndex),
    problemCountLabel: formatProblemCount(problemKeys.length),
    problems: problemKeys.map((key) => ({
      key,
      label: formatSubagentIssueReason(key),
      detail: getSubagentProblemDetail(subagent, key, agentIndex),
      summary: getSubagentProblemSummary(subagent, key),
      isActive: key === activeProblem.key,
    })),
    problemSections: buildProblemSections(problemKeys),
    activeProblem,
    selectedVariantPath,
    provenanceRows,
    provenanceSummary,
  };
}

function buildSkillProblemModel(
  skill: SkillRecord,
  problemKey: SkillIssueReason,
  selectedVariantPath: string | null | undefined,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): InspectorActiveProblemModel {
  switch (problemKey) {
    case 'diverged-copies':
    case 'missing-canonical':
      return buildSkillVariantProblem(skill, problemKey, selectedVariantPath, sourceIndex);
    case 'identical-copies':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatSkillIssueReason(problemKey),
        listTitle: 'Matching Copies',
        items: skill.detailDiagnostics.duplicateCandidates
          .filter((candidate) => candidate.fileType === 'real-file' && !candidate.canonical)
          .sort(compareNewestCandidate)
          .map((candidate) => ({
            id: candidate.path,
            label: formatSkillInstallSourceLabel({
              sourceId: candidate.sourceId,
              canonical: candidate.canonical,
              label: candidate.sourceLabel,
            }, sourceIndex, agentIndex),
            path: candidate.path,
        })),
        healthySummary: null,
        primaryActionLabel: SKILL_ACTION_LABELS.convertCopiesToSymlinks,
        actionSummary: buildSkillUseAsUniversalSummary(skill, problemKey, null, sourceIndex),
      };
    case 'missing-symlinks':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatSkillIssueReason(problemKey),
        listTitle: 'Missing Symlinks',
        items: (skill.detailDiagnostics.missingInstallSources ?? []).map((source) => ({
          id: source.sourceId,
          label: formatSkillInstallSourceLabel(source, sourceIndex, agentIndex),
          path: resolveMissingSymlinkPath(skill, source.sourceId, sourceIndex, agentIndex),
        })),
        healthySummary: null,
        primaryActionLabel: SKILL_ACTION_LABELS.createMissingSymlinks,
        actionSummary: buildSkillUseAsUniversalSummary(skill, problemKey, null, sourceIndex),
      };
    case 'invalid-definition': {
      const definitionTextByPath = new Map(
        skill.detailDiagnostics.duplicateCandidates
          .filter((candidate) => typeof candidate.definitionText === 'string' && candidate.definitionText.length > 0)
          .map((candidate) => [candidate.path, candidate.definitionText as string]),
      );

      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatSkillIssueReason(problemKey),
        listTitle: 'Definition Issues',
        items: (skill.detailDiagnostics.definitionIssues ?? []).map((issue) =>
          mapSkillDefinitionIssue(issue, definitionTextByPath.get(issue.path), sourceIndex, agentIndex),
        ),
        healthySummary: null,
        primaryActionLabel: null,
      };
    }
    case 'broken-symlink':
    case 'wrong-symlink-target':
      return buildSkillSymlinkRepairProblem(skill, problemKey, sourceIndex, agentIndex);
  }
}

function buildSkillSymlinkRepairProblem(
  skill: SkillRecord,
  problemKey: 'broken-symlink' | 'wrong-symlink-target',
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): StructuralRepairProblemModel {
  const affectedLocations = getAffectedSymlinkRepairLocations(skill, problemKey);

  return {
    kind: 'structural-repair',
    key: problemKey,
    title: formatSkillIssueReason(problemKey),
    listTitle: formatSkillIssueReason(problemKey),
    items: affectedLocations.map((location) => ({
      id: location.path,
      label: formatSkillInstallSourceLabel({
        sourceId: location.sourceId,
        canonical: location.canonical,
        label: location.sourceLabel,
      }, sourceIndex, agentIndex),
      path: location.path,
      detail: problemKey === 'wrong-symlink-target'
        ? getWrongSymlinkTargetPath(location)
        : undefined,
    })),
    healthySummary: null,
    primaryActionLabel: SKILL_ACTION_LABELS.repairSymlinks,
    actionSummary: buildSkillUseAsUniversalSummary(skill, problemKey, null, sourceIndex),
  };
}

function getWrongSymlinkTargetPath(location: SkillLocationRecord): string {
  return location.symlinkTarget ?? location.resolvedPath ?? 'Missing target';
}

function buildSkillUseAsUniversalSummary(
  skill: SkillRecord,
  problemKey: SkillIssueReason,
  selectedVariant: SkillVariantGroup | null,
  sourceIndex: Map<string, SkillScanSource>,
): string | null {
  const selectedLocation = selectedVariant?.representative
    ?? skill.locations.find((location) => location.canonical && location.fileType === 'real-file')
    ?? skill.locations.find((location) => location.fileType === 'real-file')
    ?? null;
  const writableUpdates = countWritableCopyUpdates(skill, problemKey, selectedLocation?.path ?? null, sourceIndex);
  const createsMissingLinks = problemKey === 'missing-symlinks';
  const missingLinks = createsMissingLinks
    ? skill.detailDiagnostics.missingInstallSources?.filter((source) => source.writable).length ?? 0
    : 0;
  const linkRepairs = problemKey === 'broken-symlink' || problemKey === 'wrong-symlink-target'
    ? getAffectedSymlinkRepairLocations(skill, problemKey).length
    : 0;
  const pluginAlternates = selectedLocation
    ? countDivergentReadOnlyPluginAlternates(skill, selectedLocation)
    : 0;

  return formatUseAsUniversalSummary({
    linkRepairs,
    missingLinks,
    pluginAlternates,
    writableUpdates,
  });
}

function countWritableCopyUpdates(
  skill: SkillRecord,
  problemKey: SkillIssueReason,
  selectedPath: string | null,
  sourceIndex: Map<string, SkillScanSource>,
): number {
  if (problemKey !== 'diverged-copies' && problemKey !== 'missing-canonical' && problemKey !== 'identical-copies') {
    return 0;
  }

  return skill.locations.filter((location) =>
    location.fileType === 'real-file'
    && location.path !== selectedPath
    && isWritableNonPluginLocation(location, sourceIndex)).length;
}

function countDivergentReadOnlyPluginAlternates(
  skill: SkillRecord,
  selectedLocation: SkillLocationRecord,
): number {
  const selectedComparisonKey = getSkillVariantLocationComparisonKey(selectedLocation);
  return skill.locations.filter((location) =>
    location.fileType === 'real-file'
    && location.provenance?.kind === 'plugin'
    && location.mutability === 'read-only-managed'
    && location.path !== selectedLocation.path
    && getSkillVariantLocationComparisonKey(location) !== selectedComparisonKey).length;
}

function isWritableNonPluginLocation(
  location: SkillLocationRecord,
  sourceIndex: Map<string, SkillScanSource>,
): boolean {
  const source = sourceIndex.get(location.sourceId);
  return source?.writable === true && source.kind !== 'plugin';
}

function formatUseAsUniversalSummary({
  linkRepairs,
  missingLinks,
  pluginAlternates,
  writableUpdates,
}: {
  linkRepairs: number;
  missingLinks: number;
  pluginAlternates: number;
  writableUpdates: number;
}): string | null {
  const actions = [
    writableUpdates > 0 ? formatWritableSymlinkReplacement(writableUpdates) : null,
    missingLinks > 0 ? `create ${missingLinks} missing ${pluralize('symlink', missingLinks)}` : null,
    linkRepairs > 0 ? `repair ${linkRepairs} ${pluralize('link', linkRepairs)}` : null,
    pluginAlternates > 0 ? `keep ${pluginAlternates} read-only plugin ${pluralize('copy', pluginAlternates)} separate` : null,
  ].filter((action): action is string => action !== null);

  if (actions.length === 0) {
    return null;
  }

  if (actions.length === 1 && writableUpdates > 0 && missingLinks === 0 && linkRepairs === 0 && pluginAlternates === 0) {
    return `This will ${formatWritableSymlinkReplacement(writableUpdates)} to the Universal version.`;
  }

  return `This will ${joinHumanList(actions)}.`;
}

function formatWritableSymlinkReplacement(count: number): string {
  return count === 1
    ? 'replace 1 writable copy with a symlink'
    : `replace ${count} writable copies with symlinks`;
}

function pluralize(word: string, count: number): string {
  if (count === 1) {
    return word;
  }

  return /[bcdfghjklmnpqrstvwxyz]y$/i.test(word)
    ? `${word.slice(0, -1)}ies`
    : `${word}s`;
}

function joinHumanList(values: string[]): string {
  if (values.length <= 2) {
    return values.join(' and ');
  }

  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function buildSkillVariantProblem(
  skill: SkillRecord,
  problemKey: SkillIssueReason,
  selectedVariantPath: string | null | undefined,
  sourceIndex: Map<string, SkillScanSource>,
): VariantResolutionProblemModel {
  const groupedVariants = groupSkillVariants(getSkillVariantCandidates(skill, problemKey, sourceIndex));
  const baselineVariant = getSkillBaselineVariant(problemKey, groupedVariants);
  const orderedVariants = orderSkillVariantsForInspector(groupedVariants, baselineVariant);
  const selectedVariant = selectSkillVariant(orderedVariants, selectedVariantPath);
  const diffInventory = buildSkillVariantDiffInventory(skill, orderedVariants, selectedVariant, baselineVariant);
  const primaryDiffFile = diffInventory.changedFiles[0] ?? null;

  return {
    kind: 'variant-resolution',
    key: problemKey,
    title: formatSkillIssueReason(problemKey),
    listTitle: 'Detected Versions',
    variants: orderedVariants.map((variant) => mapSkillVariant(variant, baselineVariant, selectedVariant)),
    changedFiles: diffInventory.changedFiles.map((file): InspectorChangedFileModel => ({
      path: file.relativePath,
      absolutePath: resolveSkillPackageDiffPath(file.relativePath, file, selectedVariant, baselineVariant),
      status: file.status as InspectorChangedFileModel['status'],
      displayKind: getInspectorChangedFileDisplayKind(file),
      hasInlineDiff: Array.isArray(file.lines) && file.lines.length > 0,
      diffLines: file.lines ?? [],
    })),
    selectedVariant: selectedVariant ? mapSkillVariant(selectedVariant, baselineVariant, selectedVariant) : null,
    baselineVariant: baselineVariant ? mapSkillVariant(baselineVariant, baselineVariant, selectedVariant) : null,
    diffTitle: DETAIL_DIFF_TITLE,
    diffLines: primaryDiffFile?.lines ?? [],
    diffPath: primaryDiffFile
      ? resolveSkillPackageDiffPath(primaryDiffFile.relativePath, primaryDiffFile, selectedVariant, baselineVariant)
      : null,
    primaryActionLabel: selectedVariant ? SKILL_ACTION_LABELS.useAsUniversal : null,
    actionSummary: buildSkillUseAsUniversalSummary(skill, problemKey, selectedVariant, sourceIndex),
  };
}

function buildMcpProblemModel(
  mcp: McpRecord,
  problemKey: McpIssueReason,
  selectedVariantPath: string | null | undefined,
  agentIndex: Map<string, AgentRecord>,
): InspectorActiveProblemModel {
  switch (problemKey) {
    case 'missing-universal':
    case 'definition-mismatch':
      return buildMcpVariantProblem(mcp, problemKey, selectedVariantPath, agentIndex);
    case 'missing-from-agents':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatMcpIssueReason(problemKey),
        listTitle: 'Affected Agents',
        items: (mcp.missingLocations ?? []).map((location) => {
          const agent = agentIndex.get(location.agentId);
          const configPath = location.configPath ?? agent?.mcpConfigLocation.path;
          const pathExists = agent && agent.mcpConfigLocation.path === configPath
            ? agent.mcpConfigLocation.exists
            : configPath ? undefined : false;
          return {
            id: `${location.agentId}:${configPath ?? 'missing'}`,
            label: formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, configPath),
            path: configPath ?? 'Missing config path',
            pathExists,
          };
        }),
        healthySummary: null,
        primaryActionLabel: MCP_ACTION_LABELS.addToAgents,
      };
    case 'invalid-definition':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatMcpIssueReason(problemKey),
        listTitle: 'Definition Issues',
        items: mcp.locations.flatMap((location) =>
          (location.invalidDetails ?? []).map((detail, index) => ({
            id: `${location.agentId}:${index}`,
            label: detail,
            path: location.configPath,
            detail: formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath),
            snippet: getMcpDefinitionIssueSnippet(location.definitionText),
          }))),
        healthySummary: null,
        primaryActionLabel: null,
      };
    case 'connection-failed':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatMcpIssueReason(problemKey),
        listTitle: 'Connection Failures',
        items: mcp.locations
          .filter((location) => location.connectivity?.status === 'failed')
          .map((location) => ({
            id: `${location.agentId}:${location.configPath}:connection`,
            label: location.connectivity?.error ?? 'Connection failed',
            path: location.configPath,
            detail: formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath),
            snippet: {
              title: 'Connection Target',
              text: summarizeMcpCommand(location),
            },
          })),
        healthySummary: null,
        primaryActionLabel: null,
      };
  }
}

function buildMcpVariantProblem(
  mcp: McpRecord,
  problemKey: 'missing-universal' | 'definition-mismatch',
  selectedVariantPath: string | null | undefined,
  agentIndex: Map<string, AgentRecord>,
): VariantResolutionProblemModel {
  const groupedVariants = groupMcpVariants(mcp.locations);
  const baselineVariant = problemKey === 'missing-universal'
    ? null
    : getMcpBaselineVariant(groupedVariants, getMcpReferencePath(mcp));
  const orderedVariants = orderMcpVariantsForInspector(groupedVariants, baselineVariant);
  const selectedVariant = selectMcpVariant(orderedVariants, selectedVariantPath, baselineVariant);
  const selectedModel = selectedVariant ? mapMcpVariant(selectedVariant, baselineVariant, selectedVariant, agentIndex) : null;
  const baselineModel = baselineVariant ? mapMcpVariant(baselineVariant, baselineVariant, selectedVariant, agentIndex) : null;
  const diffLines = selectedVariant
    ? baselineVariant
      ? buildTextDiffLines(selectedVariant.definitionText, baselineVariant.definitionText)
      : buildTextPreviewLines(selectedVariant.definitionText)
    : [];

  return {
    kind: 'variant-resolution',
    key: problemKey,
    title: formatMcpIssueReason(problemKey),
    listTitle: 'Detected Definitions',
    variants: orderedVariants.map((variant) => mapMcpVariant(variant, baselineVariant, selectedVariant, agentIndex)),
    changedFiles: [],
    selectedVariant: selectedModel,
    baselineVariant: baselineModel,
    diffTitle: baselineVariant ? MCP_DETAIL_DIFF_TITLE : 'Selected Definition Preview',
    diffLines,
    diffPath: selectedVariant?.representative.configPath ?? null,
    definitionBreakdown: selectedVariant
      ? buildMcpDefinitionBreakdown(mcp.name, selectedVariant, baselineVariant ?? selectedVariant)
      : undefined,
    primaryActionLabel: selectedVariant
      ? problemKey === 'missing-universal'
        ? MCP_ACTION_LABELS.promoteToUniversal
        : MCP_ACTION_LABELS.applySelectedDefinition
      : null,
  };
}

function buildSubagentProblemModel(
  subagent: SubagentRecord,
  problemKey: SubagentIssueReason,
  selectedVariantPath: string | null | undefined,
  agentIndex: Map<string, AgentRecord>,
): InspectorActiveProblemModel {
  switch (problemKey) {
    case 'missing-universal':
    case 'definition-mismatch':
      return buildSubagentVariantProblem(subagent, problemKey, selectedVariantPath, agentIndex);
    case 'missing-from-agents':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatSubagentIssueReason(problemKey),
        listTitle: 'Missing Agent Definitions',
        items: (subagent.missingLocations ?? []).map((location) => ({
          id: `${location.agentId}:${location.path ?? location.directoryPath ?? 'missing'}`,
          label: formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path ?? location.directoryPath),
          path: location.path ?? location.directoryPath ?? 'Missing subagent path',
          pathExists: location.path ? undefined : false,
        })),
        healthySummary: null,
        primaryActionLabel: SUBAGENT_ACTION_LABELS.addToAgents,
      };
    case 'identical-copies':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatSubagentIssueReason(problemKey),
        listTitle: 'Matching Copies',
        items: subagent.locations
          .filter((location) => location.fileType === 'real-file' && !location.canonical)
          .sort(compareSubagentLocationsForDisplay)
          .map((location) => ({
            id: location.path,
            label: formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path),
            path: location.path,
          })),
        healthySummary: null,
        primaryActionLabel: SUBAGENT_ACTION_LABELS.convertCopiesToSymlinks,
      };
    case 'invalid-definition':
      return {
        kind: 'structural-repair',
        key: problemKey,
        title: formatSubagentIssueReason(problemKey),
        listTitle: 'Definition Issues',
        items: subagent.locations.flatMap((location) =>
          (location.invalidDetails ?? []).map((detail, index) => ({
            id: `${location.path}:${index}`,
            label: detail,
            path: location.path,
            detail: formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path),
            snippet: getMcpDefinitionIssueSnippet(location.definitionText),
          }))),
        healthySummary: null,
        primaryActionLabel: null,
      };
    case 'broken-symlink':
    case 'wrong-symlink-target':
      return buildSubagentSymlinkRepairProblem(subagent, problemKey, agentIndex);
  }
}

function buildSubagentVariantProblem(
  subagent: SubagentRecord,
  problemKey: 'missing-universal' | 'definition-mismatch',
  selectedVariantPath: string | null | undefined,
  agentIndex: Map<string, AgentRecord>,
): VariantResolutionProblemModel {
  const groupedVariants = groupSubagentVariants(subagent.locations);
  const baselineVariant = problemKey === 'missing-universal'
    ? null
    : getSubagentBaselineVariant(groupedVariants, getCanonicalSubagentPath(subagent));
  const orderedVariants = orderSubagentVariantsForInspector(groupedVariants, baselineVariant);
  const selectedVariant = selectSubagentVariant(orderedVariants, selectedVariantPath, baselineVariant);
  const selectedModel = selectedVariant ? mapSubagentVariant(selectedVariant, baselineVariant, selectedVariant, agentIndex) : null;
  const baselineModel = baselineVariant ? mapSubagentVariant(baselineVariant, baselineVariant, selectedVariant, agentIndex) : null;
  const diffLines = selectedVariant
    ? baselineVariant
      ? buildTextDiffLines(selectedVariant.definitionText, baselineVariant.definitionText)
      : buildTextPreviewLines(selectedVariant.definitionText)
    : [];

  return {
    kind: 'variant-resolution',
    key: problemKey,
    title: formatSubagentIssueReason(problemKey),
    listTitle: 'Detected Definitions',
    variants: orderedVariants.map((variant) => mapSubagentVariant(variant, baselineVariant, selectedVariant, agentIndex)),
    changedFiles: [],
    selectedVariant: selectedModel,
    baselineVariant: baselineModel,
    diffTitle: baselineVariant ? 'Diff: Selected Definition vs Universal' : 'Selected Definition Preview',
    diffLines,
    diffPath: selectedVariant?.representative.path ?? null,
    primaryActionLabel: selectedVariant
      ? problemKey === 'missing-universal'
        ? SUBAGENT_ACTION_LABELS.addToUniversal
        : SUBAGENT_ACTION_LABELS.applySelectedDefinition
      : null,
  };
}

function buildSubagentSymlinkRepairProblem(
  subagent: SubagentRecord,
  problemKey: 'broken-symlink' | 'wrong-symlink-target',
  agentIndex: Map<string, AgentRecord>,
): StructuralRepairProblemModel {
  const affectedLocations = getAffectedSubagentSymlinkRepairLocations(subagent, problemKey);

  return {
    kind: 'structural-repair',
    key: problemKey,
    title: formatSubagentIssueReason(problemKey),
    listTitle: formatSubagentIssueReason(problemKey),
    items: affectedLocations.map((location) => ({
      id: location.path,
      label: formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path),
      path: location.path,
      detail: problemKey === 'wrong-symlink-target'
        ? getWrongSubagentSymlinkTargetPath(location)
        : undefined,
    })),
    healthySummary: null,
    primaryActionLabel: SUBAGENT_ACTION_LABELS.repairSymlinks,
  };
}

function buildHealthySkillProblem(skill: SkillRecord): StructuralRepairProblemModel {
  return {
    kind: 'structural-repair',
    key: 'missing-symlinks',
    title: 'Healthy',
    listTitle: 'Locations',
    items: skill.locations.map((location) => ({
      id: location.path,
      label: location.sourceLabel,
      path: location.path,
      detail: location.fileType === 'symlink' ? 'Symlink' : formatAgeLabel(location.modifiedAt),
    })),
    healthySummary: 'This skill is canonical and fully linked.',
    primaryActionLabel: null,
  };
}

function buildHealthyMcpProblem(): StructuralRepairProblemModel {
  return {
    kind: 'structural-repair',
    key: 'missing-from-agents',
    title: 'Healthy',
    listTitle: 'Locations',
    items: [],
    healthySummary: 'Defined in every agent the exact same way.',
    primaryActionLabel: null,
  };
}

function buildHealthySubagentProblem(subagent: SubagentRecord): StructuralRepairProblemModel {
  return {
    kind: 'structural-repair',
    key: 'missing-from-agents',
    title: 'Healthy',
    listTitle: 'Locations',
    items: subagent.locations.map((location) => ({
      id: location.path,
      label: location.canonical
        ? 'Universal'
        : location.agentLabel,
      path: location.path,
      detail: location.fileType === 'symlink' ? 'Symlink' : formatAgeLabel(location.modifiedAt),
    })),
    healthySummary: 'Defined in Universal and every supported agent location.',
    primaryActionLabel: null,
  };
}

function buildSkillDefinitionModel(
  skill: SkillRecord,
  selectedVariantPath: string | null,
  sourceIndex: Map<string, SkillScanSource>,
): InspectorDefinitionModel {
  const groupedVariants = groupSkillVariants(getSkillDefinitionCandidates(skill, sourceIndex));
  const baselineVariant = getSkillBaselineVariant('diverged-copies', groupedVariants);
  const orderedVariants = orderSkillVariantsForInspector(groupedVariants, baselineVariant);
  const selectedVariant = selectSkillVariant(orderedVariants, selectedVariantPath);

  return {
    listTitle: 'Detected Versions',
    variants: orderedVariants.map((variant) => mapSkillVariant(variant, baselineVariant, selectedVariant)),
    selectedVariant: selectedVariant ? mapSkillVariant(selectedVariant, baselineVariant, selectedVariant) : null,
    selectedVariantPath: selectedVariant?.representative.path ?? null,
    files: buildSkillDefinitionFiles(selectedVariant),
    emptySummary: 'No readable definition files were found for this skill.',
  };
}

function buildMcpDefinitionModel(
  mcp: McpRecord,
  selectedVariantPath: string | null,
  agentIndex: Map<string, AgentRecord>,
): InspectorDefinitionModel {
  const groupedVariants = groupMcpVariants(mcp.locations);
  const baselineVariant = getMcpBaselineVariant(groupedVariants, getMcpReferencePath(mcp));
  const orderedVariants = orderMcpVariantsForInspector(groupedVariants, baselineVariant);
  const selectedVariant = selectMcpVariant(orderedVariants, selectedVariantPath, baselineVariant);

  return {
    listTitle: 'Detected Definitions',
    variants: orderedVariants.map((variant) => mapMcpVariant(variant, baselineVariant, selectedVariant, agentIndex)),
    selectedVariant: selectedVariant ? mapMcpVariant(selectedVariant, baselineVariant, selectedVariant, agentIndex) : null,
    selectedVariantPath: selectedVariant?.representative.configPath ?? null,
    files: buildMcpDefinitionFiles(mcp, selectedVariant, agentIndex),
    emptySummary: 'No readable definition was found for this MCP.',
  };
}

function buildSubagentDefinitionModel(
  subagent: SubagentRecord,
  selectedVariantPath: string | null,
): InspectorDefinitionModel {
  const groupedVariants = groupSubagentVariants(subagent.locations);
  const baselineVariant = getSubagentBaselineVariant(groupedVariants, getCanonicalSubagentPath(subagent));
  const orderedVariants = orderSubagentVariantsForInspector(groupedVariants, baselineVariant);
  const selectedVariant = selectSubagentVariant(orderedVariants, selectedVariantPath, baselineVariant);

  return {
    listTitle: 'Detected Definitions',
    variants: orderedVariants.map((variant) => mapSubagentVariant(variant, baselineVariant, selectedVariant, new Map())),
    selectedVariant: selectedVariant ? mapSubagentVariant(selectedVariant, baselineVariant, selectedVariant, new Map()) : null,
    selectedVariantPath: selectedVariant?.representative.path ?? null,
    files: buildSubagentDefinitionFiles(selectedVariant),
    emptySummary: 'No readable definition was found for this subagent.',
  };
}

function getSkillDefinitionCandidates(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
): SkillDuplicateCandidate[] {
  const locationsByPath = new Map(skill.locations.map((location) => [location.path, location]));
  const sourceCandidates = skill.detailDiagnostics.duplicateCandidates.length > 0
    ? skill.detailDiagnostics.duplicateCandidates
    : skill.locations.map((location) => ({
        ...location,
        installSource: buildInstallSourceFromLocation(location, sourceIndex),
      }));

  return sourceCandidates.map((candidate) => {
    const location = locationsByPath.get(candidate.path);
    return {
      ...candidate,
      definitionText: candidate.definitionText ?? location?.definitionText,
      packageFiles: candidate.packageFiles ?? location?.packageFiles,
    };
  });
}

function buildSkillDefinitionFiles(
  selectedVariant: SkillVariantGroup | null,
): InspectorDefinitionFileModel[] {
  if (!selectedVariant) {
    return [];
  }

  const representative = selectedVariant.representative;
  const packageFiles = representative.packageFiles ?? [];
  const definitionRootPath = getSkillDefinitionFileRootPath(representative);
  if (packageFiles.length > 0) {
    const filesByPath = new Map(packageFiles.map((file) => [file.relativePath, file]));
    return ensureEntrypointFirst([...filesByPath.keys()]).flatMap((relativePath) => {
      const file = filesByPath.get(relativePath);
      if (!file) {
        return [];
      }

      return [{
        relativePath,
        absolutePath: joinInspectorPath(definitionRootPath, relativePath),
        kind: file.kind,
        text: file.kind === 'text' ? file.text ?? '' : null,
      }];
    });
  }

  const definitionText = normalizeDefinitionText(selectedVariant.definitionText);
  return definitionText
    ? [{
        relativePath: 'SKILL.md',
        absolutePath: joinInspectorPath(definitionRootPath, 'SKILL.md'),
        kind: 'text',
        text: definitionText,
      }]
    : [];
}

function getSkillDefinitionFileRootPath(location: SkillDuplicateCandidate): string {
  return location.fileType === 'symlink' && location.resolvedPath
    ? location.resolvedPath
    : location.path;
}

function buildMcpDefinitionFiles(
  mcp: McpRecord,
  selectedVariant: McpVariantGroup | null,
  agentIndex: Map<string, AgentRecord>,
): InspectorDefinitionFileModel[] {
  if (!selectedVariant) {
    return [];
  }

  const location = selectedVariant.representative;
  const text = buildMcpNormalizedDefinitionText(mcp.name, location);
  const definitionLabel = formatMcpDefinitionFileLabel(selectedVariant, agentIndex);

  return text.length > 0
    ? [{
        relativePath: definitionLabel,
        absolutePath: location.configPath,
        displayPath: definitionLabel,
        openPath: null,
        kind: 'text',
        text,
      }]
    : [];
}

function formatMcpDefinitionFileLabel(
  variant: McpVariantGroup,
  agentIndex: Map<string, AgentRecord>,
): string {
  const labels = variant.locations.map((location) =>
    formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath));
  return summarizeMcpVariantLocationLabels(labels);
}

function buildSubagentDefinitionFiles(
  selectedVariant: SubagentVariantGroup | null,
): InspectorDefinitionFileModel[] {
  if (!selectedVariant) {
    return [];
  }

  const location = selectedVariant.representative;
  const definitionText = normalizeDefinitionText(location.definitionText);

  return definitionText
    ? [{
        relativePath: getPathBasename(location.path),
        absolutePath: location.path,
        kind: 'text',
        text: definitionText,
      }]
    : [];
}

function getSkillProblemKeys(skill: SkillRecord): SkillIssueReason[] {
  const keys = [...getDisplaySkillIssueReasons(skill)];
  if ((skill.detailDiagnostics.definitionIssues?.length ?? 0) > 0 && !keys.includes('invalid-definition')) {
    keys.push('invalid-definition');
  }
  return keys;
}

function getSkillProblemSummary(skill: SkillRecord, key: SkillIssueReason): string {
  switch (key) {
    case 'diverged-copies': {
      const groupedCount = groupSkillVariants(skill.detailDiagnostics.duplicateCandidates).length;
      const count = groupedCount || skill.locations.filter((location) => location.fileType === 'real-file').length;
      return `${count} version${count === 1 ? '' : 's'}`;
    }
    case 'missing-canonical':
      return '1 issue';
    case 'identical-copies': {
      const count = skill.detailDiagnostics.duplicateCandidates.filter((candidate) => candidate.fileType === 'real-file' && !candidate.canonical).length;
      return `${count} cop${count === 1 ? 'y' : 'ies'}`;
    }
    case 'missing-symlinks': {
      const count = skill.detailDiagnostics.missingInstallSources?.length ?? 0;
      return `${count} issue${count === 1 ? '' : 's'}`;
    }
    case 'invalid-definition': {
      const count = skill.detailDiagnostics.definitionIssues?.length ?? 0;
      return `${count} issue${count === 1 ? '' : 's'}`;
    }
    case 'broken-symlink':
    case 'wrong-symlink-target': {
      const count = getAffectedSymlinkRepairLocations(skill, key).length;
      return `${count} issue${count === 1 ? '' : 's'}`;
    }
  }
}

function getSkillProblemDetail(_skill: SkillRecord, key: SkillIssueReason): string {
  switch (key) {
    case 'diverged-copies':
      return 'Choose the version local installs should use as Universal';
    case 'missing-canonical':
      return 'Choose the version local installs should use as Universal';
    case 'identical-copies':
      return 'Convert copies to symlinks';
    case 'missing-symlinks':
      return 'One or more symlinks are missing';
    case 'invalid-definition':
      return 'One or more issues with front matter';
    case 'broken-symlink':
      return 'One or more symlinks need repair';
    case 'wrong-symlink-target':
      return 'One or more symlinks point somewhere other than universal';
  }
}

function getAffectedSymlinkRepairLocations(
  skill: SkillRecord,
  problemKey: 'broken-symlink' | 'wrong-symlink-target',
): SkillLocationRecord[] {
  return skill.locations.filter((location) => {
    if (location.canonical || location.fileType !== 'symlink') {
      return false;
    }

    if (problemKey === 'broken-symlink') {
      return !location.resolvedPath;
    }

    const canonicalPath = getCanonicalSkillPath(skill);
    if (!canonicalPath) {
      return Boolean(location.symlinkTarget || location.resolvedPath);
    }

    return location.resolvedPath !== canonicalPath && location.symlinkTarget !== canonicalPath;
  });
}

function getMcpProblemSummary(mcp: McpRecord, key: McpIssueReason): string {
  switch (key) {
    case 'missing-universal':
      return '1 issue';
    case 'definition-mismatch': {
      const count = groupMcpVariants(mcp.locations).length;
      return `${count} definition${count === 1 ? '' : 's'}`;
    }
    case 'missing-from-agents': {
      const count = mcp.missingLocations?.length ?? 0;
      return `${count} agent${count === 1 ? '' : 's'}`;
    }
    case 'invalid-definition': {
      const count = mcp.locations.reduce((total, location) => total + (location.invalidDetails?.length ?? 0), 0);
      return `${count} issue${count === 1 ? '' : 's'}`;
    }
    case 'connection-failed': {
      const count = mcp.locations.filter((location) => location.connectivity?.status === 'failed').length;
      return `${count} failed`;
    }
  }
}

function getMcpProblemDetail(mcp: McpRecord, key: McpIssueReason, agentIndex: Map<string, AgentRecord>): string {
  switch (key) {
    case 'missing-universal':
      return 'Choose the definition to add to Universal';
    case 'definition-mismatch':
      return summarizeDefinitionMismatch(mcp, agentIndex);
    case 'missing-from-agents': {
      const count = mcp.missingLocations?.length ?? 0;
      return `${count} agent${count === 1 ? '' : 's'} need this definition`;
    }
    case 'invalid-definition':
      return 'One or more detected definitions are invalid';
    case 'connection-failed': {
      const count = mcp.locations.filter((location) => location.connectivity?.status === 'failed').length;
      return `${count} MCP connection${count === 1 ? '' : 's'} failed during verification`;
    }
  }
}

function getSubagentProblemSummary(subagent: SubagentRecord, key: SubagentIssueReason): string {
  switch (key) {
    case 'missing-universal':
      return '1 issue';
    case 'missing-from-agents': {
      const count = subagent.missingLocations?.length ?? 0;
      return `${count} agent${count === 1 ? '' : 's'}`;
    }
    case 'definition-mismatch': {
      const count = groupSubagentVariants(subagent.locations).length;
      return `${count} definition${count === 1 ? '' : 's'}`;
    }
    case 'identical-copies': {
      const count = subagent.locations.filter((location) => location.fileType === 'real-file' && !location.canonical).length;
      return `${count} cop${count === 1 ? 'y' : 'ies'}`;
    }
    case 'invalid-definition': {
      const count = subagent.locations.reduce((total, location) => total + (location.invalidDetails?.length ?? 0), 0);
      return `${count} issue${count === 1 ? '' : 's'}`;
    }
    case 'broken-symlink':
    case 'wrong-symlink-target': {
      const count = getAffectedSubagentSymlinkRepairLocations(subagent, key).length;
      return `${count} issue${count === 1 ? '' : 's'}`;
    }
  }
}

function getSubagentProblemDetail(
  subagent: SubagentRecord,
  key: SubagentIssueReason,
  agentIndex: Map<string, AgentRecord>,
): string {
  switch (key) {
    case 'missing-universal':
      return 'Choose the definition to add to Universal';
    case 'missing-from-agents': {
      const count = subagent.missingLocations?.length ?? 0;
      return `${count} agent${count === 1 ? '' : 's'} need this subagent`;
    }
    case 'definition-mismatch':
      return summarizeSubagentDefinitionMismatch(subagent, agentIndex);
    case 'identical-copies':
      return 'Convert matching Markdown copies to symlinks';
    case 'invalid-definition':
      return 'One or more detected definitions are invalid';
    case 'broken-symlink':
      return 'One or more symlinks need repair';
    case 'wrong-symlink-target':
      return 'One or more symlinks point somewhere other than Universal';
  }
}

function summarizeSubagentDefinitionMismatch(subagent: SubagentRecord, agentIndex: Map<string, AgentRecord>): string {
  const labels = subagent.locations.map((location) =>
    formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path));
  if (labels.length === 0) {
    return 'Detected definitions differ across agents';
  }

  const compactLabels = labels.length > 3
    ? [...labels.slice(0, 3), `${labels.length - 3} more`]
    : labels;

  return `Definitions differ across ${compactLabels.join(', ')}`;
}

function summarizeDefinitionMismatch(mcp: McpRecord, agentIndex: Map<string, AgentRecord>): string {
  const labels = mcp.locations.map((location) =>
    formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath));
  if (labels.length === 0) {
    return 'Detected definitions differ across agents';
  }

  const compactLabels = labels.length > 3
    ? [...labels.slice(0, 3), `${labels.length - 3} more`]
    : labels;

  return `Definitions differ across ${compactLabels.join(', ')}`;
}

function mapSkillDefinitionIssue(
  issue: SkillDefinitionIssue,
  definitionText: string | undefined,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): InspectorStructuralItem {
  const label = formatSkillDefinitionIssueLabel(issue);
  return {
    id: `${issue.path}:${issue.type}:${issue.field ?? 'detail'}`,
    label,
    path: issue.entrypointPath ?? issue.path,
    detail: formatSkillInstallSourceLabel(issue.installSource, sourceIndex, agentIndex, issue.sourceLabel),
    snippet: getSkillDefinitionIssueSnippet(definitionText),
  };
}

function formatSkillDefinitionIssueLabel(issue: SkillDefinitionIssue): string {
  if (issue.type === 'missing-required-field' && issue.field) {
    return `Missing required field: ${issue.field}`;
  }

  if (issue.type === 'invalid-field-value' && issue.detail) {
    return issue.detail;
  }

  return formatSkillIssueReason('invalid-definition');
}

function formatSkillInstallSourceLabel(
  source: Pick<SkillDefinitionIssue['installSource'], 'sourceId' | 'canonical' | 'label'>,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
  fallbackLabel?: string,
): string {
  if (source.canonical) {
    return 'Universal';
  }

  if (isSharedAgentsSkillSource(source.sourceId, source.label, sourceIndex)) {
    return 'Universal';
  }

  const agentLabel = resolveSkillInstallAgent(source.sourceId, sourceIndex, agentIndex)?.label ?? null;
  if (agentLabel) {
    return agentLabel;
  }

  return stripScopePrefix(fallbackLabel ?? source.label);
}

function isSharedAgentsSkillSource(
  sourceId: string,
  label: string,
  sourceIndex: Map<string, SkillScanSource>,
): boolean {
  const source = sourceIndex.get(sourceId);
  return (source?.kind === 'canonical' && isAgentsPath(source.skillsDir))
    || stripScopePrefix(label) === '.agents';
}

function formatMcpAgentLabel(
  agentId: string,
  agentIndex: Map<string, AgentRecord>,
  fallbackLabel: string,
  configPath?: string,
): string {
  const agent = agentIndex.get(agentId);
  if (configPath && isAgentsMcpConfigPath(configPath)) {
    return 'Universal';
  }

  return agent?.label ?? stripScopePrefix(fallbackLabel);
}

function formatSubagentAgentLabel(
  agentId: string,
  agentIndex: Map<string, AgentRecord>,
  fallbackLabel: string,
  path?: string,
): string {
  const agent = agentIndex.get(agentId);
  if (path && isAgentsPath(path)) {
    return 'Universal';
  }

  return agent?.label ?? stripScopePrefix(fallbackLabel);
}

function getSkillDefinitionIssueSnippet(definitionText?: string): InspectorStructuralItem['snippet'] | undefined {
  if (typeof definitionText !== 'string' || definitionText.length === 0) {
    return undefined;
  }

  const normalizedDefinition = definitionText.startsWith('\uFEFF') ? definitionText.slice(1) : definitionText;
  const lines = normalizedDefinition.split(/\r?\n/);

  if (lines.length === 0) {
    return undefined;
  }

  if (lines[0] === '---') {
    const closingIndex = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
    const snippetLines = closingIndex >= 0
      ? lines.slice(0, closingIndex + 1)
      : lines.slice(0, Math.min(lines.length, 12));

    return {
      title: closingIndex >= 0 ? 'Frontmatter' : 'Frontmatter Excerpt',
      text: snippetLines.join('\n').trim(),
    };
  }

  return {
    title: 'Definition Excerpt',
    text: lines.slice(0, Math.min(lines.length, 12)).join('\n').trim(),
  };
}

function getMcpDefinitionIssueSnippet(definitionText?: string): InspectorStructuralItem['snippet'] | undefined {
  if (typeof definitionText !== 'string' || definitionText.length === 0) {
    return undefined;
  }

  const normalizedDefinition = definitionText.startsWith('\uFEFF') ? definitionText.slice(1) : definitionText;
  const lines = normalizedDefinition.split(/\r?\n/);

  if (lines.length === 0) {
    return undefined;
  }

  return {
    title: 'Definition Excerpt',
    text: lines.slice(0, Math.min(lines.length, 12)).join('\n').trim(),
  };
}

function buildSkillLocationSections(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): InspectorLocationSectionModel[] {
  const canonicalRows = getSkillUniversalDirectoryRows(skill, sourceIndex, agentIndex);
  const pluginRows = getSkillPluginPathRows(skill, sourceIndex);
  const sections: InspectorLocationSectionModel[] = [
    {
      id: 'universal',
      title: 'Universal Directory',
      rows: canonicalRows,
    },
    {
      id: 'plugin-paths',
      title: 'Plugin Paths',
      rows: pluginRows,
    },
    {
      id: 'installed-paths',
      title: 'Installed Paths',
      rows: [
        ...getSkillInstallSources(skill, sourceIndex, agentIndex)
          .map((source) => {
            const location = skill.locations.find((entry) => entry.sourceId === source.sourceId && !entry.canonical)
              ?? skill.locations.find((entry) => entry.sourceId === source.sourceId)
              ?? null;
            const issue = getSkillLocationIssueState(skill, source, location);

            return {
              id: source.sourceId,
              label: formatSkillInstallSourceLabel(source, sourceIndex, agentIndex),
              path: location?.path ?? null,
              pathText: location?.path ?? 'not installed',
              statusLabel: issue.statusLabel,
              tone: issue.tone,
            };
          }),
        ...getAccountManagedSkillAgentRows(skill, agentIndex),
      ]
        .sort(compareInspectorLocationRowsByLabel),
    },
  ];

  return sections.filter((section) => section.rows.length > 0 || section.id === 'universal');
}

function getAccountManagedSkillAgentRows(
  skill: SkillRecord,
  agentIndex: Map<string, AgentRecord>,
): InspectorLocationRow[] {
  const scopes = new Set(skill.locations.map((location) => location.sourceScope));

  return [...agentIndex.values()]
    .filter((agent) =>
      agent.installState === 'installed'
      && agent.skillsLocation.reason === 'account-managed'
      && (scopes.size === 0 || scopes.has(agent.scope)))
    .map((agent) => ({
      id: `${agent.id}:account-managed-skills`,
      label: agent.label,
      path: null,
      pathText: 'Local files not supported',
      tone: 'muted',
    }));
}

function compareInspectorLocationRowsByLabel(left: InspectorLocationRow, right: InspectorLocationRow): number {
  return (left.label ?? '').localeCompare(right.label ?? '', undefined, { sensitivity: 'base' })
    || left.pathText.localeCompare(right.pathText);
}

function getSkillUniversalDirectoryRows(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): InspectorLocationRow[] {
  const agentsLocations = skill.locations.filter((location) => isAgentsPath(location.path));
  const explicitCanonicalLocations = skill.locations.filter((location) =>
    location.canonical && !isSkillPluginLocation(location, sourceIndex));
  const universalLocations = [
    ...explicitCanonicalLocations.filter((location) => !isAgentsPath(location.path)),
    ...agentsLocations,
  ];
  if (universalLocations.length > 0) {
    return universalLocations.map((location) =>
      mapSkillLocationRow(skill, location, universalLocations.length > 1 ? formatUniversalLocationLabel(location, sourceIndex) : null, sourceIndex));
  }

  const sourceScopes = new Set(skill.locations.map((location) => location.sourceScope));
  const universalSource = [...sourceIndex.values()].find((source) =>
    source.writable && sourceScopes.has(source.scope) && isAgentsPath(source.skillsDir));
  const expectedPath = universalSource
    ? resolveMissingSymlinkPath(skill, universalSource.id, sourceIndex, agentIndex)
    : null;

  return [{
    id: universalSource?.id ?? expectedPath ?? 'missing-universal',
    label: null,
    path: expectedPath,
    pathText: expectedPath ?? 'Not found',
    statusLabel: 'Missing Universal',
    tone: 'muted',
  }];
}

function getSkillPluginPathRows(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
): InspectorLocationRow[] {
  return skill.locations
    .filter((location) => isSkillPluginLocation(location, sourceIndex))
    .map((location) => mapSkillLocationRow(skill, location, stripScopePrefix(location.sourceLabel), sourceIndex));
}

function formatUniversalLocationLabel(
  location: SkillLocationRecord,
  sourceIndex: Map<string, SkillScanSource>,
): string {
  const source = sourceIndex.get(location.sourceId);
  if (source?.preferredCanonical) {
    return 'Preferred canonical';
  }

  return stripScopePrefix(location.sourceLabel);
}

function mapSkillLocationRow(
  skill: SkillRecord,
  location: SkillLocationRecord,
  label: string | null,
  sourceIndex: Map<string, SkillScanSource>,
): InspectorLocationRow {
  const issue = getSkillLocationIssueState(skill, getSkillInstallSourceForLocation(location, sourceIndex), location);

  return {
    id: location.path,
    label,
    path: location.path,
    pathText: location.path,
    statusLabel: issue.statusLabel,
    tone: issue.tone,
    action: getSkillLocationAction(skill, location),
  };
}

function getSkillLocationAction(
  skill: SkillRecord,
  location: SkillLocationRecord,
): InspectorLocationAction | undefined {
  if (location.fileType !== 'real-file' || !isAcceptedSkillAlternate(skill, location)) {
    return undefined;
  }

  return {
    kind: 'choose-skill-universal-version',
    label: 'Make Universal',
    path: location.path,
  };
}

function getSkillInstallSourceForLocation(
  location: SkillLocationRecord,
  sourceIndex: Map<string, SkillScanSource>,
): SkillInstallSource {
  const source = sourceIndex.get(location.sourceId);
  return {
    sourceId: location.sourceId,
    label: location.sourceLabel,
    kind: source?.kind ?? 'custom',
    scope: location.sourceScope,
    writable: source?.writable ?? false,
    canonical: location.canonical,
  };
}

function getSkillInstallSources(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): SkillInstallSource[] {
  const byId = new Map<string, SkillInstallSource>();

  for (const source of skill.detailDiagnostics.installSources) {
    if (shouldShowSkillInstalledPathSource(skill, source, sourceIndex)) {
      byId.set(source.sourceId, source);
    }
  }

  for (const source of skill.detailDiagnostics.missingInstallSources ?? []) {
    if (shouldShowSkillInstalledPathSource(skill, source, sourceIndex) && !byId.has(source.sourceId)) {
      byId.set(source.sourceId, source);
    }
  }

  for (const source of getVisibleAgentInstallSources(skill, sourceIndex, agentIndex)) {
    if (shouldShowSkillInstalledPathSource(skill, source, sourceIndex) && !byId.has(source.sourceId)) {
      byId.set(source.sourceId, source);
    }
  }

  return [...byId.values()];
}

function getVisibleAgentInstallSources(
  skill: SkillRecord,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): SkillInstallSource[] {
  const scopes = new Set(skill.locations.map((location) => location.sourceScope));
  const sources: SkillInstallSource[] = [];

  for (const agent of agentIndex.values()) {
    if (
      agent.installState !== 'installed'
      || agent.skillsLocation.state !== 'available'
      || !agent.skillsLocation.path
      || isAgentsPath(agent.skillsLocation.path)
      || (scopes.size > 0 && !scopes.has(agent.scope))
    ) {
      continue;
    }

    const scanSource = findVisibleAgentScanSource(agent, sourceIndex);
    sources.push(scanSource ? createInstallSourceFromScanSource(scanSource) : createInstallSourceFromAgent(agent));
  }

  return sources;
}

function findVisibleAgentScanSource(
  agent: AgentRecord,
  sourceIndex: Map<string, SkillScanSource>,
): SkillScanSource | null {
  const directSource = sourceIndex.get(agent.id);
  if (directSource?.kind === 'agent') {
    return directSource;
  }

  const normalizedSkillsPath = normalizeLocationPath(agent.skillsLocation.path ?? '');
  return [...sourceIndex.values()].find((source) =>
    source.kind === 'agent'
    && source.scope === agent.scope
    && normalizeLocationPath(source.skillsDir) === normalizedSkillsPath
    && (
      source.compatibleAgentFamilies === undefined
      || source.compatibleAgentFamilies.length === 0
      || source.compatibleAgentFamilies.includes(agent.family)
    )) ?? null;
}

function createInstallSourceFromScanSource(source: SkillScanSource): SkillInstallSource {
  return {
    sourceId: source.id,
    label: source.label,
    kind: source.kind,
    scope: source.scope,
    writable: source.writable,
    canonical: source.canonical,
  };
}

function createInstallSourceFromAgent(agent: AgentRecord): SkillInstallSource {
  return {
    sourceId: agent.id,
    label: agent.label,
    kind: 'agent',
    scope: agent.scope,
    writable: agent.writable,
    canonical: false,
  };
}

function shouldShowSkillInstalledPathSource(
  skill: SkillRecord,
  source: SkillInstallSource,
  sourceIndex: Map<string, SkillScanSource>,
): boolean {
  if (source.canonical) {
    return false;
  }

  const scanSource = sourceIndex.get(source.sourceId);
  if (scanSource?.canonical || scanSource?.kind === 'plugin' || isAgentsPath(scanSource?.skillsDir)) {
    return false;
  }

  if (source.kind === 'plugin') {
    return false;
  }

  const location = skill.locations.find((entry) => entry.sourceId === source.sourceId) ?? null;
  if (!location) {
    return true;
  }

  return !isAgentsPath(location.path) && !isSkillPluginLocation(location, sourceIndex);
}

function isSkillPluginLocation(
  location: SkillLocationRecord,
  sourceIndex: Map<string, SkillScanSource>,
): boolean {
  return location.provenance?.kind === 'plugin' || sourceIndex.get(location.sourceId)?.kind === 'plugin';
}

function getSkillLocationIssueState(
  skill: SkillRecord,
  source: SkillInstallSource,
  location: SkillLocationRecord | null,
): { statusLabel?: string; tone: InspectorLocationTone } {
  const hasDefinitionIssue = skill.detailDiagnostics.definitionIssues?.some((issue) => issue.sourceId === source.sourceId) ?? false;
  if (hasDefinitionIssue) {
    return { statusLabel: 'Invalid Definition', tone: 'danger' };
  }

  if (!location) {
    return { statusLabel: 'Not installed', tone: 'muted' };
  }

  if (location.fileType === 'symlink') {
    if (
      skill.issueReasons?.includes('broken-symlink')
      && !location.resolvedPath
    ) {
      return { statusLabel: 'Broken Symlink', tone: 'danger' };
    }

    if (
      skill.issueReasons?.includes('wrong-symlink-target')
      && isWrongSkillSymlinkTarget(skill, location)
    ) {
      return { statusLabel: 'Wrong Target', tone: 'warning' };
    }

    return { statusLabel: 'symlink', tone: 'healthy' };
  }

  if (isAcceptedSkillAlternate(skill, location)) {
    return {
      statusLabel: 'Accepted Alternate',
      tone: 'healthy',
    };
  }

  if (!location.canonical && skill.issueReasons?.includes('diverged-copies')) {
    return { statusLabel: 'Diverged Copy', tone: 'warning' };
  }

  if (!location.canonical && skill.issueReasons?.includes('identical-copies')) {
    return { statusLabel: 'Identical Copy', tone: 'warning' };
  }

  return { tone: 'healthy' };
}

function isWrongSkillSymlinkTarget(skill: SkillRecord, location: SkillLocationRecord): boolean {
  const canonicalPath = getCanonicalSkillPath(skill);
  if (!canonicalPath) {
    return Boolean(location.symlinkTarget || location.resolvedPath);
  }

  return location.resolvedPath !== canonicalPath && location.symlinkTarget !== canonicalPath;
}

function isAcceptedSkillAlternate(skill: SkillRecord, location: SkillLocationRecord): boolean {
  return (skill.detailDiagnostics.acceptedAlternates ?? []).some((alternate) =>
    skillLocationMatchesAcceptedAlternate(location, alternate));
}

function skillLocationMatchesAcceptedAlternate(
  location: SkillLocationRecord,
  alternate: SkillUniversalAlternate,
): boolean {
  if (alternate.kind === 'path') {
    return alternate.path !== undefined && normalizeLocationPath(location.path) === normalizeLocationPath(alternate.path);
  }

  const plugin = location.provenance?.plugin;
  return plugin !== undefined
    && plugin.host === alternate.host
    && plugin.pluginId === alternate.pluginId
    && (alternate.pluginVersion === undefined || plugin.version === alternate.pluginVersion)
    && getPathBasename(location.path) === alternate.pluginSkillName;
}

function normalizeLocationPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '');
}

function getPathBasename(value: string): string {
  return normalizeLocationPath(value).split('/').pop() ?? value;
}

function buildMcpLocationSections(
  mcp: McpRecord,
  agentIndex: Map<string, AgentRecord>,
  sourceIndex: Map<string, SkillScanSource>,
): InspectorLocationSectionModel[] {
  const referencePath = getMcpReferencePath(mcp);
  const referenceLocation = referencePath
    ? mcp.locations.find((location) => location.configPath === referencePath) ?? null
    : null;
  const agentEntries = getMcpAgentEntries(mcp, agentIndex);
  const universalRows = getMcpUniversalFileRows(mcp, referenceLocation, sourceIndex);
  const pluginRows = agentEntries
    .filter((entry) => entry.location?.provenance?.kind === 'plugin')
    .map((entry) => mapMcpLocationEntryRow(mcp, referenceLocation, entry))
    .sort(compareInspectorLocationRowsByLabel);
  const installedRows = agentEntries
    .filter((entry) => !entry.path || !isAgentsMcpConfigPath(entry.path))
    .filter((entry) => entry.location?.provenance?.kind !== 'plugin')
    .map((entry) => mapMcpLocationEntryRow(mcp, referenceLocation, entry))
    .sort(compareInspectorLocationRowsByLabel);

  return [
    {
      id: 'universal',
      title: 'Universal File',
      rows: universalRows,
    },
    {
      id: 'plugin-paths',
      title: 'Plugin Paths',
      rows: pluginRows,
    },
    {
      id: 'installed-paths',
      title: 'Installed Paths',
      rows: installedRows,
    },
  ].filter((section) => section.rows.length > 0 || section.id === 'universal');
}

function getMcpUniversalFileRows(
  mcp: McpRecord,
  referenceLocation: McpLocationRecord | null,
  sourceIndex: Map<string, SkillScanSource>,
): InspectorLocationRow[] {
  const universalLocations = mcp.locations.filter(isUniversalMcpLocation);
  if (universalLocations.length > 0) {
    return universalLocations.map((location) => mapMcpLocationEntryRow(mcp, referenceLocation, {
      agentId: location.agentId,
      label: universalLocations.length > 1 ? formatUniversalMcpLocationLabel(location) : null,
      path: location.configPath,
      location,
    }));
  }

  const expectedPath = getExpectedUniversalMcpConfigPath(mcp, sourceIndex);

  return [{
    id: expectedPath ?? 'missing-universal-mcp',
    label: null,
    path: expectedPath,
    pathText: expectedPath ?? 'Not found',
    statusLabel: 'Missing Universal',
    tone: 'muted',
  }];
}

function getExpectedUniversalMcpConfigPath(
  mcp: McpRecord,
  sourceIndex: Map<string, SkillScanSource>,
): string | null {
  const scopes = new Set([
    ...mcp.locations.map((location) => location.scope),
    ...(mcp.expectedLocations ?? []).map((location) => location.scope),
    ...(mcp.missingLocations ?? []).map((location) => location.scope),
  ]);
  const universalSource = [...sourceIndex.values()].find((source) =>
    source.canonical && source.writable && scopes.has(source.scope) && isAgentsSkillsPath(source.skillsDir));

  return universalSource ? joinInspectorPath(getPathDirname(universalSource.skillsDir), 'mcp.json') : null;
}

function getPathDirname(value: string): string {
  const normalized = normalizeLocationPath(value);
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalized;
  }

  return normalized.slice(0, slashIndex);
}

function mapMcpLocationEntryRow(
  mcp: McpRecord,
  referenceLocation: McpLocationRecord | null,
  entry: {
    agentId: string;
    label: string | null;
    path?: string;
    supportStatus?: 'supported' | 'unsupported';
    unsupportedReason?: 'remote-mcp-not-supported' | 'transport-not-supported';
    unsupportedTransport?: McpTransportKind;
    location: McpLocationRecord | null;
  },
): InspectorLocationRow {
  const issue = getMcpLocationIssueState(mcp, referenceLocation, entry);

  return {
    id: `${entry.agentId}:${entry.path ?? 'missing'}`,
    label: entry.label,
    path: entry.location?.configPath ?? entry.path ?? null,
    pathText: entry.location?.configPath ?? entry.path ?? 'Not configured',
    statusLabel: issue.statusLabel,
    tone: issue.tone,
  };
}

function isUniversalMcpLocation(location: McpLocationRecord): boolean {
  return location.provenance?.kind === 'universal' || isAgentsMcpConfigPath(location.configPath);
}

function formatUniversalMcpLocationLabel(location: McpLocationRecord): string {
  return stripScopePrefix(location.agentLabel);
}

function getMcpAgentEntries(
  mcp: McpRecord,
  agentIndex: Map<string, AgentRecord>,
): Array<{
  agentId: string;
  label: string;
  path?: string;
  supportStatus?: 'supported' | 'unsupported';
  unsupportedReason?: 'remote-mcp-not-supported' | 'transport-not-supported';
  unsupportedTransport?: McpTransportKind;
  location: McpLocationRecord | null;
}> {
  const locationsByAgent = new Map(mcp.locations.map((location) => [location.agentId, location]));
  const entries = new Map<string, {
    agentId: string;
    label: string;
    path?: string;
    supportStatus?: 'supported' | 'unsupported';
    unsupportedReason?: 'remote-mcp-not-supported' | 'transport-not-supported';
    unsupportedTransport?: McpTransportKind;
    location: McpLocationRecord | null;
  }>();

  for (const expected of mcp.expectedLocations ?? []) {
    entries.set(expected.agentId, {
      agentId: expected.agentId,
      label: expected.agentLabel,
      path: expected.configPath,
      supportStatus: expected.supportStatus,
      unsupportedReason: expected.unsupportedReason,
      unsupportedTransport: expected.unsupportedTransport,
      location: locationsByAgent.get(expected.agentId) ?? null,
    });
  }

  for (const location of mcp.locations) {
    if (!entries.has(location.agentId)) {
      entries.set(location.agentId, {
        agentId: location.agentId,
        label: location.agentLabel,
        path: location.configPath,
        location,
      });
    }
  }

  for (const missing of mcp.missingLocations ?? []) {
    if (!entries.has(missing.agentId)) {
      entries.set(missing.agentId, {
        agentId: missing.agentId,
        label: missing.agentLabel,
        path: missing.configPath,
        supportStatus: missing.supportStatus,
        unsupportedReason: missing.unsupportedReason,
        unsupportedTransport: missing.unsupportedTransport,
        location: null,
      });
    }
  }

  return [...entries.values()].map((entry) => {
    const resolvedLabel = formatMcpAgentLabel(entry.agentId, agentIndex, entry.label, entry.path);

    return {
      ...entry,
      label: resolvedLabel,
    };
  });
}

function getMcpLocationIssueState(
  mcp: McpRecord,
  canonicalLocation: McpLocationRecord | null,
  entry: {
    supportStatus?: 'supported' | 'unsupported';
    unsupportedReason?: 'remote-mcp-not-supported' | 'transport-not-supported';
    unsupportedTransport?: McpTransportKind;
    location: McpLocationRecord | null;
  },
): { statusLabel?: string; tone: InspectorLocationTone } {
  if (entry.supportStatus === 'unsupported') {
    return {
      statusLabel: formatMcpUnsupportedLocationStatus(entry),
      tone: 'muted',
    };
  }

  const location = entry.location;
  if (!location) {
    return { statusLabel: 'Missing From Agent', tone: 'muted' };
  }

  if ((location.invalidDetails?.length ?? 0) > 0) {
    return { statusLabel: 'Invalid Definition', tone: 'danger' };
  }

  if (location.connectivity?.status === 'failed') {
    return { statusLabel: 'Connection Failed', tone: 'danger' };
  }

  if (mcp.issueReasons.includes('definition-mismatch') && canonicalLocation) {
    if (isMcpCoreDefinitionMismatch(location, canonicalLocation)
      || isMcpAgentSpecificDefinitionMismatch(location, canonicalLocation)) {
      return { statusLabel: 'Definition Mismatch', tone: 'warning' };
    }
  }

  return { tone: 'healthy' };
}

function isMcpCoreDefinitionMismatch(
  location: McpLocationRecord,
  canonicalLocation: McpLocationRecord,
): boolean {
  return getMcpCoreDefinitionKey(location) !== getMcpCoreDefinitionKey(canonicalLocation);
}

function getMcpCoreDefinitionKey(location: McpLocationRecord): string {
  return location.coreDefinitionComparisonKey
    ?? location.definitionComparisonKey
    ?? normalizeDefinitionText(location.definitionText ?? buildMcpDefinitionText(location))
    ?? 'null';
}

function isMcpAgentSpecificDefinitionMismatch(
  location: McpLocationRecord,
  canonicalLocation: McpLocationRecord,
): boolean {
  if (isUniversalMcpLocation(location) || !location.agentLocalKey) {
    return false;
  }

  return stableDefinitionString(location.nativeDefinition ?? {})
    !== stableDefinitionString(canonicalLocation.agentLocal?.[location.agentLocalKey] ?? {});
}


function buildSubagentLocationSections(
  subagent: SubagentRecord,
  agentIndex: Map<string, AgentRecord>,
): InspectorLocationSectionModel[] {
  const universalRows = getSubagentUniversalDirectoryRows(subagent);
  const pluginRows = subagent.locations
    .filter((location) => location.provenance?.kind === 'plugin')
    .map((location) => mapSubagentLocationRow(subagent, location, stripScopePrefix(location.agentLabel)));
  const installedRows = getSubagentAgentEntries(subagent, agentIndex)
    .filter((entry) => !entry.path || !isAgentsPath(entry.path))
    .filter((entry) => entry.location?.provenance?.kind !== 'plugin')
    .map((entry) => {
      const issue = getSubagentLocationIssueState(subagent, entry);
      return {
        id: `${entry.agentId}:${entry.path ?? 'missing'}`,
        label: entry.label,
        path: entry.location?.path ?? entry.path ?? null,
        pathText: entry.location?.path ?? entry.path ?? 'Not configured',
        statusLabel: issue.statusLabel,
        tone: issue.tone,
      };
    })
    .sort(compareInspectorLocationRowsByLabel);

  return [
    {
      id: 'universal',
      title: 'Universal Directory',
      rows: universalRows,
    },
    {
      id: 'plugin-paths',
      title: 'Plugin Paths',
      rows: pluginRows,
    },
    {
      id: 'installed-paths',
      title: 'Installed Paths',
      rows: installedRows,
    },
  ].filter((section) => section.rows.length > 0 || section.id === 'universal');
}

function getSubagentUniversalDirectoryRows(subagent: SubagentRecord): InspectorLocationRow[] {
  const universalLocations = subagent.locations.filter((location) => location.canonical || isAgentsPath(location.path));
  if (universalLocations.length > 0) {
    return universalLocations.map((location) =>
      mapSubagentLocationRow(subagent, location, universalLocations.length > 1 ? 'Universal' : null));
  }

  const expectedUniversal = [...(subagent.expectedLocations ?? []), ...(subagent.missingLocations ?? [])]
    .find((location) => location.path && isAgentsPath(location.path));

  return [{
    id: expectedUniversal?.path ?? 'missing-universal-subagent',
    label: null,
    path: expectedUniversal?.path ?? null,
    pathText: expectedUniversal?.path ?? 'Not found',
    statusLabel: 'Missing Universal',
    tone: 'muted',
  }];
}

function mapSubagentLocationRow(
  subagent: SubagentRecord,
  location: SubagentLocationRecord,
  label: string | null,
): InspectorLocationRow {
  const issue = getSubagentLocationIssueState(subagent, {
    agentId: location.agentId,
    label: location.canonical ? 'Universal' : location.agentLabel,
    path: location.path,
    location,
  });

  return {
    id: location.path,
    label,
    path: location.path,
    pathText: location.path,
    statusLabel: issue.statusLabel,
    tone: issue.tone,
  };
}

function getSubagentAgentEntries(
  subagent: SubagentRecord,
  agentIndex: Map<string, AgentRecord>,
): Array<{
  agentId: string;
  label: string;
  path?: string;
  supportStatus?: 'supported' | 'unsupported';
  unsupportedReason?: 'not-documented' | 'unsupported-format' | 'account-managed';
  location: SubagentLocationRecord | null;
}> {
  const locationsByAgent = new Map(subagent.locations.map((location) => [location.agentId, location]));
  const entries = new Map<string, {
    agentId: string;
    label: string;
    path?: string;
    supportStatus?: 'supported' | 'unsupported';
    unsupportedReason?: 'not-documented' | 'unsupported-format' | 'account-managed';
    location: SubagentLocationRecord | null;
  }>();

  for (const expected of subagent.expectedLocations ?? []) {
    entries.set(expected.agentId, {
      agentId: expected.agentId,
      label: expected.agentLabel,
      path: expected.path ?? expected.directoryPath,
      supportStatus: expected.supportStatus,
      unsupportedReason: expected.unsupportedReason,
      location: locationsByAgent.get(expected.agentId) ?? null,
    });
  }

  for (const location of subagent.locations) {
    if (!entries.has(location.agentId)) {
      entries.set(location.agentId, {
        agentId: location.agentId,
        label: location.agentLabel,
        path: location.path,
        location,
      });
    }
  }

  for (const missing of subagent.missingLocations ?? []) {
    if (!entries.has(missing.agentId)) {
      entries.set(missing.agentId, {
        agentId: missing.agentId,
        label: missing.agentLabel,
        path: missing.path ?? missing.directoryPath,
        supportStatus: missing.supportStatus,
        unsupportedReason: missing.unsupportedReason,
        location: null,
      });
    }
  }

  return [...entries.values()].map((entry) => ({
    ...entry,
    label: formatSubagentAgentLabel(entry.agentId, agentIndex, entry.label, entry.path),
  }));
}

function getSubagentLocationIssueState(
  subagent: SubagentRecord,
  entry: {
    agentId?: string;
    label?: string;
    path?: string;
    supportStatus?: 'supported' | 'unsupported';
    unsupportedReason?: 'not-documented' | 'unsupported-format' | 'account-managed';
    location: SubagentLocationRecord | null;
  },
): { statusLabel?: string; tone: InspectorLocationTone } {
  if (entry.supportStatus === 'unsupported') {
    return {
      statusLabel: formatSubagentUnsupportedLocationStatus(entry.unsupportedReason),
      tone: 'muted',
    };
  }

  const location = entry.location;
  if (!location) {
    return { statusLabel: 'Missing From Agent', tone: 'muted' };
  }

  if ((location.invalidDetails?.length ?? 0) > 0) {
    return { statusLabel: 'Invalid Definition', tone: 'danger' };
  }

  if (location.fileType === 'symlink') {
    if (subagent.issueReasons.includes('broken-symlink') && !location.resolvedPath) {
      return { statusLabel: 'Broken Symlink', tone: 'danger' };
    }

    if (subagent.issueReasons.includes('wrong-symlink-target') && isWrongSubagentSymlinkTarget(subagent, location)) {
      return { statusLabel: 'Wrong Target', tone: 'warning' };
    }

    return { statusLabel: 'symlink', tone: 'healthy' };
  }

  if (!location.canonical && subagent.issueReasons.includes('definition-mismatch') && isSubagentDefinitionMismatch(subagent, location)) {
    return { statusLabel: 'Definition Mismatch', tone: 'warning' };
  }

  if (!location.canonical && subagent.issueReasons.includes('identical-copies')) {
    return { statusLabel: 'Identical Copy', tone: 'warning' };
  }

  return { tone: 'healthy' };
}

function formatSubagentUnsupportedLocationStatus(
  reason?: 'not-documented' | 'unsupported-format' | 'account-managed',
): string {
  switch (reason) {
    case 'account-managed':
      return 'Account managed';
    case 'not-documented':
      return 'Not documented';
    case 'unsupported-format':
      return 'Unsupported format';
    case undefined:
      return 'Unsupported';
  }
}

function formatMcpUnsupportedLocationStatus(entry: {
  unsupportedReason?: 'remote-mcp-not-supported' | 'transport-not-supported';
  unsupportedTransport?: McpTransportKind;
}): string {
  if (entry.unsupportedReason === 'remote-mcp-not-supported') {
    return 'Remote MCPs not supported';
  }

  return entry.unsupportedTransport
    ? `${formatMcpTransportLabel(entry.unsupportedTransport)} MCPs not supported`
    : 'MCP transport not supported';
}

function formatMcpTransportLabel(transport: McpTransportKind): string {
  switch (transport) {
    case 'stdio':
      return 'Command';
    case 'streamable-http':
      return 'Streamable HTTP';
    case 'sse':
      return 'SSE';
    case 'http':
      return 'HTTP';
    case 'unknown':
      return 'Unknown transport';
    default:
      return 'MCP transport';
  }
}

function mapSkillVariant(
  variant: SkillVariantGroup,
  baselineVariant: SkillVariantGroup | null,
  selectedVariant: SkillVariantGroup | null,
): InspectorVariantModel {
  const representative = variant.representative;
  const badge = representative.path === baselineVariant?.representative.path
      ? 'Universal'
      : representative.path === selectedVariant?.representative.path
        ? 'Selected Version'
        : undefined;

  return {
    id: variant.id,
    path: representative.path,
    label: representative.sourceLabel,
    secondaryLabel: representative.path,
    badge,
    isBaseline: representative.path === baselineVariant?.representative.path,
    locations: variant.locations.map((location) => ({
      label: location.sourceLabel,
      path: location.path,
    })),
    updatedLabel: formatAgeLabel(representative.modifiedAt),
    definitionText: variant.definitionText,
  };
}

function mapMcpVariant(
  variant: McpVariantGroup,
  baselineVariant: McpVariantGroup | null,
  selectedVariant: McpVariantGroup | null,
  agentIndex: Map<string, AgentRecord>,
): InspectorVariantModel {
  const representative = variant.representative;
  const badge = representative.configPath === selectedVariant?.representative.configPath
    ? 'Selected Version'
    : representative.configPath === baselineVariant?.representative.configPath
      ? 'Reference Definition'
      : undefined;
  const locationLabels = variant.locations.map((location) =>
    formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath));
  const isBaseline = representative.configPath === baselineVariant?.representative.configPath;

  return {
    id: variant.id,
    path: representative.configPath,
    label: summarizeMcpVariantLocationLabels(locationLabels),
    secondaryLabel: formatAgentCount(locationLabels.length),
    badge,
    isBaseline,
    locations: variant.locations.map((location) => ({
      label: formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath),
      path: location.configPath,
    })),
    updatedLabel: summarizeMcpCommand(representative),
    definitionText: variant.definitionText,
  };
}

function mapSubagentVariant(
  variant: SubagentVariantGroup,
  baselineVariant: SubagentVariantGroup | null,
  selectedVariant: SubagentVariantGroup | null,
  agentIndex: Map<string, AgentRecord>,
): InspectorVariantModel {
  const representative = variant.representative;
  const badge = representative.path === baselineVariant?.representative.path
    ? 'Universal'
    : representative.path === selectedVariant?.representative.path
      ? 'Selected Version'
      : undefined;

  return {
    id: variant.id,
    path: representative.path,
    label: formatSubagentAgentLabel(representative.agentId, agentIndex, representative.agentLabel, representative.path),
    secondaryLabel: representative.path,
    badge,
    isBaseline: representative.path === baselineVariant?.representative.path,
    locations: variant.locations.map((location) => ({
      label: formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path),
      path: location.path,
    })),
    updatedLabel: formatAgeLabel(representative.modifiedAt),
    definitionText: variant.definitionText,
  };
}

function summarizeMcpVariantLocationLabels(labels: string[]): string {
  if (labels.length === 0) {
    return 'No locations';
  }

  if (labels.length <= 3) {
    return labels.join(', ');
  }

  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
}

function formatAgentCount(count: number): string {
  return `${count} agent${count === 1 ? '' : 's'}`;
}

function groupSkillVariants(candidates: SkillDuplicateCandidate[]): SkillVariantGroup[] {
  const groups = new Map<string, SkillDuplicateCandidate[]>();

  for (const candidate of candidates.filter(isReadableSkillVariantCandidate)) {
    const key = getSkillVariantGroupKey(candidate);
    const existing = groups.get(key) ?? [];
    existing.push(candidate);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .map(([id, locations]) => {
      const sortedLocations = locations.slice().sort(compareNewestCandidate);
      const representative = sortedLocations[0];
      if (!representative) {
        throw new Error(`Expected a representative location for skill variant group ${id}.`);
      }
      return {
        id,
        definitionText: normalizeDefinitionText(representative.definitionText),
        locations: sortedLocations,
        representative,
      };
    })
    .sort((left, right) => compareNewestCandidate(left.representative, right.representative));
}

function isReadableSkillVariantCandidate(candidate: SkillDuplicateCandidate): boolean {
  if (candidate.fileType === 'real-file') {
    return true;
  }

  return Boolean(
    normalizeDefinitionText(candidate.definitionText)
    || candidate.packageFiles?.some((file) => file.kind === 'text'),
  );
}

function getSkillVariantCandidates(
  skill: SkillRecord,
  problemKey: SkillIssueReason,
  sourceIndex: Map<string, SkillScanSource>,
): SkillDuplicateCandidate[] {
  if (skill.detailDiagnostics.duplicateCandidates.length > 0 || problemKey !== 'missing-canonical') {
    return skill.detailDiagnostics.duplicateCandidates;
  }

  return skill.locations
    .filter((location) => location.fileType === 'real-file')
    .map((location) => ({
      ...location,
      installSource: buildInstallSourceFromLocation(location, sourceIndex),
    }));
}

function buildInstallSourceFromLocation(
  location: SkillLocationRecord,
  sourceIndex: Map<string, SkillScanSource>,
) {
  const source = sourceIndex.get(location.sourceId);

  return {
    sourceId: location.sourceId,
    label: location.sourceLabel,
    kind: source?.kind ?? 'agent',
    scope: location.sourceScope,
    writable: source?.writable ?? true,
    canonical: source?.canonical ?? location.canonical,
  };
}

function buildSkillVariantDiffLines(
  skill: SkillRecord,
  selectedVariant: SkillVariantGroup | null,
  baselineVariant: SkillVariantGroup | null,
): SkillDiffFileRecord[] {
  if (!selectedVariant) {
    return [];
  }

  const structuredDiffFiles = buildStructuredDiffFiles(skill, selectedVariant, baselineVariant);
  if (structuredDiffFiles.length > 0) {
    return structuredDiffFiles;
  }

  return buildLegacySkillDiffFiles(skill, selectedVariant, baselineVariant);
}

function buildStructuredDiffFiles(
  skill: SkillRecord,
  selectedVariant: SkillVariantGroup | null,
  baselineVariant: SkillVariantGroup | null,
): SkillDiffFileRecord[] {
  if (!selectedVariant) {
    return [];
  }

  if (baselineVariant?.representative.packageFiles && selectedVariant.representative.packageFiles) {
    return buildPackageDiffFiles(
      baselineVariant.representative.packageFiles,
      selectedVariant.representative.packageFiles,
    );
  }

  if (Array.isArray(skill.diff?.files) && selectedVariant.representative.path === skill.diff?.selectedPath) {
    return skill.diff.files;
  }

  if (Array.isArray(skill.diff?.files) && baselineVariant?.representative.path === skill.diff?.selectedPath) {
    return skill.diff.files;
  }

  return [];
}

function buildLegacySkillDiffFiles(
  skill: SkillRecord,
  selectedVariant: SkillVariantGroup | null,
  baselineVariant: SkillVariantGroup | null,
): SkillDiffFileRecord[] {
  if (!selectedVariant) {
    return [];
  }

  if (!baselineVariant) {
    if (selectedVariant.representative.packageFiles && selectedVariant.representative.packageFiles.length > 0) {
      return buildSelectedPackagePreviewFiles(selectedVariant);
    }

    const lines = buildTextPreviewLines(selectedVariant.definitionText);
    return lines.length > 0
      ? [{ relativePath: 'SKILL.md', status: 'changed' as const, kind: 'text' as const, lines }]
      : [];
  }

  if (selectedVariant.definitionText && baselineVariant.definitionText && selectedVariant.representative.path === baselineVariant.representative.path) {
    return [{
      relativePath: 'SKILL.md',
      status: 'changed',
      kind: 'text',
      lines: buildTextDiffLines(selectedVariant.definitionText, baselineVariant.definitionText),
    }];
  }

  const selectedPath = selectedVariant.representative.path;
  const baselinePath = baselineVariant.representative.path;

  if (skill.diff?.primaryPath === selectedPath) {
    const lines = skill.diff.comparisons?.find((comparison) => comparison.path === baselinePath)?.lines ?? [];
    return lines.length > 0 ? [{ relativePath: 'SKILL.md', status: 'changed', kind: 'text', lines }] : [];
  }

  if (skill.diff?.primaryPath === baselinePath) {
    const lines = skill.diff.comparisons?.find((comparison) => comparison.path === selectedPath)?.lines ?? [];
    return lines.length > 0 ? [{ relativePath: 'SKILL.md', status: 'changed', kind: 'text', lines }] : [];
  }

  return [];
}

function buildSelectedPackagePreviewFiles(
  selectedVariant: SkillVariantGroup,
): InternalSkillDiffFileRecord[] {
  const packageFiles = ensureEntrypointFirst(
    selectedVariant.representative.packageFiles?.map((file) => file.relativePath) ?? [],
  );

  return packageFiles.flatMap((relativePath) => {
    const packageFile = selectedVariant.representative.packageFiles?.find((file) => file.relativePath === relativePath);
    if (!packageFile) {
      return [];
    }

    const previewText = relativePath === 'SKILL.md'
      ? (selectedVariant.definitionText ?? packageFile.text)
      : packageFile.kind === 'text'
        ? packageFile.text
        : undefined;

    return [{
      relativePath,
      status: packageFile.kind === 'binary' ? 'binary' : 'changed',
      kind: packageFile.kind,
      lines: packageFile.kind === 'text' ? buildTextPreviewLines(previewText) : undefined,
      __displayKind: 'preview',
    }];
  });
}

function buildSkillVariantDiffInventory(
  skill: SkillRecord,
  orderedVariants: SkillVariantGroup[],
  selectedVariant: SkillVariantGroup | null,
  baselineVariant: SkillVariantGroup | null,
): {
  changedFiles: InternalSkillDiffFileRecord[];
} {
  const perVariantDiffs = new Map<string, InternalSkillDiffFileRecord[]>();
  const supersetRelativePaths: string[] = [];
  const aggregateFileByPath = new Map<string, InternalSkillDiffFileRecord>();

  const comparableVariants = baselineVariant
    ? orderedVariants.filter((variant) => variant.representative.path !== baselineVariant.representative.path)
    : orderedVariants;

  for (const variant of comparableVariants) {
    const diffFiles = buildSkillVariantDiffLines(skill, variant, baselineVariant);
    perVariantDiffs.set(variant.representative.path, diffFiles);

    for (const file of diffFiles) {
      if (!aggregateFileByPath.has(file.relativePath)) {
        aggregateFileByPath.set(file.relativePath, file);
      }
      if (!supersetRelativePaths.includes(file.relativePath)) {
        supersetRelativePaths.push(file.relativePath);
      }
    }
  }

  const stableRelativePaths = ensureEntrypointFirst(supersetRelativePaths);
  if (stableRelativePaths.length === 0 && selectedVariant) {
    stableRelativePaths.push('SKILL.md');
  }

  const selectedDiffsByPath = new Map(
    (selectedVariant ? perVariantDiffs.get(selectedVariant.representative.path) : undefined)?.map((file) => [file.relativePath, file]) ?? [],
  );

  return {
    changedFiles: stableRelativePaths.map((relativePath) => {
      const selectedFile = selectedDiffsByPath.get(relativePath);
      const aggregateFile = aggregateFileByPath.get(relativePath);

      if (selectedFile) {
        return {
          ...selectedFile,
          __displayKind: 'diff',
        };
      }

      const selectedFilePreview = buildSelectedPackageFilePreview(relativePath, selectedVariant, aggregateFile);
      if (selectedFilePreview) {
        return selectedFilePreview;
      }

      return {
        relativePath,
        status: aggregateFile?.status ?? 'changed',
        kind: aggregateFile?.kind ?? 'text',
        lines: [],
        __displayKind: 'unchanged',
      };
    }),
  };
}

function buildSelectedPackageFilePreview(
  relativePath: string,
  selectedVariant: SkillVariantGroup | null,
  aggregateFile: InternalSkillDiffFileRecord | undefined,
): InternalSkillDiffFileRecord | null {
  const selectedPackageFile = selectedVariant?.representative.packageFiles?.find((file) => file.relativePath === relativePath);
  const previewText = relativePath === 'SKILL.md'
    ? (selectedVariant?.definitionText ?? selectedPackageFile?.text)
    : selectedPackageFile?.kind === 'text'
      ? selectedPackageFile.text
      : undefined;
  const lines = buildTextPreviewLines(previewText);
  if (lines.length === 0) {
    return null;
  }

  return {
    relativePath,
    status: aggregateFile?.status ?? 'changed',
    kind: 'text',
    lines,
    __displayKind: 'preview',
  };
}

function ensureEntrypointFirst(relativePaths: string[]): string[] {
  const remaining = relativePaths.filter((relativePath) => relativePath !== 'SKILL.md');
  return ['SKILL.md', ...remaining];
}

function buildPackageDiffFiles(
  baselineFilesList: SkillPackageFileRecord[],
  selectedFilesList: SkillPackageFileRecord[],
): InternalSkillDiffFileRecord[] {
  const baselineFiles = new Map(baselineFilesList.map((file) => [file.relativePath, file]));
  const selectedFiles = new Map(selectedFilesList.map((file) => [file.relativePath, file]));
  const allRelativePaths = [...new Set([...baselineFiles.keys(), ...selectedFiles.keys()])]
    .sort((left, right) => left.localeCompare(right));
  const diffFiles: InternalSkillDiffFileRecord[] = [];

  for (const relativePath of allRelativePaths) {
    const baselineFile = baselineFiles.get(relativePath);
    const selectedFile = selectedFiles.get(relativePath);

    if (!baselineFile && selectedFile) {
      diffFiles.push({
        relativePath,
        status: selectedFile.kind === 'binary' ? 'binary' : 'added',
        kind: selectedFile.kind,
        lines: selectedFile.kind === 'text' ? buildTextDiffLines(selectedFile.text ?? '', undefined) : undefined,
        __displayKind: 'diff',
      });
      continue;
    }

    if (baselineFile && !selectedFile) {
      diffFiles.push({
        relativePath,
        status: baselineFile.kind === 'binary' ? 'binary' : 'removed',
        kind: baselineFile.kind,
        lines: baselineFile.kind === 'text' ? buildTextDiffLines(undefined, baselineFile.text ?? '') : undefined,
        __displayKind: 'diff',
      });
      continue;
    }

    if (!baselineFile || !selectedFile || baselineFile.contentHash === selectedFile.contentHash) {
      continue;
    }

    if (baselineFile.kind === 'binary' || selectedFile.kind === 'binary') {
      diffFiles.push({
        relativePath,
        status: 'binary',
        kind: baselineFile.kind === 'binary' ? baselineFile.kind : selectedFile.kind,
        __displayKind: 'diff',
      });
      continue;
    }

    diffFiles.push({
      relativePath,
      status: 'changed',
      kind: 'text',
      lines: buildTextDiffLines(selectedFile.text, baselineFile.text),
      __displayKind: 'diff',
    });
  }

  return diffFiles;
}

function getInspectorChangedFileDisplayKind(
  file: InternalSkillDiffFileRecord,
): InspectorChangedFileModel['displayKind'] {
  return file.__displayKind ?? 'diff';
}

function resolveSkillPackageDiffPath(
  relativePath: string,
  diffFile: Pick<SkillDiffFileRecord, 'status'>,
  selectedVariant: SkillVariantGroup | null,
  baselineVariant: SkillVariantGroup | null,
): string {
  if (isAbsoluteInspectorPath(relativePath)) {
    return relativePath;
  }

  const packageRoot = resolveSkillPackageDiffRoot(relativePath, diffFile, selectedVariant, baselineVariant);

  if (!packageRoot) {
    return relativePath;
  }

  return joinInspectorPath(packageRoot, relativePath);
}

function resolveSkillPackageDiffRoot(
  relativePath: string,
  diffFile: Pick<SkillDiffFileRecord, 'status'>,
  selectedVariant: SkillVariantGroup | null,
  baselineVariant: SkillVariantGroup | null,
): string | null {
  const selectedHasFile = hasSkillPackageFile(selectedVariant?.representative, relativePath);
  const baselineHasFile = hasSkillPackageFile(baselineVariant?.representative, relativePath);

  if (diffFile.status === 'removed') {
    return baselineHasFile
      ? baselineVariant?.representative.path ?? null
      : (selectedVariant?.representative.path ?? null);
  }

  if (selectedHasFile) {
    return selectedVariant?.representative.path ?? null;
  }

  if (baselineHasFile) {
    return baselineVariant?.representative.path ?? null;
  }

  return selectedVariant?.representative.path ?? baselineVariant?.representative.path ?? null;
}

function hasSkillPackageFile(
  candidate: SkillDuplicateCandidate | undefined,
  relativePath: string,
): boolean {
  return Boolean(candidate?.packageFiles?.some((file) => file.relativePath === relativePath));
}

function joinInspectorPath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '');
  const normalizedRelativePath = relativePath.replace(/^[\\/]+/, '');
  return `${normalizedRoot}/${normalizedRelativePath}`;
}

function isAbsoluteInspectorPath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('~/');
}

function buildTextPreviewLines(text?: string): SkillDiffLine[] {
  const normalizedText = normalizeDefinitionText(text);
  if (!normalizedText) {
    return [];
  }

  return normalizedText.split('\n').map((text) => ({
    type: 'context',
    text,
  }));
}

function groupMcpVariants(locations: McpLocationRecord[]): McpVariantGroup[] {
  const groups = new Map<string, McpLocationRecord[]>();

  for (const location of locations) {
    const definitionText = normalizeDefinitionText(location.definitionText ?? buildMcpDefinitionText(location));
    const key = location.definitionComparisonKey ?? (definitionText || `${location.command ?? ''}:${location.args.join('\0')}`);
    const existing = groups.get(key) ?? [];
    existing.push(location);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([id, groupedLocations]) => {
    const representative = groupedLocations[0];
    if (!representative) {
      throw new Error(`Expected a representative location for MCP variant group ${id}.`);
    }

    return {
      id,
      definitionText: normalizeDefinitionText(representative.definitionText ?? buildMcpDefinitionText(representative)),
      locations: groupedLocations,
      representative,
    };
  });
}

function groupSubagentVariants(locations: SubagentLocationRecord[]): SubagentVariantGroup[] {
  const groups = new Map<string, SubagentLocationRecord[]>();

  for (const location of locations.filter(isReadableSubagentVariantLocation)) {
    const definitionText = normalizeDefinitionText(location.definitionText);
    const key = location.definitionComparisonKey ?? (definitionText ? `text:${hashStableString(definitionText)}` : `path:${location.path}`);
    const existing = groups.get(key) ?? [];
    existing.push(location);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([id, groupedLocations]) => {
    const sortedLocations = groupedLocations.slice().sort(compareSubagentLocationsForDisplay);
    const representative = sortedLocations[0];
    if (!representative) {
      throw new Error(`Expected a representative location for subagent variant group ${id}.`);
    }

    return {
      id,
      definitionText: normalizeDefinitionText(representative.definitionText),
      locations: sortedLocations,
      representative,
    };
  });
}

function isReadableSubagentVariantLocation(location: SubagentLocationRecord): boolean {
  if (location.fileType !== 'real-file') {
    return false;
  }

  if ((location.invalidDetails?.length ?? 0) === 0) {
    return true;
  }

  return Boolean(normalizeDefinitionText(location.definitionText));
}

const MCP_BREAKDOWN_FIELD_ORDER = [
  'transport',
  'command',
  'args',
  'cwd',
  'env',
  'url',
  'headers',
  'env_http_headers',
  'bearer_token_env_var',
] as const;

const MCP_BREAKDOWN_FIELD_LABELS: Record<string, string> = {
  args: 'Args',
  bearer_token_env_var: 'Bearer token env',
  command: 'Command',
  cwd: 'Cwd',
  env: 'Env',
  env_http_headers: 'Env HTTP headers',
  headers: 'Headers/Auth',
  transport: 'Transport',
  url: 'URL',
};

const MCP_PORTABLE_FIELD_KEYS = new Set<string>(MCP_BREAKDOWN_FIELD_ORDER);
const MCP_DEFINITION_WRAPPER_KEYS = new Set(['mcpServers', 'servers', 'mcp']);

function buildMcpDefinitionBreakdown(
  mcpName: string,
  selectedVariant: McpVariantGroup,
  baselineVariant: McpVariantGroup,
): InspectorDefinitionBreakdown {
  const selectedLocation = selectedVariant.representative;
  const baselineLocation = baselineVariant.representative;
  const selectedRawDefinition = getMcpRawServerDefinition(mcpName, selectedLocation);
  const baselineRawDefinition = getMcpRawServerDefinition(mcpName, baselineLocation);
  const selectedDefinition = normalizeMcpDefinitionForComparison(selectedRawDefinition, selectedLocation);
  const baselineDefinition = normalizeMcpDefinitionForComparison(baselineRawDefinition, baselineLocation);

  return {
    comparedFields: buildMcpComparedFields(selectedDefinition, baselineDefinition),
    ignoredSettings: buildMcpIgnoredSettings([
      { label: selectedLocation.agentLabel, definition: selectedRawDefinition },
      { label: baselineLocation.agentLabel, definition: baselineRawDefinition },
    ]),
    rawConfigs: [
      {
        label: 'Reference definition',
        path: baselineLocation.configPath,
        text: baselineVariant.definitionText ?? buildMcpDefinitionText(baselineLocation) ?? '',
      },
      {
        label: 'Selected definition',
        path: selectedLocation.configPath,
        text: selectedVariant.definitionText ?? buildMcpDefinitionText(selectedLocation) ?? '',
      },
    ],
  };
}

function buildMcpComparedFields(
  selectedDefinition: McpServerDefinition,
  baselineDefinition: McpServerDefinition,
): InspectorDefinitionFieldComparison[] {
  return MCP_BREAKDOWN_FIELD_ORDER
    .filter((key) => selectedDefinition[key] !== undefined || baselineDefinition[key] !== undefined)
    .map((key) => {
      const selectedValue = selectedDefinition[key];
      const referenceValue = baselineDefinition[key];
      return {
        key,
        label: MCP_BREAKDOWN_FIELD_LABELS[key],
        status: getDefinitionFieldStatus(selectedValue, referenceValue),
        selectedValue: formatDefinitionFieldValue(selectedValue),
        referenceValue: formatDefinitionFieldValue(referenceValue),
      };
    });
}

function getDefinitionFieldStatus(
  selectedValue: McpDefinitionValue | undefined,
  referenceValue: McpDefinitionValue | undefined,
): InspectorDefinitionFieldStatus {
  if (selectedValue === undefined) {
    return 'reference-only';
  }

  if (referenceValue === undefined) {
    return 'selected-only';
  }

  return stableDefinitionString(selectedValue) === stableDefinitionString(referenceValue) ? 'same' : 'different';
}

function formatDefinitionFieldValue(value: McpDefinitionValue | undefined): string[] {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    return ['None'];
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => formatPrimitiveDefinitionValue(item)) : ['None'];
  }

  if (isMcpDefinitionObject(value)) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${key}: ${formatPrimitiveDefinitionValue(nestedValue)}`);
    return entries.length > 0 ? entries : ['None'];
  }

  return [formatPrimitiveDefinitionValue(value)];
}

function formatPrimitiveDefinitionValue(value: McpDefinitionValue | undefined): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return stableDefinitionString(value);
}

function buildMcpIgnoredSettings(
  definitions: Array<{ label: string; definition: McpServerDefinition }>,
): InspectorIgnoredDefinitionSetting[] {
  const ignoredByKey = new Map<string, Set<string>>();

  for (const { label, definition } of definitions) {
    for (const key of Object.keys(definition)) {
      if (MCP_PORTABLE_FIELD_KEYS.has(key) || key === 'type' || MCP_DEFINITION_WRAPPER_KEYS.has(key)) {
        continue;
      }

      const sources = ignoredByKey.get(key) ?? new Set<string>();
      sources.add(label);
      ignoredByKey.set(key, sources);
    }
  }

  return [...ignoredByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, sources]) => ({
      key,
      label: formatDefinitionSettingLabel(key),
      sources: [...sources].sort((left, right) => left.localeCompare(right)),
    }));
}

function formatDefinitionSettingLabel(key: string): string {
  return key
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || key;
}

function getMcpRawServerDefinition(mcpName: string, location: McpLocationRecord): McpServerDefinition {
  const parsedDefinition = parseMcpDefinitionText(location.definitionText);
  if (parsedDefinition) {
    for (const wrapperKey of MCP_DEFINITION_WRAPPER_KEYS) {
      const wrappedDefinitions = parsedDefinition[wrapperKey];
      if (isMcpDefinitionObject(wrappedDefinitions) && isMcpDefinitionObject(wrappedDefinitions[mcpName])) {
        return wrappedDefinitions[mcpName];
      }
    }

    return parsedDefinition;
  }

  return {
    ...(location.transport ? { transport: location.transport } : {}),
    ...(location.command ? { command: location.command } : {}),
    ...(location.url ? { url: location.url } : {}),
    ...(location.args.length > 0 ? { args: location.args } : {}),
  };
}

function buildMcpNormalizedDefinitionText(mcpName: string, location: McpLocationRecord): string {
  const rawDefinition = getMcpRawServerDefinition(mcpName, location);
  const normalizedDefinition = normalizeMcpDefinitionForComparison(rawDefinition, location);
  return JSON.stringify(orderMcpDefinitionForDisplay(normalizedDefinition), null, 2);
}

function orderMcpDefinitionForDisplay(definition: McpServerDefinition): McpServerDefinition {
  return orderMcpDefinitionObject(definition, MCP_BREAKDOWN_FIELD_ORDER);
}

function orderMcpDefinitionObject(
  definition: McpDefinitionObject,
  preferredOrder: readonly string[] = [],
): McpDefinitionObject {
  const ordered: McpDefinitionObject = {};
  const remainingKeys = new Set(Object.keys(definition));

  for (const key of preferredOrder) {
    if (remainingKeys.has(key)) {
      ordered[key] = orderMcpDefinitionValue(definition[key]);
      remainingKeys.delete(key);
    }
  }

  for (const key of [...remainingKeys].sort((left, right) => left.localeCompare(right))) {
    ordered[key] = orderMcpDefinitionValue(definition[key]);
  }

  return ordered;
}

function orderMcpDefinitionValue(value: McpDefinitionValue | undefined): McpDefinitionValue | undefined {
  if (Array.isArray(value)) {
    return value
      .map(orderMcpDefinitionValue)
      .filter((item): item is McpDefinitionValue => item !== undefined);
  }

  if (isMcpDefinitionObject(value)) {
    return orderMcpDefinitionObject(value);
  }

  return value;
}

function parseMcpDefinitionText(definitionText: string | undefined): McpServerDefinition | null {
  if (!definitionText) {
    return null;
  }

  try {
    const parsed = JSON.parse(definitionText) as unknown;
    return isMcpDefinitionObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stableDefinitionString(value: McpDefinitionValue | undefined): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableDefinitionString).join(',')}]`;
  }

  if (!isMcpDefinitionObject(value)) {
    return JSON.stringify(value);
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableDefinitionString(nestedValue)}`)
    .join(',')}}`;
}

function getSkillVariantGroupKey(candidate: SkillDuplicateCandidate): string {
  return getSkillVariantLocationComparisonKey(candidate);
}

function getSkillVariantLocationComparisonKey(location: Pick<SkillLocationRecord, 'contentHash' | 'definitionText' | 'path'>): string {
  if (location.contentHash) {
    return `hash:${location.contentHash}`;
  }

  const normalizedDefinitionText = normalizeDefinitionText(location.definitionText);
  if (normalizedDefinitionText) {
    return `text:${hashStableString(normalizedDefinitionText)}`;
  }

  return `path:${location.path}`;
}

function hashStableString(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
}

function selectSkillVariant(
  variants: SkillVariantGroup[],
  selectedVariantPath: string | null | undefined,
): SkillVariantGroup | null {
  if (selectedVariantPath) {
    const selectedVariant = variants.find((variant) => variant.locations.some((location) => location.path === selectedVariantPath));
    if (selectedVariant) {
      return withSkillRepresentativeOverride(selectedVariant, selectedVariantPath);
    }
  }

  return variants[0] ?? null;
}

function selectMcpVariant(
  variants: McpVariantGroup[],
  selectedVariantPath: string | null | undefined,
  baselineVariant: McpVariantGroup | null,
): McpVariantGroup | null {
  if (selectedVariantPath) {
    const selectedVariant = variants.find((variant) => variant.locations.some((location) => location.configPath === selectedVariantPath));
    if (selectedVariant) {
      return withMcpRepresentativeOverride(selectedVariant, selectedVariantPath);
    }
  }

  const agentsVariant = variants.find((variant) => isAgentsMcpConfigPath(variant.representative.configPath));
  return agentsVariant ?? baselineVariant ?? variants[0] ?? null;
}

function selectSubagentVariant(
  variants: SubagentVariantGroup[],
  selectedVariantPath: string | null | undefined,
  baselineVariant: SubagentVariantGroup | null,
): SubagentVariantGroup | null {
  if (selectedVariantPath) {
    const selectedVariant = variants.find((variant) => variant.locations.some((location) => location.path === selectedVariantPath));
    if (selectedVariant) {
      return withSubagentRepresentativeOverride(selectedVariant, selectedVariantPath);
    }
  }

  const agentsVariant = variants.find((variant) => isAgentsPath(variant.representative.path));
  return agentsVariant ?? baselineVariant ?? variants[0] ?? null;
}

function withSkillRepresentativeOverride(variant: SkillVariantGroup, selectedPath: string): SkillVariantGroup {
  const representative = variant.locations.find((location) => location.path === selectedPath) ?? variant.representative;
  return {
    ...variant,
    representative,
  };
}

function withMcpRepresentativeOverride(variant: McpVariantGroup, selectedPath: string): McpVariantGroup {
  const representative = variant.locations.find((location) => location.configPath === selectedPath) ?? variant.representative;
  return {
    ...variant,
    representative,
  };
}

function withSubagentRepresentativeOverride(variant: SubagentVariantGroup, selectedPath: string): SubagentVariantGroup {
  const representative = variant.locations.find((location) => location.path === selectedPath) ?? variant.representative;
  return {
    ...variant,
    representative,
  };
}

function getMcpBaselineVariant(
  variants: McpVariantGroup[],
  canonicalPath: string | null,
): McpVariantGroup | null {
  if (canonicalPath) {
    const canonicalVariant = variants.find((variant) =>
      variant.locations.some((location) => location.configPath === canonicalPath),
    );
    if (canonicalVariant) {
      return withMcpRepresentativeOverride(canonicalVariant, canonicalPath);
    }
  }

  return variants[0] ?? null;
}

function getSubagentBaselineVariant(
  variants: SubagentVariantGroup[],
  canonicalPath: string | null,
): SubagentVariantGroup | null {
  if (canonicalPath) {
    const canonicalVariant = variants.find((variant) =>
      variant.locations.some((location) => location.path === canonicalPath),
    );
    if (canonicalVariant) {
      return withSubagentRepresentativeOverride(canonicalVariant, canonicalPath);
    }
  }

  const agentsVariant = variants.find((variant) => isAgentsPath(variant.representative.path));
  return agentsVariant ?? variants[0] ?? null;
}

function getSkillBaselineVariant(
  problemKey: SkillIssueReason,
  variants: SkillVariantGroup[],
): SkillVariantGroup | null {
  const agentsVariant = findSkillAgentsVariant(variants);
  if (agentsVariant) {
    return agentsVariant;
  }

  const canonicalVariant = variants.find((variant) => variant.locations.some((location) => location.canonical)) ?? null;
  if (problemKey === 'missing-canonical') {
    return canonicalVariant;
  }

  return canonicalVariant;
}

function findSkillAgentsVariant(variants: SkillVariantGroup[]): SkillVariantGroup | null {
  for (const variant of variants) {
    const agentsLocation = variant.locations.find((location) => isAgentsPath(location.path));
    if (agentsLocation) {
      return withSkillRepresentativeOverride(variant, agentsLocation.path);
    }
  }

  return null;
}

function orderSkillVariantsForInspector(
  variants: SkillVariantGroup[],
  baselineVariant: SkillVariantGroup | null,
): SkillVariantGroup[] {
  return orderVariantsForInspector(
    variants,
    baselineVariant?.id ?? null,
  );
}

function orderMcpVariantsForInspector(
  variants: McpVariantGroup[],
  baselineVariant: McpVariantGroup | null,
): McpVariantGroup[] {
  return orderVariantsForInspector(
    variants,
    baselineVariant?.id ?? null,
  );
}

function orderSubagentVariantsForInspector(
  variants: SubagentVariantGroup[],
  baselineVariant: SubagentVariantGroup | null,
): SubagentVariantGroup[] {
  return orderVariantsForInspector(
    variants,
    baselineVariant?.id ?? null,
  );
}

function orderVariantsForInspector<T extends { id: string }>(
  variants: T[],
  baselineId: string | null,
): T[] {
  const order = new Map<string, number>();
  if (baselineId) {
    order.set(baselineId, 0);
  }

  const originalOrder = new Map(variants.map((variant, index) => [variant.id, index]));
  return variants
    .slice()
    .sort((left, right) => {
      const resolvedLeftOrder = order.get(left.id) ?? 1 + (originalOrder.get(left.id) ?? 0);
      const resolvedRightOrder = order.get(right.id) ?? 1 + (originalOrder.get(right.id) ?? 0);
      return resolvedLeftOrder - resolvedRightOrder;
    });
}

function isAgentsPath(value: string | undefined | null): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return value.replace(/\\/g, '/').includes('/.agents/');
}

function isAgentsMcpConfigPath(value: string | undefined | null): boolean {
  const parts = getNormalizedPathParts(value);
  return parts.at(-1) === 'mcp.json' && parts.at(-2) === '.agents';
}

function isAgentsSkillsPath(value: string | undefined | null): boolean {
  const parts = getNormalizedPathParts(value);
  return parts.at(-1) === 'skills' && parts.at(-2) === '.agents';
}

function getNormalizedPathParts(value: string | undefined | null): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  return value.replace(/\\/g, '/').split('/').filter(Boolean);
}

function buildProblemSections(problemKeys: InspectorProblemKey[]): InspectorProblemSectionModel[] {
  return [
    {
      title: 'Variant resolution',
      problemKeys: problemKeys.filter((problemKey) => isVariantResolutionProblemKey(problemKey)),
    },
    {
      title: 'Structural repair',
      problemKeys: problemKeys.filter((problemKey) => !isVariantResolutionProblemKey(problemKey)),
    },
  ];
}

function isVariantResolutionProblemKey(problemKey: InspectorProblemKey): boolean {
  return problemKey === 'diverged-copies'
    || problemKey === 'missing-canonical'
    || problemKey === 'missing-universal'
    || problemKey === 'definition-mismatch';
}

function getActiveProblemSelectedVariantPath(problem: InspectorActiveProblemModel): string | null {
  if (problem.kind !== 'variant-resolution') {
    return null;
  }

  return problem.selectedVariant?.path ?? null;
}

function getActiveProblemBaselineVariantPath(problem: InspectorActiveProblemModel): string | null {
  if (problem.kind !== 'variant-resolution') {
    return null;
  }

  return problem.baselineVariant?.path ?? null;
}

function getPreferredSelectedVariantPath(
  selectedVariantPath: string | null | undefined,
  problem: InspectorActiveProblemModel,
): string | null {
  return getActiveProblemSelectedVariantPath(problem) ?? selectedVariantPath ?? null;
}

function buildMetadataRows(
  provenanceRows: InspectorProvenanceRow[],
  canonicalPath: string | null,
  locationCount: number,
): InspectorMetadataRow[] {
  const selectedRow = provenanceRows.find((row) => row.isSelected) ?? null;
  const canonicalRow = provenanceRows.find((row) => row.path === canonicalPath) ?? null;

  return [
    {
      label: 'Selected version',
      value: selectedRow?.sourceLabel ?? 'Not selected',
      path: selectedRow?.path ?? null,
    },
    {
      label: 'Universal',
      value: canonicalRow?.sourceLabel ?? 'Not found',
      path: canonicalRow?.path ?? canonicalPath,
    },
    {
      label: 'Locations',
      value: formatLocationCount(locationCount),
      path: null,
    },
  ];
}

function buildMcpMetadataRows(
  provenanceRows: InspectorProvenanceRow[],
  referencePath: string | null,
  locationCount: number,
): InspectorMetadataRow[] {
  const selectedRow = provenanceRows.find((row) => row.isSelected) ?? null;
  const referenceRow = referencePath
    ? provenanceRows.find((row) => row.path === referencePath) ?? null
    : null;
  const rows: InspectorMetadataRow[] = [
    {
      label: 'Selected definition',
      value: selectedRow?.sourceLabel ?? 'Not selected',
      path: selectedRow?.path ?? null,
    },
  ];

  if (referencePath) {
    rows.push({
      label: 'Reference definition',
      value: referenceRow?.sourceLabel ?? 'Not found',
      path: referenceRow?.path ?? referencePath,
    });
  }

  rows.push({
    label: 'Locations',
    value: formatLocationCount(locationCount),
    path: null,
  });

  return rows;
}

function buildSkillProvenanceRows(skill: SkillRecord, selectedVariantPath: string | null): InspectorProvenanceRow[] {
  return skill.locations
    .slice()
    .sort(compareSkillLocationForProvenance)
    .map((location) => ({
      id: location.path,
      label: location.path === selectedVariantPath ? 'Selected version' : location.canonical ? 'Universal' : 'Variant',
      sourceLabel: location.sourceLabel,
      path: location.path,
      detail: location.fileType === 'symlink'
        ? location.symlinkTarget ?? location.resolvedPath ?? 'Linked copy'
        : formatAgeLabel(location.modifiedAt),
      isSelected: location.path === selectedVariantPath,
      isCanonical: location.canonical,
    }));
}

function buildSkillProvenanceSummary(
  skill: SkillRecord,
  selectedVariantPath: string | null,
  sourceIndex: Map<string, SkillScanSource>,
): InspectorProvenanceSummaryRow[] {
  const selectedLocation = selectedVariantPath
    ? skill.locations.find((location) => location.path === selectedVariantPath) ?? null
    : null;
  const location = selectedLocation
    ?? skill.locations.find((entry) => entry.canonical)
    ?? skill.locations[0]
    ?? null;

  return buildSourceSummaryRows(location?.provenance, getPluginNameForLocation(location, sourceIndex));
}

function buildMcpProvenanceRows(
  mcp: McpRecord,
  selectedVariantPath: string | null,
  referencePath: string | null,
  agentIndex: Map<string, AgentRecord>,
): InspectorProvenanceRow[] {
  return mcp.locations.map((location) => ({
    id: `${location.agentId}:${location.configPath}`,
    label: location.configPath === selectedVariantPath
      ? 'Selected definition'
      : location.configPath === referencePath
        ? 'Reference definition'
        : 'Definition',
    sourceLabel: formatMcpAgentLabel(location.agentId, agentIndex, location.agentLabel, location.configPath),
    path: location.configPath,
    detail: summarizeMcpCommand(location),
    isSelected: location.configPath === selectedVariantPath,
    isCanonical: location.configPath === referencePath,
  }));
}

function buildMcpProvenanceSummary(
  mcp: McpRecord,
  selectedVariantPath: string | null,
  referencePath: string | null,
): InspectorProvenanceSummaryRow[] {
  const pluginLocations = mcp.locations.filter((entry) =>
    entry.provenance?.kind === 'plugin' && entry.provenance.plugin);
  const hasManualLocations = mcp.locations.some((entry) => entry.provenance?.kind !== 'plugin');
  if (pluginLocations.length > 0 && hasManualLocations) {
    return buildMixedMcpSourceSummaryRows(pluginLocations);
  }

  let location: McpLocationRecord | null = null;
  if (selectedVariantPath) {
    location = mcp.locations.find((entry) => entry.configPath === selectedVariantPath) ?? null;
  }
  if (!location && referencePath) {
    location = mcp.locations.find((entry) => entry.configPath === referencePath) ?? null;
  }
  location ??= mcp.locations[0] ?? null;

  return buildSourceSummaryRows(location?.provenance);
}

function buildSubagentProvenanceRows(
  subagent: SubagentRecord,
  selectedVariantPath: string | null,
  referencePath: string | null,
  agentIndex: Map<string, AgentRecord>,
): InspectorProvenanceRow[] {
  return subagent.locations
    .slice()
    .sort(compareSubagentLocationsForDisplay)
    .map((location) => ({
      id: `${location.agentId}:${location.path}`,
      label: location.path === selectedVariantPath
        ? 'Selected definition'
        : location.path === referencePath
          ? 'Reference definition'
          : 'Definition',
      sourceLabel: formatSubagentAgentLabel(location.agentId, agentIndex, location.agentLabel, location.path),
      path: location.path,
      detail: location.fileType === 'symlink'
        ? location.symlinkTarget ?? location.resolvedPath ?? 'Linked copy'
        : formatAgeLabel(location.modifiedAt),
      isSelected: location.path === selectedVariantPath,
      isCanonical: location.path === referencePath,
    }));
}

function buildSubagentProvenanceSummary(
  subagent: SubagentRecord,
  selectedVariantPath: string | null,
  referencePath: string | null,
): InspectorProvenanceSummaryRow[] {
  const pluginLocations = subagent.locations.filter((entry) =>
    entry.provenance?.kind === 'plugin' && entry.provenance.plugin);
  const hasManualLocations = subagent.locations.some((entry) => entry.provenance?.kind !== 'plugin');
  if (pluginLocations.length > 0 && hasManualLocations) {
    return buildMixedSubagentSourceSummaryRows(pluginLocations);
  }

  let location: SubagentLocationRecord | null = null;
  if (selectedVariantPath) {
    location = subagent.locations.find((entry) => entry.path === selectedVariantPath) ?? null;
  }
  if (!location && referencePath) {
    location = subagent.locations.find((entry) => entry.path === referencePath) ?? null;
  }
  location ??= subagent.locations[0] ?? null;

  return buildSourceSummaryRows(location?.provenance);
}

function buildMixedSubagentSourceSummaryRows(pluginLocations: SubagentLocationRecord[]): InspectorProvenanceSummaryRow[] {
  const uniquePlugins = new Map<string, NonNullable<SkillProvenance['plugin']>>();
  for (const location of pluginLocations) {
    const plugin = location.provenance?.plugin;
    if (!plugin) {
      continue;
    }
    uniquePlugins.set(`${plugin.host}:${plugin.pluginId}:${plugin.version ?? ''}`, plugin);
  }

  const [plugin] = uniquePlugins.values();
  return [
    {
      id: 'source-type',
      label: 'Source Type',
      value: 'Plugin + Manual',
    },
    ...(plugin
      ? [{
          id: 'source',
          label: 'Source' as const,
          value: uniquePlugins.size === 1 ? plugin.pluginId : `${uniquePlugins.size} plugin sources`,
          ...(uniquePlugins.size === 1
            ? {
                action: {
                  kind: 'plugin' as const,
                  host: plugin.host,
                  pluginId: plugin.pluginId,
                  version: plugin.version,
                },
              }
            : {}),
        }]
      : []),
  ];
}

function buildMixedMcpSourceSummaryRows(pluginLocations: McpLocationRecord[]): InspectorProvenanceSummaryRow[] {
  const uniquePlugins = new Map<string, NonNullable<SkillProvenance['plugin']>>();
  for (const location of pluginLocations) {
    const plugin = location.provenance?.plugin;
    if (!plugin) {
      continue;
    }
    uniquePlugins.set(`${plugin.host}:${plugin.pluginId}:${plugin.version ?? ''}`, plugin);
  }

  const [plugin] = uniquePlugins.values();
  return [
    {
      id: 'source-type',
      label: 'Source Type',
      value: 'Plugin + Manual',
    },
    ...(plugin
      ? [{
          id: 'source',
          label: 'Source' as const,
          value: uniquePlugins.size === 1 ? plugin.pluginId : `${uniquePlugins.size} plugin sources`,
          ...(uniquePlugins.size === 1
            ? {
                action: {
                  kind: 'plugin' as const,
                  host: plugin.host,
                  pluginId: plugin.pluginId,
                  version: plugin.version,
                },
              }
            : {}),
        }]
      : []),
  ];
}

function buildSourceSummaryRows(
  provenance: SkillProvenance | undefined,
  pluginName?: string,
): InspectorProvenanceSummaryRow[] {
  const sourceType = formatSourceType(provenance);
  const source = formatSourceDetail(provenance, pluginName);

  return [
    {
      id: 'source-type',
      label: 'Source Type',
      value: sourceType,
    },
    ...(source
      ? [{
        id: 'source',
        label: 'Source' as const,
        ...source,
      }]
      : []),
  ];
}

function formatSourceType(provenance: SkillProvenance | undefined): string {
  switch (provenance?.kind) {
    case 'npx':
      return 'NPX';
    case 'plugin':
      return 'Plugin';
    case 'unknown':
      return 'Unknown';
    case undefined:
      return 'Unknown';
    case 'agent-local':
    case 'git':
    case 'manual':
    case 'symlink':
    case 'universal':
    default:
      return 'Manual';
  }
}

function formatSourceDetail(
  provenance: SkillProvenance | undefined,
  pluginName?: string,
): Pick<InspectorProvenanceSummaryRow, 'action' | 'href' | 'value'> | null {
  if (!provenance) {
    return null;
  }

  if (provenance.kind === 'plugin' && provenance.plugin) {
    return {
      value: pluginName ?? provenance.plugin.pluginId,
      action: {
        kind: 'plugin',
        host: provenance.plugin.host,
        pluginId: provenance.plugin.pluginId,
        version: provenance.plugin.version,
      },
    };
  }

  if (provenance.kind === 'npx') {
    return {
      value: provenance.npx?.packageName ?? provenance.npx?.source ?? 'NPX package',
      href: getNpxSourceHref(provenance),
    };
  }

  return null;
}

function getNpxSourceHref(provenance: SkillProvenance): string | undefined {
  const sourceUrl = provenance.npx?.sourceUrl?.trim();
  if (sourceUrl?.startsWith('http://') || sourceUrl?.startsWith('https://')) {
    return sourceUrl;
  }

  const source = provenance.npx?.source?.trim();
  if (!source) {
    return undefined;
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    return source;
  }

  if (provenance.npx?.sourceType === 'github' && /^[^/\s]+\/[^/\s]+$/.test(source)) {
    return `https://github.com/${source.replace(/\.git$/, '')}`;
  }

  return undefined;
}

function getPluginNameForLocation(
  location: SkillLocationRecord | null,
  sourceIndex: Map<string, SkillScanSource>,
): string | undefined {
  if (!location?.sourceId) {
    return undefined;
  }

  return sourceIndex.get(location.sourceId)?.plugin?.pluginName;
}

function hasPluginSkillLocation(skill: SkillRecord, sourceIndex: Map<string, SkillScanSource>): boolean {
  return skill.locations.some((location) =>
    location.provenance?.kind === 'plugin' || sourceIndex.get(location.sourceId)?.kind === 'plugin');
}

function hasPluginMcpLocation(mcp: McpRecord): boolean {
  return mcp.locations.some((location) => location.provenance?.kind === 'plugin');
}

function hasPluginSubagentLocation(subagent: SubagentRecord): boolean {
  return subagent.locations.some((location) =>
    location.agentId.startsWith('plugin:')
    || location.provenance?.kind === 'plugin');
}

function compareSkillLocationForProvenance(left: SkillLocationRecord, right: SkillLocationRecord): number {
  if (left.canonical !== right.canonical) {
    return left.canonical ? -1 : 1;
  }

  const modifiedDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return modifiedDifference || left.path.localeCompare(right.path);
}

function getCanonicalSkillPath(skill: SkillRecord): string | null {
  return skill.locations.find((location) => location.canonical)?.path ?? null;
}

function getCanonicalSubagentPath(subagent: SubagentRecord): string | null {
  return subagent.locations.find((location) => location.canonical)?.path ?? null;
}

function getMcpReferencePath(mcp: McpRecord): string | null {
  if (mcp.locations.length === 0) {
    return null;
  }

  return mcp.locations.find((location) => isAgentsMcpConfigPath(location.configPath))?.configPath ?? mcp.locations[0]?.configPath ?? null;
}

function buildMcpDefinitionText(location?: McpLocationRecord): string | undefined {
  if (!location) {
    return undefined;
  }

  if (!location.command && !location.url && location.args.length === 0) {
    return undefined;
  }

  return [
    location.transport ? `transport: ${location.transport}` : undefined,
    location.command ? `command: ${location.command}` : undefined,
    location.url ? `url: ${location.url}` : undefined,
    `args: ${location.args.join(' ')}`.trim(),
  ].filter(Boolean).join('\n');
}

function summarizeMcpCommand(location?: McpLocationRecord): string {
  if (!location) {
    return 'No command';
  }

  if (location.command) {
    return [location.command, ...location.args].join(' ');
  }

  if (location.url) {
    return location.url;
  }

  if (location.args[0]) {
    return location.args[0];
  }

  return 'No connection target';
}

function resolveSkillsDir(source?: SkillScanSource, agent?: AgentRecord | null): string {
  return source?.skillsDir ?? agent?.skillsLocation.path ?? agent?.defaultGlobalSkillsDir ?? 'Unknown skills directory';
}

function resolveMissingSymlinkPath(
  skill: SkillRecord,
  sourceId: string,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): string {
  const source = sourceIndex.get(sourceId);
  const agent = resolveSkillInstallAgent(sourceId, sourceIndex, agentIndex);
  const skillsDir = resolveSkillsDir(source, agent);
  const normalizedDir = skillsDir.endsWith('/') ? skillsDir.slice(0, -1) : skillsDir;
  const installKind = skill.locations.find((location) => location.installKind)?.installKind ?? 'file';
  return installKind === 'directory'
    ? `${normalizedDir}/${skill.name}`
    : `${normalizedDir}/${skill.name}.md`;
}

function resolveSkillInstallAgent(
  sourceId: string,
  sourceIndex: Map<string, SkillScanSource>,
  agentIndex: Map<string, AgentRecord>,
): AgentRecord | null {
  const directAgent = agentIndex.get(sourceId);
  if (directAgent) {
    return directAgent;
  }

  const source = sourceIndex.get(sourceId);
  if (!source || source.scope === 'custom') {
    return null;
  }

  const compatibleFamilies = source.compatibleAgentFamilies ?? [];
  const compatibleAgents = compatibleFamilies
    .map((family) => agentIndex.get(`${source.scope}-${family}`))
    .filter((agent): agent is AgentRecord => agent !== undefined && agent.installState === 'installed');
  if (compatibleAgents.length === 1) {
    return compatibleAgents[0];
  }

  const pathMatchedAgents = [...agentIndex.values()].filter((agent) =>
    agent.scope === source.scope
    && agent.installState === 'installed'
    && agent.skillsLocation.path === source.skillsDir);
  if (pathMatchedAgents.length === 1) {
    return pathMatchedAgents[0];
  }

  return null;
}

function compareSubagentLocationsForDisplay(left: SubagentLocationRecord, right: SubagentLocationRecord): number {
  if (left.canonical !== right.canonical) {
    return left.canonical ? -1 : 1;
  }

  const modifiedDifference = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return modifiedDifference || left.path.localeCompare(right.path);
}

function getAffectedSubagentSymlinkRepairLocations(
  subagent: SubagentRecord,
  problemKey: 'broken-symlink' | 'wrong-symlink-target',
): SubagentLocationRecord[] {
  return subagent.locations.filter((location) => {
    if (location.canonical || location.fileType !== 'symlink') {
      return false;
    }

    if (problemKey === 'broken-symlink') {
      return !location.resolvedPath;
    }

    return isWrongSubagentSymlinkTarget(subagent, location);
  });
}

function getWrongSubagentSymlinkTargetPath(location: SubagentLocationRecord): string {
  return location.symlinkTarget ?? location.resolvedPath ?? 'Missing target';
}

function isWrongSubagentSymlinkTarget(subagent: SubagentRecord, location: SubagentLocationRecord): boolean {
  const canonicalPath = getCanonicalSubagentPath(subagent);
  if (!canonicalPath) {
    return Boolean(location.symlinkTarget || location.resolvedPath);
  }

  return location.resolvedPath !== canonicalPath && location.symlinkTarget !== canonicalPath;
}

function isSubagentDefinitionMismatch(subagent: SubagentRecord, location: SubagentLocationRecord): boolean {
  const canonicalLocation = subagent.locations.find((candidate) => candidate.canonical) ?? subagent.locations[0] ?? null;
  if (!canonicalLocation || canonicalLocation.path === location.path) {
    return false;
  }

  return getSubagentLocationComparisonKey(canonicalLocation) !== getSubagentLocationComparisonKey(location);
}

function getSubagentLocationComparisonKey(location: Pick<SubagentLocationRecord, 'definitionComparisonKey' | 'definitionText' | 'path'>): string {
  const definitionText = normalizeDefinitionText(location.definitionText);
  return location.definitionComparisonKey ?? (definitionText ? `text:${hashStableString(definitionText)}` : `path:${location.path}`);
}

function stripScopePrefix(label: string): string {
  return label.replace(/^(?:Sandbox|Live)\s+/u, '');
}

function selectProblemKey<T extends InspectorProblemKey>(problemKeys: T[], selectedProblemKey: T | null | undefined): T {
  if (selectedProblemKey && problemKeys.includes(selectedProblemKey)) {
    return selectedProblemKey;
  }

  const defaultProblemKey = problemKeys[0];
  if (!defaultProblemKey) {
    throw new Error('Expected at least one inspector problem key.');
  }

  return defaultProblemKey;
}

function shouldPreferInspectionProblem(problem: InspectorActiveProblemModel): boolean {
  return !problem.primaryActionLabel;
}

function getInspectionRequiredProblemKey<T extends InspectorProblemKey>(problemKeys: T[]): T | null {
  return problemKeys.find(isInspectionRequiredProblemKey) ?? null;
}

function isInspectionRequiredProblemKey(problemKey: InspectorProblemKey): boolean {
  return problemKey === 'invalid-definition' || problemKey === 'connection-failed';
}

function formatProblemCount(count: number): string {
  return `${count} problem${count === 1 ? '' : 's'}`;
}

function formatLocationCount(count: number): string {
  return `${count} ${count === 1 ? 'location' : 'locations'}`;
}

function normalizeDefinitionText(value: string | undefined): string | undefined {
  return value?.replace(/\r\n/g, '\n');
}
