import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type {
  AgentRecord,
  AgentSubagentParserKind,
  PluginRecord,
  PluginSourceRef,
  SkillLocationType,
  SkillProvenance,
  SkillSourceScope,
  SubagentExpectedLocationRecord,
  SubagentInventoryCounts,
  SubagentIssueReason,
  SubagentLocationRecord,
  SubagentRecord,
} from '@shared/contracts';
import type { SkillIndexPaths } from '@shared/skill-index-paths';

import { sanitizeJsonc, stableStringify } from '@main/json-utils';
import {
  getRequiredMarkdownSubagentFields,
  getSubagentFileNameForFormat,
  inferSubagentParserKindFromPath,
  isMarkdownSubagentSymlinkCompatible,
  isSubagentFormatRenderableFromUniversal,
  isSupportedSubagentDirectoryFormat,
} from '@shared/subagent-format-policy';

interface SubagentOwnerRecord {
  agentId: string;
  agentLabel: string;
  family?: string;
  scope: SkillSourceScope;
  directoryPath: string;
  format: AgentSubagentParserKind;
  writable: boolean;
  canonical: boolean;
  plugin?: PluginSourceRef;
}

interface ParsedSubagentDefinition {
  name: string;
  displayName?: string | null;
  description?: string | null;
  prompt?: string;
  definition: Record<string, unknown>;
  invalidDetails: string[];
  definitionText?: string;
}

export interface PortableSubagentDefinition {
  name: string;
  description: string | null;
  prompt: string;
  extras: Record<string, unknown>;
}

export function collectSubagentRecords({
  agents,
  plugins,
  paths,
  includeLiveSources = true,
  includeSandboxSources = false,
}: {
  agents: AgentRecord[];
  plugins: PluginRecord[];
  paths: SkillIndexPaths;
  includeLiveSources?: boolean;
  includeSandboxSources?: boolean;
}): SubagentRecord[] {
  const owners = collectSubagentOwners({
    agents,
    paths,
    includeLiveSources,
    includeSandboxSources,
  });
  const pluginSubagentAliases = buildPluginSubagentAliases(plugins);
  const groupedLocations = new Map<string, SubagentLocationRecord[]>();

  for (const owner of owners) {
    for (const filePath of collectSubagentFilePaths(owner)) {
      const fallbackName = getSubagentNameFromPath(filePath);
      const parsed = readSubagentDefinition(filePath, owner, fallbackName);
      const name = getGroupedSubagentName(filePath, parsed, owner, pluginSubagentAliases);
      const existing = groupedLocations.get(name) ?? [];
      existing.push(buildSubagentLocation(filePath, owner, parsed));
      groupedLocations.set(name, existing);
    }
  }

  for (const plugin of plugins) {
    const pluginSource: PluginSourceRef = {
      host: plugin.host,
      pluginId: plugin.pluginId,
      pluginName: plugin.pluginName,
      version: plugin.version,
      rootPath: plugin.rootPath,
      manifestPath: plugin.manifestPath,
    };
    const owner: SubagentOwnerRecord = {
      agentId: createPluginSubagentOwnerId(plugin),
      agentLabel: `${plugin.host === 'codex' ? 'Codex' : 'Claude'} Plugin ${plugin.pluginName}`,
      scope: plugin.scope ?? 'live',
      directoryPath: plugin.rootPath,
      format: plugin.host === 'codex' ? 'markdown-frontmatter' : 'markdown-frontmatter',
      writable: false,
      canonical: false,
      plugin: pluginSource,
    };

    for (const subagent of plugin.bundledSubagents ?? []) {
      const format = inferSubagentParserKindFromPath(subagent.path, owner.format);
      const parsed = readSubagentDefinition(subagent.path, {
        ...owner,
        format,
      }, subagent.name);
      const name = getGroupedSubagentName(subagent.path, parsed, {
        ...owner,
        format,
      }, pluginSubagentAliases);
      const existing = groupedLocations.get(name) ?? [];
      existing.push(buildSubagentLocation(subagent.path, {
        ...owner,
        format,
      }, parsed));
      groupedLocations.set(name, existing);
    }
  }

  const expectedOwners = owners.filter((owner) => !owner.canonical && !owner.plugin);
  return [...groupedLocations.entries()]
    .map(([name, locations]) => classifySubagentLocations(name, locations, expectedOwners))
    .sort(compareSubagents);
}

export function countSubagents(subagents: SubagentRecord[]): SubagentInventoryCounts {
  return subagents.reduce<SubagentInventoryCounts>(
    (counts, subagent) => {
      counts.totalSubagents += 1;
      if (subagent.status === 'healthy') {
        counts.healthySubagents += 1;
      } else if (subagent.presentation === 'dismissed') {
        counts.dismissedAttentionSubagents += 1;
      } else {
        counts.attentionSubagents += 1;
      }

      return counts;
    },
    {
      totalSubagents: 0,
      attentionSubagents: 0,
      healthySubagents: 0,
      dismissedAttentionSubagents: 0,
    },
  );
}

