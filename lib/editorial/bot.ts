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
  renderTranslationsCard,
} from "./cards";
import { editorialLimits, openAiModel, siteOrigin, telegramConfig, unsplashKey } from "./config";
import { removeStoredImage, storeImageBytes } from "./images";
import type { JobKind } from "./limits";
import { nextStockImage, setNotifier, startJob, type StartResult } from "./pipeline";
import {
  createPost,
  deletePost,
  findMessage,
  hasUndo,
  listPosts,
  loadPost,
  postCostUsd,
  rememberMessage,
  setTranslationStatus,
  undoLastChange,
  updatePost,
  upsertImage,
  usageSnapshot,
  type EditorialPost,
} from "./store";
import { answerCallback, downloadFile, editMessage, escapeHtml, sendMessage, sendTyping } from "./telegram";

const MAX_TOPIC_LENGTH = 500;
const MAX_INSTRUCTION_LENGTH = 2000;

function adminChatId(): number {
  return Number(telegramConfig().adminId);
}

/* ---------- cards ---------- */

async function cardFor(post: EditorialPost) {
  const [costUsd, canUndo] = await Promise.all([postCostUsd(post.id), hasUndo(post.id)]);
  return renderCard(post, siteOrigin(), { costUsd, canUndo });
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
  const card = renderTranslationsCard(post, siteOrigin());
  const sent = await sendMessage(chatId, card.text, { keyboard: card.keyboard });
  await rememberMessage(chatId, sent.message_id, "card", post.id);
}

setNotifier({
  card: (post) => sendCard(adminChatId(), post),
  translations: (post) => sendTranslationsCard(adminChatId(), post),
  failure: async (post, kind, message) => {
    const what: Record<JobKind, string> = { write: "написать статью", edit: "внести правку", translate: "перевести" };
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
3. ✏️ Правки: ответьте текстом, что исправить. ↩️ Откатить вернёт предыдущую версию.
4. 🖼 Картинки: другое стоковое фото, своя картинка или свой поисковый запрос.
5. ✅ Опубликовать RU + EN. После этого переведу на греческий и арабский и тоже покажу перед публикацией.

<b>Команды</b>
/drafts: черновики
/published: опубликованные
/usage: расходы и лимиты`;

async function startArticle(chatId: number, topic: string): Promise<void> {
  const clean = topic.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC_LENGTH);
  if (clean.length < 5) {
    await sendMessage(chatId, "Тема слишком короткая. Пример: <code>/new Что такое ГеСИ и как зарегистрироваться</code>");
    return;
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
  if (context.purpose === "topic_confirm" && context.payload === "ask") {
    await startArticle(chatId, text);
    return;
  }
  const post = context.postId ? await loadPost({ id: context.postId }) : null;
  if (!post) {
    await sendMessage(chatId, "Эта статья уже удалена.");
    return;
  }

  if (context.purpose === "image_prompt" && context.slot) {
    await handleImageReply(message, post, context.slot, text);
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
  // Mark as busy before the job starts so the job's own status update always wins.
  await updatePost(post.id, { status: "generating" });
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
  if (action === "newok") {
    await answerCallback(query.id);
    const context = await findMessage(chatId, messageId);
    if (!context?.payload || context.purpose !== "topic_confirm") {
      await editMessage(chatId, messageId, "Тема не найдена, напишите её ещё раз.");
      return;
    }
    await editMessage(chatId, messageId, `Тема: «${escapeHtml(context.payload)}»`);
    // Prevent a double tap from starting two articles.
    await rememberMessage(chatId, messageId, "topic_confirm", null, { payload: "" });
    await startArticle(chatId, context.payload);
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
      const missing = activeImages(post).filter((image) => !image.url);
      if (action === "pub" && missing.length > 0) {
        await answerCallback(query.id);
        await sendMessage(
          chatId,
          `В #${post.number} ${missing.length} мест(а) без картинки (${missing.map((image) => image.slot).join(", ")}). На сайте они будут просто скрыты. Публиковать?`,
          {
            keyboard: [[
              { text: "✅ Да, публиковать", callback_data: `pubok:${post.number}` },
              { text: "🖼 Сначала картинки", callback_data: `img:${post.number}` },
            ]],
          },
        );
        return;
      }
      await answerCallback(query.id, "Публикую…");
      await setTranslationStatus(post.id, ["ru", "en"], "published");
      await updatePost(post.id, {
        status: "published",
        published_at: post.publishedAt ?? new Date().toISOString(),
        last_error: null,
      });
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
      await startTranslations(chatId, post);
      return;

    case "pubtr": {
      const locales = post.translations
        .filter((t) => (t.locale === "el" || t.locale === "ar") && t.status === "review")
        .map((t) => t.locale as Locale);
      if (post.status !== "published" || locales.length === 0) {
        await answerCallback(query.id, "Нечего публиковать");
        return;
      }
      await answerCallback(query.id, "Публикую…");
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
      await updatePost(post.id, { status: "generating", last_error: null });
      const result = await startJob(post.id, "write", {});
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
  const result = await startJob(post.id, "translate", { locales: ["el", "ar"], notify: "translations" });
  const blocked = limitMessage(result);
  if (blocked) {
    await sendMessage(chatId, `${blocked}\nПереводы на EL/AR можно запустить позже кнопкой 🌍 в карточке.`);
    return;
  }
  await sendMessage(chatId, `🌍 Перевожу #${post.number} на греческий и арабский. Покажу перед публикацией.`);
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
