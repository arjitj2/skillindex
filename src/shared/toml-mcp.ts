import type { McpDefinitionObject, McpDefinitionValue, McpServerDefinition, McpServerDefinitions } from './contracts';

export function parseTomlMcpServers(raw: string): McpServerDefinitions {
  const servers: Record<string, McpServerDefinition> = {};
  let currentServerName: string | null = null;
  let currentTablePath: string[] = [];

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = stripTomlComment(line).trim();
    if (!trimmed) {
      continue;
    }

    const tableMatch = /^\[([^\]]+)\]$/u.exec(trimmed);
    if (tableMatch) {
      const tablePath = parseTomlDottedKey(tableMatch[1] ?? '');
      currentServerName = tablePath.length >= 2 && tablePath[0] === 'mcp_servers'
        ? tablePath[1] ?? null
        : null;
      currentTablePath = tablePath.slice(2).map(normalizeTomlMcpKey);
      if (currentServerName) {
        servers[currentServerName] ??= {};
      }
      continue;
    }

    if (!currentServerName) {
      continue;
    }

    const assignment = splitTomlAssignment(trimmed);
    if (!assignment) {
      continue;
    }

    const keyPath = parseTomlDottedKey(assignment.key);
    if (keyPath.length === 0) {
      continue;
    }

    setNestedValue(
      servers[currentServerName],
      [...currentTablePath, ...keyPath.map(normalizeTomlMcpKey)],
      parseTomlValue(assignment.value),
    );
  }

  return servers;
}

export function updateTomlMcpServers(raw: string, definitions: McpServerDefinitions): string {
  const withoutMcpTables = removeTomlMcpServerTables(raw).replace(/\s+$/u, '');
  const renderedDefinitions = renderTomlMcpServers(definitions);

  if (!withoutMcpTables) {
    return renderedDefinitions;
  }

  if (!renderedDefinitions.trim()) {
    return `${withoutMcpTables}\n`;
  }

  return `${withoutMcpTables}\n\n${renderedDefinitions}`;
}

export function parseTomlMcpServerArray(raw: string): McpServerDefinitions {
  const servers: McpServerDefinitions = {};
  let currentServer: McpDefinitionObject | null = null;
  let currentTablePath: string[] = [];

  function commitCurrentServer(): void {
    if (!currentServer) {
      return;
    }

    const name = typeof currentServer.name === 'string' && currentServer.name.trim()
      ? currentServer.name
      : undefined;
    if (!name) {
      currentServer = null;
      return;
    }

    const definition = { ...currentServer };
    delete definition.name;
    servers[name] = definition;
    currentServer = null;
    currentTablePath = [];
  }

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = stripTomlComment(line).trim();
    if (!trimmed) {
      continue;
    }

    const arrayTableMatch = /^\[\[([^\]]+)\]\]$/u.exec(trimmed);
    if (arrayTableMatch) {
      commitCurrentServer();
      const tablePath = parseTomlDottedKey(arrayTableMatch[1] ?? '');
      currentServer = tablePath.length === 1 && tablePath[0] === 'mcp_servers'
        ? {}
        : null;
      currentTablePath = [];
      continue;
    }

    const regularTableMatch = /^\[([^\]]+)\]$/u.exec(trimmed);
    if (regularTableMatch) {
      const tablePath = parseTomlDottedKey(regularTableMatch[1] ?? '');
      if (currentServer && tablePath.length >= 2 && tablePath[0] === 'mcp_servers') {
        currentTablePath = tablePath.slice(1).map(normalizeTomlMcpKey);
        continue;
      }

      commitCurrentServer();
      continue;
    }

    if (!currentServer) {
      continue;
    }

    const assignment = splitTomlAssignment(trimmed);
    if (!assignment) {
      continue;
    }

    const keyPath = parseTomlDottedKey(assignment.key);
    if (keyPath.length === 0) {
      continue;
    }

    setNestedValue(
      currentServer,
      [...currentTablePath, ...keyPath.map(normalizeTomlMcpKey)],
      parseTomlValue(assignment.value),
    );
  }

  commitCurrentServer();
  return servers;
}

