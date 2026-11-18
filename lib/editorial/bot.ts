import "server-only";

import { revalidateTag } from "next/cache";

import { BLOG_CACHE_TAG } from "@/lib/blog/repository";
import type { Locale } from "@/lib/i18n/types";

import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./auth";
import {
  activeImages,
  hasRussianAndEnglish,
  postTitle,
  POST_STATUS_LABEL,
  publicUrl,
  renderCard,
  renderImagesMenu,
  renderManualMenu,
  renderFactsMenu,
  renderSuggestionsMenu,
  renderTranslationsCard,
} from "./cards";
import { blockingFailures, failedChecks, formatChecks, prePublishChecks, type CheckResult } from "./checks";
import { claimsFromEntries, confirmFact } from "./facts";
import { fetchSourceText, verifyClaims } from "./source-text";
import { editorialLimits, openAiModel, siteOrigin, telegramConfig, unsplashKey } from "./config";
import { removeStoredImage, storeImageBytes } from "./images";
import { addInlineImage, applyManualEdit, isManualPart, partLabel, partText, removeInlineImage, type ManualPart } from "./manual";
import { applySuggestion, formatPairs, textHash } from "./prepare";
import { splitSections } from "./sections";
import type { JobKind } from "./limits";
import { nextStockImage, refreshSourceChecks, setNotifier, startJob, type StartResult } from "./pipeline";
import { findSimilar } from "./similar";
import {
  assembleParts,
  languageLabel,
  LANGUAGE_CHOICES,
  otherLanguage,
  forwardLabel,
  authorTextOf,
  importChecks,
  importTopic,
  MAX_IMPORT_CHARS,
  MAX_PREPARE_CHARS,
  messageText,
  singleUrl,
  type PartKind,
} from "./imports";
import {
  addImportPart,
  createImport,
  createPost,
  deleteImport,
  deletePost,
  expireImports,
  findMessage,
  importParts,
  loadImport,
  openImport,
  setImportAcceptedHash,
  transitionImport,
  hasActiveJob,
  hasUndo,
  listPosts,
  listTopics,
  loadPost,
  postCostUsd,
  rememberMessage,
  setTranslationStatus,
  takeTopic,
  transitionPost,
  undoLastChange,
  updatePost,
  upsertImage,
  usageSnapshot,
  type EditorialPost,
} from "./store";
import {
  answerCallback,
  downloadFile,
  editMessage,
  escapeHtml,
  sendDocument,
  sendMessage,
  sendTyping,
  type InlineKeyboard,
} from "./telegram";

const MAX_TOPIC_LENGTH = 500;
const MAX_INSTRUCTION_LENGTH = 2000;
/** Statuses from which an edit, a re-translation or publication may start. */
const EDITABLE_STATUSES: EditorialPost["status"][] = ["review", "paused", "failed"];

function adminChatId(): number {
  return Number(telegramConfig().adminId);
}

/* ---------- checks and cards ---------- */

function checksFor(post: EditorialPost, locales: Locale[]): CheckResult[] {
  return prePublishChecks(post.translations, locales, post.sourceChecks, post.factChecks, importChecks(post));
}

const TRANSLATION_LOCALES: Locale[] = ["el", "ar"];

function pendingTranslationLocales(post: EditorialPost): Locale[] {
  return post.translations
    .filter((t) => TRANSLATION_LOCALES.includes(t.locale) && t.status === "review")
    .map((t) => t.locale);
}

/** Re-checks the source links of these languages right before publishing. */
async function recheckLinks(post: EditorialPost, locales: Locale[]): Promise<EditorialPost> {
  const urls = post.translations.filter((t) => locales.includes(t.locale)).flatMap((t) => t.sources.map((s) => s.url));
  if (urls.length === 0) return post;
  const fresh = await refreshSourceChecks(post.id, urls);
  // Keep earlier results for links of other languages.
  const merged = [...post.sourceChecks.filter((check) => !fresh.some((f) => f.url === check.url)), ...fresh];
  await updatePost(post.id, { source_checks: merged });
  return { ...post, sourceChecks: merged };
}

/** Re-reads the claims' sources (no OpenAI call); manual confirmations of unchanged facts survive. */
async function recheckFacts(post: EditorialPost): Promise<EditorialPost> {
  const claims = claimsFromEntries(post.factChecks);
  if (claims.length === 0) return post;
  const factChecks = await verifyClaims(claims, post.factChecks);
  await updatePost(post.id, { fact_checks: factChecks });
  return { ...post, factChecks };
}

async function sendFactsMenu(chatId: number, post: EditorialPost, editMessageId?: number): Promise<void> {
  const menu = renderFactsMenu(post);
  if (editMessageId) await editMessage(chatId, editMessageId, menu.text, menu.keyboard);
  else await sendMessage(chatId, menu.text, { keyboard: menu.keyboard });
}

async function sendBlocked(chatId: number, post: EditorialPost, blocking: CheckResult[]): Promise<void> {
  await sendMessage(
    chatId,
    `🔴 Публикация #${post.number} заблокирована:\n${escapeHtml(formatChecks(blocking))}\n\nИсправьте текст или подтвердите важные факты вручную.`,
    { keyboard: [[{ text: "🔎 Факты", callback_data: `facts:${post.number}` }, { text: "📝 Править самой", callback_data: `med:${post.number}` }]] },
  );
}

async function cardFor(post: EditorialPost) {
  const [costUsd, canUndo] = await Promise.all([postCostUsd(post.id), hasUndo(post.id)]);
  const checks = post.translations.some((t) => t.locale === "ru") ? checksFor(post, ["ru", "en"]) : [];
  return renderCard(post, siteOrigin(), { costUsd, canUndo, checks });
}

async function sendCard(chatId: number, post: EditorialPost): Promise<void> {
  const card = await cardFor(post);
  const sent = await sendMessage(chatId, card.text, { keyboard: card.keyboard });
  await rememberMessage(chatId, sent.message_id, "card", post.id);
}

async function refreshCard(chatId: number, messageId: number, post: EditorialPost): Promise<void> {
  const card = await cardFor(post);
  await editMessage(chatId, messageId, card.text, card.keyboard);
}

async function sendTranslationsCard(chatId: number, post: EditorialPost): Promise<void> {
  const locales = pendingTranslationLocales(post);
  const card = renderTranslationsCard(post, siteOrigin(), locales.length ? checksFor(post, locales) : []);
  const sent = await sendMessage(chatId, card.text, { keyboard: card.keyboard });
  await rememberMessage(chatId, sent.message_id, "card", post.id);
}

setNotifier({
  card: (post) => sendCard(adminChatId(), post),
  translations: (post) => sendTranslationsCard(adminChatId(), post),
  failure: async (post, kind, message) => {
    const what: Record<JobKind, string> = {
      write: "написать статью",
      edit: "внести правку",
      translate: "перевести",
      rewrite: "написать статью из импорта",
      prepare: "подготовить текст к публикации",
    };
    await sendMessage(
      adminChatId(),
      `⚠️ Не получилось ${what[kind]} для #${post.number} «${escapeHtml(postTitle(post))}».\n<code>${escapeHtml(message.slice(0, 500))}</code>`,
    );
    await sendCard(adminChatId(), post);
  },
});

function limitMessage(result: StartResult): string | null {
  return result.ok ? null : `⛔️ ${escapeHtml(result.reason)}`;
}

function revalidateBlog(): void {
  // Visitors see publication changes on their next request.
  revalidateTag(BLOG_CACHE_TAG, { expire: 0 });
}

/* ---------- commands ---------- */

const HELP = `Я пишу статьи для блога HealthGuide Cyprus. Ничего не публикуется без вашей кнопки ✅.

<b>Новая статья</b>: <code>/new тема</code>, или просто напишите тему, и я спрошу подтверждение.
Можно запустить несколько статей подряд, они пишутся параллельно.

<b>Как проходит работа</b>
1. Я ищу официальные источники и пишу статью на русском, потом перевожу на английский.
2. Присылаю карточку со ссылками на превью и кнопками.
3. 📝 Править самой: заголовок, описание, любой раздел, FAQ, источники или весь текст файлом. Я присылаю текущий текст, вы отвечаете исправленным.
   ✏️ Правки через ИИ: напишите, что изменить, и я перепишу сама. ↩️ Откатить вернёт предыдущую версию.
4. 🖼 Картинки: другое стоковое фото, своя картинка, свой поисковый запрос, ➕ новая картинка в нужный раздел, 🗑 убрать.
5. ✅ Опубликовать RU + EN. После этого переведу на греческий и арабский и тоже покажу перед публикацией.

<b>Импорт</b>: /import — пришлите ссылку, текст, файл .txt/.md или перешлите сообщение. Я проверю утверждения по первоисточникам и напишу самостоятельную статью; дальше всё как обычно.

<b>Команды</b>
/import: статья из чужого материала
/drafts: черновики
/published: опубликованные
/usage: расходы и лимиты`;

