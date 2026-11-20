import "server-only";

import type { BlogPostStatus } from "@/lib/blog/types";

import type { TelegramCallbackQuery, TelegramMessage } from "./auth";
import { activeImages, hasRussianAndEnglish, postTitle, publicUrl } from "./cards";
import { blockingFailures, failedChecks, formatChecks, type CheckResult } from "./checks";
import { siteOrigin } from "./config";
import {
  approvalFingerprint,
  approvalHash,
  dayButtonLabel,
  decodeDate,
  decodeStamp,
  defaultTimesFor,
  encodeStamp,
  formatNumericDate,
  formatSlot,
  formatSlotWithWeekday,
  groupByDay,
  localDateAfter,
  localSlotOf,
  MAX_SLOTS_PER_DAY,
  MISSED_AFTER_MS,
  MISSING_IMAGES_WARNING,
  newWarnings,
  nextFreeSlots,
  parseDateTimeInput,
  parseTimes,
  pickerTimes,
  planRedistribution,
  pluralArticles,
  SCHEDULE_TIME_ZONE,
  SLOT_PROBLEM_TEXT,
  slotInstant,
  slotProblem,
  STUCK_PUBLISHING_MS,
  type LocalSlot,
  type Move,
} from "./schedule";
import {
  activeEntryForPost,
  claimEntry,
  listActiveEntries,
  listPublishedPage,
  loadSlotTimes,
  markPostPublished,
  moveEntries,
  releaseEntry,
  saveSlotTimes,
  schedulePost,
  setEntryMode,
  type ScheduleEntry,
} from "./schedule-store";
import { loadPost, rememberMessage, type EditorialPost } from "./store";
import { answerCallback, editMessage, escapeHtml, sendMessage, type InlineKeyboard } from "./telegram";

/*
 * The editorial calendar in Telegram: «📅 Запланировать» on a card, the queue (/queue), the
 * publication settings (/settings), the published history (/published) and the scheduled run that
 * publishes due articles. Publishing itself, the checks and the cards come from bot.ts (injected),
 * so this file never re-implements them.
 */

export type PublishOutcome =
  | { status: "published"; post: EditorialPost }
  | { status: "lost" }
  | { status: "failed"; reason: string };

export interface ScheduleDeps {
  adminChatId(): number;
  /** RU + EN pre-publish checks of the post as stored (no network). */
  checks(post: EditorialPost): CheckResult[];
  /** Re-reads the source links and claims, as «Опубликовать» does; returns the refreshed post. */
  recheck(post: EditorialPost): Promise<EditorialPost>;
  sendCard(chatId: number, post: EditorialPost): Promise<void>;
  refreshCard(chatId: number, messageId: number, post: EditorialPost): Promise<void>;
  sendBlocked(chatId: number, post: EditorialPost, blocking: CheckResult[]): Promise<void>;
  /** The existing RU + EN publication: one conditional status change, texts, cache. */
  publish(post: EditorialPost, from: BlogPostStatus[]): Promise<PublishOutcome>;
  /** What follows a publication (the EL/AR translations under the usual rules). */
  afterPublish(chatId: number, post: EditorialPost): Promise<void>;
  listDrafts(chatId: number): Promise<void>;
}

/** Statuses from which an article may be scheduled: the same as for «Опубликовать». */
export const SCHEDULABLE_STATUSES: BlogPostStatus[] = ["review", "paused", "failed"];

export const SCHEDULE_ACTIONS = new Set([
  "pls", "plw", "plq", "plm", "pld", "plt", "plok", "plo", "plx",
  "plup", "pldn", "plrm",
  "plv", "plh", "plset", "pln", "pltm", "plrd", "plrdok",
  "plmenu", "pldr",
]);

const QUEUE_PAGE = 10;
const PUBLISHED_PAGE = 10;
const TZ_LABEL = `Кипр (${SCHEDULE_TIME_ZONE})`;

/* ---------- main menu ---------- */

export const MAIN_MENU: InlineKeyboard = [
  [
    { text: "📝 Черновики", callback_data: "pldr:0" },
    { text: "📅 Расписание", callback_data: "plv:1" },
  ],
  [
    { text: "✅ Опубликовано", callback_data: "plh:1" },
    { text: "⚙️ Настройки публикаций", callback_data: "plset:0" },
  ],
];

/* ---------- approval ---------- */

/** Non-blocking warnings the editor must accept: failed checks and places without a picture. */
export function warningsOf(post: EditorialPost, checks: CheckResult[]): string[] {
  const ids = failedChecks(checks).filter((check) => !check.blocking).map((check) => check.id);
  if (activeImages(post).some((image) => !image.url)) ids.push(MISSING_IMAGES_WARNING);
  return ids;
}

function warningLines(post: EditorialPost, checks: CheckResult[], only?: string[]): string[] {
  const problems = failedChecks(checks).filter((check) => !check.blocking && (!only || only.includes(check.id)));
  const missing = activeImages(post).filter((image) => !image.url);
  const lines: string[] = [];
  if (missing.length && (!only || only.includes(MISSING_IMAGES_WARNING))) {
    lines.push(`⚠️ ${missing.length} мест(а) без картинки (${missing.map((image) => image.slot).join(", ")}): на сайте они будут скрыты`);
  }
  if (problems.length) lines.push(escapeHtml(formatChecks(problems)));
  return lines;
}

type Approval = { ok: true; hash: string; warnings: string[] } | { ok: false; blocking?: CheckResult[]; changed?: boolean };

/** The approval carried by the buttons still matches the article: same text, same warnings, nothing blocking. */
function currentApproval(post: EditorialPost, fingerprint: string, deps: ScheduleDeps): Approval {
  const checks = deps.checks(post);
  const blocking = blockingFailures(checks);
  if (blocking.length > 0) return { ok: false, blocking };
  const hash = approvalHash(post);
  const warnings = warningsOf(post, checks);
  if (approvalFingerprint(hash, warnings) !== fingerprint) return { ok: false, changed: true };
  return { ok: true, hash, warnings };
}

