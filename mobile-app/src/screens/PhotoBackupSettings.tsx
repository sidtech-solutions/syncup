import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Focusable } from '../components/Focusable';
import { useSyncthingClient } from '../daemon/SyncthingContext';
import type { FolderConfig } from '../api/types';
import { colors } from '../components/ui';
import {
  type BackupProgress,
  type FolderStructure,
  type MediaFilter,
  type PhotoBackupConfig,
  clearConfig,
  loadConfig,
  runBackup,
  saveConfig,
} from '../services/PhotoBackup';
import {
  DEFAULT_INTERVAL_MINUTES,
  disableAutoBackup,
  enableAutoBackup,
} from '../services/photoBackupTask';

interface Props {
  onBack: () => void;
}

const STRUCTURES: { value: FolderStructure; label: string; example: string }[] = [
  { value: 'flat', label: 'All in one folder', example: 'IMG_2020.HEIC' },
  { value: 'byDate', label: 'By date', example: '2024-08-11/IMG_2020.HEIC' },
  { value: 'byYearMonth', label: 'By year/month', example: '2024/08/IMG_2020.HEIC' },
  { value: 'byAlbum', label: 'By album', example: 'Camera/IMG_2020.HEIC' },
];

const FILTERS: { value: MediaFilter; label: string }[] = [
  { value: 'all', label: 'Photos & Videos' },
  { value: 'photo', label: 'Photos only' },
  { value: 'video', label: 'Videos only' },
];

// OS floor is ~15 min on Android; iOS runs opportunistically regardless.
const INTERVALS: { value: number; label: string }[] = [
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Daily' },
];