export function updateTomlMcpServerArray(raw: string, definitions: McpServerDefinitions): string {
  const withoutMcpTables = removeTomlMcpServerArrayTables(raw).replace(/\s+$/u, '');
  const renderedDefinitions = renderTomlMcpServerArray(definitions);

  if (!withoutMcpTables) {
    return renderedDefinitions;
  }

  if (!renderedDefinitions.trim()) {
    return `${withoutMcpTables}\n`;
  }

  return `${withoutMcpTables}\n\n${renderedDefinitions}`;
}

function removeTomlMcpServerTables(raw: string): string {
  const keptLines: string[] = [];
  let insideMcpServerTable = false;

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = stripTomlComment(line).trim();
    const tableMatch = /^\[([^\]]+)\]$/u.exec(trimmed);
    if (tableMatch) {
      const tablePath = parseTomlDottedKey(tableMatch[1] ?? '');
      insideMcpServerTable = tablePath.length >= 2 && tablePath[0] === 'mcp_servers';
    }

    if (!insideMcpServerTable) {
      keptLines.push(line);
    }
  }

  return keptLines.join('\n');
}

function removeTomlMcpServerArrayTables(raw: string): string {
  const keptLines: string[] = [];
  let insideMcpServerArray = false;

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = stripTomlComment(line).trim();
    const arrayTableMatch = /^\[\[([^\]]+)\]\]$/u.exec(trimmed);
    const regularTableMatch = /^\[([^\]]+)\]$/u.exec(trimmed);

    if (arrayTableMatch) {
      const tablePath = parseTomlDottedKey(arrayTableMatch[1] ?? '');
      insideMcpServerArray = tablePath.length === 1 && tablePath[0] === 'mcp_servers';
    } else if (regularTableMatch) {
      const tablePath = parseTomlDottedKey(regularTableMatch[1] ?? '');
      insideMcpServerArray = tablePath[0] === 'mcp_servers';
    }

    if (!insideMcpServerArray) {
      keptLines.push(line);
    }
  }

  return keptLines.join('\n');
}

