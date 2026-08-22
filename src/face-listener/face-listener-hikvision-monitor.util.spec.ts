import {
  HIKVISION_ALERTSTREAM_FALLBACK_FAILURES,
  HIKVISION_POLL_OFFLINE_THRESHOLD,
  nextPollFailCountOnError,
  shouldFallbackAlertStreamToPoll,
  shouldLogPollFailure,
  shouldMarkPollOffline,
} from './face-listener-hikvision-monitor.util';

describe('face-listener-hikvision-monitor.util', () => {
  describe('shouldMarkPollOffline', () => {
    it('só marca offline após o limiar de falhas consecutivas', () => {
      expect(shouldMarkPollOffline(1)).toBe(false);
      expect(shouldMarkPollOffline(2)).toBe(false);
      expect(shouldMarkPollOffline(HIKVISION_POLL_OFFLINE_THRESHOLD)).toBe(
        true,
      );
    });
  });

  describe('nextPollFailCountOnError', () => {
    it('incrementa contador de falhas', () => {
      expect(nextPollFailCountOnError(0)).toBe(1);
      expect(nextPollFailCountOnError(2)).toBe(3);
    });
  });

  describe('shouldFallbackAlertStreamToPoll', () => {
    it('faz fallback imediato em HTTP 404', () => {
      expect(
        shouldFallbackAlertStreamToPoll({
          httpStatus: 404,
          consecutiveFailures: 1,
        }),
      ).toBe(true);
    });

    it('faz fallback após N falhas consecutivas sem 404', () => {
      expect(
        shouldFallbackAlertStreamToPoll({
          consecutiveFailures: HIKVISION_ALERTSTREAM_FALLBACK_FAILURES - 1,
        }),
      ).toBe(false);
      expect(
        shouldFallbackAlertStreamToPoll({
          consecutiveFailures: HIKVISION_ALERTSTREAM_FALLBACK_FAILURES,
        }),
      ).toBe(true);
    });
  });

  describe('shouldLogPollFailure', () => {
    it('loga nas primeiras falhas e depois a cada 20', () => {
      expect(shouldLogPollFailure(1)).toBe(true);
      expect(shouldLogPollFailure(3)).toBe(true);
      expect(shouldLogPollFailure(4)).toBe(false);
      expect(shouldLogPollFailure(19)).toBe(false);
      expect(shouldLogPollFailure(20)).toBe(true);
    });
  });

  describe('poll recovery flow', () => {
    it('falha → falha → sucesso restaura online (contador zera)', () => {
      let fails = 0;
      let connected = true;

      for (let i = 0; i < 2; i++) {
        fails = nextPollFailCountOnError(fails);
        if (shouldMarkPollOffline(fails)) {
          connected = false;
        }
      }
      expect(connected).toBe(true);
      expect(fails).toBe(2);

      fails = 0;
      connected = true;
      expect(shouldMarkPollOffline(fails)).toBe(false);
      expect(connected).toBe(true);
    });

    it('três falhas consecutivas marcam offline até sucesso', () => {
      let fails = 0;
      let connected = true;

      for (let i = 0; i < HIKVISION_POLL_OFFLINE_THRESHOLD; i++) {
        fails = nextPollFailCountOnError(fails);
        if (shouldMarkPollOffline(fails)) {
          connected = false;
        }
      }
      expect(connected).toBe(false);

      fails = 0;
      connected = true;
      expect(connected).toBe(true);
    });
  });
});