const CHANGED_TEXT = "Статья или её проверки изменились после проверки. Нажмите «📅 Запланировать» в карточке ещё раз.";

function schedulable(post: EditorialPost): boolean {
  return hasRussianAndEnglish(post) && SCHEDULABLE_STATUSES.includes(post.status);
}

/* ---------- scheduling a draft ---------- */

function optionsMessage(post: EditorialPost, fingerprint: string, times: string[]): { text: string; keyboard: InlineKeyboard } {
  const n = post.number;
  return {
    text: [
      `📅 <b>Когда опубликовать #${n}</b> «${escapeHtml(postTitle(post))}»?`,
      "",
      `➕ <b>В очередь</b> — ближайший свободный слот по расписанию (${times.join(", ")}).`,
      "🗓 <b>Своя дата и время</b>.",
      "",
      "Статья выйдет автоматически (RU + EN), EL и AR — как обычно, после публикации. До выхода текст заблокирован; чтобы что-то поправить, уберите её из очереди.",
    ].join("\n"),
    keyboard: [
      [{ text: "➕ Добавить в очередь", callback_data: `plq:${n}:${fingerprint}` }],
      [{ text: "🗓 Выбрать дату и время", callback_data: `plm:${n}:n${fingerprint}` }],
      [{ text: "❌ Отмена", callback_data: `plx:${n}` }],
    ],
  };
}

/** «📅 Запланировать»: the same checks as «Опубликовать», then the choice of a time. */
async function startScheduling(query: TelegramCallbackQuery, post: EditorialPost, deps: ScheduleDeps): Promise<void> {
  const chatId = query.message!.chat.id;
  if (!schedulable(post)) {
    await answerCallback(query.id, post.status === "scheduled" ? "Статья уже в очереди" : "Сейчас запланировать нельзя");
    return;
  }
  await answerCallback(query.id, "Проверяю ссылки и факты…");
  const checked = await deps.recheck(post);
  const checks = deps.checks(checked);
  const blocking = blockingFailures(checks);
  if (blocking.length > 0) {
    await deps.sendBlocked(chatId, checked, blocking);
    return;
  }
  const warnings = warningsOf(checked, checks);
  const fingerprint = approvalFingerprint(approvalHash(checked), warnings);
  if (warnings.length > 0) {
    await sendMessage(
      chatId,
      [
        `Перед планированием #${post.number} обратите внимание:`,
        ...warningLines(checked, checks),
        "",
        "Запланировать всё равно? Статья выйдет автоматически, без повторного вопроса.",
      ].join("\n"),
      {
        keyboard: [
          [{ text: "📅 Да, запланировать", callback_data: `plw:${post.number}:${fingerprint}` }],
          [
            { text: "✏️ Правки", callback_data: `edit:${post.number}` },
            { text: "🖼 Картинки", callback_data: `img:${post.number}` },
          ],
          [{ text: "❌ Отмена", callback_data: `plx:${post.number}` }],
        ],
      },
    );
    return;
  }
  const options = optionsMessage(checked, fingerprint, await loadSlotTimes());
  await sendMessage(chatId, options.text, { keyboard: options.keyboard });
}

function confirmMessage(
  post: EditorialPost,
  at: Date,
  flag: "q" | "n" | "r",
  fingerprint: string,
  previous?: Date,
): { text: string; keyboard: InlineKeyboard } {
  const n = post.number;
  const stamp = encodeStamp(localSlotOf(at));
  const how =
    flag === "q" ? "очередь, ближайший свободный слот" : flag === "n" ? "дата и время выбраны вручную" : "перенос на выбранное время";
  return {
    text: [
      flag === "r" && previous
        ? `🗓 Перенести #${n} «${escapeHtml(postTitle(post))}» с ${formatSlot(previous)} на <b>${formatSlotWithWeekday(at)}</b>?`
        : `📅 #${n} «${escapeHtml(postTitle(post))}» выйдет <b>${formatSlotWithWeekday(at)}</b>.`,
      `Время Кипра (${SCHEDULE_TIME_ZONE}); ${how}.`,
      "Проверка очереди идёт раз в 15 минут, поэтому статья появится на сайте в течение примерно 15 минут после этого времени.",
    ].join("\n"),
    keyboard: [
      [{ text: "✅ Подтвердить", callback_data: `plok:${n}:${flag}${stamp}${fingerprint}` }],
      [
        { text: "🗓 Другое время", callback_data: `plm:${n}:${flag === "r" ? "r" : `n${fingerprint}`}` },
        { text: "❌ Отмена", callback_data: `plx:${n}` },
      ],
    ],
  };
}

function occupiedBy(entries: ScheduleEntry[], at: Date, exceptPostId?: string): ScheduleEntry | undefined {
  return entries.find((entry) => entry.at.getTime() === at.getTime() && entry.postId !== exceptPostId);
}

async function offerQueueSlot(chatId: number, messageId: number, post: EditorialPost, fingerprint: string, note?: string): Promise<void> {
  const [times, entries] = await Promise.all([loadSlotTimes(), listActiveEntries()]);
  const [slot] = nextFreeSlots(times, entries.map((entry) => entry.at.getTime()), new Date());
  if (!slot) {
    await editMessage(chatId, messageId, "Не нашла свободного слота в ближайший год. Проверьте настройки публикаций (/settings).");
    return;
  }
  const confirm = confirmMessage(post, slot, "q", fingerprint);
  await editMessage(chatId, messageId, note ? `${note}\n\n${confirm.text}` : confirm.text, confirm.keyboard);
}

