import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Focusable } from '../components/Focusable';
import { FormModal } from '../components/FormModal';
import { Field } from '../components/Field';
import { colors } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSyncthingClient } from '../daemon/SyncthingContext';
import type { DeviceConfig } from '../api/types';
import { ScanDeviceQRModal } from './ScanDeviceQRModal';

// 8 groups of 7 alnum, hyphen-separated. REST accepts with or without dashes.
const DEVICE_ID_RE = /^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/i;

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
  /** Pre-fill the device-ID field, e.g. when called from a QR scan flow. */
  initialDeviceId?: string;
}

interface NearbyDevice {
  deviceId: string;
  addresses: string[];
}

export function AddDeviceModal({ visible, onClose, onAdded, initialDeviceId }: Props) {
  const client = useSyncthingClient();
  const [deviceId, setDeviceId] = useState(initialDeviceId ?? '');
  const [name, setName] = useState('');

  useEffect(() => {
    // accept fresh pre-fills when reopened (e.g. successive QR scans)
    if (visible && initialDeviceId) setDeviceId(initialDeviceId);
  }, [visible, initialDeviceId]);
  const [autoAcceptFolders, setAutoAcceptFolders] = useState(Platform.OS !== 'android');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [nearby, setNearby] = useState<NearbyDevice[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [pairedIds, setPairedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible || scannerOpen) return;
    let cancelled = false;
    setNearbyLoading(true);
    Promise.all([
      client.systemDiscovery().catch(() => ({} as Record<string, { addresses: string[] }>)),
      client.devices().catch(() => []),
    ]).then(([disco, devices]) => {
      if (cancelled) return;
      const paired = new Set(devices.map(d => d.deviceID));
      setPairedIds(paired);
      const found: NearbyDevice[] = Object.entries(disco)
        .filter(([id]) => !paired.has(id))
        .map(([id, entry]) => ({ deviceId: id, addresses: entry.addresses }));
      setNearby(found);
      setNearbyLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, scannerOpen, client]);

  const cleanedId = deviceId.trim().toUpperCase().replace(/\s+/g, '');
  const idValid = DEVICE_ID_RE.test(cleanedId);

  const reset = () => {
    setDeviceId('');
    setName('');
    setAutoAcceptFolders(Platform.OS !== 'android');
    setError(null);
    setSubmitting(false);
  };

  const cancel = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!idValid) {
      setError('Device ID should look like XXXXXXX-XXXXXXX-... (8 groups of 7)');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const device: DeviceConfig = {
        deviceID: cleanedId,
        name: name.trim() || cleanedId.slice(0, 7),
        addresses: ['dynamic'],
        compression: 'metadata',
        certName: '',
        introducer: false,
        paused: false,
        allowedNetworks: [],
        autoAcceptFolders,
        maxSendKbps: 0,
        maxRecvKbps: 0,
      };
      await client.putDevice(device);
      reset();
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <FormModal
        visible={visible && !scannerOpen}
        title="Add device"
        onCancel={cancel}
        onSubmit={submit}
        submitLabel="Add"
        submitting={submitting}
        submitDisabled={!idValid}
      >
      <Focusable style={styles.scanBtn} onPress={() => setScannerOpen(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="camera" size={18} color="#fff" />
          <Text style={styles.scanBtnText}>Scan QR code</Text>
        </View>
      </Focusable>

      {nearbyLoading ? (
        <View style={styles.nearbyLoading}>
          <ActivityIndicator size="small" color={colors.textDim} />
          <Text style={styles.nearbyLoadingText}>Looking for nearby devices...</Text>
        </View>
      ) : nearby.length > 0 ? (
        <View style={styles.nearbySection}>
          <Text style={styles.nearbySectionTitle}>Nearby devices</Text>
          {nearby.map(d => (
            <Focusable
              key={d.deviceId}
              style={styles.nearbyRow}
              onPress={() => setDeviceId(d.deviceId)}
            >
              <View style={styles.nearbyInfo}>
                <Text style={styles.nearbyId} numberOfLines={1}>
                  {d.deviceId.slice(0, 7)}...{d.deviceId.slice(-7)}
                </Text>
                <Text style={styles.nearbyAddr} numberOfLines={1}>
                  {d.addresses[0]?.replace('tcp://', '') ?? 'no address'}
                </Text>
              </View>
              <Text style={styles.nearbyUse}>Use</Text>
            </Focusable>
          ))}
        </View>
      ) : null}

      <Text style={styles.orDivider}>or paste the ID</Text>

      <Field
        label="Device ID"
        placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX"
        value={deviceId}
        onChangeText={setDeviceId}
        hint="Paste the ID shown by the peer device"
        error={deviceId && !idValid ? 'Invalid format' : undefined}
        multiline
      />
      <Field
        label="Name"
        placeholder="my laptop"
        value={name}
        onChangeText={setName}
        hint="Optional - defaults to the first 7 chars of the ID"
      />
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.switchLabel}>Auto-accept folders</Text>
          <Text style={styles.switchHint}>
            {Platform.OS === 'android'
              ? 'Skip the per-folder prompt. Folders land in app storage (Android/data), which other apps cannot open.'
              : 'Skip the per-folder accept prompt for offers from this peer.'}
          </Text>
        </View>
        <Switch
          value={autoAcceptFolders}
          onValueChange={setAutoAcceptFolders}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      </FormModal>

      <ScanDeviceQRModal
        visible={scannerOpen}
        onCancel={() => setScannerOpen(false)}
        onScanned={scanned => {
          setDeviceId(scanned);
          setScannerOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.error, fontSize: 13, marginTop: 4 },
  scanBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  scanBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  orDivider: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 14,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nearbyLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 8,
  },
  nearbyLoadingText: { color: colors.textDim, fontSize: 12 },
  nearbySection: {
    marginBottom: 8,
  },
  nearbySectionTitle: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 6,
    gap: 12,
  },
  nearbyInfo: { flex: 1, minWidth: 0 },
  nearbyId: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Menlo',
  },
  nearbyAddr: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  nearbyUse: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  switchLabel: { color: colors.text, fontSize: 14, fontWeight: '500' },
  switchHint: { color: colors.textDim, fontSize: 11, marginTop: 2, lineHeight: 14 },
});
