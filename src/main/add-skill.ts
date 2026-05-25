import { cp, lstat, mkdir, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { AddSkillRequest, AgentRecord, SkillInventorySnapshot } from '@shared/contracts';
import {
  ensureSkillIndexLayout,
  resolveSkillIndexPaths,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

import { buildInventoryAgents } from '@main/inventory-source-model';
import { scanSkillInventory, type ScanSkillInventoryOptions } from '@main/skill-inventory';
import {
  buildSkillsCliAddEnvironment,
  runSkillsAdd,
  type SkillsCliAddEnvironment,
} from '@main/skills-cli-add-adapter';

export interface AddSkillOptions extends ScanSkillInventoryOptions {
  paths?: SkillIndexPaths;
  runSkillsAdd?: (source: string, environment: SkillsCliAddEnvironment) => Promise<void>;
}

interface InstallTargetContext {
  canonicalSkillsDir: string;
  linkedSkillsDirs: string[];
  scope: 'sandbox' | 'live';
}

export async function addSkill(
  request: AddSkillRequest,
  options: AddSkillOptions = {},
): Promise<SkillInventorySnapshot> {
  const paths = options.paths ?? resolveSkillIndexPaths(options);
  await ensureSkillIndexLayout(paths);

  const installTargets = await resolveInstallTargetContext({
    ...options,
    paths,
  });

  if (request.sourceType === 'markdown') {
    const relativeSkillDir = normalizeManualSkillDir(request.skillName);
    await installPackagesFromDefinitions(
      [{ relativeDir: relativeSkillDir, sourceDir: null, skillMarkdown: normalizeSkillMarkdown(request.markdown) }],
      installTargets,
    );
  } else {
    const source = request.source.trim();
    if (!source) {
      throw new Error('Enter a repository or skill URL before adding a skill.');
    }

    await (options.runSkillsAdd ?? runSkillsAdd)(source, buildSkillsCliAddEnvironment(installTargets.scope, options, paths));
  }

  return scanSkillInventory({
    ...options,
    includeSandboxSources: installTargets.scope === 'sandbox',
    includeLiveSources: installTargets.scope === 'live',
    paths,
  });
}

async function installPackagesFromDefinitions(
  packages: Array<{
    relativeDir: string;
    sourceDir: string | null;
    skillMarkdown: string | null;
  }>,
  targets: InstallTargetContext,
): Promise<void> {
  await assertInstallPathsAreAvailable(packages, targets);

  for (const pkg of packages) {
    const canonicalPackageDir = path.join(targets.canonicalSkillsDir, pkg.relativeDir);
    await mkdir(path.dirname(canonicalPackageDir), { recursive: true });

    if (pkg.sourceDir) {
      await cp(pkg.sourceDir, canonicalPackageDir, {
        recursive: true,
        dereference: true,
        force: false,
      });
    } else {
      await mkdir(canonicalPackageDir, { recursive: true });
      await writeFile(path.join(canonicalPackageDir, 'SKILL.md'), pkg.skillMarkdown ?? '', 'utf8');
    }
  }

  for (const skillsDir of targets.linkedSkillsDirs) {
    for (const pkg of packages) {
      const canonicalPackageDir = path.join(targets.canonicalSkillsDir, pkg.relativeDir);
      const linkedPackageDir = path.join(skillsDir, pkg.relativeDir);
      await mkdir(path.dirname(linkedPackageDir), { recursive: true });
      await symlink(canonicalPackageDir, linkedPackageDir);
    }
  }
}

async function assertInstallPathsAreAvailable(
  packages: Array<{ relativeDir: string }>,
  targets: InstallTargetContext,
): Promise<void> {
  const plannedPaths = new Set<string>();
  for (const pkg of packages) {
    plannedPaths.add(path.join(targets.canonicalSkillsDir, pkg.relativeDir));
    for (const skillsDir of targets.linkedSkillsDirs) {
      plannedPaths.add(path.join(skillsDir, pkg.relativeDir));
    }
  }

  for (const filePath of plannedPaths) {
    if (await pathExists(filePath)) {
      throw new Error(`A skill already exists at ${filePath}. Remove or rename it before adding this skill.`);
    }
  }
}

async function resolveInstallTargetContext(
  options: ScanSkillInventoryOptions & { paths: SkillIndexPaths },
): Promise<InstallTargetContext> {
  const scope = resolveInstallScope(options);
  const liveHomeDir = options.homeDir ?? homedir();
  const canonicalSkillsDir = scope === 'sandbox'
    ? options.paths.sandboxAgentsSkillsDir
    : path.join(liveHomeDir, '.agents', 'skills');
  const agents = await buildInventoryAgents({
    ...options,
    includeSandboxSources: scope === 'sandbox',
    includeLiveSources: scope === 'live',
    paths: options.paths,
  });
  const linkedSkillsDirs = [...new Set(
    agents
      .filter((agent) => isLinkableInstalledAgent(agent, scope))
      .map((agent) => agent.skillsLocation.path as string)
      .filter((skillsDir) => path.normalize(skillsDir) !== path.normalize(canonicalSkillsDir)),
  )];

  await mkdir(canonicalSkillsDir, { recursive: true });

  return {
    canonicalSkillsDir,
    linkedSkillsDirs,
    scope,
  };
}

function isLinkableInstalledAgent(agent: AgentRecord, scope: 'sandbox' | 'live'): boolean {
  return agent.scope === scope
    && agent.installState === 'installed'
    && agent.skillsLocation.state === 'available'
    && typeof agent.skillsLocation.path === 'string'
    && agent.skillsLocation.path.length > 0;
}

function resolveInstallScope(options: ScanSkillInventoryOptions): 'sandbox' | 'live' {
  const includeSandboxSources = options.includeSandboxSources ?? false;
  const includeLiveSources = options.includeLiveSources ?? true;

  if (includeSandboxSources === includeLiveSources) {
    throw new Error('Add skill requires a single active inventory scope.');
  }

  return includeSandboxSources ? 'sandbox' : 'live';
}

function normalizeManualSkillDir(skillName: string): string {
  const trimmed = skillName.trim();
  if (!trimmed) {
    throw new Error('Enter a skill name before adding a skill.');
  }

  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Skill names cannot include path separators.');
  }

  return trimmed;
}

function normalizeSkillMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    throw new Error('Paste SKILL.md contents before adding a skill.');
  }

  return `${trimmed}\n`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}
