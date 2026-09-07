/**
 * The hub's screens mount, and say true things.
 *
 * This suite exists because of a specific failure: an APK once shipped that did not run,
 * and every check made on it had been a check on the build rather than on the thing built.
 * A launcher is mostly composition, so "it renders at all" is a real result here — a bad
 * style prop or a missing export is a black screen on a phone and nothing at all in a
 * typecheck.
 *
 * The second half is about the copy. Several lines on these screens are claims — how many
 * apps use a permission, whether an app asks for anything — and a claim that is assembled
 * from data can be checked against that data. These tests are what stop the numbers from
 * drifting away from the registry they describe.
 */

import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AppDetailScreen} from '../AppDetailScreen';
import {HubScreen} from '../HubScreen';
import {SearchScreen} from '../SearchScreen';
import {SettingsScreen} from '../SettingsScreen';
import {APPS, CATEGORIES, appsNeeding, searchApps} from '../registry';
import {PERMISSION_ORDER, initialsOf} from '../settings';

/** Every string the tree renders, flattened — enough to assert on copy. */
function textOf(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      // Interpolated text arrives as an array of parts ("5", " apps"), so a Text is only
      // readable once its own string children are joined back together.
      const parts = Array.isArray(children) ? children : [children];
      return parts
        .map(part => (typeof part === 'string' || typeof part === 'number' ? String(part) : ''))
        .join('');
    })
    .join(' | ');
}

/**
 * A phone-shaped safe area, supplied the way the real app supplies it.
 *
 * Every hub screen pads itself by the top inset, so rendering without a provider is not a
 * lighter version of the app — it is a crash, which is what these tests would otherwise be
 * reporting instead of anything about the screens.
 */
const METRICS = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

/** Renders inside act, so effects (recents, permission reads) have run before assertions. */
async function render(element: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>,
    );
  });
  return tree;
}

const noop = (): void => undefined;

describe('Home', () => {
  it('lists every app in the registry', async () => {
    const tree = await render(
      <HubScreen onSelect={noop} onOpen={noop} onSearch={noop} onSettings={noop} />,
    );
    const text = textOf(tree);
    for (const app of APPS) {
      expect(text).toContain(app.name);
    }
  });

  it('opens the detail page rather than launching, when a card is tapped', async () => {
    const onSelect = jest.fn();
    const onOpen = jest.fn();
    const tree = await render(
      <HubScreen onSelect={onSelect} onOpen={onOpen} onSearch={noop} onSettings={noop} />,
    );

    // The row for the first app in the registry.
    const row = tree.root.findAll(
      node => node.props?.accessibilityLabel?.startsWith?.(APPS[0].name) === true,
    )[0];
    await act(async () => {
      row.props.onPress();
    });

    // The distinction the browse flow is built on: a tap is a question, not a launch.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers every category the registry actually has', async () => {
    const tree = await render(
      <HubScreen onSelect={noop} onOpen={noop} onSearch={noop} onSettings={noop} />,
    );
    const text = textOf(tree);
    for (const category of CATEGORIES) {
      expect(text).toContain(category);
    }
  });
});

describe('Search', () => {
  it('narrows to the apps that match', () => {
    // The filter itself, independent of the screen that draws it.
    expect(searchApps(APPS, 'bluetooth').length).toBeGreaterThan(0);
    expect(searchApps(APPS, 'bluetooth').length).toBeLessThan(APPS.length);
    expect(searchApps(APPS, 'zzzznotathing')).toHaveLength(0);
    // Blank means "everything", because the list is the default view.
    expect(searchApps(APPS, '   ')).toHaveLength(APPS.length);
  });

  it('mounts with the full list', async () => {
    const tree = await render(<SearchScreen onSelect={noop} onClose={noop} />);
    expect(textOf(tree)).toContain(`${APPS.length} apps`);
  });
});

describe('App detail', () => {
  it('launches only when the button is pressed', async () => {
    const onLaunch = jest.fn();
    const tree = await render(
      <AppDetailScreen app={APPS[0]} onLaunch={onLaunch} onBack={noop} />,
    );

    expect(textOf(tree)).toContain('Use it!');
    expect(onLaunch).not.toHaveBeenCalled();

    const cta = tree.root.findAll(
      node => node.props?.accessibilityLabel === `Use ${APPS[0].name}`,
    )[0];
    await act(async () => {
      cta.props.onPress();
    });
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('names each permission the app actually requests', async () => {
    const app = APPS.find(candidate => candidate.needs.length > 0)!;
    const tree = await render(<AppDetailScreen app={app} onLaunch={noop} onBack={noop} />);
    const text = textOf(tree);

    for (const id of app.needs) {
      // The row is drawn from the same list the app's code requests from, so a
      // permission added there shows up here without anyone editing copy.
      expect(text.toLowerCase()).toContain(id === 'notifications' ? 'notifications' : id);
    }
  });

  it('says an app asks for nothing only when it asks for nothing', async () => {
    const quiet = APPS.find(candidate => candidate.needs.length === 0);
    // Higher or Lower is the one: its transport is stubbed, so it touches no radio.
    expect(quiet).toBeDefined();

    const tree = await render(<AppDetailScreen app={quiet!} onLaunch={noop} onBack={noop} />);
    expect(textOf(tree)).toContain('Asks for nothing');

    const loud = APPS.find(candidate => candidate.needs.length > 0)!;
    const other = await render(<AppDetailScreen app={loud} onLaunch={noop} onBack={noop} />);
    expect(textOf(other)).not.toContain('Asks for nothing');
  });
});

describe('Settings', () => {
  it('counts permission users from the registry, not from copy', async () => {
    const tree = await render(<SettingsScreen />);
    const text = textOf(tree);

    for (const id of PERMISSION_ORDER) {
      const users = appsNeeding(id);
      if (users.length > 0) {
        expect(text).toContain(`${users.length} of ${APPS.length} apps`);
      }
    }
  });

  it('does not claim the theme or the name reach the apps', async () => {
    const tree = await render(<SettingsScreen />);
    const text = textOf(tree);
    // The apps keep their own theme systems and their own identities; the hub does not
    // reach into them, so the screen must not imply that it does.
    expect(text).toContain("Sets the hub's own screens");
    expect(text).not.toMatch(/applies to all|sent to all|across all apps/i);
  });
});

describe('registry invariants', () => {
  it('only asks for permissions the hub knows how to check', () => {
    for (const app of APPS) {
      for (const id of app.needs) {
        expect(PERMISSION_ORDER).toContain(id);
      }
    }
  });

  it('has exactly one featured app', () => {
    expect(APPS.filter(app => app.featured)).toHaveLength(1);
  });

  it('gives every app a unique id', () => {
    expect(new Set(APPS.map(app => app.id)).size).toBe(APPS.length);
  });
});

describe('initials', () => {
  it('takes the first and last name', () => {
    expect(initialsOf('Alex Rivera')).toBe('AR');
    expect(initialsOf('Alex Q Rivera')).toBe('AR');
    expect(initialsOf('alex')).toBe('AL');
    // A blank name must not render as an empty circle with nothing in it.
    expect(initialsOf('   ')).toBe('·');
  });
});