function collectSubagentOwners({
  agents,
  paths,
  includeLiveSources,
  includeSandboxSources,
}: {
  agents: AgentRecord[];
  paths: SkillIndexPaths;
  includeLiveSources: boolean;
  includeSandboxSources: boolean;
}): SubagentOwnerRecord[] {
  const owners: SubagentOwnerRecord[] = [];
  if (includeLiveSources) {
    owners.push({
      agentId: 'live-agents-subagents',
      agentLabel: 'Live .agents',
      scope: 'live',
      directoryPath: resolveCanonicalSubagentsDir(paths.liveCanonicalUserSkillsDir),
      format: 'markdown-frontmatter',
      writable: true,
      canonical: true,
    });
  }

  if (includeSandboxSources) {
    owners.push({
      agentId: 'sandbox-agents-subagents',
      agentLabel: 'Sandbox .agents',
      scope: 'sandbox',
      directoryPath: resolveCanonicalSubagentsDir(paths.sandboxCanonicalUserSkillsDir),
      format: 'markdown-frontmatter',
      writable: true,
      canonical: true,
    });
  }

  for (const agent of agents) {
    const format = agent.subagentParserKind ?? 'unknown';
    if (
      agent.installState !== 'installed'
      || agent.subagentsLocation?.state !== 'available'
      || !agent.subagentsLocation.path
      || !isSupportedSubagentDirectoryFormat(format)
    ) {
      continue;
    }

    owners.push({
      agentId: agent.id,
      agentLabel: agent.label,
      family: agent.family,
      scope: agent.scope,
      directoryPath: agent.subagentsLocation.path,
      format,
      writable: agent.writable,
      canonical: false,
    });
  }

  return owners.sort((left, right) =>
    left.agentLabel.localeCompare(right.agentLabel, undefined, { sensitivity: 'base' }));
}