async function startArticle(chatId: number, topic: string, options: { force?: boolean } = {}): Promise<void> {
  const clean = topic.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC_LENGTH);
  if (clean.length < 5) {
    await sendMessage(chatId, "Тема слишком короткая. Пример: <code>/new Что такое ГеСИ и как зарегистрироваться</code>");
    return;
  }
  if (!options.force) {
    const similar = findSimilar(clean, await listTopics());
    if (similar.length > 0) {
      const sent = await sendMessage(
        chatId,
        `🔁 Похоже на уже существующие статьи:\n${similar
          .map((match) => `#${match.number} «${escapeHtml(match.title.slice(0, 80))}» (${POST_STATUS_LABEL[match.status as EditorialPost["status"]] ?? match.status})`)
          .join("\n")}\n\nНовая тема: «${escapeHtml(clean)}». Писать всё равно?`,
        {
          keyboard: [
            ...similar.map((match) => [{ text: `Открыть #${match.number}`, callback_data: `open:${match.number}` }]),
            [
              { text: "✍️ Всё равно писать", callback_data: "newforce" },
              { text: "Отмена", callback_data: "cancel" },
            ],
          ],
        },
      );
      await rememberMessage(chatId, sent.message_id, "topic_confirm", null, { payload: clean });
      return;
    }
  }
  const post = await createPost(clean);
  const result = await startJob(post.id, "write", {});
  const blocked = limitMessage(result);
  if (blocked) {
    await updatePost(post.id, { status: "failed", last_error: result.ok ? null : result.reason });
    await sendMessage(chatId, `${blocked}\nЧерновик #${post.number} сохранён: его можно запустить позже кнопкой «Написать заново».`);
    return;
  }
  await sendMessage(
    chatId,
    `✍️ Начала статью <b>#${post.number}</b>: «${escapeHtml(clean)}».\nОбычно это занимает 3–6 минут. Пришлю карточку, когда будет готово.`,
  );
}

async function listDrafts(chatId: number): Promise<void> {
  const posts = await listPosts(["generating", "review", "paused", "failed"], 30);
  if (posts.length === 0) {
    await sendMessage(chatId, "Черновиков нет. Новая статья: <code>/new тема</code>");
    return;
  }
  await sendMessage(
    chatId,
    `<b>Черновики (${posts.length})</b>\n${posts
      .map((post) => `#${post.number} · ${escapeHtml(postTitle(post).slice(0, 70))}: ${POST_STATUS_LABEL[post.status]}`)
      .join("\n")}`,
    {
      keyboard: posts.map((post) => [
        { text: `#${post.number} · ${postTitle(post).slice(0, 40)}`, callback_data: `open:${post.number}` },
      ]),
    },
  );
}

async function listPublished(chatId: number): Promise<void> {
  const posts = await listPosts(["published"], 20);
  if (posts.length === 0) {
    await sendMessage(chatId, "Опубликованных статей пока нет.");
    return;
  }
  const origin = siteOrigin();
  await sendMessage(
    chatId,
    `<b>Опубликовано (${posts.length})</b>\n${posts
      .map((post) => `#${post.number} · <a href="${escapeHtml(publicUrl(origin, post))}">${escapeHtml(postTitle(post).slice(0, 70))}</a>`)
      .join("\n")}`,
    { keyboard: posts.map((post) => [{ text: `#${post.number} · ${postTitle(post).slice(0, 40)}`, callback_data: `open:${post.number}` }]) },
  );
}

async function showUsage(chatId: number): Promise<void> {
  const usage = await usageSnapshot();
  const limits = editorialLimits();
  await sendMessage(
    chatId,
    [
      "<b>Расходы и лимиты</b>",
      `OpenAI в этом месяце: ~$${usage.spentThisMonthUsd.toFixed(2)} из $${limits.monthlyBudgetUsd.toFixed(2)}`,
      `Сегодня статей: ${usage.articlesToday} из ${limits.dailyArticles}`,
      `Сегодня задач (статьи, правки, переводы): ${usage.jobsToday} из ${limits.dailyJobs}`,
      `Сейчас выполняется: ${usage.activeJobs} (максимум ${limits.parallelJobs})`,
      `Модель: <code>${escapeHtml(openAiModel())}</code>`,
      `Стоковые фото: ${unsplashKey() ? "Unsplash" : "Openverse (без ключа)"}`,
      "",
      "Это оценка по токенам. Точная сумма и жёсткий лимит: platform.openai.com → Billing → Limits.",
    ].join("\n"),
  );
}

/* ---------- messages ---------- */

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const text = (message.text ?? message.caption ?? "").trim();

  if (message.reply_to_message) {
    const context = await findMessage(chatId, message.reply_to_message.message_id);
    if (context) {
      await handleReply(message, context, text);
      return;
    }
  }

  if (text.startsWith("/")) {
    const [command, ...rest] = text.split(/\s+/);
    const argument = rest.join(" ");
    switch (command.replace(/@.*$/, "").toLowerCase()) {
      case "/start":
      case "/help":
        await sendMessage(chatId, HELP);
        return;
      case "/new":
        if (argument) await startArticle(chatId, argument);
        else {
          const sent = await sendMessage(chatId, "О чём написать? Ответьте на это сообщение темой статьи.", { forceReply: true });
          await rememberMessage(chatId, sent.message_id, "topic_confirm", null, { payload: "ask" });
        }
        return;
      case "/import":
        await startImport(chatId);
        return;
      case "/drafts":
        await listDrafts(chatId);
        return;
      case "/published":
        await listPublished(chatId);
        return;
      case "/usage":
        await showUsage(chatId);
        return;
      default:
        await sendMessage(chatId, "Не знаю такой команды. /help");
        return;
    }
  }

  // While an /import is collecting, every text, file or forwarded post goes into it (Telegram
  // splits a long paste into several messages, and only the first is a reply). Commands and replies
  // to the bot's other messages are handled above as always; after «Это весь текст» or «Отменить»
  // messages are topics again. An import older than a day is dropped first and never takes a message.
  if (message.forward_origin || message.text || message.document) {
    await expireImports(chatId);
    const open = await openImport(chatId);
    if (open?.status === "collecting") {
      await acceptImportPart(message, open.id);
      return;
    }
  }

  if (message.photo || message.document) {
    await sendMessage(chatId, "Чтобы поставить картинку, откройте статью → 🖼 Картинки → 📤 и пришлите фото ответом на сообщение бота.");
    return;
  }

  if (text) {
    const topic = text.slice(0, MAX_TOPIC_LENGTH);
    const sent = await sendMessage(chatId, `Написать статью на тему «${escapeHtml(topic)}»?`, {
      keyboard: [[{ text: "✍️ Да, писать", callback_data: "newok" }, { text: "Отмена", callback_data: "cancel" }]],
    });
    await rememberMessage(chatId, sent.message_id, "topic_confirm", null, { payload: topic });
  }
}

async function handleReply(
  message: TelegramMessage,
  context: NonNullable<Awaited<ReturnType<typeof findMessage>>>,
  text: string,
): Promise<void> {
  const chatId = message.chat.id;
  if (context.purpose === "import" && context.slot && context.payload === "language") {
    const language = otherLanguage(text);
    if (!language) {
      await sendMessage(chatId, "Напишите название языка словами, до 40 символов (например, «польский»). Ответьте на сообщение выше ещё раз.");
      return;
    }
    if (await setImportLanguage(chatId, context.slot, language)) {
      await sendImportSummary(chatId, context.slot);
    } else {
      await sendMessage(chatId, "Этот импорт уже передан в работу или закрыт.");
    }
    return;
  }
  if (context.purpose === "import" && context.slot) {
    await acceptImportPart(message, context.slot);
    return;
  }
  if (context.purpose === "topic_confirm" && context.payload === "ask") {
    await startArticle(chatId, text);
    return;
  }
  const post = context.postId ? await loadPost({ id: context.postId }) : null;
  if (!post) {
    await sendMessage(chatId, "Эта статья уже удалена.");
    return;
  }

  if (context.purpose === "image_prompt" && context.slot?.startsWith("add:")) {
    await handleAddImageReply(message, post, Number(context.slot.slice(4)));
    return;
  }

  if (context.purpose === "image_prompt" && context.slot) {
    await handleImageReply(message, post, context.slot, text);
    return;
  }

  if (context.purpose === "edit_prompt" && context.slot?.startsWith("fact|")) {
    await handleFactConfirmation(message, post, context.slot.slice(5));
    return;
  }

  // A reply to "send me the corrected text" carries the part in slot as "ru|s2".
  if (context.purpose === "edit_prompt" && context.slot) {
    await handleManualReply(message, post, context.slot);
    return;
  }

  if (message.photo || message.document) {
    const menu = renderImagesMenu(post);
    const sent = await sendMessage(chatId, `${menu.text}\n\nВыберите, куда поставить картинку:`, { keyboard: menu.keyboard });
    await rememberMessage(chatId, sent.message_id, "images", post.id);
    return;
  }

  if ((context.purpose === "edit_prompt" || context.purpose === "card") && text) {
    await requestEdit(chatId, post, text);
  }
}

