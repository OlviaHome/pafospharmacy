import type { BlogPostStatus, BlogTranslationStatus } from "@/lib/blog/types";
import { localePath } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

import { markerSlots, wordCount } from "./normalize";
import { splitSections } from "./sections";
import { formatChecks, type CheckResult } from "./checks";
import { sourceKind } from "./prompts";
import type { EditorialPost } from "./store";
import { escapeHtml, type InlineKeyboard } from "./telegram";

export const POST_STATUS_LABEL: Record<BlogPostStatus, string> = {
  generating: "⏳ пишется",
  review: "👀 на проверке",
  paused: "⏸ отложена",
  published: "✅ опубликована",
  archived: "🗄 в архиве",
  failed: "⚠️ ошибка",
};

const TRANSLATION_STATUS_LABEL: Record<BlogTranslationStatus, string> = {
  draft: "устарел",
  review: "на проверке",
  published: "опубликован",
};

const LOCALE_SHORT: Record<Locale, string> = { ru: "RU", en: "EN", el: "EL", ar: "AR" };
const LOCALE_ORDER: Locale[] = ["ru", "en", "el", "ar"];

export function previewUrl(origin: string, post: EditorialPost, locale: Locale = "ru"): string {
  const base = `${origin}${localePath("ru", `/blog/preview/${post.previewToken}`)}`;
  return locale === "ru" ? base : `${base}?lang=${locale}`;
}

export function publicUrl(origin: string, post: EditorialPost, locale: Locale = "ru"): string {
  return `${origin}${localePath(locale, `/blog/${post.slug}`)}`;
}

export function postTitle(post: EditorialPost): string {
  return post.translations.find((t) => t.locale === "ru")?.title ?? post.topic;
}

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/** Image slots the Russian text actually uses (plus the cover); others are kept only for undo. */
export function activeImages(post: EditorialPost): EditorialPost["images"] {
  const body = post.translations.find((t) => t.locale === "ru")?.bodyMd ?? "";
  const used = new Set(["cover", ...markerSlots(body)]);
  return post.images.filter((image) => used.has(image.slot));
}

export function hasRussianAndEnglish(post: EditorialPost): boolean {
  return ["ru", "en"].every((locale) => post.translations.some((t) => t.locale === locale));
}

/** The main draft card the editor works from. */
export function renderCard(
  post: EditorialPost,
  origin: string,
  extras: { costUsd: number; canUndo: boolean; checks?: CheckResult[] },
): { text: string; keyboard: InlineKeyboard } {
  const ru = post.translations.find((t) => t.locale === "ru");
  const lines: string[] = [
    `📝 <b>#${post.number} · ${escapeHtml(postTitle(post))}</b>`,
    `Статус: ${POST_STATUS_LABEL[post.status]}`,
  ];
  if (ru && ru.title !== post.topic) lines.push(`Тема: <i>${escapeHtml(post.topic.slice(0, 200))}</i>`);

  const languages = LOCALE_ORDER.map((locale) => {
    const t = post.translations.find((candidate) => candidate.locale === locale);
    return `${LOCALE_SHORT[locale]} ${t ? TRANSLATION_STATUS_LABEL[t.status] : "—"}`;
  });
  lines.push(`Языки: ${languages.join(" · ")}`);

  const images = activeImages(post);
  if (images.length > 0) {
    const ready = images.filter((image) => image.url).length;
    const missing = images.length - ready;
    lines.push(`Картинки: ${ready} готово${missing ? `, ${missing} нужно прислать` : ""}`);
  }
  if (ru) {
    const unofficial = ru.sources.filter((source) => sourceKind(source.url) === "other").length;
    lines.push(
      `Источники: ${ru.sources.length}${unofficial ? ` (⚠️ неофициальных: ${unofficial})` : " (официальные)"} · FAQ: ${ru.faq.length} · ~${wordCount(ru.bodyMd)} слов`,
    );
  }
  if (extras.costUsd > 0) lines.push(`Стоимость: ~$${extras.costUsd.toFixed(2)}`);
  if (extras.checks?.length && post.status !== "generating" && post.status !== "archived") {
    lines.push("", `<b>Проверки перед публикацией (RU + EN):</b>\n${escapeHtml(formatChecks(extras.checks))}`);
  }
  if (post.editorNotes) lines.push("", `🔎 <b>Проверьте:</b>\n${escapeHtml(post.editorNotes.slice(0, 1200))}`);
  if (post.lastError) lines.push("", `⚠️ ${escapeHtml(post.lastError.slice(0, 300))}`);

  const links: string[] = [];
  if (post.status === "published") {
    for (const t of post.translations.filter((candidate) => candidate.status === "published")) {
      links.push(link(publicUrl(origin, post, t.locale), `На сайте ${LOCALE_SHORT[t.locale]}`));
    }
  }
  if (post.status !== "archived" && post.translations.length > 0) {
    for (const t of post.translations) links.push(link(previewUrl(origin, post, t.locale), `Превью ${LOCALE_SHORT[t.locale]}`));
  }
  if (links.length) lines.push("", links.join(" · "));

  return { text: lines.join("\n"), keyboard: cardKeyboard(post, extras.canUndo) };
}

