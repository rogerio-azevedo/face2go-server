import { mapWithConcurrency } from './map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('preserva ordem e respeita o limite', async () => {
    const inFlight: number[] = [];
    let max = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight.push(n);
      max = Math.max(max, inFlight.length);
      await new Promise((r) => setTimeout(r, 15));
      inFlight.splice(inFlight.indexOf(n), 1);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(max).toBeLessThanOrEqual(2);
  });
});
