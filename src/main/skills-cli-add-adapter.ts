import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { SkillSourceScope } from '@shared/contracts';
import type { SkillIndexPaths } from '@shared/skill-index-paths';

import type { ScanSkillInventoryOptions } from '@main/scan-inventory';

export interface SkillsCliAddEnvironment {
  cwd: string;
  env: NodeJS.ProcessEnv;
  scope: Extract<SkillSourceScope, 'sandbox' | 'live'>;
}

const PASSTHROUGH_ENV_KEYS = [
  'PATH',
  'Path',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSH_AUTH_SOCK',
] as const;

export function buildSkillsCliAddEnvironment(
  scope: Extract<SkillSourceScope, 'sandbox' | 'live'>,
  options: ScanSkillInventoryOptions,
  paths: SkillIndexPaths,
  hostEnv: NodeJS.ProcessEnv = process.env,
): SkillsCliAddEnvironment {
  const liveHomeDir = options.homeDir ?? homedir();

  if (scope === 'live') {
    return {
      scope,
      cwd: process.cwd(),
      env: {
        ...hostEnv,
        HOME: liveHomeDir,
      },
    };
  }

  const sandboxHome = paths.sandboxRoot;
  return {
    scope,
    cwd: sandboxHome,
    env: buildSandboxSkillsCliEnv(sandboxHome, hostEnv),
  };
}

export function buildSandboxSkillsCliEnv(
  sandboxHome: string,
  hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    if (hostEnv[key]) {
      env[key] = hostEnv[key];
    }
  }

  env.HOME = sandboxHome;
  env.XDG_CONFIG_HOME = path.join(sandboxHome, '.config');
  env.CODEX_HOME = path.join(sandboxHome, '.codex');
  env.CLAUDE_CONFIG_DIR = path.join(sandboxHome, '.claude');
  env.CLINE_DIR = path.join(sandboxHome, '.cline');
  env.COPILOT_HOME = path.join(sandboxHome, '.copilot');
  env.GEMINI_CLI_HOME = path.join(sandboxHome, '.gemini');
  env.KIMI_SHARE_DIR = path.join(sandboxHome, '.kimi');
  env.MUX_CONFIG_ROOT = path.join(sandboxHome, '.mux');
  env.OH_PERSISTENCE_DIR = path.join(sandboxHome, '.openhands');
  env.OPENCLAW_STATE_DIR = path.join(sandboxHome, '.openclaw');
  env.OPENCLAW_HOME = path.join(sandboxHome, '.openclaw');
  env.PI_CODING_AGENT_DIR = path.join(sandboxHome, '.pi', 'agent');
  env.CRUSH_GLOBAL_CONFIG = path.join(sandboxHome, '.config', 'crush', 'crush.json');
  env.OPENCODE_CONFIG = path.join(sandboxHome, '.config', 'opencode', 'opencode.json');
  env.TRAE_CONFIG_FILE = path.join(sandboxHome, 'trae_config.yaml');

  return env;
}

export async function runSkillsAdd(source: string, environment: SkillsCliAddEnvironment): Promise<void> {
  await mkdir(environment.env.HOME ?? environment.cwd, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['skills', 'add', source, '--global', '--yes', '--all'], {
      cwd: environment.cwd,
      env: environment.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const cleanedOutput = stripAnsiCodes(output).trim();
      reject(new Error(cleanedOutput || `npx skills add exited with code ${code ?? 'unknown'}.`));
    });
  });
}

export function stripAnsiCodes(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27) {
      result += value[index];
      continue;
    }

    index += 1;
    if (value[index] !== '[') {
      continue;
    }

    while (index + 1 < value.length && !/[A-Za-z]/u.test(value[index + 1])) {
      index += 1;
    }
    if (index + 1 < value.length) {
      index += 1;
    }
  }

  return result;
}
