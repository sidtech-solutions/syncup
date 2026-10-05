import React, { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Focusable } from '../components/Focusable';
import { useSyncthing, useSyncthingClient } from '../daemon/SyncthingContext';
import { useResource } from '../daemon/useResource';
import { useEventTrigger } from '../daemon/EventsContext';
import type {
  DeviceConfig,
  ConnectionInfo,
  PendingDeviceOffer,
} from '../api/types';
import { Card, ErrorBox, Pill, colors, formatBytes } from '../components/ui';
import { Fab } from '../components/Fab';
import { AddDeviceModal } from './AddDeviceModal';
import { ShowDeviceQRModal } from './ShowDeviceQRModal';
import { DeviceDetailModal } from './DeviceDetailModal';

interface DeviceView {
  config: DeviceConfig;
  conn: ConnectionInfo | undefined;
  isSelf: boolean;
}

interface DevicesPayload {
  devices: DeviceView[];
  offers: PendingDeviceOffer[];
}

export function DevicesScreen() {
  const { info, client } = useSyncthing();
  const [showAdd, setShowAdd] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [detailDevice, setDetailDevice] = useState<DeviceView | null>(null);

  const fetcher = useCallback(async (): Promise<DevicesPayload> => {
    if (!client) throw new Error('daemon not ready');
    const [devices, connections, offers] = await Promise.all([
      client.devices(),
      client.connections(),
      client.pendingDevices().catch(() => [] as PendingDeviceOffer[]),
    ]);
    return {
      devices: devices.map(d => ({
        config: d,
        conn: connections.connections[d.deviceID],
        isSelf: d.deviceID === info?.deviceId,
      })),
      offers,
    };
  }, [client, info?.deviceId]);

  const { data, error, refreshing, refresh, refetch } = useResource(
    fetcher,
    [client, info?.deviceId],
    { intervalMs: 30000, enabled: !!client },
  );

  useEventTrigger(
    [
      'ConfigSaved',
      'DeviceConnected',
      'DeviceDisconnected',
      'DeviceDiscovered',
      'DevicePaused',
      'DeviceResumed',
      'PendingDevicesChanged',
    ],
    refetch,
  );

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textDim} />}
      >
        {info && (
          <Focusable style={styles.qrButton} onPress={() => setShowQR(true)}>
            <Text style={styles.qrButtonIcon}>▦</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.qrButtonText}>Show this device's QR</Text>
              <Text style={styles.qrButtonHint}>Let a peer scan to pair</Text>
            </View>
            <Text style={styles.qrButtonArrow}>›</Text>
          </Focusable>
        )}

        {error && <ErrorBox message={error} />}

        {data && data.offers.length > 0 && (
          <View style={styles.pendingSection}>
            <Text style={styles.sectionLabel}>Pending offers</Text>
            {data.offers.map(offer => (
              <PendingDeviceCard key={offer.deviceId} offer={offer} onChanged={refetch} />
            ))}
          </View>
        )}

        {data?.devices.map(device => (
          <DeviceCard
            key={device.config.deviceID}
            device={device}
            onPress={() => setDetailDevice(device)}
          />
        ))}
      </ScrollView>

      <Fab onPress={() => setShowAdd(true)} coachId="devices.fab" />
      <AddDeviceModal visible={showAdd} onClose={() => setShowAdd(false)} onAdded={refetch} />
      <ShowDeviceQRModal
        visible={showQR}
        deviceId={info?.deviceId ?? ''}
        deviceName={info?.deviceId ? `${info.deviceId.slice(0, 7)}…` : undefined}
        onClose={() => setShowQR(false)}
      />
      <DeviceDetailModal
        visible={!!detailDevice}
        device={detailDevice?.config ?? null}
        connection={detailDevice?.conn}
        isSelf={detailDevice?.isSelf ?? false}
        onClose={() => setDetailDevice(null)}
        onChanged={refetch}
      />
    </View>
  );
}

