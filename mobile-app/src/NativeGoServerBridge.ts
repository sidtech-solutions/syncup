import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  readonly startServer: () => number;
  readonly stopServer: () => boolean;
  readonly getServerPort: () => number;
  readonly getApiKey: () => string;
  readonly getDeviceId: () => string;
  readonly getGuiAddress: () => string;
  readonly getDataDir: () => string;
  readonly listSubdirs: (path: string) => string;
  readonly mkdirSubdir: (parent: string, name: string) => string;
  readonly removeDir: (path: string) => string;
  readonly copyFile: (src: string, dst: string) => string;
  readonly resolvePath: (path: string) => string;
  readonly zipDir: (srcDir: string, dstPath: string) => string;
  readonly setSuspended: (suspended: boolean) => void;
  readonly getWifiOnlySync: () => boolean;
  readonly setWifiOnlySync: (enabled: boolean) => boolean;
  readonly getChargingOnlySync: () => boolean;
  readonly setChargingOnlySync: (enabled: boolean) => boolean;
  readonly getContinuousBackgroundSync: () => boolean;
  readonly setContinuousBackgroundSync: (enabled: boolean) => boolean;
  readonly getAllowMeteredWifi: () => boolean;
  readonly setAllowMeteredWifi: (enabled: boolean) => boolean;
  readonly getAllowMobileData: () => boolean;
  readonly setAllowMobileData: (enabled: boolean) => boolean;
  readonly openBatteryOptimizationSettings: () => boolean;
  readonly isIgnoringBatteryOptimizations: () => boolean;
  readonly openFolderInFileManager: (path: string) => boolean;
  readonly getFoldersRoot: () => string;
  readonly setFoldersRoot: (path: string) => boolean;
  readonly maybeNotifyFolderErrors: (
    folderId: string,
    count: number,
    label: string,
    sampleError: string,
  ) => boolean;
  /**
   * Mirror the JS-side vault registry to native storage so the iOS background
   * task can fire a "vault stale" local notification without re-reading
   * AsyncStorage. Payload shape:
   *   { "vaults": [folderId, ...], "lastSyncs": { folderId: epochMs, ... } }
   * Android: no-op (foreground service notification already advertises sync
   * state continuously).
   */
  readonly setVaultRegistry: (json: string) => void;
  /**
   * Android-only opt-in gate for AppConfigReceiver. When false (default),
   * external broadcasts (Tasker / ADB) are dropped with a warning in
   * logcat. iOS returns false unconditionally — there's no equivalent
   * surface there.
   */
  readonly getExternalControlEnabled: () => boolean;
  readonly setExternalControlEnabled: (enabled: boolean) => boolean;
  /**
   * Android-only: when true, BootReceiver starts SyncthingService after
   * ACTION_BOOT_COMPLETED. Default false. iOS returns false unconditionally.
   */
  readonly getStartOnBoot: () => boolean;
  readonly setStartOnBoot: (enabled: boolean) => boolean;
  /**
   * Present the system folder picker. Cross-platform: Android wraps SAF
   * (`ACTION_OPEN_DOCUMENT_TREE`), iOS wraps `UIDocumentPickerViewController`
   * + security-scoped bookmarks. Returns JSON string:
   *   { ok: true, id, path, displayName, isUbiquitous }  on success,
   *   ""                                                  on cancel.
   */
  readonly pickExternalFolder: () => string;
  /**
   * JSON array of currently-persisted external folders:
   *   [{ id, path, displayName, isStale, previousPaths? }]
   * On Android `id === path === content://...`. On iOS `id` is an opaque UUID,
   * `path` is the resolved POSIX path and `previousPaths` lists earlier
   * resolved paths (the owning app's container UUID changes on update).
   */
  readonly getPersistedExternalFolders: () => string;
  /** Drop access for the folder; returns true if it existed. */
  readonly revokeExternalFolder: (path: string) => boolean;
  /** User-facing name (e.g. "Downloads") for an external folder. */
  readonly getExternalFolderDisplayName: (path: string) => string;
  /** True if the persisted access is still valid (and on iOS, not stale). */
  readonly validateExternalFolder: (path: string) => boolean;
  /**
   * Android: true if the user has granted MANAGE_EXTERNAL_STORAGE
   * (Environment.isExternalStorageManager()). iOS: true unconditionally —
   * there is no equivalent system gate, and the JS-side flow treats `true`
   * as "no need to ask the user."
   */
  readonly hasAllFilesAccess: () => boolean;
  /**
   * Android: launch the system "All files access" settings screen for this
   * package via ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION. The user is
   * sent out of the app; permission state must be re-checked on resume.
   * Returns true if the intent was launched. iOS: no-op, returns false.
   */
  readonly requestAllFilesAccess: () => boolean;
  /**
   * Android-only: list immediate subdirectories of a POSIX path using
   * java.io.File. Bypasses the Go sandbox check; used by the All Files Access
   * folder browser. JSON shape matches listSubdirs(): `{ path, entries }` or
   * `{ error }`. iOS returns an error.
   */
  readonly listLocalSubdirs: (path: string) => string;
  /**
   * Android-only: mkdir an immediate child under a POSIX parent. Returns
   * `{ path }` on success, `{ error }` on failure. iOS returns an error.
   */
  readonly mkdirLocalSubdir: (parent: string, name: string) => string;
  /**
   * Android-only: absolute path of the primary external storage root, as
   * resolved by Environment.getExternalStorageDirectory(). This is usually
   * `/storage/emulated/0`, but under a secondary Android user (e.g. Private
   * Space, work profile) it is `/storage/emulated/<userId>`. The All Files
   * Access browser uses this as its starting root so it doesn't assume the
   * hardcoded primary path. Returns "" on iOS.
   */
  readonly getExternalStorageRoot: () => string;
  /**
   * Android-only: copy a SAF file into the app cache so RN preview can load
   * it via file:// URI. Returns the cache path or "" on failure. iOS doesn't
   * need this — once scope is held the path is already a real POSIX file.
   */
  readonly copySafFileToCache: (treeURI: string, relativePath: string) => string;
  /**
   * iOS-only: present QLPreviewController over a list of local file paths.
   * `pathsJson` is a JSON-encoded string array. Asynchronous; returns nothing
   * meaningful — the UI is presented on the key window's root VC. No-op on
   * Android (use the JS-side FilePreviewModal instead).
   */
  readonly previewFileNative: (pathsJson: string, startIndex: number) => void;
  readonly exportConfig: (asyncStorageJson: string) => string;
  readonly importConfig: (password: string) => string;
}

export default TurboModuleRegistry.getEnforcing<Spec>('GoServerBridge');
