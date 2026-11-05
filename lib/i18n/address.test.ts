import { describe, expect, it } from "vitest";

import {
  canonicalPharmacyAddress,
  localizedPharmacyAddress,
  localizedPharmacyName,
  transliterateCanonicalGreek,
} from "@/lib/i18n/address";

const canonicalName = { name: "Παναγιώτου Έλενα" };
const canonicalAddress = {
  addressLine: "Λεωφ. Ελλάδος 74",
  addressAdditional: "Δίπλα από κλινική",
  locality: "Πάφος",
  postalCode: "8020",
};

describe("localized pharmacy identity", () => {
  it("keeps the canonical official name and address for Greek", () => {
    expect(localizedPharmacyName(canonicalName, "el")).toEqual({
      text: "Παναγιώτου Έλενα",
      source: "canonical",
    });
    expect(localizedPharmacyAddress(canonicalAddress, "el")).toEqual({
      text: "Λεωφ. Ελλάδος 74, Δίπλα από κλινική, Πάφος 8020",
      source: "canonical",
    });
  });

  it.each([
    [
      "en",
      "Panagiotou Elena",
      "Leof. Ellados 74, Dipla apo kliniki, Pafos 8020",
    ],
    [
      "ru",
      "Панагиоту Елена",
      "Леоф. Елладос 74, Дипла апо клиники, Пафос 8020",
    ],
    [
      "ar",
      "باناغيوتو إلينا",
      "ليوف. إللاذوس 74, ذيبلا أبو كلينيكي, بافوس 8020",
    ],
  ] as const)(
    "transliterates the canonical name and address for %s without mutating them",
    (locale, expectedName, expectedAddress) => {
      const nameBefore = structuredClone(canonicalName);
      const addressBefore = structuredClone(canonicalAddress);

      expect(localizedPharmacyName(canonicalName, locale)).toEqual({
        text: expectedName,
        source: "canonical_transliteration",
      });
      expect(localizedPharmacyAddress(canonicalAddress, locale)).toEqual({
        text: expectedAddress,
        source: "canonical_transliteration",
      });
      expect(canonicalName).toEqual(nameBefore);
      expect(canonicalAddress).toEqual(addressBefore);
    },
  );

  it.each(["en", "ru", "ar"] as const)(
    "falls back to unchanged canonical text when no Greek transliteration is available for %s",
    (locale) => {
      const alreadyLatinName = { name: "Aphrodite Pharmacy" };
      const alreadyLatinAddress = {
        addressLine: "12 Apostolou Pavlou Avenue",
        addressAdditional: null,
        locality: "Paphos",
        postalCode: null,
      };

      expect(localizedPharmacyName(alreadyLatinName, locale)).toEqual({
        text: alreadyLatinName.name,
        source: "canonical",
      });
      expect(localizedPharmacyAddress(alreadyLatinAddress, locale)).toEqual({
        text: canonicalPharmacyAddress(alreadyLatinAddress),
        source: "canonical",
      });
    },
  );

  it.each(["en", "ru", "ar"] as const)(
    "preserves an unsupported Greek segment instead of partially fabricating it for %s",
    (locale) => {
      expect(localizedPharmacyName({ name: "ΑϠΒ Pharmacy" }, locale)).toEqual({
        text: "ΑϠΒ Pharmacy",
        source: "canonical",
      });
    },
  );

  it("preserves numbers, punctuation, and existing Latin text", () => {
    expect(transliterateCanonicalGreek("Οδός Χλωράκας A.B. 12/3", "en")).toBe(
      "Odos Chlorakas A.B. 12/3",
    );
    expect(transliterateCanonicalGreek("Οδός Χλωράκας A.B. 12/3", "ru")).toBe(
      "Одос Хлоракас A.B. 12/3",
    );
    expect(transliterateCanonicalGreek("Οδός Χλωράκας A.B. 12/3", "ar")).toBe(
      "أوذوس خلوراكاس A.B. 12/3",
    );
  });
});
