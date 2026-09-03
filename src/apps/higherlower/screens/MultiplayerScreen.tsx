import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import Button from '../components/Button';
import BleStatusBadge from '../components/BleStatusBadge';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { useSettings } from '../settings/SettingsProvider';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface MultiplayerScreenProps {
  onBack: () => void;
  onHosted: () => void;
  onJoin: () => void;
}

export default function MultiplayerScreen({ onBack, onHosted, onJoin }: MultiplayerScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { state, players, hostRoom, transport } = useBle();
  const { playerName, range } = useSettings();
  const [hosting, setHosting] = useState(false);

  const host = async () => {
    setHosting(true);
    try {
      await hostRoom();
      onHosted();
    } finally {
      setHosting(false);
    }
  };

  return (
    <Screen
      title="Multiplayer"
      subtitle={`Playing as ${playerName}`}
      onBack={onBack}
      headerRight={<BleStatusBadge label={bleStatusLabel(state, players.length - 1)} live={state === 'connected'} />}
      scroll
    >
      <View style={styles.hero}>
        <Ionicons name="bluetooth" size={30} color={colors.accent} />
        <Text style={styles.heroTitle}>Same number, every phone</Text>
        <Text style={styles.heroBody}>
          The host picks the hidden number and sends it to everyone nearby. From then on each guess is relayed as it
          happens, so you can watch the others closing in. Fastest correct guess wins, and everyone gets to finish.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Host a game" icon="radio-outline" onPress={host} busy={hosting} />
        <Button label="Join a game" icon="search-outline" variant="secondary" onPress={onJoin} />
      </View>

      <View style={styles.facts}>
        <Fact icon="people-outline" text="2–4 players in Bluetooth range" />
        <Fact icon="grid-outline" text={`Host's range setting wins — yours is ${range.min}–${range.max}`} />
        <Fact icon="flash-outline" text="No internet, no accounts, no server" />
        <Fact icon="pulse-outline" text="Every guess syncs live — drops reconnect on their own" />
      </View>

      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
        <Text style={styles.noteText}>
          Playing against stand-in opponents ({transport.label.toLowerCase()}), so the whole flow works on one device.
        </Text>
      </View>
    </Screen>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={15} color={colors.accent} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  heroTitle: {
    ...fonts.title,
    color: colors.textPrimary,
    fontSize: 19,
  },
  heroBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  facts: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  factText: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  note: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    marginTop: spacing.md,
  },
  noteText: {
    color: colors.textMuted,
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
});
