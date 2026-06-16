export function parseYamlBlockScalarHeader(rawValue: string): { fold: boolean } | null {
  const trimmedValue = rawValue.trim();
  const match = /^([>|])(?:[+-])?$/u.exec(trimmedValue);
  if (!match) {
    return null;
  }

  return { fold: match[1] === '>' };
}

export function readYamlBlockScalar(
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

export function trimYamlIndentedBlock(lines: string[]): string {
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

export function getLeadingWhitespace(line: string): string {
  return /^\s*/u.exec(line)?.[0] ?? '';
}