function collectSubagentFilePaths(owner: SubagentOwnerRecord): string[] {
  let entries;
  try {
    entries = readdirSync(owner.directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(owner.directoryPath, entry.name);
    if (entry.isFile() || entry.isSymbolicLink()) {
      if (isSupportedSubagentFile(owner, entry.name)) {
        paths.push(filePath);
      }
      continue;
    }

    if (entry.isDirectory() && owner.family === 'deepagents') {
      const nestedPath = path.join(filePath, 'AGENTS.md');
      if (safeFileExists(nestedPath)) {
        paths.push(nestedPath);
      }
    }
  }

  return paths.sort((left, right) => left.localeCompare(right));
}

function isSupportedSubagentFile(owner: SubagentOwnerRecord, fileName: string): boolean {
  switch (owner.format) {
    case 'codex-toml':
      return /\.toml$/iu.test(fileName);
    case 'json':
      return /\.json$/iu.test(fileName);
    case 'jsonc':
      return /\.jsonc?$/iu.test(fileName);
    case 'toml':
      return /\.toml$/iu.test(fileName);
    case 'yaml':
      return /\.ya?ml$/iu.test(fileName);
    case 'markdown-frontmatter':
      return /\.md$/iu.test(fileName);
    default:
      return false;
  }
}

function buildSubagentLocation(
  filePath: string,
  owner: SubagentOwnerRecord,
  parsed: ParsedSubagentDefinition,
): SubagentLocationRecord {
  const stats = lstatSync(filePath);
  const fileType: SkillLocationType = stats.isSymbolicLink() ? 'symlink' : 'real-file';
  const resolvedPath = safeRealpathSync(filePath);
  const modifiedAt = new Date(stats.mtimeMs).toISOString();
  const definitionComparisonKey = parsed.invalidDetails.length === 0 && fileType === 'real-file'
    ? stableStringify(normalizeSubagentDefinition(parsed.definition))
    : undefined;
  const localExtrasKeys = parsed.invalidDetails.length === 0 && fileType === 'real-file'
    ? Object.keys(omitSubagentAliasFields(parsed.definition)).sort()
    : [];

  return {
    agentId: owner.agentId,
    agentLabel: owner.agentLabel,
    scope: owner.scope,
    path: filePath,
    directoryPath: owner.directoryPath,
    fileType,
    modifiedAt,
    canonical: owner.canonical,
    format: owner.format,
    definitionText: parsed.definitionText,
    definitionComparisonKey,
    localExtrasKeys: localExtrasKeys.length > 0 ? localExtrasKeys : undefined,
    invalidDetails: parsed.invalidDetails.length > 0 ? parsed.invalidDetails : undefined,
    resolvedPath,
    symlinkTarget: fileType === 'symlink' ? resolvedPath : undefined,
    provenance: createSubagentProvenance(filePath, owner, modifiedAt),
    canonicalRole: owner.canonical ? 'canonical' : 'materialized-copy',
    mutability: owner.writable ? 'writable' : owner.plugin ? 'read-only-managed' : 'unknown',
  };
}

function classifySubagentLocations(
  name: string,
  locations: SubagentLocationRecord[],
  expectedOwners: SubagentOwnerRecord[],
): SubagentRecord {
  const sortedLocations = [...locations].sort((left, right) =>
    left.path.localeCompare(right.path) || left.agentId.localeCompare(right.agentId));
  const canonicalLocation = sortedLocations.find((location) => location.canonical && location.fileType === 'real-file') ?? null;
  const validLocations = sortedLocations.filter((location) => (location.invalidDetails?.length ?? 0) === 0);
  const validComparisonKeys = new Set(validLocations
    .map((location) => location.definitionComparisonKey)
    .filter((value): value is string => typeof value === 'string' && value.length > 0));
  const issueReasons = new Set<SubagentIssueReason>();

  if (sortedLocations.some((location) => (location.invalidDetails?.length ?? 0) > 0)) {
    issueReasons.add('invalid-definition');
  }

  if (!canonicalLocation) {
    issueReasons.add('missing-universal');
  }

  const expectedLocations = canonicalLocation
    ? expectedOwners.map((owner) => buildExpectedLocation(owner, name, canonicalLocation))
    : [];
  const presentAgentIds = new Set(sortedLocations.map((location) => location.agentId));
  const missingLocations = expectedLocations.filter((location) =>
    location.supportStatus !== 'unsupported' && !presentAgentIds.has(location.agentId));
  if (missingLocations.length > 0) {
    issueReasons.add('missing-from-agents');
  }

  if (validComparisonKeys.size > 1) {
    issueReasons.add('definition-mismatch');
  }

  if (canonicalLocation) {
    const canonicalResolvedPath = canonicalLocation.resolvedPath ?? canonicalLocation.path;
    const sameFormatDuplicates = sortedLocations.filter((location) =>
      !location.canonical
      && location.fileType === 'real-file'
      && location.mutability === 'writable'
      && location.format === canonicalLocation.format
      && isMarkdownSubagentSymlinkCompatible(findSubagentOwnerForLocation(location, expectedOwners)?.family)
      && !hasSubagentLocalExtras(location)
      && location.definitionComparisonKey === canonicalLocation.definitionComparisonKey);
    if (sameFormatDuplicates.length > 0) {
      issueReasons.add('identical-copies');
    }

    for (const location of sortedLocations) {
      if (location.canonical || location.fileType !== 'symlink') {
        continue;
      }
      if (!location.resolvedPath) {
        issueReasons.add('broken-symlink');
        continue;
      }
      if (path.normalize(location.resolvedPath) !== path.normalize(canonicalResolvedPath)) {
        issueReasons.add('wrong-symlink-target');
      }
    }
  }

  const issueReasonsList = [...issueReasons].sort(compareSubagentIssueReasons);
  const status = issueReasonsList.length > 0 ? 'needs-attention' : 'healthy';

  return {
    name,
    displayName: getSubagentDisplayName(name),
    description: getSubagentDescription(sortedLocations),
    status,
    presentation: status === 'needs-attention' ? 'active' : 'none',
    locations: sortedLocations,
    expectedLocations,
    missingLocations,
    issueReasons: issueReasonsList,
    signature: status === 'needs-attention'
      ? createSubagentSignature(name, sortedLocations, expectedLocations, missingLocations, issueReasonsList)
      : undefined,
  };
}

function buildExpectedLocation(
  owner: SubagentOwnerRecord,
  name: string,
  canonicalLocation: SubagentLocationRecord,
): SubagentExpectedLocationRecord {
  const renderable = isRenderableFromCanonical(owner, canonicalLocation);
  return {
    agentId: owner.agentId,
    agentLabel: owner.agentLabel,
    scope: owner.scope,
    directoryPath: owner.directoryPath,
    path: path.join(owner.directoryPath, getSubagentFileNameForOwner(owner, name, canonicalLocation)),
    format: owner.format,
    supportStatus: renderable ? 'supported' : 'unsupported',
    unsupportedReason: renderable ? undefined : 'unsupported-format',
  };
}

function isRenderableFromCanonical(owner: SubagentOwnerRecord, canonicalLocation: SubagentLocationRecord): boolean {
  return isSubagentFormatRenderableFromUniversal(owner.format, canonicalLocation.format);
}

function findSubagentOwnerForLocation(
  location: SubagentLocationRecord,
  owners: SubagentOwnerRecord[],
): SubagentOwnerRecord | undefined {
  return owners.find((owner) =>
    owner.agentId === location.agentId
    && owner.directoryPath === location.directoryPath);
}

function getSubagentFileNameForOwner(
  owner: Pick<SubagentOwnerRecord, 'family' | 'format'>,
  name: string,
  canonicalLocation?: Pick<SubagentLocationRecord, 'path'>,
): string {
  return getSubagentFileNameForFormat({
    name,
    format: owner.format,
    family: owner.family,
    canonicalPath: canonicalLocation?.path,
  });
}

export function readPortableSubagentDefinitionFromFile({
  family,
  filePath,
  format,
  fallbackName,
}: {
  family?: string;
  filePath: string;
  format: AgentSubagentParserKind;
  fallbackName?: string;
}): PortableSubagentDefinition {
  const parsed = readSubagentDefinition(filePath, {
    agentId: 'portable-reader',
    agentLabel: 'Portable Reader',
    family,
    scope: 'live',
    directoryPath: path.dirname(filePath),
    format,
    writable: false,
    canonical: false,
  }, fallbackName);
  if (parsed.invalidDetails.length > 0) {
    throw new Error(parsed.invalidDetails.join(' '));
  }

  return toPortableSubagentDefinition(parsed);
}

export function renderPortableSubagentDefinition(
  definition: PortableSubagentDefinition,
  format: AgentSubagentParserKind,
  options: { family?: string } = {},
): string {
  switch (format) {
    case 'codex-toml':
      assertPortableSubagentCanRender(definition, format);
      return renderTomlFields({
        name: definition.name,
        description: definition.description,
        developer_instructions: definition.prompt,
        ...definition.extras,
      });
    case 'json':
    case 'jsonc':
      assertPortableSubagentCanRender(definition, format);
      return `${JSON.stringify({
        name: definition.name,
        description: definition.description,
        prompt: definition.prompt,
        ...definition.extras,
      }, null, 2)}\n`;
    case 'toml':
      assertPortableSubagentCanRender(definition, format);
      return renderTomlFields({
        agent_type: 'subagent',
        name: definition.name,
        description: definition.description,
        instructions: definition.prompt,
        ...definition.extras,
      });
    case 'markdown-frontmatter':
      assertPortableSubagentCanRender(definition, format);
      return renderMarkdownSubagentDefinition(definition, options.family);
    case 'yaml':
      assertPortableSubagentCanRender(definition, format);
      return renderYamlFields({
        name: definition.name,
        description: definition.description,
        prompt: definition.prompt,
        ...definition.extras,
      });
    default:
      throw new Error(`Subagent resolution is not supported for ${format} definitions.`);
  }
}

function readSubagentDefinition(
  filePath: string,
  owner: SubagentOwnerRecord,
  fallbackName = getSubagentNameFromPath(filePath),
): ParsedSubagentDefinition {
  let raw = '';
  const invalidDetails: string[] = [];
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    if (isBrokenSubagentSymlink(filePath)) {
      return {
        name: fallbackName,
        description: null,
        invalidDetails: [],
        definition: { name: fallbackName },
      };
    }

    return {
      name: fallbackName,
      description: null,
      invalidDetails: ['Skill Index could not read this subagent file.'],
      definition: { name: fallbackName },
    };
  }

  try {
    switch (owner.format) {
      case 'codex-toml':
        return readCodexTomlSubagent(raw, fallbackName);
      case 'json':
      case 'jsonc':
        return readJsonSubagent(raw, fallbackName, owner.format === 'jsonc');
      case 'toml':
        return readGenericTomlSubagent(raw, fallbackName);
      case 'yaml':
        return readYamlSubagent(raw, fallbackName);
      case 'markdown-frontmatter':
      default:
        return readMarkdownSubagent(raw, fallbackName, owner.family);
    }
  } catch (error) {
    invalidDetails.push(error instanceof Error ? error.message : 'Skill Index could not parse this subagent file.');
    return {
      name: fallbackName,
      description: null,
      invalidDetails,
      definition: { name: fallbackName },
      definitionText: raw,
    };
  }
}

