import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { copyFile } from '../fs/bridgeFs';

export type FolderStructure = 'flat' | 'byDate' | 'byYearMonth';
export type MediaFilter = 'photo' | 'video' | 'all';

export interface PhotoBackupConfig {
  enabled: boolean;
  folderId: string;
  folderPath: string;
  folderLabel: string;
  structure: FolderStructure;
  mediaFilter: MediaFilter;
}

export interface BackupProgress {
  phase: 'idle' | 'scanning' | 'copying' | 'done' | 'error';
  total: number;
  copied: number;
  skipped: number;
  errorMessage?: string;
  lastSkipReason?: string;
}

const CONFIG_KEY = 'photoBackup:config';
const BACKED_UP_KEY = 'photoBackup:assetIds';

export async function loadConfig(): Promise<PhotoBackupConfig | null> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PhotoBackupConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: PhotoBackupConfig): Promise<void> {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export async function clearConfig(): Promise<void> {
  await AsyncStorage.removeItem(CONFIG_KEY);
  await AsyncStorage.removeItem(BACKED_UP_KEY);
}

async function loadBackedUpIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(BACKED_UP_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function saveBackedUpIds(ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(BACKED_UP_KEY, JSON.stringify(Array.from(ids)));
}

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

// canonicalizePath normalizes an Android filesystem path so two paths that point
// at the same location compare equal in the overlap guard. Without this the
// guard misses nested assets when the two sides disagree on surface form:
//   - /sdcard is a symlink to /storage/emulated/0, so the gallery may report
//     /sdcard/DCIM/Archive/VID.mp4 while the backup folder is stored as
//     /storage/emulated/0/DCIM -> startsWith() fails and the asset is copied.
//   - trailing slashes and doubled slashes (file:// joins) also break startsWith.
function canonicalizePath(p: string): string {
  let out = stripFileScheme(p);
  // /sdcard and /storage/self/primary are both the primary external volume.
  out = out.replace(/^\/sdcard(?=\/|$)/, '/storage/emulated/0');
  out = out.replace(/^\/storage\/self\/primary(?=\/|$)/, '/storage/emulated/0');
  // collapse duplicate slashes, then drop any trailing slash
  out = out.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return out;
}

// safTreeToFsPath decodes an Android ExternalStorageProvider tree URI into the
// POSIX path it maps to, so we can tell when a source asset already lives
// inside the chosen backup folder (e.g. picking DCIM as the target):
//   content://com.android.externalstorage.documents/tree/primary%3ADCIM
//     -> /storage/emulated/0/DCIM
// Returns null for any other authority/scheme where there's no stable mapping
// (the SD-card UUID form is handled; opaque providers fall through to null and
// the overlap guard is simply skipped).
function safTreeToFsPath(folderPath: string): string | null {
  const prefix = 'content://com.android.externalstorage.documents/tree/';
  if (!folderPath.startsWith(prefix)) return null;
  let enc = folderPath.slice(prefix.length);
  // Tree URIs may carry a trailing /document/<docId>; the tree root is the
  // part before it.
  const docIdx = enc.indexOf('/document/');
  if (docIdx >= 0) enc = enc.slice(0, docIdx);
  let docId: string;
  try {
    docId = decodeURIComponent(enc);
  } catch {
    return null;
  }
  const colon = docId.indexOf(':');
  if (colon < 0) return null;
  const vol = docId.slice(0, colon);
  const rel = docId.slice(colon + 1);
  const base = vol === 'primary' ? '/storage/emulated/0' : `/storage/${vol}`;
  return rel ? `${base}/${rel}` : base;
}

// resolveTargetRealPath returns the POSIX path of the backup folder so we can
// detect source assets that already live inside it. Handles both folder kinds:
// a content:// SAF tree URI (decoded) and a plain filesystem path used by
// All-Files-Access folders like /storage/emulated/0/DCIM. Returns null only
// when a content:// URI can't be mapped to a stable path.
function resolveTargetRealPath(folderPath: string): string | null {
  const raw = folderPath.startsWith('content://')
    ? safTreeToFsPath(folderPath)
    : stripFileScheme(folderPath);
  return raw == null ? null : canonicalizePath(raw);
}

// isUnder reports whether path lies inside root (or equals it). Both sides are
// canonicalized first so symlink aliases (/sdcard) and slash noise don't cause
// a real overlap to slip through.
function isUnder(path: string, root: string): boolean {
  const p = canonicalizePath(path);
  const r = canonicalizePath(root);
  return p === r || p.startsWith(r + '/');
}

function destPath(
  asset: MediaLibrary.Asset,
  structure: FolderStructure,
): string {
  const name = asset.filename;
  // creationTime is milliseconds on iOS, seconds on some Android versions
  const raw = asset.creationTime;
  const date = new Date(raw < 1e12 ? raw * 1000 : raw);

  switch (structure) {
    case 'byDate': {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}/${name}`;
    }
    case 'byYearMonth': {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      return `${y}/${m}/${name}`;
    }
    case 'flat':
    default:
      return name;
  }
}

export async function runBackup(
  config: PhotoBackupConfig,
  onProgress: (p: BackupProgress) => void,
  signal?: { cancelled: boolean },
  refreshFolderPath?: () => Promise<string | null>,
): Promise<BackupProgress> {
  const progress: BackupProgress = {
    phase: 'scanning',
    total: 0,
    copied: 0,
    skipped: 0,
  };
  onProgress({ ...progress });

  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    progress.phase = 'error';
    progress.errorMessage = 'Photo library permission denied. Grant access in Settings.';
    onProgress({ ...progress });
    return progress;
  }

  // Always use the LIVE folder path from the daemon, not the stale
  // one saved in config. iOS rotates container UUIDs on reinstall,
  // making stored absolute paths invalid.
  let folderPath = config.folderPath;
  if (refreshFolderPath) {
    const fresh = await refreshFolderPath();
    if (fresh) {
      folderPath = fresh;
      if (folderPath !== config.folderPath) {
        await saveConfig({ ...config, folderPath });
      }
    }
  }

  const backedUp = await loadBackedUpIds();

  const mediaType: MediaLibrary.MediaTypeValue[] = (() => {
    switch (config.mediaFilter) {
      case 'photo':
        return [MediaLibrary.MediaType.photo];
      case 'video':
        return [MediaLibrary.MediaType.video];
      default:
        return [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
    }
  })();

  let hasMore = true;
  let after: string | undefined;
  const toBackUp: MediaLibrary.Asset[] = [];

  while (hasMore) {
    if (signal?.cancelled) break;
    const page = await MediaLibrary.getAssetsAsync({
      mediaType,
      first: 100,
      after,
      sortBy: [MediaLibrary.SortBy.creationTime],
    });
    for (const asset of page.assets) {
      if (!backedUp.has(asset.id)) {
        toBackUp.push(asset);
      }
    }
    hasMore = page.hasNextPage;
    after = page.endCursor;
  }

  progress.total = toBackUp.length;
  progress.phase = 'copying';
  onProgress({ ...progress });

  if (toBackUp.length === 0) {
    progress.phase = 'done';
    onProgress({ ...progress });
    return progress;
  }

  const plainPath = folderPath.replace(/^file:\/\//, '');
  const folderUri = `file://${plainPath}`;

  // When the backup target overlaps the media source (e.g. the user picks
  // DCIM or Pictures), copying gallery assets back into it would just create
  // duplicates. Resolve the target to a real path so we can skip any asset
  // that already lives inside it. null = not an external-storage folder, so
  // no overlap is possible and the guard is a no-op.
  const targetRealPath = resolveTargetRealPath(folderPath);

  for (const asset of toBackUp) {
    if (signal?.cancelled) break;

    try {
      const info = await MediaLibrary.getAssetInfoAsync(asset);

      const srcLocalPath = info.localUri ? stripFileScheme(info.localUri) : null;
      if (targetRealPath && srcLocalPath && isUnder(srcLocalPath, targetRealPath)) {
        backedUp.add(asset.id);
        progress.skipped++;
        progress.lastSkipReason = `"${asset.filename}" already in backup folder`;
        onProgress({ ...progress });
        continue;
      }

      // Build a list of candidate source URIs. localUri is preferred
      // (it's a file:// path for on-device assets). asset.uri is the
      // fallback and may be a content:// (Android) or ph:// (iOS) URI.
      const candidates: string[] = [];
      if (info.localUri) candidates.push(info.localUri);
      if (asset.uri && asset.uri !== info.localUri) candidates.push(asset.uri);

      if (candidates.length === 0) {
        progress.skipped++;
        progress.lastSkipReason = `"${asset.filename}": no URI available (iCloud-only?)`;
        onProgress({ ...progress });
        continue;
      }

      const rel = destPath(asset, config.structure);
      const targetUri = `${folderUri}/${rel}`;

      const lastSlash = targetUri.lastIndexOf('/');
      if (lastSlash > 0) {
        const parentDir = targetUri.slice(0, lastSlash);
        try {
          await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });
        } catch {
          // directory may already exist
        }
      }

      const exists = await FileSystem.getInfoAsync(targetUri);
      if (exists.exists) {
        backedUp.add(asset.id);
        progress.skipped++;
        progress.lastSkipReason = `"${asset.filename}" already on disk`;
        onProgress({ ...progress });
        continue;
      }

      // Use the Go bridge for the copy. It has direct filesystem access
      // without expo-file-system's sandbox restrictions, and handles
      // any path the daemon can write to.
      let copied = false;
      let lastErr = '';

      // Final overlap check against the actual file we're about to copy. The
      // early guard uses info.localUri, but the real source can differ (e.g.
      // expo falls back to asset.uri); skipping here guarantees we never copy a
      // file that already lives inside the backup folder, regardless of which
      // candidate URI ends up being the source.
      let overlap = false;
      for (const sourceUri of candidates) {
        if (!sourceUri.startsWith('file://')) continue;
        if (targetRealPath && isUnder(stripFileScheme(sourceUri), targetRealPath)) {
          overlap = true;
          break;
        }
      }
      if (overlap) {
        backedUp.add(asset.id);
        progress.skipped++;
        progress.lastSkipReason = `"${asset.filename}" already in backup folder`;
        onProgress({ ...progress });
        continue;
      }

      for (const sourceUri of candidates) {
        if (copied) break;
        // strip file:// prefix for the Go bridge which takes plain paths
        const srcPath = sourceUri.replace(/^file:\/\//, '');
        const dstPath = targetUri.replace(/^file:\/\//, '');
        try {
          copyFile(srcPath, dstPath);
          copied = true;
          break;
        } catch (e) {
          lastErr = `${srcPath.substring(srcPath.lastIndexOf('/') + 1)}: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      if (copied) {
        backedUp.add(asset.id);
        progress.copied++;
      } else {
        progress.skipped++;
        progress.lastSkipReason = `"${asset.filename}": ${lastErr}`;
      }
      onProgress({ ...progress });

      if (progress.copied % 20 === 0 && progress.copied > 0) {
        await saveBackedUpIds(backedUp);
      }
    } catch (e) {
      progress.skipped++;
      progress.lastSkipReason = `"${asset.filename}": ${e instanceof Error ? e.message : String(e)}`;
      onProgress({ ...progress });
    }
  }

  await saveBackedUpIds(backedUp);

  progress.phase = 'done';
  onProgress({ ...progress });
  return progress;
}
