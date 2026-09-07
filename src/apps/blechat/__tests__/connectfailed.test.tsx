/**
 * The advice on a failed connection has to match the failure.
 *
 * This screen replaced an alert that showed `GATT 133 during connecting` and stopped.
 * The replacement is only an improvement while the suggestions are TRUE for the failure
 * they are attached to: telling somebody to move closer when Bluetooth is switched off
 * is worse than saying nothing, because it is confident, actionable and wrong, and it
 * sends them walking around a room instead of to the toggle.
 *
 * So the tests here are about what must NOT appear as much as what must.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ConnectFailedSheet} from '../components/ConnectFailedSheet';
import {ThemeProvider} from '../theme/ThemeProvider';
import type {LinkFailure, LinkFailureReason} from '../types/BLE';

const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function failure(reason: LinkFailureReason): LinkFailure {
  return {reason, phase: 'connecting', message: 'raw platform text', timestamp: 0};
}

async function render(reason: LinkFailureReason): Promise<string> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider mode="light">
          <ConnectFailedSheet
            visible
            name="Neha"
            failure={failure(reason)}
            attempts={2}
            maxAttempts={5}
            onRetry={() => undefined}
            onClose={() => undefined}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree.root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      const parts = Array.isArray(children) ? children : [children];
      return parts
        .map(part => (typeof part === 'string' || typeof part === 'number' ? String(part) : ''))
        .join('');
    })
    .join(' | ');
}

describe('connect failed', () => {
  it('names who it could not reach', async () => {
    expect(await render('ConnectionTimeout')).toContain("Couldn't reach Neha");
  });

  it('does not tell you to move closer when Bluetooth is off', async () => {
    const text = await render('BluetoothOff');
    expect(text).not.toContain('Move a little closer');
    // It should still say what actually happened.
    expect(text).toContain('Bluetooth is switched off');
  });

  it('does not tell you to move closer when the permission was refused', async () => {
    const text = await render('PermissionDenied');
    expect(text).not.toContain('Move a little closer');
    expect(text).not.toContain('turn Bluetooth off and on');
    expect(text).toContain('permission');
  });

  it('suggests moving closer when the link dropped mid-handshake', async () => {
    const text = await render('HandshakeTimeout');
    expect(text).toContain('Move a little closer');
  });

  it('suggests waiting rather than moving for an Android GATT error', async () => {
    // 133 is the stack refusing to say why, and is almost always transient — distance
    // is usually not the problem, so the advice should not lead with it.
    const text = await render('AndroidGattError');
    expect(text).toContain('Wait a few seconds');
    expect(text).not.toContain('Move a little closer');
  });

  /**
   * The typed reason and the stage are still recorded and still exported — they moved to
   * Diagnostics. What must not happen is a reader working out their next step being
   * handed "AndroidGattError during connecting" underneath the sentence telling them what
   * to do.
   */
  it('says how many tries without naming the internals', async () => {
    const text = await render('AndroidGattError');
    expect(text).toContain('Tried 2 times');
    expect(text).not.toContain('AndroidGattError');
    expect(text).not.toContain('connecting');
  });

  it('explains every reason it can be given, rather than falling through to nothing', async () => {
    // The fallback copy is deliberate, but it should be reached rarely. Any reason the
    // transport can actually produce for a dial ought to have its own sentence.
    const dialReasons: LinkFailureReason[] = [
      'PermissionDenied',
      'BluetoothOff',
      'DeviceUnavailable',
      'ConnectionTimeout',
      'ConnectionRefused',
      'AndroidGattError',
      'ServiceNotFound',
      'HandshakeTimeout',
      'HandshakeFailed',
    ];
    for (const reason of dialReasons) {
      const text = await render(reason);
      expect(text).not.toContain('the platform did not say why');
    }
  });
});
