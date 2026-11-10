import type { BlogPost } from "./types";

/**
 * Local-development demo content, used only outside production when Supabase is not configured.
 * It is deliberately generic so it can never be mistaken for a real published article.
 */
export const DEV_PREVIEW_TOKEN = "00000000-0000-4000-8000-000000000001";

const demoBodyRu = `Это демонстрационная статья для локальной разработки. Она показывает, как выглядят заголовки, списки, ссылки и картинки в блоге.

## Подзаголовок раздела

Обычный абзац текста. В статьях будут [ссылки на официальные сайты](https://www.gov.cy) и пошаговые инструкции.

1. Первый шаг инструкции.
2. Второй шаг инструкции.
3. Третий шаг инструкции.

[[image:inline-1]]

## Ещё один раздел

- Пункт списка
- Ещё один пункт списка

> Важное замечание выделяется цитатой.

| Что | Где |
| --- | --- |
| Пример | Таблица |
`;

const demoBodyEn = `This is a demo article for local development. It shows how headings, lists, links and images look in the blog.

## Section heading

A regular paragraph. Articles will include [links to official websites](https://www.gov.cy) and step-by-step instructions.

1. First step.
2. Second step.
3. Third step.

[[image:inline-1]]

## Another section

- List item
- Another list item

> An important note is shown as a quote.

| What | Where |
| --- | --- |
| Example | Table |
`;

const now = "2026-11-10T09:00:00.000Z";

export const DEV_BLOG_POSTS: BlogPost[] = [
  {
    id: "dev-demo-post",
    slug: "demo-article",
    status: "published",
    authorName: "HealthGuide Cyprus",
    publishedAt: now,
    updatedAt: now,
    viewCount: 128,
    translations: [
      {
        locale: "ru",
        status: "published",
        title: "Демо-статья: как выглядит блог",
        description: "Демонстрационная статья для проверки оформления блога при локальной разработке.",
        bodyMd: demoBodyRu,
        faq: [
          { question: "Это настоящая статья?", answer: "Нет, это демо-контент только для локальной разработки." },
          { question: "Где будут настоящие статьи?", answer: "В базе Supabase, после одобрения редактором." },
        ],
        sources: [{ title: "gov.cy", url: "https://www.gov.cy" }],
        publishedAt: now,
        updatedAt: now,
      },
      {
        locale: "en",
        status: "published",
        title: "Demo article: how the blog looks",
        description: "A demo article for checking the blog layout during local development.",
        bodyMd: demoBodyEn,
        faq: [
          { question: "Is this a real article?", answer: "No, this is demo content for local development only." },
          { question: "Where will real articles live?", answer: "In Supabase, after an editor approves them." },
        ],
        sources: [{ title: "gov.cy", url: "https://www.gov.cy" }],
        publishedAt: now,
        updatedAt: now,
      },
    ],
    images: [
      {
        slot: "inline-1",
        url: null,
        width: null,
        height: null,
        alt: { ru: "Скриншот шага", en: "Screenshot of a step" },
        placeholderNote: "скриншот шага инструкции",
        source: "placeholder",
        creditName: null,
        creditUrl: null,
        sourcePageUrl: null,
        licenseName: null,
        licenseUrl: null,
      },
    ],
  },
];

export const DEV_PREVIEW_POST: BlogPost = {
  ...DEV_BLOG_POSTS[0],
  id: "dev-preview-post",
  slug: "demo-draft",
  status: "review",
  publishedAt: null,
  translations: [
    ...DEV_BLOG_POSTS[0].translations.map((translation) => ({
      ...translation,
      status: "review" as const,
      publishedAt: null,
    })),
  ],
};
