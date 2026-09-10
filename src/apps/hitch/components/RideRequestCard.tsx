import React, {useEffect, useState} from 'react';
import {Modal, View} from 'react-native';

import {Button, Card, Divider, T, useT} from './ui/Kit';
import {parcelSizeSpec} from '../config/parcel';
import {vehicleSpec} from '../config/catalogue';
import {radius, spacing} from '../config/theme';
import type {IncomingRequest} from '../ble/RideLink';

/**
 * A stranger asking for a ride, on the rider's phone.
 *
 * This is the moment the whole app exists to produce, and the only screen in Hitch where
 * somebody has to decide something in a few seconds while probably holding handlebars. So
 * it is a full-screen modal rather than a banner, it shows exactly the four facts the
 * decision turns on, and the two answers are the same size — a rider who is busy should
 * not have to hunt for Decline.
 *
 * The four facts, in the order they are asked about at a kerb: who, from where, to where,
 * and what it pays. Everything else the passenger sent is on the card underneath, because
 * a parcel changes the answer — a rider will take a document who would not take a carton.
 *
 * A countdown, because a request that sits open forever is worse for both people: the
 * passenger is staring at a spinner, and the rider is holding a decision they have already
 * effectively made by not making it. When it runs out the request declines itself, which
 * is what the passenger's own timeout is already expecting.
 */

const DECIDE_SECONDS = 30;

export function RideRequestCard({
  incoming,
  onAccept,
  onDecline,
}: {
  incoming: IncomingRequest | null;
  onAccept: () => void;
  onDecline: (why?: string) => void;
}) {
  const t = useT();
  const [left, setLeft] = useState(DECIDE_SECONDS);

  useEffect(() => {
    if (!incoming) {
      return;
    }
    setLeft(DECIDE_SECONDS);
    const tick = setInterval(() => {
      setLeft(current => {
        if (current <= 1) {
          clearInterval(tick);
          // Declines itself rather than expiring silently: the passenger is owed an
          // answer, and "no" now beats "maybe" for another minute.
          onDecline('No answer');
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // Keyed on the request id so a second request restarts the clock rather than
    // inheriting whatever was left of the first one's.
  }, [incoming?.request.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!incoming) {
    return null;
  }

  const {request} = incoming;
  const spec = vehicleSpec(request.kind);
  const parcel = request.parcel;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => onDecline()}>
      <View style={{flex: 1, backgroundColor: 'rgba(8,10,9,0.6)', justifyContent: 'flex-end'}}>
        <View
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.lg,
            gap: spacing.md,
          }}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <View style={{flex: 1}}>
              <T variant="overline" tone="accent">
                {parcel ? 'NEW PARCEL REQUEST' : 'NEW RIDE REQUEST'}
              </T>
            </View>
            {/* The clock is quiet until it is nearly out, then it is not. */}
            <T variant="label" tone={left <= 10 ? 'warn' : 'faint'}>
              {left}s
            </T>
          </View>

          <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: t.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <T style={{fontSize: 20}}>🧑</T>
            </View>
            <View style={{flex: 1}}>
              <T variant="title">{request.from}</T>
              <T variant="caption" tone="faint" style={{marginTop: 2}}>
                {spec.glyph} {spec.label} · about {request.km} km
              </T>
            </View>
          </View>

          <Divider />

          {/* Pickup above destination, joined the way a route reads. */}
          <View style={{gap: spacing.md, paddingVertical: spacing.xs}}>
            <Leg label="Pickup" value={request.pickup} dotColour={t.textFaint} />
            <Leg label="Destination" value={request.drop} dotColour={t.accent} />
          </View>

          {parcel ? (
            <Card>
              <T variant="overline" tone="faint">
                WHAT YOU WOULD BE CARRYING
              </T>
              <T variant="body" style={{marginTop: 6}}>
                {parcelSizeSpec(parcel.size).label} · {parcel.contents}
              </T>
              <T variant="caption" tone="dim" style={{marginTop: 4}}>
                For {parcel.receiver}. They give you a code at the door.
              </T>
            </Card>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}>
            <T variant="caption" tone="faint">
              ESTIMATED FARE
            </T>
            <T variant="display">₹{request.fare}</T>
          </View>
          <T variant="caption" tone="faint" style={{lineHeight: 16, marginTop: -6}}>
            The same estimate the passenger was shown. What you settle on is between you.
          </T>

          {/* Equal weight. A rider on a bike should not have to aim for the small one. */}
          <Button label="Accept" onPress={onAccept} />
          <Button label="Decline" kind="secondary" onPress={() => onDecline()} />
        </View>
      </View>
    </Modal>
  );
}

function Leg({
  label,
  value,
  dotColour,
}: {
  label: string;
  value: string;
  dotColour: string;
}) {
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.md}}>
      <View style={{width: 9, height: 9, borderRadius: 5, backgroundColor: dotColour}} />
      <View style={{flex: 1}}>
        <T variant="caption" tone="faint">
          {label}
        </T>
        <T variant="body" numberOfLines={1}>
          {value || 'Not given'}
        </T>
      </View>
    </View>
  );
}
