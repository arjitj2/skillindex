import { describe, expect, it } from 'vitest';

import { getSkillIndexBuildFlavor, isDevToolsEnabledForBuild } from './build-flavor';

describe('build flavor', () => {
  it('defaults to the standard flavor', () => {
    expect(getSkillIndexBuildFlavor({})).toBe('standard');
    expect(isDevToolsEnabledForBuild({})).toBe(false);
  });

  it('enables dev tools for the baked dev alpha flavor', () => {
    expect(getSkillIndexBuildFlavor({ SKILL_INDEX_BUILD_FLAVOR: 'dev-alpha' })).toBe('dev-alpha');
    expect(isDevToolsEnabledForBuild({ SKILL_INDEX_BUILD_FLAVOR: 'dev-alpha' })).toBe(true);
  });

  it('keeps existing development toggles working', () => {
    expect(isDevToolsEnabledForBuild({ SKILL_INDEX_ENABLE_DEV_TOOLS: '1' })).toBe(true);
    expect(isDevToolsEnabledForBuild({ NODE_ENV: 'development' })).toBe(true);
  });
});