function readMarkdownSubagent(raw: string, fallbackName: string, family?: string): ParsedSubagentDefinition {
  const frontMatter = parseFrontMatter(raw);
  const invalidDetails: string[] = [];
  if (frontMatter.malformed) {
    invalidDetails.push('The front matter opens with --- but does not close cleanly.');
  }

  const fields = frontMatter.fields;
  const name = getStringField(fields, 'name') ?? getStringField(fields, 'agentType') ?? fallbackName;
  const description = getStringField(fields, 'description') ?? getStringField(fields, 'whenToUse') ?? null;
  const prompt = getStringField(fields, 'systemPrompt') ?? frontMatter.body.trim();
  const requiredFields = getRequiredMarkdownSubagentFields(family);

  for (const field of requiredFields) {
    if (!hasRequiredMarkdownField(fields, field)) {
      invalidDetails.push(`Missing required field: ${field}`);
    }
  }

  return {
    name,
    displayName: name,
    description,
    prompt: prompt ?? undefined,
    invalidDetails,
    definition: {
      ...fields,
      name,
      description,
      prompt,
    },
    definitionText: raw,
  };
}

function readCodexTomlSubagent(raw: string, fallbackName: string): ParsedSubagentDefinition {
  const values = parseFlatToml(raw);
  const name = getStringField(values, 'name') ?? fallbackName;
  const description = getStringField(values, 'description') ?? null;
  const prompt = getStringField(values, 'developer_instructions');
  const invalidDetails: string[] = [];
  for (const field of ['name', 'description', 'developer_instructions']) {
    if (!getStringField(values, field)) {
      invalidDetails.push(`Missing required field: ${field}`);
    }
  }

  return {
    name,
    displayName: name,
    description,
    prompt: prompt ?? undefined,
    invalidDetails,
    definition: {
      ...values,
      name,
      description,
      prompt,
    },
    definitionText: raw,
  };
}

