import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Focusable } from './Focusable';
import { colors } from './ui';

// The three storage destinations a folder can live in. Unified so the picker
// looks the same in Add-folder and Accept-folder flows:
//   app    — inside the app sandbox (foldersRoot), no permissions, Files-app visible
//   device — a real path like DCIM/Downloads (Android: All Files Access; iOS: Files)
//   saf    — a content:// tree (Android only): cloud providers, SD card
export type LocationKind = 'app' | 'device' | 'saf';

interface Props {
  /** Which destination currently holds the chosen path, or null when none. */
  selected: LocationKind | null;
  /** Human-readable path/name shown on the selected card. */
  chosenLabel: string;
  /** Android: whether MANAGE_EXTERNAL_STORAGE is granted (gates device browsing). */
  hasAllFilesAccess: boolean;
  /** App-storage card stays disabled until the daemon reports a folders root. */
  appDisabled?: boolean;
  onPickApp: () => void;
  onPickDevice: () => void;
  onPickSaf: () => void;
  onRequestAllFilesAccess: () => void;
}

export function FolderLocationPicker({
  selected,
  chosenLabel,
  hasAllFilesAccess,
  appDisabled,
  onPickApp,
  onPickDevice,
  onPickSaf,
  onRequestAllFilesAccess,
}: Props) {
  const isAndroid = Platform.OS === 'android';
  // On Android the device browser needs All Files Access; without it the card
  // becomes a "grant" prompt instead of opening the (empty) browser.
  const deviceLocked = isAndroid && !hasAllFilesAccess;

  return (
    <View style={styles.container}>
      <Card
        on={selected === 'app'}
        disabled={appDisabled}
        title="App storage"
        hint="Inside the app sandbox · visible in the Files app"
        chosen={selected === 'app' ? chosenLabel : undefined}
        onPress={onPickApp}
      />

      <Card
        on={selected === 'device'}
        title={isAndroid ? 'Folder on this device' : 'Pick a folder'}
        hint={
          isAndroid
            ? deviceLocked
              ? 'DCIM, Downloads, Pictures… — needs All Files Access'
              : 'DCIM, Downloads, Pictures…'
            : 'Any folder, via the Files app'
        }
        chosen={selected === 'device' ? chosenLabel : undefined}
        actionLabel={deviceLocked ? 'Grant access' : undefined}
        showChevron={!deviceLocked}
        onPress={deviceLocked ? onRequestAllFilesAccess : onPickDevice}
      />

      {isAndroid && (
        <Card
          on={selected === 'saf'}
          title="Cloud or SD-card (SAF)"
          hint="Google Drive, SD card, other providers"
          chosen={selected === 'saf' ? chosenLabel : undefined}
          showChevron
          onPress={onPickSaf}
        />
      )}
    </View>
  );
}

interface CardProps {
  on: boolean;
  title: string;
  hint: string;
  chosen?: string;
  disabled?: boolean;
  showChevron?: boolean;
  actionLabel?: string;
  onPress: () => void;
}

function Card({ on, title, hint, chosen, disabled, showChevron, actionLabel, onPress }: CardProps) {
  return (
    <Focusable
      style={[styles.row, on && styles.rowOn, disabled && styles.rowDisabled]}
      onPress={() => !disabled && onPress()}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={[styles.radio, on && styles.radioOn]}>
        {on && <View style={styles.radioInner} />}
      </View>
      <View style={styles.text}>
        <Text style={[styles.label, on && styles.labelOn]}>{title}</Text>
        {chosen ? (
          <Text style={styles.chosen} numberOfLines={2}>
            {chosen}
          </Text>
        ) : (
          <Text style={styles.hint}>{hint}</Text>
        )}
      </View>
      {actionLabel ? (
        <Text style={styles.action}>{actionLabel}</Text>
      ) : showChevron ? (
        <Text style={styles.chevron}>›</Text>
      ) : null}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 12,
  },
  rowOn: { borderColor: colors.accent },
  rowDisabled: { opacity: 0.45 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: { borderColor: colors.accent },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  text: { flex: 1 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  labelOn: { color: colors.accent },
  hint: { color: colors.textDim, fontSize: 11, lineHeight: 15, marginTop: 2 },
  chosen: { color: colors.text, fontSize: 12, lineHeight: 16, marginTop: 2 },
  chevron: { color: colors.textDim, fontSize: 22, marginTop: -2 },
  action: { color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 2 },
});
