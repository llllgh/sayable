import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const BACKUP_DIR = 'backups';
const EXPORT_DIR = 'exports';
const RETAINED_BACKUPS = 7;

function datePart(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function backupName(date = new Date()): string {
  return `sayable-backup-${datePart(date)}.json`;
}

async function ensureDirectory(path: string, directory: Directory): Promise<void> {
  await Filesystem.mkdir({ path, directory, recursive: true }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  });
}

export async function createDailyBackup(json: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  await ensureDirectory(BACKUP_DIR, Directory.Data);

  const name = backupName();
  const listing = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Data });
  const names = listing.files.map((file) => file.name);
  if (names.includes(name)) return false;

  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${name}`,
    data: json,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  const old = names
    .filter((file) => /^sayable-backup-\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse()
    .slice(RETAINED_BACKUPS - 1);
  await Promise.all(old.map((file) => Filesystem.deleteFile({
    path: `${BACKUP_DIR}/${file}`,
    directory: Directory.Data,
  }).catch(() => undefined)));
  return true;
}

export async function exportSnapshot(json: string): Promise<void> {
  const name = `sayable-${datePart()}.json`;
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  await ensureDirectory(EXPORT_DIR, Directory.Cache);
  const result = await Filesystem.writeFile({
    path: `${EXPORT_DIR}/${name}`,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await Share.share({
    title: '导出说得出数据',
    text: '说得出本地数据备份（不含 API Key）',
    url: result.uri,
    dialogTitle: '保存或分享备份',
  });
}
