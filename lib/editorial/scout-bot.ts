import "server-only";

import type { TelegramCallbackQuery } from "./auth";
import { POST_STATUS_LABEL, publicUrl } from "./cards";
import { editorialLimits, openAiModel, siteOrigin, utilityModel } from "./config";
import { MODEL_PRICES } from "./pricing";
import { startScoutJob } from "./pipeline";
import { checkSource, type Fetcher } from "./scout-sources";
import { cyprusDate } from "./scout";
import {
  eventMaterial,
  renderDigestHeader,
  renderSourceLinks,
  renderTopic,
  TOPIC_STATE_LABEL,
  topicDate,
  topicKeyboard,
  topicState,
  type DigestTopic,
  type ScoutOutcome,
} from "./scout-render";
import {
  claimForWork,
  discardPendingItems,
  lastRealRun,
  listSkipped,
  listSources,
  listTopicsPage,
  loadEvent,
  loadScoutSettings,
  loadTopic,
  recordSourceCheck,
  restoreEvent,
  scoutSpentSince,
  setScoutPaused,
  setSourceEnabled,
  skipEvent,
  SKIPPED_DAYS,
  TOPICS_PAGE,
  type NewsEvent,
  type NewsSource,
  type ScoutSettings,
  type TopicEntry,
} from "./scout-store";
import { createPost, createStartedImport, deletePost, type EditorialPost } from "./store";
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
  if (mode?.toLowerCase() === "menu") {
    await sendScoutMenu(chatId);
    return;
  }
  if (mode && mode.toLowerCase() !== "test") {
    await sendMessage(chatId, "Команды: /scout — мониторинг сейчас, /scout menu — управление (найденные темы, пауза), /scout test — тестовый запуск (ничего не сохраняется), /scout test luna — то же на дешёвой модели для сравнения.");
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
      result.reason === "paused"
        ? "⏸ Мониторинг приостановлен, поэтому поиск не запущен. Возобновить: /scout menu. Платный тестовый запуск без сохранения остаётся доступным: /scout test."
        : result.reason === "done"
          ? "Мониторинг за сегодня уже выполнен, дайджест отправлен. Следующий — завтра в 09:00 по Кипру. Проверить источники без сохранения: /scout test."
          : "Мониторинг уже выполняется. Пришлю результат, как только он будет готов.",
    );
    return;
  }
  await sendMessage(
    chatId,
    test
      ? `🧪 Запускаю тестовый мониторинг${model ? ` (модель <code>${escapeHtml(model)}</code>)` : ""} по всем источникам, включая ещё не утверждённые. Это платный запуск OpenAI, результат не сохраняется. Обычно 2–4 минуты.`
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

export const SCOUT_ACTIONS = new Set(["srcon", "srcoff", "srcchk", "scw", "sco", "scs", "scr", "scrl", "scm", "scpause", "scresume", "sct", "sctc"]);

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

/* ---------- control menu: state, pause, found topics ---------- */

function stampLabel(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Nicosia",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(iso))
    .replace(", ", " ");
}

const RUN_LABEL: Record<string, string> = { done: "выполнен", failed: "не выполнен", running: "идёт" };

export interface ScoutMenuView {
  settings: ScoutSettings;
  lastRun: { runDate: string; status: string; errorCode: string | null } | null;
  enabledSources: number;
  totalSources: number;
  spentLine: string;
}

/** The Scout's control panel: current state of the monitoring and the two actions. */
export function renderScoutMenu(view: ScoutMenuView, note?: string): { text: string; keyboard: InlineKeyboard } {
  const { settings } = view;
  const [year, month, day] = (view.lastRun?.runDate ?? "").split("-");
  const lines = [
    ...(note ? [note, ""] : []),
    "📰 <b>Мониторинг новостей (Scout)</b>",
    settings.paused
      ? `Состояние: ⏸ <b>приостановлен</b>${settings.pausedAt ? ` с ${stampLabel(settings.pausedAt)}` : ""}`
      : "Состояние: ✅ <b>работает</b> — ежедневный запуск в 09:00 по Кипру",
    ...(settings.paused
      ? [
          "Поиск и отбор по расписанию не выполняются, расходов OpenAI нет. Найденные темы, черновики и статьи сохранены и доступны.",
          "Ручной <code>/scout test</code> работает: это платный тестовый запуск, результат не сохраняется.",
        ]
      : []),
    view.lastRun
      ? `Последний запуск: ${day}.${month}.${year} — ${RUN_LABEL[view.lastRun.status] ?? view.lastRun.status}${view.lastRun.errorCode ? ` (${escapeHtml(view.lastRun.errorCode)})` : ""}`
      : "Последний запуск: ещё не было",
    `Утверждённых источников: ${view.enabledSources} из ${view.totalSources} (список: /sources)`,
    escapeHtml(view.spentLine),
  ];
  return {
    text: lines.join("\n"),
    keyboard: [
      [{ text: "🗂 Найденные темы", callback_data: "sct:1" }],
      [settings.paused ? { text: "▶️ Возобновить Scout", callback_data: "scresume" } : { text: "⏸ Приостановить Scout", callback_data: "scpause" }],
    ],
  };
}

async function loadMenuView(): Promise<ScoutMenuView> {
  const [settings, lastRun, sources, spentLines] = await Promise.all([loadScoutSettings(), lastRealRun(), listSources(), scoutUsageLines()]);
  return {
    settings,
    lastRun,
    enabledSources: sources.filter((source) => source.enabled).length,
    totalSources: sources.length,
    spentLine: spentLines[0] ?? "",
  };
}

export async function sendScoutMenu(chatId: number): Promise<void> {
  const view = renderScoutMenu(await loadMenuView());
  await sendMessage(chatId, view.text, { keyboard: view.keyboard });
}

/** «⏸ Приостановить» / «▶️ Возобновить»: sets exactly the state the button names; a repeat changes nothing. */
async function changePause(query: TelegramCallbackQuery, pause: boolean): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  const changed = await setScoutPaused(pause);
  if (changed && !pause) {
    // What was fetched before the pause but never looked at must not come back after it.
    await discardPendingItems().catch(() => console.error("scout: could not close pending items on resume"));
  }
  await answerCallback(query.id, changed ? (pause ? "Мониторинг приостановлен" : "Мониторинг возобновлён") : pause ? "Уже приостановлен" : "Уже работает");
  const note = !changed
    ? undefined
    : pause
      ? "⏸ <b>Scout приостановлен.</b> Расписание Vercel не тронуто, но запуски ничего не делают: ни поиска, ни расходов OpenAI. Если запуск уже шёл, он дойдёт до конца."
      : "▶️ <b>Scout возобновлён.</b> Поиск сейчас не запускается: следующий запуск произойдёт по ближайшему срабатыванию расписания (09:00 или резервное 11:00 по Кипру). Новости, вышедшие за время паузы, не собираются: дайджест будет только по свежим публикациям.";
  const view = renderScoutMenu(await loadMenuView(), note);
  await editMessage(chatId, messageId, view.text, view.keyboard);
}

