import {
  createReconnectBackoffState,
  formatReconnectDelay,
  nextReconnectDelayMs,
  RECONNECT_BACKOFF_STEPS_MS,
  RECONNECT_COLD_AFTER_FAILURES,
  RECONNECT_COLD_INTERVAL_MS,
  ReconnectBackoffTracker,
} from './reconnect-backoff';

const noJitter = () => 0.5;

describe('reconnect-backoff', () => {
  it('sobe 5s → 10 → 20 → 40 → 80 → teto 300s', () => {
    let state = createReconnectBackoffState();
    const delays: number[] = [];
    for (let i = 0; i < RECONNECT_BACKOFF_STEPS_MS.length; i++) {
      const result = nextReconnectDelayMs(state, noJitter);
      delays.push(result.delayMs);
      state = result.next;
    }
    expect(delays).toEqual([...RECONNECT_BACKOFF_STEPS_MS]);
  });

  it('entra em estado frio na 10ª falha e usa 15min', () => {
    let state = createReconnectBackoffState();
    let becameCold = false;
    for (let i = 0; i < RECONNECT_COLD_AFTER_FAILURES; i++) {
      const result = nextReconnectDelayMs(state, noJitter);
      becameCold = result.becameCold;
      state = result.next;
    }
    expect(becameCold).toBe(true);
    expect(state.cold).toBe(true);
    expect(state.consecutiveFailures).toBe(RECONNECT_COLD_AFTER_FAILURES);
    const cold = nextReconnectDelayMs(state, noJitter);
    expect(cold.delayMs).toBe(RECONNECT_COLD_INTERVAL_MS);
  });

  it('reset no tracker zera o frio', () => {
    const tracker = new ReconnectBackoffTracker();
    for (let i = 0; i < RECONNECT_COLD_AFTER_FAILURES; i++) {
      tracker.nextDelay('r1', noJitter);
    }
    expect(tracker.reset('r1')).toEqual({ wasCold: true });
    expect(tracker.nextDelay('r1', noJitter).delayMs).toBe(
      RECONNECT_BACKOFF_STEPS_MS[0],
    );
  });

  it('formata delay em s e min', () => {
    expect(formatReconnectDelay(5_000)).toBe('5s');
    expect(formatReconnectDelay(15 * 60_000)).toBe('15min');
  });
});
