import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import Button from '../components/Button';
import Stepper from '../components/Stepper';
import BleStatusBadge from '../components/BleStatusBadge';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { MAX_CAPACITY, MIN_CAPACITY } from '../ble/constants';
import { useSettings } from '../settings/SettingsProvider';
import { plural } from '../util/format';
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
  const { state, players, hostRoom, transport, error, clearError } = useBle();
  const { playerName, range, maxPlayers, setMaxPlayers } = useSettings();
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);

  const host = async () => {
    setHosting(true);
    setHostError(null);
    clearError();
    try {
      await hostRoom(maxPlayers);
      onHosted();
    } catch (err) {
      // Hosting fails for reasons a player can do something about — Bluetooth
      // off, permission refused, a handset whose radio cannot advertise — so
      // the reason is worth more than a spinner that quietly stops.
      setHostError(err instanceof Error ? err.message : 'Could not open a room.');
    } finally {
      setHosting(false);
    }
  };

  const problem = hostError ?? error;

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
          One phone hosts and gets a room code. Everyone else joins it over Bluetooth. The host picks the hidden number
          and starts the round; from then on every guess is relayed as it happens, so you can watch the others closing
          in.
        </Text>
      </View>

      {problem ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{problem}</Text>
        </View>
      ) : null}

      <View style={styles.hostBlock}>
        <Stepper
          label="Room size"
          hint={`Up to ${plural(maxPlayers, 'phone')}, yours included`}
          value={maxPlayers}
          min={MIN_CAPACITY}
          max={MAX_CAPACITY}
          onChange={setMaxPlayers}
          disabled={hosting}
        />
        <Button label="Host a game" icon="radio-outline" onPress={host} busy={hosting} />
      </View>

      <Button label="Join with a code" icon="search-outline" variant="secondary" onPress={onJoin} />

      <View style={styles.facts}>
        <Fact icon="key-outline" text="The host's four-letter code is what joiners look for" />
        <Fact icon="people-outline" text={`${plural(maxPlayers, 'player')} in Bluetooth range — about ten metres`} />
        <Fact icon="grid-outline" text={`Host's range setting wins — yours is ${range.min}–${range.max}`} />
        <Fact icon="flash-outline" text="No internet, no accounts, no server" />
      </View>

      {transport.simulated ? (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
          <Text style={styles.noteText}>
            This build has no Bluetooth radio available, so you are playing against stand-in opponents
            ({transport.label.toLowerCase()}). Install the dev build to play against real phones.
          </Text>
        </View>
      ) : null}
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
    paddingVertical: spacing.lg,
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
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.danger,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  hostBlock: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  facts: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    marginTop: spacing.lg,
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
