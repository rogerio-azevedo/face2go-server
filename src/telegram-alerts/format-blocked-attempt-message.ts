import type { AccessBlockedAttemptPayload } from '../notifications/notifications.events';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function formatBlockedAttemptMessage(
  payload: AccessBlockedAttemptPayload,
): string {
  const person = escapeHtml(
    payload.personName?.trim() || `Face ${payload.faceId}`,
  );
  const reason = escapeHtml(payload.blockReason?.trim() || 'não informado');
  const when = payload.eventDate
    ? payload.eventDate.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'agora';

  return [
    '🔐 <b>ALERTA FACE2GO</b>',
    '⚠️ <b>Tentativa de acesso bloqueada</b>',
    '',
    `👤 <b>Pessoa:</b> ${person}`,
    `🚫 <b>Motivo:</b> ${reason}`,
    `🚪 <b>Leitor:</b> ${escapeHtml(payload.readerName)}`,
    `🏢 <b>Cliente:</b> ${escapeHtml(payload.clientName)}`,
    `🕐 <b>Quando:</b> ${when}`,
  ].join('\n');
}