/** Published or busy articles can't be edited; returns the reason, or null when editing is fine. */
function editBlocker(post: EditorialPost): string | null {
  if (post.status === "published") {
    return `#${post.number} опубликована. Чтобы править, сначала снимите её с публикации (⏸), потом опубликуйте снова.`;
  }
  if (post.status === "generating") return `#${post.number} сейчас обновляется. Подождите карточку.`;
  if (post.status === "archived") return `#${post.number} в архиве. Сначала восстановите её.`;
  if (!post.translations.some((t) => t.locale === "ru")) return `У #${post.number} ещё нет текста.`;
  return null;
}

const MAX_INLINE_EDIT_CHARS = 3500;

async function sendPartForEditing(chatId: number, post: EditorialPost, locale: Locale, part: ManualPart): Promise<void> {
  const translation = post.translations.find((t) => t.locale === locale);
  if (!translation) {
    await sendMessage(chatId, "Этого языка у статьи пока нет.");
    return;
  }
  const current = partText(translation, part);
  const label = partLabel(part, translation);
  const hints: Partial<Record<ManualPart, string>> = {
    faq: "Формат: «В: вопрос» и на следующей строке «О: ответ», пары через пустую строку.",
    src: "Формат: по одной строке «Название | https://…».",
    file: "Отредактируйте файл и пришлите его обратно ответом на это сообщение (можно и текстом).",
  };
  const hint =
    hints[part] ??
    `Нажмите на текст, чтобы скопировать, исправьте и пришлите ответом на это сообщение.${
      part.startsWith("s") ? " Ответ «-» удаляет раздел." : ""
    }`;
  const slot = `${locale}|${part}`;
  if (part === "file" || current.length > MAX_INLINE_EDIT_CHARS) {
    const sent = await sendDocument(
      chatId,
      `article-${post.number}-${locale}${part === "file" ? "" : `-${part}`}.md`,
      current,
      `📝 #${post.number} ${locale.toUpperCase()}: ${escapeHtml(label)}\n${escapeHtml(hints.file!)}`,
      { forceReply: true },
    );
    await rememberMessage(chatId, sent.message_id, "edit_prompt", post.id, { slot });
    return;
  }
  const sent = await sendMessage(
    chatId,
    `📝 #${post.number} ${locale.toUpperCase()}: <b>${escapeHtml(label)}</b>\n${escapeHtml(hint)}\n\n<pre>${escapeHtml(current)}</pre>`,
    { forceReply: true },
  );
  await rememberMessage(chatId, sent.message_id, "edit_prompt", post.id, { slot });
}

async function readReplyText(message: TelegramMessage): Promise<string> {
  const document = message.document;
  if (document) {
    const name = document.file_name ?? "";
    const isText = /\.(md|txt|markdown)$/i.test(name) || (document.mime_type ?? "").startsWith("text/");
    if (!isText) throw new Error("Нужен текстовый файл .md или .txt.");
    if ((document.file_size ?? 0) > 300_000) throw new Error("Файл слишком большой.");
    const { bytes } = await downloadFile(document.file_id);
    return new TextDecoder("utf-8").decode(bytes);
  }
  return message.text ?? "";
}

async function handleManualReply(message: TelegramMessage, post: EditorialPost, slot: string): Promise<void> {
  const chatId = message.chat.id;
  const [locale, part] = slot.split("|");
  if ((locale !== "ru" && locale !== "en") || !part || !isManualPart(part)) return;
  const blocked = editBlocker(post);
  if (blocked) {
    await sendMessage(chatId, blocked);
    return;
  }
  let text: string;
  try {
    text = await readReplyText(message);
  } catch (error) {
    await sendMessage(chatId, `⚠️ ${escapeHtml(error instanceof Error ? error.message : "Не удалось прочитать файл.")}`);
    return;
  }
  // "-" as the whole reply removes a section.
  const value = part.startsWith("s") && text.trim() === "-" ? "" : text;
  try {
    const result = await applyManualEdit(post, locale, part, value);
    let fresh = (await loadPost({ id: post.id }))!;
    if (result.sourcesChanged) {
      await refreshSourceChecks(
        post.id,
        fresh.translations.flatMap((t) => t.sources.map((s) => s.url)),
      );
      fresh = (await loadPost({ id: post.id }))!;
    }
    await sendMessage(
      chatId,
      `✅ Сохранено: ${escapeHtml(partLabel(part, post.translations.find((t) => t.locale === locale)))} (${locale.toUpperCase()}).${
        result.outdated.length ? ` ${result.outdated.map((l) => l.toUpperCase()).join(", ")} помечены как устаревшие.` : ""
      } ↩️ Откат вернёт прошлую версию.`,
    );
    await sendCard(chatId, fresh);
  } catch (error) {
    await sendMessage(chatId, `⚠️ ${escapeHtml(error instanceof Error ? error.message : "Не удалось сохранить.")}`);
  }
}

/** The editor confirmed a fact by hand: store the date and the source they checked. */
async function handleFactConfirmation(message: TelegramMessage, post: EditorialPost, factId: string): Promise<void> {
  const chatId = message.chat.id;
  const ru = post.translations.find((t) => t.locale === "ru");
  const item = renderFactsMenu(post).items.find((candidate) => candidate.id === factId);
  if (!ru || !item) {
    await sendMessage(chatId, "Этот факт уже изменился. Откройте «🔎 Факты» заново.");
    return;
  }
  const answer = (message.text ?? "").trim();
  const sourceUrl = answer === "+" && item.sourceUrl ? item.sourceUrl : (/https:\/\/\S+/.exec(answer)?.[0] ?? "");
  // A statement that contradicts its source stays only with a written reason.
  const reason = answer.replace(/https:\/\/\S+/, "").trim();
  if (item.conflict && sourceUrl && reason.length < 10) {
    await sendMessage(
      chatId,
      "Этот факт противоречит источнику. Оставить его можно только с объяснением: ответьте ссылкой https://… и через пробел — почему текст статьи верен. Или нажмите ✏️ в «🔎 Факты», чтобы внести предлагаемую правку.",
    );
    return;
  }
  if (!sourceUrl) {
    await sendMessage(
      chatId,
      item.sourceUrl
        ? "Нужна ссылка https://… на источник, где вы проверили факт, или «+», если по указанному источнику."
        : "Нужна ссылка https://… на источник, где вы проверили факт.",
    );
    return;
  }
  await updatePost(post.id, { fact_checks: confirmFact(post.factChecks, item, sourceUrl, new Date(), item.conflict ? reason : undefined) });
  await sendMessage(chatId, `✅ Факт отмечен как проверенный вручную (${new Date().toLocaleDateString("ru-RU")}, источник сохранён).`);
  await sendFactsMenu(chatId, (await loadPost({ id: post.id }))!);
}

async function handleAddImageReply(message: TelegramMessage, post: EditorialPost, sectionIndex: number): Promise<void> {
  const chatId = message.chat.id;
  const blocked = editBlocker(post);
  if (blocked) {
    await sendMessage(chatId, blocked);
    return;
  }
  const fileId = message.photo?.at(-1)?.file_id ?? (message.document?.mime_type?.startsWith("image/") ? message.document.file_id : null);
  if (!fileId) {
    await sendMessage(chatId, "Пришлите фото ответом на сообщение бота.");
    return;
  }
  await sendTyping(chatId);
  try {
    const { bytes } = await downloadFile(fileId);
    const stored = await storeImageBytes(post.id, "inline", bytes);
    const slot = await addInlineImage(post, sectionIndex, stored, message.caption?.trim() ?? "");
    await sendMessage(chatId, `✅ Картинка ${slot} вставлена в конец раздела §${sectionIndex + 1} во всех языках.`);
    await sendCard(chatId, (await loadPost({ id: post.id }))!);
  } catch (error) {
    await sendMessage(chatId, `⚠️ ${escapeHtml(error instanceof Error ? error.message : "Не удалось сохранить картинку.")}`);
  }
}

