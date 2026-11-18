import "server-only";

import type { TelegramCallbackQuery } from "./auth";
import { editorialLimits, openAiModel, utilityModel } from "./config";
import { MODEL_PRICES } from "./pricing";
import { startScoutJob } from "./pipeline";
import { checkSource, type Fetcher } from "./scout-sources";
import { cyprusDate } from "./scout";
import { renderDigestHeader, renderTopic, type ScoutOutcome } from "./scout-render";
import { listSources, recordSourceCheck, scoutSpentSince, setSourceEnabled, type NewsSource } from "./scout-store";
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

/** A digest as messages: the header, then one message per topic. */
export async function sendScoutOutcome(chatId: number, outcome: ScoutOutcome): Promise<void> {
  await sendMessage(chatId, renderDigestHeader(outcome, today()));
  if (outcome.kind !== "topics") return;
  let index = 1;
  for (const topic of outcome.topics) {
    await sendMessage(chatId, renderTopic(topic, index));
    index += 1;
  }
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

export const SCOUT_ACTIONS = new Set(["srcon", "srcoff", "srcchk"]);

export async function handleScoutCallback(
  query: TelegramCallbackQuery,
  action: string,
  rawNumber: string,
  options: { fetcher?: Fetcher } = {},
): Promise<void> {
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