function dayPicker(post: EditorialPost, flag: "n" | "r", fingerprint: string): { text: string; keyboard: InlineKeyboard } {
  const now = new Date();
  const days = Array.from({ length: 8 }, (_, offset) => localDateAfter(now, offset));
  const buttons = days.map((date) => ({
    text: dayButtonLabel(date),
    callback_data: `pld:${post.number}:${flag}${date.replace(/-/g, "")}${fingerprint}`,
  }));
  const rows: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 4) rows.push(buttons.slice(i, i + 4));
  return {
    text: `🗓 <b>#${post.number}</b>: выберите день публикации (время Кипра).\nДругая дата — кнопкой «✍️ Ввести вручную».`,
    keyboard: [
      ...rows,
      [{ text: "✍️ Ввести вручную", callback_data: `plo:${post.number}:${flag}${fingerprint}` }],
      [{ text: "❌ Отмена", callback_data: `plx:${post.number}` }],
    ],
  };
}

async function timePicker(post: EditorialPost, flag: "n" | "r", date: string, fingerprint: string): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const now = new Date();
  const [times, entries] = await Promise.all([loadSlotTimes(), listActiveEntries()]);
  const offered = pickerTimes(times).filter((time) => slotProblem({ date, time }, now) === null);
  const buttons = offered.map((time) => {
    const instant = slotInstant({ date, time })!;
    const taken = occupiedBy(entries, instant, post.id);
    return {
      text: taken ? `🔒 ${time}` : time,
      callback_data: `plt:${post.number}:${flag}${encodeStamp({ date, time })}${fingerprint}`,
    };
  });
  const rows: InlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 4) rows.push(buttons.slice(i, i + 4));
  const noon = slotInstant({ date, time: "12:00" }) ?? now;
  return {
    text: [
      `🗓 <b>#${post.number}</b>, ${formatSlot(noon).split(",")[0]}: выберите время (Кипр).`,
      offered.length === 0 ? "На этот день свободного времени уже не осталось — выберите другой день." : "🔒 — время уже занято другой статьёй.",
      "Нужное время не в списке — «✍️ Ввести вручную».",
    ].join("\n"),
    keyboard: [
      ...rows,
      [
        { text: "⬅️ Другой день", callback_data: `plm:${post.number}:${flag}${fingerprint}` },
        { text: "✍️ Ввести вручную", callback_data: `plo:${post.number}:${flag}${fingerprint}` },
      ],
      [{ text: "❌ Отмена", callback_data: `plx:${post.number}` }],
    ],
  };
}

/** Checks that a chosen slot is usable; returns the instant, or the reason it is not. */
async function usableSlot(post: EditorialPost, slot: LocalSlot): Promise<{ ok: true; at: Date } | { ok: false; reason: string }> {
  const problem = slotProblem(slot, new Date());
  if (problem) return { ok: false, reason: SLOT_PROBLEM_TEXT[problem] };
  const at = slotInstant(slot)!;
  const taken = occupiedBy(await listActiveEntries(), at, post.id);
  if (taken) return { ok: false, reason: `${formatSlot(at)} уже занято статьёй #${taken.postNumber}. Выберите другое время.` };
  return { ok: true, at };
}

/** A typed date or a chosen time: show what will happen and ask to confirm. */
async function showConfirmation(
  chatId: number,
  post: EditorialPost,
  flag: "n" | "r",
  slot: LocalSlot,
  fingerprint: string,
  messageId?: number,
): Promise<void> {
  const usable = await usableSlot(post, slot);
  if (!usable.ok) {
    if (messageId) {
      const picker = await timePicker(post, flag, slot.date, fingerprint);
      await editMessage(chatId, messageId, `⚠️ ${escapeHtml(usable.reason)}\n\n${picker.text}`, picker.keyboard);
    } else {
      await sendMessage(chatId, `⚠️ ${escapeHtml(usable.reason)}`);
    }
    return;
  }
  const previous = flag === "r" ? (await activeEntryForPost(post.id))?.at : undefined;
  const confirm = confirmMessage(post, usable.at, flag, fingerprint, previous);
  if (messageId) await editMessage(chatId, messageId, confirm.text, confirm.keyboard);
  else await sendMessage(chatId, confirm.text, { keyboard: confirm.keyboard });
}

async function commitNew(query: TelegramCallbackQuery, post: EditorialPost, flag: "q" | "n", slot: LocalSlot, fingerprint: string, deps: ScheduleDeps) {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  if (post.status === "scheduled") {
    await answerCallback(query.id, "Уже в очереди");
    return;
  }
  if (!schedulable(post)) {
    await answerCallback(query.id, "Сейчас запланировать нельзя");
    return;
  }
  const approval = currentApproval(post, fingerprint, deps);
  if (!approval.ok) {
    await answerCallback(query.id);
    if (approval.blocking) await deps.sendBlocked(chatId, post, approval.blocking);
    else await editMessage(chatId, messageId, CHANGED_TEXT);
    return;
  }
  const problem = slotProblem(slot, new Date());
  if (problem) {
    await answerCallback(query.id);
    if (flag === "q") await offerQueueSlot(chatId, messageId, post, fingerprint, "⚠️ Этот слот уже прошёл. Предлагаю следующий:");
    else await editMessage(chatId, messageId, `⚠️ ${SLOT_PROBLEM_TEXT[problem]}`, dayPicker(post, "n", fingerprint).keyboard);
    return;
  }
  const at = slotInstant(slot)!;
  const result = await schedulePost({
    postId: post.id,
    at,
    mode: flag === "q" ? "queue" : "manual",
    hash: approval.hash,
    warnings: approval.warnings,
    from: SCHEDULABLE_STATUSES,
  });
  if (result === "slot_taken") {
    await answerCallback(query.id);
    if (flag === "q") await offerQueueSlot(chatId, messageId, post, fingerprint, "⚠️ Этот слот только что заняла другая статья. Ближайший свободный:");
    else await editMessage(chatId, messageId, `⚠️ ${formatSlot(at)} уже занято другой статьёй. Выберите другое время.`, dayPicker(post, "n", fingerprint).keyboard);
    return;
  }
  if (result !== "ok") {
    await answerCallback(query.id, result === "post_taken" ? "Уже в очереди" : result === "past" ? "Время уже прошло" : "Статус статьи изменился");
    return;
  }
  await answerCallback(query.id, "Запланировано");
  await editMessage(chatId, messageId, `📅 Статья #${post.number} запланирована на ${formatSlot(at)}.`);
  const fresh = await loadPost({ id: post.id });
  if (fresh) await deps.sendCard(chatId, fresh);
}