/** English is missing or no longer matches the Russian text. */
export function englishOutdated(post: EditorialPost): boolean {
  const english = post.translations.find((t) => t.locale === "en");
  return post.translations.some((t) => t.locale === "ru") && (!english || english.status === "draft");
}

function editRows(n: number): InlineKeyboard {
  return [
    [
      { text: "📝 Править самой", callback_data: `med:${n}` },
      { text: "✏️ Правки через ИИ", callback_data: `edit:${n}` },
    ],
    [{ text: "🖼 Картинки", callback_data: `img:${n}` }],
  ];
}

function cardKeyboard(post: EditorialPost, canUndo: boolean): InlineKeyboard {
  const n = post.number;
  const hasRu = post.translations.some((t) => t.locale === "ru");
  const refreshEnglish = englishOutdated(post)
    ? [[{ text: "🔁 Обновить EN по русскому тексту", callback_data: `tren:${n}` }]]
    : [];
  switch (post.status) {
    case "generating":
      return [[{ text: "🔄 Обновить", callback_data: `open:${n}` }]];
    case "review":
      return [
        ...(hasRussianAndEnglish(post) ? [[{ text: "✅ Опубликовать RU + EN", callback_data: `pub:${n}` }]] : []),
        ...refreshEnglish,
        ...editRows(n),
        ...(canUndo ? [[{ text: "↩️ Откатить последнюю правку", callback_data: `undo:${n}` }]] : []),
        [
          { text: "⏸ Отложить", callback_data: `pause:${n}` },
          { text: "🗄 В архив", callback_data: `arch:${n}` },
        ],
      ];
    case "paused":
      return [
        [{ text: "▶️ Вернуть на проверку", callback_data: `resume:${n}` }],
        ...(hasRu ? [...refreshEnglish, ...editRows(n)] : []),
        [{ text: "🗄 В архив", callback_data: `arch:${n}` }],
      ];
    case "failed":
      return [
        hasRu
          ? [{ text: "▶️ Вернуть на проверку", callback_data: `resume:${n}` }]
          : [{ text: "🔁 Написать заново", callback_data: `retry:${n}` }],
        ...(hasRu ? [...refreshEnglish, ...editRows(n)] : []),
        [{ text: "🗄 В архив", callback_data: `arch:${n}` }],
      ];
    case "published": {
      const needsTranslation = (["el", "ar"] as Locale[]).some(
        (locale) => post.translations.find((t) => t.locale === locale)?.status !== "published",
      );
      return [
        ...(needsTranslation ? [[{ text: "🌍 Перевести на EL и AR", callback_data: `tr:${n}` }]] : []),
        [
          { text: "🖼 Картинки", callback_data: `img:${n}` },
          { text: "⏸ Снять с публикации", callback_data: `unpub:${n}` },
        ],
      ];
    }
    case "archived":
      return [
        [{ text: "♻️ Восстановить", callback_data: `restore:${n}` }],
        [{ text: "🗑 Удалить навсегда", callback_data: `del:${n}` }],
      ];
  }
}

/** Card for the Greek and Arabic translations of a published article. */
export function renderTranslationsCard(
  post: EditorialPost,
  origin: string,
  checks: CheckResult[] = [],
): { text: string; keyboard: InlineKeyboard } {
  const pending = post.translations.filter((t) => t.locale === "el" || t.locale === "ar");
  const lines = [
    `🌍 <b>#${post.number} · переводы</b>`,
    escapeHtml(postTitle(post)),
    "",
    ...pending.map(
      (t) =>
        `${LOCALE_SHORT[t.locale]}: ${TRANSLATION_STATUS_LABEL[t.status]} · ${link(previewUrl(origin, post, t.locale), "превью")}`,
    ),
    ...(checks.length ? ["", `<b>Проверки:</b>\n${escapeHtml(formatChecks(checks))}`] : []),
  ];
  const canPublish = pending.some((t) => t.status === "review");
  return {
    text: lines.join("\n"),
    keyboard: [
      ...(canPublish ? [[{ text: "✅ Опубликовать EL + AR", callback_data: `pubtr:${post.number}` }]] : []),
      [{ text: "🔁 Перевести заново", callback_data: `tr:${post.number}` }],
    ],
  };
}

