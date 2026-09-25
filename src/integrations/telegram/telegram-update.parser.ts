export type TelegramChatType = 'private' | 'group' | 'supergroup';

export type ParsedTelegramUpdate =
  | {
      kind: 'start';
      chatId: string;
      chatType: TelegramChatType;
      token: string;
      title: string | null;
      username: string | null;
    }
  | { kind: 'start_without_token'; chatId: string }
  | { kind: 'stop'; chatId: string }
  | { kind: 'bot_removed'; chatId: string }
  | { kind: 'ignore' };

type TelegramChat = {
  id?: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
};

const COMMAND = /^\/(start|stop)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?(?:\s|$)/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function chatIdOf(chat: TelegramChat | null): string | null {
  if (chat?.id === undefined || chat.id === null) {
    return null;
  }
  return String(chat.id);
}

function chatTypeOf(chat: TelegramChat | null): TelegramChatType | null {
  if (
    chat?.type === 'private' ||
    chat?.type === 'group' ||
    chat?.type === 'supergroup'
  ) {
    return chat.type;
  }
  return null;
}

function chatLabel(chat: TelegramChat): {
  title: string | null;
  username: string | null;
} {
  const title =
    (typeof chat.title === 'string' && chat.title.trim()) ||
    (typeof chat.first_name === 'string' && chat.first_name.trim()) ||
    null;
  const username =
    typeof chat.username === 'string' && chat.username.trim()
      ? chat.username.trim()
      : null;
  return { title, username };
}

function parseCommand(
  text: string,
): { command: 'start' | 'stop'; arg: string | null } | null {
  const match = COMMAND.exec(text.trim());
  if (!match) {
    return null;
  }
  const command = match[1] === 'stop' ? 'stop' : 'start';
  return { command, arg: match[2] ?? null };
}

export function parseTelegramUpdate(update: unknown): ParsedTelegramUpdate {
  const root = asRecord(update);
  if (!root) {
    return { kind: 'ignore' };
  }

  const member = asRecord(root.my_chat_member);
  if (member) {
    const chat = asRecord(member.chat) as TelegramChat | null;
    const chatId = chatIdOf(chat);
    const next = asRecord(member.new_chat_member);
    const status = typeof next?.status === 'string' ? next.status : '';
    if (chatId && (status === 'left' || status === 'kicked')) {
      return { kind: 'bot_removed', chatId };
    }
    return { kind: 'ignore' };
  }

  const message = asRecord(root.message);
  if (!message || typeof message.text !== 'string') {
    return { kind: 'ignore' };
  }

  const chat = asRecord(message.chat) as TelegramChat | null;
  const chatId = chatIdOf(chat);
  if (!chatId) {
    return { kind: 'ignore' };
  }

  const parsed = parseCommand(message.text);
  if (!parsed) {
    return { kind: 'ignore' };
  }
  if (parsed.command === 'stop') {
    return { kind: 'stop', chatId };
  }

  const chatType = chatTypeOf(chat);
  if (!parsed.arg || !chatType || !chat) {
    return { kind: 'start_without_token', chatId };
  }

  const labels = chatLabel(chat);
  return {
    kind: 'start',
    chatId,
    chatType,
    token: parsed.arg,
    title: labels.title,
    username: labels.username,
  };
}
