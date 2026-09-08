/**
 * Advertisement surfaces.
 *
 * These are RESERVED SPACE, not advertising. No ad SDK is wired up and no network
 * request is made; each format renders a placeholder creative at the exact size a
 * real one would occupy, so a provider can be dropped in later without the page
 * being redesigned around it. `placeholderAds` below is a fixture — the only
 * invented content in the store, and it is deliberately confined to this file.
 *
 * WHAT KEEPS AN AD FROM PASSING AS AN APP. Five signals, applied together:
 *
 *   1. Surface inversion — organic cards are `surface` + `border`; every ad flips
 *      to `surfaceRaised` + `borderStrong`.
 *   2. Reduced radius — a sponsored row is 14 where an organic row is 18; an ad
 *      logo tile is 10 where an app tile is 16-17.
 *   3. Monogram, never an emoji — advertisers get two mono letters on a fixed grey
 *      gradient that sits outside the theme, so an ad can never borrow an app's
 *      brand colour.
 *   4. Stripped metadata — no category chip, no usage figures, none of the meta a
 *      real listing carries.
 *   5. A different verb — organic CTAs say "Open" on the accent; ad CTAs say
 *      "Learn more" or "Visit", always outlined, never on the accent.
 *
 * Disclosure is always present and always outside the creative: a SPONSORED
 * eyebrow with an info affordance, plus a corner AD chip on the banner format.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Press } from '../components/Press';
import { layout, radius, space, type, type HubPalette } from '../theme';
import { InfoIcon } from './icons';

/** The advertiser monogram gradients. Raw hex on purpose — see note 3 above. */
const MONOGRAM_DARK = ['#4A5468', '#2C3345'] as const;
const MONOGRAM_LIGHT = ['#5A6478', '#343C4E'] as const;

export interface AdCreative {
  initials: string;
  title: string;
  body: string;
  cta: string;
  tone?: 'dark' | 'light';
}

/**
 * Placeholder inventory. Replace wholesale when a real provider is wired in;
 * nothing outside this file reads these.
 */
export const placeholderAds: Record<string, AdCreative> = {
  home: {
    initials: 'RC',
    title: 'Relay Cloud',
    body: 'Back up BLE session logs. 5 GB free.',
    cta: 'Learn more ›',
    tone: 'dark',
  },
  category: {
    initials: 'PT',
    title: 'PulseTag',
    body: 'Beacon hardware for indoor games',
    cta: 'Learn more ›',
    tone: 'light',
  },
  detail: {
    initials: 'GP',
    title: 'GridPad Controller',
    body: 'Bluetooth gamepad, 40 h battery',
    cta: 'Learn more ›',
    tone: 'dark',
  },
  native: {
    initials: 'NP',
    title: 'NoiseProbe',
    body: 'Field audio meter for site surveys',
    cta: 'Learn more',
    tone: 'light',
  },
  listing: {
    initials: 'MB',
    title: 'MeshBridge Pro',
    body: 'Route BLE traffic across sites',
    cta: 'Visit',
    tone: 'dark',
  },
};

/* ------------------------------------------------------------ disclosure -- */

interface LabelProps {
  theme: HubPalette;
  text?: string;
  /** The promo variant carries no info affordance. */
  info?: boolean;
  spread?: boolean;
}

export function SponsoredLabel({
  theme,
  text = 'SPONSORED',
  info = true,
  spread = false,
}: LabelProps): React.ReactElement {
  return (
    <View style={[styles.labelRow, spread ? styles.labelSpread : null]}>
      <Text style={[type.adLabel, { color: theme.textDim }]}>{text}</Text>
      {info ? <InfoIcon size={12} color={theme.textDim} strokeWidth={2.2} /> : null}
    </View>
  );
}

/* -------------------------------------------------------------- monogram -- */

function Monogram({ initials, size, tone }: { initials: string; size: number; tone: 'dark' | 'light' }) {
  return (
    <LinearGradient
      colors={[...(tone === 'light' ? MONOGRAM_LIGHT : MONOGRAM_DARK)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.monogram, { width: size, height: size }]}
    >
      <Text style={styles.monogramText}>{initials}</Text>
    </LinearGradient>
  );
}

/* -------------------------------------------------- 1. inline banner ad -- */

interface BannerProps {
  theme: HubPalette;
  creative: AdCreative;
  /** Detail inherits its gutter from the page column. */
  gutter?: boolean;
}