export function PhotoBackupSettings({ onBack }: Props) {
  const client = useSyncthingClient();
  const [folders, setFolders] = useState<FolderConfig[]>([]);
  const [config, setConfig] = useState<PhotoBackupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const cancelRef = useRef({ cancelled: false });

  useEffect(() => {
    (async () => {
      const [cfg, allFolders] = await Promise.all([
        loadConfig(),
        client.folders().catch(() => [] as FolderConfig[]),
      ]);
      setConfig(cfg);
      setFolders(allFolders);
      setLoading(false);
    })();
  }, [client]);

  const enabled = config?.enabled ?? false;

  const updateConfig = useCallback(
    (patch: Partial<PhotoBackupConfig>) => {
      setConfig(prev => {
        const next = { ...defaultConfig(folders), ...prev, ...patch };
        saveConfig(next).catch(() => {});
        return next;
      });
    },
    [folders],
  );

  const toggleEnabled = () => {
    if (enabled) {
      Alert.alert(
        'Disable photo backup?',
        'Already backed-up photos stay in the folder. Only future auto-backup stops.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            onPress: () => {
              disableAutoBackup().catch(() => {});
              clearConfig().catch(() => {});
              setConfig(null);
            },
          },
        ],
      );
    } else {
      if (folders.length === 0) {
        Alert.alert(
          'No folders',
          'Add a synced folder first, then come back here to enable photo backup.',
        );
        return;
      }
      const first = folders[0];
      updateConfig({
        enabled: true,
        folderId: first.id,
        folderPath: first.path,
        folderLabel: first.label || first.id,
        structure: 'byDate',
        mediaFilter: 'all',
      });
    }
  };

  const startBackup = async () => {
    if (!config || progress?.phase === 'copying' || progress?.phase === 'scanning') return;
    cancelRef.current = { cancelled: false };
    setProgress({ phase: 'scanning', total: 0, copied: 0, skipped: 0 });

    const refreshPath = async (): Promise<string | null> => {
      try {
        const liveFolders = await client.folders();
        const match = liveFolders.find(f => f.id === config.folderId);
        return match?.path ?? null;
      } catch {
        return null;
      }
    };

    const result = await runBackup(config, setProgress, cancelRef.current, refreshPath);
    if (result.phase === 'done' && result.copied > 0) {
      try {
        await client.scanFolder(config.folderId);
      } catch {
        // daemon watcher handles it
      }
    }
  };

  const cancelBackup = () => {
    cancelRef.current.cancelled = true;
  };

  const toggleAutoBackup = (value: boolean) => {
    const interval = config?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
    updateConfig({ autoBackup: value, intervalMinutes: interval });
    if (value) {
      enableAutoBackup(interval).catch(() => {});
    } else {
      disableAutoBackup().catch(() => {});
    }
  };

  const toggleMove = (value: boolean) => {
    if (value) {
      Alert.alert(
        'Move instead of copy?',
        'After each file is safely in the backup folder, the original is DELETED from your gallery. Without "All files access" Android asks you to confirm each batch; in background it stays a copy until granted.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Enable move',
            style: 'destructive',
            onPress: () => updateConfig({ deleteAfterBackup: true }),
          },
        ],
      );
    } else {
      updateConfig({ deleteAfterBackup: false });
    }
  };

  const selectInterval = (minutes: number) => {
    updateConfig({ intervalMinutes: minutes });
    if (config?.autoBackup) {
      // re-register so the new cadence takes effect
      enableAutoBackup(minutes).catch(() => {});
    }
  };

  const selectedFolder = folders.find(f => f.id === config?.folderId);
  const isRunning = progress?.phase === 'scanning' || progress?.phase === 'copying';

  if (loading) {
    return (
      <View style={styles.container}>
        <Header onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.textDim} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Photo backup</Text>
            <Text style={styles.toggleHint}>
              Copy new photos and videos from your camera roll into a synced folder.
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={toggleEnabled}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>

        {enabled && config && (
          <>
            <Text style={styles.sectionLabel}>Destination folder</Text>
            <View style={styles.optionGroup}>
              {folders.map(f => {
                const active = config.folderId === f.id;
                return (
                  <Focusable
                    key={f.id}
                    style={[styles.optionRow, active && styles.optionRowActive]}
                    onPress={() =>
                      updateConfig({
                        folderId: f.id,
                        folderPath: f.path,
                        folderLabel: f.label || f.id,
                      })
                    }
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {f.label || f.id}
                    </Text>
                    {active && <Text style={styles.check}>✓</Text>}
                  </Focusable>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>Folder structure</Text>
            <View style={styles.optionGroup}>
              {STRUCTURES.map(s => {
                const active = config.structure === s.value;
                return (
                  <Focusable
                    key={s.value}
                    style={[styles.optionRow, active && styles.optionRowActive]}
                    onPress={() => updateConfig({ structure: s.value })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, active && styles.optionTextActive]}>
                        {s.label}
                      </Text>
                      <Text style={styles.optionExample}>{s.example}</Text>
                    </View>
                    {active && <Text style={styles.check}>✓</Text>}
                  </Focusable>
                );
              })}
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Keep original filename</Text>
                <Text style={styles.toggleHint}>
                  On = keep the file's own name (IMG_2020.HEIC). Off = rename to its
                  capture time (2024-08-11_143022.HEIC) to avoid name clashes.
                </Text>
              </View>
              <Switch
                value={config.keepOriginalName ?? true}
                onValueChange={v => updateConfig({ keepOriginalName: v })}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>

            <Text style={styles.sectionLabel}>Include</Text>
            <View style={styles.optionGroup}>
              {FILTERS.map(f => {
                const active = config.mediaFilter === f.value;
                return (
                  <Focusable
                    key={f.value}
                    style={[styles.optionRow, active && styles.optionRowActive]}
                    onPress={() => updateConfig({ mediaFilter: f.value })}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {f.label}
                    </Text>
                    {active && <Text style={styles.check}>✓</Text>}
                  </Focusable>
                );
              })}
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Move (delete original)</Text>
                <Text style={styles.toggleHint}>
                  Remove each photo/video from the gallery after it's copied to the
                  backup folder. Off = keep a copy in both places.
                </Text>
              </View>
              <Switch
                value={config.deleteAfterBackup ?? false}
                onValueChange={toggleMove}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Automatic backup</Text>
                <Text style={styles.toggleHint}>
                  Run periodically in the background. The system decides the exact
                  timing (≥15 min on Android; opportunistic on iOS).
                </Text>
              </View>
              <Switch
                value={config.autoBackup ?? false}
                onValueChange={toggleAutoBackup}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>

            {config.autoBackup && (
              <>
                <Text style={styles.sectionLabel}>Frequency</Text>
                <View style={styles.optionGroup}>
                  {INTERVALS.map(it => {
                    const active =
                      (config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) === it.value;
                    return (
                      <Focusable
                        key={it.value}
                        style={[styles.optionRow, active && styles.optionRowActive]}
                        onPress={() => selectInterval(it.value)}
                      >
                        <Text style={[styles.optionText, active && styles.optionTextActive]}>
                          {it.label}
                        </Text>
                        {active && <Text style={styles.check}>✓</Text>}
                      </Focusable>
                    );
                  })}
                </View>
              </>
            )}

            {progress && (
              <View style={styles.progressCard}>
                {progress.phase === 'scanning' && (
                  <View style={styles.progressRow}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.progressText}>Scanning camera roll...</Text>
                  </View>
                )}
                {progress.phase === 'copying' && (
                  <>
                    <View style={styles.progressRow}>
                      <ActivityIndicator size="small" color={colors.accent} />
                      <Text style={styles.progressText}>
                        Copying {progress.copied} of {progress.total}
                        {progress.skipped > 0 ? ` (${progress.skipped} skipped)` : ''}
                      </Text>
                    </View>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          { flex: progress.total > 0 ? progress.copied / progress.total : 0 },
                        ]}
                      />
                      <View style={{ flex: progress.total > 0 ? 1 - progress.copied / progress.total : 1 }} />
                    </View>
                  </>
                )}
                {progress.phase === 'done' && (
                  <>
                    <Text style={styles.progressDone}>
                      Done. {progress.copied} copied, {progress.skipped} skipped
                      {progress.deleted ? `, ${progress.deleted} moved` : ''}.
                    </Text>
                    {progress.lastSkipReason ? (
                      <Text style={styles.skipReason}>Last skip: {progress.lastSkipReason}</Text>
                    ) : null}
                  </>
                )}
                {progress.phase === 'error' && (
                  <Text style={styles.progressError}>{progress.errorMessage}</Text>
                )}
              </View>
            )}

            <View style={styles.actions}>
              {isRunning ? (
                <Focusable style={styles.actionBtn} onPress={cancelBackup}>
                  <Text style={styles.actionBtnText}>Cancel</Text>
                </Focusable>
              ) : (
                <Focusable style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={startBackup}>
                  <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>
                    Back up now
                  </Text>
                </Focusable>
              )}
            </View>

            {selectedFolder && (
              <Text style={styles.destHint}>
                Files will be copied to: {selectedFolder.path}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Focusable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Back</Text>
      </Focusable>
      <Text style={styles.title}>Photo backup</Text>
      <View style={{ width: 56 }} />
    </View>
  );
}

function defaultConfig(folders: FolderConfig[]): PhotoBackupConfig {
  const f = folders[0];
  return {
    enabled: false,
    folderId: f?.id ?? '',
    folderPath: f?.path ?? '',
    folderLabel: f?.label || f?.id || '',
    structure: 'byDate',
    mediaFilter: 'all',
    autoBackup: false,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    deleteAfterBackup: false,
    keepOriginalName: true,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  back: { color: colors.accent, fontSize: 15, minWidth: 56 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  body: { padding: 20, paddingBottom: 40 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  toggleLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  toggleHint: { color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 20,
  },
  optionGroup: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionRowActive: {},
  optionText: { color: colors.text, fontSize: 14, flex: 1 },
  optionTextActive: { fontWeight: '600' },
  optionExample: { color: colors.textDim, fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  check: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  progressCard: {
    marginTop: 20,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { color: colors.text, fontSize: 13, flex: 1 },
  progressBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: colors.accent, borderRadius: 3 },
  progressDone: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  skipReason: { color: colors.textDim, fontSize: 11, marginTop: 6, fontFamily: 'Menlo' },
  progressError: { color: colors.error, fontSize: 13 },
  actions: { marginTop: 20, flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  actionBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  actionBtnTextPrimary: { color: '#fff' },
  destHint: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: 'Menlo',
    marginTop: 16,
    lineHeight: 16,
  },
});