async function commitMove(query: TelegramCallbackQuery, post: EditorialPost, slot: LocalSlot, deps: ScheduleDeps) {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  const entry = await activeEntryForPost(post.id);
  if (!entry || entry.status !== "scheduled") {
    await answerCallback(query.id, entry ? "Статья уже публикуется" : "Статьи нет в очереди");
    return;
  }
  const usable = await usableSlot(post, slot);
  if (!usable.ok) {
    await answerCallback(query.id);
    await editMessage(chatId, messageId, `⚠️ ${escapeHtml(usable.reason)}`, dayPicker(post, "r", "").keyboard);
    return;
  }
  const result = await moveEntries([{ id: entry.id, to: usable.at }]);
  if (result !== "ok") {
    await answerCallback(query.id, result === "slot_taken" ? "Это время уже занято" : "Статья уже публикуется или убрана из очереди");
    return;
  }
  // A time chosen by hand stays where it is when the queue is redistributed.
  await setEntryMode(entry.id, "manual");
  await answerCallback(query.id, "Перенесено");
  await editMessage(chatId, messageId, `🗓 #${post.number} перенесена: теперь ${formatSlot(usable.at)} (было ${formatSlot(entry.at)}).`);
  const fresh = await loadPost({ id: post.id });
  if (fresh) await deps.sendCard(chatId, fresh);
}

/* ---------- managing the queue ---------- */

async function unschedule(query: TelegramCallbackQuery, post: EditorialPost, deps: ScheduleDeps): Promise<void> {
  const chatId = query.message!.chat.id;
  const entry = await activeEntryForPost(post.id);
  if (!entry) {
    await answerCallback(query.id, "Статьи нет в очереди");
    return;
  }
  const released = await releaseEntry(entry.id, ["scheduled"], "cancelled", { error: "убрана из очереди редактором", revertPost: true });
  if (!released) {
    await answerCallback(query.id, "Статья уже публикуется");
    return;
  }
  await answerCallback(query.id, "Убрана из очереди");
  await sendMessage(
    chatId,
    `❌ #${post.number} убрана из очереди (было ${formatSlot(entry.at)}). Статья и переводы сохранены, она снова на проверке и её можно править.`,
  );
  const fresh = await loadPost({ id: post.id });
  if (fresh) await deps.refreshCard(chatId, query.message!.message_id, fresh);
}

async function swapWithNeighbour(query: TelegramCallbackQuery, post: EditorialPost, direction: -1 | 1, deps: ScheduleDeps): Promise<void> {
  const chatId = query.message!.chat.id;
  const entries = (await listActiveEntries()).filter((entry) => entry.status === "scheduled");
  const index = entries.findIndex((entry) => entry.postId === post.id);
  if (index < 0) {
    await answerCallback(query.id, "Статьи нет в очереди");
    return;
  }
  const other = entries[index + direction];
  if (!other) {
    await answerCallback(query.id, direction < 0 ? "Уже первая в очереди" : "Уже последняя в очереди");
    return;
  }
  const mine = entries[index];
  const result = await moveEntries([
    { id: mine.id, to: other.at },
    { id: other.id, to: mine.at },
  ]);
  if (result !== "ok") {
    await answerCallback(query.id, "Очередь изменилась, откройте её заново");
    return;
  }
  await answerCallback(query.id, `Поменяла местами с #${other.postNumber}`);
  await sendMessage(
    chatId,
    `🔀 #${post.number} теперь ${formatSlot(other.at)}, #${other.postNumber} — ${formatSlot(mine.at)}.`,
  );
  const fresh = await loadPost({ id: post.id });
  if (fresh) await deps.refreshCard(chatId, query.message!.message_id, fresh);
}

export function renderQueue(entries: ScheduleEntry[], times: string[], page: number): { text: string; keyboard: InlineKeyboard } {
  const pages = Math.max(1, Math.ceil(entries.length / QUEUE_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const shown = entries.slice((current - 1) * QUEUE_PAGE, current * QUEUE_PAGE);
  const lines = [
    "📅 <b>Расписание публикаций</b>",
    `Режим: ${pluralArticles(times.length)} в день (${times.join(", ")})`,
    `Часовой пояс: ${TZ_LABEL}`,
  ];
  if (entries.length === 0) {
    lines.push("", "Очередь пуста. В карточке статьи на проверке нажмите «📅 Запланировать».");
  }
  for (const group of groupByDay(shown)) {
    lines.push("", `<b>${group.heading}</b>`);
    for (const entry of group.items) {
      const mark = entry.status === "publishing" ? " ⏳ публикуется" : entry.mode === "manual" ? " ✋" : "";
      lines.push(`• ${localSlotOf(entry.at).time} — #${entry.postNumber} ${escapeHtml(entry.title.slice(0, 70))}${mark}`);
    }
  }
  if (entries.length > 0) {
    lines.push("", `В очереди: ${pluralArticles(entries.length)}.${pages > 1 ? ` Страница ${current} из ${pages}.` : ""}`);
    if (entries.some((entry) => entry.mode === "manual")) lines.push("✋ — время выбрано вручную.");
    lines.push("Нажмите на статью, чтобы перенести, поменять порядок, убрать из очереди или опубликовать сейчас.");
  }
  const keyboard: InlineKeyboard = shown.map((entry) => [
    { text: `${formatSlot(entry.at)} · #${entry.postNumber} ${entry.title.slice(0, 28)}`, callback_data: `open:${entry.postNumber}` },
  ]);
  const nav = [
    ...(current > 1 ? [{ text: "⬅️", callback_data: `plv:${current - 1}:e` }] : []),
    ...(current < pages ? [{ text: "➡️", callback_data: `plv:${current + 1}:e` }] : []),
  ];
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: "⚙️ Настройки публикаций", callback_data: "plset:0" }]);
  return { text: lines.join("\n"), keyboard };
}

