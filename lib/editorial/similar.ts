/**
 * Rough duplicate detection between article topics and titles, across Russian and English.
 * It only warns: the editor decides whether a similar article is really a duplicate.
 */

const STOPWORDS = new Set([
  // Russian
  "как", "что", "это", "для", "или", "при", "если", "где", "кто", "кому", "чем", "так", "все", "всё",
  "его", "она", "они", "оно", "вас", "вам", "нас", "над", "под", "без", "про", "через", "после", "можно",
  "нужно", "есть", "быть", "кипр", "кипре", "кипра", "на", "по", "из", "от", "до", "не", "ли", "же",
  // English
  "the", "and", "for", "how", "what", "who", "with", "your", "you", "are", "can", "from", "about", "cyprus", "guide",
]);

/** Spelling variants of the same idea, mapped to one key. */
const ALIASES: [RegExp, string][] = [
  [/^(геси|гези|гэси|gesy|gesi|γεσυ)/, "gesy"],
  [/^(зарег|регистр|registr|register|εγγραφ)/, "register"],
  [/^(аптек|pharmac|φαρμακ)/, "pharmacy"],
  [/^(дежурн|on-?duty|εφημερ)/, "duty"],
  [/^(врач|доктор|doctor|γιατρ)/, "doctor"],
  [/^(больниц|госпитал|hospital|νοσοκομ)/, "hospital"],
  [/^(страхов|insuranc|ασφαλ)/, "insurance"],
];

export function topicStems(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}-]+/u)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  return new Set(
    words.map((word) => {
      for (const [pattern, key] of ALIASES) if (pattern.test(word)) return key;
      return [...word].slice(0, 5).join("");
    }),
  );
}

export interface TopicCandidate {
  number: number;
  status: string;
  topic: string;
  titles: string[];
}

export interface SimilarMatch {
  number: number;
  status: string;
  title: string;
  score: number;
}

/** Articles whose topic or a title shares most key words with the new topic, best first. */
export function findSimilar(topic: string, candidates: TopicCandidate[], limit = 3): SimilarMatch[] {
  const wanted = topicStems(topic);
  if (wanted.size === 0) return [];
  const matches: SimilarMatch[] = [];
  for (const candidate of candidates) {
    let best = 0;
    for (const text of [candidate.topic, ...candidate.titles]) {
      const stems = topicStems(text);
      if (stems.size === 0) continue;
      const common = [...wanted].filter((stem) => stems.has(stem)).length;
      if (common < 2) continue;
      best = Math.max(best, common / Math.min(wanted.size, stems.size));
    }
    if (best >= 0.5) {
      matches.push({
        number: candidate.number,
        status: candidate.status,
        title: candidate.titles[0] ?? candidate.topic,
        score: best,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score || b.number - a.number).slice(0, limit);
}