/**
 * The archetypal slot: a recessed tray framing a fixed 88px creative. The height
 * is fixed rather than intrinsic so an unfilled slot occupies the same box — the
 * layout must not move depending on whether a slot was sold.
 */
export function AdBanner({ theme, creative, gutter = true }: BannerProps): React.ReactElement {
  return (
    <View style={[gutter ? { paddingHorizontal: layout.gutter } : null, styles.slot]}>
      <SponsoredLabel theme={theme} />
      <View style={[styles.tray, { backgroundColor: theme.surfaceRaised }]}>
        <View style={[styles.creative, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Monogram initials={creative.initials} size={56} tone={creative.tone ?? 'dark'} />
          {/* paddingRight keeps a long title clear of the absolute AD chip. */}
          <View style={styles.creativeText}>
            <Text style={[styles.adTitle, { color: theme.text }]} numberOfLines={1}>
              {creative.title}
            </Text>
            <Text style={[styles.adBody, { color: theme.textDim }]}>{creative.body}</Text>
            <Text style={[styles.adCta, { color: theme.text }]}>{creative.cta}</Text>
          </View>
          <View style={[styles.adChip, { backgroundColor: theme.surfaceRaised }]}>
            <Text style={[styles.adChipText, { color: theme.textDim }]}>AD</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/* --------------------------------------------------- 2. native ad card -- */

/**
 * Shaped like the organic cards in the rail it sits in, so the rail scrolls
 * evenly — but re-skinned onto the recessed surface, given a tighter logo radius
 * and stripped of every piece of metadata its neighbours carry.
 */
export function AdNativeCard({
  theme,
  creative,
  width,
}: {
  theme: HubPalette;
  creative: AdCreative;
  width: number;
}): React.ReactElement {
  return (
    <View
      style={[
        styles.nativeCard,
        { width, backgroundColor: theme.surfaceRaised, borderColor: theme.borderStrong },
      ]}
    >
      <SponsoredLabel theme={theme} spread />
      <Monogram initials={creative.initials} size={58} tone={creative.tone ?? 'light'} />
      <View>
        <Text style={[styles.nativeTitle, { color: theme.text }]}>{creative.title}</Text>
        <Text style={[styles.nativeBody, { color: theme.textDim }]}>{creative.body}</Text>
      </View>
      <View style={[styles.outlineCta, { borderColor: theme.borderStrong, backgroundColor: theme.surface }]}>
        <Text style={[type.chip, { color: theme.text }]}>{creative.cta}</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------- 3. sponsored listing -- */

/** A full-width row interleaved into the A–Z list, demoted rather than disguised. */
export function AdSponsoredListing({
  theme,
  creative,
}: {
  theme: HubPalette;
  creative: AdCreative;
}): React.ReactElement {
  return (
    <View style={styles.listingSlot}>
      <SponsoredLabel theme={theme} />
      <View
        style={[
          styles.listing,
          { backgroundColor: theme.surfaceRaised, borderColor: theme.borderStrong },
        ]}
      >
        <Monogram initials={creative.initials} size={56} tone={creative.tone ?? 'dark'} />
        <View style={styles.listingText}>
          <Text style={[styles.listingTitle, { color: theme.text }]} numberOfLines={1}>
            {creative.title}
          </Text>
          <Text style={[styles.adBody, { color: theme.textDim }]}>{creative.body}</Text>
        </View>
        <View
          style={[
            styles.listingCta,
            { borderColor: theme.borderStrong, backgroundColor: theme.surface },
          ]}
        >
          <Text style={[type.buttonSm, { color: theme.text }]}>{creative.cta}</Text>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------- 4. full-width promo block -- */

/**
 * First-party house promotion. Labelled PROMOTED rather than SPONSORED because it
 * is the store talking about itself, and rendered on its own token so it never
 * reads as third-party inventory.
 */
export function AdPromoBlock({
  theme,
  onPress,
}: {
  theme: HubPalette;
  onPress?: () => void;
}): React.ReactElement {
  return (
    <View style={[styles.slotTight, { paddingHorizontal: layout.gutter }]}>
      <SponsoredLabel theme={theme} text="PROMOTED · FROM ANSI-APPS" info={false} />
      <View style={[styles.promo, { backgroundColor: theme.promo }]}>
        <View style={styles.promoBrand}>
          <View style={styles.promoMark}>
            <Text style={styles.promoMarkGlyph}>✦</Text>
          </View>
          <Text style={styles.promoWordmark}>ANSI-APPS</Text>
        </View>
        <View>
          <Text style={styles.promoHeadline}>Ship your own offline app</Text>
          <Text style={styles.promoBody}>
            Drop a folder in, add one registry entry, and it appears here with search, categories and a
            detail page already wired up.
          </Text>
        </View>
        <Press
          onPress={onPress}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel="Read the guide"
          containerStyle={styles.promoCtaAlign}
          style={styles.promoCta}
        >
          <Text style={styles.promoCtaLabel}>Read the guide</Text>
        </Press>
      </View>
    </View>
  );
}

/* ------------------------------------------------- 5. unfilled ad state -- */

/**
 * An unsold slot. Occupies exactly the 88px a filled creative would, which is the
 * whole point — the page must not reflow depending on fill rate.
 */
export function AdEmptySlot({
  theme,
  gutter = true,
}: {
  theme: HubPalette;
  gutter?: boolean;
}): React.ReactElement {
  return (
    <View style={[gutter ? { paddingHorizontal: layout.gutter } : null, styles.slot]}>
      <SponsoredLabel theme={theme} />
      <View style={[styles.tray, { backgroundColor: theme.surfaceRaised }]}>
        <View style={[styles.placeholder, { borderColor: theme.borderStrong }]}>
          <Text style={[styles.placeholderLabel, { color: theme.textDim }]}>Ad slot — 320 × 100</Text>
          <Text style={[styles.placeholderNote, { color: theme.textDim }]}>
            Unfilled: the slot holds its space, layout does not shift
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------ policy note ------ */

/** Not an ad. The Library states where sponsored placements are allowed to appear. */
export function AdPolicyNote({ theme }: { theme: HubPalette }): React.ReactElement {
  return (
    <View style={{ paddingHorizontal: layout.gutter }}>
      <View style={[styles.policy, { backgroundColor: theme.surfaceRaised }]}>
        <Text style={[styles.policyText, { color: theme.textDim }]}>
          No ads in Library. Sponsored placements appear only on Home, Explore, category listings and app
          details — never between your own apps.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { gap: space.sm },
  slotTight: { gap: space.x7 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.x6 },
  labelSpread: { justifyContent: 'space-between' },

  tray: { borderRadius: radius.card, padding: space.sm },
  creative: {
    position: 'relative',
    height: 88,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.x14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x14,
  },
  creativeText: { flex: 1, paddingRight: 34 },
  adTitle: { fontSize: 14, fontWeight: '800' },
  adBody: { fontSize: 12, fontWeight: '500', lineHeight: 16, marginTop: 2 },
  adCta: { fontSize: 12, fontWeight: '800', marginTop: space.x6 },
  adChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    height: 18,
    paddingHorizontal: space.x6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  monogram: { borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  monogramText: {
    fontFamily: 'monospace',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.5,
    color: '#FFFFFF',
  },

  nativeCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  nativeTitle: { fontSize: 14.5, fontWeight: '800' },
  nativeBody: { fontSize: 11.5, fontWeight: '500', lineHeight: 16, marginTop: 3 },
  outlineCta: {
    height: 44,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listingSlot: { gap: space.x7, paddingVertical: space.xs },
  listing: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.x14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x14,
  },
  listingText: { flex: 1 },
  listingTitle: { fontSize: 15, fontWeight: '800' },
  listingCta: {
    height: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  promo: { borderRadius: radius.lg, padding: space.x22, gap: space.x14 },
  promoBrand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  promoMark: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoMarkGlyph: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  promoWordmark: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255,255,255,0.72)' },
  promoHeadline: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, lineHeight: 24, color: '#FFFFFF' },
  promoBody: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    color: 'rgba(255,255,255,0.72)',
    marginTop: space.x6,
  },
  promoCtaAlign: { alignSelf: 'flex-start' },
  promoCta: {
    height: 44,
    paddingHorizontal: layout.gutter,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoCtaLabel: { fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' },

  placeholder: {
    height: 88,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  placeholderLabel: { fontSize: 12, fontWeight: '800' },
  placeholderNote: { fontSize: 11, fontWeight: '500', textAlign: 'center', paddingHorizontal: space.md },

  policy: { borderRadius: radius.field, paddingVertical: space.x14, paddingHorizontal: space.lg },
  policyText: { fontSize: 11.5, fontWeight: '600', lineHeight: 17 },
});