export function renderImagesMenu(post: EditorialPost): { text: string; keyboard: InlineKeyboard } {
  const lines = [`🖼 <b>#${post.number} · картинки</b>`, ""];
  const keyboard: InlineKeyboard = [];
  for (const image of activeImages(post)) {
    const name = image.slot === "cover" ? "обложка" : image.slot;
    const state = image.url
      ? `✅ ${image.source === "upload" ? "ваша" : `${image.source}${image.creditName ? `, ${escapeHtml(image.creditName)}` : ""}`}`
      : `⬜️ нужно прислать: ${escapeHtml(image.placeholderNote ?? "")}`;
    lines.push(`<b>${name}</b> — ${state}`);
    keyboard.push([
      ...(image.searchQuery ? [{ text: `🔄 ${name}: другое фото`, callback_data: `imgnext:${post.number}:${image.slot}` }] : []),
      { text: `📤 ${name}: своя / запрос`, callback_data: `imgup:${post.number}:${image.slot}` },
      ...(image.slot !== "cover" ? [{ text: "🗑", callback_data: `imgdel:${post.number}:${image.slot}` }] : []),
    ]);
  }
  lines.push(
    "",
    "«Своя / запрос»: пришлите фото ответом на сообщение бота или напишите поисковый запрос (лучше по-английски).",
    "🗑 убирает картинку из текста (её можно вернуть откатом).",
  );
  keyboard.push([{ text: "➕ Вставить новую картинку", callback_data: `imgadd:${post.number}` }]);
  keyboard.push([{ text: "⬅️ К статье", callback_data: `open:${post.number}` }]);
  return { text: lines.join("\n"), keyboard };
}

/** Menu for editing the article by hand: pick a language and a part. */
export function renderManualMenu(post: EditorialPost, locale: Locale): { text: string; keyboard: InlineKeyboard } {
  const n = post.number;
  const translation = post.translations.find((t) => t.locale === locale);
  const languages = post.translations
    .filter((t) => t.locale === "ru" || t.locale === "en")
    .map((t) => ({
      text: t.locale === locale ? `• ${LOCALE_SHORT[t.locale]} •` : LOCALE_SHORT[t.locale],
      callback_data: `med:${n}:${t.locale}`,
    }));
  if (!translation) {
    return { text: "Этого языка у статьи пока нет.", keyboard: [languages] };
  }
  const sections = splitSections(translation.bodyMd);
  const lines = [
    `📝 <b>#${n} · правка вручную (${LOCALE_SHORT[locale]})</b>`,
    "Нажмите, что править: я пришлю текущий текст, вы отвечаете исправленным.",
    ...(locale === "ru" ? ["После правок RU английский перевод нужно будет обновить (кнопка в карточке)."] : []),
    "",
    ...sections.map((section, index) => `§${index + 1} ${escapeHtml(section.heading ?? "(вступление)")}`),
  ];
  const sectionButtons = sections.map((section, index) => ({
    text: `§${index + 1} ${(section.heading ?? "вступление").slice(0, 28)}`,
    callback_data: `mt:${n}:${locale}:s${index}`,
  }));
  const rows: InlineKeyboard = [];
  for (let i = 0; i < sectionButtons.length; i += 2) rows.push(sectionButtons.slice(i, i + 2));
  return {
    text: lines.join("\n"),
    keyboard: [
      ...(languages.length > 1 ? [languages] : []),
      [
        { text: "Заголовок", callback_data: `mt:${n}:${locale}:title` },
        { text: "Описание", callback_data: `mt:${n}:${locale}:desc` },
      ],
      ...rows,
      [
        { text: "FAQ", callback_data: `mt:${n}:${locale}:faq` },
        { text: "Источники", callback_data: `mt:${n}:${locale}:src` },
      ],
      [{ text: "📄 Весь текст файлом", callback_data: `mt:${n}:${locale}:file` }],
      [{ text: "⬅️ К статье", callback_data: `open:${n}` }],
    ],
  };
}
