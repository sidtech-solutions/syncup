import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { Focusable } from '../components/Focusable';
import { FlashList } from '@shopify/flash-list';
import GoBridge from '../GoServerBridgeJSI';
import type { SystemLogMessage } from '../api/types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../components/ui';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { parseLogFileResult, parseSystemLog } from '../utils/daemonLog';
import { formatLogHeader, logFileName } from '../utils/logExport';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const REFRESH_MS = 2000;
const MAX_RETAINED = 2000;
const INITIAL_TAIL = 500;
const LOG_BODY_TMP = 'syncup-logbody.tmp';

// inverted FlashList. FlatList was janky on Android at a few hundred rows.
export function LogsModal({ visible, onClose }: Props) {
  const keyboardHeight = useKeyboardHeight();
  const { height: winHeight } = useWindowDimensions();
  const sheetHeight = Math.max(320, (winHeight - keyboardHeight) * 0.92);

  // newest-first; `inverted` flips to chronological in the visual list
  const [messages, setMessages] = useState<SystemLogMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [exporting, setExporting] = useState(false);

  const lastSeenRef = useRef<string>('');

  const fetchLogs = useCallback(() => {
    try {
      const since = lastSeenRef.current;
      const fresh = parseSystemLog(
        GoBridge.getSystemLog(since, since ? 0 : INITIAL_TAIL),
      );
      setError(null);
      if (fresh.length === 0) return;
      lastSeenRef.current = fresh[fresh.length - 1].when;
      setMessages(prev => {
        const reversed = [...fresh].reverse();
        const next = [...reversed, ...prev];
        if (next.length > MAX_RETAINED) next.length = MAX_RETAINED;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setMessages([]);
      setError(null);
      lastSeenRef.current = '';
      setPaused(false);
      return;
    }
    fetchLogs();
  }, [visible, fetchLogs]);

  useEffect(() => {
    if (!visible || paused) return;
    const id = setInterval(fetchLogs, REFRESH_MS);
    return () => clearInterval(id);
  }, [visible, paused, fetchLogs]);

  const clear = () => {
    setMessages([]);
    lastSeenRef.current = '';
    if (!paused) {
      // reseed so the view doesn't sit empty after a clear
      fetchLogs();
    }
  };

  const exportLog = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    const dir = FileSystem.cacheDirectory;
    const bodyUri = `${dir}${LOG_BODY_TMP}`;
    try {
      if (!dir) throw new Error('No cache directory available');
      await deleteStaleExports();
      const file = parseLogFileResult(GoBridge.writeSystemLog(stripScheme(bodyUri)));
      if (file.bytes === 0) {
        Alert.alert('Nothing to export', 'The daemon log is empty.');
        return;
      }

      const exportedAt = new Date().toISOString();
      const uri = `${dir}${logFileName(exportedAt)}`;
      await FileSystem.writeAsStringAsync(
        uri,
        formatLogHeader({
          exportedAt,
          platform: `${Platform.OS} ${String(Platform.Version)}`,
          syncthingVersion: file.version,
          build: `${file.os}/${file.arch}`,
          deviceId: file.deviceId,
          uptimeSec: file.uptimeSec,
          goroutines: file.goroutines,
          logBytes: file.bytes,
        }),
      );
      await ReactNativeBlobUtil.fs.appendFile(
        stripScheme(uri),
        stripScheme(bodyUri),
        'uri',
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/plain',
          UTI: 'public.plain-text',
          dialogTitle: 'Share daemon log',
        });
      } else {
        await Share.share({
          url: uri,
          message: Platform.OS === 'android' ? uri : undefined,
        });
      }
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      await FileSystem.deleteAsync(bodyUri, { idempotent: true }).catch(() => {});
      setExporting(false);
    }
  }, [exporting]);

  const renderItem = useCallback(
    ({ item }: { item: SystemLogMessage }) => (
      <View style={styles.logLine}>
        <Text style={styles.logTime}>{formatTime(item.when)}</Text>
        <Text style={styles.logMessage} selectable>
          {item.message}
        </Text>
      </View>
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: SystemLogMessage, index: number) => `${item.when}-${index}`,
    [],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={[styles.backdrop, { paddingBottom: keyboardHeight }]} edges={['top', 'bottom']}>
        {/* sibling, not ancestor, or FlashList's scroll gesture fights the Pressable */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { height: sheetHeight }]}>
          <View style={styles.header}>
            <Focusable onPress={onClose} hitSlop={8}>
              <Text style={styles.cancel}>Close</Text>
            </Focusable>
            <Text style={styles.title} numberOfLines={1}>
              Daemon log
            </Text>
            <View style={styles.headerActions}>
              <Focusable
                onPress={exportLog}
                hitSlop={8}
                style={styles.headerBtn}
                disabled={exporting}
                accessibilityLabel="Export log file"
              >
                <Text style={[styles.headerBtnText, exporting && styles.headerBtnDisabled]}>
                  {exporting ? 'Exporting…' : 'Export'}
                </Text>
              </Focusable>
              <Focusable
                onPress={() => setPaused(p => !p)}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <Text style={styles.headerBtnText}>{paused ? 'Resume' : 'Pause'}</Text>
              </Focusable>
              <Focusable onPress={clear} hitSlop={8} style={styles.headerBtn}>
                <Text style={styles.headerBtnText}>Clear</Text>
              </Focusable>
            </View>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {messages.length === 0 ? (
            <View style={styles.loading}>
              <Text style={styles.empty}>No log messages yet.</Text>
            </View>
          ) : (
            <View style={styles.logScroll}>
              <FlashList
                contentContainerStyle={styles.logContent}
                data={messages}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                inverted
              />
            </View>
          )}

          <Text style={styles.footer}>
            {messages.length} lines · refresh {paused ? 'paused' : `${REFRESH_MS / 1000}s`}
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

async function deleteStaleExports() {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  try {
    const entries = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      entries
        .filter(name => name.startsWith('syncup-log-') && name.endsWith('.txt'))
        .map(name => FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true })),
    );
  } catch {
    // a cache we can't tidy is not a reason to fail the export
  }
}

function formatTime(when: string): string {
  // HH:MM:SS only. date is noise in a tail view
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return when.slice(11, 19);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
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
  headerActions: { flexDirection: 'row', gap: 10 },
  headerBtn: { paddingHorizontal: 2 },
  headerBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  headerBtnDisabled: { color: colors.textDim },
  error: {
    color: colors.error,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textDim, fontSize: 13 },
  logScroll: { flex: 1 },
  logContent: { paddingHorizontal: 12, paddingVertical: 10 },
  logLine: {
    flexDirection: 'row',
    paddingVertical: 2,
    gap: 8,
  },
  logTime: {
    color: colors.textDim,
    fontFamily: 'Menlo',
    fontSize: 11,
    minWidth: 64,
  },
  logMessage: {
    color: colors.text,
    fontFamily: 'Menlo',
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
  footer: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
