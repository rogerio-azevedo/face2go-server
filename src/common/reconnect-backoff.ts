export const RECONNECT_BACKOFF_STEPS_MS = [
  5_000, 10_000, 20_000, 40_000, 80_000, 300_000,
] as const;

export const RECONNECT_COLD_AFTER_FAILURES = 10;
export const RECONNECT_COLD_INTERVAL_MS = 15 * 60_000;
export const RECONNECT_JITTER_RATIO = 0.2;

export type ReconnectBackoffState = {
  consecutiveFailures: number;
  cold: boolean;
};

export function createReconnectBackoffState(): ReconnectBackoffState {
  return { consecutiveFailures: 0, cold: false };
}

function applyJitter(baseMs: number, random: () => number): number {
  const jitter = 1 + (random() * 2 - 1) * RECONNECT_JITTER_RATIO;
  return Math.max(1, Math.round(baseMs * jitter));
}

export function nextReconnectDelayMs(
  state: ReconnectBackoffState,
  random: () => number = Math.random,
): {
  delayMs: number;
  next: ReconnectBackoffState;
  becameCold: boolean;
} {
  const consecutiveFailures = state.consecutiveFailures + 1;
  const becameCold =
    !state.cold && consecutiveFailures >= RECONNECT_COLD_AFTER_FAILURES;
  const cold = state.cold || becameCold;

  const stepIndex = Math.min(
    consecutiveFailures - 1,
    RECONNECT_BACKOFF_STEPS_MS.length - 1,
  );
  const baseMs = cold
    ? RECONNECT_COLD_INTERVAL_MS
    : RECONNECT_BACKOFF_STEPS_MS[stepIndex];

  return {
    delayMs: applyJitter(baseMs, random),
    next: { consecutiveFailures, cold },
    becameCold,
  };
}

export function formatReconnectDelay(ms: number): string {
  if (ms >= 60_000) {
    const minutes = Math.round(ms / 60_000);
    return `${minutes}min`;
  }
  return `${Math.round(ms / 1000)}s`;
}

export class ReconnectBackoffTracker {
  private states = new Map<string, ReconnectBackoffState>();

  reset(deviceId: string): { wasCold: boolean } {
    const wasCold = this.states.get(deviceId)?.cold === true;
    this.states.delete(deviceId);
    return { wasCold };
  }

  delete(deviceId: string): void {
    this.states.delete(deviceId);
  }

  clear(): void {
    this.states.clear();
  }

  nextDelay(
    deviceId: string,
    random: () => number = Math.random,
  ): {
    delayMs: number;
    consecutiveFailures: number;
    cold: boolean;
    becameCold: boolean;
  } {
    const current = this.states.get(deviceId) ?? createReconnectBackoffState();
    const result = nextReconnectDelayMs(current, random);
    this.states.set(deviceId, result.next);
    return {
      delayMs: result.delayMs,
      consecutiveFailures: result.next.consecutiveFailures,
      cold: result.next.cold,
      becameCold: result.becameCold,
    };
  }
}
