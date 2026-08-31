import { mkdir, rename, rm, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { SkillScanSource } from '@shared/contracts';
import { assertSkillSymlinkTargetIsUniversal } from '@main/plugin-managed-sources';

export interface ReplaceSkillLinksOptions {
  failAt?: number;
  validateDestination?(locationPath: string): Promise<void>;
}

export interface SkillLinkTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface BackupEntry {
  backupPath?: string;
  locationPath: string;
}

export async function replaceSkillLinksTransaction(
  locationPaths: string[],
  canonicalPath: string,
  sources: SkillScanSource[],
  options: ReplaceSkillLinksOptions = {},
): Promise<SkillLinkTransaction> {
  const backups: BackupEntry[] = [];
  try {
    for (const [index, locationPath] of locationPaths.entries()) {
      await assertSkillSymlinkTargetIsUniversal(canonicalPath, sources);
      await options.validateDestination?.(locationPath);
      await mkdir(path.dirname(locationPath), { recursive: true });
      const backupPath = path.join(path.dirname(locationPath), `.${path.basename(locationPath)}.backup-${randomUUID()}`);
      const moved = await rename(locationPath, backupPath)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
      backups.push({ locationPath, backupPath: moved ? backupPath : undefined });
      if (options.failAt === index + 1) {
        throw new Error(`Injected skill link replacement failure at ${index + 1}.`);
      }
      await symlink(canonicalPath, locationPath);
    }
  } catch (error) {
    await restoreBackups(backups);
    throw error;
  }

  return {
    commit: async () => {
      await Promise.all(backups.flatMap((entry) => entry.backupPath
        ? [rm(entry.backupPath, { recursive: true, force: true }).catch(() => undefined)]
        : []));
    },
    rollback: async () => restoreBackups(backups),
  };
}

async function restoreBackups(backups: BackupEntry[]): Promise<void> {
  for (const entry of backups.slice().reverse()) {
    await rm(entry.locationPath, { recursive: true, force: true }).catch(() => undefined);
    if (entry.backupPath) {
      await rename(entry.backupPath, entry.locationPath).catch(() => undefined);
    }
  }
}
