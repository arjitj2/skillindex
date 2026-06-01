import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface CssRule {
  declarations: Record<string, string>;
  maxWidth: number | null;
  order: number;
  selectors: string[];
}

interface CascadedValue {
  order: number;
  specificity: number;
  value: string;
}

const stylesPath = path.resolve(process.cwd(), 'src/renderer/src/styles.css');

describe('renderer stylesheet layout regressions', () => {
  it('keeps a vertical divider when the split workspace remains side by side below the legacy stacking breakpoint', () => {
    const rules = collectCssRules(readFileSync(stylesPath, 'utf8'));
    const viewportWidth = 1239;
    const splitStyles = computeStyles(rules, viewportWidth, ['split-workspace', 'split-workspace--detail'], [
      'page-scroll--split',
    ]);
    const inspectorStyles = computeStyles(
      rules,
      viewportWidth,
      ['inspector-panel', 'detail-inspector-panel', 'detail-inspector-panel--subagent', 'subagent-inspector-panel'],
      ['page-scroll--split', 'split-workspace', 'split-workspace--detail'],
    );

    expect(splitStyles['grid-template-columns']).toBe('minmax(0, 1fr) 460px');
    expect(inspectorStyles['border-left']).toMatch(/^1px\s+solid\b/);
    expect(inspectorStyles['border-top']).toBe('0');
  });
});

function collectCssRules(css: string, maxWidth: number | null = null): CssRule[] {
  const rules: CssRule[] = [];
  parseCssBlock(stripComments(css), maxWidth, rules);
  return rules.map((rule, order) => ({ ...rule, order }));
}

function parseCssBlock(css: string, maxWidth: number | null, rules: CssRule[]): void {
  let index = 0;
  while (index < css.length) {
    const nextOpen = css.indexOf('{', index);
    if (nextOpen === -1) {
      return;
    }

    const prelude = css.slice(index, nextOpen).trim();
    const close = findMatchingBrace(css, nextOpen);
    if (close === -1) {
      return;
    }

    const body = css.slice(nextOpen + 1, close);
    if (prelude.startsWith('@media')) {
      parseCssBlock(body, parseMaxWidth(prelude) ?? maxWidth, rules);
    } else if (prelude && !prelude.startsWith('@')) {
      rules.push({
        declarations: parseDeclarations(body),
        maxWidth,
        order: rules.length,
        selectors: prelude.split(',').map((selector) => selector.trim()),
      });
    }

    index = close + 1;
  }
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
    } else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseMaxWidth(prelude: string): number | null {
  const match = prelude.match(/max-width:\s*(\d+)px/);
  return match ? Number(match[1]) : null;
}

function parseDeclarations(body: string): Record<string, string> {
  return Object.fromEntries(
    body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':');
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
      }),
  );
}

function computeStyles(
  rules: CssRule[],
  viewportWidth: number,
  elementClasses: string[],
  ancestorClasses: string[],
): Record<string, string> {
  const cascadedStyles = new Map<string, CascadedValue>();
  const classSet = new Set([...elementClasses, ...ancestorClasses]);

  for (const rule of rules) {
    if (rule.maxWidth !== null && viewportWidth > rule.maxWidth) {
      continue;
    }

    const matchingSpecificity = Math.max(
      ...rule.selectors
        .filter((selector) => selectorMatchesClasses(selector, classSet))
        .map((selector) => selectorSpecificity(selector)),
      -1,
    );
    if (matchingSpecificity === -1) {
      continue;
    }

    for (const [property, value] of Object.entries(rule.declarations)) {
      const previous = cascadedStyles.get(property);
      if (!previous || matchingSpecificity > previous.specificity || (
        matchingSpecificity === previous.specificity && rule.order >= previous.order
      )) {
        cascadedStyles.set(property, {
          order: rule.order,
          specificity: matchingSpecificity,
          value,
        });
      }
    }
  }

  return Object.fromEntries([...cascadedStyles].map(([property, cascaded]) => [property, cascaded.value]));
}

function selectorMatchesClasses(selector: string, classSet: Set<string>): boolean {
  return (selector.match(/\.[A-Za-z0-9_-]+/g) ?? [])
    .map((className) => className.slice(1))
    .every((className) => classSet.has(className));
}

function selectorSpecificity(selector: string): number {
  return selector.match(/\.[A-Za-z0-9_-]+/g)?.length ?? 0;
}