export async function sendQueue(chatId: number, page = 1, messageId?: number): Promise<void> {
  const [entries, times] = await Promise.all([listActiveEntries(), loadSlotTimes()]);
  const view = renderQueue(entries, times, page);
  if (messageId) await editMessage(chatId, messageId, view.text, view.keyboard);
  else await sendMessage(chatId, view.text, { keyboard: view.keyboard });
}

/* ---------- published history ---------- */

export async function sendPublished(chatId: number, page = 1, messageId?: number): Promise<void> {
  const { rows, total } = await listPublishedPage(Math.max(1, page), PUBLISHED_PAGE);
  if (total === 0) {
    const text = "Опубликованных статей пока нет.";
    if (messageId) await editMessage(chatId, messageId, text);
    else await sendMessage(chatId, text);
    return;
  }
  const pages = Math.max(1, Math.ceil(total / PUBLISHED_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const origin = siteOrigin();
  const text = [
    `<b>✅ Опубликовано (${total})</b>${pages > 1 ? ` · страница ${current} из ${pages}` : ""}`,
    "Сначала новые. Ссылка ведёт на статью на сайте, кнопка — на её карточку.",
    "",
    ...rows.map((row) => {
      const date = row.publishedAt ? formatNumericDate(new Date(row.publishedAt)) : "дата неизвестна";
      const url = publicUrl(origin, { slug: row.slug } as EditorialPost);
      return `#${row.number} · ${date} · <a href="${escapeHtml(url)}">${escapeHtml(row.title.slice(0, 70))}</a>`;
    }),
  ].join("\n");
  const keyboard: InlineKeyboard = rows.map((row) => [{ text: `#${row.number} · ${row.title.slice(0, 40)}`, callback_data: `open:${row.number}` }]);
  const nav = [
    ...(current > 1 ? [{ text: "⬅️ Новее", callback_data: `plh:${current - 1}:e` }] : []),
    ...(current < pages ? [{ text: "Старше ➡️", callback_data: `plh:${current + 1}:e` }] : []),
  ];
  if (nav.length) keyboard.push(nav);
  if (messageId) await editMessage(chatId, messageId, text, keyboard);
  else await sendMessage(chatId, text, { keyboard });
}

/* ---------- settings ---------- */

function settingsView(times: string[], queued: number, note?: string): { text: string; keyboard: InlineKeyboard } {
  const counts = Array.from({ length: MAX_SLOTS_PER_DAY }, (_, index) => index + 1);
  return {
    text: [
      ...(note ? [note, ""] : []),
      "⚙️ <b>Настройки публикаций</b>",
      `Публикаций в день: <b>${times.length}</b>`,
      `Время: <b>${times.join(", ")}</b>`,
      `Часовой пояс: ${TZ_LABEL} — летнее и зимнее время учитываются, 10:00 всегда 10:00 по Кипру.`,
      `В очереди сейчас: ${pluralArticles(queued)}.`,
      "",
      "Количество — кнопками ниже (время подставится стандартное), своё время — «🕒 Изменить время».",
      "Уже запланированные статьи при смене настроек остаются на своих датах; перенести их на новые слоты можно кнопкой «♻️ Перераспределить очередь».",
    ].join("\n"),
    keyboard: [
      counts.map((count) => ({ text: count === times.length ? `• ${count} •` : String(count), callback_data: `pln:${count}` })),
      [{ text: "🕒 Изменить время", callback_data: "pltm:0" }],
      ...(queued > 0 ? [[{ text: "♻️ Перераспределить очередь", callback_data: "plrd:0" }]] : []),
      [{ text: "📅 Расписание", callback_data: "plv:1" }],
    ],
  };
}

export async function sendSettings(chatId: number, messageId?: number, note?: string): Promise<void> {
  const [times, entries] = await Promise.all([loadSlotTimes(), listActiveEntries()]);
  const view = settingsView(times, entries.length, note);
  if (messageId) await editMessage(chatId, messageId, view.text, view.keyboard);
  else await sendMessage(chatId, view.text, { keyboard: view.keyboard });
}

function savedNote(times: string[], queued: number): string {
  return `✅ Сохранено: ${times.length} в день, ${times.join(", ")}.${queued > 0 ? ` Уже запланированные статьи (${queued}) остались на своих датах.` : ""}`;
}

function planCode(moves: Move[]): string {
  return approvalFingerprint(moves.map((move) => `${move.id}@${move.to.toISOString()}`).join(";"), []);
}

async function previewRedistribution(chatId: number, messageId: number): Promise<void> {
  const [times, entries] = await Promise.all([loadSlotTimes(), listActiveEntries()]);
  const scheduled = entries.filter((entry) => entry.status === "scheduled");
  const moves = planRedistribution(scheduled, times, new Date()).filter((move) => move.from.getTime() !== move.to.getTime());
  if (moves.length === 0) {
    await editMessage(chatId, messageId, "♻️ Все статьи очереди уже стоят на слотах текущего расписания — переносить нечего.", [[{ text: "📅 Расписание", callback_data: "plv:1" }]]);
    return;
  }
  const byId = new Map(scheduled.map((entry) => [entry.id, entry]));
  await editMessage(
    chatId,
    messageId,
    [
      "♻️ <b>Перераспределить очередь по новому расписанию?</b>",
      "Статьи с временем, выбранным вручную, не трогаю.",
      "",
      ...moves.map((move) => `#${byId.get(move.id)!.postNumber}: ${formatSlot(move.from)} → <b>${formatSlot(move.to)}</b>`),
    ].join("\n"),
    [
      [{ text: "✅ Перенести", callback_data: `plrdok:${planCode(moves)}` }],
      [{ text: "❌ Оставить как есть", callback_data: "plset:0" }],
    ],
  );
}

async function applyRedistribution(query: TelegramCallbackQuery, code: string): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  const [times, entries] = await Promise.all([loadSlotTimes(), listActiveEntries()]);
  const scheduled = entries.filter((entry) => entry.status === "scheduled");
  const moves = planRedistribution(scheduled, times, new Date()).filter((move) => move.from.getTime() !== move.to.getTime());
  if (moves.length === 0 || planCode(moves) !== code) {
    await answerCallback(query.id, "Очередь изменилась");
    await previewRedistribution(chatId, messageId);
    return;
  }
  const result = await moveEntries(moves.map((move) => ({ id: move.id, to: move.to })));
  if (result !== "ok") {
    await answerCallback(query.id, "Очередь изменилась");
    await previewRedistribution(chatId, messageId);
    return;
  }
  await answerCallback(query.id, "Перенесено");
  await sendQueue(chatId, 1, messageId);
}

async function setCount(query: TelegramCallbackQuery, count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SLOTS_PER_DAY) {
    await answerCallback(query.id);
    return;
  }
  const times = defaultTimesFor(count);
  await saveSlotTimes(times);
  await answerCallback(query.id, "Сохранено");
  const queued = (await listActiveEntries()).length;
  await sendSettings(query.message!.chat.id, query.message!.message_id, savedNote(times, queued));
}

