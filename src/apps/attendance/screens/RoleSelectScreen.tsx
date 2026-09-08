/**
 * RoleSelectScreen.tsx — v3 "Orbit"
 * -----------------------------------------------------------------------------
 * First run: which side of the exchange is this phone?
 *
 * A tap commits the role and goes straight in — there is no select-then-confirm
 * step any more. That was right while the role was permanent; it is not now
 * that Profile carries "Switch device role", and a confirmation step for a
 * reversible choice is just an extra tap.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, type IconName } from '../components/Icon';
import { Screen, Txt } from '../components/ui';
import type { AppRole } from '../constants/appConfig';
import { useTheme } from '../theme/ThemeContext';

export function RoleSelectScreen({ onSelect }: { onSelect: (role: AppRole) => void }) {
  const t = useTheme();
  const c = t.colors;

  const cards: {
    role: AppRole;
    icon: IconName;
    rail: string;
    soft: string;
    softBorder: string;
    tint: string;
    title: string;
    subtitle: string;
    body: string;
  }[] = [
    {
      role: 'HOST',
      icon: 'radio',
      rail: c.primary,
      soft: c.primarySoft,
      softBorder: c.primaryBorderSoft,
      tint: c.primaryTint,
      title: 'Office Host',
      subtitle: 'Scans, records, owns the roster',
      body: 'One device per office. It listens for employee broadcasts and writes the attendance record.',
    },
    {
      role: 'EMPLOYEE',
      icon: 'user-check',
      rail: c.success,
      soft: c.successSoft,
      softBorder: c.successBorder,
      tint: c.success,
      title: 'Employee',
      subtitle: 'Checks in, sees own record',
      body: 'Your phone. Broadcasts your ID when you check in and shows what the Host recorded.',
    },
  ];

  return (
    <Screen contentStyle={styles.root}>
      <LinearGradient
        colors={['#4F46E5', '#7C3AED']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.mark}>
        <Icon name="radio" size={24} color="#FFFFFF" />
      </LinearGradient>

      <Txt style={[styles.headline, { color: c.textPrimary }]}>{'Set up this\ndevice'}</Txt>
      <Txt style={[styles.sub, { color: c.textSecondary }]}>
        A device works as one side of the exchange. Pick its role — you can change it later from
        Settings.
      </Txt>

      <View style={styles.stack}>
        {cards.map(card => (
          <Pressable
            key={card.role}
            onPress={() => onSelect(card.role)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border, borderLeftColor: card.rail },
              t.neu,
              pressed ? { transform: [{ scale: 0.97 }] } : null,
            ]}>
            <View style={styles.cardHead}>
              <View
                style={[styles.well, { backgroundColor: card.soft, borderColor: card.softBorder }]}>
                <Icon name={card.icon} size={20} color={card.tint} />
              </View>

              <View style={{ flex: 1 }}>
                <Txt style={[styles.cardTitle, { color: c.textPrimary }]}>{card.title}</Txt>
                <Txt style={[styles.cardSub, { color: c.textMuted }]}>{card.subtitle}</Txt>
              </View>

              <Icon name="chevron-right" size={18} color={c.textMuted} />
            </View>

            <Txt style={[styles.cardBody, { color: c.textSecondary }]}>{card.body}</Txt>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Icon name="info" size={14} color={c.textMuted} />
        <Txt style={[styles.footerText, { color: c.textMuted }]}>
          Bluetooth and Location must stay on. Nothing is sent to a server — the record lives on
          the Host device. The app follows your system light or dark setting.
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // flexGrow lets the footer sit at the bottom on a tall screen and scroll
  // naturally on a short one.
  root: { flexGrow: 1, paddingTop: 40 },

  mark: {
    alignItems: 'center',
    borderRadius: 14,
    elevation: 8,
    height: 46,
    justifyContent: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    width: 46,
  },
  headline: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 30,
    letterSpacing: -0.9,
    lineHeight: 34.5,
    marginTop: 26,
  },
  sub: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 14.5,
    lineHeight: 21.75,
    marginTop: 10,
  },

  stack: { gap: 12, marginTop: 30 },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    // The role's colour as a left rail, the one edge that is not hairline.
    borderLeftWidth: 3,
    padding: 18,
  },
  cardHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  well: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 },
  cardSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, marginTop: 1 },
  cardBody: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 12.5,
    lineHeight: 18.75,
    marginTop: 12,
  },

  footer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 'auto',
    paddingTop: 24,
  },
  footerText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 11.5,
    lineHeight: 17.25,
  },
});
