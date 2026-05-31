import type {
  McpConfiguredTransportKind,
  McpDefinitionObject,
  McpDefinitionValue,
  McpServerDefinition,
  McpServerDefinitions,
  McpTransportKind,
  RemoteMcpTransportKind,
} from './contracts';

export interface McpDefinitionConnectionHint {
  transport?: McpTransportKind;
  command?: string;
  url?: string;
  args?: string[];
}

export const MCP_AGENT_LOCAL_KEY = 'agentLocal';

const MCP_CORE_AND_DIALECT_KEYS = new Set([
  MCP_AGENT_LOCAL_KEY,
  'args',
  'bearer_token_env_var',
  'command',
  'cwd',
  'env',
  'environment',
  'env_http_headers',
  'headers',
  'http_headers',
  'httpUrl',
  'mcp',
  'mcpServers',
  'servers',
  'transport',
  'type',
  'url',
]);

export interface SplitMcpDefinition {
  core: McpServerDefinition;
  native: McpDefinitionObject;
  agentLocal: Record<string, McpDefinitionObject>;
}

export function normalizeMcpDefinitionForComparison(
  definition: McpDefinitionObject,
  connection?: McpDefinitionConnectionHint,
): McpServerDefinition {
  const comparable = buildComparableMcpDefinition(definition, connection);
  if (comparable.transport) {
    return comparable;
  }

  return comparable;
}

export function splitMcpDefinitionForComparison(
  definition: McpDefinitionObject,
  connection?: McpDefinitionConnectionHint,
): SplitMcpDefinition {
  return {
    core: normalizeMcpDefinitionForComparison(definition, connection),
    native: extractNativeMcpFields(definition),
    agentLocal: extractAgentLocalMcpFields(definition),
  };
}

export function buildPortableMcpDefinition(
  definition: McpDefinitionObject,
  connection?: McpDefinitionConnectionHint,
): McpServerDefinition {
  const comparable = buildComparableMcpDefinition(definition, connection);
  const transport = normalizeMcpTransport(comparable.transport);
  const portable: McpServerDefinition = {};

  if (transport === 'stdio' || (!transport && comparable.command)) {
    if (comparable.command) {
      portable.command = comparable.command;
    }
    if (Array.isArray(comparable.args) && comparable.args.length > 0) {
      portable.args = comparable.args;
    }
    if (comparable.cwd) {
      portable.cwd = comparable.cwd;
    }
    if (isMcpDefinitionObject(comparable.env)) {
      portable.env = comparable.env;
    }
    return portable;
  }

  if (isRemoteMcpTransport(transport) || (!transport && comparable.url)) {
    if (transport) {
      portable.type = transport;
    }
    if (comparable.url) {
      portable.url = comparable.url;
    }
    if (isMcpDefinitionObject(comparable.headers)) {
      portable.headers = comparable.headers;
    }
    if (isMcpDefinitionObject(comparable.env_http_headers)) {
      portable.env_http_headers = comparable.env_http_headers;
    }
    if (comparable.bearer_token_env_var) {
      portable.bearer_token_env_var = comparable.bearer_token_env_var;
    }
    return portable;
  }

  return portable;
}

function buildComparableMcpDefinition(
  definition: McpDefinitionObject,
  connection?: McpDefinitionConnectionHint,
): McpServerDefinition {
  const comparable: McpServerDefinition = {};
  const transport = getPortableMcpTransport(definition, connection);

  if (transport) {
    comparable.transport = transport;
  }

  if (transport === 'stdio' || (!transport && connection?.command)) {
    const command = getMcpCommand(definition) ?? connection?.command;
    if (command) {
      comparable.command = command;
    }

    const args = getMcpArgs(definition, connection);
    if (args.length > 0) {
      comparable.args = args;
    }

    const cwd = getNonEmptyString(definition.cwd);
    if (cwd) {
      comparable.cwd = cwd;
    }

    if (isMcpDefinitionObject(definition.env)) {
      comparable.env = definition.env;
    } else if (isMcpDefinitionObject(definition.environment)) {
      comparable.env = definition.environment;
    }
    return comparable;
  }

  if (isRemoteMcpTransport(transport) || (!transport && connection?.url)) {
    const url = getMcpRemoteUrl(definition) ?? connection?.url;
    if (url) {
      comparable.url = url;
    }

    const headers = getMcpHeaders(definition);
    if (headers) {
      comparable.headers = headers;
    }

    if (isMcpDefinitionObject(definition.env_http_headers)) {
      comparable.env_http_headers = definition.env_http_headers;
    }

    const bearerTokenEnvVar = getNonEmptyString(definition.bearer_token_env_var);
    if (bearerTokenEnvVar) {
      comparable.bearer_token_env_var = bearerTokenEnvVar;
    }
    return comparable;
  }

  return comparable;
}

