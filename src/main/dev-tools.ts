import { isDevToolsEnabledForBuild } from '@shared/build-flavor';

export function isDevToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevToolsEnabledForBuild(env);
}
