import React, {useEffect, useMemo, useState} from 'react';
import {Modal, Pressable, ScrollView, View} from 'react-native';

import {
  Button,
  Card,
  Chips,
  Divider,
  Header,
  Row,
  Screen,
  SimulatedBadge,
  T,
  useT,
} from '../components/ui/Kit';
import {MapCanvas, MapDisclaimer} from '../components/MapCanvas';
import {VEHICLES, vehicleSpec} from '../config/catalogue';
import {radius, spacing} from '../config/theme';
import {PROXIMITY_LABEL, byUsefulness, isSimulated, subscribeNearby} from '../services/discovery';
import type {NearbyRide, VehicleKind} from '../types';

/**
 * "What is around me right now?"
 *
 * Deliberately not a second booking screen. Ride answers "get me to X"; this answers a
 * different and more casual question — is it worth walking out to the road, or is the
 * street empty. That is the question somebody actually opens a ride app to answer half
 * the time, and no ride app answers it without first demanding a destination.
 *
 * Which is also why it leads with the map and the counts rather than a search field.
 */

const FILTERS: Array<{label: string; kind: VehicleKind | null}> = [
  {label: 'All', kind: null},
  {label: 'Bike', kind: 'bike'},
  {label: 'Auto', kind: 'auto'},
  {label: 'Cab', kind: 'cab'},
];

export function NearbyScreen() {
  const t = useT();
  const [rides, setRides] = useState<NearbyRide[]>([]);
  const [filter, setFilter] = useState<VehicleKind | null>(null);
  const [selected, setSelected] = useState<NearbyRide | null>(null);

  useEffect(() => subscribeNearby(setRides), []);

  const shown = useMemo(
    () => rides.filter(r => !filter || r.vehicle.kind === filter).sort(byUsefulness),
    [rides, filter],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const spec of VEHICLES) {
      map[spec.kind] = rides.filter(r => r.vehicle.kind === spec.kind).length;
    }
    return map;
  }, [rides]);

  return (
    <Screen>
      <Header
        title="Nearby"
        subtitle={rides.length === 0 ? 'Listening…' : `${rides.length} vehicles in range`}
        right={isSimulated() && rides.length > 0 ? <SimulatedBadge /> : undefined}
      />

      <View style={{height: 260}}>
        <MapCanvas rides={shown} height={260} />
      </View>
      <View style={{paddingHorizontal: spacing.lg, paddingVertical: spacing.sm}}>
        <MapDisclaimer />
      </View>

      <View style={{paddingHorizontal: spacing.lg, paddingBottom: spacing.md}}>
        <Chips
          options={FILTERS.map(f => f.label)}
          selected={[FILTERS.find(f => f.kind === filter)?.label ?? 'All']}
          onToggle={label => setFilter(FILTERS.find(f => f.label === label)?.kind ?? null)}
        />
      </View>

      <Divider />

      <ScrollView>
        {rides.length === 0 ? (
          <View style={{padding: spacing.xl, alignItems: 'center', gap: spacing.sm}}>
            <T style={{fontSize: 30}}>📡</T>
            <T variant="heading">Listening for vehicles</T>
            <T variant="caption" tone="dim" style={{textAlign: 'center', lineHeight: 18}}>
              The first few seconds are normal — phones announce themselves on their own
              schedule, and a scan only hears one when it happens to be listening.
            </T>
          </View>
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
              }}>
              {VEHICLES.filter(v => v.kind !== 'other').map(v => (
                <View key={v.kind} style={{flex: 1}}>
                  <T variant="caption" tone="faint">
                    {v.label}
                  </T>
                  <T variant="title">{counts[v.kind] ?? 0}</T>
                </View>
              ))}
            </View>

            <View style={{height: spacing.md}} />

            {shown.map(ride => (
              <Row
                key={ride.peerId}
                glyph={vehicleSpec(ride.vehicle.kind).glyph}
                title={ride.riderName}
                detail={`${ride.vehicle.registration} · ${PROXIMITY_LABEL[ride.proximity]}`}
                onPress={() => setSelected(ride)}
                right={
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: radius.pill,
                      backgroundColor: ride.available ? t.accentSoft : t.surfaceAlt,
                    }}>
                    <T variant="caption" tone={ride.available ? 'accent' : 'faint'}>
                      {ride.available ? 'Available' : 'Busy'}
                    </T>
                  </View>
                }
              />
            ))}
          </>
        )}
        <View style={{height: spacing.xxl}} />
      </ScrollView>

      <RideSheet ride={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}

function RideSheet({ride, onClose}: {ride: NearbyRide | null; onClose: () => void}) {
  const t = useT();
  if (!ride) {
    return null;
  }
  const spec = vehicleSpec(ride.vehicle.kind);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{flex: 1, backgroundColor: 'rgba(10,10,12,0.45)', justifyContent: 'flex-end'}}>
        <Pressable
          onPress={() => undefined}
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.lg,
            gap: spacing.md,
          }}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
            <T style={{fontSize: 32}}>{spec.glyph}</T>
            <View style={{flex: 1}}>
              <T variant="title">{ride.riderName}</T>
              <T variant="caption" tone="dim" style={{marginTop: 2}}>
                {ride.vehicle.model} · {ride.vehicle.colour}
              </T>
            </View>
          </View>

          <Card>
            <Detail label="Vehicle" value={ride.vehicle.registration} />
            <Detail label="Signal" value={PROXIMITY_LABEL[ride.proximity]} />
            <Detail label="Right now" value={ride.available ? 'Available' : 'Carrying a passenger'} />
            {ride.ridesTogether ? (
              <Detail label="History" value={`${ride.ridesTogether} ride together`} />
            ) : null}
          </Card>

          <T variant="caption" tone="faint" style={{lineHeight: 17}}>
            Hitch has not checked this person's licence or their vehicle. It can tell you
            that the same device you rode with before is the one in front of you now, and
            that is a different and smaller claim.
          </T>

          <Button
            label={ride.available ? `Request ${spec.label.toLowerCase()}` : 'Not available'}
            disabled={!ride.available}
            onPress={onClose}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Detail({label, value}: {label: string; value: string}) {
  return (
    <View style={{flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6}}>
      <T variant="caption" tone="faint">
        {label}
      </T>
      <T variant="label">{value}</T>
    </View>
  );
}
