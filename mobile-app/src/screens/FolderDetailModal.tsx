import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { Focusable } from '../components/Focusable';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useSyncthing, useSyncthingClient } from '../daemon/SyncthingContext';
import type { DbStatus, DeviceConfig, FolderConfig, FolderError } from '../api/types';
import { isAbortError } from '../api/syncthing';
import { colors, formatBytes, Progress } from '../components/ui';
import { removeDir } from '../fs/bridgeFs';
import GoBridge from '../GoServerBridgeJSI';
import {
  filesystemTypeForExternal,
  isExternalFolder,
  pickExternalFolderWithICloudWarning,
  externalFolderNeedsAllFilesAccess,
  validateExternalFolderAccess,
} from '../fs/externalFolder';
import { FolderIgnoresEditor } from './FolderIgnoresEditor';
import { FolderAdvancedEditor } from './FolderAdvancedEditor';
import { FolderVersioningEditor } from './FolderVersioningEditor';
import { FolderBrowser } from './FolderBrowser';
import { ConflictResolver } from './ConflictResolver';
import { FolderStatistics } from './FolderStatistics';
import { ExternalSharingSettings } from './ExternalSharingSettings';
import { FolderTypePicker } from '../components/FolderTypePicker';
import { Icon } from '../components/Icon';
import {
  isSelectiveIgnoreList,
  getSelectedPaths,
  enableSelective,
  disableSelective,
} from '../utils/selectiveSync';
import {
  applyPresetToFolder,
  presetDefaults,
  isObsidianMarker,
} from '../utils/folderPresets';
import { forgetFolder, loadVaults, markAsVault } from '../utils/vaultRegistry';

const OBSIDIAN_PRESET_TAG = '// SyncUp Obsidian preset';

type Page = 'main' | 'ignores' | 'advanced' | 'versioning' | 'browse' | 'conflicts' | 'statistics' | 'sharing';

function versioningSubtitle(type: string | undefined): string {
  switch (type) {
    case 'trashcan':
      return 'Trash can';
    case 'simple':
      return 'Simple';
    case 'staggered':
      return 'Staggered';
    case 'external':
      return 'External';
    default:
      return 'No versioning';
  }
}

interface Props {
  visible: boolean;
  folder: FolderConfig | null;
  status: DbStatus | null;
  errors?: FolderError[];
  onClose: () => void;
  onChanged: () => void;
}

