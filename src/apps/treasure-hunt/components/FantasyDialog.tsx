import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {alpha, colors, spacing, typography} from '../theme';
import {FantasyPanel, type PanelTone} from './FantasyPanel';
import {GameButton, type ButtonTone} from './GameButton';

export interface DialogAction {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  icon?: string;
}

interface Props {
  visible: boolean;
  title: string;
  /** Large glyph in the crest above the panel. */
  crest?: string;
  message?: string;
  tone?: PanelTone;
  actions?: DialogAction[];
  /** Tapping the scrim dismisses. Omit to force a choice. */
  onDismiss?: () => void;
  children?: React.ReactNode;
}

/**
 * A framed fantasy popup.
 *
 * Deliberately NOT a native `Modal`: mounting a second Fabric root mid-frame
 * crashed with "View already has a parent" on this RN version. This renders in
 * place, absolutely filling its parent, and stays mounted while animating out.
 */
export function FantasyDialog({
  visible,
  title,
  crest,
  message,
  tone = 'gold',
  actions,
  onDismiss,
  children,
}: Props) {
  const anim = useRef(new Animated.Value(0)).current;
  // Kept mounted for one extra beat so the exit animation can play.
  const [mounted, setMounted] = React.useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 140,
      easing: visible ? Easing.out(Easing.back(1.4)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
  }, [visible, anim]);

  if (!mounted) {
    return null;
  }

  return (
    // Same reason as the game stage: this node toggles pointerEvents as it
    // animates, which flips whether Fabric keeps a real view for it, and
    // re-parenting its children mid-animation is fatal.
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={visible ? 'auto' : 'none'}
      collapsable={false}>
      <Animated.View style={[styles.scrim, {opacity: anim}]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          disabled={!onDismiss}
        />
      </Animated.View>

      <View style={styles.centre} pointerEvents="box-none">
        <Animated.View
          style={{
            opacity: anim,
            transform: [
              {
                scale: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.88, 1],
                }),
              },
            ],
          }}>
          <FantasyPanel
            tone={tone}
            padded={false}
            style={[styles.panel, crest && styles.panelCrested]}>
            {/* The crest rides the top rim. It is laid out in flow with a
                negative margin rather than positioned absolutely: Yoga anchors
                absolute children to the padding box, so a negative `top` would
                land inside the panel instead of above it. */}
            {crest ? (
              <View style={styles.crest}>
                <Text style={styles.crestGlyph}>{crest}</Text>
              </View>
            ) : null}

            <View style={styles.body}>
              <Text style={styles.title}>{title.toUpperCase()}</Text>
              {message ? <Text style={styles.message}>{message}</Text> : null}
              {children}
            </View>

            {actions && actions.length > 0 ? (
              <View style={styles.actions}>
                {actions.map(action => (
                  <GameButton
                    key={action.label}
                    label={action.label}
                    icon={action.icon}
                    tone={action.tone ?? 'dark'}
                    onPress={action.onPress}
                    style={styles.action}
                  />
                ))}
              </View>
            ) : null}
          </FantasyPanel>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: alpha(colors.abyss, 0.82),
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  panel: {
    width: 320,
    maxWidth: '100%',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  /** Room above for the medallion that overhangs the rim. */
  panelCrested: {
    marginTop: 40,
  },
  crest: {
    marginTop: -40,
    marginBottom: spacing.sm,
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.night,
    borderWidth: 2,
    borderColor: colors.frameGold,
  },
  crestGlyph: {
    fontSize: 20,
  },
  body: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  title: {
    ...typography.sectionLabel,
    fontSize: 14,
    letterSpacing: 1.4,
    color: colors.gold,
    textAlign: 'center',
  },
  message: {
    ...typography.bodyMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  action: {
    flex: 1,
  },
});
