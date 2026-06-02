import { lstat, mkdir, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  AddSubagentDefinitionFormat,
  AddSubagentRequest,
  AgentRecord,
  AgentSubagentParserKind,
  SkillInventorySnapshot,
} from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPaths,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';
import {
  getSubagentFileNameForFormat,
  isMarkdownSubagentSymlinkCompatible,
  isSubagentFormatRenderableFromUniversal,
  isSupportedSubagentDirectoryFormat,
} from '@shared/subagent-format-policy';

import { buildInventoryAgents } from '@main/inventory-source-model';
import { scanInventory, type ScanSkillInventoryOptions } from '@main/scan-inventory';
import {
  readPortableSubagentDefinitionFromText,
  renderPortableSubagentDefinition,
  type PortableSubagentDefinition,
} from '@main/subagent-inventory';

type InspectInstallPath = (targetPath: string) => Promise<unknown>;

export interface AddSubagentOptions extends ScanSkillInventoryOptions {
  inspectInstallPath?: InspectInstallPath;
  paths?: SkillIndexPaths;
}

interface InstallTargetContext {
  canonicalSubagentsDir: string;
  linkedAgents: AgentRecord[];
  scope: 'sandbox' | 'live';
}

interface SubagentInstallTarget {
  family?: string;
  format: AddSubagentDefinitionFormat;
  path: string;
  symlinkToCanonical: boolean;
}

export async function addSubagent(
  request: AddSubagentRequest,
  options: AddSubagentOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const installTargets = await resolveInstallTargetContext({
    ...options,
    paths,
  });
  const definition = normalizeSubagentDefinitionRequest(request);
  const canonicalPath = path.join(
    installTargets.canonicalSubagentsDir,
    getSubagentFileNameForFormat({ name: definition.name, format: 'markdown-frontmatter' }),
  );
  const targetPaths = buildSubagentInstallTargets(definition, canonicalPath, installTargets);

  await assertInstallPathsAreAvailable(
    [canonicalPath, ...targetPaths.map((target) => target.path)],
    options.inspectInstallPath ?? inspectPath,
  );
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await writeFile(canonicalPath, renderPortableSubagentDefinition(definition, 'markdown-frontmatter'), 'utf8');

  await Promise.all(targetPaths.map(async (target) => {
    await mkdir(path.dirname(target.path), { recursive: true });
    if (target.symlinkToCanonical) {
      await symlink(canonicalPath, target.path);
      return;
    }

    await writeFile(
      target.path,
      renderPortableSubagentDefinition(definition, target.format, { family: target.family }),
      'utf8',
    );
  }));

  return scanInventory({
    ...options,
    includeSandboxSources: installTargets.scope === 'sandbox',
    includeLiveSources: installTargets.scope === 'live',
    paths,
  });
}

export function resolveAddSubagentName(request: AddSubagentRequest): string {
  return normalizeSubagentDefinitionRequest(request).name;
}

function normalizeSubagentDefinitionRequest(request: AddSubagentRequest): PortableSubagentDefinition {
  if (request.sourceType === 'fields') {
    return assertPortableDefinitionComplete({
      name: normalizeSubagentName(request.name),
      description: normalizeRequiredText(request.description, 'Enter a subagent description before adding a subagent.'),
      prompt: normalizeRequiredText(request.prompt, 'Enter subagent instructions before adding a subagent.'),
      extras: {},
    });
  }

  const fallbackName = normalizeSubagentName(request.name);
  const raw = normalizeRequiredText(request.definition, 'Paste subagent definition contents before adding a subagent.');
  const definition = readPortableSubagentDefinitionFromText({
    fallbackName,
    format: request.format,
    raw,
  });

  return assertPortableDefinitionComplete({
    ...definition,
    name: normalizeSubagentName(definition.name),
  });
}

function assertPortableDefinitionComplete(definition: PortableSubagentDefinition): PortableSubagentDefinition {
  if (!definition.description?.trim()) {
    throw new Error('Enter a subagent description before adding a subagent.');
  }

  if (!definition.prompt.trim()) {
    throw new Error('Enter subagent instructions before adding a subagent.');
  }

  return {
    ...definition,
    description: definition.description.trim(),
    prompt: definition.prompt.trim(),
  };
}

