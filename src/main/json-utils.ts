export function sanitizeJsonc(raw: string): string {
  return stripJsonTrailingCommas(stripJsonComments(raw));
}

export function stableStringify(value: unknown, pretty = false): string {
  return JSON.stringify(sortRecordValue(value), null, pretty ? 2 : 0);
}

export function sortRecordValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortRecordValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, sortRecordValue(nestedValue)]),
  );
}

function stripJsonComments(raw: string): string {
  let result = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < raw.length) {
    const current = raw[index];
    const next = raw[index + 1];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
      index += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      index += 2;
      while (index < raw.length && raw[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      index += 2;
      while (index < raw.length && !(raw[index] === '*' && raw[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    result += current;
    index += 1;
  }

  return result;
}

function stripJsonTrailingCommas(raw: string): string {
  let result = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < raw.length) {
    const current = raw[index];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
      index += 1;
      continue;
    }

    if (current === ',') {
      let lookahead = index + 1;
      while (lookahead < raw.length && /\s/u.test(raw[lookahead])) {
        lookahead += 1;
      }

      if (raw[lookahead] === '}' || raw[lookahead] === ']') {
        index += 1;
        continue;
      }
    }

    result += current;
    index += 1;
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
