import { mkdir, writeTextFile, readDir, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { exportAllData } from './database';

const BACKUP_DIR = 'ParkingOS/backups';
const KEEP_DAYS = 90;

export async function performDailyBackup(): Promise<void> {
  try {
    await mkdir(BACKUP_DIR, { baseDir: BaseDirectory.AppData, recursive: true });

    const data = await exportAllData();
    const today = new Date().toISOString().split('T')[0];
    const fileName = `${BACKUP_DIR}/${today}.json`;

    await writeTextFile(fileName, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.AppData,
    });

    await cleanOldBackups();
  } catch (err) {
    console.error('Backup failed:', err);
  }
}

async function cleanOldBackups(): Promise<void> {
  try {
    const entries = await readDir(BACKUP_DIR, { baseDir: BaseDirectory.AppData });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);

    for (const entry of entries) {
      if (!entry.name?.endsWith('.json')) continue;
      const dateStr = entry.name.replace('.json', '');
      const fileDate = new Date(dateStr);
      if (!isNaN(fileDate.getTime()) && fileDate < cutoff) {
        await remove(`${BACKUP_DIR}/${entry.name}`, { baseDir: BaseDirectory.AppData });
      }
    }
  } catch {
    // Ignore if directory doesn't exist yet
  }
}

export async function getLastBackupDate(): Promise<string | null> {
  try {
    const entries = await readDir(BACKUP_DIR, { baseDir: BaseDirectory.AppData });
    const dates = entries
      .filter(e => e.name?.endsWith('.json'))
      .map(e => e.name!.replace('.json', ''))
      .sort()
      .reverse();
    return dates[0] ?? null;
  } catch {
    return null;
  }
}

// Schedule backup every day — checks on app start
export function scheduleDailyBackup(): void {
  const checkAndBackup = async () => {
    const lastBackup = await getLastBackupDate();
    const today = new Date().toISOString().split('T')[0];
    if (lastBackup !== today) {
      await performDailyBackup();
    }
  };

  checkAndBackup();

  // Check every hour (to handle case where app is left open past midnight)
  setInterval(checkAndBackup, 60 * 60 * 1000);
}
