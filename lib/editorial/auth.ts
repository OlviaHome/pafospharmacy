import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison of a received secret header with the configured secret. */
export function secretMatches(received: string | null | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  reply_to_message?: { message_id: number };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: { message_id: number; chat: TelegramChat };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * The bot obeys exactly one person: the configured admin, in a private chat with the bot.
 * Everything else (other users, groups, channels, edited messages, other update types) is ignored.
 */
export function adminActor(
  update: TelegramUpdate,
  adminId: string,
): { chatId: number; kind: "message" | "callback" } | null {
  if (update.message) {
    const { from, chat } = update.message;
    if (!from || from.is_bot) return null;
    if (String(from.id) !== adminId || chat.type !== "private" || String(chat.id) !== adminId) return null;
    return { chatId: chat.id, kind: "message" };
  }
  if (update.callback_query) {
    const { from, message } = update.callback_query;
    if (from.is_bot || String(from.id) !== adminId) return null;
    if (!message || message.chat.type !== "private" || String(message.chat.id) !== adminId) return null;
    return { chatId: message.chat.id, kind: "callback" };
  }
  return null;
}
