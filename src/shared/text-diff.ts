import type { SkillDiffLine } from './contracts';

export function buildTextDiffLines(primaryContent?: string, comparisonContent?: string): SkillDiffLine[] {
  if (primaryContent === undefined || comparisonContent === undefined) {
    return [];
  }

  const primaryLines = splitIntoLines(primaryContent);
  const comparisonLines = splitIntoLines(comparisonContent);

  return buildLineDiff(primaryLines, comparisonLines);
}

function splitIntoLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const normalizedContent = content.replace(/\r\n/g, '\n');
  const lines = normalizedContent.split('\n');
  if (normalizedContent.endsWith('\n')) {
    lines.pop();
  }

  return lines;
}

function buildLineDiff(primaryLines: string[], comparisonLines: string[]): SkillDiffLine[] {
  const lcsLengths = Array.from({ length: primaryLines.length + 1 }, () => Array<number>(comparisonLines.length + 1).fill(0));

  for (let primaryIndex = primaryLines.length - 1; primaryIndex >= 0; primaryIndex -= 1) {
    for (let comparisonIndex = comparisonLines.length - 1; comparisonIndex >= 0; comparisonIndex -= 1) {
      lcsLengths[primaryIndex][comparisonIndex] = primaryLines[primaryIndex] === comparisonLines[comparisonIndex]
        ? lcsLengths[primaryIndex + 1][comparisonIndex + 1] + 1
        : Math.max(lcsLengths[primaryIndex + 1][comparisonIndex], lcsLengths[primaryIndex][comparisonIndex + 1]);
    }
  }

  const lines: SkillDiffLine[] = [];
  let primaryIndex = 0;
  let comparisonIndex = 0;

  while (primaryIndex < primaryLines.length && comparisonIndex < comparisonLines.length) {
    if (primaryLines[primaryIndex] === comparisonLines[comparisonIndex]) {
      if (primaryLines[primaryIndex].trim().length > 0) {
        lines.push({
          type: 'context',
          text: primaryLines[primaryIndex],
        });
      }

      primaryIndex += 1;
      comparisonIndex += 1;
      continue;
    }

    if (lcsLengths[primaryIndex][comparisonIndex + 1] >= lcsLengths[primaryIndex + 1][comparisonIndex]) {
      lines.push({
        type: 'removed',
        text: comparisonLines[comparisonIndex],
      });
      comparisonIndex += 1;
      continue;
    }

    lines.push({
      type: 'added',
      text: primaryLines[primaryIndex],
    });
    primaryIndex += 1;
  }

  while (comparisonIndex < comparisonLines.length) {
    lines.push({
      type: 'removed',
      text: comparisonLines[comparisonIndex],
    });
    comparisonIndex += 1;
  }

  while (primaryIndex < primaryLines.length) {
    lines.push({
      type: 'added',
      text: primaryLines[primaryIndex],
    });
    primaryIndex += 1;
  }

  return lines;
}
