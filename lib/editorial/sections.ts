/**
 * Pure helpers for editing an article by hand from Telegram: one section, the FAQ or the
 * sources at a time, so each piece fits in a Telegram message.
 */

import type { BlogFaqItem, BlogSource } from "@/lib/blog/types";

export interface Section {
  /** Heading text without "## ", or null for text before the first heading. */
  heading: string | null;
  /** The whole section as Markdown, including its "## " heading line. */
  text: string;
}

const HEADING = /^## (.+)$/;

export function splitSections(body: string): Section[] {
  const sections: Section[] = [];
  let current: string[] = [];
  let heading: string | null = null;
  const flush = () => {
    const text = current.join("\n").trim();
    if (text) sections.push({ heading, text });
  };
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      current = [line];
      heading = match[1].trim();
    } else {
      current.push(line);
    }
  }
  flush();
  return sections;
}

export function joinSections(sections: Section[]): string {
  return sections.map((section) => section.text.trim()).filter(Boolean).join("\n\n");
}

/** Replaces one section; an empty replacement removes it. */
export function replaceSection(body: string, index: number, replacement: string): string {
  const sections = splitSections(body);
  if (index < 0 || index >= sections.length) throw new Error("Такого раздела нет.");
  const text = replacement.replace(/\r\n/g, "\n").trim();
  sections[index] = { heading: HEADING.exec(text.split("\n")[0])?.[1] ?? null, text };
  return joinSections(sections);
}

/** Adds an image marker at the end of a section (or of the article if the index is past the end). */
export function insertImageMarker(body: string, index: number, slot: string): string {
  const sections = splitSections(body);
  const marker = `[[image:${slot}]]`;
  if (sections.length === 0) return marker;
  const target = Math.min(Math.max(index, 0), sections.length - 1);
  sections[target] = { ...sections[target], text: `${sections[target].text.trim()}\n\n${marker}` };
  return joinSections(sections);
}

export function removeImageMarker(body: string, slot: string): string {
  return body
    .split("\n")
    .filter((line) => line.trim() !== `[[image:${slot}]]`)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Next free inline slot name: inline-1, inline-2, … */
export function nextInlineSlot(existing: string[]): string {
  let n = 1;
  while (existing.includes(`inline-${n}`)) n += 1;
  return `inline-${n}`;
}

/* ---------- FAQ and sources as editable plain text ---------- */

export function formatFaq(faq: BlogFaqItem[]): string {
  return faq.map((item) => `В: ${item.question}\nО: ${item.answer}`).join("\n\n");
}

const QUESTION = /^(?:в|q|вопрос|question|ε|ερ)\s*[:.)-]\s*/i;
const ANSWER = /^(?:о|a|ответ|answer|α|απ)\s*[:.)-]\s*/i;

/** Reads "В: …" / "О: …" pairs (also Q:/A:); a multi-line answer continues until the next question. */
export function parseFaq(text: string): BlogFaqItem[] {
  const items: BlogFaqItem[] = [];
  let question: string | null = null;
  let answer: string[] = [];
  const flush = () => {
    if (question && answer.join(" ").trim()) items.push({ question, answer: answer.join("\n").trim() });
    question = null;
    answer = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (QUESTION.test(line)) {
      flush();
      question = line.replace(QUESTION, "").trim();
    } else if (ANSWER.test(line) && question) {
      answer.push(line.replace(ANSWER, "").trim());
    } else if (line && question && answer.length > 0) {
      answer.push(line);
    }
  }
  flush();
  return items;
}

export function formatSources(sources: BlogSource[]): string {
  return sources.map((source) => `${source.title} | ${source.url}`).join("\n");
}

/** One source per line: "Title | https://…" or just a URL. Non-https lines are ignored. */
export function parseSources(text: string): BlogSource[] {
  const seen = new Set<string>();
  const sources: BlogSource[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const found = /https:\/\/\S+/.exec(raw)?.[0];
    const url = found?.replace(/[),.;]+$/, "");
    if (!found || !url || seen.has(url)) continue;
    seen.add(url);
    const title = raw
      .replace(found, "")
      .replace(/\s*[|—–-]\s*$/, "")
      .trim()
      .replace(/^[\p{P}\s]+$/u, "");
    sources.push({ title: title || new URL(url).hostname, url });
  }
  return sources;
}
