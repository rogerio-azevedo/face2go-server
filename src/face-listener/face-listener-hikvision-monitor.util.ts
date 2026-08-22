export type HikvisionMonitorMode = 'alertStream' | 'acsEventPoll';

export const HIKVISION_POLL_OFFLINE_THRESHOLD = 3;
export const HIKVISION_ALERTSTREAM_FALLBACK_FAILURES = 3;
export const HIKVISION_CONNECT_STAGGER_MS = 500;

export function shouldMarkPollOffline(
  consecutiveFailures: number,
  threshold: number = HIKVISION_POLL_OFFLINE_THRESHOLD,
): boolean {
  return consecutiveFailures >= threshold;
}

export function nextPollFailCountOnError(current: number): number {
  return current + 1;
}

/** Evita inundar o console quando o poll falha continuamente (a cada 3s). */
export function shouldLogPollFailure(
  consecutiveFailures: number,
  threshold: number = HIKVISION_POLL_OFFLINE_THRESHOLD,
): boolean {
  if (consecutiveFailures <= threshold) {
    return true;
  }
  return consecutiveFailures % 20 === 0;
}

export function shouldFallbackAlertStreamToPoll(params: {
  httpStatus?: number;
  consecutiveFailures: number;
  maxFailures?: number;
}): boolean {
  if (params.httpStatus === 404) {
    return true;
  }
  const max = params.maxFailures ?? HIKVISION_ALERTSTREAM_FALLBACK_FAILURES;
  return params.consecutiveFailures >= max;
}

export function extractHttpStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: number } }).response?.status;
  return typeof status === 'number' ? status : undefined;
}