function renderTomlMcpServers(definitions: McpServerDefinitions): string {
  const lines: string[] = [];

  for (const [name, definition] of Object.entries(definitions).sort(([left], [right]) => left.localeCompare(right))) {
    if (lines.length > 0) {
      lines.push('');
    }

    lines.push(`[mcp_servers.${formatTomlKeySegment(name)}]`);

    if (!isMcpDefinitionObject(definition)) {
      continue;
    }

    for (const [key, value] of Object.entries(definition).sort(([left], [right]) => left.localeCompare(right))) {
      if (isMcpDefinitionObject(value)) {
        continue;
      }

      const renderedValue = renderTomlValue(value);
      if (renderedValue !== undefined) {
        lines.push(`${formatTomlKeySegment(key)} = ${renderedValue}`);
      }
    }

    for (const table of collectTomlTables(definition, [])) {
      if (table.entries.length === 0) {
        continue;
      }

      lines.push('');
      lines.push(`[mcp_servers.${formatTomlKeySegment(name)}.${table.path.map(formatTomlMcpKeySegment).join('.')}]`);
      for (const [key, value] of table.entries) {
        const renderedValue = renderTomlValue(value);
        if (renderedValue !== undefined) {
          lines.push(`${formatTomlKeySegment(key)} = ${renderedValue}`);
        }
      }
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function renderTomlMcpServerArray(definitions: McpServerDefinitions): string {
  const lines: string[] = [];

  for (const [name, definition] of Object.entries(definitions).sort(([left], [right]) => left.localeCompare(right))) {
    if (lines.length > 0) {
      lines.push('');
    }

    lines.push('[[mcp_servers]]');
    lines.push(`name = ${renderTomlValue(name)}`);

    if (!isMcpDefinitionObject(definition)) {
      continue;
    }

    for (const [key, value] of Object.entries(definition).sort(([left], [right]) => left.localeCompare(right))) {
      if (isMcpDefinitionObject(value)) {
        continue;
      }

      const renderedValue = renderTomlValue(value);
      if (renderedValue !== undefined) {
        lines.push(`${formatTomlMcpKeySegment(key)} = ${renderedValue}`);
      }
    }

    for (const table of collectTomlTables(definition, [])) {
      if (table.entries.length === 0) {
        continue;
      }

      lines.push('');
      lines.push(`[mcp_servers.${table.path.map(formatTomlMcpKeySegment).join('.')}]`);
      for (const [key, value] of table.entries) {
        const renderedValue = renderTomlValue(value);
        if (renderedValue !== undefined) {
          lines.push(`${formatTomlMcpKeySegment(key)} = ${renderedValue}`);
        }
      }
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function collectTomlTables(
  definition: McpDefinitionObject,
  path: string[],
): Array<{ path: string[]; entries: Array<[string, McpDefinitionValue | undefined]> }> {
  const tables: Array<{ path: string[]; entries: Array<[string, McpDefinitionValue | undefined]> }> = [];

  for (const [key, value] of Object.entries(definition).sort(([left], [right]) => left.localeCompare(right))) {
    if (!isMcpDefinitionObject(value)) {
      continue;
    }

    const tablePath = [...path, key];
    const entries = Object.entries(value)
      .filter(([, nestedValue]) => !isMcpDefinitionObject(nestedValue))
      .sort(([left], [right]) => left.localeCompare(right));
    tables.push({ path: tablePath, entries });
    tables.push(...collectTomlTables(value, tablePath));
  }

  return tables;
}

function setNestedValue(target: McpDefinitionObject, path: string[], value: McpDefinitionValue): void {
  let current = target;

  for (const [index, segment] of path.entries()) {
    if (!segment) {
      return;
    }

    if (index === path.length - 1) {
      current[segment] = value;
      return;
    }

    const existing = current[segment];
    if (!isMcpDefinitionObject(existing)) {
      current[segment] = {};
    }
    current = current[segment] as McpDefinitionObject;
  }
}

function normalizeTomlMcpKey(value: string): string {
  return value === 'http_headers' ? 'headers' : value;
}

function formatTomlMcpKeySegment(value: string): string {
  return formatTomlKeySegment(value === 'headers' ? 'http_headers' : value);
}

function renderTomlValue(value: McpDefinitionValue | undefined): string | undefined {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const renderedItems = value.map(renderTomlValue);
    if (renderedItems.some((item) => item === undefined)) {
      return undefined;
    }

    return `[${renderedItems.join(', ')}]`;
  }

  return undefined;
}

function stripTomlComment(line: string): string {
  let result = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (const character of line) {
    if (inDoubleQuote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inSingleQuote) {
      result += character;
      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (character === '#') {
      break;
    }

    if (character === '"') {
      inDoubleQuote = true;
    } else if (character === "'") {
      inSingleQuote = true;
    }

    result += character;
  }

  return result;
}

function splitTomlAssignment(line: string): { key: string; value: string } | null {
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inDoubleQuote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inSingleQuote) {
      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (character === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (character === "'") {
      inSingleQuote = true;
      continue;
    }

    if (character === '=') {
      return {
        key: line.slice(0, index).trim(),
        value: line.slice(index + 1).trim(),
      };
    }
  }

  return null;
}

function parseTomlDottedKey(value: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (const character of value) {
    if (inDoubleQuote) {
      current += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inSingleQuote) {
      current += character;
      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (character === '.') {
      segments.push(parseTomlKeySegment(current.trim()));
      current = '';
      continue;
    }

    if (character === '"') {
      inDoubleQuote = true;
    } else if (character === "'") {
      inSingleQuote = true;
    }

    current += character;
  }

  segments.push(parseTomlKeySegment(current.trim()));
  return segments.filter((segment) => segment.length > 0);
}

function parseTomlKeySegment(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return parseTomlString(value);
  }

  return value;
}

function formatTomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function parseTomlValue(value: string): McpDefinitionValue {
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTomlArray(value.slice(1, -1)).map(parseTomlValue);
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return parseTomlString(value);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && value.trim() !== '') {
    return numberValue;
  }

  return value;
}

function splitTomlArray(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (const character of value) {
    if (inDoubleQuote) {
      current += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inSingleQuote) {
      current += character;
      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (character === ',') {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = '';
      continue;
    }

    if (character === '"') {
      inDoubleQuote = true;
    } else if (character === "'") {
      inSingleQuote = true;
    }

    current += character;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

function parseTomlString(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  try {
    return JSON.parse(value) as string;
  } catch {
    return value.slice(1, -1);
  }
}

function isMcpDefinitionObject(value: McpDefinitionValue | undefined): value is McpDefinitionObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
