export const DEFAULT_READER_OFFLINE_NOTIFY_DEBOUNCE_MS = 90_000;

export type OfflineNotifyAction = 'schedule' | 'cancel' | 'none';

/**
 * Decide o que fazer com o timer de notificação ao mudar `connected`.
 *
 * - `schedule`: leitor acabou de cair e ainda não foi notificado — agendar debounce.
 * - `cancel`: leitor voltou online — cancelar timer pendente e limpar anti-spam.
 * - `none`: sem transição relevante (já offline, já notificado, ou `connected` inalterado).
 */
export function decideOfflineNotifyAction(params: {
  previousConnected: boolean | undefined;
  nextConnected: boolean | undefined;
  alreadyNotified: boolean;
  hasPendingTimer: boolean;
}): OfflineNotifyAction {
  const goingOnline =
    params.nextConnected === true && params.previousConnected !== true;
  if (goingOnline) {
    return 'cancel';
  }

  const goingOffline =
    params.nextConnected === false && params.previousConnected !== false;
  if (goingOffline) {
    if (params.alreadyNotified || params.hasPendingTimer) {
      return 'none';
    }
    return 'schedule';
  }

  return 'none';
}

export function shouldEmitOfflineNotification(params: {
  currentlyConnected: boolean;
  alreadyNotified: boolean;
}): boolean {
  return !params.currentlyConnected && !params.alreadyNotified;
}
