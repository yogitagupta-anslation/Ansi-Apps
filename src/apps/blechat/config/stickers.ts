import type {ImageSourcePropType} from 'react-native';

/**
 * The sticker set.
 *
 * PLACEHOLDER ART. These ten are OpenMoji (openmoji.org), CC BY-SA 4.0, and they are here
 * so the feature is real and testable rather than mocked — the branding team's set drops
 * straight into `assets/stickers/` and replaces the `source` lines below. Nothing else in
 * the app needs to change: everything downstream addresses a sticker by `id`.
 *
 * WHAT GOES ON THE WIRE, and why it is not the picture.
 *
 * A sticker is sent as its `emoji`, in the text of an ordinary message. Not the PNG. On a
 * BLE link the usable payload is around 500 bytes per write, so a 20 KB sticker is forty
 * writes and several seconds of radio for a thumbs-up — while the emoji is four bytes and
 * needs no protocol change at all. The receiver looks the codepoint up in this table and
 * draws our art for it; a phone without this build, or with a sticker it does not know,
 * simply shows the emoji. That is a real fallback rather than a broken one, which is the
 * whole reason to carry meaning rather than pixels.
 *
 * It also means a sticker survives everything a text message survives — the outbox, a
 * reconnect, search, Send Later — with no special handling anywhere.
 */
export interface Sticker {
  id: string;
  /** What actually travels, and what a phone without this build will render. */
  emoji: string;
  /** Read aloud by a screen reader in place of the image. */
  label: string;
  source: ImageSourcePropType;
}

export const STICKERS: readonly Sticker[] = [
  {id: 'wave', emoji: '👋', label: 'Waving hand', source: require('../assets/stickers/wave.png')},
  {id: 'thumbsup', emoji: '👍', label: 'Thumbs up', source: require('../assets/stickers/thumbsup.png')},
  {id: 'ok', emoji: '👌', label: 'OK hand', source: require('../assets/stickers/ok.png')},
  {id: 'laugh', emoji: '😂', label: 'Laughing', source: require('../assets/stickers/laugh.png')},
  {id: 'heart', emoji: '❤️', label: 'Red heart', source: require('../assets/stickers/heart.png')},
  {id: 'fire', emoji: '🔥', label: 'Fire', source: require('../assets/stickers/fire.png')},
  {id: 'party', emoji: '🎉', label: 'Party popper', source: require('../assets/stickers/party.png')},
  {id: 'thinking', emoji: '🤔', label: 'Thinking', source: require('../assets/stickers/thinking.png')},
  {id: 'coffee', emoji: '☕', label: 'Coffee', source: require('../assets/stickers/coffee.png')},
  {id: 'cry', emoji: '😭', label: 'Crying', source: require('../assets/stickers/cry.png')},
];

/**
 * Variation selectors and skin-tone modifiers are stripped before matching.
 *
 * "❤️" is U+2764 followed by U+FE0F, and the same heart arrives from other keyboards
 * without the selector. Matching the raw string would draw our art for one and not the
 * other, in the same conversation.
 */
function normalise(text: string): string {
  return text.replace(/[︎️]/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '').trim();
}

/**
 * The sticker a message is, or null if it is an ordinary message.
 *
 * A message counts as a sticker only when it is EXACTLY one known emoji and nothing else.
 * "👍 thanks" is a sentence with an emoji in it and must stay a sentence — promoting it
 * to a 96px picture would lose the words.
 */
export function stickerFor(text: string): Sticker | null {
  const clean = normalise(text);
  if (!clean || clean.length > 8) {
    return null;
  }
  return STICKERS.find(s => normalise(s.emoji) === clean) ?? null;
}

/** Attribution the licence requires, shown in the picker. */
export const STICKER_CREDIT = 'Placeholder art: OpenMoji, CC BY-SA 4.0';
