import "server-only";

import { randomUUID } from "node:crypto";

import type { Locale } from "@/lib/i18n/types";

import type { StoredImage } from "./images";
import {
  formatFaq,
  formatSources,
  insertImageMarker,
  nextInlineSlot,
  parseFaq,
  parseSources,
  removeImageMarker,
  replaceSection,
  splitSections,
} from "./sections";
import {
  saveTranslation,
  setTranslationStatus,
  updatePost,
  upsertImage,
  type EditorialPost,
  type TranslationFields,
  type TranslationRecord,
} from "./store";

/** What the editor edits by hand: title, description, one section, FAQ, sources or the whole text file. */
export type ManualPart = "title" | "desc" | "faq" | "src" | "file" | `s${number}`;

export function isManualPart(value: string): value is ManualPart {
  return ["title", "desc", "faq", "src", "file"].includes(value) || /^s\d{1,2}$/.test(value);
}

export function partLabel(part: ManualPart, translation?: TranslationRecord): string {
  if (part === "title") return "заголовок";
  if (part === "desc") return "описание";
  if (part === "faq") return "FAQ";
  if (part === "src") return "источники";
  if (part === "file") return "весь текст";
  const index = Number(part.slice(1));
  const heading = translation ? splitSections(translation.bodyMd)[index]?.heading : null;
  return `раздел ${index + 1}${heading ? ` «${heading}»` : ""}`;
}

/** Current text of a part, in the plain format the editor sends back. */
export function partText(translation: TranslationRecord, part: ManualPart): string {
  if (part === "title") return translation.title;
  if (part === "desc") return translation.description;
  if (part === "faq") return formatFaq(translation.faq);
  if (part === "src") return formatSources(translation.sources);
  if (part === "file") return translation.bodyMd;
  const section = splitSections(translation.bodyMd)[Number(part.slice(1))];
  if (!section) throw new Error("Такого раздела уже нет.");
  return section.text;
}

function fieldsOf(translation: TranslationRecord): TranslationFields {
  return {
    title: translation.title,
    description: translation.description,
    bodyMd: translation.bodyMd,
    faq: translation.faq,
    sources: translation.sources,
  };
}

/**
 * Applies the editor's own text. A Russian change marks the other languages as outdated, so
 * the card offers to re-translate them; a change in another language affects only that language.
 */
export async function applyManualEdit(
  post: EditorialPost,
  locale: Locale,
  part: ManualPart,
  rawText: string,
): Promise<{ sourcesChanged: boolean; outdated: Locale[] }> {
  const translation = post.translations.find((t) => t.locale === locale);
  if (!translation) throw new Error("Этого языка у статьи пока нет.");
  const text = rawText.replace(/\r\n/g, "\n").trim();
  const fields = fieldsOf(translation);

  if (part === "title") {
    if (!text || text.includes("\n")) throw new Error("Заголовок: одна непустая строка.");
    fields.title = text.slice(0, 200);
  } else if (part === "desc") {
    if (!text) throw new Error("Описание не может быть пустым.");
    fields.description = text.replace(/\s+/g, " ").slice(0, 300);
  } else if (part === "faq") {
    const faq = parseFaq(text);
    if (faq.length === 0) throw new Error("Не нашла вопросов. Формат: строка «В: …», затем «О: …».");
    fields.faq = faq;
  } else if (part === "src") {
    const sources = parseSources(text);
    if (sources.length === 0) throw new Error("Не нашла ни одной ссылки https://… Формат: «Название | https://…».");
    fields.sources = sources;
  } else if (part === "file") {
    if (text.length < 200) throw new Error("Текст слишком короткий — похоже, файл пришёл не целиком.");
    fields.bodyMd = text.replace(/^# (?=\S)/gm, "## ");
  } else {
    fields.bodyMd = replaceSection(translation.bodyMd, Number(part.slice(1)), text.replace(/^# (?=\S)/gm, "## "));
  }

  await saveTranslation(post, locale, fields, "review", randomUUID(), `manual: ${part}`);
  const outdated =
    locale === "ru"
      ? post.translations.map((t) => t.locale).filter((other): other is Locale => other !== "ru")
      : [];
  await setTranslationStatus(post.id, outdated, "draft");
  if (post.status === "failed") await updatePost(post.id, { status: "review" });
  return { sourcesChanged: part === "src" || part === "file", outdated };
}

/** Adds the editor's photo as a new inline image at the end of a section, in every language. */
export async function addInlineImage(
  post: EditorialPost,
  sectionIndex: number,
  stored: StoredImage,
  caption: string,
): Promise<string> {
  const slot = nextInlineSlot(post.images.map((image) => image.slot));
  await upsertImage(post.id, slot, {
    url: stored.url,
    width: stored.width,
    height: stored.height,
    alt: caption ? { ru: caption.slice(0, 300) } : {},
    placeholder_note: null,
    source: "upload",
    credit_name: null,
    credit_url: null,
    source_page_url: null,
    license_name: null,
    license_url: null,
    provider_photo_id: null,
    search_query: null,
    storage_path: stored.storagePath,
  });
  const batch = randomUUID();
  for (const translation of post.translations) {
    await saveTranslation(
      post,
      translation.locale,
      { ...fieldsOf(translation), bodyMd: insertImageMarker(translation.bodyMd, sectionIndex, slot) },
      translation.status,
      batch,
      `image added: ${slot}`,
    );
  }
  return slot;
}

/** Removes an inline image from the text of every language (the file is kept for undo). */
export async function removeInlineImage(post: EditorialPost, slot: string): Promise<void> {
  if (slot === "cover") throw new Error("Обложку можно только заменить.");
  const batch = randomUUID();
  for (const translation of post.translations) {
    await saveTranslation(
      post,
      translation.locale,
      { ...fieldsOf(translation), bodyMd: removeImageMarker(translation.bodyMd, slot) },
      translation.status,
      batch,
      `image removed: ${slot}`,
    );
  }
}
