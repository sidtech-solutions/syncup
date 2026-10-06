import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import GoBridge from '../GoServerBridgeJSI';
import { SyncthingClient } from '../api/syncthing';
import { loadConfig, runBackup } from './PhotoBackup';

// Name of the WorkManager (Android) / BGTask (iOS) job. Must stay stable across
// releases or the OS treats a renamed task as a new, unregistered one.
export const PHOTO_BACKUP_TASK = 'photo-backup-periodic';

// Default cadence. The OS enforces a floor (~15 min on Android, opportunistic on
// iOS); anything lower is effectively clamped by the scheduler.
export const DEFAULT_INTERVAL_MINUTES = 60;
export const MIN_INTERVAL_MINUTES = 15;

// ensureDaemon mirrors readNativeInfo() from SyncthingContext: startServer() is
// idempotent and returns the port (starting the daemon if the foreground
// service isn't already holding it alive). copyFile in the Go bridge needs the
// daemon's config loaded to resolve sandbox roots / SAF trees, so the daemon
// must be up before runBackup copies anything.
function ensureDaemon(): SyncthingClient | null {
  try {
    const port = GoBridge.startServer();
    if (port <= 0) return null;
    return new SyncthingClient({
      apiKey: GoBridge.getApiKey(),
      guiAddress: GoBridge.getGuiAddress(),
    });
  } catch {
    return null;
  }
}

// Define the task at module scope so it is registered in BOTH the foreground JS
// runtime and the headless runtime the OS spins up to run the job. Importing
// this file for its side effect (see index.ts) is what wires that up.
TaskManager.defineTask(PHOTO_BACKUP_TASK, async () => {
  try {
    const config = await loadConfig();
    if (!config || !config.enabled || !config.autoBackup) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const client = ensureDaemon();

    // Refresh the live folder path from the daemon when reachable; otherwise
    // fall back to the stored path inside runBackup.
    const refreshFolderPath = client
      ? async (): Promise<string | null> => {
          try {
            const folders = await client.folders();
            return folders.find(f => f.id === config.folderId)?.path ?? null;
          } catch {
            return null;
          }
        }
      : undefined;

    await runBackup(config, () => {}, undefined, refreshFolderPath);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// enableAutoBackup (re)registers the periodic job. Calling it again with a new
// interval updates the existing registration.
export async function enableAutoBackup(intervalMinutes: number): Promise<void> {
  const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(intervalMinutes));
  await BackgroundTask.registerTaskAsync(PHOTO_BACKUP_TASK, {
    minimumInterval: minutes,
  });
}

export async function disableAutoBackup(): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(PHOTO_BACKUP_TASK);
    if (registered) {
      await BackgroundTask.unregisterTaskAsync(PHOTO_BACKUP_TASK);
    }
  } catch {
    // already gone / never registered
  }
}

// isAutoBackupAvailable reports whether the OS currently permits background
// tasks (false when the user disabled Background App Refresh / battery saver
// restricts the app).
export async function isAutoBackupAvailable(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    return status === BackgroundTask.BackgroundTaskStatus.Available;
  } catch {
    return false;
  }
}

// syncAutoBackupRegistration aligns the OS registration with the saved config.
// Call on app start so a config that says autoBackup:true survives reinstalls /
// OS-cleared registrations, and one that says false leaves nothing scheduled.
export async function syncAutoBackupRegistration(): Promise<void> {
  const config = await loadConfig();
  if (config?.enabled && config.autoBackup) {
    await enableAutoBackup(config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES);
  } else {
    await disableAutoBackup();
  }
}
