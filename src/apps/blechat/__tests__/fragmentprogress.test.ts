/**
 * FragmentedLink's progress callback: fires once per fragment actually written, in
 * order, and never fires at all for a single-fragment send unless asked to.
 */
import {FragmentedLink, type FragmentSink} from '../messaging/FragmentedLink';
import {utf8Encode} from '../utils/bytes';

function fakeSink(mtu: number): FragmentSink & {sent: Uint8Array[]} {
  const sent: Uint8Array[] = [];
  return {
    sent,
    async sendFrame(frame) {
      sent.push(frame);
    },
    currentMtu() {
      return mtu;
    },
  };
}

describe('FragmentedLink progress', () => {
  it('reports each frame as it is actually written, ending at the true total', async () => {
    const sink = fakeSink(23); // small MTU forces several fragments for a longish payload
    const link = new FragmentedLink('test', sink);
    const payload = utf8Encode('x'.repeat(200));

    const calls: Array<[number, number]> = [];
    await link.send(payload, (sentCount, total) => calls.push([sentCount, total]));

    expect(calls.length).toBeGreaterThan(1);
    // Monotonic and exactly 1..N — no skipped or repeated fragment.
    const total = calls[0][1];
    expect(calls.map(c => c[0])).toEqual(
      Array.from({length: total}, (_, i) => i + 1),
    );
    expect(calls.every(c => c[1] === total)).toBe(true);
    expect(calls[calls.length - 1]).toEqual([total, total]);
    expect(sink.sent.length).toBe(total);
  });

  it('still resolves normally when no callback is supplied', async () => {
    const sink = fakeSink(23);
    const link = new FragmentedLink('test', sink);
    await expect(
      link.send(utf8Encode('short')),
    ).resolves.toBeUndefined();
  });

  it('calls back exactly once for a payload that fits in a single frame', async () => {
    const sink = fakeSink(512);
    const link = new FragmentedLink('test', sink);
    const calls: Array<[number, number]> = [];
    await link.send(utf8Encode('hi'), (sentCount, total) => calls.push([sentCount, total]));
    expect(calls).toEqual([[1, 1]]);
  });
});