function topicLabel(entry: TopicEntry): string {
  const label = TOPIC_STATE_LABEL[topicState(entry.event, entry.post)];
  return entry.post && !label.startsWith("🆕") && !label.startsWith("⏭") ? `${label} #${entry.post.number}` : label;
}

export function renderTopics(rows: TopicEntry[], total: number, page: number): { text: string; keyboard: InlineKeyboard } {
  const pages = Math.max(1, Math.ceil(total / TOPICS_PAGE));
  const text = [
    `<b>🗂 Найденные темы (${total})</b>${pages > 1 ? ` · страница ${page} из ${pages}` : ""}`,
    "Сначала новые. Нажмите на тему: описание, источники и действия.",
    "",
    ...rows.map((entry) => `<b>${entry.event.number}.</b> ${escapeHtml(entry.event.titleRu)}\n   ${topicDate(entry.event.firstSeenAt)} · ${topicLabel(entry)}`),
  ].join("\n");
  const keyboard: InlineKeyboard = rows.map((entry) => [
    { text: `${entry.event.number}. ${topicLabel(entry).split(" ")[0]} ${entry.event.titleRu.slice(0, 38)}`, callback_data: `sctc:${entry.event.number}:${page}` },
  ]);
  const nav = [
    ...(page > 1 ? [{ text: "⬅️ Назад", callback_data: `sct:${page - 1}:e` }] : []),
    ...(page < pages ? [{ text: "Далее ➡️", callback_data: `sct:${page + 1}:e` }] : []),
  ];
  if (nav.length) keyboard.push(nav);
  return { text, keyboard };
}