function normalizeSubagentName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Enter a subagent name before adding a subagent.');
  }

  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Subagent names cannot include path separators.');
  }

  return trimmed;
}

function normalizeRequiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

function buildSubagentInstallTargets(
  definition: PortableSubagentDefinition,
  canonicalPath: string,
  installTargets: InstallTargetContext,
): SubagentInstallTarget[] {
  const targets: SubagentInstallTarget[] = [];
  for (const agent of installTargets.linkedAgents) {
    const format = agent.subagentParserKind ?? 'unknown';
    if (!isInstallableSubagentFormat(format) || !agent.subagentsLocation?.path) {
      continue;
    }

    targets.push({
      family: agent.family,
      format,
      path: path.join(agent.subagentsLocation.path, getSubagentFileNameForFormat({
        name: definition.name,
        format,
        family: agent.family,
        canonicalPath,
      })),
      symlinkToCanonical: format === 'markdown-frontmatter'
        && isMarkdownSubagentSymlinkCompatible(agent.family),
    });
  }

  return targets;
}

async function resolveInstallTargetContext(
  options: ScanSkillInventoryOptions & { paths: SkillIndexPaths },
): Promise<InstallTargetContext> {
  const scope = resolveInstallScope(options);
  const liveHomeDir = options.homeDir ?? homedir();
  const canonicalSkillsDir = scope === 'sandbox'
    ? options.paths.sandboxCanonicalUserSkillsDir
    : options.paths.liveCanonicalUserSkillsDir || path.join(liveHomeDir, '.agents', 'skills');
  const canonicalSubagentsDir = path.join(path.dirname(canonicalSkillsDir), 'agents');
  const agents = await buildInventoryAgents({
    ...options,
    includeSandboxSources: scope === 'sandbox',
    includeLiveSources: scope === 'live',
    paths: options.paths,
  });
  const linkedAgents = agents.filter((agent) => isLinkableInstalledSubagentAgent(agent, scope));

  await mkdir(canonicalSubagentsDir, { recursive: true });

  return {
    canonicalSubagentsDir,
    linkedAgents,
    scope,
  };
}

function isLinkableInstalledSubagentAgent(agent: AgentRecord, scope: 'sandbox' | 'live'): boolean {
  const format = agent.subagentParserKind ?? 'unknown';

  return agent.scope === scope
    && agent.installState === 'installed'
    && agent.writable
    && agent.subagentsLocation?.state === 'available'
    && typeof agent.subagentsLocation.path === 'string'
    && agent.subagentsLocation.path.length > 0
    && isInstallableSubagentFormat(format);
}

function isInstallableSubagentFormat(
  format: AgentSubagentParserKind,
): format is AddSubagentDefinitionFormat {
  return isSupportedSubagentDirectoryFormat(format)
    && isSubagentFormatRenderableFromUniversal(format, 'markdown-frontmatter');
}

function resolveInstallScope(options: ScanSkillInventoryOptions): 'sandbox' | 'live' {
  const includeSandboxSources = options.includeSandboxSources ?? false;
  const includeLiveSources = options.includeLiveSources ?? true;

  if (includeSandboxSources === includeLiveSources) {
    throw new Error('Add subagent requires a single active inventory scope.');
  }

  return includeSandboxSources ? 'sandbox' : 'live';
}

async function assertInstallPathsAreAvailable(
  filePaths: string[],
  inspectInstallPath: InspectInstallPath,
): Promise<void> {
  const plannedPaths = [...new Set(filePaths.map((filePath) => path.normalize(filePath)))];
  for (const filePath of plannedPaths) {
    if (await pathExists(filePath, inspectInstallPath)) {
      throw new Error(`A subagent already exists at ${filePath}. Remove or rename it before adding this subagent.`);
    }
  }
}

async function pathExists(
  targetPath: string,
  inspectInstallPath: InspectInstallPath,
): Promise<boolean> {
  try {
    await inspectInstallPath(targetPath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw new Error(`Failed to inspect subagent install path ${targetPath}: ${formatUnknownError(error)}`, { cause: error });
  }
}

async function inspectPath(targetPath: string): Promise<unknown> {
  return lstat(targetPath);
}

function isMissingPathError(error: unknown): boolean {
  return isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}