function readGenericTomlSubagent(raw: string, fallbackName: string): ParsedSubagentDefinition {
  const values = parseFlatToml(raw);
  const name = getStringField(values, 'name') ?? getStringField(values, 'display_name') ?? fallbackName;
  const description = getStringField(values, 'description') ?? null;
  const prompt = getStringField(values, 'instructions') ?? getStringField(values, 'prompt');
  const invalidDetails: string[] = [];
  if (getStringField(values, 'agent_type') && getStringField(values, 'agent_type') !== 'subagent') {
    invalidDetails.push('This agent TOML is not marked as agent_type = "subagent".');
  }
  if (!description) {
    invalidDetails.push('Missing required field: description');
  }
  if (!prompt) {
    invalidDetails.push('Missing required field: instructions');
  }

  return {
    name,
    displayName: getStringField(values, 'display_name') ?? name,
    description,
    prompt: prompt ?? undefined,
    invalidDetails,
    definition: {
      ...values,
      name,
      description,
      prompt,
    },
    definitionText: raw,
  };
}

function readJsonSubagent(raw: string, fallbackName: string, jsonc: boolean): ParsedSubagentDefinition {
  const parsed = JSON.parse(jsonc ? sanitizeJsonc(raw) : raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Subagent JSON must be an object.');
  }

  const name = getStringField(parsed, 'name') ?? fallbackName;
  const description = getStringField(parsed, 'description') ?? null;
  const prompt = getStringField(parsed, 'prompt') ?? getStringField(parsed, 'systemPrompt');
  const invalidDetails: string[] = [];
  if (!description) {
    invalidDetails.push('Missing required field: description');
  }
  if (!prompt) {
    invalidDetails.push('Missing required field: prompt');
  }

  return {
    name,
    displayName: name,
    description,
    prompt: prompt ?? undefined,
    invalidDetails,
    definition: {
      ...parsed,
      name,
      description,
      prompt,
    },
    definitionText: raw,
  };
}

function readYamlSubagent(raw: string, fallbackName: string): ParsedSubagentDefinition {
  const values = parseFlatYaml(raw);
  const name = getStringField(values, 'name') ?? getStringField(values, 'agentType') ?? fallbackName;
  const description = getStringField(values, 'description') ?? getStringField(values, 'whenToUse') ?? null;
  const prompt = getStringField(values, 'prompt')
    ?? getStringField(values, 'systemPrompt')
    ?? getStringField(values, 'instructions');
  const invalidDetails: string[] = [];
  if (!description) {
    invalidDetails.push('Missing required field: description');
  }
  if (!prompt) {
    invalidDetails.push('Missing required field: prompt');
  }

  return {
    name,
    displayName: name,
    description,
    prompt: prompt ?? undefined,
    invalidDetails,
    definition: {
      ...values,
      name,
      description,
      prompt,
    },
    definitionText: raw,
  };
}

function parseFrontMatter(raw: string): {
  body: string;
  fields: Record<string, unknown>;
  malformed: boolean;
} {
  const normalizedContent = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const lines = normalizedContent.split(/\r?\n/u);
  if (lines[0] !== '---') {
    return { body: normalizedContent, fields: {}, malformed: false };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  if (closingIndex < 0) {
    return { body: normalizedContent, fields: {}, malformed: true };
  }

  const fields: Record<string, unknown> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([A-Za-z][A-Za-z0-9_.-]*):(?:\s*(.*))?$/u.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2] ?? '';
    if (key) {
      fields[key] = parseYamlScalar(rawValue);
    }
  }

  return {
    body: lines.slice(closingIndex + 1).join('\n'),
    fields,
    malformed: false,
  };
}

