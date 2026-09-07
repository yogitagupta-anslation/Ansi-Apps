import React from 'react';
import {View, type ViewStyle} from 'react-native';
import {elevation, radius, spacing, typography} from '../../config/theme';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';
import {AppText, DenseText} from '../AppText';
import {Touchable} from '../Motion';

/**
 * The layout vocabulary: one card, one section header, one button, one row.
 *
 * Every screen is built from these rather than from ad-hoc Views, which is what stops the
 * eight screens drifting into eight slightly different visual languages. Adding a variant
 * here is cheap; inventing a one-off card inside a screen is how that drift starts.
 */

// ---------------------------------------------------------------------- card

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Flat cards sit inside another surface and skip the shadow. */
  flat?: boolean;
  padded?: boolean;
}

export function Card({children, style, flat, padded = true}: CardProps) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        padded && styles.cardPadded,
        flat ? null : elevation(theme, 1),
        style,
      ]}>
      {children}
    </View>
  );
}

// ------------------------------------------------------------- section header

/**
 * An overline label, optionally with one action on the right.
 *
 * All-caps and small: a section header should organise the page without competing with
 * the content under it for attention.
 */
export function SectionHeader({
  title,
  action,
  onAction,
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.sectionHeader, style]}>
      <DenseText style={styles.sectionTitle}>{title}</DenseText>
      <View style={styles.grow} />
      {action && onAction ? (
        <Touchable onPress={onAction} scale={false} accessibilityRole="button">
          <DenseText style={styles.sectionAction}>{action}</DenseText>
        </Touchable>
      ) : null}
    </View>
  );
}

// -------------------------------------------------------------------- button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  compact,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  compact?: boolean;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  return (
    <Touchable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      style={[
        styles.button,
        compact ? styles.buttonCompact : null,
        VARIANT_STYLE[variant](styles),
        disabled ? styles.buttonDisabled : null,
        style,
      ] as ViewStyle[]}>
      <AppText
        style={[styles.buttonLabel, VARIANT_LABEL[variant](styles)]}
        numberOfLines={1}>
        {label}
      </AppText>
    </Touchable>
  );
}

type Styles = ReturnType<typeof useStyles>;
const VARIANT_STYLE: Record<ButtonVariant, (s: Styles) => ViewStyle> = {
  primary: s => s.buttonPrimary,
  secondary: s => s.buttonSecondary,
  ghost: s => s.buttonGhost,
  danger: s => s.buttonDanger,
};
const VARIANT_LABEL: Record<ButtonVariant, (s: Styles) => object> = {
  primary: s => s.buttonLabelPrimary,
  secondary: s => s.buttonLabelSecondary,
  ghost: s => s.buttonLabelGhost,
  danger: s => s.buttonLabelDanger,
};

// ----------------------------------------------------------------- empty state

/**
 * What an empty list says.
 *
 * Given its own component because "nothing here" is a state the user will meet often in
 * this app — an empty room is the normal case — and it deserves an explanation rather
 * than blank space.
 */
export function EmptyState({
  glyph,
  title,
  detail,
}: {
  glyph: string;
  title: string;
  detail?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyGlyphWrap}>
        <AppText style={styles.emptyGlyph}>{glyph}</AppText>
      </View>
      <AppText style={styles.emptyTitle}>{title}</AppText>
      {detail ? <DenseText style={styles.emptyDetail}>{detail}</DenseText> : null}
    </View>
  );
}

// --------------------------------------------------------------------- badge

export function Badge({
  label,
  tone,
  soft,
}: {
  label: string;
  tone?: string;
  soft?: boolean;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const color = tone ?? theme.textDim;
  return (
    <View
      style={[
        styles.badge,
        soft ? styles.badgeSoft : null,
        soft ? {backgroundColor: color + '1f'} : {borderColor: color},
      ]}>
      <DenseText style={[styles.badgeText, {color}]} numberOfLines={1}>
        {label}
      </DenseText>
    </View>
  );
}

// ------------------------------------------------------------------ key value

/** A label on the left, a value on the right. Used for every settings-style row. */
export function KeyValue({
  label,
  value,
  valueColor,
  mono,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.kv}>
      <DenseText style={styles.kvLabel} numberOfLines={1}>
        {label}
      </DenseText>
      <View style={styles.grow} />
      <DenseText
        style={[
          styles.kvValue,
          mono ? styles.kvMono : null,
          valueColor ? {color: valueColor} : null,
        ]}
        numberOfLines={1}>
        {value}
      </DenseText>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  grow: {flex: 1},

  // A card marks a real boundary — a tappable group, an overlay. It was being used as a
  // container for prose, for helper text and for single rows, which is how a screen ends
  // up with nine stacked outlines and an eye that reads borders instead of content.
  // Grouping is space and a hairline now; what is left keeps the fill but drops the
  // outline, so it still reads as a group without drawing one.
  card: {
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.lg,
  },
  cardPadded: {padding: spacing.lg},

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {...typography.overline, color: t.textDim},
  sectionAction: {...typography.callout, color: t.accent},

  button: {
    borderRadius: radius.pill,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonCompact: {paddingVertical: 7, paddingHorizontal: spacing.md},
  buttonPrimary: {backgroundColor: t.accent, borderColor: t.accent},
  buttonSecondary: {backgroundColor: 'transparent', borderColor: t.border},
  buttonGhost: {backgroundColor: 'transparent', borderColor: 'transparent'},
  buttonDanger: {backgroundColor: 'transparent', borderColor: t.error},
  buttonDisabled: {
    backgroundColor: t.surfaceAlt,
    borderColor: 'transparent',
    opacity: 0.6,
  },
  buttonLabel: {...typography.body, fontWeight: '500'},
  buttonLabelPrimary: {color: t.onAccent},
  buttonLabelSecondary: {color: t.text},
  buttonLabelGhost: {color: t.accent},
  buttonLabelDanger: {color: t.error},

  empty: {alignItems: 'center', paddingVertical: spacing.xl * 2},
  // No tinted disc behind the glyph. An empty state is already the quietest thing on a
  // screen; giving its icon a filled circle made the absence look like a component.
  emptyGlyphWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyGlyph: {fontSize: 26, color: t.textFaint},
  emptyTitle: {...typography.title, color: t.text},
  emptyDetail: {
    ...typography.body,
    color: t.textDim,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 280,
  },

  badgeSoft: {borderColor: 'transparent'},
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
  },
  badgeText: {...typography.caption, fontWeight: '600'},

  kv: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm},
  kvLabel: {...typography.callout, color: t.textDim},
  kvValue: {...typography.callout, color: t.text, flexShrink: 1},
  kvMono: {...typography.monoSmall},
}));
