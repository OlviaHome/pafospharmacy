import "server-only";

import type { TelegramCallbackQuery } from "./auth";
import { editorialLimits, openAiModel, utilityModel } from "./config";
import { MODEL_PRICES } from "./pricing";
import { startScoutJob } from "./pipeline";
import { checkSource, type Fetcher } from "./scout-sources";
import { cyprusDate } from "./scout";
import { eventMaterial, renderDigestHeader, renderSourceLinks, renderTopic, topicKeyboard, type DigestTopic, type ScoutOutcome } from "./scout-render";
import {
  claimForWork,
  listSkipped,
  listSources,
  loadEvent,
  recordSourceCheck,
  restoreEvent,
  scoutSpentSince,
  setSourceEnabled,
  skipEvent,
  SKIPPED_DAYS,
  type NewsEvent,
  type NewsSource,
} from "./scout-store";
import { createPost, createStartedImport, deletePost } from "./store";
import { cyprusMonthStart } from "./limits";
import { answerCallback, editMessage, escapeHtml, sendMessage, type InlineKeyboard } from "./telegram";

/** The Scout's part of the Telegram interface: /scout, /sources and the digest messages. */

function today(): string {
  const [year, month, day] = cyprusDate(new Date()).split("-");
  return `${day}.${month}.${year}`;
}

/** The model a test run may name: only the known ones (a typo must not reach OpenAI). */
function testModel(word: string): string | null | undefined {
  if (!word) return undefined;
  const aliases: Record<string, string> = { luna: utilityModel(), terra: openAiModel() };
  const model = aliases[word.toLowerCase()] ?? word;
  return Object.hasOwn(MODEL_PRICES, model) ? model : null;
}

/** `/scout` (real run) and `/scout test [luna|terra|<model>]` (test run on all sources, nothing saved). */
export async function handleScoutCommand(chatId: number, argument: string): Promise<void> {
  const [mode, modelWord = ""] = argument.trim().split(/\s+/);
  if (mode && mode.toLowerCase() !== "test") {
    await sendMessage(chatId, "Команды: /scout — мониторинг сейчас, /scout test — тестовый запуск (ничего не сохраняется), /scout test luna — то же на дешёвой модели для сравнения.");
    return;
  }
  const test = Boolean(mode);
  const model = test ? testModel(modelWord) : undefined;
  if (model === null) {
    await sendMessage(chatId, `Неизвестная модель «${escapeHtml(modelWord.slice(0, 40))}». Доступны: luna, terra или ${Object.keys(MODEL_PRICES).map(escapeHtml).join(", ")}.`);
    return;
  }
  const result = await startScoutJob({ kind: test ? "test" : "real", trigger: "manual", ...(model ? { model } : {}) });
  if (!result.ok) {
    await sendMessage(
      chatId,
      result.reason === "done"
        ? "Мониторинг за сегодня уже выполнен, дайджест отправлен. Следующий — завтра в 09:00 по Кипру. Проверить источники без сохранения: /scout test."
        : "Мониторинг уже выполняется. Пришлю результат, как только он будет готов.",
    );
    return;
  }
  await sendMessage(
    chatId,
    test
      ? `🧪 Запускаю тестовый мониторинг${model ? ` (модель <code>${escapeHtml(model)}</code>)` : ""} по всем источникам, включая ещё не утверждённые. Обычно 2–4 минуты.`
      : "🔎 Запускаю мониторинг новостей по утверждённым источникам. Обычно 2–4 минуты; пришлю дайджест.",
  );
}

/** Telegram refused a digest message: `unsent` are the events (by number) that were not delivered. */
export class DigestDeliveryError extends Error {
  constructor(readonly unsent: number[]) {
    super("digest delivery failed");
    this.name = "DigestDeliveryError";
  }
}

/** A digest as messages: the header, then one message per topic with its buttons. */
export async function sendScoutOutcome(chatId: number, outcome: ScoutOutcome): Promise<void> {
  const numbers = outcome.kind === "topics" ? outcome.topics.flatMap((topic) => (topic.number === null ? [] : [topic.number])) : [];
  try {
    await sendMessage(chatId, renderDigestHeader(outcome, today()));
  } catch {
    throw new DigestDeliveryError(numbers);
  }
  if (outcome.kind !== "topics") return;
  let index = 1;
  for (const topic of outcome.topics) {
    try {
      await sendMessage(chatId, renderTopic(topic, index), topic.number === null ? {} : { keyboard: topicKeyboard(topic.number) });
    } catch {
      // The topics already sent stay shown; only the rest go back to "new" for the repeated run.
      throw new DigestDeliveryError(outcome.topics.slice(index - 1).flatMap((rest) => (rest.number === null ? [] : [rest.number])));
    }
    index += 1;
  }
}

