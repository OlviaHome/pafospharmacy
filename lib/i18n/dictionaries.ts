import "server-only";

import { ar } from "./locales/ar";
import { el } from "./locales/el";
import { en } from "./locales/en";
import { ru } from "./locales/ru";
import type { Locale, TranslationDictionary } from "./types";

const dictionaries: Record<Locale, TranslationDictionary> = { en, el, ru, ar };

export function getDictionary(locale: Locale): TranslationDictionary {
  return dictionaries[locale];
}
