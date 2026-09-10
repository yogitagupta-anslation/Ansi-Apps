import React, {useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';

import {Button, Card, Divider, Field, T, useT} from './ui/Kit';
import {PARCEL_SIZES, PROHIBITED, handoverCode, type ParcelSize} from '../config/parcel';
import {radius, spacing} from '../config/theme';
import type {ParcelDetails} from '../types';

/**
 * What a parcel needs that a ride does not.
 *
 * Four questions, in the order they matter to the person who ends up carrying the bag:
 * how big is it, what is in it, who is receiving it, and is it something a rider is
 * allowed to take. Everything here is a consequence of the third person in the
 * transaction — the receiver, who is not holding a phone in this conversation and quite
 * possibly does not have the app.
 *
 * The prohibited-items confirmation is a real gate rather than a pre-ticked box. Uber
 * Connect makes it an explicit agreement before a request can be sent, and it is the one
 * screen in a courier flow that genuinely should not be skippable: the rider is the person
 * who gets stopped with whatever is in the bag, and they are trusting a stranger's word
 * about it. Two seconds of thinking is the entire point.
 */
export function ParcelForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (details: ParcelDetails) => void;
}) {
  const t = useT();
  const [size, setSize] = useState<ParcelSize>('small');
  const [contents, setContents] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  // The receiver's name and number are the hard requirement. A rider arriving at an
  // address with nobody to ask for is the failure mode this prevents, and it is why all
  // three of the apps this follows make them mandatory rather than optional.
  const ready =
    contents.trim().length >= 2 &&
    receiverName.trim().length >= 2 &&
    receiverPhone.trim().length >= 6 &&
    confirmed;

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <View style={{padding: spacing.lg, gap: spacing.lg}}>
        <View>
          <T variant="heading">What are you sending?</T>
          <T variant="caption" tone="dim" style={{marginTop: 2}}>
            The rider sees this before they accept.
          </T>
        </View>

        {/* Size first: it decides which vehicles are even offered. */}
        <View style={{gap: spacing.sm}}>
          {PARCEL_SIZES.map(spec => {
            const on = size === spec.id;
            return (
              <Pressable
                key={spec.id}
                onPress={() => setSize(spec.id)}
                accessibilityRole="radio"
                accessibilityState={{selected: on}}
                accessibilityLabel={`${spec.label}. ${spec.example}. Up to ${spec.maxKg} kilograms`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: radius.lg,
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? t.accent : t.border,
                  backgroundColor: on ? t.accentSoft : t.surface,
                }}>
                <T style={{fontSize: 22}}>{spec.glyph}</T>
                <View style={{flex: 1}}>
                  <T variant="body">{spec.label}</T>
                  <T variant="caption" tone="faint" style={{marginTop: 1}}>
                    {spec.example}
                  </T>
                </View>
                <T variant="caption" tone="dim">
                  up to {spec.maxKg} kg
                </T>
              </Pressable>
            );
          })}
        </View>

        <Field
          label="What's inside"
          value={contents}
          onChangeText={setContents}
          placeholder="Documents, a tiffin, a charger"
          hint="Plain words are fine. The rider is carrying it, so they should know."
        />

        <Divider />

        <View>
          <T variant="heading">Who is receiving it?</T>
          <T variant="caption" tone="dim" style={{marginTop: 2}}>
            They do not need Hitch — the rider will call them at the door.
          </T>
        </View>

        <Field
          label="Receiver's name"
          value={receiverName}
          onChangeText={setReceiverName}
          placeholder="Who to ask for"
          autoCapitalize="words"
        />
        <Field
          label="Receiver's phone"
          value={receiverPhone}
          onChangeText={setReceiverPhone}
          placeholder="For the rider to call"
          keyboardType="phone-pad"
          maxLength={14}
          hint="Given to the rider once one accepts, and to nobody else."
        />

        <Divider />

        {/* Not pre-ticked, and not buried in terms. */}
        <Card>
          <T variant="overline" tone="faint">
            BEFORE YOU SEND
          </T>
          <T variant="caption" tone="dim" style={{marginTop: 8, lineHeight: 18}}>
            A rider is putting this on their own vehicle. Please don't send:
          </T>
          <View style={{marginTop: spacing.md, gap: 6}}>
            {PROHIBITED.map(item => (
              <View key={item} style={{flexDirection: 'row', gap: 8}}>
                <T variant="caption" tone="faint">
                  ·
                </T>
                <T variant="caption" tone="dim" style={{flex: 1, lineHeight: 17}}>
                  {item}
                </T>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => setConfirmed(v => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{checked: confirmed}}
            accessibilityLabel="My parcel contains none of these"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: spacing.lg,
            }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                borderWidth: confirmed ? 0 : 1.5,
                borderColor: t.border,
                backgroundColor: confirmed ? t.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {confirmed ? (
                <T variant="label" tone="onAccent">
                  ✓
                </T>
              ) : null}
            </View>
            <T variant="label" style={{flex: 1}}>
              My parcel contains none of these
            </T>
          </Pressable>
        </Card>

        <Button
          label="Choose a vehicle"
          disabled={!ready}
          onPress={() =>
            onDone({
              contents: contents.trim(),
              size,
              receiverName: receiverName.trim(),
              receiverPhone: receiverPhone.trim(),
              // Minted here, at booking, so it can be shown to the sender the moment a
              // rider accepts — there is no server to ask for one later.
              handoverCode: handoverCode(),
              confirmedAllowed: true,
            })
          }
        />
        <Button label="Back" kind="ghost" onPress={onCancel} />
      </View>
    </ScrollView>
  );
}