function topicOf(event: NewsEvent): DigestTopic {
  return {
    number: event.number,
    title: event.titleRu,
    gist: event.gist,
    why: event.why,
    score: event.score,
    scoreReason: event.scoreReason,
    links: event.links,
    firstSeenAt: event.firstSeenAt,
  };
}

/* ---------- /sources ---------- */

const KIND_LABEL: Record<NewsSource["kind"], string> = { rss: "лента", search: "официальный сайт, через поиск" };
const STATE_ICON: Record<string, string> = { ok: "🟢", search: "🔎", empty: "⚪️", blocked: "🔴", unreachable: "🔴", not_feed: "🔴" };

export function renderSources(sources: NewsSource[]): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    "<b>Источники мониторинга</b>",
    "В ежедневный запуск входят только утверждённые (✅). Новые источники выключены, пока вы их не включите. Доступность проверяется с сервера кнопкой ниже.",
    "",
  ];
  for (const source of sources) {
    const state = source.checkState ? `${STATE_ICON[source.checkState] ?? "⚪️"} ${escapeHtml(source.checkDetail ?? "")}` : "⚪️ доступность ещё не проверялась";
    lines.push(
      `<b>${source.number}.</b> ${source.enabled ? "✅" : "⏸"} ${escapeHtml(source.name)} — ${KIND_LABEL[source.kind]}`,
      `   <code>${escapeHtml(source.url)}</code>`,
      `   ${state}`,
    );
  }
  if (sources.length === 0) lines.push("Источников нет.");
  const toggles = sources.map((source) => ({
    text: source.enabled ? `⏸ Выключить ${source.number}` : `✅ Включить ${source.number}`,
    callback_data: `${source.enabled ? "srcoff" : "srcon"}:${source.number}`,
  }));
  const keyboard: InlineKeyboard = [];
  for (let i = 0; i < toggles.length; i += 2) keyboard.push(toggles.slice(i, i + 2));
  keyboard.push([{ text: "🔁 Проверить доступность", callback_data: "srcchk" }]);
  return { text: lines.join("\n"), keyboard };
}

export async function sendSources(chatId: number): Promise<void> {
  const view = renderSources(await listSources());
  await sendMessage(chatId, view.text, { keyboard: view.keyboard });
}

export const SCOUT_ACTIONS = new Set(["srcon", "srcoff", "srcchk", "scw", "sco", "scs", "scr", "scrl"]);

/** What the topic buttons need from the editor's side of the bot (injected, so tests need no bot). */
export interface ScoutDeps {
  fetcher?: Fetcher;
  /** Shows the card of an existing draft. */
  openDraft?: (chatId: number, postId: string) => Promise<void>;
  /** Starts mode A for the draft; returns the reason when it was refused (limits), otherwise null. */
  startRewrite?: (postId: string, importId: string) => Promise<string | null>;
}

const NOT_FOUND = "Тема не найдена";

function withNote(event: NewsEvent, note: string): string {
  return `${renderTopic(topicOf(event), null)}\n\n${note}`;
}

/** "Написать статью": mode A at once, no confirmation; a repeated tap opens the same draft. */
async function writeFromTopic(query: TelegramCallbackQuery, number: number, deps: ScoutDeps): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  const event = Number.isInteger(number) ? await loadEvent(number) : null;
  if (!event) {
    await answerCallback(query.id, NOT_FOUND);
    return;
  }
  const openExisting = async (existing: NewsEvent): Promise<boolean> => {
    if (existing.status !== "in_work" || !existing.postId) return false;
    await answerCallback(query.id, "Статья уже начата");
    await deps.openDraft?.(chatId, existing.postId);
    return true;
  };
  if (await openExisting(event)) return;

  // The draft and its material are created first and attached to the topic by one conditional
  // update: of two simultaneous taps only one keeps its draft, the other removes its own.
  const material = eventMaterial(topicOf(event));
  const post = await createPost(`Новость: ${event.titleRu}`.slice(0, 120));
  let importId: string;
  try {
    importId = await createStartedImport(chatId, {
      postId: post.id,
      sourceText: material.text,
      sourceLabel: `Мониторинг новостей, тема ${event.number}`,
      sourceUrl: material.url,
    });
  } catch {
    await deletePost(post.id).catch(() => undefined);
    await answerCallback(query.id, "Не удалось создать черновик");
    return;
  }
  const claimed = await claimForWork(event.number, post.id);
  if (!claimed) {
    await deletePost(post.id).catch(() => undefined);
    const current = await loadEvent(event.number);
    if (!current || !(await openExisting(current))) await answerCallback(query.id, "Тема уже обрабатывается");
    return;
  }
  await answerCallback(query.id);
  await editMessage(chatId, messageId, withNote(claimed, `✍️ Статья <b>#${post.number}</b> в работе.`), [
    [{ text: `Открыть #${post.number}`, callback_data: `open:${post.number}` }],
  ]);
  const refused = deps.startRewrite ? await deps.startRewrite(post.id, importId) : null;
  if (refused) {
    await sendMessage(chatId, `${refused}\nЧерновик #${post.number} сохранён: его можно запустить позже кнопкой «Написать заново».`);
    return;
  }
  await sendMessage(
    chatId,
    `🔍 Начала статью <b>#${post.number}</b> по теме «${escapeHtml(event.titleRu)}»: ищу первоисточники и проверяю утверждения.\nОбычно это занимает 3–6 минут. Пришлю карточку, когда будет готово.`,
  );
}