function PendingDeviceCard({
  offer,
  onChanged,
}: {
  offer: PendingDeviceOffer;
  onChanged: () => void;
}) {
  const client = useSyncthingClient();
  const [busy, setBusy] = useState(false);
  const [autoAcceptFolders, setAutoAcceptFolders] = useState(Platform.OS !== 'android');

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const device: DeviceConfig = {
        deviceID: offer.deviceId,
        name: offer.name || offer.deviceId.slice(0, 7),
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
      onChanged();
    } catch (e) {
      Alert.alert('Could not accept', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ignore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await client.dismissPendingDevice(offer.deviceId);
      onChanged();
    } catch (e) {
      Alert.alert('Could not dismiss', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.offerCard}>
      <View style={styles.offerHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.offerName} numberOfLines={1}>
            {offer.name || '(unnamed)'}
          </Text>
          <Text style={styles.offerId} numberOfLines={1}>
            {offer.deviceId}
          </Text>
          {offer.address ? (
            <Text style={styles.offerMeta} numberOfLines={1}>
              from {offer.address}
            </Text>
          ) : null}
        </View>
        <Pill text="offered" tone="warning" />
      </View>
      <View style={styles.autoAcceptRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.autoAcceptLabel}>Auto-accept folders</Text>
          <Text style={styles.autoAcceptHint}>
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
      <View style={styles.offerActions}>
        <Focusable style={[styles.offerBtn, styles.ignoreBtn]} onPress={ignore} disabled={busy}>
          <Text style={styles.ignoreBtnText}>Ignore</Text>
        </Focusable>
        <Focusable style={[styles.offerBtn, styles.acceptBtn]} onPress={accept} disabled={busy}>
          <Text style={styles.acceptBtnText}>Accept</Text>
        </Focusable>
      </View>
    </View>
  );
}

function DeviceCard({ device, onPress }: { device: DeviceView; onPress: () => void }) {
  const { config, conn, isSelf } = device;
  const connected = conn?.connected ?? false;
  const pillTone: 'success' | 'default' | 'warning' = isSelf
    ? 'default'
    : connected
      ? 'success'
      : config.paused
        ? 'warning'
        : 'default';
  const pillText = isSelf
    ? 'this device'
    : config.paused
      ? 'paused'
      : connected
        ? 'connected'
        : 'disconnected';

  return (
    <Focusable onPress={onPress} activeOpacity={0.7}>
      <Card>
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={styles.name} numberOfLines={1}>
              {config.name || '(unnamed)'}
            </Text>
            <Text style={styles.idLine} numberOfLines={1}>
              {config.deviceID}
            </Text>
          </View>
          <Pill text={pillText} tone={pillTone} />
        </View>

        {connected && conn && (
          <View style={styles.statsRow}>
            <Stat label="In" value={formatBytes(conn.inBytesTotal)} />
            <Stat label="Out" value={formatBytes(conn.outBytesTotal)} />
            <Stat label="Type" value={conn.type || '?'} />
          </View>
        )}

        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {conn?.address ?? config.addresses[0] ?? 'dynamic'}
          </Text>
        </View>
      </Card>
    </Focusable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 100 },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 14,
  },
  qrButtonIcon: { color: colors.accent, fontSize: 22 },
  qrButtonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  qrButtonHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  qrButtonArrow: { color: colors.textDim, fontSize: 22 },
  pendingSection: { marginBottom: 12 },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  offerCard: {
    backgroundColor: '#2b1d00',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  offerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  offerName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  offerId: { color: colors.textDim, fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  offerMeta: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  autoAcceptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.warning,
  },
  autoAcceptLabel: { color: colors.text, fontSize: 13, fontWeight: '500' },
  autoAcceptHint: { color: colors.textDim, fontSize: 11, marginTop: 2, lineHeight: 14 },
  offerActions: { flexDirection: 'row', gap: 10 },
  offerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  ignoreBtn: { backgroundColor: 'transparent', borderColor: colors.border },
  ignoreBtnText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  acceptBtn: { backgroundColor: colors.accent, borderColor: colors.accent },
  acceptBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headerMain: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  idLine: { color: colors.textDim, fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  statLabel: {
    color: colors.textDim,
    fontSize: 10,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { color: colors.textDim, fontSize: 11, fontFamily: 'Menlo' },
  metaDot: { color: colors.textDim, fontSize: 11 },
  metaHint: { color: colors.textDim, fontSize: 11, fontStyle: 'italic' },
});
