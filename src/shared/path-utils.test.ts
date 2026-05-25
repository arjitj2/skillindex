import { describe, expect, it } from 'vitest';

import { joinPath } from './path-utils';

describe('joinPath', () => {
  it('does not introduce a double slash when joining from the filesystem root', () => {
    expect(joinPath('/', 'foo')).toBe('/foo');
    expect(joinPath('/', '.config', 'agents')).toBe('/.config/agents');
  });
});
