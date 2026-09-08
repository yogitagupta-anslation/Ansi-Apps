/**
 * AddEmployeeScreen.tsx
 * -----------------------------------------------------------------------------
 * Register a new employee, or edit an existing one. HOST-only.
 *
 * The Employee ID is the load-bearing field: it is the only value that travels
 * over the air, and the scanner matches on it exactly. So it is validated here
 * against the same pattern the BLE payload encoder allows, rather than being
 * accepted now and failing silently later at the radio.
 *
 * Everything else — name, department, title, office, phone, email — is local
 * display metadata and is never broadcast.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { PhotoActionSheet } from '../components/PhotoPicker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Field, PickerField } from '../components/Field';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/AppHeader';
import { Banner, Button, Card, Screen, Txt } from '../components/ui';
import { EMPLOYEE_ID_PATTERN } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

/** Offered as quick picks; the field still accepts anything typed. */
const COMMON_DEPARTMENTS = ['HR', 'IT', 'Finance', 'Marketing', 'Operations', 'Sales'];

export function AddEmployeeScreen() {
  const t = useTheme();
  const store = useAppStore();
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<{ key: string; name: string; params?: { employeeId?: string } }>();

  const editingId = route.params?.employeeId;
  const existing = editingId
    ? store.employees.find(e => e.employeeId === editingId) ?? null
    : null;

  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const [employeeId, setEmployeeId] = useState(existing?.employeeId ?? '');
  const [department, setDepartment] = useState(existing?.department ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [office, setOffice] = useState(existing?.office ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [photo, setPhoto] = useState(existing?.photo ?? '');
  const [photoSheet, setPhotoSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Registry departments first, so existing choices stay consistent. */
  const departmentOptions = useMemo(() => {
    const set = new Set<string>(COMMON_DEPARTMENTS);
    store.employees.forEach(e => {
      if (e.department) {
        set.add(e.department);
      }
    });
    return Array.from(set).sort();
  }, [store.employees]);

  const idError =
    employeeId.trim().length > 0 && !EMPLOYEE_ID_PATTERN.test(employeeId.trim())
      ? 'Only letters, numbers, hyphens and underscores. Other characters cannot survive the Bluetooth payload encoding.'
      : null;

  const canSubmit =
    displayName.trim().length > 0 && employeeId.trim().length > 0 && !idError && !busy;

  const handleSubmit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const input = {
        employeeId: employeeId.trim(),
        displayName: displayName.trim(),
        department: department.trim(),
        title: title.trim(),
        office: office.trim(),
        phone: phone.trim(),
        email: email.trim(),
        photo,
        enabled: existing?.enabled ?? true,
      };

      const result = existing
        ? await store.employeeManager.updateEmployee(existing.employeeId, input)
        : await store.employeeManager.addEmployee(input);

      if (!result.ok) {
        setError(result.message ?? 'Could not save this employee.');
        return;
      }
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  }, [employeeId, displayName, department, phone, email, photo, existing, store.employeeManager, navigation]);

  return (
    <Screen>
      <PageHeader
        title={existing ? 'Edit employee' : 'Add employee'}
        subtitle={existing ? 'Update registry details' : 'Register a new employee'}
        onBack={() => navigation.goBack()}
      />

      {/* -------------------------------------------------- avatar preview -- */}
      <Card>
        <View style={styles.hero}>
          <Pressable
            onPress={() => setPhotoSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Change employee photo' : 'Add employee photo'}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            {photo || displayName.trim() ? (
              <EmployeeAvatar
                name={displayName || '?'}
                employeeId={employeeId || displayName}
                size={84}
                photo={photo || undefined}
              />
            ) : (
              <View
                style={[
                  styles.placeholder,
                  { backgroundColor: t.colors.surfaceRaised, borderColor: t.colors.border },
                ]}>
                <Icon name="user-plus" size={30} color={t.colors.textMuted} />
              </View>
            )}
            <View
              style={[
                styles.editBadge,
                { backgroundColor: t.colors.primary, borderColor: t.colors.surface },
              ]}>
              <Icon name="camera" size={12} color={t.colors.textOnAccent} />
            </View>
          </Pressable>
          <Pressable onPress={() => setPhotoSheet(true)} hitSlop={8} accessibilityRole="button">
            <Txt variant="captionMedium" color={t.colors.primary} style={{ marginTop: 8 }}>
              {photo ? 'Change photo' : 'Add photo'}
            </Txt>
          </Pressable>
          <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 4 }}>
            Optional. Stored on this device only.
          </Txt>
        </View>
      </Card>

      {error ? <Banner tone="danger" title="Could not save" detail={error} /> : null}

      {/* -------------------------------------------------------- the form -- */}
      <Card>
        <Field
          label="Full name"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Enter full name"
          autoCapitalize="words"
        />
        <Field
          label="Employee ID"
          value={employeeId}
          onChange={setEmployeeId}
          placeholder="e.g. EMP001"
          autoCapitalize="characters"
          mono
          error={idError}
          hint="The employee enters this exact ID on their own phone. It is the only value broadcast over Bluetooth."
        />
        <PickerField
          label="Department"
          value={department}
          options={departmentOptions}
          onChange={setDepartment}
          placeholder="Select department"
          hint="Optional. Used for filtering only."
        />
        <Field
          label="Job title"
          value={title}
          onChange={setTitle}
          placeholder="Optional"
        />
        <Field
          label="Office"
          value={office}
          onChange={setOffice}
          placeholder="Optional"
          hint="Where they normally sit, e.g. HQ · Floor 4."
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
        title={existing ? 'SAVE CHANGES' : 'REGISTER EMPLOYEE'}
        onPress={handleSubmit}
        disabled={!canSubmit}
        busy={busy}
        gradient
        size="lg"
      />

      <View style={{ marginTop: t.spacing.sm }}>
        <Button
          title="Cancel"
          onPress={() => navigation.goBack()}
          variant="ghost"
        />
      </View>
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
    borderRadius: 13,
    borderWidth: 2,
    bottom: 0,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 26,
  },
  placeholder: {
    alignItems: 'center',
    borderRadius: 42,
    borderWidth: StyleSheet.hairlineWidth,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
});
