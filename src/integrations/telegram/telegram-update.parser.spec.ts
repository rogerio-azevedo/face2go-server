import { parseTelegramUpdate } from './telegram-update.parser';

describe('parseTelegramUpdate', () => {
  it('extrai /start com token em chat privado', () => {
    expect(
      parseTelegramUpdate({
        message: {
          text: '/start abc_TOKEN-1',
          chat: {
            id: 42,
            type: 'private',
            username: 'ana',
            first_name: 'Ana',
          },
        },
      }),
    ).toEqual({
      kind: 'start',
      chatId: '42',
      chatType: 'private',
      token: 'abc_TOKEN-1',
      title: 'Ana',
      username: 'ana',
    });
  });

  it('extrai /start@bot em grupo', () => {
    expect(
      parseTelegramUpdate({
        message: {
          text: '/start@face2go_alert_bot grupoToken',
          chat: { id: -100123, type: 'supergroup', title: 'Portaria' },
        },
      }),
    ).toEqual({
      kind: 'start',
      chatId: '-100123',
      chatType: 'supergroup',
      token: 'grupoToken',
      title: 'Portaria',
      username: null,
    });
  });

  it('trata /start sem token', () => {
    expect(
      parseTelegramUpdate({
        message: { text: '/start', chat: { id: 7, type: 'private' } },
      }),
    ).toEqual({ kind: 'start_without_token', chatId: '7' });
  });

  it('extrai /stop e /stop@bot', () => {
    expect(
      parseTelegramUpdate({
        message: { text: '/stop', chat: { id: 9, type: 'private' } },
      }),
    ).toEqual({ kind: 'stop', chatId: '9' });
    expect(
      parseTelegramUpdate({
        message: {
          text: '/stop@face2go_alert_bot',
          chat: { id: -5, type: 'group' },
        },
      }),
    ).toEqual({ kind: 'stop', chatId: '-5' });
  });

  it('marca bot removido em left ou kicked', () => {
    expect(
      parseTelegramUpdate({
        my_chat_member: {
          chat: { id: -88, type: 'group' },
          new_chat_member: { status: 'kicked' },
        },
      }),
    ).toEqual({ kind: 'bot_removed', chatId: '-88' });
    expect(
      parseTelegramUpdate({
        my_chat_member: {
          chat: { id: 1, type: 'private' },
          new_chat_member: { status: 'member' },
        },
      }),
    ).toEqual({ kind: 'ignore' });
  });

  it('ignora payload inválido', () => {
    expect(parseTelegramUpdate(null)).toEqual({ kind: 'ignore' });
    expect(parseTelegramUpdate({ message: { text: 'oi' } })).toEqual({
      kind: 'ignore',
    });
  });
});