function parseFlatYaml(raw: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const originalLine = lines[index] ?? '';
    const line = stripComment(originalLine).trim();
    if (!line || line === '---' || line === '...') {
      continue;
    }

    const match = /^([A-Za-z][A-Za-z0-9_.-]*):(?:\s*(.*))?$/u.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (key) {
      const rawValue = match[2] ?? '';
      if (rawValue.trim() === '|' || rawValue.trim() === '>') {
        const parsed = readYamlBlockScalar(lines, index, rawValue.trim() === '>');
        values[key] = parsed.value;
        index = parsed.endIndex;
        continue;
      }

      if (rawValue.trim() === '') {
        const parsed = readYamlIndentedList(lines, index, getLeadingWhitespace(originalLine).length);
        if (parsed) {
          values[key] = parsed.value;
          index = parsed.endIndex;
          continue;
        }
      }

      values[key] = parseYamlScalar(rawValue);
    }
  }

  return values;
}

function readYamlBlockScalar(
  lines: string[],
  startIndex: number,
  fold: boolean,
): { value: string; endIndex: number } {
  const chunks: string[] = [];
  let endIndex = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length > 0 && getLeadingWhitespace(line).length === 0) {
      break;
    }

    chunks.push(line);
    endIndex = index;
  }

  const normalized = trimYamlIndentedBlock(chunks);
  return {
    value: fold ? normalized.replace(/\n+/gu, ' ').trim() : normalized,
    endIndex,
  };
}

function readYamlIndentedList(
  lines: string[],
  startIndex: number,
  parentIndent: number,
): { value: unknown[]; endIndex: number } | null {
  const values: unknown[] = [];
  let endIndex = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      continue;
    }

    const indent = getLeadingWhitespace(line).length;
    if (indent <= parentIndent) {
      break;
    }

    const item = /^-\s*(.*)$/u.exec(line.trim());
    if (!item) {
      break;
    }

    values.push(parseYamlScalar(item[1] ?? ''));
    endIndex = index;
  }

  return values.length > 0 ? { value: values, endIndex } : null;
}

function trimYamlIndentedBlock(lines: string[]): string {
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const indent = nonEmptyLines.reduce(
    (current, line) => Math.min(current, getLeadingWhitespace(line).length),
    Number.POSITIVE_INFINITY,
  );
  const trimLength = Number.isFinite(indent) ? indent : 0;
  return lines
    .map((line) => line.slice(trimLength))
    .join('\n')
    .replace(/\n+$/u, '');
}

function getLeadingWhitespace(line: string): string {
  return /^\s*/u.exec(line)?.[0] ?? '';
}

function parseFlatToml(raw: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = stripComment(line).trim();
    if (!trimmed || trimmed.startsWith('[')) {
      continue;
    }

    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(trimmed);
    if (!assignment) {
      continue;
    }

    const key = assignment[1];
    if (key) {
      const rawValue = assignment[2] ?? '';
      if (rawValue.trim().startsWith('"""')) {
        const parsed = readTomlMultilineString(rawValue, lines, index);
        values[key] = parsed.value;
        index = parsed.endIndex;
        continue;
      }

      values[key] = parseYamlScalar(rawValue);
    }
  }

  return values;
}

function readTomlMultilineString(
  openingValue: string,
  lines: string[],
  startIndex: number,
): { value: string; endIndex: number } {
  const openingIndex = openingValue.indexOf('"""');
  const firstChunk = openingValue.slice(openingIndex + 3);
  const sameLineEnd = firstChunk.indexOf('"""');
  if (sameLineEnd >= 0) {
    return {
      value: firstChunk.slice(0, sameLineEnd),
      endIndex: startIndex,
    };
  }

  const chunks = [firstChunk];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const endIndex = line.indexOf('"""');
    if (endIndex >= 0) {
      chunks.push(line.slice(0, endIndex));
      return {
        value: trimTomlMultilineString(chunks.join('\n')),
        endIndex: index,
      };
    }
    chunks.push(line);
  }

  return {
    value: trimTomlMultilineString(chunks.join('\n')),
    endIndex: lines.length - 1,
  };
}

function trimTomlMultilineString(value: string): string {
  return value.replace(/^\n/u, '').replace(/\n$/u, '');
}

function parseYamlScalar(value: string): unknown {
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
    return trimmedValue.slice(1, -1)
      .split(',')
      .map((entry) => parseYamlScalar(entry))
      .filter((entry) => entry !== '');
  }
  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    try {
      return JSON.parse(trimmedValue) as unknown;
    } catch {
      return trimmedValue.slice(1, -1);
    }
  }
  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return trimmedValue.slice(1, -1);
  }
  if (trimmedValue === 'true') {
    return true;
  }
  if (trimmedValue === 'false') {
    return false;
  }
  const numberValue = Number(trimmedValue);
  if (Number.isFinite(numberValue) && trimmedValue !== '') {
    return numberValue;
  }
  return trimmedValue;
}

