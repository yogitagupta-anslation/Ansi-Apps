/**
 * RoleSelectScreen.tsx
 * -----------------------------------------------------------------------------
 * First-launch gate. Shown ONCE — after a role is chosen it is persisted, and
 * every later launch goes straight to that role's app.
 *
 * The choice matters before any Bluetooth work begins, because the two roles
 * use opposite halves of the BLE stack and need different permissions:
 *
 *   HOST      scans   (BluetoothLeScanner)   one device per session
 *   EMPLOYEE  advertises (BluetoothLeAdvertiser)  many devices
 *
 * A card must be selected and then confirmed with Continue, rather than a
 * single tap committing immediately. This governs what the device does from
 * here on, and there is deliberately no role switch in the production UI —
 * the only way back is Settings > Erase all local data.
 * -----------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AppRole } from '../constants/appConfig';
import { useTheme } from '../theme/ThemeContext';
import { Icon, IconBadge, type IconName } from '../components/Icon';
import { Button, Card, Screen, Txt } from '../components/ui';

export function RoleSelectScreen({ onSelect }: { onSelect: (role: AppRole) => void }) {
  const t = useTheme();
  const [selected, setSelected] = useState<AppRole | null>(null);

  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={styles.hero}>
        <IconBadge
          name="radio-tower"
          color={t.colors.primary}
          background={t.colors.primarySoft}
          diameter={64}
          size={28}
        />
        <Txt variant="display" style={{ marginTop: 16 } as object}>
          BLE Attendance
        </Txt>
        <Txt
          variant="caption"
          color={t.colors.textMuted}
          align="center"
          style={{ marginTop: 6, maxWidth: 300 } as object}>
          Attendance over Bluetooth Low Energy. Fully offline — no servers, no
          internet.
        </Txt>
      </View>

      <Txt variant="heading" style={{ marginBottom: 12 } as object}>
        Choose your role
      </Txt>

      <RoleOption
        icon="radio"
        accent={t.colors.primary}
        accentSoft={t.colors.primarySoft}
        title="Host"
        summary="Manage attendance and detect nearby employees."
        detail="One device per attendance session. It holds the employee registry and the attendance records."
        selected={selected === 'HOST'}
        onPress={() => setSelected('HOST')}
      />

      <RoleOption
        icon="id-card"
        accent={t.colors.accent}
        accentSoft={t.colors.accentSoft}
        title="Employee"
        summary="Your device will be detected by the attendance Host."
        detail="Broadcasts your employee ID over Bluetooth. It never scans and never records attendance."
        selected={selected === 'EMPLOYEE'}
        onPress={() => setSelected('EMPLOYEE')}
      />

      <View style={{ marginTop: t.spacing.md }}>
        <Button
          title="CONTINUE"
          onPress={() => selected && onSelect(selected)}
          disabled={selected === null}
          size="lg"
        />
      </View>

      <Txt
        variant="caption"
        color={t.colors.textMuted}
        align="center"
        style={{ marginTop: 4, lineHeight: 18 } as object}>
        This is a one-time choice. Changing it later requires erasing all
        local data on this device, so pick the role this phone will actually
        have.
      </Txt>
    </Screen>
  );
}

function RoleOption({
  icon,
  accent,
  accentSoft,
  title,
  summary,
  detail,
  selected,
  onPress,
}: {
  icon: IconName;
  accent: string;
  accentSoft: string;
  title: string;
  summary: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title + '. ' + summary}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <Card
        style={
          selected
            ? { borderColor: accent, borderWidth: 1.5, backgroundColor: t.colors.surfaceRaised }
            : undefined
        }>
        <View style={styles.optionHeader}>
          <IconBadge name={icon} color={accent} background={accentSoft} diameter={44} size={20} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Txt variant="title">{title}</Txt>
            <Txt variant="caption" color={t.colors.textSecondary}>
              {summary}
            </Txt>
          </View>
          {/* Explicit selection affordance — the border alone is easy to miss. */}
          <Icon
            name={selected ? 'circle-check' : 'circle'}
            size={22}
            color={selected ? accent : t.colors.textMuted}
          />
        </View>
        <Txt
          variant="caption"
          color={t.colors.textMuted}
          style={{ marginTop: 12, lineHeight: 19 } as object}>
          {detail}
        </Txt>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: 28 },
  optionHeader: { alignItems: 'center', flexDirection: 'row' },
});
