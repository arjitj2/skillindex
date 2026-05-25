import type { SkillIndexBootstrapState, SkillIndexDesktopApi, SkillIndexDevApi } from '@shared/contracts';

declare global {
  interface Window {
    skillIndex: SkillIndexDesktopApi;
    skillIndexDev?: SkillIndexDevApi;
    skillIndexBootstrap?: SkillIndexBootstrapState;
  }
}

export {};