function stripComment(line: string): string {
  let inQuote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === '"' || character === "'") && line[index - 1] !== '\\') {
      inQuote = inQuote === character ? null : inQuote ?? character;
    }
    if (character === '#' && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function normalizeSubagentDefinition(definition: Record<string, unknown>): Record<string, unknown> {
  const name = getStringField(definition, 'name')
    ?? getStringField(definition, 'agentType')
    ?? getStringField(definition, 'display_name')
    ?? '';
  const description = getStringField(definition, 'description')
    ?? getStringField(definition, 'whenToUse')
    ?? null;
  const prompt = getStringField(definition, 'prompt')
    ?? getStringField(definition, 'systemPrompt')
    ?? getStringField(definition, 'developer_instructions')
    ?? getStringField(definition, 'instructions')
    ?? '';
  return {
    name,
    description,
    prompt,
  };
}

function toPortableSubagentDefinition(parsed: ParsedSubagentDefinition): PortableSubagentDefinition {
  const normalized = normalizeSubagentDefinition(parsed.definition);
  return {
    name: getStringField(normalized, 'name') ?? parsed.name,
    description: getStringField(normalized, 'description') ?? parsed.description ?? null,
    prompt: getStringField(normalized, 'prompt') ?? parsed.prompt ?? '',
    extras: omitSubagentAliasFields(parsed.definition),
  };
}

function omitSubagentAliasFields(definition: Record<string, unknown>): Record<string, unknown> {
  const omittedKeys = new Set([
    'agent_type',
    'agentType',
    'description',
    'developer_instructions',
    'displayName',
    'display_name',
    'instructions',
    'name',
    'prompt',
    'systemPrompt',
    'whenToUse',
  ]);
  return Object.fromEntries(
    Object.entries(definition)
      .filter(([key, value]) => !omittedKeys.has(key) && value !== undefined && value !== null),
  );
}

function hasSubagentLocalExtras(location: Pick<SubagentLocationRecord, 'localExtrasKeys'>): boolean {
  return (location.localExtrasKeys?.length ?? 0) > 0;
}

function assertPortableSubagentCanRender(
  definition: PortableSubagentDefinition,
  format: AgentSubagentParserKind,
): void {
  if (!definition.name.trim()) {
    throw new Error('Subagent definitions need a name before Skill Index can write them.');
  }
  if (!definition.description?.trim()) {
    throw new Error('Subagent definitions need a description before Skill Index can write them.');
  }
  if (format !== 'markdown-frontmatter' && !definition.prompt.trim()) {
    throw new Error(`Subagent definitions need prompt text before Skill Index can write ${format} files.`);
  }
}

function renderMarkdownSubagentDefinition(
  definition: PortableSubagentDefinition,
  family: string | undefined,
): string {
  if (family === 'iflow-cli') {
    if (!definition.prompt.trim()) {
      throw new Error('iFlow CLI subagent definitions need prompt text before Skill Index can write them.');
    }

    return `---\n${renderYamlFields({
      ...definition.extras,
      agentType: definition.name,
      whenToUse: definition.description,
      systemPrompt: definition.prompt,
    })}---\n`;
  }

  const fields: Record<string, unknown> = {
    ...definition.extras,
    name: definition.name,
    description: definition.description,
  };
  if (family === 'mux') {
    fields['subagent.runnable'] = true;
  }

  return `---\n${renderYamlFields(fields)}---\n${definition.prompt.trimEnd()}\n`;
}

function renderYamlFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${renderYamlScalar(value)}`)
    .join('\n')
    .concat('\n');
}

function renderTomlFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key} = ${renderTomlScalar(value)}`)
    .join('\n')
    .concat('\n');
}