async function requestEdit(chatId: number, post: EditorialPost, instruction: string): Promise<void> {
  if (post.status === "published") {
    await sendMessage(chatId, `#${post.number} опубликована. Чтобы править, сначала снимите её с публикации (⏸), потом опубликуйте снова.`);
    return;
  }
  if (post.status === "generating") {
    await sendMessage(chatId, `#${post.number} ещё пишется. Подождите карточку, потом присылайте правки.`);
    return;
  }
  if (post.status === "archived") {
    await sendMessage(chatId, `#${post.number} в архиве. Сначала восстановите её.`);
    return;
  }
  // Mark as busy before the job starts so the job's own status update always wins. Only one of
  // two simultaneous requests can make this change; the other one stops here.
  if (!(await transitionPost(post.id, EDITABLE_STATUSES, { status: "generating" }))) {
    await sendMessage(chatId, `#${post.number} сейчас обновляется. Подождите карточку.`);
    return;
  }
  const result = await startJob(post.id, "edit", { instruction: instruction.slice(0, MAX_INSTRUCTION_LENGTH) });
  const blocked = limitMessage(result);
  if (blocked) {
    await updatePost(post.id, { status: post.status });
    await sendMessage(chatId, blocked);
    return;
  }
  await sendMessage(chatId, `✏️ Вношу правку в #${post.number}. Пришлю обновлённую карточку через пару минут.`);
}

async function handleImageReply(message: TelegramMessage, post: EditorialPost, slot: string, text: string) {
  const chatId = message.chat.id;
  const image = post.images.find((candidate) => candidate.slot === slot);
  if (!image) {
    await sendMessage(chatId, "Этого места для картинки уже нет в статье.");
    return;
  }
  const fileId = message.photo?.at(-1)?.file_id ?? (message.document?.mime_type?.startsWith("image/") ? message.document.file_id : null);
  if (fileId) {
    await sendTyping(chatId);
    try {
      const { bytes } = await downloadFile(fileId);
      const stored = await storeImageBytes(post.id, slot, bytes);
      await removeStoredImage(image.storagePath);
      await upsertImage(post.id, slot, {
        url: stored.url,
        width: stored.width,
        height: stored.height,
        source: "upload",
        placeholder_note: null,
        credit_name: null,
        credit_url: null,
        source_page_url: null,
        license_name: null,
        license_url: null,
        provider_photo_id: null,
        storage_path: stored.storagePath,
        ...(message.caption?.trim() ? { alt: { ...image.alt, ru: message.caption.trim().slice(0, 300) } } : {}),
      });
    } catch (error) {
      await sendMessage(chatId, `⚠️ ${escapeHtml(error instanceof Error ? error.message : "Не удалось сохранить картинку.")}`);
      return;
    }
    await revalidateIfLive(post);
    await sendMessage(chatId, `✅ Картинка «${slot}» заменена в #${post.number}. Подпись к фото станет alt-текстом, если вы её добавили.`);
    await sendCard(chatId, (await loadPost({ id: post.id }))!);
    return;
  }
  if (text) {
    await sendTyping(chatId);
    const found = await nextStockImage(post, slot, text.slice(0, 100)).catch((error: Error) => {
      console.error("editorial: stock by query failed", error);
      return false;
    });
    await sendMessage(chatId, found ? `✅ Подобрала фото по запросу «${escapeHtml(text)}».` : `Ничего не нашлось по «${escapeHtml(text)}». Попробуйте другой запрос или пришлите своё фото.`);
    if (found) {
      await revalidateIfLive(post);
      await sendCard(chatId, (await loadPost({ id: post.id }))!);
    }
  }
}

async function revalidateIfLive(post: EditorialPost): Promise<void> {
  if (post.status === "published") revalidateBlog();
}

/* ---------- buttons ---------- */

