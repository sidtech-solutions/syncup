import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { Focusable } from '../components/Focusable';
import { FormModal } from '../components/FormModal';
import { colors } from '../components/ui';
import { useSyncthing, useSyncthingClient } from '../daemon/SyncthingContext';
import type { DeviceConfig, FolderConfig, PendingFolderOffer } from '../api/types';
import { isAbortError } from '../api/syncthing';
import GoBridge from '../GoServerBridgeJSI';
import { FolderPicker } from './FolderPicker';
import { AndroidLocalBrowser } from './AndroidLocalBrowser';
import { FolderTypePicker } from '../components/FolderTypePicker';
import { FolderLocationPicker, type LocationKind } from '../components/FolderLocationPicker';
import {
  filesystemTypeForExternal,
  pickExternalFolderWithICloudWarning,
} from '../fs/externalFolder';
import {
  applyPresetToFolder,
  presetDefaults,
  type FolderPreset,
} from '../utils/folderPresets';
import { markAsVault } from '../utils/vaultRegistry';

interface Props {
  visible: boolean;
  offer: PendingFolderOffer | null;
  onClose: () => void;
  onAccepted: () => void;
}

export function AcceptFolderModal({ visible, offer, onClose, onAccepted }: Props) {
  const { info } = useSyncthing();
  const client = useSyncthingClient();

  const [path, setPath] = useState('');
  const [isExternal, setIsExternal] = useState(false);
  const [externalDisplayName, setExternalDisplayName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localBrowserOpen, setLocalBrowserOpen] = useState(false);
  // When MANAGE_EXTERNAL_STORAGE is granted the primary picker is the
  // full-screen native browser (POSIX); SAF stays as the alternate route for
  // cloud / SD-card. Mirrors AddFolderModal so accepting a shared folder has
  // the same location choices as adding one.
  const [hasAllFilesAccess, setHasAllFilesAccess] = useState(() => {
    if (Platform.OS !== 'android') return true;
    try {
      return GoBridge.hasAllFilesAccess();
    } catch {
      return false;
    }
  });
  const [allDevices, setAllDevices] = useState<DeviceConfig[]>([]);
  const [extraPeers, setExtraPeers] = useState<Set<string>>(new Set());
  const [folderType, setFolderType] = useState<FolderConfig['type']>('sendreceive');
  const [preset, setPreset] = useState<FolderPreset>('generic');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPath('');
    setIsExternal(false);
    setExternalDisplayName('');
    setLocalBrowserOpen(false);
    setExtraPeers(new Set());
    // encrypted slot from the peer => receiveencrypted, else two-way
    setFolderType(offer?.receiveEncrypted ? 'receiveencrypted' : 'sendreceive');
    setPreset('generic');
    setError(null);
    setSubmitting(false);
    client.devices().then(setAllDevices).catch(e => setError(String(e)));
  }, [visible, offer, client]);

  // Re-check All Files Access on foreground — the user grants it in system
  // settings and returns via app resume.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const refresh = () => {
      try {
        setHasAllFilesAccess(GoBridge.hasAllFilesAccess());
      } catch {
        // leave previous value
      }
    };
    if (visible) refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [visible]);

  const pickerRoot = info?.foldersRoot ?? '';

  const pickExternal = () => {
    try {
      pickExternalFolderWithICloudWarning(folder => {
        if (!folder) return;
        setPath(folder.path);
        setIsExternal(true);
        setExternalDisplayName(folder.displayName || 'Device folder');
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Device card: full-screen native browser on Android (All Files Access is
  // already confirmed by the card), document picker on iOS.
  const pickDevice = () => {
    if (Platform.OS === 'android') {
      setLocalBrowserOpen(true);
      return;
    }
    pickExternal();
  };

  const onLocalBrowserPick = (chosen: string) => {
    setLocalBrowserOpen(false);
    setPath(chosen);
    setIsExternal(true);
    const name = chosen.split('/').filter(Boolean).pop() || 'Device folder';
    setExternalDisplayName(name);
  };

  const requestAllFilesAccess = () => {
    try {
      GoBridge.requestAllFilesAccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const displayPath = useMemo(() => {
    if (!path) return '';
    if (isExternal) return externalDisplayName || 'Device folder';
    if (pickerRoot && path.startsWith(pickerRoot)) {
      const rel = path.slice(pickerRoot.length) || '/';
      return `folders${rel}`;
    }
    return path;
  }, [path, pickerRoot, isExternal, externalDisplayName]);

  // Which destination card is currently active (drives the unified picker UI).
  const locationKind: LocationKind | null = !path
    ? null
    : !isExternal
      ? 'app'
      : path.startsWith('content://')
        ? 'saf'
        : 'device';

  const otherPeers = useMemo(
    () =>
      allDevices.filter(
        d => d.deviceID !== info?.deviceId && d.deviceID !== offer?.deviceId,
      ),
    [allDevices, info?.deviceId, offer?.deviceId],
  );

  const togglePeer = (deviceId: string) => {
    setExtraPeers(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const cancel = () => {
    onClose();
  };

  const submit = async () => {
    if (!offer || !info || !path) return;
    setSubmitting(true);
    setError(null);
    try {
      const devices = [
        { deviceID: info.deviceId, introducedBy: '', encryptionPassword: '' },
        { deviceID: offer.deviceId, introducedBy: '', encryptionPassword: '' },
        ...Array.from(extraPeers).map(d => ({
          deviceID: d,
          introducedBy: '',
          encryptionPassword: '',
        })),
      ];
      const fsType = isExternal ? filesystemTypeForExternal(path) : 'basic';
      const usesSaf = fsType === 'saf';
      const baseFolder: FolderConfig = {
        id: offer.folderId,
        label: offer.label || offer.folderId,
        filesystemType: fsType,
        path,
        type: folderType,
        devices,
        rescanIntervalS: usesSaf ? 60 : 3600,
        fsWatcherEnabled: !usesSaf,
        fsWatcherDelayS: 10,
        ignorePerms: true,
        ignoreDelete: false,
        autoNormalize: true,
        paused: false,
        markerName: '.stfolder',
        order: 'random',
        minDiskFree: { value: 1, unit: '%' },
        syncOwnership: false,
        sendOwnership: false,
        syncXattrs: false,
        sendXattrs: false,
        versioning: {
          type: '',
          params: {},
          cleanupIntervalS: 3600,
          fsPath: '',
          fsType: 'basic',
        },
      };
      const folder = applyPresetToFolder(baseFolder, preset, { isSaf: usesSaf });
      try {
        await client.putFolder(folder);
      } catch (e) {
        // See AddFolderModal: client may abort before the syncthing-side
        // synchronous startup finishes for a very large folder. Poll to
        // verify before declaring failure.
        if (!isAbortError(e)) throw e;
        const created = await client.waitForFolder(folder.id, { deadlineMs: 60_000 });
        if (!created) {
          throw new Error('Accepting the folder timed out. Please try again.');
        }
      }
      const presetIgnores = presetDefaults(preset).ignoreLines;
      if (presetIgnores.length > 0) {
        try {
          await client.setIgnores(folder.id, presetIgnores);
        } catch {
          // best-effort
        }
      }
      if (preset === 'obsidian') {
        markAsVault(folder.id).catch(() => {});
      }
      onAccepted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!offer) return null;

  return (
    <>
      <FormModal
        visible={visible && !pickerOpen && !localBrowserOpen}
        title="Accept folder"
        onCancel={cancel}
        onSubmit={submit}
        submitLabel="Accept"
        submitting={submitting}
        submitDisabled={!path}
      >
        <View style={styles.summary}>
          <SummaryRow label="Label" value={offer.label || '(unnamed)'} />
          <SummaryRow label="ID" value={offer.folderId} mono />
          <SummaryRow label="From" value={shortDeviceId(offer.deviceId)} mono />
        </View>

        <Text style={styles.sectionLabel}>Where to store it</Text>
        <FolderLocationPicker
          selected={locationKind}
          chosenLabel={displayPath}
          hasAllFilesAccess={hasAllFilesAccess}
          appDisabled={!pickerRoot}
          onPickApp={() => setPickerOpen(true)}
          onPickDevice={pickDevice}
          onPickSaf={pickExternal}
          onRequestAllFilesAccess={requestAllFilesAccess}
        />

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Folder kind</Text>
        <View style={styles.presetRow}>
          <PresetChip
            label="Generic"
            hint="Default settings"
            active={preset === 'generic'}
            onPress={() => setPreset('generic')}
          />
          <PresetChip
            label="Obsidian vault"
            hint="Watcher on, vault ignores"
            active={preset === 'obsidian'}
            onPress={() => setPreset('obsidian')}
          />
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Folder type</Text>
        <FolderTypePicker value={folderType} onChange={setFolderType} />

        {otherPeers.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Also share with</Text>
            {otherPeers.map(d => {
              const on = extraPeers.has(d.deviceID);
              return (
                <Focusable
                  key={d.deviceID}
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
              );
            })}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </FormModal>

      <FolderPicker
        visible={pickerOpen}
        rootPath={pickerRoot}
        initialPath={path || pickerRoot}
        onCancel={() => setPickerOpen(false)}
        onPick={chosen => {
          setPath(chosen);
          setPickerOpen(false);
        }}
      />

      {Platform.OS === 'android' && (
        <AndroidLocalBrowser
          visible={localBrowserOpen}
          onCancel={() => setLocalBrowserOpen(false)}
          onPick={onLocalBrowserPick}
        />
      )}
    </>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function shortDeviceId(id: string): string {
  return id.split('-').slice(0, 2).join('-') + '…';
}

function PresetChip({
  label,
  hint,
  active,
  onPress,
}: {
  label: string;
  hint: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Focusable
      style={[styles.presetChip, active && styles.presetChipOn]}
      onPress={onPress}
    >
      <Text style={[styles.presetChipLabel, active && styles.presetChipLabelOn]}>
        {label}
      </Text>
      <Text style={styles.presetChipHint}>{hint}</Text>
    </Focusable>
  );
}

const styles = StyleSheet.create({
  summary: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryLabel: { color: colors.textDim, fontSize: 12 },
  summaryValue: { color: colors.text, fontSize: 13, flex: 1, textAlign: 'right' },
  mono: { fontFamily: 'Menlo' },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
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
  error: { color: colors.error, fontSize: 13, marginTop: 12 },
  presetRow: { flexDirection: 'row', gap: 10 },
  presetChip: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  presetChipOn: { borderColor: colors.accent },
  presetChipLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  presetChipLabelOn: { color: colors.accent },
  presetChipHint: { color: colors.textDim, fontSize: 11, marginTop: 4 },
});