function renderYamlScalar(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(renderYamlScalar).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function renderTomlScalar(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(renderTomlScalar).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function getStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hasRequiredMarkdownField(fields: Record<string, unknown>, field: string): boolean {
  if (field === 'subagent.runnable') {
    return fields[field] === true || getStringField(fields, field) === 'true';
  }

  return Boolean(getStringField(fields, field));
}

function getSubagentDescription(locations: SubagentLocationRecord[]): string | null {
  for (const location of [...locations].sort((left, right) => Number(right.canonical) - Number(left.canonical))) {
    try {
      const parsed = readSubagentDefinition(location.path, {
        agentId: location.agentId,
        agentLabel: location.agentLabel,
        scope: location.scope,
        directoryPath: location.directoryPath,
        format: location.format,
        writable: location.mutability === 'writable',
        canonical: location.canonical,
      });
      if (parsed.description) {
        return parsed.description;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getSubagentDisplayName(name: string): string {
  return getUnqualifiedSubagentName(name);
}

function getUnqualifiedSubagentName(name: string): string {
  const qualifierEnd = name.indexOf(':');
  return qualifierEnd >= 0 ? name.slice(qualifierEnd + 1) : name;
}

function getGroupedSubagentName(
  filePath: string,
  parsed: ParsedSubagentDefinition,
  owner: SubagentOwnerRecord,
  pluginSubagentAliases: Map<string, string>,
): string {
  const baseName = isSymlink(filePath) ? getSubagentNameFromPath(filePath) : parsed.name;
  if (owner.plugin) {
    return `${owner.plugin.pluginName}:${baseName}`;
  }

  return pluginSubagentAliases.get(getPluginSubagentAliasKey(owner.scope, filePath, parsed.name)) ?? baseName;
}

function getSubagentNameFromPath(filePath: string): string {
  return path.basename(filePath).replace(/(?:\.agent)?\.(?:md|toml|jsonc?|ya?ml)$/iu, '');
}

function buildPluginSubagentAliases(plugins: PluginRecord[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const plugin of plugins) {
    for (const subagent of plugin.bundledSubagents ?? []) {
      const scopedName = `${plugin.pluginName}:${subagent.name}`;
      const fileBaseName = getSanitizedSubagentFileBaseName(scopedName);
      aliases.set(buildPluginSubagentAliasKey(plugin.scope ?? 'live', fileBaseName, subagent.name), scopedName);
    }
  }
  return aliases;
}

function getPluginSubagentAliasKey(scope: SkillSourceScope, filePath: string, definitionName: string): string {
  return buildPluginSubagentAliasKey(scope, getSubagentNameFromPath(filePath), definitionName);
}

function buildPluginSubagentAliasKey(scope: SkillSourceScope, fileBaseName: string, definitionName: string): string {
  return `${scope}:${fileBaseName}:${definitionName}`;
}

function getSanitizedSubagentFileBaseName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/gu, '-');
}

function isSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function isBrokenSubagentSymlink(filePath: string): boolean {
  return isSymlink(filePath) && safeRealpathSync(filePath) === undefined;
}

function createSubagentProvenance(
  filePath: string,
  owner: SubagentOwnerRecord,
  discoveredAt: string,
): SkillProvenance {
  if (owner.plugin) {
    return {
      kind: 'plugin',
      plugin: {
        host: owner.plugin.host,
        pluginId: owner.plugin.pluginId,
        version: owner.plugin.version,
      },
      sourcePath: filePath,
      discoveredAt,
    };
  }

  return {
    kind: owner.canonical ? 'universal' : 'agent-local',
    sourcePath: filePath,
    discoveredAt,
  };
}

function createPluginSubagentOwnerId(plugin: Pick<PluginRecord, 'host' | 'pluginId' | 'version' | 'scope'>): string {
  const scopePrefix = plugin.scope === 'sandbox' ? 'sandbox:' : '';
  return `plugin:${scopePrefix}${plugin.host}:${plugin.pluginId}:${plugin.version ?? 'unknown'}:subagents`;
}

function createSubagentSignature(
  name: string,
  locations: SubagentLocationRecord[],
  expectedLocations: SubagentExpectedLocationRecord[],
  missingLocations: SubagentExpectedLocationRecord[],
  issueReasons: SubagentIssueReason[],
): string {
  return stableStringify({
    name,
    issueReasons,
    locations: locations.map((location) => ({
      agentId: location.agentId,
      path: location.path,
      resolvedPath: location.resolvedPath,
      fileType: location.fileType,
      definitionComparisonKey: location.definitionComparisonKey,
      invalidDetails: location.invalidDetails,
    })),
    expectedLocations: expectedLocations.map((location) => ({
      agentId: location.agentId,
      path: location.path,
      supportStatus: location.supportStatus,
    })),
    missingLocations: missingLocations.map((location) => ({
      agentId: location.agentId,
      path: location.path,
    })),
  });
}

function compareSubagents(left: SubagentRecord, right: SubagentRecord): number {
  const presentationRank = getSubagentPresentationRank(left) - getSubagentPresentationRank(right);
  return presentationRank
    || right.issueReasons.length - left.issueReasons.length
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function getSubagentPresentationRank(subagent: SubagentRecord): number {
  if (subagent.presentation === 'active') {
    return 0;
  }
  if (subagent.presentation === 'dismissed') {
    return 1;
  }
  return 2;
}

function compareSubagentIssueReasons(left: SubagentIssueReason, right: SubagentIssueReason): number {
  return getSubagentIssueRank(left) - getSubagentIssueRank(right);
}

function getSubagentIssueRank(reason: SubagentIssueReason): number {
  switch (reason) {
    case 'definition-mismatch':
      return 0;
    case 'wrong-symlink-target':
      return 1;
    case 'broken-symlink':
      return 2;
    case 'identical-copies':
      return 3;
    case 'missing-universal':
      return 4;
    case 'missing-from-agents':
      return 5;
    case 'invalid-definition':
      return 6;
  }
}

function resolveCanonicalSubagentsDir(canonicalSkillsDir: string): string {
  return path.join(path.dirname(canonicalSkillsDir), 'agents');
}

function safeFileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeRealpathSync(filePath: string): string | undefined {
  try {
    return realpathSync(filePath);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
