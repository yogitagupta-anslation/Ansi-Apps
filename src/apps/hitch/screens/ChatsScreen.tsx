import React from 'react';
import {ScrollView, View} from 'react-native';

import {Card, Header, Row, Screen, T, useT} from '../components/ui/Kit';
import {spacing} from '../config/theme';
import {useHitch} from '../state/store';

/**
 * Conversations with the person you are riding with.
 *
 * PHASE 3, and this screen says so rather than pretending otherwise.
 *
 * The reason it is not built yet is worth stating plainly: BLE Chat in this same binary
 * already solves every hard part of it — queued messages that send themselves on
 * reconnect, delivery states driven by real transport events, link state in the header,
 * reconnection with backoff. A ride chat is that machinery pointed at one peer, with a
 * vehicle number in the header and four quick replies. Rebuilding it here from scratch
 * would produce a worse version of something that already works.
 *
 * So this screen shows what a conversation will look like and where it comes from, and
 * does not fake a message list. A stub that looks finished is how a prototype gets
 * mistaken for a product.
 */

const QUICK_REPLIES = ["I'm here", 'Where are you?', 'Please wait', 'Call me'];

export function ChatsScreen() {
  const t = useT();
  const history = useHitch(s => s.history);
  const ride = useHitch(s => s.ride);

  return (
    <Screen>
      <Header title="Chats" subtitle="Talk to the rider you matched with" />
      <ScrollView contentContainerStyle={{padding: spacing.lg, gap: spacing.lg}}>
        {ride?.rider ? (
          <Row
            glyph="💬"
            title={ride.rider.riderName}
            detail={`${ride.rider.vehicle.registration} · connected`}
            onPress={() => undefined}
          />
        ) : (
          <Card>
            <T variant="heading">No ride in progress</T>
            <T variant="caption" tone="dim" style={{marginTop: 6, lineHeight: 18}}>
              A conversation opens when you match with a rider, and closes itself when the
              ride is done. There is nobody to talk to until then.
            </T>
          </Card>
        )}

        <Card>
          <T variant="overline" tone="faint">
            COMING IN PHASE 3
          </T>
          <T variant="heading" style={{marginTop: 6}}>
            Chat runs on BLE Chat's engine
          </T>
          <T variant="caption" tone="dim" style={{marginTop: 8, lineHeight: 19}}>
            Rather than a second messaging stack, ride chat will reuse the one already in
            this app hub — the part that matters on a Bluetooth link is not the bubbles, it
            is what happens when the link drops halfway through a sentence.
          </T>

          <View style={{height: spacing.lg}} />
          {[
            ['Queued messages', 'Typed while out of range, sent when the link returns'],
            ['Real delivery states', 'Sent means a write completed; delivered means they acknowledged it'],
            ['Reconnection', 'A dropped link redials itself with backoff'],
            ['Link state in the header', 'Connected, reconnecting, or out of range — never guessed'],
          ].map(([title, body]) => (
            <View key={title} style={{flexDirection: 'row', gap: 10, marginBottom: 10}}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: t.accent,
                  marginTop: 7,
                }}
              />
              <View style={{flex: 1}}>
                <T variant="label">{title}</T>
                <T variant="caption" tone="faint" style={{marginTop: 1, lineHeight: 17}}>
                  {body}
                </T>
              </View>
            </View>
          ))}
        </Card>

        <Card>
          <T variant="overline" tone="faint">
            QUICK REPLIES PLANNED
          </T>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md}}>
            {QUICK_REPLIES.map(reply => (
              <View
                key={reply}
                style={{
                  paddingHorizontal: 13,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.border,
                }}>
                <T variant="caption" tone="dim">
                  {reply}
                </T>
              </View>
            ))}
          </View>
          <T variant="caption" tone="faint" style={{marginTop: spacing.md, lineHeight: 17}}>
            The four things people actually say while waiting at a kerb, one tap each.
          </T>
        </Card>

        {history.length > 0 ? (
          <View>
            <T variant="overline" tone="faint" style={{marginBottom: spacing.sm}}>
              PAST RIDERS
            </T>
            {history.slice(0, 5).map(entry => (
              <Row
                key={entry.id}
                glyph="🕘"
                title={entry.riderName}
                detail={`${entry.fromLabel} → ${entry.toLabel}`}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
