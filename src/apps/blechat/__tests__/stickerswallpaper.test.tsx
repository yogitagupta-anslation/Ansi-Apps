/**
 * Stickers, wallpapers, and the screenshot rule.
 *
 * Three features whose correctness lives in different places:
 *
 *  - A sticker is a message whose text is one emoji. The thing worth asserting is what
 *    does NOT become a sticker, because promoting "👍 thanks" to a 96px picture would
 *    silently drop the word.
 *  - A wallpaper's whole promise is legibility, so its palette is checked here against
 *    the same WCAG thresholds it was derived under. If somebody swaps an image and
 *    forgets to re-derive the row, this fails rather than shipping unreadable text.
 *  - The screenshot rule is one line of logic and the entire point of the feature: the
 *    stricter of the two sides wins, and silence is never permission.
 */
import {CHAT_WALLPAPERS, wallpaperById} from '../config/wallpapers';
import {STICKERS, stickerFor} from '../config/stickers';
import {isTheirRule, parsePolicy, resolvePolicy} from '../security/ScreenPolicy';

describe('what counts as a sticker', () => {
  it('recognises every sticker in the set by its emoji', () => {
    for (const sticker of STICKERS) {
      expect(stickerFor(sticker.emoji)?.id).toBe(sticker.id);
    }
  });

  it('matches with or without the variation selector', () => {
    // "❤️" is U+2764 U+FE0F, and the same heart arrives bare from other keyboards. One
    // conversation must not show our art for one and the system font for the other.
    expect(stickerFor('❤️')?.id).toBe('heart');
    expect(stickerFor('❤')?.id).toBe('heart');
  });

  it('leaves a sentence with an emoji in it as a sentence', () => {
    expect(stickerFor('👍 thanks')).toBeNull();
    expect(stickerFor('thanks 👍')).toBeNull();
    expect(stickerFor('are you coming?')).toBeNull();
    expect(stickerFor('')).toBeNull();
  });

  it('ignores surrounding whitespace, which is what a paste leaves behind', () => {
    expect(stickerFor('  👋  ')?.id).toBe('wave');
  });

  it('does not claim an emoji it has no art for', () => {
    expect(stickerFor('🦑')).toBeNull();
  });
});

/** WCAG relative luminance, so the assertion is the real thing rather than a proxy. */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const parts = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = parts.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('every wallpaper stays readable', () => {
  it('ships ten of them plus the plain background', () => {
    expect(CHAT_WALLPAPERS).toHaveLength(10);
    expect(wallpaperById(null)).toBeNull();
    expect(wallpaperById('nonsense')).toBeNull();
    expect(wallpaperById('linen')?.name).toBe('Linen');
  });

  it('puts body text on its bubble at AA or better', () => {
    for (const paper of CHAT_WALLPAPERS) {
      // Incoming text is the derived ink on the derived incoming bubble.
      expect(contrast(paper.ink, paper.bubbleIn)).toBeGreaterThanOrEqual(4.5);
      // Outgoing text is white on the chosen accent, which is why the accent is chosen
      // from a fixed list rather than sampled from the photo.
      expect(contrast('#FFFFFF', paper.bubbleOut)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the meta tier legible against its own ink', () => {
    for (const paper of CHAT_WALLPAPERS) {
      // Timestamps and day dividers are dimmer than body text by design, but they still
      // have to sit on the same ground — so they must not collapse into it.
      expect(contrast(paper.meta, paper.bubbleIn)).toBeGreaterThanOrEqual(3);
    }
  });

  it('states a scrim strong enough to be doing something', () => {
    for (const paper of CHAT_WALLPAPERS) {
      expect(paper.scrimOpacity).toBeGreaterThan(0);
      expect(paper.scrimOpacity).toBeLessThanOrEqual(0.9);
    }
  });

  it('gives light wallpapers dark ink and dark ones light ink', () => {
    for (const paper of CHAT_WALLPAPERS) {
      const inkIsLight = luminance(paper.ink) > 0.5;
      expect(inkIsLight).toBe(paper.dark);
    }
  });
});

describe('the screenshot rule', () => {
  it('takes the stricter of the two sides', () => {
    expect(resolvePolicy('allowed', 'notAllowed')).toBe('notAllowed');
    expect(resolvePolicy('notAllowed', 'allowed')).toBe('notAllowed');
    expect(resolvePolicy('allowed', 'notify')).toBe('notify');
    expect(resolvePolicy('notify', 'allowed')).toBe('notify');
    expect(resolvePolicy('notify', 'notAllowed')).toBe('notAllowed');
  });

  it('never lets the other phone loosen your own choice', () => {
    // The whole feature: "if one has not allowed, it remains not allowed."
    expect(resolvePolicy('notAllowed', 'allowed')).toBe('notAllowed');
    expect(resolvePolicy('notify', 'allowed')).toBe('notify');
  });

  it('treats silence as no opinion, not as permission', () => {
    // An older build sends no field at all. It cannot enforce anything either way, so our
    // own choice stands alone — it is never read as them saying "allowed".
    expect(resolvePolicy('notAllowed', null)).toBe('notAllowed');
    expect(resolvePolicy('notify', undefined)).toBe('notify');
    expect(resolvePolicy('allowed', null)).toBe('allowed');
  });

  it('knows when the stricter rule is theirs, so the UI can say so', () => {
    expect(isTheirRule('allowed', 'notAllowed')).toBe(true);
    expect(isTheirRule('notAllowed', 'allowed')).toBe(false);
    expect(isTheirRule('allowed', null)).toBe(false);
  });

  it('refuses anything off the wire it does not recognise', () => {
    // Every byte of this came from another phone.
    expect(parsePolicy('notAllowed')).toBe('notAllowed');
    expect(parsePolicy('whatever')).toBeNull();
    expect(parsePolicy(42)).toBeNull();
    expect(parsePolicy(undefined)).toBeNull();
    expect(parsePolicy({})).toBeNull();
  });
});