/* ---------- replies (typed dates and times) ---------- */

export async function handleScheduleReply(
  message: TelegramMessage,
  context: { postId: string | null; slot: string | null },
): Promise<void> {
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();
  if (context.slot === "times") {
    const parsed = parseTimes(text);
    if (!parsed.ok) {
      const sent = await sendMessage(chatId, `⚠️ ${escapeHtml(parsed.reason)}\nОтветьте на это сообщение ещё раз.`, { forceReply: true });
      await rememberMessage(chatId, sent.message_id, "schedule", null, { slot: "times" });
      return;
    }
    await saveSlotTimes(parsed.times);
    const queued = (await listActiveEntries()).length;
    await sendSettings(chatId, undefined, savedNote(parsed.times, queued));
    return;
  }
  const post = context.postId ? await loadPost({ id: context.postId }) : null;
  const flag = context.slot?.charAt(0);
  if (!post || (flag !== "n" && flag !== "r")) {
    await sendMessage(chatId, "Эта статья уже удалена.");
    return;
  }
  const fingerprint = context.slot!.slice(2);
  const parsed = parseDateTimeInput(text, new Date());
  if (!parsed.ok) {
    const sent = await sendMessage(chatId, `⚠️ ${escapeHtml(parsed.reason)}\nОтветьте на это сообщение ещё раз.`, { forceReply: true });
    await rememberMessage(chatId, sent.message_id, "schedule", post.id, { slot: context.slot! });
    return;
  }
  await showConfirmation(chatId, post, flag, parsed.slot, fingerprint);
}

/* ---------- buttons ---------- */

function splitFlagged(raw: string): { flag: string; rest: string } {
  return { flag: raw.charAt(0), rest: raw.slice(1) };
}

