import {
  decideOfflineNotifyAction,
  shouldEmitOfflineNotification,
} from './face-listener-offline-notifier.util';

describe('face-listener-offline-notifier.util', () => {
  describe('decideOfflineNotifyAction', () => {
    it('agenda debounce na primeira transição online → offline', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: true,
          nextConnected: false,
          alreadyNotified: false,
          hasPendingTimer: false,
        }),
      ).toBe('schedule');
    });

    it('agenda também quando o estado anterior era indefinido (ainda não conectou de verdade, mas caiu depois de ter sido visto online via updateStatus)', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: undefined,
          nextConnected: false,
          alreadyNotified: false,
          hasPendingTimer: false,
        }),
      ).toBe('schedule');
    });

    it('não reagenda se já existe timer pendente', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: true,
          nextConnected: false,
          alreadyNotified: false,
          hasPendingTimer: true,
        }),
      ).toBe('none');
    });

    it('não reagenda se já notificou enquanto continua offline', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: true,
          nextConnected: false,
          alreadyNotified: true,
          hasPendingTimer: false,
        }),
      ).toBe('none');
    });

    it('não agenda quando já estava offline', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: false,
          nextConnected: false,
          alreadyNotified: false,
          hasPendingTimer: false,
        }),
      ).toBe('none');
    });

    it('cancela (e limpa anti-spam) ao voltar online', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: false,
          nextConnected: true,
          alreadyNotified: true,
          hasPendingTimer: true,
        }),
      ).toBe('cancel');
    });

    it('cancela ao conectar pela primeira vez', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: false,
          nextConnected: true,
          alreadyNotified: false,
          hasPendingTimer: false,
        }),
      ).toBe('cancel');
    });

    it('ignora atualizações que não mudam connected', () => {
      expect(
        decideOfflineNotifyAction({
          previousConnected: true,
          nextConnected: undefined,
          alreadyNotified: false,
          hasPendingTimer: false,
        }),
      ).toBe('none');
    });
  });

  describe('shouldEmitOfflineNotification', () => {
    it('emite só se ainda estiver offline e ainda não tiver notificado', () => {
      expect(
        shouldEmitOfflineNotification({
          currentlyConnected: false,
          alreadyNotified: false,
        }),
      ).toBe(true);
      expect(
        shouldEmitOfflineNotification({
          currentlyConnected: true,
          alreadyNotified: false,
        }),
      ).toBe(false);
      expect(
        shouldEmitOfflineNotification({
          currentlyConnected: false,
          alreadyNotified: true,
        }),
      ).toBe(false);
    });
  });
});
