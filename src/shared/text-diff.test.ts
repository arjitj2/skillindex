import { describe, expect, it } from 'vitest';

import { buildTextDiffLines } from './text-diff';

describe('buildTextDiffLines', () => {
  it('treats the first text blob as primary, with unique lines marked as added', () => {
    expect(buildTextDiffLines('line one\nline two\n', 'line one\nline three\n')).toEqual([
      { type: 'context', text: 'line one' },
      { type: 'removed', text: 'line three' },
      { type: 'added', text: 'line two' },
    ]);
  });

  it('treats CRLF and LF line endings the same', () => {
    expect(buildTextDiffLines('line one\r\nline two\r\n', 'line one\nline two\n')).toEqual([
      { type: 'context', text: 'line one' },
      { type: 'context', text: 'line two' },
    ]);
  });
});
