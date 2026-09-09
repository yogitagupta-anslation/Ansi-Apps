/**
 * EditProfileScreen.tsx
 * -----------------------------------------------------------------------------
 * The employee's own profile on their own device.
 *
 * Only `employeeId` ever reaches the radio. Name, department, phone and email
 * are local display metadata — they are stored on this device and are never
 * placed in an advertisement, which is both a payload-size fact (31 bytes) and
 * a privacy one.
 *
 * Editing the employee ID while broadcasting is blocked rather than silently
 * applied: the id in the air is captured at start time, so changing it here
 * mid-broadcast would leave the UI disagreeing with the radio.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { PhotoActionSheet } from '../components/PhotoPicker';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Banner, Button, Card, Screen, Txt } from '../components/ui';
import { EMPLOYEE_ID_PATTERN } from '../constants/appConfig';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function EditProfileScreen() {
  const t = useTheme();
  const store = useAppStore();
  const navigation = useNavigation<{ goBack: () => void }>();
  const s = store.settings;

  const onAir = store.advertiser.state === 'ACTIVE';

  const [name, setName] = useState(s.employeeName);
  const [id, setId] = useState(s.employeeId);
  const [department, setDepartment] = useState(s.employeeDepartment);
  const [phone, setPhone] = useState(s.employeePhone);
  const [email, setEmail] = useState(s.employeeEmail);
  const [photo, setPhoto] = useState(s.employeePhoto);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync if the stored settings change underneath us (e.g. after a reset).
  useEffect(() => {
    setName(s.employeeName);
    setId(s.employeeId);
    setDepartment(s.employeeDepartment);
    setPhone(s.employeePhone);
    setEmail(s.employeeEmail);
    setPhoto(s.employeePhoto);
  }, [s.employeeName, s.employeeId, s.employeeDepartment, s.employeePhone, s.employeeEmail, s.employeePhoto]);

  const idChanged = id.trim() !== s.employeeId;

  const dirty =
    name !== s.employeeName ||
    idChanged ||
    department !== s.employeeDepartment ||
    phone !== s.employeePhone ||
    email !== s.employeeEmail ||
    photo !== s.employeePhoto;

  const handleSave = useCallback(async () => {
    setError(null);
    setSaved(false);

    const trimmedId = id.trim();
    if (trimmedId.length === 0) {
      setError('Employee ID is required — it is the only thing the office system can recognise you by.');
      return;
    }
    if (!EMPLOYEE_ID_PATTERN.test(trimmedId)) {
      setError('Employee ID can only contain letters, numbers, hyphens and underscores.');
      return;
    }
    if (idChanged && onAir) {
      setError('Turn off attendance before changing your Employee ID. The ID currently on air was set when broadcasting started.');
      return;
    }

    await store.updateSettings({
      employeeName: name.trim(),
      employeeId: trimmedId,
      employeeDepartment: department.trim(),
      employeePhone: phone.trim(),
      employeeEmail: email.trim(),
      employeePhoto: photo,
    });
    setSaved(true);
  }, [id, idChanged, onAir, name, department, phone, email, photo, store]);

  return (
    <Screen>
      <PageHeader title="Edit profile" subtitle="Stored on this device only" onBack={() => navigation.goBack()} />

      {/* ------------------------------------------------------- identity -- */}
      <Card>
        <View style={styles.hero}>
          <Pressable
            onPress={() => setPhotoSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Change profile photo' : 'Add profile photo'}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <EmployeeAvatar
              name={name || '?'}
              employeeId={id || 'unset'}
              size={92}
              photo={photo || undefined}
              badge={onAir ? t.colors.success : undefined}
            />
            {/* Camera affordance so the avatar reads as editable, not static. */}
            <View
              style={[
                styles.editBadge,
                { backgroundColor: t.colors.primary, borderColor: t.colors.surface },
              ]}>
              <Icon name="camera" size={13} color={t.colors.textOnAccent} />
            </View>
          </Pressable>
          <Pressable onPress={() => setPhotoSheet(true)} hitSlop={8} accessibilityRole="button">
            <Txt variant="captionMedium" color={t.colors.primary} style={{ marginTop: 8 }}>
              {photo ? 'Change photo' : 'Add photo'}
            </Txt>
          </Pressable>
          <Txt variant="title" style={{ marginTop: t.spacing.md }}>
            {name.trim() || 'Unnamed'}
          </Txt>
          <View style={styles.idRow}>
            <Txt variant="caption" color={t.colors.textMuted} mono>
              {id.trim() || 'no ID set'}
            </Txt>
            {onAir ? (
              <View style={{ marginLeft: 8 }}>
                <StatusBadge label="On air" tone="success" size="sm" />
              </View>
            ) : null}
          </View>
        </View>
      </Card>

      {saved && !dirty ? (
        <Banner tone="success" title="Profile saved" detail="Stored locally on this device." />
      ) : null}
      {error ? <Banner tone="danger" title="Could not save" detail={error} /> : null}

      {/* --------------------------------------------------------- fields -- */}
      <Card>
        <Field label="Full name" value={name} onChange={setName} placeholder="Enter full name" />
        <Field
          label="Employee ID"
          value={id}
          onChange={setId}
          placeholder="e.g. EMP001"
          autoCapitalize="characters"
          mono
          hint={
            onAir && idChanged
              ? 'Turn off attendance before changing this.'
              : 'Must match the ID your administrator registered. This is the only field that is broadcast.'
          }
        />
        <Field
          label="Department"
          value={department}
          onChange={setDepartment}
          placeholder="e.g. HR"
        />
        <Field
          label="Phone"
          value={phone}
          onChange={setPhone}
          placeholder="Optional"
          keyboardType="phone-pad"
        />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="Optional"
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </Card>

      <Button
        title="UPDATE PROFILE"
        onPress={handleSave}
        disabled={!dirty}
        gradient
        size="lg"
      />

      {/* -------------------------------------------------- privacy note -- */}
      <Card style={{ marginTop: t.spacing.md }}>
        <View style={styles.rowCenter}>
          <Icon name="shield" size={t.iconSize.sm} color={t.colors.primary} />
          <Txt variant="heading" style={{ marginLeft: t.spacing.sm }}>
            What goes out, and what can come in
          </Txt>
        </View>
        <Txt
          variant="caption"
          color={t.colors.textSecondary}
          style={{ lineHeight: 20, marginTop: 8 }}>
          While check-in is on, your phone broadcasts the Employee ID above — not
          your name, department, phone or email. Any Bluetooth device nearby can
          read it, not just the office Host. It is the same ID every day, so
          anyone who works out whose it is can tell when you arrive and leave, at
          the office or away from it. If you ask to check out, your phone also
          broadcasts to anyone in range that you are leaving, and keeps
          broadcasting it until a Host replies, you cancel, or you turn check-in
          off.
        </Txt>
        <Txt
          variant="caption"
          color={t.colors.textSecondary}
          style={{ lineHeight: 20, marginTop: 8 }}>
          Your phone also accepts Bluetooth connections while check-in is on,
          because that is the only way the Host can send your recorded times to
          your Home screen. It will not ask you to approve a connection, so any
          device in range — not only a real Host — could send you times you never
          worked, change a day already recorded, cancel a check-out you asked
          for, or stop your times showing at all. Whatever is sent is saved here
          and stays after you restart the phone.
        </Txt>
        <Txt
          variant="caption"
          color={t.colors.textSecondary}
          style={{ lineHeight: 20, marginTop: 8 }}>
          Nothing can be taken out that way — not your name, department, phone,
          email or your attendance history — and nothing goes over the internet.
          Turning check-in off stops all of it. Your office keeps its own record,
          so if the times on your Home screen look wrong, ask your Host.
        </Txt>
      </Card>
      <PhotoActionSheet
        visible={photoSheet}
        hasPhoto={photo.length > 0}
        onClose={() => setPhotoSheet(false)}
        onPicked={next => setPhoto(next ?? '')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 6 },
  editBadge: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    bottom: 0,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 28,
  },
  idRow: { alignItems: 'center', flexDirection: 'row', marginTop: 4 },
  rowCenter: { alignItems: 'center', flexDirection: 'row' },
});
