import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, View} from 'react-native';

import {
  Button,
  Card,
  Divider,
  Row,
  Screen,
  SimulatedBadge,
  T,
  useT,
} from '../components/ui/Kit';
import {MapCanvas, MapDisclaimer} from '../components/MapCanvas';
import {ParcelForm} from '../components/ParcelForm';
import {RideRequestCard} from '../components/RideRequestCard';
import {RideChatScreen} from './RideChatScreen';
import {RideChat} from '../services/rideChat';
import {
  listenForRequests,
  respondToRequest,
  riderLink,
  type IncomingRequest,
  type OpenRideLink,
} from '../ble/RideLink';
import {canCarry, estimateParcelFare, parcelSizeSpec} from '../config/parcel';
import {CURRENT_LOCATION, PLACES, searchPlaces, vehicleSpec, VEHICLES} from '../config/catalogue';
import {radius, spacing} from '../config/theme';
import {estimateFare, getRoute} from '../services/routing';
import {
  PROXIMITY_LABEL,
  askRider,
  byUsefulness,
  canAskForReal,
  goOffline,
  goOnline,
  isSimulated,
  requestRide,
  subscribeNearby,
} from '../services/discovery';
import {useHitch} from '../state/store';
import type {NearbyRide, ParcelDetails, Place, Ride, RideMode, Route, VehicleKind} from '../types';

/**
 * The screen the app is for.
 *
 * Passenger side, in one place, because it is one continuous act: say where you are
 * going, see what is around, ask somebody, wait, ride, arrive. Splitting that across six
 * routes would put a navigation animation between every pair of moments in a flow whose
 * whole character is that it does not stop.
 *
 * Rider side is a different screen entirely and lives at the bottom of this file — same
 * tab, different job. A rider is not booking anything; they are deciding whether to be
 * findable.
 */

export function RideScreen() {
  const role = useHitch(s => s.role);
  return role === 'rider' ? <RiderHome /> : <PassengerHome />;
}

// ================================================================= passenger

type Phase = 'where' | 'parcel' | 'choose' | 'searching' | 'matched' | 'riding' | 'done';

