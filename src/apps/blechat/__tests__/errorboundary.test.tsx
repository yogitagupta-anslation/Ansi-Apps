/**
 * ErrorBoundary: a render-phase throw anywhere below it replaces that subtree with the
 * fallback screen instead of taking the whole app down, and "Try again" gives the tree
 * another chance to render.
 */
import React from 'react';
import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {ErrorBoundary} from '../components/ErrorBoundary';

function Bomb({shouldThrow}: {shouldThrow: boolean}): React.JSX.Element {
  if (shouldThrow) {
    throw new Error('boom');
  }
  return <Text>fine</Text>;
}

describe('ErrorBoundary', () => {
  // React logs the caught error to the console by default; keep test output clean.
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders children normally when nothing throws', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <Bomb shouldThrow={false} />
        </ErrorBoundary>,
      );
    });
    expect(renderer!.root.findByType(Text).props.children).toBe('fine');
  });

  /**
   * Generous timeout, deliberately. React's DEV error path does a synchronous retry
   * render plus its own console work when a boundary catches, which takes ~0.6s alone
   * but can exceed Jest's 5s default when the whole suite is running in parallel
   * workers on a loaded machine. The slowness is React's, not this component's.
   */
  it('catches a render throw and shows the fallback instead of propagating it', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <Bomb shouldThrow />
        </ErrorBoundary>,
      );
    });

    const texts = renderer!.root.findAllByType(Text).map(node => node.props.children);
    expect(texts.join(' ')).toContain('Something went wrong');
  }, 30_000);

  it('"Try again" gives the subtree another chance to render', async () => {
    let shouldThrow = true;
    function Wrapper() {
      return (
        <ErrorBoundary>
          <Bomb shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Wrapper />);
    });
    expect(
      renderer!.root
        .findAllByType(Text)
        .map(n => n.props.children)
        .join(' '),
    ).toContain('Something went wrong');

    // Fix the underlying condition and let it flow down to the still-crashed boundary's
    // children *before* pressing "Try again" — reset() only clears the error flag, so
    // render() falls through to whatever `this.props.children` already is at that moment.
    // Reversing this order would re-render the boundary with the still-throwing old
    // element, since only Wrapper re-rendering (via update()) ever gives it a fresh one.
    shouldThrow = false;
    await act(async () => {
      renderer.update(<Wrapper />);
    });
    const button = renderer!.root.findByProps({testID: 'errorBoundaryRetry'});
    await act(async () => {
      button.props.onPress();
    });

    expect(renderer!.root.findByType(Text).props.children).toBe('fine');
  });
});
