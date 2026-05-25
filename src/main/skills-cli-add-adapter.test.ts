import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSandboxSkillsCliEnv, buildSkillsCliAddEnvironment, stripAnsiCodes } from '@main/skills-cli-add-adapter';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

describe('skills CLI add adapter', () => {
  it('builds a sandbox environment without leaking host agent config overrides', () => {
    const sandboxHome = '/tmp/skillindex/sandbox';
    const env = buildSandboxSkillsCliEnv(sandboxHome, {
      PATH: '/usr/local/bin:/usr/bin',
      OPENCODE_CONFIG: '/Users/arjit/.config/opencode/opencode.json',
      CLAUDE_CONFIG_DIR: '/Users/arjit/.claude',
      CODEX_HOME: '/Users/arjit/.codex',
      CUSTOM_SECRET: 'do-not-copy',
    });

    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(env.HOME).toBe(sandboxHome);
    expect(env.XDG_CONFIG_HOME).toBe(path.join(sandboxHome, '.config'));
    expect(env.CODEX_HOME).toBe(path.join(sandboxHome, '.codex'));
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(sandboxHome, '.claude'));
    expect(env.OPENCODE_CONFIG).toBe(path.join(sandboxHome, '.config', 'opencode', 'opencode.json'));
    expect(env.CUSTOM_SECRET).toBeUndefined();
  });

  it('uses the real host environment for live installs', () => {
    const paths = resolveSkillIndexPaths({
      env: {
        SKILL_INDEX_DATA_DIR: '/tmp/skillindex',
      },
      homeDir: '/Users/arjit',
    });
    const environment = buildSkillsCliAddEnvironment('live', { homeDir: '/Users/arjit' }, paths, {
      PATH: '/usr/local/bin:/usr/bin',
      OPENCODE_CONFIG: '/Users/arjit/.config/opencode/opencode.json',
    });

    expect(environment.scope).toBe('live');
    expect(environment.env.HOME).toBe('/Users/arjit');
    expect(environment.env.OPENCODE_CONFIG).toBe('/Users/arjit/.config/opencode/opencode.json');
  });

  it('strips full ANSI CSI escape sequences from CLI output', () => {
    expect(stripAnsiCodes('\u001b[31mfailed\u001b[0m\nplain')).toBe('failed\nplain');
  });
});