async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  const [action, rawNumber, slot] = (query.data ?? "").split(":");

  if (action === "cancel") {
    await answerCallback(query.id);
    await editMessage(chatId, messageId, "Отменено.");
    return;
  }
  if (action === "newok" || action === "newforce") {
    // Taken atomically: a double tap or a redelivered tap never starts two articles.
    const taken = await takeTopic(chatId, messageId);
    if (taken.status === "busy") {
      // The first tap is already writing; its message stays as it is.
      await answerCallback(query.id, "Уже обрабатывается");
      return;
    }
    await answerCallback(query.id);
    if (taken.status === "missing") {
      await editMessage(chatId, messageId, "Тема не найдена, напишите её ещё раз.");
      return;
    }
    const topic = taken.topic;
    await editMessage(chatId, messageId, `Тема: «${escapeHtml(topic)}»`);
    await startArticle(chatId, topic, { force: action === "newforce" });
    return;
  }

  if (IMPORT_ACTIONS.has(action)) {
    await handleImportCallback(query, action, rawNumber ?? "");
    return;
  }

  const number = Number(rawNumber);
  const post = Number.isInteger(number) ? await loadPost({ number }) : null;
  if (!post) {
    await answerCallback(query.id, "Статья не найдена");
    return;
  }

  switch (action) {
    case "open":
      await answerCallback(query.id);
      await sendCard(chatId, post);
      return;

    case "pub":
    case "pubok": {
      if (!hasRussianAndEnglish(post) || !["review", "paused", "failed"].includes(post.status)) {
        await answerCallback(query.id, "Сейчас опубликовать нельзя");
        return;
      }
      if (action === "pub") {
        await answerCallback(query.id, "Проверяю ссылки и факты…");
        const checked = await recheckFacts(await recheckLinks(post, ["ru", "en"]));
        const all = checksFor(checked, ["ru", "en"]);
        const blocking = blockingFailures(all);
        if (blocking.length > 0) {
          await sendBlocked(chatId, checked, blocking);
          return;
        }
        const problems = failedChecks(all);
        const missing = activeImages(checked).filter((image) => !image.url);
        if (problems.length > 0 || missing.length > 0) {
          await sendMessage(
            chatId,
            [
              `Перед публикацией #${post.number} обратите внимание:`,
              ...(missing.length
                ? [`⚠️ ${missing.length} мест(а) без картинки (${missing.map((image) => image.slot).join(", ")}): на сайте они будут скрыты`]
                : []),
              ...(problems.length ? [escapeHtml(formatChecks(problems))] : []),
              "",
              "Публиковать всё равно?",
            ].join("\n"),
            {
              keyboard: [
                [{ text: "✅ Да, публиковать", callback_data: `pubok:${post.number}` }],
                [
                  { text: "✏️ Правки", callback_data: `edit:${post.number}` },
                  { text: "🖼 Картинки", callback_data: `img:${post.number}` },
                ],
              ],
            },
          );
          return;
        }
      }
      if (action === "pubok") {
        // Confirmation never overrides blocking facts.
        const blocking = blockingFailures(checksFor(post, ["ru", "en"]));
        if (blocking.length > 0) {
          await answerCallback(query.id, "Заблокировано");
          await sendBlocked(chatId, post, blocking);
          return;
        }
        await answerCallback(query.id, "Публикую…");
      }
      // Only one of two simultaneous taps publishes and starts the EL/AR translations.
      const won = await transitionPost(post.id, EDITABLE_STATUSES, {
        status: "published",
        published_at: post.publishedAt ?? new Date().toISOString(),
        last_error: null,
      });
      if (!won) {
        await sendMessage(chatId, `#${post.number} уже опубликована или обновляется.`);
        return;
      }
      try {
        await setTranslationStatus(post.id, ["ru", "en"], "published");
      } catch (error) {
        // Put the post back where it was, so publishing can simply be pressed again. Texts are
        // shown on the site only while the post itself is published, so a language that was
        // already marked published before the failure stays hidden until the retry.
        const reason = error instanceof Error ? error.message : String(error);
        await transitionPost(post.id, ["published"], {
          status: post.status,
          published_at: post.publishedAt,
          last_error: reason.slice(0, 1000),
        });
        await sendMessage(
          chatId,
          `⚠️ #${post.number} не опубликована: не удалось обновить тексты (<code>${escapeHtml(reason.slice(0, 300))}</code>). Статья возвращена в прежний статус, публикацию можно повторить.`,
        );
        return;
      }
      revalidateBlog();
      const published = (await loadPost({ id: post.id }))!;
      if (action === "pub") await refreshCard(chatId, messageId, published);
      else await editMessage(chatId, messageId, `✅ #${post.number} опубликована.`);
      await sendMessage(
        chatId,
        `✅ <b>Опубликовано:</b> ${escapeHtml(postTitle(published))}\n${escapeHtml(publicUrl(siteOrigin(), published, "ru"))}\n${escapeHtml(publicUrl(siteOrigin(), published, "en"))}`,
      );
      await startTranslations(chatId, published);
      return;
    }

    case "tr":
      await answerCallback(query.id);
      if (post.status !== "published") {
        await sendMessage(chatId, "Сначала опубликуйте RU + EN.");
        return;
      }
      if (await hasActiveJob(post.id, "translate")) {
        await sendMessage(chatId, `Перевод #${post.number} уже идёт. Покажу его, когда будет готов.`);
        return;
      }
      await startTranslations(chatId, post);
      return;

    case "pubtr":
    case "pubtrok": {
      const locales = pendingTranslationLocales(post);
      if (post.status !== "published" || locales.length === 0) {
        await answerCallback(query.id, "Нечего публиковать");
        return;
      }
      if (action === "pubtr") {
        await answerCallback(query.id, "Проверяю…");
        const checked = await recheckLinks(post, locales);
        const problems = failedChecks(checksFor(checked, locales));
        if (problems.length > 0) {
          await sendMessage(
            chatId,
            `Перед публикацией переводов #${post.number} обратите внимание:\n${escapeHtml(formatChecks(problems))}\n\nПубликовать всё равно?`,
            {
              keyboard: [[
                { text: "✅ Да, публиковать", callback_data: `pubtrok:${post.number}` },
                { text: "🔁 Перевести заново", callback_data: `tr:${post.number}` },
              ]],
            },
          );
          return;
        }
      } else {
        await answerCallback(query.id, "Публикую…");
      }
      await setTranslationStatus(post.id, locales, "published");
      revalidateBlog();
      await editMessage(chatId, messageId, `✅ #${post.number}: опубликованы ${locales.map((l) => l.toUpperCase()).join(" и ")}.`);
      return;
    }

    case "edit": {
      await answerCallback(query.id);
      if (post.status === "published") {
        await sendMessage(chatId, `#${post.number} опубликована. Чтобы править, сначала снимите её с публикации (⏸).`);
        return;
      }
      const sent = await sendMessage(
        chatId,
        `✏️ Что исправить в #${post.number} «${escapeHtml(postTitle(post))}»?\nОтветьте на это сообщение. Можно несколько пунктов сразу.`,
        { forceReply: true },
      );
      await rememberMessage(chatId, sent.message_id, "edit_prompt", post.id);
      return;
    }

    case "img": {
      await answerCallback(query.id);
      const menu = renderImagesMenu(post);
      const sent = await sendMessage(chatId, menu.text, { keyboard: menu.keyboard });
      await rememberMessage(chatId, sent.message_id, "images", post.id);
      return;
    }

    case "imgnext": {
      if (!slot) return;
      await answerCallback(query.id, "Ищу другое фото…");
      try {
        const found = await nextStockImage(post, slot);
        if (!found) {
          await sendMessage(chatId, "Больше подходящих фото не нашлось. Пришлите своё или другой запрос (📤).");
          return;
        }
      } catch (error) {
        await sendMessage(chatId, `⚠️ ${escapeHtml(error instanceof Error ? error.message : "Ошибка поиска")}`);
        return;
      }
      await revalidateIfLive(post);
      const menu = renderImagesMenu((await loadPost({ id: post.id }))!);
      await editMessage(chatId, messageId, menu.text, menu.keyboard);
      return;
    }

    case "med": {
      await answerCallback(query.id);
      const blocked = editBlocker(post);
      if (blocked) {
        await sendMessage(chatId, blocked);
        return;
      }
      const locale: Locale = slot === "en" ? "en" : "ru";
      const menu = renderManualMenu(post, locale);
      // Switching the language edits the same menu message.
      if (slot) await editMessage(chatId, messageId, menu.text, menu.keyboard);
      else await sendMessage(chatId, menu.text, { keyboard: menu.keyboard });
      return;
    }

    case "mt": {
      await answerCallback(query.id);
      const [, , locale, part] = (query.data ?? "").split(":");
      const blocked = editBlocker(post);
      if (blocked) {
        await sendMessage(chatId, blocked);
        return;
      }
      if ((locale !== "ru" && locale !== "en") || !part || !isManualPart(part)) return;
      await sendPartForEditing(chatId, post, locale, part);
      return;
    }

    case "tren": {
      const blocked = editBlocker(post);
      if (blocked) {
        await answerCallback(query.id);
        await sendMessage(chatId, blocked);
        return;
      }
      if (!(await transitionPost(post.id, EDITABLE_STATUSES, { status: "generating" }))) {
        await answerCallback(query.id, "Уже обновляется");
        return;
      }
      const result = await startJob(post.id, "translate", { locales: ["en"], notify: "card" });
      await answerCallback(query.id);
      const limit = limitMessage(result);
      if (limit) {
        await updatePost(post.id, { status: post.status });
        await sendMessage(chatId, limit);
        return;
      }
      await sendMessage(chatId, `🔁 Обновляю английский перевод #${post.number} по русскому тексту.`);
      return;
    }

    case "imgadd": {
      await answerCallback(query.id);
      const blocked = editBlocker(post);
      if (blocked) {
        await sendMessage(chatId, blocked);
        return;
      }
      const ru = post.translations.find((t) => t.locale === "ru")!;
      const sections = splitSections(ru.bodyMd);
      await sendMessage(chatId, `➕ В какой раздел #${post.number} вставить картинку? Она встанет в конец раздела.`, {
        keyboard: sections.map((section, index) => [
          { text: `§${index + 1} ${(section.heading ?? "вступление").slice(0, 40)}`, callback_data: `imgsec:${post.number}:${index}` },
        ]),
      });
      return;
    }

    case "imgsec": {
      await answerCallback(query.id);
      const index = Number(slot);
      if (!Number.isInteger(index) || index < 0) return;
      const sent = await sendMessage(
        chatId,
        `📤 Пришлите фото для раздела §${index + 1} в #${post.number} ответом на это сообщение. Подпись к фото станет описанием картинки (alt).`,
        { forceReply: true },
      );
      await rememberMessage(chatId, sent.message_id, "image_prompt", post.id, { slot: `add:${index}` });
      return;
    }

    case "imgdel": {
      if (!slot) return;
      const blocked = editBlocker(post);
      if (blocked) {
        await answerCallback(query.id);
        await sendMessage(chatId, blocked);
        return;
      }
      try {
        await removeInlineImage(post, slot);
      } catch (error) {
        await answerCallback(query.id, error instanceof Error ? error.message : "Ошибка");
        return;
      }
      await answerCallback(query.id, `Картинка ${slot} убрана`);
      const menu = renderImagesMenu((await loadPost({ id: post.id }))!);
      await editMessage(chatId, messageId, menu.text, menu.keyboard);
      return;
    }

    case "facts": {
      await answerCallback(query.id);
      await sendFactsMenu(chatId, post);
      return;
    }

    case "sug": {
      await answerCallback(query.id);
      const menu = renderSuggestionsMenu(post);
      await sendMessage(chatId, menu.text, { keyboard: menu.keyboard });
      return;
    }

    case "sugok":
    case "sugno": {
      const suggestion = post.suggestions.find((candidate) => candidate.id === slot);
      if (!suggestion || suggestion.status !== "pending") {
        await answerCallback(query.id, "Это предложение уже обработано");
        return;
      }
      const blocked = editBlocker(post);
      if (action === "sugok" && blocked) {
        await answerCallback(query.id);
        await sendMessage(chatId, blocked);
        return;
      }
      const russian = post.translations.find((t) => t.locale === "ru");
      if (action === "sugok") {
        const replaced = russian ? applySuggestion(russian.bodyMd, suggestion) : null;
        if (!replaced) {
          await answerCallback(query.id, "Этот фрагмент уже изменился");
          return;
        }
        await applyManualEdit(post, "ru", "file", replaced);
      }
      await updatePost(post.id, {
        suggestions: post.suggestions.map((candidate) =>
          candidate.id === suggestion.id ? { ...candidate, status: action === "sugok" ? "accepted" : "rejected" } : candidate,
        ),
      });
      await answerCallback(query.id, action === "sugok" ? "Внесено" : "Отклонено");
      const fresh = (await loadPost({ id: post.id }))!;
      const menu = renderSuggestionsMenu(fresh);
      await editMessage(chatId, messageId, menu.text, menu.keyboard);
      return;
    }

    case "cmp": {
      await answerCallback(query.id);
      const pairs = post.importInfo?.prepared?.pairs;
      if (post.importInfo?.mode !== "prepare" || !pairs?.length) {
        await sendMessage(chatId, "Для этой статьи нет сохранённого перевода по абзацам.");
        return;
      }
      const text = formatPairs(pairs);
      if (text.length <= 3500) {
        await sendMessage(chatId, `📑 <b>#${post.number} · оригинал и перевод</b>\n\n${escapeHtml(text)}`);
      } else {
        await sendDocument(chatId, `original-vs-translation-${post.number}.txt`, text, `📑 #${post.number} · оригинал и перевод по абзацам (${pairs.length})`);
      }
      return;
    }

    case "prv": {
      const baseline = authorTextOf(post);
      if (!post.importInfo || baseline === null) {
        await answerCallback(query.id, "Нечего подтверждать");
        return;
      }
      await setImportAcceptedHash(post.importInfo.id, textHash(baseline));
      await answerCallback(query.id, "Расхождения отмечены как проверенные");
      await refreshCard(chatId, messageId, (await loadPost({ id: post.id }))!);
      return;
    }

    case "frc": {
      await answerCallback(query.id, "Перепроверяю цитаты…");
      const fresh = await recheckFacts(post);
      await sendFactsMenu(chatId, fresh, messageId);
      return;
    }

    case "fok": {
      await answerCallback(query.id);
      const blocked = editBlocker(post);
      if (blocked) {
        await sendMessage(chatId, blocked);
        return;
      }
      const item = renderFactsMenu(post).items.find((candidate) => candidate.id === slot);
      if (!item) {
        await sendMessage(chatId, "Этот факт уже изменился. Откройте «🔎 Факты» заново.");
        return;
      }
      const sent = await sendMessage(
        chatId,
        [
          "✅ Ручная проверка факта:",
          `<i>${escapeHtml(item.claim.slice(0, 500))}</i>`,
          ...(item.sourceUrl ? [`Указанный источник: ${escapeHtml(item.sourceUrl)}`] : []),
          "",
          ...(item.conflict
            ? [
                `❗ Противоречит источнику: ${escapeHtml(item.conflict.slice(0, 400))}`,
                "Чтобы оставить текст как есть, ответьте ссылкой https://… на источник и через пробел объясните, почему текст верен. Исправить можно кнопкой ✏️ в «🔎 Факты».",
              ]
            : [
                item.sourceUrl
                  ? "Проверьте и ответьте на это сообщение ссылкой https://… на источник, где вы это подтвердили, или «+», если по указанному источнику."
                  : "Проверьте и ответьте на это сообщение ссылкой https://… на источник, где вы это подтвердили.",
              ]),
          "Отметка сохранится с датой и сбросится, если факт, цитата или источник изменятся.",
        ].join("\n"),
        { forceReply: true },
      );
      await rememberMessage(chatId, sent.message_id, "edit_prompt", post.id, { slot: `fact|${item.id}` });
      return;
    }

    case "ffx": {
      // Accepting a proposed correction is an ordinary AI edit; the facts are then checked again.
      await answerCallback(query.id);
      if (post.importInfo?.mode === "prepare") {
        await sendMessage(chatId, "В режиме «Без рерайта» текст автора не правится автоматически. Исправьте его сами («📝 Править самой») или оставьте как есть.");
        return;
      }
      const item = renderFactsMenu(post).items.find((candidate) => candidate.id === slot);
      if (!item?.suggestedFix) {
        await sendMessage(chatId, "Этот факт уже изменился. Откройте «🔎 Факты» заново.");
        return;
      }
      await requestEdit(
        chatId,
        post,
        `Замени в статье утверждение «${item.claim}» формулировкой: «${item.suggestedFix}». Обнови это утверждение в claims, с источником и дословной цитатой. Остальное не меняй.`,
      );
      return;
    }

    case "imgup": {
      if (!slot) return;
      await answerCallback(query.id);
      const name = slot === "cover" ? "обложки" : `«${slot}»`;
      const image = post.images.find((candidate) => candidate.slot === slot);
      const sent = await sendMessage(
        chatId,
        `📤 Картинка для ${name} в #${post.number}${image?.placeholderNote ? `\nНужно: ${escapeHtml(image.placeholderNote)}` : ""}\n\nОтветьте на это сообщение фотографией (подпись станет alt-текстом) или поисковым запросом для стокового фото.`,
        { forceReply: true },
      );
      await rememberMessage(chatId, sent.message_id, "image_prompt", post.id, { slot });
      return;
    }

    case "undo": {
      if (post.status === "published" || post.status === "generating") {
        await answerCallback(query.id, "Сейчас откатить нельзя");
        return;
      }
      const restored = await undoLastChange(post);
      await answerCallback(query.id, restored.length ? `Откатила: ${restored.join(", ").toUpperCase()}` : "Нечего откатывать");
      await refreshCard(chatId, messageId, (await loadPost({ id: post.id }))!);
      return;
    }

    case "pause":
    case "unpub":
    case "resume":
    case "arch":
    case "restore": {
      const hasRu = post.translations.some((t) => t.locale === "ru");
      const next = {
        pause: "paused",
        unpub: "paused",
        resume: hasRu ? "review" : "failed",
        arch: "archived",
        restore: hasRu ? "review" : "failed",
      } as const;
      if (post.status === "generating") {
        await answerCallback(query.id, "Статья ещё пишется");
        return;
      }
      await updatePost(post.id, { status: next[action] });
      if (post.status === "published") revalidateBlog();
      await answerCallback(query.id, "Готово");
      await refreshCard(chatId, messageId, (await loadPost({ id: post.id }))!);
      return;
    }

    case "retry": {
      if (post.status !== "failed") {
        await answerCallback(query.id, "Статья не в статусе ошибки");
        return;
      }
      if (!(await transitionPost(post.id, ["failed"], { status: "generating", last_error: null }))) {
        await answerCallback(query.id, "Статья не в статусе ошибки");
        return;
      }
      // A draft from /import is made again from its material, in the mode it was started in.
      const result = post.importInfo
        ? await startJob(post.id, post.importInfo.mode === "prepare" ? "prepare" : "rewrite", { importId: post.importInfo.id })
        : await startJob(post.id, "write", {});
      const blocked = limitMessage(result);
      await answerCallback(query.id);
      if (blocked) {
        await updatePost(post.id, { status: "failed", last_error: result.ok ? null : result.reason });
        await sendMessage(chatId, blocked);
        return;
      }
      await sendMessage(chatId, `✍️ Пишу #${post.number} заново.`);
      return;
    }

    case "del":
      await answerCallback(query.id);
      await sendMessage(chatId, `Удалить #${post.number} «${escapeHtml(postTitle(post))}» навсегда? Это нельзя отменить.`, {
        keyboard: [[
          { text: "🗑 Удалить", callback_data: `delok:${post.number}` },
          { text: "Отмена", callback_data: "cancel" },
        ]],
      });
      return;

    case "delok":
      if (post.status !== "archived") {
        await answerCallback(query.id, "Сначала отправьте статью в архив");
        return;
      }
      await Promise.all(post.images.map((image) => removeStoredImage(image.storagePath)));
      await deletePost(post.id);
      await answerCallback(query.id, "Удалено");
      await editMessage(chatId, messageId, `🗑 #${post.number} удалена.`);
      return;

    default:
      await answerCallback(query.id);
  }
}

