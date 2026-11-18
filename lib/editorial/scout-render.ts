import { cyprusDate } from "./scout";
import { escapeHtml } from "./telegram";

/** What a Scout run tells the editor, and how the three outcomes are worded. */

export type ScoutErrorCode = "limit_scout" | "limit_total" | "busy" | "no_sources" | "all_sources_down" | "openai" | "internal";

export interface UnavailableSource {
  name: string;
  code: string;
}

export interface DigestTopic {
  /** The event's number, used by the buttons; null in a test run (nothing is saved). */
  number: number | null;
  title: string;
  gist: string;
  why: string;
  score: number;
  scoreReason: string;
  links: { title: string; url: string }[];
  /** When the event was first found, as an ISO timestamp. */
  firstSeenAt: string;
}

export type ScoutOutcome =
  | { kind: "topics"; test: boolean; topics: DigestTopic[]; unavailable: UnavailableSource[]; collected: number; model: string }
  | { kind: "empty"; test: boolean; unavailable: UnavailableSource[]; collected: number; model: string }
  | { kind: "failed"; test: boolean; code: ScoutErrorCode; reason: string; unavailable: UnavailableSource[] };

export const FAILURE_REASON: Record<ScoutErrorCode, string> = {
  limit_scout: "исчерпан лимит на этот месяц",
  limit_total: "исчерпан общий месячный лимит",
  busy: "сейчас выполняется максимум задач одновременно, повторите через пару минут",
  no_sources: "нет утверждённых источников (список и утверждение: /sources)",
  all_sources_down: "все источники недоступны",
  openai: "ошибка OpenAI при отборе новостей",
  internal: "внутренняя ошибка",
};

const TEST_NOTE = "🧪 Тестовый запуск: результат не сохраняется в историю показанных тем, статьи из него не создаются.";

function unavailableLines(unavailable: UnavailableSource[]): string[] {
  if (unavailable.length === 0) return [];
  return ["", `⚠️ Недоступны источники (${unavailable.length}): ${unavailable.map((source) => `${escapeHtml(source.name)} (${escapeHtml(source.code)})`).join(", ")}`];
}

function dateLabel(iso: string): string {
  const [year, month, day] = cyprusDate(new Date(iso)).split("-");
  return `${day}.${month}.${year}`;
}

/** The header message of a digest (the topics follow as separate messages). */
export function renderDigestHeader(outcome: ScoutOutcome, today: string): string {
  const test = outcome.test ? [TEST_NOTE] : [];
  if (outcome.kind === "topics") {
    return [
      `📰 <b>Новости для HealthGuide · ${escapeHtml(today)}</b>`,
      `Тем для статей: ${outcome.topics.length} (просмотрено публикаций: ${outcome.collected})`,
      ...test,
      ...unavailableLines(outcome.unavailable),
    ].join("\n");
  }
  if (outcome.kind === "empty") {
    return [
      "📰 Сегодня значимых медицинских новостей для HealthGuide не найдено.",
      `Просмотрено публикаций: ${outcome.collected}.`,
      ...test,
      ...unavailableLines(outcome.unavailable),
    ].join("\n");
  }
  return [
    `⚠️ Мониторинг не выполнен: ${escapeHtml(outcome.reason)}`,
    "Повторить: /scout",
    ...test,
    ...unavailableLines(outcome.unavailable),
  ].join("\n");
}

/** One topic: Russian headline, gist, why it matters, date, links and the score with its reason. */
export function renderTopic(topic: DigestTopic, index: number): string {
  const links = topic.links.slice(0, 4).map((link) => {
    let label = link.title.slice(0, 40);
    try {
      label = new URL(link.url).hostname.replace(/^www\./, "");
    } catch {
      // keep the title
    }
    return `<a href="${escapeHtml(link.url)}">${escapeHtml(label)}</a>`;
  });
  return [
    `<b>${index}. ${escapeHtml(topic.title)}</b>`,
    escapeHtml(topic.gist),
    "",
    ...(topic.why ? [`<b>Почему важно:</b> ${escapeHtml(topic.why)}`] : []),
    `Оценка: ${topic.score}/5${topic.scoreReason ? ` — ${escapeHtml(topic.scoreReason)}` : ""}`,
    `Найдено: ${dateLabel(topic.firstSeenAt)}`,
    ...(links.length ? [`Источники: ${links.join(" · ")}`] : []),
  ].join("\n");
}
