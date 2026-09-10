import React, {useState} from 'react';
import {Alert, Image, Modal, Pressable, ScrollView, Switch, View} from 'react-native';

import {
  Button,
  Card,
  Divider,
  Header,
  Row,
  Screen,
  SectionLabel,
  T,
  useT,
} from '../components/ui/Kit';
import {vehicleSpec} from '../config/catalogue';
import {radius, spacing} from '../config/theme';
import {useHitch} from '../state/store';
import type {RideHistoryEntry} from '../types';

/**
 * The account, which is two different screens wearing one name.
 *
 * A passenger's profile is about them and their safety; a rider's is about their vehicle
 * and their availability. Showing one list with half the rows greyed out would make both
 * worse, so the role picks the list.
 *
 * "Switch role" is a first-class row rather than a buried setting because plenty of people
 * genuinely are both — somebody who rides to work and drives at the weekend — and an app
 * that makes that a reinstall has misunderstood its own users.
 */

export function ProfileScreen() {
  const t = useT();
  const role = useHitch(s => s.role);
  const profile = useHitch(s => s.profile);
  const rider = useHitch(s => s.rider);
  const history = useHitch(s => s.history);
  const setRole = useHitch(s => s.setRole);
  const updateRider = useHitch(s => s.updateRider);
  const reset = useHitch(s => s.reset);

  const [historyOpen, setHistoryOpen] = useState(false);
  const isRider = role === 'rider';
  const spec = rider ? vehicleSpec(rider.vehicle.kind) : null;

  const switchRole = () => {
    const target = isRider ? 'passenger' : 'rider';
    Alert.alert(
      `Switch to ${target}?`,
      isRider
        ? 'You will stop advertising as a rider. Your vehicle details are kept.'
        : 'You will need vehicle details before you can go online.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: `Switch to ${target}`, onPress: () => setRole(target)},
      ],
    );
  };

  return (
    <Screen>
      <Header title="Profile" />
      <ScrollView contentContainerStyle={{paddingBottom: spacing.xxl}}>
        {/* Identity */}
        <View style={{alignItems: 'center', paddingVertical: spacing.lg}}>
          {profile?.photoUri ? (
            <Image
              source={{uri: profile.photoUri}}
              style={{width: 84, height: 84, borderRadius: 42}}
            />
          ) : (
            <View
              style={{
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: t.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <T style={{fontSize: 32}}>{isRider ? spec?.glyph ?? '🛺' : '🧑'}</T>
            </View>
          )}
          <T variant="title" style={{marginTop: spacing.md}}>
            {profile?.name ?? 'You'}
          </T>
          <T variant="caption" tone="dim" style={{marginTop: 2}}>
            {isRider ? 'Rider' : 'Passenger'}
          </T>

          {isRider && rider ? (
            <View
              style={{
                marginTop: spacing.md,
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: radius.pill,
                backgroundColor: t.surfaceAlt,
              }}>
              <T variant="label">
                {spec?.glyph} {rider.vehicle.registration || 'No number set'}
              </T>
            </View>
          ) : null}

          {profile ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md}}>
              <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: t.ok}} />
              <T variant="caption" tone="dim">
                Ride identity {profile.id.slice(0, 4)} {profile.id.slice(4)}
              </T>
            </View>
          ) : null}
        </View>

        <Divider />

        {isRider && rider ? (
          <>
            <SectionLabel>AVAILABILITY</SectionLabel>
            <Toggle
              title="Accept passengers"
              detail="Riders nearby can send you a request"
              value={rider.acceptsPassengers}
              onChange={v => updateRider({acceptsPassengers: v})}
            />
            <Toggle
              title="Show me nearby requests"
              detail="See passengers looking for a ride around you"
              value={rider.showNearbyRequests}
              onChange={v => updateRider({showNearbyRequests: v})}
            />

            <SectionLabel>VEHICLE</SectionLabel>
            <Row
              glyph={spec?.glyph}
              title={spec?.label ?? 'Vehicle'}
              detail={`${rider.vehicle.model || 'No model'} · ${rider.vehicle.colour || 'No colour'}`}
              onPress={() => undefined}
            />
            <Row
              glyph="📷"
              title="Vehicle photos"
              detail={
                rider.vehicle.photos.length
                  ? `${rider.vehicle.photos.length} added`
                  : 'None yet — worth adding'
              }
              onPress={() => undefined}
            />
          </>
        ) : (
          <>
            <SectionLabel>YOU</SectionLabel>
            <Row glyph="📞" title="Phone number" detail={profile?.phone || 'Not set'} onPress={() => undefined} />
            <Row
              glyph="🚨"
              title="Emergency contact"
              detail={profile?.emergencyContact || 'Not set'}
              onPress={() => undefined}
            />
            <Row
              glyph="🗣️"
              title="Languages"
              detail={profile?.languages.join(', ') || 'None'}
              onPress={() => undefined}
            />
          </>
        )}

        <SectionLabel>RIDES</SectionLabel>
        <Row
          glyph="🕘"
          title="Ride history"
          detail={history.length ? `${history.length} rides on this phone` : 'No rides yet'}
          onPress={() => setHistoryOpen(true)}
        />

        <SectionLabel>APP</SectionLabel>
        <Row glyph="📡" title="Bluetooth" detail="How Hitch finds people nearby" onPress={() => undefined} />
        <Row glyph="🔒" title="Safety and privacy" onPress={() => undefined} />

        <View style={{padding: spacing.lg, gap: spacing.md, marginTop: spacing.lg}}>
          <Button
            label={isRider ? 'Switch to passenger' : 'Switch to rider'}
            kind="secondary"
            onPress={switchRole}
          />
          <Pressable
            onPress={() =>
              Alert.alert('Reset Hitch?', 'Your profile, vehicle and ride history on this phone are removed. This cannot be undone.', [
                {text: 'Cancel', style: 'cancel'},
                {text: 'Reset', style: 'destructive', onPress: reset},
              ])
            }
            accessibilityRole="button"
            style={{alignItems: 'center', paddingVertical: spacing.md}}>
            <T variant="label" tone="error">
              Reset everything
            </T>
          </Pressable>
        </View>

        <T
          variant="caption"
          tone="faint"
          style={{textAlign: 'center', paddingHorizontal: spacing.xl, lineHeight: 17}}>
          Everything above is stored on this phone only. Hitch has no account, no server
          and no way to send it anywhere.
        </T>
      </ScrollView>

      <HistorySheet
        visible={historyOpen}
        history={history}
        onClose={() => setHistoryOpen(false)}
      />
    </Screen>
  );
}

