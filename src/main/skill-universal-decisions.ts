import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  SkillLocationRecord,
  SkillRecord,
  SkillUniversalAlternate,
  SkillUniversalDecision,
  SkillUniversalOrigin,
} from '@shared/contracts';
import {
  readSkillIndexConfig,
  writeSkillIndexConfig,
  type ResolveSkillIndexPathOptions,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

export async function persistSkillUniversalDecisionForSelection(
  skill: SkillRecord,
  selectedLocation: SkillLocationRecord,
  options: ResolveSkillIndexPathOptions & { paths: SkillIndexPaths },
): Promise<void> {
  if (!shouldPersistSkillUniversalDecision(skill, selectedLocation)) {
    return;
  }

  const acceptedAlternates = findDivergentReadOnlyPluginAlternates(skill, selectedLocation);
  const decision: SkillUniversalDecision = {
    id: createSkillUniversalDecisionId(skill.name, selectedLocation),
    skillName: skill.name,
    state: 'user-confirmed',
    universal: buildSkillUniversalOrigin(selectedLocation),
    acceptedAlternates,
    updatedAt: new Date().toISOString(),
  };
  const config = await readSkillIndexConfig(options.paths.configFile, options);
  const affectedPluginKeys = new Set(getDecisionPluginKeys(decision));

  await writeSkillIndexConfig(options.paths.configFile, {
    ...config,
    skillUniversalDecisions: [
      ...(config.skillUniversalDecisions ?? []).filter((candidate) =>
        candidate.skillName !== skill.name
        && !getDecisionPluginKeys(candidate).some((pluginKey) => affectedPluginKeys.has(pluginKey))),
      decision,
    ],
  });
}

function buildSkillUniversalOrigin(location: SkillLocationRecord): SkillUniversalOrigin {
  const plugin = location.provenance?.plugin;
  if (plugin) {
    return {
      kind: 'plugin',
      host: plugin.host,
      pluginId: plugin.pluginId,
      pluginVersion: plugin.version,
      pluginSkillName: path.basename(location.path),
    };
  }

  return {
    kind: 'path',
    sourceId: location.sourceId,
    path: location.path,
  };
}

function buildSkillUniversalAlternate(location: SkillLocationRecord): SkillUniversalAlternate | null {
  const plugin = location.provenance?.plugin;
  if (!plugin) {
    return null;
  }

  return {
    kind: 'plugin',
    host: plugin.host,
    pluginId: plugin.pluginId,
    pluginVersion: plugin.version,
    pluginSkillName: path.basename(location.path),
    reason: 'kept-separate',
  };
}

function shouldPersistSkillUniversalDecision(
  skill: SkillRecord,
  selectedLocation: SkillLocationRecord,
): boolean {
  return selectedLocation.provenance?.kind === 'plugin'
    || skill.locations.some((location) => location.provenance?.kind === 'plugin');
}

function findDivergentReadOnlyPluginAlternates(
  skill: SkillRecord,
  selectedLocation: SkillLocationRecord,
): SkillUniversalAlternate[] {
  const selectedComparisonKey = getSkillLocationComparisonKey(selectedLocation);
  const seen = new Set<string>();

  return skill.locations
    .filter((location) =>
      location.fileType === 'real-file'
      && location.provenance?.kind === 'plugin'
      && location.mutability === 'read-only-managed'
      && normalizePath(location.path) !== normalizePath(selectedLocation.path)
      && getSkillLocationComparisonKey(location) !== selectedComparisonKey)
    .map(buildSkillUniversalAlternate)
    .filter((alternate): alternate is SkillUniversalAlternate => alternate !== null)
    .filter((alternate) => {
      const key = getAlternatePluginKey(alternate);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getSkillLocationComparisonKey(location: SkillLocationRecord): string {
  if (location.contentHash) {
    return `hash:${location.contentHash}`;
  }

  const normalizedDefinitionText = location.definitionText?.trim();
  if (normalizedDefinitionText) {
    return `text:${normalizedDefinitionText}`;
  }

  return `path:${normalizePath(location.resolvedPath ?? location.path)}`;
}

function getDecisionPluginKeys(decision: SkillUniversalDecision): string[] {
  return [
    decision.universal.kind === 'plugin' ? getOriginPluginKey(decision.universal) : null,
    ...decision.acceptedAlternates
      .filter((alternate) => alternate.kind === 'plugin')
      .map(getAlternatePluginKey),
  ].filter((key): key is string => key !== null);
}

function getOriginPluginKey(origin: Extract<SkillUniversalOrigin, { kind: 'plugin' }>): string {
  return [
    origin.host,
    origin.pluginId,
    origin.pluginVersion ?? '',
    origin.pluginSkillName,
  ].join(':');
}

function getAlternatePluginKey(alternate: SkillUniversalAlternate): string {
  return [
    alternate.host ?? '',
    alternate.pluginId ?? '',
    alternate.pluginVersion ?? '',
    alternate.pluginSkillName ?? '',
  ].join(':');
}

function createSkillUniversalDecisionId(skillName: string, location: SkillLocationRecord): string {
  const hash = createHash('sha256');
  hash.update(skillName);
  hash.update('\0');
  hash.update(location.sourceId);
  hash.update('\0');
  hash.update(normalizePath(location.path));
  return `skill:${hash.digest('hex').slice(0, 12)}`;
}

function normalizePath(targetPath: string): string {
  return path.normalize(targetPath);
}