async function startTranslations(chatId: number, post: EditorialPost): Promise<void> {
  const result = await startJob(post.id, "translate", { locales: ["el", "ar"], notify: "translations" }, { exclusive: true });
  if (!result.ok && result.duplicate) {
    await sendMessage(chatId, `Перевод #${post.number} уже идёт. Покажу его, когда будет готов.`);
    return;
  }
  const blocked = limitMessage(result);
  if (blocked) {
    await sendMessage(chatId, `${blocked}\nПереводы на EL/AR можно запустить позже кнопкой 🌍 в карточке.`);
    return;
  }
  await sendMessage(chatId, `🌍 Перевожу #${post.number} на греческий и арабский. Покажу перед публикацией.`);
}

/* ---------- /import: material for a new article (mode A, «Рерайт + фактчек») ---------- */

const IMPORT_LANGUAGE_ACTIONS = ["impru", "impen", "impel", "impuk"] as const;
const IMPORT_ACTIONS = new Set(["impdone", "impcancel", "impcont", "imprestart", "impmore", "imprw", "impb", "impbok", "impbback", "impother", ...IMPORT_LANGUAGE_ACTIONS]);

const IMPORT_PROMPT = [
  "📥 <b>Импорт материала</b>",
  "Пришлите ответом на это сообщение ссылку, текст или файл .txt/.md, или перешлите сюда сообщение из канала.",
  "Длинный текст можно присылать частями. Пока идёт сбор, все сообщения добавляются к материалу; когда всё — нажмите «✅ Это весь текст» или «Отменить».",
  "Материал — только отправная точка: утверждения я проверю по первоисточникам, статья будет самостоятельной.",
].join("\n");

