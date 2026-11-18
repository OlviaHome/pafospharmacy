import type { TelegramEntity, TelegramMessage } from "./auth";
import type { CheckResult } from "./checks";
import type { FactItemOptions } from "./facts";
import { checkOriginality } from "./originality";
import { diffTokens, explainedByAccepted, mainTextOf, pairsProblems, textHash, tokens, type Pair } from "./prepare";
import type { EditorialPost } from "./store";

/**
 * /import: material the editor sends for a new article (pure helpers; the bot and the store do
 * the rest). The material is a lead for research, never trusted text: it reaches the model only
 * as data, and it never counts as a primary source in the fact checks.
 */

/** Total material per import. Longer texts belong in several articles. */
export const MAX_IMPORT_CHARS = 60_000;
/** Mode B sends the whole text through one model call, so it has a smaller limit than the import itself. */
export const MAX_PREPARE_CHARS = 25_000;
/** An unfinished import is dropped after this long. */
export const IMPORT_TTL_MS = 24 * 60 * 60 * 1000;

/** Mode B, material in another language: the original paragraphs with their Russian translation. */
export interface PreparedMaterial {
  pairs: Pair[];
  /** The translation as one text: what the article's own text is compared with. */
  text: string;
}

export interface ImportInfo {
  id: string;
  mode: "rewrite" | "prepare" | null;
  language: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  sourceText: string | null;
  sourceTextRu: string | null;
  prepared: PreparedMaterial | null;
  /** Fingerprint of the article's own words that the editor confirmed as they are. */
  acceptedHash: string | null;
}

export type PartKind = "text" | "url" | "forward" | "file";

/**
 * The language of the original is chosen by the editor (never guessed from the text). Stored in the
 * import's `language` field: a code for the four buttons, or "other:<name>" for a typed name.
 */
export const LANGUAGE_CHOICES = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "el", label: "Ελληνικά" },
  { code: "uk", label: "Українська" },
] as const;

export const OTHER_LANGUAGE_PREFIX = "other:";

/** A language name typed by the editor, cleaned up; null when it is empty or too long. */
export function otherLanguage(text: string): string | null {
  const name = text.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 40 ? `${OTHER_LANGUAGE_PREFIX}${name}` : null;
}

/** The language as shown to the editor and passed to the model; "не указан" until it is chosen. */
export function languageLabel(language: string | null): string {
  if (!language) return "не указан";
  if (language.startsWith(OTHER_LANGUAGE_PREFIX)) return language.slice(OTHER_LANGUAGE_PREFIX.length);
  return LANGUAGE_CHOICES.find((choice) => choice.code === language)?.label ?? language;
}

/** A message that is nothing but one https link: the material is behind it. */
export function singleUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^https:\/\/\S+$/.test(trimmed) ? trimmed : null;
}

