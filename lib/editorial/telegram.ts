import "server-only";

import { telegramConfig } from "./config";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineButton[][];

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class TelegramError extends Error {}

async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { botToken } = telegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new TelegramError(`Telegram ${method}: ${json.description ?? response.status}`);
  return json.result as T;
}

const MAX_TEXT = 4000;
const PAIRED_TAGS = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a", "blockquote", "tg-spoiler"]);

/**
 * Telegram rejects messages over 4096 characters, so long texts are cut with an ellipsis. The text is
 * HTML: a cut must never leave a half-written tag or entity, and every tag still open at the cut is
 * closed, otherwise Telegram answers "can't parse entities" and the whole message is lost.
 */
export function fitHtml(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 10);
  // A tag cut in the middle ("<a href=…") goes entirely.
  const lastOpen = cut.lastIndexOf("<");
  if (lastOpen > cut.lastIndexOf(">")) cut = cut.slice(0, lastOpen);
  // So does an entity cut in the middle ("&am").
  cut = cut.replace(/&[a-zA-Z#0-9]{0,10}$/, "");
  const open: string[] = [];
  for (const match of cut.matchAll(/<(\/?)([a-zA-Z-]+)[^>]*>/g)) {
    const name = match[2].toLowerCase();
    if (!PAIRED_TAGS.has(name)) continue;
    if (match[1]) {
      const index = open.lastIndexOf(name);
      if (index >= 0) open.length = index;
    } else {
      open.push(name);
    }
  }
  return `${cut}…${open.reverse().map((name) => `</${name}>`).join("")}`;
}

export async function sendMessage(
  chatId: number,
  text: string,
  options: { keyboard?: InlineKeyboard; forceReply?: boolean; replyTo?: number } = {},
): Promise<{ message_id: number }> {
  return call("sendMessage", {
    chat_id: chatId,
    text: fitHtml(text),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(options.replyTo ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } } : {}),
    ...(options.keyboard
      ? { reply_markup: { inline_keyboard: options.keyboard } }
      : options.forceReply
        ? { reply_markup: { force_reply: true, selective: true } }
        : {}),
  });
}

/** Sends a text file (e.g. the article as Markdown) with an optional force-reply prompt. */
export async function sendDocument(
  chatId: number,
  fileName: string,
  content: string,
  caption: string,
  options: { forceReply?: boolean } = {},
): Promise<{ message_id: number }> {
  const { botToken } = telegramConfig();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", fitHtml(caption, 1000));
  form.append("parse_mode", "HTML");
  if (options.forceReply) form.append("reply_markup", JSON.stringify({ force_reply: true, selective: true }));
  form.append("document", new Blob([content], { type: "text/markdown; charset=utf-8" }), fileName);
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!json.ok || !json.result) throw new TelegramError(`Telegram sendDocument: ${json.description ?? response.status}`);
  return json.result;
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: fitHtml(text),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (error) {
    // "message is not modified" is harmless.
    if (!(error instanceof TelegramError && error.message.includes("not modified"))) throw error;
  }
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => undefined);
}

export async function sendTyping(chatId: number): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
}

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

/** Downloads a file the admin sent (photo or image document). */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const { botToken } = telegramConfig();
  const file = await call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new TelegramError("Telegram returned no file path.");
  if (file.file_size && file.file_size > MAX_DOWNLOAD_BYTES) throw new TelegramError("Файл больше 15 МБ.");
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new TelegramError(`Telegram file download failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new TelegramError("Файл больше 15 МБ.");
  return { bytes, path: file.file_path };
}

export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
    max_connections: 5,
  });
  await call("setMyCommands", {
    commands: [
      { command: "new", description: "Новая статья: /new тема" },
      { command: "drafts", description: "Черновики" },
      { command: "published", description: "Опубликованные статьи" },
      { command: "usage", description: "Расходы и лимиты" },
      { command: "help", description: "Как пользоваться" },
    ],
  });
}

export async function webhookInfo(): Promise<{
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  last_error_date?: number;
}> {
  return call("getWebhookInfo", {});
}
