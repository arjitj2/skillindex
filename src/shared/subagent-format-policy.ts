import type { AgentSubagentParserKind } from './contracts';

export type SupportedSubagentDirectoryFormat = Exclude<AgentSubagentParserKind, 'none' | 'unknown'>;

const SUPPORTED_SUBAGENT_DIRECTORY_FORMATS = [
  'markdown-frontmatter',
  'codex-toml',
  'json',
  'jsonc',
  'toml',
  'yaml',
] as const satisfies SupportedSubagentDirectoryFormat[];

const SUPPORTED_SUBAGENT_DIRECTORY_FORMAT_SET = new Set<AgentSubagentParserKind>(
  SUPPORTED_SUBAGENT_DIRECTORY_FORMATS,
);

export function isSupportedSubagentDirectoryFormat(
  format: AgentSubagentParserKind,
): format is SupportedSubagentDirectoryFormat {
  return SUPPORTED_SUBAGENT_DIRECTORY_FORMAT_SET.has(format);
}

export function isSubagentFormatRenderableFromUniversal(
  targetFormat: AgentSubagentParserKind,
  universalFormat: AgentSubagentParserKind,
): boolean {
  return targetFormat === universalFormat
    || (universalFormat === 'markdown-frontmatter'
      && isSupportedSubagentDirectoryFormat(targetFormat));
}

export function getSubagentFileNameForFormat({
  name,
  format,
  family,
  canonicalPath,
}: {
  name: string;
  format: AgentSubagentParserKind;
  family?: string;
  canonicalPath?: string;
}): string {
  const baseName = sanitizeSubagentFileBaseName(name);
  if (family === 'github-copilot') {
    return `${baseName}.agent.md`;
  }

  const extension = getSubagentFileExtensionForFormat(format)
    ?? getPathExtension(canonicalPath)
    ?? '.md';
  return `${baseName}${extension}`;
}

export function inferSubagentParserKindFromPath(
  filePath: string,
  fallback: AgentSubagentParserKind,
): AgentSubagentParserKind {
  const extension = getPathExtension(filePath)?.toLowerCase();
  switch (extension) {
    case '.md':
      return 'markdown-frontmatter';
    case '.toml':
      return 'toml';
    case '.json':
      return 'json';
    case '.jsonc':
      return 'jsonc';
    case '.yaml':
    case '.yml':
      return 'yaml';
    default:
      return fallback;
  }
}

export function isMarkdownSubagentSymlinkCompatible(family: string | undefined): boolean {
  const requiredFields = getRequiredMarkdownSubagentFields(family);
  return requiredFields.every((field) => field === 'name' || field === 'description');
}

export function getRequiredMarkdownSubagentFields(family: string | undefined): string[] {
  switch (family) {
    case 'augment':
    case 'factory':
    case 'openhands':
      return ['name'];
    case 'mux':
      return ['name', 'subagent.runnable'];
    case 'github-copilot':
    case 'junie':
    case 'kilo':
    case 'opencode':
    case 'pochi':
      return ['description'];
    case 'iflow-cli':
      return ['agentType', 'systemPrompt', 'whenToUse'];
    default:
      return ['name', 'description'];
  }
}

function getSubagentFileExtensionForFormat(format: AgentSubagentParserKind): string | null {
  switch (format) {
    case 'markdown-frontmatter':
      return '.md';
    case 'codex-toml':
    case 'toml':
      return '.toml';
    case 'json':
      return '.json';
    case 'jsonc':
      return '.jsonc';
    case 'yaml':
      return '.yaml';
    default:
      return null;
  }
}

function sanitizeSubagentFileBaseName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/gu, '-');
}

function getPathExtension(filePath: string | undefined): string | null {
  if (!filePath) {
    return null;
  }

  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const fileName = filePath.slice(separatorIndex + 1);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex) : null;
}