function extractNativeMcpFields(definition: McpDefinitionObject): McpDefinitionObject {
  const native: McpDefinitionObject = {};
  for (const [key, value] of Object.entries(definition)) {
    if (value === undefined || MCP_CORE_AND_DIALECT_KEYS.has(key)) {
      continue;
    }
    native[key] = value;
  }
  return native;
}

function extractAgentLocalMcpFields(definition: McpDefinitionObject): Record<string, McpDefinitionObject> {
  if (!isMcpDefinitionObject(definition[MCP_AGENT_LOCAL_KEY])) {
    return {};
  }

  const agentLocal: Record<string, McpDefinitionObject> = {};
  const rawAgentLocal = definition[MCP_AGENT_LOCAL_KEY];
  for (const [agentKey, rawFields] of Object.entries(rawAgentLocal)) {
    if (!isMcpDefinitionObject(rawFields)) {
      continue;
    }

    const nativeFields = extractNativeMcpFields(rawFields);
    if (Object.keys(nativeFields).length > 0) {
      agentLocal[agentKey] = nativeFields;
    }
  }
  return agentLocal;
}

function getPortableMcpTransport(
  definition: McpDefinitionObject,
  connection?: McpDefinitionConnectionHint,
): McpConfiguredTransportKind | undefined {
  return normalizeMcpTransport(definition.transport)
    ?? normalizeMcpTransport(definition.type)
    ?? normalizeConnectionHintTransport(connection?.transport)
    ?? inferMcpTransport({
      command: getMcpCommand(definition),
      url: getNonEmptyString(definition.url),
      httpUrl: getNonEmptyString(definition.httpUrl),
    });
}

function normalizeMcpTransport(value: McpDefinitionValue | undefined): McpConfiguredTransportKind | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'local':
    case 'stdio':
      return 'stdio';
    case 'remote':
    case 'http':
      return 'http';
    case 'streamable-http':
    case 'streamable_http':
      return 'streamable-http';
    case 'sse':
      return 'sse';
    default:
      return undefined;
  }
}

function inferMcpTransport({
  command,
  url,
  httpUrl,
}: {
  command?: string;
  url?: string;
  httpUrl?: string;
}): McpConfiguredTransportKind | undefined {
  if (command) {
    return 'stdio';
  }

  if (httpUrl) {
    return 'streamable-http';
  }

  if (url) {
    return 'http';
  }

  return undefined;
}

function isRemoteMcpTransport(transport: McpTransportKind | undefined): transport is RemoteMcpTransportKind {
  return transport === 'http' || transport === 'streamable-http' || transport === 'sse';
}

function normalizeConnectionHintTransport(value: McpTransportKind | undefined): McpConfiguredTransportKind | undefined {
  return value && value !== 'unknown' ? value : undefined;
}

function getNonEmptyString(value: McpDefinitionValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getMcpRemoteUrl(definition: McpDefinitionObject): string | undefined {
  return getNonEmptyString(definition.httpUrl) ?? getNonEmptyString(definition.url);
}

function getMcpCommand(definition: McpDefinitionObject): string | undefined {
  const command = definition.command;
  if (Array.isArray(command)) {
    return getNonEmptyString(command[0]);
  }

  return getNonEmptyString(command);
}

function getMcpArgs(
  definition: McpDefinitionObject,
  connection?: McpDefinitionConnectionHint,
): string[] {
  if (Array.isArray(definition.command)) {
    return definition.command.slice(1).filter((item): item is string => typeof item === 'string');
  }

  const args = getStringArray(definition.args);
  return args.length > 0 ? args : connection?.args ?? [];
}

function getStringArray(value: McpDefinitionValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function getMcpHeaders(definition: McpDefinitionObject): McpDefinitionObject | undefined {
  if (isMcpDefinitionObject(definition.headers)) {
    return definition.headers;
  }

  if (isMcpDefinitionObject(definition.http_headers)) {
    return definition.http_headers;
  }

  return undefined;
}

export function isMcpDefinitionObject(value: unknown): value is McpDefinitionObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMcpServerDefinitions(value: unknown): value is McpServerDefinitions {
  return isMcpDefinitionObject(value)
    && Object.values(value).every((definition) => definition !== undefined && isMcpDefinitionValue(definition));
}

function isMcpDefinitionValue(value: unknown): value is McpDefinitionValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isMcpDefinitionValue);
  }

  return isMcpDefinitionObject(value)
    && Object.values(value).every((nestedValue) => nestedValue === undefined || isMcpDefinitionValue(nestedValue));
}