export async function handleScheduleCallback(query: TelegramCallbackQuery, action: string, raw: string, slot: string | undefined, deps: ScheduleDeps): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;

  // Lists and settings: no article involved.
  switch (action) {
    case "plmenu":
      await answerCallback(query.id);
      await sendMessage(chatId, "Главное меню:", { keyboard: MAIN_MENU });
      return;
    case "pldr":
      await answerCallback(query.id);
      await deps.listDrafts(chatId);
      return;
    case "plv":
      await answerCallback(query.id);
      // Page buttons of the list itself edit it; the menu and cards open a new message.
      await sendQueue(chatId, Number(raw) || 1, slot === "e" ? messageId : undefined);
      return;
    case "plh":
      await answerCallback(query.id);
      await sendPublished(chatId, Number(raw) || 1, slot === "e" ? messageId : undefined);
      return;
    case "plset":
      await answerCallback(query.id);
      await sendSettings(chatId);
      return;
    case "pln":
      await setCount(query, Number(raw));
      return;
    case "pltm": {
      await answerCallback(query.id);
      const times = await loadSlotTimes();
      const sent = await sendMessage(
        chatId,
        `🕒 Сейчас: ${times.join(", ")}.\nОтветьте на это сообщение новым временем через запятую, например <code>09:30, 13:00, 18:00</code>. Минуты — 00, 15, 30 или 45; до ${MAX_SLOTS_PER_DAY} публикаций в день. Время Кипра.`,
        { forceReply: true },
      );
      await rememberMessage(chatId, sent.message_id, "schedule", null, { slot: "times" });
      return;
    }
    case "plrd":
      await answerCallback(query.id);
      await previewRedistribution(chatId, messageId);
      return;
    case "plrdok":
      await applyRedistribution(query, raw);
      return;
  }

  const number = Number(raw);
  const post = Number.isInteger(number) ? await loadPost({ number }) : null;
  if (!post) {
    await answerCallback(query.id, "Статья не найдена");
    return;
  }
  const flagged = splitFlagged(slot ?? "");

  switch (action) {
    case "pls":
      await startScheduling(query, post, deps);
      return;

    case "plw": {
      // After the warnings, or «Назад»: the choice between the queue and a date.
      await answerCallback(query.id);
      if (!schedulable(post)) return;
      const approval = currentApproval(post, slot ?? "", deps);
      if (!approval.ok) {
        if (approval.blocking) await deps.sendBlocked(chatId, post, approval.blocking);
        else await editMessage(chatId, messageId, CHANGED_TEXT);
        return;
      }
      const options = optionsMessage(post, slot ?? "", await loadSlotTimes());
      await editMessage(chatId, messageId, options.text, options.keyboard);
      return;
    }

    case "plq": {
      await answerCallback(query.id);
      if (!schedulable(post)) return;
      if (!currentApproval(post, slot ?? "", deps).ok) {
        await editMessage(chatId, messageId, CHANGED_TEXT);
        return;
      }
      await offerQueueSlot(chatId, messageId, post, slot ?? "");
      return;
    }

    case "plm": {
      await answerCallback(query.id);
      if (flagged.flag !== "n" && flagged.flag !== "r") return;
      if (flagged.flag === "r" && post.status !== "scheduled") {
        await sendMessage(chatId, `#${post.number} не в очереди.`);
        return;
      }
      const picker = dayPicker(post, flagged.flag, flagged.rest);
      // From the options message it replaces them; from a card it opens next to it.
      if (flagged.flag === "n") await editMessage(chatId, messageId, picker.text, picker.keyboard);
      else await sendMessage(chatId, picker.text, { keyboard: picker.keyboard });
      return;
    }

    case "pld": {
      await answerCallback(query.id);
      if (flagged.flag !== "n" && flagged.flag !== "r") return;
      const date = decodeDate(flagged.rest.slice(0, 8));
      if (!date) return;
      const picker = await timePicker(post, flagged.flag, date, flagged.rest.slice(8));
      await editMessage(chatId, messageId, picker.text, picker.keyboard);
      return;
    }

    case "plt": {
      await answerCallback(query.id);
      if (flagged.flag !== "n" && flagged.flag !== "r") return;
      const local = decodeStamp(flagged.rest.slice(0, 12));
      if (!local) return;
      await showConfirmation(chatId, post, flagged.flag, local, flagged.rest.slice(12), messageId);
      return;
    }

    case "plo": {
      await answerCallback(query.id);
      if (flagged.flag !== "n" && flagged.flag !== "r") return;
      const sent = await sendMessage(
        chatId,
        `✍️ #${post.number}: напишите дату и время публикации ответом на это сообщение, например <code>25.11 10:30</code> (время Кипра; минуты 00, 15, 30 или 45).`,
        { forceReply: true },
      );
      await rememberMessage(chatId, sent.message_id, "schedule", post.id, { slot: `${flagged.flag}|${flagged.rest}` });
      return;
    }

    case "plok": {
      const local = decodeStamp(flagged.rest.slice(0, 12));
      if (!local || !["q", "n", "r"].includes(flagged.flag)) {
        await answerCallback(query.id);
        return;
      }
      if (flagged.flag === "r") await commitMove(query, post, local, deps);
      else await commitNew(query, post, flagged.flag as "q" | "n", local, flagged.rest.slice(12), deps);
      return;
    }

    case "plx":
      await answerCallback(query.id, "Отменено");
      await editMessage(chatId, messageId, `Планирование отменено, #${post.number} без изменений.`, [[{ text: `Открыть #${post.number}`, callback_data: `open:${post.number}` }]]);
      return;

    case "plrm":
      await unschedule(query, post, deps);
      return;

    case "plup":
    case "pldn":
      await swapWithNeighbour(query, post, action === "plup" ? -1 : 1, deps);
      return;
  }
  await answerCallback(query.id);
}

/* ---------- the scheduled run ---------- */

export interface RunSummary {
  published: number[];
  failed: number[];
  missed: number[];
  recovered: number[];
}

async function notify(deps: ScheduleDeps, text: string, keyboard?: InlineKeyboard): Promise<void> {
  // The outcome is already stored with the entry; a Telegram failure must not change it.
  try {
    await sendMessage(deps.adminChatId(), text, keyboard ? { keyboard } : {});
  } catch (error) {
    console.error("editorial: schedule notification failed", error instanceof Error ? error.message : error);
  }
}

function articleButtons(number: number): InlineKeyboard {
  return [[
    { text: `Открыть #${number}`, callback_data: `open:${number}` },
    { text: "🔎 Факты", callback_data: `facts:${number}` },
  ]];
}

async function failEntry(entry: ScheduleEntry, title: string, reason: string, deps: ScheduleDeps, from: ScheduleEntry["status"][] = ["publishing"]): Promise<void> {
  await releaseEntry(entry.id, from, "failed", {
    error: reason,
    revertPost: true,
    postError: `Автопубликация ${formatSlot(entry.at)} не выполнена: ${reason}`,
  });
  await notify(
    deps,
    [
      `⚠️ Не удалось опубликовать статью #${entry.postNumber} «${escapeHtml(title)}» (по расписанию ${formatSlot(entry.at)}).`,
      `Причина: ${escapeHtml(reason)}`,
      "",
      "Статья не опубликована, убрана из очереди и вернулась на проверку. Исправьте её при необходимости и запланируйте снова — автоматически она больше не выйдет.",
    ].join("\n"),
    articleButtons(entry.postNumber),
  );
}

/**
 * Publishes one claimed entry with the same checks and the same publication as the button.
 * Two phases: deciding and publishing (any refusal or error there returns the article to review),
 * then, only once the article is live, closing the entry and the notifications — nothing in the
 * second phase can mark the entry failed, revert the article or report a failed publication.
 */
async function publishEntry(entry: ScheduleEntry, deps: ScheduleDeps, summary: RunSummary): Promise<void> {
  const post = await loadPost({ id: entry.postId });
  if (!post) {
    await releaseEntry(entry.id, ["publishing"], "failed", { error: "статья удалена" });
    return;
  }
  const title = postTitle(post);
  if (post.status !== "scheduled") {
    // Published by hand, or moved some other way: nothing to do, nothing to undo.
    await releaseEntry(entry.id, ["publishing"], "cancelled", { error: `при запуске статус статьи: ${post.status}` });
    return;
  }
  const live = await attemptPublication(entry, post, title, deps, summary);
  if (live) await afterPublication(entry, live, deps, summary);
}

