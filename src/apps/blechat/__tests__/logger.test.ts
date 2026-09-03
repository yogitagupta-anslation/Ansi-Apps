/**
 * Regression guard: the Debug screen keys log rows by entry.id, so ids must stay unique
 * through the logger -> store pipeline. Handing out the internal array by reference
 * aliased it into the store and produced a duplicated entry on the first append after
 * hydration, which React reports as "Encountered two children with the same key".
 */
import {logger} from '../utils/logger';

describe('logger', () => {
  beforeEach(() => logger.clear());

  it('hands out a copy, not the internal array', () => {
    logger.info('Test', 'one');
    const snapshot = logger.getEntries();
    logger.info('Test', 'two');

    // A live alias would have grown to 2 here.
    expect(snapshot).toHaveLength(1);
    expect(logger.getEntries()).toHaveLength(2);
  });

  it('keeps ids unique when a snapshot is appended to, as the store does', () => {
    logger.info('Test', 'first');

    const fromStore = logger.getEntries();
    let combined: ReturnType<typeof logger.getEntries> = fromStore;
    const off = logger.bus.on('entry', entry => {
      combined = [...combined, entry];
    });
    logger.info('Test', 'second');
    off();

    const ids = combined.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(combined).toHaveLength(2);
  });

  it('assigns strictly increasing ids', () => {
    logger.info('Test', 'a');
    logger.warn('Test', 'b');
    logger.error('Test', 'c');
    const ids = logger.getEntries().map(e => e.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(3);
  });
});
