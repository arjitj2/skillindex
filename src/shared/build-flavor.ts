declare const __SKILL_INDEX_BUILD_FLAVOR__: string | undefined;

export type SkillIndexBuildFlavor = 'standard' | 'dev-alpha';

export function getSkillIndexBuildFlavor(env: NodeJS.ProcessEnv = process.env): SkillIndexBuildFlavor {
  const rawFlavor = env.SKILL_INDEX_BUILD_FLAVOR ?? getBakedBuildFlavor();
  return rawFlavor === 'dev-alpha' ? 'dev-alpha' : 'standard';
}

export function isDevToolsEnabledForBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SKILL_INDEX_ENABLE_DEV_TOOLS === '1'
    || env.NODE_ENV === 'development'
    || getSkillIndexBuildFlavor(env) === 'dev-alpha';
}

function getBakedBuildFlavor(): string | undefined {
  return typeof __SKILL_INDEX_BUILD_FLAVOR__ === 'string'
    ? __SKILL_INDEX_BUILD_FLAVOR__
    : undefined;
}
