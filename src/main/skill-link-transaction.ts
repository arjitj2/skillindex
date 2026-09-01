import { mkdir, rename, rm, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { SkillScanSource } from '@shared/contracts';
import { assertSkillSourceAndDestinationDoNotOverlap, assertSkillSymlinkTargetIsUniversal } from '@main/plugin-managed-sources';

interface ReplaceSkillLinksOptions {
  failAt?: number;
  failRestoreAt?: number;
  validateDestination?(locationPath: string): Promise<void>;
}

interface SkillLinkTransaction {
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
      await assertSkillSourceAndDestinationDoNotOverlap(path.dirname(locationPath), path.dirname(canonicalPath));
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
    try {
      await restoreBackups(backups, options.failRestoreAt);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Skill link replacement failed and rollback was incomplete.');
    }
    throw error;
  }

  return {
    commit: async () => {
      await Promise.all(backups.flatMap((entry) => entry.backupPath
        ? [rm(entry.backupPath, { recursive: true, force: true }).catch(() => undefined)]
        : []));
    },
    rollback: async () => restoreBackups(backups, options.failRestoreAt),
  };
}

async function restoreBackups(backups: BackupEntry[], failRestoreAt?: number): Promise<void> {
  const failures: unknown[] = [];
  for (const [index, entry] of backups.slice().reverse().entries()) {
    try {
      if (failRestoreAt === index + 1) throw new Error(`Injected skill link restore failure at ${index + 1}.`);
      await rm(entry.locationPath, { recursive: true, force: true });
      if (entry.backupPath) await rename(entry.backupPath, entry.locationPath);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Unable to restore every skill link mutation.');
}