/* ---------- /skipped ---------- */

export function renderSkipped(events: NewsEvent[]): { text: string; keyboard: InlineKeyboard } {
  if (events.length === 0) return { text: `Пропущенных тем за ${SKIPPED_DAYS} дней нет.`, keyboard: [] };
  const lines = [
    `<b>Пропущенные темы</b> (за ${SKIPPED_DAYS} дней)`,
    "«Вернуть» отправит тему в следующий дайджест.",
    "",
    ...events.map((event) => `<b>${event.number}.</b> ${escapeHtml(event.titleRu)}`),
  ];
  const keyboard: InlineKeyboard = [];
  for (let i = 0; i < events.length; i += 2) {
    keyboard.push(events.slice(i, i + 2).map((event) => ({ text: `↩️ Вернуть ${event.number}`, callback_data: `scrl:${event.number}` })));
  }
  return { text: lines.join("\n"), keyboard };
}

export async function sendSkipped(chatId: number): Promise<void> {
  const view = renderSkipped(await listSkipped());
  await sendMessage(chatId, view.text, view.keyboard.length ? { keyboard: view.keyboard } : {});
}

async function handleTopicCallback(query: TelegramCallbackQuery, action: string, rawNumber: string, deps: ScoutDeps): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  const number = Number(rawNumber);
  if (action === "scw") {
    await writeFromTopic(query, number, deps);
    return;
  }
  const event = Number.isInteger(number) ? await loadEvent(number) : null;
  if (!event) {
    await answerCallback(query.id, NOT_FOUND);
    return;
  }
  switch (action) {
    case "sco":
      await answerCallback(query.id);
      await sendMessage(chatId, renderSourceLinks({ title: event.titleRu, links: event.links }));
      return;
    case "scs": {
      const skipped = await skipEvent(number);
      if (!skipped) {
        await answerCallback(query.id, event.status === "in_work" ? "Статья уже начата" : "Уже пропущена");
        return;
      }
      await answerCallback(query.id, "Пропущено");
      await editMessage(chatId, messageId, withNote(skipped, "⏭ Пропущено. Тема вернётся, только если появится что-то новое, или по кнопке ниже (/skipped)."), [
        [{ text: "↩️ Вернуть", callback_data: `scr:${number}` }],
      ]);
      return;
    }
    case "scr": {
      const restored = await restoreEvent(number);
      if (!restored) {
        await answerCallback(query.id, "Уже возвращена или в работе");
        return;
      }
      await answerCallback(query.id, "Вернётся в следующий дайджест");
      await editMessage(chatId, messageId, withNote(restored, "↩️ Вернётся в следующий дайджест."));
      return;
    }
    case "scrl": {
      const restored = await restoreEvent(number);
      await answerCallback(query.id, restored ? "Вернётся в следующий дайджест" : "Уже возвращена или в работе");
      const view = renderSkipped(await listSkipped());
      await editMessage(chatId, messageId, view.text, view.keyboard);
      return;
    }
  }
}

export async function handleScoutCallback(
  query: TelegramCallbackQuery,
  action: string,
  rawNumber: string,
  options: ScoutDeps = {},
): Promise<void> {
  if (["scw", "sco", "scs", "scr", "scrl"].includes(action)) {
    await handleTopicCallback(query, action, rawNumber, options);
    return;
  }
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  if (action === "srcchk") {
    await answerCallback(query.id, "Проверяю с сервера…");
    const sources = await listSources();
    await Promise.all(
      sources.map(async (source) => {
        const result = await checkSource(source, options.fetcher);
        await recordSourceCheck(source.id, result.state, result.detail).catch(() => undefined);
      }),
    );
  } else {
    const number = Number(rawNumber);
    const updated = Number.isInteger(number) ? await setSourceEnabled(number, action === "srcon") : null;
    if (!updated) {
      await answerCallback(query.id, "Источник не найден");
      return;
    }
    await answerCallback(query.id, action === "srcon" ? "Источник утверждён" : "Источник выключен");
  }
  const view = renderSources(await listSources());
  await editMessage(chatId, messageId, view.text, view.keyboard);
}

/** The Scout's line in /usage. */
export async function scoutUsageLines(now = new Date()): Promise<string[]> {
  const spent = await scoutSpentSince(cyprusMonthStart(now));
  return [`Мониторинг новостей в этом месяце: ~$${spent.toFixed(2)} из $${editorialLimits().scoutBudgetUsd.toFixed(2)} (входит в общий лимит)`];
}
