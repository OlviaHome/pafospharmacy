import type { Pharmacy } from "@/lib/domain/types";
import type { Locale } from "@/lib/i18n/types";

type PharmacyAddress = Pick<
  Pharmacy,
  "addressLine" | "addressAdditional" | "locality" | "postalCode"
>;
type PharmacyName = Pick<Pharmacy, "name">;
type TransliterationLocale = Exclude<Locale, "el">;

export type AddressDisplaySource = "canonical" | "canonical_transliteration";

export interface LocalizedAddress {
  text: string;
  source: AddressDisplaySource;
}

interface TransliterationProfile {
  characters: Readonly<Record<string, string>>;
  digraphs: Readonly<Record<string, string>>;
  initialCharacters?: Readonly<Record<string, string>>;
  targetCaseLocale?: "en" | "ru";
}

const transliterationProfiles: Record<TransliterationLocale, TransliterationProfile> = {
  en: {
    targetCaseLocale: "en",
    digraphs: {
      ου: "ou",
      αι: "ai",
      ει: "i",
      οι: "i",
      γγ: "ng",
      γκ: "gk",
      μπ: "b",
      ντ: "d",
      τσ: "ts",
      τζ: "tz",
    },
    characters: {
      α: "a",
      β: "v",
      γ: "g",
      δ: "d",
      ε: "e",
      ζ: "z",
      η: "i",
      θ: "th",
      ι: "i",
      κ: "k",
      λ: "l",
      μ: "m",
      ν: "n",
      ξ: "x",
      ο: "o",
      π: "p",
      ρ: "r",
      σ: "s",
      ς: "s",
      τ: "t",
      υ: "y",
      φ: "f",
      χ: "ch",
      ψ: "ps",
      ω: "o",
    },
  },
  ru: {
    targetCaseLocale: "ru",
    digraphs: {
      ου: "у",
      αι: "э",
      ει: "и",
      οι: "и",
      γγ: "нг",
      γκ: "гк",
      μπ: "б",
      ντ: "д",
      τσ: "ц",
      τζ: "дз",
    },
    characters: {
      α: "а",
      β: "в",
      γ: "г",
      δ: "д",
      ε: "е",
      ζ: "з",
      η: "и",
      θ: "т",
      ι: "и",
      κ: "к",
      λ: "л",
      μ: "м",
      ν: "н",
      ξ: "кс",
      ο: "о",
      π: "п",
      ρ: "р",
      σ: "с",
      ς: "с",
      τ: "т",
      υ: "и",
      φ: "ф",
      χ: "х",
      ψ: "пс",
      ω: "о",
    },
  },
  ar: {
    digraphs: {
      ου: "و",
      αι: "اي",
      ει: "ي",
      οι: "ي",
      γγ: "نغ",
      γκ: "غك",
      μπ: "ب",
      ντ: "د",
      τσ: "تس",
      τζ: "تز",
    },
    initialCharacters: {
      α: "أ",
      ε: "إ",
      η: "إي",
      ι: "إي",
      ο: "أو",
      υ: "إي",
      ω: "أو",
    },
    characters: {
      α: "ا",
      β: "ف",
      γ: "غ",
      δ: "ذ",
      ε: "ي",
      ζ: "ز",
      η: "ي",
      θ: "ث",
      ι: "ي",
      κ: "ك",
      λ: "ل",
      μ: "م",
      ν: "ن",
      ξ: "كس",
      ο: "و",
      π: "ب",
      ρ: "ر",
      σ: "س",
      ς: "س",
      τ: "ت",
      υ: "ي",
      φ: "ف",
      χ: "خ",
      ψ: "بس",
      ω: "و",
    },
  },
};

function matchGreekCase(
  source: string,
  transliteration: string,
  targetLocale: "en" | "ru" | undefined,
): string {
  if (!targetLocale) {
    return transliteration;
  }
  if ([...source].length > 1 && source === source.toLocaleUpperCase("el")) {
    return transliteration.toLocaleUpperCase(targetLocale);
  }
  if (source[0] === source[0]?.toLocaleUpperCase("el")) {
    return `${transliteration[0]?.toLocaleUpperCase(targetLocale) ?? ""}${transliteration.slice(1)}`;
  }
  return transliteration;
}

function transliterateGreekSegment(
  segment: string,
  profile: TransliterationProfile,
): string {
  const characters = [...segment];
  const transliterated: string[] = [];

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const nextCharacter = characters[index + 1];
    const pair = nextCharacter ? `${character}${nextCharacter}` : null;
    const lowerPair = pair?.toLocaleLowerCase("el");
    const digraph = lowerPair ? profile.digraphs[lowerPair] : undefined;

    if (digraph && pair) {
      transliterated.push(
        matchGreekCase(pair, digraph, profile.targetCaseLocale),
      );
      index += 1;
      continue;
    }

    const lowerCharacter = character.toLocaleLowerCase("el");
    const replacement =
      (index === 0 ? profile.initialCharacters?.[lowerCharacter] : undefined) ??
      profile.characters[lowerCharacter];
    if (!replacement) {
      return segment;
    }
    transliterated.push(
      matchGreekCase(character, replacement, profile.targetCaseLocale),
    );
  }

  return transliterated.join("");
}

export function transliterateCanonicalGreek(
  value: string,
  locale: TransliterationLocale = "en",
): string {
  const profile = transliterationProfiles[locale];
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/\p{Script=Greek}+/gu, (segment) =>
    transliterateGreekSegment(segment, profile),
  );
}

function localizedCanonicalText(value: string, locale: Locale): LocalizedAddress {
  if (locale === "el" || !/\p{Script=Greek}/u.test(value)) {
    return { text: value, source: "canonical" };
  }

  const transliterated = transliterateCanonicalGreek(value, locale);
  return transliterated !== value
    ? { text: transliterated, source: "canonical_transliteration" }
    : { text: value, source: "canonical" };
}

export function canonicalPharmacyAddress(pharmacy: PharmacyAddress): string {
  return `${pharmacy.addressLine}${pharmacy.addressAdditional ? `, ${pharmacy.addressAdditional}` : ""}, ${pharmacy.locality}${pharmacy.postalCode ? ` ${pharmacy.postalCode}` : ""}`;
}

export function localizedPharmacyName(
  pharmacy: PharmacyName,
  locale: Locale,
): LocalizedAddress {
  return localizedCanonicalText(pharmacy.name, locale);
}

export function localizedPharmacyAddress(
  pharmacy: PharmacyAddress,
  locale: Locale,
): LocalizedAddress {
  return localizedCanonicalText(canonicalPharmacyAddress(pharmacy), locale);
}
