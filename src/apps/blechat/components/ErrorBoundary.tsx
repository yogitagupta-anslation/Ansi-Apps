import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {darkTheme} from '../config/theme';
import {logger} from '../utils/logger';
import {saveCrash} from '../utils/crashLog';

interface Props {
  children: React.ReactNode;
  /**
   * Where "Go back" leads, when this boundary guards one screen rather than the app.
   *
   * A boundary around the whole navigator can only offer "try again", because there is
   * nowhere else to be. A boundary around a single screen can put the user back where
   * they came from, which is the difference between a dead end and a stumble.
   */
  onBack?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * "The app closes itself" — from React's point of view that is usually one of two things:
 * a render-phase exception (this is the one React itself can catch) or a fatal JS
 * exception outside of any render (handled separately, see `installGlobalErrorHandler` in
 * App.tsx). In a release build neither shows the red screen a dev build gets; the whole JS
 * instance just terminates, which looks to a user exactly like the app crashing.
 *
 * This does not know or claim to fix WHY something threw — a bug this catches is still a
 * real bug elsewhere, now logged instead of silent. What it changes is the failure mode:
 * one screen's worth of content is replaced with a message and a way back, instead of the
 * whole app disappearing with no explanation.
 *
 * Deliberately built on plain RN primitives and a hardcoded palette rather than this
 * app's own themed components — if something in app state or the theme context is what
 * broke, the one screen whose job is to recover from that cannot afford to depend on it.
 *
 * No native crash — a fault in the BLE stack itself, the other side of the JS bridge —
 * can be caught here. That failure mode is real and this component cannot see it.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {error: null};
  }

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      logger.error('App', `render crash: ${error.message}\n${info.componentStack ?? ''}`);
      saveCrash('render', error, info.componentStack ?? undefined);
    } catch {
      // The logger itself depending on broken state is exactly the case this must survive.
    }
  }

  private reset = (): void => {
    this.setState({error: null});
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <CrashScreen
          error={this.state.error}
          onReset={this.reset}
          onBack={this.props.onBack}
        />
      );
    }
    return this.props.children;
  }
}

function CrashScreen({
  error,
  onReset,
  onBack,
}: {
  error: Error;
  onReset: () => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.safe}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.subtitle}>
        This screen hit an error and couldn't continue. Nothing else was touched — your
        conversations and settings are still there.
      </Text>
      <ScrollView style={styles.detailBox}>
        <Text style={styles.detailText} selectable>
          {error.message}
        </Text>
      </ScrollView>
      <Pressable testID="errorBoundaryRetry" onPress={onReset} style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
      {onBack ? (
        <Pressable testID="errorBoundaryBack" onPress={onBack} style={styles.button}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const t = darkTheme;
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: t.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {fontSize: 20, fontWeight: '700', color: t.text, textAlign: 'center'},
  subtitle: {
    fontSize: 13,
    color: t.textDim,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
    maxWidth: 320,
  },
  detailBox: {
    maxHeight: 100,
    width: '100%',
    marginTop: 16,
    backgroundColor: t.surfaceAlt,
    borderRadius: 10,
    padding: 8,
  },
  detailText: {fontFamily: 'monospace', fontSize: 11, color: t.textDim},
  button: {
    backgroundColor: t.accent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 24,
  },
  buttonText: {fontSize: 15, fontWeight: '700', color: t.onAccent},
});