function Toggle({
  title,
  detail,
  value,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: 12,
      }}>
      <View style={{flex: 1}}>
        <T variant="body">{title}</T>
        <T variant="caption" tone="faint" style={{marginTop: 2}}>
          {detail}
        </T>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{false: t.border, true: t.accent}}
        thumbColor="#ffffff"
        accessibilityLabel={title}
      />
    </View>
  );
}

function HistorySheet({
  visible,
  history,
  onClose,
}: {
  visible: boolean;
  history: RideHistoryEntry[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen edges={['top', 'bottom']}>
        <Header title="Ride history" onBack={onClose} />
        <ScrollView>
          {history.length === 0 ? (
            <View style={{padding: spacing.xl, alignItems: 'center'}}>
              <T variant="heading">Nothing here yet</T>
              <T variant="caption" tone="dim" style={{marginTop: 6, textAlign: 'center'}}>
                Rides you finish are kept on this phone.
              </T>
            </View>
          ) : (
            history.map(entry => (
              <Row
                key={entry.id}
                glyph={vehicleSpec(entry.kind).glyph}
                title={`${entry.fromLabel} → ${entry.toLabel}`}
                detail={`${new Date(entry.at).toLocaleDateString()} · ${entry.riderName}`}
                right={
                  <View style={{alignItems: 'flex-end'}}>
                    <T variant="label">₹{entry.fare}</T>
                    {entry.rating ? (
                      <T variant="caption" tone="faint">
                        {'★'.repeat(entry.rating)}
                      </T>
                    ) : null}
                  </View>
                }
              />
            ))
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}
