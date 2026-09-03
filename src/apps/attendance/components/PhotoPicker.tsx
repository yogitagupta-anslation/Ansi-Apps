/**
 * PhotoPicker.tsx
 * -----------------------------------------------------------------------------
 * Profile-photo selection: the action sheet (Take photo / Choose from gallery /
 * Remove) and the picker plumbing behind it.
 *
 * STORAGE STRATEGY — data URIs, deliberately.
 * -------------------------------------------
 * The picker hands back a file in the app's cache directory, and Android is
 * free to clear that cache whenever it likes — persisting the URI alone means
 * photos that quietly vanish. Copying the file elsewhere would need a
 * filesystem dependency. Instead the image is requested downscaled (512px,
 * ~70% quality ≈ 30–60 KB) and stored as a base64 data URI inside the same
 * local storage as everything else. It survives restarts because it IS the
 * data, not a pointer to it, and it never leaves the device.
 *
 * No CAMERA permission is declared in the manifest, so launchCamera delegates
 * to the system camera app via intent — no runtime permission dialog needed.
 * On Android 13+ the gallery path uses the system photo picker, which is also
 * permissionless.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  launchCamera,
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import { log } from '../utils/logger';
import { useTheme } from '../theme/ThemeContext';
import { Icon, type IconName } from './Icon';
import { Txt } from './ui';

/** Common options: downscaled and base64-encoded for durable local storage. */
const PICK_OPTIONS = {
  mediaType: 'photo' as const,
  includeBase64: true,
  maxWidth: 512,
  maxHeight: 512,
  quality: 0.7 as const,
  selectionLimit: 1,
};

function toDataUri(response: ImagePickerResponse): string | null {
  if (response.didCancel) {
    return null;
  }
  if (response.errorCode) {
    log.warn('BLE', 'Photo picker error: ' + (response.errorMessage ?? response.errorCode));
    return null;
  }
  const asset = response.assets?.[0];
  if (!asset?.base64) {
    return null;
  }
  return 'data:' + (asset.type ?? 'image/jpeg') + ';base64,' + asset.base64;
}

/**
 * The action sheet. `hasPhoto` decides whether Remove is offered; `onPicked`
 * receives the new data URI, or null when the user chose Remove.
 */
export function PhotoActionSheet({
  visible,
  hasPhoto,
  onClose,
  onPicked,
}: {
  visible: boolean;
  hasPhoto: boolean;
  onClose: () => void;
  onPicked: (dataUri: string | null) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const pick = useCallback(
    async (source: 'camera' | 'gallery') => {
      setBusy(true);
      try {
        const response =
          source === 'camera'
            ? await launchCamera(PICK_OPTIONS)
            : await launchImageLibrary(PICK_OPTIONS);
        const uri = toDataUri(response);
        if (uri) {
          onPicked(uri);
          onClose();
        } else if (!response.didCancel) {
          // A real failure (not a user cancel) still closes cleanly; the
          // caller's photo stays untouched.
          onClose();
        }
      } finally {
        setBusy(false);
      }
    },
    [onPicked, onClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable
        style={[styles.scrim, { backgroundColor: t.colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingBottom: insets.bottom + t.spacing.lg,
            paddingHorizontal: t.spacing.xl,
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: t.colors.borderStrong }]} />
        <Txt variant="title" style={{ marginBottom: t.spacing.md }}>
          Profile photo
        </Txt>

        <SheetOption
          icon="camera"
          label="Take photo"
          disabled={busy}
          onPress={() => void pick('camera')}
        />
        <SheetOption
          icon="images"
          label="Choose from gallery"
          disabled={busy}
          onPress={() => void pick('gallery')}
        />
        {hasPhoto ? (
          <SheetOption
            icon="trash-2"
            label="Remove photo"
            destructive
            disabled={busy}
            onPress={() => {
              onPicked(null);
              onClose();
            }}
          />
        ) : null}
        <SheetOption icon="x" label="Cancel" disabled={busy} onPress={onClose} />
      </View>
    </Modal>
  );
}

function SheetOption({
  icon,
  label,
  onPress,
  destructive = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const color = destructive ? t.colors.error : t.colors.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: pressed ? t.colors.surfaceRaised : 'transparent',
          borderRadius: t.radius.md,
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      <Icon name={icon} size={20} color={destructive ? t.colors.error : t.colors.textSecondary} />
      <Txt variant="body" color={color} style={{ marginLeft: t.spacing.md }}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { paddingTop: 8 },
  grabber: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 38 },
  option: { alignItems: 'center', flexDirection: 'row', minHeight: 54, paddingHorizontal: 10 },
});