function PassengerHome() {
  const t = useT();
  const profile = useHitch(s => s.profile);
  const ride = useHitch(s => s.ride);
  const setRide = useHitch(s => s.setRide);
  const finishRide = useHitch(s => s.finishRide);

  const [phase, setPhase] = useState<Phase>('where');
  const [destination, setDestination] = useState<Place | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [kind, setKind] = useState<VehicleKind | null>(null);
  const [nearby, setNearby] = useState<NearbyRide[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rating, setRating] = useState(0);
  /** Person or parcel. Chosen before a destination, because it changes what is asked next. */
  const [mode, setMode] = useState<RideMode>('ride');
  const [parcel, setParcel] = useState<ParcelDetails | null>(null);
  /** What happened to the last request, when it was not a match. */
  const [requestNote, setRequestNote] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  /**
   * The conversation, owned by the ride rather than by the screen.
   *
   * Held in a ref so backing out of the chat to look at the map does not throw the thread
   * away — the ride is still happening, and so is the conversation about it.
   */
  const chatRef = useRef<RideChat | null>(null);
  /** Tears down the frame listener and the GATT connection when the ride ends. */
  const linkRef = useRef<(() => void) | null>(null);

  // Discovery runs for as long as this screen is mounted. It is the app's one genuinely
  // continuous background activity, and it has to be live before a destination is chosen
  // — "3 autos nearby" is the reason to open the app at all.
  useEffect(() => subscribeNearby(setNearby), []);

  const chooseDestination = useCallback(async (place: Place) => {
    setDestination(place);
    setPickerOpen(false);
    const r = await getRoute(CURRENT_LOCATION, place);
    setRoute(r);
    // A parcel asks four more questions before a vehicle can be picked — not least
    // because its size decides which vehicles can carry it at all.
    setPhase(mode === 'parcel' ? 'parcel' : 'choose');
  }, [mode]);

  const counts = useMemo(() => {
    const map: Record<string, {total: number; free: number}> = {};
    for (const spec of VEHICLES) {
      const of = nearby.filter(n => n.vehicle.kind === spec.kind);
      map[spec.kind] = {total: of.length, free: of.filter(n => n.available).length};
    }
    return map;
  }, [nearby]);

  const request = useCallback(
    async (pick: VehicleKind) => {
      if (!route) {
        return;
      }
      setKind(pick);
      setPhase('searching');

      let match: NearbyRide | null = null;
      /** The live connection, when the answer came over one. Null on the simulated path. */
      let acceptedLink: OpenRideLink | null = null;

      if (canAskForReal()) {
        // Phase 3: ask ONE rider — the nearest suitable one — and wait for a person.
        // Broadcasting to every rider at once would be faster and much ruder: several
        // people would drop what they were doing for a ride only one of them can take.
        const target = nearby
          .filter(n => n.vehicle.kind === pick && n.available)
          .sort(byUsefulness)[0];
        if (!target) {
          setRequestNote('Nobody with that vehicle is free right now.');
          setPhase('choose');
          return;
        }
        const outcome = await askRider(target, {
          from: profile?.name ?? 'A passenger',
          fromId: profile?.id ?? '',
          mode,
          kind: pick,
          pickup: CURRENT_LOCATION.label,
          drop: route.to.label,
          km: route.distanceKm,
          fare:
            mode === 'parcel' && parcel
              ? estimateParcelFare(pick, route.distanceKm, parcel.size)
              : estimateFare(pick, route.distanceKm),
          ...(mode === 'parcel' && parcel
            ? {
                parcel: {
                  size: parcel.size,
                  contents: parcel.contents,
                  receiver: parcel.receiverName,
                },
              }
            : {}),
        });

        // Four outcomes, four different things to say. Collapsing them into "no match"
        // would blame the radio for a person's "no", or the other way round.
        if (outcome.status === 'accepted') {
          acceptedLink = outcome.link;
          match = {
            ...target,
            riderName: outcome.accept.from,
            vehicle: {
              ...target.vehicle,
              registration: outcome.accept.plate,
              model: outcome.accept.model,
              colour: outcome.accept.colour,
            },
          };
        } else {
          setRequestNote(
            outcome.status === 'declined'
              ? `${target.riderName} said no${outcome.why ? ` — ${outcome.why}` : ''}.`
              : outcome.status === 'timeout'
              ? `${target.riderName} did not answer. Try another.`
              : `Could not reach ${target.riderName}: ${outcome.reason}`,
          );
          setPhase('choose');
          return;
        }
      } else {
        match = await requestRide(nearby, pick);
      }

      if (!match) {
        setRequestNote('Nobody free right now. Try another vehicle.');
        setPhase('choose');
        return;
      }
      setRequestNote(null);
      const newRide: Ride = {
        id: `ride-${Date.now()}`,
        mode,
        status: 'accepted',
        route,
        kind: pick,
        rider: match,
        ...(mode === 'parcel' && parcel ? {parcel} : {}),
        requestedAt: Date.now(),
        // A parcel is priced for the space it takes, a ride for the seat. Same distance,
        // different market — see config/parcel.ts.
        fare:
          mode === 'parcel' && parcel
            ? estimateParcelFare(pick, route.distanceKm, parcel.size)
            : estimateFare(pick, route.distanceKm),
      };
      // The conversation, wired to the link the acceptance left open. Without this the
      // chat has nowhere to send and every message queues against a closed connection —
      // which is exactly what it did before this was here.
      chatRef.current?.dispose();
      linkRef.current?.();
      const chat = new RideChat(match.peerId);
      chatRef.current = chat;
      if (acceptedLink) {
        chat.setLink(acceptedLink.send);
        const stop = acceptedLink.onFrame(frame => {
          const reply = chat.receive(frame);
          if (reply) {
            void acceptedLink!.send(reply);
          }
        });
        const link = acceptedLink;
        linkRef.current = () => {
          stop();
          link.close();
        };
      }
      setRide(newRide);
      setPhase('matched');
    },
    [route, nearby, setRide, mode, parcel, profile],
  );

  const cancel = () => {
    setRide(null);
    setKind(null);
    setPhase(route ? 'choose' : 'where');
  };

  const reset = () => {
    chatRef.current?.dispose();
    chatRef.current = null;
    // Give the radio its slot back. A link left open outlives the ride it belonged to.
    linkRef.current?.();
    linkRef.current = null;
    setChatOpen(false);
    setDestination(null);
    setRoute(null);
    setKind(null);
    setRating(0);
    setParcel(null);
    setPhase('where');
  };

  // ---------------------------------------------------------------- render

  const greeting = hourGreeting();

  return (
    <Screen>
      <View style={{flex: 1}}>
        {/* The map is the constant. Everything else is a sheet over it, which is what
            makes the flow feel like one screen rather than six. */}
        <MapCanvas
          route={route}
          origin={CURRENT_LOCATION}
          rides={phase === 'where' ? nearby : nearby.filter(n => !kind || n.vehicle.kind === kind)}
          focusRoute={phase === 'matched' || phase === 'riding'}
        />

        {phase === 'where' ? (
          <View style={{position: 'absolute', top: 0, left: 0, right: 0, padding: spacing.lg}}>
            <T variant="title">
              {greeting}
              {profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}
            </T>
          </View>
        ) : null}

        {/* --------------------------------------------------- bottom sheets */}
        <View
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: 1,
            borderColor: t.border,
            paddingBottom: spacing.lg,
            maxHeight: '62%',
          }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.border,
              alignSelf: 'center',
              marginTop: spacing.sm,
            }}
          />

          {phase === 'where' ? (
            <WhereTo
              mode={mode}
              onMode={setMode}
              onPick={() => setPickerOpen(true)}
              counts={counts}
              nearby={nearby}
            />
          ) : null}

          {phase === 'parcel' ? (
            <ParcelForm
              onCancel={reset}
              onDone={details => {
                setParcel(details);
                setPhase('choose');
              }}
            />
          ) : null}

          {phase === 'choose' && route ? (
            <ChooseRide
              route={route}
              counts={counts}
              mode={mode}
              parcel={parcel}
              note={requestNote}
              onBack={reset}
              onRequest={request}
            />
          ) : null}

          {phase === 'searching' ? <Searching kind={kind} found={nearby.length} /> : null}

          {phase === 'matched' && ride ? (
            <Matched
              ride={ride}
              onCancel={cancel}
              onStart={() => setPhase('riding')}
              onChat={chatRef.current ? () => setChatOpen(true) : undefined}
            />
          ) : null}

          {phase === 'riding' && ride ? (
            <Riding
              ride={ride}
              onArrive={() => setPhase('done')}
              onChat={chatRef.current ? () => setChatOpen(true) : undefined}
            />
          ) : null}

          {phase === 'done' && ride ? (
            <Completed
              ride={ride}
              rating={rating}
              onRate={setRating}
              onDone={() => {
                finishRide(rating || null);
                reset();
              }}
            />
          ) : null}
        </View>
      </View>

      {chatOpen && ride && chatRef.current ? (
        <Modal visible animationType="slide" onRequestClose={() => setChatOpen(false)}>
          <RideChatScreen
            ride={ride}
            chat={chatRef.current}
            onBack={() => setChatOpen(false)}
          />
        </Modal>
      ) : null}

      <DestinationPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={place => void chooseDestination(place)}
      />
    </Screen>
  );
}

function hourGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) {
    return 'Good morning';
  }
  if (h < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

// ---------------------------------------------------------------- where to

function WhereTo({
  mode,
  onMode,
  onPick,
  counts,
  nearby,
}: {
  mode: RideMode;
  onMode: (mode: RideMode) => void;
  onPick: () => void;
  counts: Record<string, {total: number; free: number}>;
  nearby: NearbyRide[];
}) {
  const t = useT();
  const saved = PLACES.filter(p => p.saved);
  const parcelMode = mode === 'parcel';
  return (
    <View style={{padding: spacing.lg, gap: spacing.md}}>
      {/*
        Person or parcel, chosen first.

        A switch rather than a separate service tile buried elsewhere: the two flows share
        a pickup, a drop, a vehicle and a rider, so making them separate destinations would
        duplicate the whole screen to change four questions. Rapido, Uber and Ola all land
        on the same shape — one home, a mode chosen at the top.
      */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.surfaceAlt,
          borderRadius: radius.pill,
          padding: 3,
        }}>
        {([
          {value: 'ride' as RideMode, label: 'Ride', glyph: '🧑'},
          {value: 'parcel' as RideMode, label: 'Send parcel', glyph: '📦'},
        ]).map(option => {
          const on = mode === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onMode(option.value)}
              accessibilityRole="radio"
              accessibilityState={{selected: on}}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                paddingVertical: 10,
                borderRadius: radius.pill,
                backgroundColor: on ? t.surface : 'transparent',
              }}>
              <T style={{fontSize: 15}}>{option.glyph}</T>
              <T variant="label" tone={on ? 'default' : 'faint'}>
                {option.label}
              </T>
            </Pressable>
          );
        })}
      </View>

      <T variant="heading">
        {parcelMode ? 'Where is it going?' : 'Where are you going?'}
      </T>

      <Pressable
        onPress={onPick}
        accessibilityRole="button"
        accessibilityLabel="Choose a destination"
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: t.border,
          overflow: 'hidden',
        }}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14}}>
          <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: t.textFaint}} />
          <T variant="body" tone="dim">
            {parcelMode ? 'Pick up from your location' : CURRENT_LOCATION.label}
          </T>
        </View>
        <Divider />
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14}}>
          <View style={{width: 8, height: 8, borderRadius: 2, backgroundColor: t.accent}} />
          <T variant="body" tone="faint">
            {parcelMode ? 'Where to deliver' : 'Search destination'}
          </T>
        </View>
      </Pressable>

      <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
        {saved.map(p => (
          <Pressable
            key={p.id}
            onPress={onPick}
            accessibilityRole="button"
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: t.surfaceAlt,
            }}>
            <T variant="label" tone="dim">
              {p.label}
            </T>
          </Pressable>
        ))}
      </View>

      <Divider />

      <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
        {VEHICLES.filter(v => v.kind !== 'other').map(v => (
          <View key={v.kind} style={{flex: 1, alignItems: 'center'}}>
            <T style={{fontSize: 20}}>{v.glyph}</T>
            <T variant="heading" style={{marginTop: 2}}>
              {counts[v.kind]?.free ?? 0}
            </T>
            <T variant="caption" tone="faint">
              {v.label}
            </T>
          </View>
        ))}
      </View>
      {isSimulated() && nearby.length > 0 ? (
        <SimulatedBadge style={{alignSelf: 'center'}} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- choose ride

function ChooseRide({
  route,
  counts,
  mode,
  parcel,
  note,
  onBack,
  onRequest,
}: {
  route: Route;
  counts: Record<string, {total: number; free: number}>;
  mode: RideMode;
  parcel: ParcelDetails | null;
  /** Why the last attempt did not become a ride. Null when nothing has been tried. */
  note: string | null;
  onBack: () => void;
  onRequest: (kind: VehicleKind) => void;
}) {
  const t = useT();
  return (
    <ScrollView>
      <View style={{padding: spacing.lg, paddingBottom: spacing.sm}}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <View style={{flex: 1}}>
            <T variant="heading">
              {parcel ? `${parcelSizeSpec(parcel.size).label} parcel to ${route.to.label}` : route.to.label}
            </T>
            <T variant="caption" tone="faint" style={{marginTop: 2}}>
              About {route.distanceKm} km · roughly {route.durationMin} min
              {parcel ? ` · for ${parcel.receiverName}` : ''}
            </T>
          </View>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Change destination">
            <T variant="label" tone="accent">
              Change
            </T>
          </Pressable>
        </View>
      </View>
      {note ? (
        <View style={{paddingHorizontal: spacing.lg, paddingBottom: spacing.md}}>
          <T variant="caption" tone="warn" style={{lineHeight: 17}}>
            {note}
          </T>
        </View>
      ) : null}

      <Divider />

      {VEHICLES.filter(v => v.kind !== 'other').map(spec => {
        const count = counts[spec.kind] ?? {total: 0, free: 0};
        // A bike cannot take a carton. Offering it and failing at the kerb wastes the
        // sender's time and the rider's trip, so the limit is applied before the choice.
        const tooBig = !!parcel && !canCarry(spec.kind, parcel.size);
        const none = count.free === 0 || tooBig;
        const fare =
          parcel !== null
            ? estimateParcelFare(spec.kind, route.distanceKm, parcel.size)
            : estimateFare(spec.kind, route.distanceKm);
        return (
          <Row
            key={spec.kind}
            glyph={spec.glyph}
            title={spec.label}
            detail={
              tooBig
                ? `Too small for a ${parcelSizeSpec(parcel!.size).label.toLowerCase()} parcel`
                : count.free === 0
                ? `None free right now · ${count.total} in range`
                : `${count.free} available · ${spec.blurb}`
            }
            onPress={none ? undefined : () => onRequest(spec.kind)}
            right={
              <View style={{alignItems: 'flex-end'}}>
                <T variant="heading" tone={none ? 'faint' : 'default'}>
                  ₹{fare}
                </T>
                <T variant="caption" tone="faint">
                  estimate
                </T>
              </View>
            }
          />
        );
      })}
      <View style={{padding: spacing.lg, paddingTop: spacing.sm}}>
        <T variant="caption" tone="faint" style={{lineHeight: 17}}>
          Fares are an estimate from the distance. What you pay is between you and the
          rider — Hitch is not in the middle of it.
        </T>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------- searching

function Searching({kind, found}: {kind: VehicleKind | null; found: number}) {
  const t = useT();
  const spec = kind ? vehicleSpec(kind) : null;
  return (
    <View style={{padding: spacing.xl, alignItems: 'center', gap: spacing.md}}>
      <T style={{fontSize: 34}}>{spec?.glyph ?? '📡'}</T>
      <T variant="heading">Asking riders nearby</T>
      <T variant="caption" tone="dim" style={{textAlign: 'center', lineHeight: 18}}>
        Your phone is talking to theirs directly. This takes a moment — there is no server
        to ask, only the radios in range.
      </T>
      <View
        style={{
          height: 4,
          alignSelf: 'stretch',
          borderRadius: 2,
          backgroundColor: t.surfaceAlt,
          overflow: 'hidden',
          marginTop: spacing.sm,
        }}>
        <View style={{height: 4, width: '65%', backgroundColor: t.accent}} />
      </View>
      <T variant="caption" tone="faint">
        {found} vehicles in range
      </T>
    </View>
  );
}

// ---------------------------------------------------------------- matched

function Matched({
  ride,
  onCancel,
  onStart,
  onChat,
}: {
  ride: Ride;
  onCancel: () => void;
  onStart: () => void;
  /** Absent until there is a link to talk over. */
  onChat?: () => void;
}) {
  const rider = ride.rider!;
  const spec = vehicleSpec(ride.kind);
  const parcel = ride.parcel;
  return (
    <ScrollView>
      <View style={{padding: spacing.lg, gap: spacing.md}}>
        <T variant="heading">
          {parcel ? 'Your parcel is on its way' : 'Your ride is confirmed'}
        </T>

        <Card>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
            <T style={{fontSize: 30}}>{spec.glyph}</T>
            <View style={{flex: 1}}>
              <T variant="heading">{rider.riderName}</T>
              <T variant="caption" tone="dim" style={{marginTop: 2}}>
                {rider.vehicle.model} · {rider.vehicle.colour}
              </T>
            </View>
            <View style={{alignItems: 'flex-end'}}>
              <T variant="label">{rider.vehicle.registration}</T>
              <T variant="caption" tone="ok" style={{marginTop: 2}}>
                {PROXIMITY_LABEL[rider.proximity]}
              </T>
            </View>
          </View>
        </Card>

        {/*
          The handover code, given the weight it actually carries here.

          Uber shows a delivery PIN; so does Rapido at the door. On those apps it is one
          check among several — there is also live tracking, a photo at the door, and
          support staff who can see both ends. Hitch has none of that, because Hitch has no
          server. This four-digit number is the entire proof that the parcel reached the
          right person, which is why it is the largest thing on the screen rather than a
          line in a details list.
        */}
        {parcel ? (
          <Card>
            <T variant="overline" tone="faint">
              HANDOVER CODE
            </T>
            <T variant="display" style={{marginTop: 6, letterSpacing: 8}}>
              {parcel.handoverCode}
            </T>
            <T variant="caption" tone="dim" style={{marginTop: 8, lineHeight: 18}}>
              Give this to {parcel.receiverName}. The rider asks for it at the door — it is
              how you both know the parcel reached the right person.
            </T>
          </Card>
        ) : null}

        {parcel ? (
          <Card>
            <Detail label="Parcel" value={`${parcelSizeSpec(parcel.size).label} · ${parcel.contents}`} />
            <Detail label="Receiver" value={parcel.receiverName} />
            <Detail label="Their number" value={parcel.receiverPhone} />
          </Card>
        ) : null}

        <Card>
          <T variant="caption" tone="faint">
            ESTIMATED FARE
          </T>
          <T variant="title" style={{marginTop: 4}}>
            ₹{ride.fare}
          </T>
          <T variant="caption" tone="dim" style={{marginTop: 4}}>
            {ride.route.from.label} → {ride.route.to.label}
          </T>
        </Card>

        {onChat ? (
          <Button label="Chat with rider" kind="secondary" glyph="💬" onPress={onChat} />
        ) : null}

        <Button
          label={parcel ? 'Parcel handed over' : "I'm in the vehicle"}
          onPress={onStart}
        />
        <Button
          label={parcel ? 'Cancel delivery' : 'Cancel ride'}
          kind="danger"
          onPress={onCancel}
        />
      </View>
    </ScrollView>
  );
}

function Detail({label, value}: {label: string; value: string}) {
  return (
    <View style={{flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12}}>
      <T variant="caption" tone="faint">
        {label}
      </T>
      <T variant="label" style={{flex: 1, textAlign: 'right'}} numberOfLines={1}>
        {value}
      </T>
    </View>
  );
}

// ---------------------------------------------------------------- riding

function Riding({
  ride,
  onArrive,
  onChat,
}: {
  ride: Ride;
  onArrive: () => void;
  onChat?: () => void;
}) {
  const t = useT();
  const rider = ride.rider!;
  return (
    <View style={{padding: spacing.lg, gap: spacing.md}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <View style={{width: 7, height: 7, borderRadius: 4, backgroundColor: t.ok}} />
        <T variant="heading">{ride.parcel ? 'Out for delivery' : 'On the way'}</T>
      </View>
      <T variant="caption" tone="dim">
        {rider.riderName} · {rider.vehicle.registration} → {ride.route.to.label}
      </T>
      {ride.parcel ? (
        <T variant="caption" tone="faint">
          Code {ride.parcel.handoverCode} · {ride.parcel.receiverName} confirms at the door
        </T>
      ) : null}

      {onChat ? (
        <Button label="Chat" kind="secondary" glyph="💬" onPress={onChat} />
      ) : null}

      <View style={{flexDirection: 'row', gap: spacing.md}}>
        <Button label={ride.parcel ? 'Delivered' : 'Arrived'} onPress={onArrive} style={{flex: 1}} />
        <Button label="Emergency" kind="danger" onPress={() => undefined} style={{flex: 1}} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- completed

function Completed({
  ride,
  rating,
  onRate,
  onDone,
}: {
  ride: Ride;
  rating: number;
  onRate: (n: number) => void;
  onDone: () => void;
}) {
  return (
    <View style={{padding: spacing.lg, gap: spacing.md, alignItems: 'center'}}>
      <T variant="display">₹{ride.fare}</T>
      <T variant="caption" tone="dim">
        {ride.route.from.label} → {ride.route.to.label}
      </T>
      <T variant="body" style={{marginTop: spacing.md}}>
        {ride.parcel ? 'How was the delivery?' : 'How was the ride?'}
      </T>
      <View style={{flexDirection: 'row', gap: 6}}>
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable
            key={n}
            onPress={() => onRate(n)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
            <T style={{fontSize: 30, opacity: n <= rating ? 1 : 0.25}}>★</T>
          </Pressable>
        ))}
      </View>
      <Button
        label={rating ? 'Submit and finish' : 'Skip rating'}
        onPress={onDone}
        style={{alignSelf: 'stretch', marginTop: spacing.sm}}
      />
    </View>
  );
}

// ---------------------------------------------------------------- picker

function DestinationPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (place: Place) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query ? searchPlaces(query) : PLACES), [query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen edges={['top', 'bottom']}>
        <View style={{padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <T variant="title" tone="dim">
              ‹
            </T>
          </Pressable>
          <T variant="title">Where to?</T>
        </View>
        <ScrollView>
          {results.map(place => (
            <Row
              key={place.id}
              glyph={place.saved ? '⭐' : '📍'}
              title={place.label}
              detail={place.detail}
              onPress={() => onPick(place)}
            />
          ))}
          <View style={{padding: spacing.lg}}>
            <T variant="caption" tone="faint" style={{lineHeight: 17}}>
              A short list for now. Searching real addresses needs offline map data on the
              phone, which is a later phase — the screens above it will not change when it
              arrives.
            </T>
          </View>
        </ScrollView>
      </Screen>
    </Modal>
  );
}

// ==================================================================== rider

function RiderHome() {
  const t = useT();
  const profile = useHitch(s => s.profile);
  const rider = useHitch(s => s.rider);
  const online = useHitch(s => s.online);
  const setOnline = useHitch(s => s.setOnline);
  const history = useHitch(s => s.history);
  const [requests, setRequests] = useState<NearbyRide[]>([]);
  /** Set when the radio refused to advertise, so "online" is never claimed falsely. */
  const [radioProblem, setRadioProblem] = useState<string | null>(null);
  /** The request currently on screen. One at a time — a rider can only take one ride. */
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  /**
   * The rider's side of the conversation, created when they accept.
   *
   * A rider never dials — the passenger connected to them — so this rides on the central
   * that is already attached rather than opening anything.
   */
  const [chat, setChat] = useState<RideChat | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const riderLinkRef = useRef<(() => void) | null>(null);

  /**
   * Listen only while online.
   *
   * Going offline has to stop this, not merely hide the card: a rider who has finished for
   * the day should not have a stranger's request appear over whatever else they are doing.
   */
  useEffect(() => {
    if (!online) {
      setIncoming(null);
      // Going offline ends the conversation with it: nothing is advertising, and a chat
      // over a link nobody is maintaining would sit there claiming to be connected.
      riderLinkRef.current?.();
      riderLinkRef.current = null;
      setChat(null);
      setActiveRide(null);
      setChatOpen(false);
      return;
    }
    return listenForRequests(request => {
      // Busy means busy. A second request while one is on screen is declined rather than
      // stacked, so nobody is left waiting behind a decision that was never seen.
      setIncoming(current => {
        if (current) {
          void respondToRequest(request.centralId, {
            t: 'DECLINE',
            v: 1,
            id: request.request.id,
            why: 'Already deciding on another ride',
          });
          return current;
        }
        return request;
      });
    });
  }, [online]);

  useEffect(() => {
    if (!online) {
      setRequests([]);
      return;
    }
    return subscribeNearby(all => setRequests(all.slice(0, 3)));
  }, [online]);

  const todays = history.filter(h => Date.now() - h.at < 86_400_000).length;
  const spec = rider ? vehicleSpec(rider.vehicle.kind) : null;

  return (
    <Screen>
      <View style={{flex: 1}}>
        <MapCanvas rides={online ? requests : []} />

        <View
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: 1,
            borderColor: t.border,
            padding: spacing.lg,
            gap: spacing.md,
          }}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: online ? t.ok : t.textFaint,
              }}
            />
            <T variant="heading">{online ? "You're online" : "You're offline"}</T>
          </View>

          <T variant="caption" tone="dim" style={{lineHeight: 18}}>
            {online
              ? 'Your vehicle is advertising over Bluetooth. Passengers within range can see you and ask for a ride.'
              : 'Nobody can see you. Going online starts advertising to phones nearby — it does not use any data.'}
          </T>

          {spec && rider ? (
            <Card>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
                <T style={{fontSize: 26}}>{spec.glyph}</T>
                <View style={{flex: 1}}>
                  <T variant="body">{rider.vehicle.registration || 'No number set'}</T>
                  <T variant="caption" tone="faint">
                    {spec.label}
                    {rider.vehicle.model ? ` · ${rider.vehicle.model}` : ''}
                  </T>
                </View>
                <View style={{alignItems: 'flex-end'}}>
                  <T variant="heading">{todays}</T>
                  <T variant="caption" tone="faint">
                    today
                  </T>
                </View>
              </View>
            </Card>
          ) : null}

          {online && requests.length > 0 ? (
            <>
              <T variant="overline" tone="faint">
                PASSENGERS IN RANGE
              </T>
              <T variant="caption" tone="dim">
                {requests.length} nearby. A request will appear here when one asks.
              </T>
              {isSimulated() ? <SimulatedBadge /> : null}
            </>
          ) : null}

          {/*
            A rider who believes they are online while nothing is on air will sit waiting
            for a request that cannot arrive. So the advertisement is started first and
            the switch only flips if the radio actually took it.
          */}
          {radioProblem ? (
            <T variant="caption" tone="warn" style={{lineHeight: 17}}>
              {radioProblem}
            </T>
          ) : null}

          {chat && activeRide ? (
            <Button
              label="Chat with passenger"
              kind="secondary"
              glyph="💬"
              onPress={() => setChatOpen(true)}
            />
          ) : null}

          {lastAnswer ? (
            <T variant="caption" tone="dim" style={{lineHeight: 17}}>
              {lastAnswer}
            </T>
          ) : null}

          <Button
            label={online ? 'Go offline' : 'Go online'}
            kind={online ? 'secondary' : 'primary'}
            onPress={() => {
              if (online) {
                void goOffline();
                setOnline(false);
                setRadioProblem(null);
                return;
              }
              void goOnline(
                profile?.id ?? '',
                profile?.name ?? 'Rider',
                rider?.vehicle.kind ?? 'auto',
                true,
              ).then(result => {
                if (result.ok) {
                  setRadioProblem(null);
                  setOnline(true);
                } else {
                  // Simulated discovery still lets the rest of the app be used and seen;
                  // what must not happen is claiming to be findable when nothing is.
                  setRadioProblem(
                    `Not advertising: ${result.reason ?? 'the radio refused'}. Passengers cannot see you yet.`,
                  );
                  setOnline(true);
                }
              });
            }}
          />
        </View>
      </View>

      {chatOpen && chat && activeRide ? (
        <Modal visible animationType="slide" onRequestClose={() => setChatOpen(false)}>
          <RideChatScreen ride={activeRide} chat={chat} onBack={() => setChatOpen(false)} />
        </Modal>
      ) : null}

      <RideRequestCard
        incoming={incoming}
        onAccept={() => {
          const request = incoming;
          setIncoming(null);
          if (!request) {
            return;
          }
          void respondToRequest(request.centralId, {
            t: 'ACCEPT',
            v: 1,
            id: request.request.id,
            from: profile?.name ?? 'Rider',
            plate: rider?.vehicle.registration ?? '',
            model: rider?.vehicle.model ?? '',
            colour: rider?.vehicle.colour ?? '',
          }).then(sent => {
            setLastAnswer(
              sent
                ? `Accepted ${request.request.from} — head to ${request.request.pickup}.`
                : 'Accepted, but the reply did not reach them. They may still be waiting.',
            );
            if (!sent) {
              return;
            }
            // Same RideChat class as the passenger's, on the mirrored link — which is what
            // makes the conversation two-sided rather than one phone talking to itself.
            const link = riderLink(request.centralId);
            const conversation = new RideChat(request.request.fromId || request.centralId);
            conversation.setLink(link.send);
            const stop = link.onFrame(frame => {
              const reply = conversation.receive(frame);
              if (reply) {
                void link.send(reply);
              }
            });
            riderLinkRef.current = () => {
              stop();
              conversation.dispose();
            };
            setChat(conversation);
            // A minimal ride, so the chat header can name the vehicle and the destination.
            setActiveRide({
              id: request.request.id,
              mode: request.request.mode,
              status: 'accepted',
              kind: request.request.kind,
              rider: {
                peerId: request.centralId,
                riderName: request.request.from,
                vehicle: rider?.vehicle ?? {
                  kind: request.request.kind,
                  registration: '',
                  model: '',
                  colour: '',
                  photos: [],
                },
                proximity: 'veryClose',
                available: false,
                bearing: 0,
              },
              route: {
                from: {id: 'p', label: request.request.pickup, x: 0.4, y: 0.5},
                to: {id: 'd', label: request.request.drop, x: 0.6, y: 0.4},
                points: [],
                distanceKm: request.request.km,
                durationMin: 0,
              },
              requestedAt: Date.now(),
              fare: request.request.fare,
            });
          });
        }}
        onDecline={why => {
          const request = incoming;
          setIncoming(null);
          if (!request) {
            return;
          }
          void respondToRequest(request.centralId, {
            t: 'DECLINE',
            v: 1,
            id: request.request.id,
            ...(why ? {why} : {}),
          });
          setLastAnswer(`Declined ${request.request.from}.`);
        }}
      />
    </Screen>
  );
}