/** Phase 1. Returns the published article, or null when it was refused or failed (already handled). */
async function attemptPublication(
  entry: ScheduleEntry,
  post: EditorialPost,
  title: string,
  deps: ScheduleDeps,
  summary: RunSummary,
): Promise<EditorialPost | null> {
  const refuse = async (reason: string) => {
    await failEntry(entry, title, reason, deps);
    summary.failed.push(entry.postNumber);
    return null;
  };
  try {
    if (approvalHash(post) !== entry.approvedHash) {
      return await refuse("текст RU/EN или картинки изменились после одобрения — нужна повторная проверка и подтверждение");
    }
    const checked = await deps.recheck(post);
    const checks = deps.checks(checked);
    const blocking = blockingFailures(checks);
    if (blocking.length > 0) {
      return await refuse(`блокирующие проверки не пройдены: ${blocking.map((check) => check.label).join("; ")}`);
    }
    const added = newWarnings(entry.approvedWarnings, warningsOf(checked, checks));
    if (added.length > 0) {
      const lines = warningLines(checked, checks, added).join("\n").replace(/<[^>]+>/g, "");
      return await refuse(`появились новые предупреждения, которых не было при одобрении:\n${lines}`);
    }
    const outcome = await deps.publish(checked, ["scheduled"]);
    if (outcome.status === "lost") {
      await releaseEntry(entry.id, ["publishing"], "cancelled", { error: "статус статьи изменился во время публикации" });
      return null;
    }
    if (outcome.status === "failed") return await refuse(`техническая ошибка при публикации: ${outcome.reason.slice(0, 300)}`);
    return outcome.post;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("editorial: scheduled publication failed", reason);
    // An error after the article went live (e.g. reading it back) is not a failed publication.
    const current = await loadPost({ id: post.id }).catch(() => null);
    if (current?.status === "published") return current;
    return await refuse(`техническая ошибка: ${reason.slice(0, 300)}`).catch(() => null);
  }
}

/** Phase 2: the article is live. Every step is on its own; a failure is only logged. */
async function afterPublication(entry: ScheduleEntry, live: EditorialPost, deps: ScheduleDeps, summary: RunSummary): Promise<void> {
  summary.published.push(entry.postNumber);
  // If closing the entry fails, the next run finds it «publishing» with a published article and
  // closes it then; it is never published again.
  await markPostPublished(live.id).catch((error) =>
    console.error("editorial: closing a schedule entry failed", error instanceof Error ? error.message : error),
  );
  try {
    const origin = siteOrigin();
    await notify(
      deps,
      `✅ Статья #${entry.postNumber} опубликована по расписанию: <b>${escapeHtml(postTitle(live))}</b>\n${escapeHtml(publicUrl(origin, live, "ru"))}\n${escapeHtml(publicUrl(origin, live, "en"))}`,
      [[{ text: `Открыть #${entry.postNumber}`, callback_data: `open:${entry.postNumber}` }]],
    );
  } catch (error) {
    console.error("editorial: publication notice failed", error instanceof Error ? error.message : error);
  }
  try {
    await deps.afterPublish(deps.adminChatId(), live);
  } catch (error) {
    console.error("editorial: translations after scheduled publication failed", error instanceof Error ? error.message : error);
  }
}

/**
 * One scheduler call: finish interrupted publications, set aside slots that were missed for too
 * long (the editor decides), then publish at most one due article. Safe to call repeatedly or
 * twice at once: every step is a conditional update.
 */
export async function runDuePublications(deps: ScheduleDeps, now = new Date()): Promise<RunSummary> {
  const summary: RunSummary = { published: [], failed: [], missed: [], recovered: [] };
  const entries = await listActiveEntries();

  // 1. A publication that started and never finished (the function was killed).
  for (const entry of entries.filter((e) => e.status === "publishing" && e.claimedAt && now.getTime() - e.claimedAt.getTime() > STUCK_PUBLISHING_MS)) {
    const post = await loadPost({ id: entry.postId });
    if (post?.status === "published") {
      await markPostPublished(entry.postId, "публикация подтверждена после сбоя");
      summary.recovered.push(entry.postNumber);
      await notify(deps, `✅ #${entry.postNumber} была опубликована по расписанию (${formatSlot(entry.at)}); запуск прервался после публикации, запись исправлена.`);
    } else {
      await failEntry(entry, post ? postTitle(post) : entry.title, "публикация прервалась из-за сбоя сервера; статья не опубликована", deps);
      summary.failed.push(entry.postNumber);
    }
  }

  // 2. Slots missed by far more than the scheduler's normal delay: never published late on their own.
  const missed = entries.filter((e) => e.status === "scheduled" && now.getTime() - e.at.getTime() > MISSED_AFTER_MS);
  for (const entry of missed) {
    const released = await releaseEntry(entry.id, ["scheduled"], "missed", {
      error: "планировщик не запустился вовремя",
      revertPost: true,
      postError: `Публикация по расписанию ${formatSlot(entry.at)} пропущена (сбой планировщика).`,
    });
    if (released) summary.missed.push(entry.postNumber);
  }
  if (summary.missed.length > 0) {
    const shown = missed.filter((entry) => summary.missed.includes(entry.postNumber)).slice(0, 10);
    await notify(
      deps,
      [
        "⏰ Пропущены публикации по расписанию — планировщик не запустился вовремя:",
        ...shown.map((entry) => `• #${entry.postNumber} «${escapeHtml(entry.title.slice(0, 60))}» — ${formatSlot(entry.at)}`),
        "",
        "Я их не публиковала: статьи убраны из очереди и вернулись на проверку. Откройте и опубликуйте или запланируйте снова.",
      ].join("\n"),
      shown.map((entry) => [{ text: `Открыть #${entry.postNumber}`, callback_data: `open:${entry.postNumber}` }]),
    );
  }

  // 3. At most one due article per call, the earliest first.
  const due = entries
    .filter((e) => e.status === "scheduled" && e.at.getTime() <= now.getTime() && !summary.missed.includes(e.postNumber))
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (due && (await claimEntry(due.id, now))) {
    await publishEntry({ ...due, status: "publishing", claimedAt: now }, deps, summary);
  }
  return summary;
}