export function FolderDetailModal({
  visible,
  folder,
  status,
  errors = [],
  onClose,
  onChanged,
}: Props) {
  const { info } = useSyncthing();
  const client = useSyncthingClient();
  const keyboardHeight = useKeyboardHeight();
  const { height: winHeight } = useWindowDimensions();
  // pin height so sub-pages don't collapse to their content
  const sheetHeight = Math.max(320, (winHeight - keyboardHeight) * 0.92);

  const [allDevices, setAllDevices] = useState<DeviceConfig[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folderType, setFolderType] = useState<FolderConfig['type']>('sendreceive');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoreCount, setIgnoreCount] = useState<number | null>(null);
  const [isSelective, setIsSelective] = useState(false);
  const [selectedPathCount, setSelectedPathCount] = useState(0);
  const [encryptionPasswords, setEncryptionPasswords] = useState<Record<string, string>>({});
  const [externalAccessValid, setExternalAccessValid] = useState(true);
  const [page, setPage] = useState<Page>('main');
  const [vaultDetected, setVaultDetected] = useState(false);
  const [presetApplied, setPresetApplied] = useState(false);
  const [obsidianInstalled, setObsidianInstalled] = useState(false);
  const [isRegisteredVault, setIsRegisteredVault] = useState(false);

  const foldersRoot = info?.foldersRoot ?? '';
  const isExternal = useMemo(
    () => (folder ? isExternalFolder(folder, foldersRoot) : false),
    [folder, foldersRoot],
  );

  useEffect(() => {
    if (!visible) {
      // reset so next open doesn't show a stale sub-page
      setPage('main');
      return;
    }
    if (!folder) return;
    setSelected(new Set(folder.devices.map(d => d.deviceID)));
    setFolderType(folder.type);
    setError(null);
    const pwMap: Record<string, string> = {};
    for (const d of folder.devices) {
      if (d.encryptionPassword) pwMap[d.deviceID] = d.encryptionPassword;
    }
    setEncryptionPasswords(pwMap);
    if (isExternalFolder(folder, foldersRoot)) {
      setExternalAccessValid(validateExternalFolderAccess(folder));
    } else {
      setExternalAccessValid(true);
    }
    client.devices().then(setAllDevices).catch(e => setError(String(e)));
    client
      .getIgnores(folder.id)
      .then(lines => {
        setIgnoreCount(lines.filter(l => l.trim().length > 0).length);
        setIsSelective(isSelectiveIgnoreList(lines));
        setSelectedPathCount(getSelectedPaths(lines).length);
        setPresetApplied(lines.some(l => l.trim() === OBSIDIAN_PRESET_TAG));
      })
      .catch(() => {
        setIgnoreCount(null);
        setIsSelective(false);
        setSelectedPathCount(0);
        setPresetApplied(false);
      });
    setVaultDetected(false);
    setIsRegisteredVault(false);
    const folderId = folder.id;
    loadVaults()
      .then(set => setIsRegisteredVault(set.has(folderId)))
      .catch(() => setIsRegisteredVault(false));
    client
      .dbBrowse(folderId, '', 1)
      .then(entries => {
        const detected = entries.some(e => isObsidianMarker(e.name));
        setVaultDetected(detected);
        if (detected) {
          markAsVault(folderId).catch(() => {});
          setIsRegisteredVault(true);
        }
      })
      .catch(() => setVaultDetected(false));
    Linking.canOpenURL('obsidian://')
      .then(setObsidianInstalled)
      .catch(() => setObsidianInstalled(false));
  }, [visible, folder, client, foldersRoot]);

  const recheckExternalAccess = useCallback(() => {
    if (folder && isExternalFolder(folder, foldersRoot)) {
      setExternalAccessValid(validateExternalFolderAccess(folder));
    }
  }, [folder, foldersRoot]);

  // Re-validate when the app returns to foreground so the banner clears after
  // the user grants All Files Access in the system settings screen.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') recheckExternalAccess();
    });
    return () => sub.remove();
  }, [visible, recheckExternalAccess]);

  const peers = useMemo(
    () => allDevices.filter(d => d.deviceID !== info?.deviceId),
    [allDevices, info?.deviceId],
  );

  const togglePeer = (deviceId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const saveChanges = async () => {
    if (!folder || !info) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Partial<FolderConfig> = {};
      // self must always be in the list
      selected.add(info.deviceId);
      const nextDevices = Array.from(selected).map(deviceID => ({
        deviceID,
        introducedBy: '',
        encryptionPassword: encryptionPasswords[deviceID] ?? '',
      }));
      const currentIds = new Set(folder.devices.map(d => d.deviceID));
      const deviceDiff =
        currentIds.size !== selected.size ||
        Array.from(selected).some(id => !currentIds.has(id));
      if (deviceDiff) patch.devices = nextDevices;
      if (folderType !== folder.type) patch.type = folderType;
      if (Object.keys(patch).length === 0) return;
      await client.patchFolder(folder.id, patch);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyObsidianPreset = async () => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      const isSaf = folder.filesystemType === 'saf';
      const next = applyPresetToFolder(folder, 'obsidian', { isSaf });
      const patch: Partial<FolderConfig> = {
        rescanIntervalS: next.rescanIntervalS,
        fsWatcherEnabled: next.fsWatcherEnabled,
        fsWatcherDelayS: next.fsWatcherDelayS,
        ignorePerms: next.ignorePerms,
      };
      await client.patchFolder(folder.id, patch);
      const presetLines = presetDefaults('obsidian').ignoreLines;
      const current = await client.getIgnores(folder.id);
      // Append, don't replace — user may have hand-tuned ignores already.
      const existing = new Set(current.map(l => l.trim()));
      const merged = [...current, ...presetLines.filter(l => !existing.has(l.trim()))];
      await client.setIgnores(folder.id, merged);
      setPresetApplied(true);
      setIgnoreCount(merged.filter(l => l.trim().length > 0).length);
      markAsVault(folder.id).catch(() => {});
      setIsRegisteredVault(true);
      // Kick the daemon so the new ignores and watcher kick in now,
      // not at the next 30s tick.
      try {
        await client.scanFolder(folder.id);
      } catch {
        // best-effort
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openInObsidian = async () => {
    if (!folder) return;
    // Vault name = folder label (or id, as a fallback). Obsidian only matches
    // vaults it already has registered. If it doesn't recognise the name, the
    // app opens to its vault picker — still better than nothing.
    const vaultName = (folder.label || folder.id).trim();
    const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}`;
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert(
        'Could not open Obsidian',
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  const togglePause = async () => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      await client.patchFolder(folder.id, { paused: !folder.paused });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rescan = async () => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      await client.scanFolder(folder.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const override = () => {
    if (!folder) return;
    Alert.alert(
      'Override changes?',
      'This folder is send-only. Override will publish your local state as authoritative and discard any differing changes peers have made.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Override',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await client.overrideFolder(folder.id);
              onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const revert = () => {
    if (!folder) return;
    Alert.alert(
      'Revert local changes?',
      'This folder is receive-only. Revert will discard local modifications and pull the cluster state again. Local-only changes will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revert',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await client.revertFolder(folder.id);
              onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const doDelete = async (alsoRemoveFiles: boolean) => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      // unlink first so the daemon releases handles before we touch the files
      await client.deleteFolder(folder.id);
      forgetFolder(folder.id).catch(() => {});
      if (alsoRemoveFiles) {
        try {
          removeDir(folder.path);
        } catch (e) {
          // config already gone; surface the disk failure separately
          const msg = e instanceof Error ? e.message : String(e);
          Alert.alert(
            'Folder removed, files kept',
            `The folder was unlinked from sync, but we could not delete the files at:\n\n${folder.path}\n\nReason: ${msg}\n\nRemove them manually from your file manager.`,
          );
          onChanged();
          onClose();
          return;
        }
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const moveReady = !!status && status.state === 'idle' && status.needBytes === 0;

  const doMove = async (newPath: string, displayName: string) => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    const oldPath = folder.path;
    try {
      let ignores: string[] = [];
      try {
        ignores = await client.getIgnores(folder.id);
      } catch {
        // keep going; folder still usable without ignores
      }
      await client.deleteFolder(folder.id);
      const fsType = filesystemTypeForExternal(newPath);
      const usesSaf = fsType === 'saf';
      const moved: FolderConfig = {
        ...folder,
        path: newPath,
        filesystemType: fsType,
        rescanIntervalS: usesSaf ? 60 : folder.rescanIntervalS,
        fsWatcherEnabled: !usesSaf && folder.fsWatcherEnabled,
      };
      try {
        await client.putFolder(moved);
      } catch (e) {
        if (!isAbortError(e)) throw e;
        const created = await client.waitForFolder(moved.id, { deadlineMs: 60_000 });
        if (!created) throw new Error('Moving the folder timed out. Please try again.');
      }
      if (ignores.length > 0) {
        try {
          await client.setIgnores(moved.id, ignores);
        } catch {
          // best-effort
        }
      }
      onChanged();
      onClose();
      if (isExternal) return;
      Alert.alert(
        'Folder moved',
        `"${folder.label || folder.id}" now syncs to ${displayName}. Files will be re-downloaded from your other devices.\n\nDelete the old copy in app storage?`,
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Delete old copy',
            style: 'destructive',
            onPress: () => {
              try {
                removeDir(oldPath);
              } catch (e) {
                Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
              }
            },
          },
        ],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmMove = () => {
    if (!folder) return;
    if (!moveReady) {
      Alert.alert(
        'Folder not up to date',
        'Wait until this folder shows "Up to date" before moving it, otherwise local changes that have not synced yet will be lost.',
      );
      return;
    }
    pickExternalFolderWithICloudWarning(picked => {
      if (!picked) return;
      const name = picked.displayName || 'the chosen folder';
      Alert.alert(
        'Move folder?',
        `"${folder.label || folder.id}" will sync to ${name} instead of its current location.\n\nAll files will be re-downloaded from your other devices. The folder must stay shared with at least one connected device.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Move', onPress: () => doMove(picked.path, name) },
        ],
      );
    });
  };

  const confirmDelete = () => {
    if (!folder) return;
    Alert.alert(
      'Delete folder?',
      `"${folder.label || folder.id}" lives at:\n\n${folder.path}\n\nChoose what to remove.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink only (keep files)',
          onPress: () => doDelete(false),
        },
        {
          text: 'Delete files too',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete files from disk?',
              `This will permanently remove everything under:\n\n${folder.path}\n\nThis cannot be undone.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete files',
                  style: 'destructive',
                  onPress: () => doDelete(true),
                },
              ],
            );
          },
        },
      ],
    );
  };

  // on a sub-page, close = back to main; otherwise dismiss
  const smartClose = () => {
    if (page !== 'main') {
      setPage('main');
      return;
    }
    onClose();
  };

  const toggleSelective = () => {
    if (!folder) return;
    if (isSelective) {
      Alert.alert(
        'Disable selective sync?',
        'All files from peers will start syncing to this device again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            onPress: async () => {
              setBusy(true);
              try {
                await client.setIgnores(folder.id, disableSelective());
                setIsSelective(false);
                setSelectedPathCount(0);
                onChanged();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } else {
      Alert.alert(
        'Enable selective sync?',
        'This will stop downloading new files automatically. Only files you pin in the browser will sync to this device. Already-downloaded files are kept.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Enable',
            onPress: async () => {
              setBusy(true);
              try {
                const current = await client.getIgnores(folder.id);
                await client.setIgnores(folder.id, enableSelective(current));
                setIsSelective(true);
                setSelectedPathCount(0);
                onChanged();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    }
  };

  const refreshIgnoreCount = () => {
    if (!folder) return;
    client
      .getIgnores(folder.id)
      .then(lines => {
        setIgnoreCount(lines.filter(l => l.trim().length > 0).length);
        setIsSelective(isSelectiveIgnoreList(lines));
        setSelectedPathCount(getSelectedPaths(lines).length);
      })
      .catch(() => {});
  };

  const dirty = useMemo(() => {
    if (!folder) return false;
    if (folderType !== folder.type) return true;
    const current = new Set(folder.devices.map(d => d.deviceID));
    if (current.size !== selected.size) return true;
    for (const id of current) if (!selected.has(id)) return true;
    for (const id of selected) if (!current.has(id)) return true;
    return false;
  }, [folder, selected, folderType]);

  if (!folder) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={smartClose} statusBarTranslucent>
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <TouchableWithoutFeedback onPress={smartClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { height: sheetHeight }]}>
          {page === 'ignores' ? (
            <FolderIgnoresEditor
              folderId={folder.id}
              folderLabel={folder.label || folder.id}
              onBack={() => setPage('main')}
              onSaved={refreshIgnoreCount}
            />
          ) : page === 'advanced' ? (
            <FolderAdvancedEditor
              folder={folder}
              onBack={() => setPage('main')}
              onSaved={onChanged}
            />
          ) : page === 'versioning' ? (
            <FolderVersioningEditor
              folder={folder}
              onBack={() => setPage('main')}
              onSaved={onChanged}
            />
          ) : page === 'browse' ? (
            <FolderBrowser
              folder={folder}
              isSelective={isSelective}
              onBack={() => setPage('main')}
            />
          ) : page === 'conflicts' ? (
            <ConflictResolver
              folder={folder}
              onBack={() => setPage('main')}
              onChanged={onChanged}
            />
          ) : page === 'statistics' ? (
            <FolderStatistics
              folder={folder}
              status={status}
              onBack={() => setPage('main')}
            />
          ) : page === 'sharing' ? (
            <ExternalSharingSettings
              folder={folder}
              onBack={() => setPage('main')}
            />
          ) : (
          <>
          <View style={styles.header}>
            <Focusable onPress={onClose}>
              <Text style={styles.cancel}>Close</Text>
            </Focusable>
            <Text style={styles.title} numberOfLines={1}>
              {folder.label || folder.id}
            </Text>
            <Focusable onPress={saveChanges} disabled={!dirty || busy}>
              {busy ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={[styles.save, !dirty && styles.saveDisabled]}>Save</Text>
              )}
            </Focusable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {error && <Text style={styles.error}>{error}</Text>}

            {vaultDetected && !presetApplied && (
              <View style={styles.vaultBanner}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.vaultBannerTitle}>Obsidian vault detected</Text>
                  <Text style={styles.vaultBannerHint}>
                    Apply the preset to ignore Obsidian's per-device workspace files and tighten the rescan interval.
                  </Text>
                </View>
                <Focusable
                  style={styles.vaultBannerBtn}
                  onPress={applyObsidianPreset}
                  disabled={busy}
                >
                  <Text style={styles.vaultBannerBtnText}>
                    {busy ? '…' : 'Apply'}
                  </Text>
                </Focusable>
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Info</Text>
                {isRegisteredVault && (
                  <View style={styles.vaultChip}>
                    <Text style={styles.vaultChipText}>Obsidian vault</Text>
                  </View>
                )}
              </View>
              <Row label="ID" value={folder.id} mono />
              <Row
                label="Path"
                value={
                  isExternal
                    ? externalAccessValid
                      ? GoBridge.getExternalFolderDisplayName(folder.path) || folder.path
                      : (folder.label || folder.id)
                    : folder.path
                }
                mono
                multiline
              />
              {isExternal && (
                <Row
                  label="Storage"
                  value={
                    Platform.OS === 'android'
                      ? 'Device folder (SAF)'
                      : 'Device folder (Files)'
                  }
                />
              )}
              {isExternal && !externalAccessValid && (
                <View style={styles.safPermWarn}>
                  <Text style={styles.safPermWarnText}>
                    {externalFolderNeedsAllFilesAccess(folder)
                      ? 'This folder is outside the app sandbox and needs the "All files access" permission to sync. This is common after restoring a backup.'
                      : 'Storage access was revoked. This folder cannot sync until you re-grant access.'}
                  </Text>
                  <Focusable
                    style={styles.safPermBtn}
                    onPress={() => {
                      if (externalFolderNeedsAllFilesAccess(folder)) {
                        // A SAF pick can't restore access to a stored POSIX
                        // path; only the system permission can.
                        try {
                          GoBridge.requestAllFilesAccess();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                        return;
                      }
                      pickExternalFolderWithICloudWarning(picked => {
                        if (!picked) return;
                        if (validateExternalFolderAccess(folder)) {
                          setExternalAccessValid(true);
                        } else {
                          Alert.alert(
                            'Different folder selected',
                            'Please select the same folder to restore access.',
                          );
                        }
                      });
                    }}
                  >
                    <Text style={styles.safPermBtnText}>
                      {externalFolderNeedsAllFilesAccess(folder)
                        ? 'Grant All files access'
                        : 'Re-grant access'}
                    </Text>
                  </Focusable>
                </View>
              )}
              {status && (
                <>
                  <Row label="State" value={folder.paused ? 'paused' : status.state} />
                  <Row label="Local files" value={`${status.localFiles} of ${status.globalFiles}`} />
                  <Row label="Local size" value={formatBytes(status.localBytes)} />
                  <Row label="Global size" value={formatBytes(status.globalBytes)} />
                  {status.needBytes > 0 && (
                    <Row label="Need" value={formatBytes(status.needBytes)} />
                  )}
                </>
              )}
              {status && status.globalBytes > 0 && status.needBytes > 0 && (
                <View style={styles.progressBlock}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressPercent}>
                      {Math.floor(((status.globalBytes - status.needBytes) / status.globalBytes) * 100)}%
                    </Text>
                    <Text style={styles.progressBytes}>
                      {formatBytes(status.globalBytes - status.needBytes)} / {formatBytes(status.globalBytes)}
                    </Text>
                  </View>
                  <Progress
                    value={(status.globalBytes - status.needBytes) / status.globalBytes}
                    height={8}
                  />
                  <Text style={styles.progressHint}>
                    {formatBytes(status.needBytes)} remaining
                  </Text>
                </View>
              )}
            </View>

            <Focusable style={styles.browseBtn} onPress={() => setPage('browse')}>
              <Icon name="folder-open" size={22} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>Browse files</Text>
                <Text style={styles.browseHint}>
                  {status
                    ? `${status.globalFiles} file${status.globalFiles === 1 ? '' : 's'}, ${formatBytes(status.globalBytes)}`
                    : 'See what\u2019s in this folder'}
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            {vaultDetected && obsidianInstalled && (
              <Focusable style={styles.browseBtn} onPress={openInObsidian}>
                <Icon name="document-text" size={22} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.browseTitle}>Open in Obsidian</Text>
                  <Text style={styles.browseHint}>
                    Launches the Obsidian app at this vault
                  </Text>
                </View>
                <Text style={styles.browseArrow}>›</Text>
              </Focusable>
            )}

            <Focusable style={styles.browseBtn} onPress={() => setPage('statistics')}>
              <Icon name="bar-chart" size={22} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>Statistics</Text>
                <Text style={styles.browseHint}>
                  Sync progress per device
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            <Focusable style={styles.browseBtn} onPress={() => setPage('ignores')}>
              <Icon name="eye-off" size={22} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>Ignore patterns</Text>
                <Text style={styles.browseHint}>
                  {ignoreCount == null
                    ? 'Exclude files from sync'
                    : ignoreCount === 0
                      ? 'No patterns set'
                      : `${ignoreCount} pattern${ignoreCount === 1 ? '' : 's'} set`}
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            <Focusable style={styles.browseBtn} onPress={() => setPage('versioning')}>
              <Icon name="layers" size={22} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>File versioning</Text>
                <Text style={styles.browseHint}>
                  {versioningSubtitle(folder.versioning?.type)}
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            <Focusable style={styles.browseBtn} onPress={() => setPage('advanced')}>
              <Icon name="settings" size={22} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>Advanced options</Text>
                <Text style={styles.browseHint}>
                  Scan cadence, pull order, disk guard, permissions
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            {errors.length > 0 && (
              <View style={styles.errorsCard}>
                <Text style={styles.errorsTitle}>
                  {errors.length} file{errors.length === 1 ? '' : 's'} with errors
                </Text>
                <Text style={styles.errorsHint}>
                  SyncUp could not finish syncing these paths. Common causes: permission denied, disk full, a file held open by another app.
                </Text>
                {errors.map((e, i) => (
                  <View
                    key={`${e.path}-${i}`}
                    style={[styles.errorRow, i === errors.length - 1 && styles.errorRowLast]}
                  >
                    <Text style={styles.errorPath} numberOfLines={2}>{e.path}</Text>
                    <Text style={styles.errorMsg}>{e.error}</Text>
                  </View>
                ))}
              </View>
            )}

            <Focusable style={styles.browseBtn} onPress={() => setPage('conflicts')}>
              <Icon name="warning" size={22} color="#e5a94b" />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>Resolve conflicts</Text>
                <Text style={styles.browseHint}>
                  Find and resolve .sync-conflict files
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            <Focusable style={styles.browseBtn} onPress={() => setPage('sharing')}>
              <Icon name="link" size={22} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.browseTitle}>External sharing</Text>
                <Text style={styles.browseHint}>
                  Generate web links for files
                </Text>
              </View>
              <Text style={styles.browseArrow}>›</Text>
            </Focusable>

            {folder.type !== 'sendonly' && folder.type !== 'receiveencrypted' && (
              <View style={styles.selectiveSyncRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.browseTitle}>Selective sync</Text>
                  <Text style={styles.browseHint}>
                    {isSelective
                      ? selectedPathCount > 0
                        ? `${selectedPathCount} path${selectedPathCount === 1 ? '' : 's'} pinned to this device`
                        : 'Enabled. Pin files in Browse to sync them.'
                      : 'Only download files you choose'}
                  </Text>
                </View>
                <Switch
                  value={isSelective}
                  onValueChange={toggleSelective}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  disabled={busy}
                />
              </View>
            )}

            <Text style={styles.sectionLabel}>Folder type</Text>
            <View style={styles.typePickerWrap}>
              <FolderTypePicker value={folderType} onChange={setFolderType} disabled={busy} />
            </View>

            <Text style={styles.sectionLabel}>Share with</Text>
            {peers.length === 0 ? (
              <Text style={styles.peerEmpty}>No peer devices known yet.</Text>
            ) : (
              peers.map(d => {
                const on = selected.has(d.deviceID);
                return (
                  <View key={d.deviceID}>
                    <Focusable
                      style={[styles.peer, on && styles.peerOn]}
                      onPress={() => togglePeer(d.deviceID)}
                    >
                      <View style={styles.peerMain}>
                        <Text style={styles.peerName}>{d.name || '(unnamed)'}</Text>
                        <Text style={styles.peerId} numberOfLines={1}>{d.deviceID}</Text>
                      </View>
                      <View style={[styles.checkbox, on && styles.checkboxOn]}>
                        {on && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </Focusable>
                    {on && folderType === 'receiveencrypted' && (
                      <View style={styles.encryptionRow}>
                        <Text style={styles.encryptionLabel}>Encryption password</Text>
                        <TextInput
                          style={styles.encryptionInput}
                          value={encryptionPasswords[d.deviceID] ?? ''}
                          onChangeText={text =>
                            setEncryptionPasswords(prev => ({ ...prev, [d.deviceID]: text }))
                          }
                          placeholder="Enter password for this device"
                          placeholderTextColor={colors.textDim}
                          secureTextEntry
                          autoCorrect={false}
                          autoCapitalize="none"
                        />
                      </View>
                    )}
                  </View>
                );
              })
            )}

            <View style={styles.actions}>
              <Focusable
                style={[styles.actionBtn, styles.pauseBtn]}
                onPress={rescan}
                disabled={busy || folder.paused}
              >
                <Text style={[styles.actionBtnText, folder.paused && styles.actionBtnDisabled]}>
                  Rescan
                </Text>
              </Focusable>
              <Focusable style={[styles.actionBtn, styles.pauseBtn]} onPress={togglePause} disabled={busy}>
                <Text style={styles.actionBtnText}>
                  {folder.paused ? 'Resume' : 'Pause'}
                </Text>
              </Focusable>
            </View>

            {folder.type === 'sendonly' &&
              status &&
              status.needBytes === 0 &&
              status.receiveOnlyChangedBytes === 0 ? null : folder.type === 'sendonly' ? (
              <Focusable
                style={[styles.actionBtn, styles.overrideBtn]}
                onPress={override}
                disabled={busy}
              >
                <Text style={[styles.actionBtnText, styles.overrideBtnText]}>
                  Override changes (send local state)
                </Text>
              </Focusable>
            ) : null}

            {folder.type === 'receiveonly' && status && status.receiveOnlyChangedBytes > 0 ? (
              <Focusable
                style={[styles.actionBtn, styles.overrideBtn]}
                onPress={revert}
                disabled={busy}
              >
                <Text style={[styles.actionBtnText, styles.overrideBtnText]}>
                  Revert local changes ({formatBytes(status.receiveOnlyChangedBytes)})
                </Text>
              </Focusable>
            ) : null}

            <Focusable
              style={[styles.actionBtn, styles.overrideBtn]}
              onPress={confirmMove}
              disabled={busy}
            >
              <Text style={[styles.actionBtnText, styles.overrideBtnText]}>
                Move to another location
              </Text>
            </Focusable>

            <Focusable
              style={[styles.actionBtn, styles.deleteBtn, styles.deleteBtnFull]}
              onPress={confirmDelete}
              disabled={busy}
            >
              <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Delete folder</Text>
            </Focusable>

          </ScrollView>
          </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  if (multiline) {
    return (
      <View style={styles.rowStacked}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={[styles.rowValueStacked, mono && styles.mono]} selectable>{value}</Text>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} selectable numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  cancel: { color: colors.textDim, fontSize: 15 },
  save: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  saveDisabled: { color: colors.border },
  body: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  rowStacked: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.textDim, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, flex: 1, textAlign: 'right' },
  rowValueStacked: { color: colors.text, fontSize: 12, marginTop: 4 },
  mono: { fontFamily: 'Menlo' },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  typePickerWrap: { marginBottom: 20 },
  errorsCard: {
    backgroundColor: colors.errorBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  errorsTitle: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  errorsHint: {
    color: '#ffccd0',
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 15,
  },
  errorRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.errorBorder,
  },
  errorRowLast: { borderBottomWidth: 0 },
  errorPath: {
    color: colors.text,
    fontSize: 12,
    fontFamily: 'Menlo',
    marginBottom: 2,
  },
  errorMsg: {
    color: '#ffccd0',
    fontSize: 11,
    lineHeight: 15,
  },
  progressBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 8,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  progressPercent: { color: colors.text, fontSize: 18, fontWeight: '700' },
  progressBytes: { color: colors.textDim, fontSize: 12 },
  progressHint: { color: colors.textDim, fontSize: 11 },
  selectiveSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 14,
    marginBottom: 20,
  },
  browseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 14,
    marginBottom: 20,
  },
  browseIcon: { fontSize: 22 },
  browseTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  browseHint: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  browseArrow: { color: colors.textDim, fontSize: 22 },
  peerEmpty: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', marginBottom: 16 },
  peer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  peerOn: { borderColor: colors.accent },
  peerMain: { flex: 1 },
  peerName: { color: colors.text, fontSize: 14, fontWeight: '500' },
  peerId: { color: colors.textDim, fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  encryptionRow: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    marginTop: -4,
    marginBottom: 8,
  },
  encryptionLabel: {
    color: colors.textDim,
    fontSize: 11,
    marginBottom: 4,
  },
  encryptionInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  pauseBtn: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  deleteBtn: {
    backgroundColor: colors.errorBg,
    borderColor: colors.errorBorder,
  },
  actionBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  actionBtnDisabled: { color: colors.textDim },
  overrideBtn: {
    backgroundColor: colors.card,
    borderColor: colors.accent,
    marginTop: 12,
  },
  overrideBtnText: { color: colors.accent },
  deleteBtnFull: { marginTop: 12 },
  deleteBtnText: { color: colors.error },
  safPermWarn: {
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  safPermWarnText: {
    color: '#ffccd0',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  safPermBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  safPermBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  error: { color: colors.error, fontSize: 13, marginBottom: 12 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  vaultChip: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  vaultChipText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  vaultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  vaultBannerTitle: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  vaultBannerHint: { color: colors.textDim, fontSize: 11, marginTop: 4, lineHeight: 15 },
  vaultBannerBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  vaultBannerBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