export async function sendTopics(chatId: number, page = 1, messageId?: number): Promise<void> {
  let current = Math.max(1, page);
  let { rows, total } = await listTopicsPage(current, TOPICS_PAGE);
  const pages = Math.max(1, Math.ceil(total / TOPICS_PAGE));
  if (current > pages) {
    current = pages;
    ({ rows, total } = await listTopicsPage(current, TOPICS_PAGE));
  }
  if (total === 0) {
    const text = "Scout пока не предлагал тем.";
    if (messageId) await editMessage(chatId, messageId, text);
    else await sendMessage(chatId, text);
    return;
  }
  const view = renderTopics(rows, total, current);
  if (messageId) await editMessage(chatId, messageId, view.text, view.keyboard);
  else await sendMessage(chatId, view.text, { keyboard: view.keyboard });
}

/** A topic opened from the history: description, state and the actions that fit that state. */
export function renderTopicCard(entry: TopicEntry, origin: string, page: number): { text: string; keyboard: InlineKeyboard } {
  const state = topicState(entry.event, entry.post);
  const { event, post } = entry;
  const number = event.number;
  const articleStatus = post && state === "draft" ? ` (${POST_STATUS_LABEL[post.status]})` : "";
  const text = `${renderTopic(topicOf(event), null)}\n\n<b>Статус:</b> ${topicLabel(entry)}${articleStatus}`;
  const sources = { text: "📎 Открыть источники", callback_data: `sco:${number}` };
  const keyboard: InlineKeyboard = [];
  if (state === "not_started") {
    keyboard.push([{ text: "✍️ Написать статью", callback_data: `scw:${number}` }], [sources, { text: "⏭ Пропустить", callback_data: `scs:${number}` }]);
  } else if (state === "skipped") {
    keyboard.push([{ text: "↩️ Вернуть", callback_data: `scr:${number}` }], [sources]);
  } else if (post) {
    if (state === "published") keyboard.push([{ text: "🔗 Статья на сайте", url: publicUrl(origin, { slug: post.slug } as EditorialPost) }]);
    keyboard.push([{ text: state === "draft" || state === "failed" ? `📝 Открыть черновик #${post.number}` : `📂 Открыть статью #${post.number}`, callback_data: `open:${post.number}` }], [sources]);
  }
  keyboard.push([{ text: "⬅️ К списку", callback_data: `sct:${page}:e` }]);
  return { text, keyboard };
}

async function openTopicCard(query: TelegramCallbackQuery, rawNumber: string, rawPage: string | undefined): Promise<void> {
  const number = Number(rawNumber);
  const entry = Number.isInteger(number) ? await loadTopic(number) : null;
  if (!entry) {
    await answerCallback(query.id, NOT_FOUND);
    return;
  }
  await answerCallback(query.id);
  const view = renderTopicCard(entry, siteOrigin(), Math.max(1, Number(rawPage) || 1));
  await editMessage(query.message!.chat.id, query.message!.message_id, view.text, view.keyboard);
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
  const slot = (query.data ?? "").split(":")[2];
  switch (action) {
    case "scm":
      await answerCallback(query.id);
      await sendScoutMenu(query.message!.chat.id);
      return;
    case "scpause":
    case "scresume":
      await changePause(query, action === "scpause");
      return;
    case "sct":
      await answerCallback(query.id);
      await sendTopics(query.message!.chat.id, Number(rawNumber) || 1, slot === "e" ? query.message!.message_id : undefined);
      return;
    case "sctc":
      await openTopicCard(query, rawNumber, slot);
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