function collectingKeyboard(importId: string): InlineKeyboard {
  return [
    [{ text: "✅ Это весь текст", callback_data: `impdone:${importId}` }],
    [{ text: "Отменить", callback_data: `impcancel:${importId}` }],
  ];
}

async function sendImportPrompt(chatId: number, importId: string): Promise<void> {
  const sent = await sendMessage(chatId, IMPORT_PROMPT, { forceReply: true });
  await rememberMessage(chatId, sent.message_id, "import", null, { slot: importId });
}

async function startImport(chatId: number): Promise<void> {
  await expireImports(chatId);
  const open = await openImport(chatId);
  if (open) {
    const started = new Date(open.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Nicosia", dateStyle: "short", timeStyle: "short" });
    const sent = await sendMessage(
      chatId,
      `📥 Есть незавершённый импорт: частей ${open.parts}, ${open.chars} символов, начат ${started}. Продолжить его или начать заново?`,
      {
        keyboard: [
          [{ text: "Продолжить", callback_data: `impcont:${open.id}` }],
          [{ text: "Начать заново", callback_data: `imprestart:${open.id}` }],
          [{ text: "Отменить", callback_data: `impcancel:${open.id}` }],
        ],
      },
    );
    await rememberMessage(chatId, sent.message_id, "import", null, { slot: open.id });
    return;
  }
  await sendImportPrompt(chatId, await createImport(chatId));
}

/** One part of the material from a message: a file, a forwarded post, a page behind a link, or text. */
async function partFromMessage(
  message: TelegramMessage,
): Promise<{ kind: PartKind; body: string; sourceUrl?: string; sourceLabel?: string } | null> {
  if (message.document) {
    const body = (await readReplyText(message)).trim();
    return body ? { kind: "file", body, sourceLabel: `файл ${message.document.file_name ?? ""}`.trim() } : null;
  }
  const body = messageText(message).trim();
  if (!body) return null;
  const forward = forwardLabel(message);
  if (forward) return { kind: "forward", body, sourceLabel: forward };
  const url = singleUrl(body);
  if (url) {
    // Loaded like every other source: public https hosts only, checked addresses and redirects, size and time limits.
    const page = await fetchSourceText(url);
    if (page.state !== "ok") {
      throw new Error(`Не получилось прочитать страницу: ${page.detail}. Вставьте текст статьи сюда или пришлите его файлом .txt.`);
    }
    return { kind: "url", body: page.text.slice(0, MAX_IMPORT_CHARS), sourceUrl: url, sourceLabel: `ссылка ${url}` };
  }
  return { kind: "text", body };
}

async function acceptImportPart(message: TelegramMessage, importId: string): Promise<void> {
  const chatId = message.chat.id;
  const current = await loadImport(importId);
  if (!current || current.status === "started" || current.status === "cancelled") {
    await sendMessage(chatId, "Этот импорт уже закрыт. Начните новый: /import");
    return;
  }
  if (current.status === "ready") {
    await sendMessage(chatId, "Материал уже собран. Чтобы добавить ещё, нажмите «➕ Добавить ещё» под сводкой.");
    return;
  }
  let part;
  try {
    part = await partFromMessage(message);
  } catch (error) {
    await sendMessage(chatId, `⚠️ ${escapeHtml(error instanceof Error ? error.message : "Не получилось прочитать сообщение.")}`);
    return;
  }
  if (!part) {
    await sendMessage(chatId, "В сообщении нет текста. Пришлите ссылку, текст или файл .txt/.md.");
    return;
  }
  const added = await addImportPart(importId, message.message_id, part);
  if (!added.ok) {
    await sendMessage(
      chatId,
      added.reason === "too_long"
        ? `Материал вышел бы длиннее ${MAX_IMPORT_CHARS} символов — эта часть не добавлена. Нажмите «✅ Это весь текст» или пришлите материал короче.`
        : "Этот импорт уже закрыт. Начните новый: /import",
    );
    return;
  }
  const sent = await sendMessage(
    chatId,
    `📥 Часть ${added.parts} добавлена${part.kind === "url" ? " (текст страницы)" : part.kind === "forward" ? " (пересланное сообщение)" : ""}. Всего ${added.chars} символов.\nВсё, что пришлёте дальше, добавлю к материалу. Готово — «✅ Это весь текст».`,
    { keyboard: collectingKeyboard(importId) },
  );
  await rememberMessage(chatId, sent.message_id, "import", null, { slot: importId });
}

function importSummary(record: NonNullable<Awaited<ReturnType<typeof loadImport>>>): { text: string; keyboard: InlineKeyboard } {
  const importId = record.id;
  const sourceText = record.sourceText ?? "";
  const preview = sourceText.replace(/\s+/g, " ").slice(0, 300);
  const mark = (code: string, label: string) => `${record.language === code ? "✓ " : ""}${label}`;
  const otherSelected = record.language?.startsWith("other:") ?? false;
  const choices = LANGUAGE_CHOICES.map((choice, index) => ({
    text: mark(choice.code, choice.label),
    callback_data: `${IMPORT_LANGUAGE_ACTIONS[index]}:${importId}`,
  }));
  const keyboard: InlineKeyboard = [
    choices.slice(0, 3),
    [choices[3], { text: otherSelected ? "✓ Другой язык" : "Другой язык", callback_data: `impother:${importId}` }],
  ];
  // The article is not started until the language of the original is chosen.
  if (record.language) {
    keyboard.push([
      { text: "🔍 Рерайт + фактчек", callback_data: `imprw:${importId}` },
      { text: "📄 Без рерайта", callback_data: `impb:${importId}` },
    ]);
  }
  keyboard.push([{ text: "➕ Добавить ещё", callback_data: `impmore:${importId}` }], [{ text: "Отменить", callback_data: `impcancel:${importId}` }]);
  return {
    text: [
      "📥 <b>Материал собран</b>",
      `Частей: ${record.parts} · символов: ${sourceText.length} · язык оригинала: <b>${escapeHtml(languageLabel(record.language))}</b>`,
      `Откуда: ${escapeHtml(record.sourceLabel ?? "текст от редактора")}`,
      "",
      `<i>${escapeHtml(preview)}${sourceText.length > 300 ? "…" : ""}</i>`,
      "",
      record.language
        ? "Язык можно поменять, пока статья не запущена. «🔍 Рерайт + фактчек»: найду первоисточники, проверю утверждения и напишу самостоятельную статью на русском, затем английский перевод и обычная карточка. Материал не публикуется и не считается источником.\n«📄 Без рерайта»: текст останется вашим — исправлю только орфографию и оформление (или точно переведу на русский), добавлю структуру и проверю факты."
        : "Выберите язык оригинала — без этого статья не запустится.",
    ].join("\n"),
    keyboard,
  };
}

async function sendImportSummary(chatId: number, importId: string): Promise<void> {
  const record = await loadImport(importId);
  if (!record?.sourceText) return;
  const summary = importSummary(record);
  const sent = await sendMessage(chatId, summary.text, { keyboard: summary.keyboard });
  await rememberMessage(chatId, sent.message_id, "import", null, { slot: importId });
}

/** Saves the chosen language while the import is ready, and refreshes the summary it was chosen on. */
async function setImportLanguage(chatId: number, importId: string, language: string, summaryMessageId?: number): Promise<boolean> {
  if (!(await transitionImport(importId, ["ready"], { language }))) return false;
  if (summaryMessageId) {
    const record = await loadImport(importId);
    if (record?.sourceText) {
      const summary = importSummary(record);
      await editMessage(chatId, summaryMessageId, summary.text, summary.keyboard);
    }
  }
  return true;
}

async function handleImportCallback(query: TelegramCallbackQuery, action: string, importId: string): Promise<void> {
  const chatId = query.message!.chat.id;
  const messageId = query.message!.message_id;
  switch (action) {
    case "impcancel": {
      const removed = await deleteImport(importId);
      await answerCallback(query.id, removed ? "Отменено" : undefined);
      await editMessage(chatId, messageId, removed ? "📥 Импорт отменён." : "Этот импорт уже передан в работу или закрыт.");
      return;
    }
    case "impcont": {
      const record = await loadImport(importId);
      await answerCallback(query.id);
      if (record?.status === "collecting") await sendImportPrompt(chatId, importId);
      else if (record?.status === "ready") await sendImportSummary(chatId, importId);
      else await sendMessage(chatId, "Этот импорт уже закрыт. Начните новый: /import");
      return;
    }
    case "imprestart": {
      await deleteImport(importId);
      await answerCallback(query.id);
      await editMessage(chatId, messageId, "📥 Старый импорт удалён.");
      await sendImportPrompt(chatId, await createImport(chatId));
      return;
    }
    case "impmore": {
      if (!(await transitionImport(importId, ["ready"], { status: "collecting" }))) {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      await answerCallback(query.id);
      await sendImportPrompt(chatId, importId);
      return;
    }
    case "impru":
    case "impen":
    case "impel":
    case "impuk": {
      const index = (IMPORT_LANGUAGE_ACTIONS as readonly string[]).indexOf(action);
      if (!(await setImportLanguage(chatId, importId, LANGUAGE_CHOICES[index].code, messageId))) {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      await answerCallback(query.id, `Язык: ${LANGUAGE_CHOICES[index].label}`);
      return;
    }
    case "impother": {
      const record = await loadImport(importId);
      if (record?.status !== "ready") {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      await answerCallback(query.id);
      const sent = await sendMessage(chatId, "Напишите название языка оригинала ответом на это сообщение (например, «польский»).", { forceReply: true });
      await rememberMessage(chatId, sent.message_id, "import", null, { slot: importId, payload: "language" });
      return;
    }
    case "impdone": {
      const parts = await importParts(importId);
      if (parts.length === 0) {
        await answerCallback(query.id, "Сначала пришлите материал");
        return;
      }
      const material = assembleParts(parts);
      const won = await transitionImport(importId, ["collecting"], {
        status: "ready",
        source_text: material.text,
        // Chosen by the editor on the summary, every time the material is closed.
        language: null,
        source_url: material.sourceUrl,
        source_label: material.sourceLabel,
      });
      if (!won) {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      await answerCallback(query.id);
      await editMessage(chatId, messageId, "📥 Материал собран.");
      await sendImportSummary(chatId, importId);
      return;
    }
    case "impb": {
      const record = await loadImport(importId);
      if (record?.status !== "ready" || !record.sourceText) {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      if (!record.language) {
        await answerCallback(query.id, "Сначала выберите язык оригинала");
        return;
      }
      if (record.sourceText.length > MAX_PREPARE_CHARS) {
        await answerCallback(query.id);
        await sendMessage(
          chatId,
          `Текст длиннее ${MAX_PREPARE_CHARS} символов (${record.sourceText.length}): в режиме «Без рерайта» он обрабатывается за один раз. Разделите его на части и импортируйте по отдельности или используйте «🔍 Рерайт + фактчек».`,
        );
        return;
      }
      await answerCallback(query.id);
      const foreign = record.language !== "ru";
      await editMessage(
        chatId,
        messageId,
        [
          "📄 <b>Режим «Без рерайта»</b>",
          foreign
            ? `Текст на языке «${escapeHtml(languageLabel(record.language))}»: режим «Без рерайта» переведёт его на русский точно по смыслу — стиль, тон, структура и все факты сохраняются. Оригинал останется в импорте, его можно сравнить с переводом по абзацам («📑 Сравнить с оригиналом»).`
            : "Текст останется вашим: исправлю только орфографию, пунктуацию, пробелы, кавычки, тире и оформление; слова, стиль и длина не меняются. Всё остальное, что стоит поправить, окажется в списке «✍️ Предложения», решать вам.",
          "Я добавлю заголовки, «Коротко», FAQ, источники и картинки и проверю факты. Важные факты без подтверждения блокируют публикацию; текст автоматически я не исправляю.",
          "",
          "⚠️ Публиковать можно только материал, на который у редакции есть права: ваш собственный текст или текст, который вам разрешили опубликовать. Нажимая кнопку ниже, вы это подтверждаете; дата подтверждения сохранится в импорте.",
        ].join("\n"),
        [
          [{ text: "✅ Права есть, продолжить", callback_data: `impbok:${importId}` }],
          [{ text: "⬅️ Назад", callback_data: `impbback:${importId}` }],
        ],
      );
      return;
    }
    case "impbback": {
      const record = await loadImport(importId);
      await answerCallback(query.id);
      if (record?.status !== "ready" || !record.sourceText) {
        await editMessage(chatId, messageId, "Этот импорт уже передан в работу или закрыт.");
        return;
      }
      const summary = importSummary(record);
      await editMessage(chatId, messageId, summary.text, summary.keyboard);
      return;
    }
    case "impbok": {
      const record = await loadImport(importId);
      if (record?.status !== "ready" || !record.sourceText || !record.language || record.sourceText.length > MAX_PREPARE_CHARS) {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      // Same pattern as mode A: the draft is created first and attached by a conditional update.
      const post = await createPost(importTopic(record.sourceText));
      if (
        !(await transitionImport(importId, ["ready"], {
          status: "started",
          mode: "prepare",
          rights_confirmed_at: new Date().toISOString(),
          post_id: post.id,
        }))
      ) {
        await deletePost(post.id);
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      await answerCallback(query.id);
      await editMessage(chatId, messageId, `📥 Материал передан в работу без рерайта: статья #${post.number}.`);
      const result = await startJob(post.id, "prepare", { importId });
      const blocked = limitMessage(result);
      if (blocked) {
        await updatePost(post.id, { status: "failed", last_error: result.ok ? null : result.reason });
        await sendMessage(chatId, `${blocked}\nЧерновик #${post.number} сохранён: его можно запустить позже кнопкой «Написать заново».`);
        return;
      }
      await sendMessage(
        chatId,
        `📄 Готовлю <b>#${post.number}</b> без рерайта: ${record.language === "ru" ? "проверяю орфографию" : "перевожу"}, добавляю структуру и проверяю факты.\nОбычно это занимает 3–6 минут. Пришлю карточку, когда будет готово.`,
      );
      return;
    }
    case "imprw": {
      const record = await loadImport(importId);
      if (record?.status !== "ready" || !record.sourceText) {
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      if (!record.language) {
        await answerCallback(query.id, "Сначала выберите язык оригинала");
        return;
      }
      // The draft is created first and attached by a conditional update: of two simultaneous taps
      // only one attaches its draft, the other removes its own.
      const post = await createPost(importTopic(record.sourceText));
      if (!(await transitionImport(importId, ["ready"], { status: "started", mode: "rewrite", post_id: post.id }))) {
        await deletePost(post.id);
        await answerCallback(query.id, "Уже обрабатывается");
        return;
      }
      await answerCallback(query.id);
      await editMessage(chatId, messageId, `📥 Материал передан в работу: статья #${post.number}.`);
      const result = await startJob(post.id, "rewrite", { importId });
      const blocked = limitMessage(result);
      if (blocked) {
        await updatePost(post.id, { status: "failed", last_error: result.ok ? null : result.reason });
        await sendMessage(chatId, `${blocked}\nЧерновик #${post.number} сохранён: его можно запустить позже кнопкой «Написать заново».`);
        return;
      }
      await sendMessage(
        chatId,
        `🔍 Начала статью <b>#${post.number}</b> из импорта: ищу первоисточники и проверяю утверждения.\nОбычно это занимает 3–6 минут. Пришлю карточку, когда будет готово.`,
      );
      return;
    }
  }
}

/** Entry point for one verified admin update. */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (error) {
    console.error("editorial: update failed", error);
    if (update.callback_query) await answerCallback(update.callback_query.id, "Ошибка");
    if (chatId) {
      await sendMessage(
        chatId,
        `⚠️ Что-то пошло не так: <code>${escapeHtml(error instanceof Error ? error.message.slice(0, 300) : "unknown")}</code>`,
      ).catch(() => undefined);
    }
  }
}
