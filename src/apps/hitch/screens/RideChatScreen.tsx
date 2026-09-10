import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import {Button, Screen, T, useT} from '../components/ui/Kit';
import {vehicleSpec} from '../config/catalogue';
import {radius, spacing, type as typeScale} from '../config/theme';
import {QUICK_REPLIES, RideChat} from '../services/rideChat';
import type {ChatMessage} from '../../blechat/types/Message';
import type {Ride} from '../types';

/**
 * Talking to the person coming to collect you.
 *
 * This is a chat with a job, and the job is finishing in about ninety seconds: two people
 * are trying to find each other at a kerb. Everything here follows from that.
 *
 * THE HEADER IS THE VEHICLE, not the person. "Rahul" is who you are talking to, but
 * "🛺 HR 30 JN 8646" is what you are scanning the road for — so the registration is the
 * line in the largest type, and the connection state sits under it because a message that
 * is not going anywhere is the other thing worth knowing while you stand there.
 *
 * QUICK ACTIONS ARE THE POINT, not a convenience. The person tapping is holding a bag,
 * wearing a helmet, or looking up and down a road. Three phrases cover most of what gets
 * said, and Call is beside them because it is where somebody reaches when typing has
 * stopped working.
 *
 * Delivery states come from BLE Chat's model and mean what they mean there: a tick when
 * the write completed on this phone, two when the other phone acknowledged it. On a link
 * that drops between two people fifty metres apart, that difference is the whole reason
 * anybody trusts the screen.
 */

export function RideChatScreen({
  ride,
  chat,
  onBack,
}: {
  ride: Ride;
  chat: RideChat;
  onBack: () => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>(chat.getMessages());
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(chat.isConnected);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => {
    // The service owns the conversation; this screen only renders it. Re-reading the
    // connection flag on every emission keeps the header honest without a second channel.
    return chat.subscribe(next => {
      setMessages(next);
      setConnected(chat.isConnected);
    });
  }, [chat]);

  const rider = ride.rider;
  const spec = vehicleSpec(ride.kind);
  const queued = chat.queuedCount;

  const send = (text: string) => {
    void chat.post(text);
    setDraft('');
  };

  const grouped = useMemo(
    () => [...messages].sort((a, b) => a.receivedAt - b.receivedAt),
    [messages],
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* ---- the vehicle, then the link ---- */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: t.divider,
          }}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <T variant="title" tone="dim">
              ‹
            </T>
          </Pressable>
          <View style={{flex: 1}}>
            <T variant="heading" numberOfLines={1}>
              {spec.glyph} {spec.label}
              {rider?.vehicle.registration ? ` · ${rider.vehicle.registration}` : ''}
            </T>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3}}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: connected ? t.ok : t.warn,
                }}
              />
              <T variant="caption" tone={connected ? 'ok' : 'warn'}>
                {connected ? 'Bluetooth connected' : 'Reconnecting'}
              </T>
              {rider?.riderName ? (
                <T variant="caption" tone="faint">
                  · {rider.riderName}
                </T>
              ) : null}
            </View>
          </View>
        </View>

        {/* ---- the conversation ---- */}
        <ScrollView
          ref={listRef}
          contentContainerStyle={{padding: spacing.lg, gap: spacing.sm}}
          onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}>
          {grouped.length === 0 ? (
            <View style={{alignItems: 'center', paddingVertical: spacing.xxl}}>
              <T variant="heading">Finding each other</T>
              <T
                variant="caption"
                tone="dim"
                style={{marginTop: 6, textAlign: 'center', lineHeight: 18}}>
                Messages go straight to {rider?.riderName ?? 'them'} over Bluetooth. Tap one
                below rather than typing — it is quicker at a kerb.
              </T>
            </View>
          ) : (
            grouped.map(message => <Bubble key={message.id} message={message} />)
          )}
        </ScrollView>

        {/* ---- quick actions ---- */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
          }}>
          {QUICK_REPLIES.map(reply => (
            <Pressable
              key={reply}
              onPress={() => send(reply)}
              accessibilityRole="button"
              accessibilityLabel={`Send "${reply}"`}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: t.accent,
              }}>
              <T variant="label" tone="accent">
                {reply}
              </T>
            </Pressable>
          ))}
          {/* Not a message. The way out when typing has stopped working. */}
          <Pressable
            onPress={() => {
              const number = ride.parcel?.receiverPhone ?? '';
              if (number) {
                void Linking.openURL(`tel:${number}`);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Call"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: radius.pill,
              backgroundColor: t.surfaceAlt,
            }}>
            <T style={{fontSize: 13}}>📞</T>
            <T variant="label" tone="dim">
              Call
            </T>
          </Pressable>
        </ScrollView>

        {queued > 0 ? (
          <T
            variant="caption"
            tone="warn"
            style={{paddingHorizontal: spacing.lg, paddingBottom: 6}}>
            {queued} waiting — {queued === 1 ? 'it goes' : 'they go'} out when the link is
            back.
          </T>
        ) : null}

        {/* ---- composer ---- */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: spacing.lg,
            borderTopWidth: 1,
            borderTopColor: t.divider,
          }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              connected ? 'Message' : 'Message — sends when the link is back'
            }
            placeholderTextColor={t.textFaint}
            multiline
            maxLength={280}
            accessibilityLabel="Message"
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 110,
              color: t.text,
              ...typeScale.body,
            }}
          />
          <Pressable
            onPress={() => draft.trim() && send(draft)}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: draft.trim() ? t.accent : t.surfaceAlt,
            }}>
            <T
              variant="heading"
              tone={draft.trim() ? 'onAccent' : 'faint'}
              style={{marginTop: -2}}>
              ↑
            </T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Sent means it left this phone. Delivered means theirs said it has it. */
const RECEIPT: Partial<Record<ChatMessage['status'], string>> = {
  pending: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  received: 'Delivered',
  failed: 'Not sent',
};

function Bubble({message}: {message: ChatMessage}) {
  const t = useT();
  const mine = message.direction === 'outgoing';
  const waiting = message.status === 'pending' || message.status === 'failed';

  return (
    <View style={{alignItems: mine ? 'flex-end' : 'flex-start'}}>
      <View
        style={{
          maxWidth: '82%',
          paddingHorizontal: 13,
          paddingVertical: 9,
          borderRadius: radius.lg,
          backgroundColor: mine ? (waiting ? 'transparent' : t.accent) : t.surfaceAlt,
          borderWidth: waiting && mine ? 1.5 : 0,
          borderColor: message.status === 'failed' ? t.error : t.border,
          borderStyle: waiting && mine ? 'dashed' : 'solid',
          borderBottomRightRadius: mine ? radius.sm : radius.lg,
          borderBottomLeftRadius: mine ? radius.lg : radius.sm,
        }}>
        <T
          variant="body"
          style={{color: mine && !waiting ? t.onAccent : t.text}}>
          {message.text}
        </T>
      </View>
      {mine ? (
        <T variant="caption" tone={message.status === 'failed' ? 'error' : 'faint'} style={{marginTop: 2}}>
          {RECEIPT[message.status] ?? ''}
        </T>
      ) : null}
    </View>
  );
}
