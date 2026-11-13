import type { LocationSearchDistrict } from "@/lib/location/manual-search";
import type { Locale } from "./types";

export const DISTRICT_SLUGS = ["nicosia", "limassol", "larnaca", "famagusta", "paphos"] as const;
export type DistrictSlug = (typeof DISTRICT_SLUGS)[number];

export const DISTRICT_BY_SLUG: Record<DistrictSlug, LocationSearchDistrict> = {
  nicosia: "Nicosia",
  limassol: "Limassol",
  larnaca: "Larnaca",
  famagusta: "Famagusta",
  paphos: "Paphos",
};

export const SLUG_BY_DISTRICT: Record<LocationSearchDistrict, DistrictSlug> = {
  Nicosia: "nicosia",
  Limassol: "limassol",
  Larnaca: "larnaca",
  Famagusta: "famagusta",
  Paphos: "paphos",
};

const NAMES: Record<Locale, Record<DistrictSlug, { name: string; inDistrict: string }>> = {
  en: {
    nicosia: { name: "Nicosia", inDistrict: "Nicosia" },
    limassol: { name: "Limassol", inDistrict: "Limassol" },
    larnaca: { name: "Larnaca", inDistrict: "Larnaca" },
    famagusta: { name: "Famagusta", inDistrict: "Famagusta" },
    paphos: { name: "Paphos", inDistrict: "Paphos" },
  },
  el: {
    nicosia: { name: "Λευκωσία", inDistrict: "στη Λευκωσία" },
    limassol: { name: "Λεμεσός", inDistrict: "στη Λεμεσό" },
    larnaca: { name: "Λάρνακα", inDistrict: "στη Λάρνακα" },
    famagusta: { name: "Αμμόχωστος", inDistrict: "στην Αμμόχωστο" },
    paphos: { name: "Πάφος", inDistrict: "στην Πάφο" },
  },
  ru: {
    nicosia: { name: "Никосии", inDistrict: "Никосии" },
    limassol: { name: "Лимассола", inDistrict: "Лимассоле" },
    larnaca: { name: "Ларнаки", inDistrict: "Ларнаке" },
    famagusta: { name: "Фамагусты", inDistrict: "Фамагусте" },
    paphos: { name: "Пафоса", inDistrict: "Пафосе" },
  },
  ar: {
    nicosia: { name: "نيقوسيا", inDistrict: "نيقوسيا" },
    limassol: { name: "ليماسول", inDistrict: "ليماسول" },
    larnaca: { name: "لارنكا", inDistrict: "لارنكا" },
    famagusta: { name: "فاماغوستا", inDistrict: "فاماغوستا" },
    paphos: { name: "بافوس", inDistrict: "بافوس" },
  },
};

const GREEK_GENITIVE: Record<DistrictSlug, string> = {
  nicosia: "Λευκωσίας",
  limassol: "Λεμεσού",
  larnaca: "Λάρνακας",
  famagusta: "Αμμοχώστου",
  paphos: "Πάφου",
};

export function isDistrictSlug(value: string): value is DistrictSlug {
  return DISTRICT_SLUGS.includes(value as DistrictSlug);
}

export function districtPageCopy(locale: Locale, slug: DistrictSlug) {
  const { name, inDistrict } = NAMES[locale][slug];
  switch (locale) {
    case "en": return {
      title: `Pharmacies in ${name}: On Duty Today & Open Now | HealthGuide.cy`,
      description: `Find pharmacies on duty today and open now in ${name}, Cyprus. Check official schedule information, phone numbers, hours and directions.`,
      h1: `Pharmacies on Duty and Open Now in ${name}`,
    };
    case "el": return {
      title: `Εφημερεύοντα Φαρμακεία ${GREEK_GENITIVE[slug]} Σήμερα | HealthGuide.cy`,
      description: `Βρείτε εφημερεύοντα και ανοιχτά φαρμακεία ${inDistrict}. Δείτε επίσημα στοιχεία για ωράριο, τηλέφωνα και οδηγίες.`,
      h1: `Εφημερεύοντα και ανοιχτά φαρμακεία ${inDistrict}`,
    };
    case "ru": return {
      title: `Дежурные аптеки ${name} сегодня | HealthGuide.cy`,
      description: `Найдите дежурные и открытые сейчас аптеки в ${inDistrict}. Официальные данные о расписании, телефоны, часы работы и маршруты.`,
      h1: `Дежурные и открытые аптеки в ${inDistrict}`,
    };
    case "ar": return {
      title: `الصيدليات المناوبة في ${name} اليوم | HealthGuide.cy`,
      description: `ابحث عن الصيدليات المناوبة والمفتوحة الآن في ${inDistrict}. معلومات رسمية عن الجدول وساعات العمل وأرقام الهاتف والاتجاهات.`,
      h1: `الصيدليات المناوبة والمفتوحة الآن في ${inDistrict}`,
    };
  }
}