function entityLinks(text: string, entities: TelegramEntity[] | undefined): string[] {
  const links = (entities ?? []).flatMap((entity) => {
    if (entity.type === "text_link" && entity.url) return [entity.url];
    if (entity.type === "url") return [text.slice(entity.offset, entity.offset + entity.length)];
    return [];
  });
  return [...new Set(links.filter((url) => /^https?:\/\//.test(url)))];
}

/** Where a forwarded message came from, in the editor's words. */
export function forwardLabel(message: TelegramMessage): string | null {
  const origin = message.forward_origin;
  if (!origin) return null;
  const chat = origin.chat ?? origin.sender_chat;
  const name =
    chat?.title ?? (chat?.username ? `@${chat.username}` : null) ?? origin.sender_user?.first_name ?? origin.sender_user_name ?? null;
  return name ? `пересланное сообщение из «${name}»` : "пересланное сообщение";
}

/**
 * The text of a part from a message: its text or caption, plus the links hidden behind words
 * (text links), which the model may use as leads.
 */
export function messageText(message: TelegramMessage): string {
  const text = message.text ?? message.caption ?? "";
  const links = entityLinks(text, message.text ? message.entities : message.caption_entities).filter((url) => !text.includes(url));
  return links.length ? `${text}\n\nСсылки в сообщении:\n${links.join("\n")}` : text;
}

export interface StoredPart {
  messageId: number;
  kind: PartKind;
  body: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
}

/** The whole material: parts in the order they were sent, and where it came from. */
export function assembleParts(parts: StoredPart[]): { text: string; sourceUrl: string | null; sourceLabel: string } {
  const ordered = [...parts].sort((a, b) => a.messageId - b.messageId);
  const text = ordered.map((part) => part.body.trim()).filter(Boolean).join("\n\n").slice(0, MAX_IMPORT_CHARS);
  const url = ordered.find((part) => part.sourceUrl)?.sourceUrl ?? null;
  const labels = [...new Set(ordered.map((part) => part.sourceLabel).filter((label): label is string => Boolean(label)))];
  const sourceLabel = labels.length ? labels.join(", ") : url ? `ссылка ${url}` : "текст от редактора";
  return { text, sourceUrl: url, sourceLabel };
}

/** A short working title for the draft until the model writes the real one. */
export function importTopic(text: string): string {
  const firstLine = text.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line.length > 0) ?? "";
  const topic = firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  return `Импорт: ${topic || "материал без заголовка"}`;
}

/** The Russian text that the fact coverage and the independence check look at: title, body, FAQ. */
function russianText(post: EditorialPost): { body: string; withFaq: string } | null {
  const ru = post.translations.find((t) => t.locale === "ru");
  if (!ru) return null;
  const faq = ru.faq.map((item) => `${item.question}\n${item.answer}`).join("\n\n");
  return { body: ru.bodyMd, withFaq: [ru.title, ru.bodyMd, faq].filter(Boolean).join("\n\n") };
}

/** Fact-check options for an imported draft (undefined for an ordinary one). */
export function importFactOptions(post: EditorialPost): FactItemOptions | undefined {
  const info = post.importInfo;
  if (!info) return undefined;
  const text = russianText(post);
  return {
    ...(text ? { coverageText: text.withFaq } : {}),
    materialUrls: info.sourceUrl ? [info.sourceUrl] : [],
  };
}

/** The independence check of an imported draft, as a pre-publish check that blocks. */
export function originalityCheck(post: EditorialPost): CheckResult | null {
  const info = post.importInfo;
  const text = russianText(post);
  if (!info || !text) return null;
  // Without the material, or without the full working translation of a non-Russian one, the check
  // cannot run: that blocks too, so a missing translation never switches the check off.
  if (!info.sourceText || (info.language !== "ru" && !info.sourceTextRu)) {
    return {
      id: "originality",
      ok: false,
      blocking: true,
      label: "Проверка самостоятельности не выполнена: нет исходного материала или его полного рабочего перевода — статью нужно написать заново из импорта",
    };
  }
  const materials = [info.sourceText, ...(info.sourceTextRu ? [info.sourceTextRu] : [])];
  const result = checkOriginality(text.withFaq, materials);
  if (!result.blocked) {
    return { id: "originality", ok: true, blocking: true, label: "Самостоятельность: существенных совпадений с исходным материалом нет" };
  }
  const fragments = result.fragments.slice(0, 2).map((fragment) => `«${fragment.slice(0, 160)}»`);
  return {
    id: "originality",
    ok: false,
    blocking: true,
    label: `Текст слишком близок к исходному материалу: ${result.reasons.join("; ")}${fragments.length ? `. Например: ${fragments.join(", ")}` : ""} — перепишите эти места своими словами`,
  };
}

/** The text the article's own words are compared with: the author's text, or its stored Russian translation. */
function preservationBaseline(info: ImportInfo): string | null {
  if (info.language === "ru") return info.sourceText;
  return info.prepared?.text ?? null;
}

/** Mode B: the article's own text (without the added blocks), as the editor sees it now. */
export function authorTextOf(post: EditorialPost): string | null {
  const info = post.importInfo;
  const ru = post.translations.find((t) => t.locale === "ru");
  if (!info || info.mode !== "prepare" || !ru) return null;
  const baseline = preservationBaseline(info);
  return baseline ? mainTextOf(ru.bodyMd, baseline) : null;
}

function hunkLine(hunk: { before: string; after: string }): string {
  const before = hunk.before ? `«${hunk.before.slice(0, 80)}»` : "(пусто)";
  const after = hunk.after ? `«${hunk.after.slice(0, 80)}»` : "(пусто)";
  return `было ${before} → стало ${after}`;
}

/**
 * Mode B: the article's own text must still be the author's text (see prepare.ts). Allowed
 * differences: typography, small spelling fixes in a Russian text, and what the editor accepted
 * in «✍️ Предложения». Anything else blocks until the editor confirms the places ("Расхождения
 * проверены"), which stores a fingerprint of the text as it is then.
 */
export function preservationCheck(post: EditorialPost): CheckResult | null {
  const info = post.importInfo;
  const ru = post.translations.find((t) => t.locale === "ru");
  if (!info || info.mode !== "prepare" || !ru) return null;
  const baseline = preservationBaseline(info);
  if (!baseline) {
    return {
      id: "preservation",
      ok: false,
      blocking: true,
      label: "Проверка сохранности текста автора не выполнена: нет исходного текста или его сохранённого перевода — запустите импорт заново",
    };
  }
  const main = mainTextOf(ru.bodyMd, baseline);
  if (info.acceptedHash && info.acceptedHash === textHash(main)) {
    return { id: "preservation", ok: true, blocking: true, label: "Текст автора: расхождения с оригиналом проверены редактором" };
  }
  const hunks = diffTokens(tokens(baseline), tokens(main), info.language === "ru").filter(
    (hunk) => !explainedByAccepted(hunk, post.suggestions),
  );
  if (hunks.length === 0) {
    return { id: "preservation", ok: true, blocking: true, label: "Текст автора сохранён: отличается только оформление и принятые вами предложения" };
  }
  const shown = hunks.slice(0, 3).map(hunkLine).join("; ");
  return {
    id: "preservation",
    ok: false,
    blocking: true,
    label: `Текст автора изменён (мест: ${hunks.length}): ${shown}. Верните текст или нажмите «Расхождения проверены» на карточке`,
  };
}

/** Mode B, material in another language: the translation against the original, paragraph by paragraph. */
export function translationChecks(post: EditorialPost): CheckResult[] {
  const info = post.importInfo;
  if (!info || info.mode !== "prepare" || info.language === "ru") return [];
  if (!info.prepared || info.prepared.pairs.length === 0) {
    return [{ id: "translation", ok: false, blocking: true, label: "Нет сохранённого перевода по абзацам — запустите импорт заново" }];
  }
  const problems = pairsProblems(info.prepared.pairs);
  const blocking = problems.filter((problem) => problem.blocking);
  const soft = problems.filter((problem) => !problem.blocking);
  const results: CheckResult[] = [
    blocking.length === 0
      ? { id: "translation", ok: true, blocking: true, label: `Перевод: ${info.prepared.pairs.length} абзацев, числа, даты и ссылки совпадают с оригиналом` }
      : {
          id: "translation",
          ok: false,
          blocking: true,
          label: `Перевод расходится с оригиналом (${blocking.length}): ${blocking.slice(0, 4).map((problem) => problem.text).join("; ")} — «📑 Сравнить с оригиналом»`,
        },
  ];
  if (soft.length > 0) {
    results.push({ id: "translation-names", ok: false, label: soft.slice(0, 3).map((problem) => problem.text).join("; ") });
  }
  return results;
}

/** Everything the pre-publish checks need for an imported draft. */
export function importChecks(post: EditorialPost): { facts: FactItemOptions; extra: CheckResult[] } | undefined {
  const facts = importFactOptions(post);
  if (!facts) return undefined;
  if (post.importInfo?.mode === "prepare") {
    const preservation = preservationCheck(post);
    return { facts, extra: [...(preservation ? [preservation] : []), ...translationChecks(post)] };
  }
  const originality = originalityCheck(post);
  return { facts, extra: originality ? [originality] : [] };
}
