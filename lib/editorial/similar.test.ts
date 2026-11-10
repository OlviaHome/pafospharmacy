import { describe, expect, it } from "vitest";

import { findSimilar, topicStems } from "./similar";

const existing = [
  {
    number: 1,
    status: "published",
    topic: "Что такое ГеСИ на Кипре, как зарегаться и кому доступно",
    titles: ["Что такое ГеСИ и как зарегистрироваться", "What is GeSY and how to register"],
  },
  { number: 2, status: "review", topic: "Как найти дежурную аптеку ночью", titles: [] },
];

describe("findSimilar", () => {
  it("finds the same topic phrased differently", () => {
    expect(findSimilar("Регистрация в GESY: пошагово", existing).map((m) => m.number)).toEqual([1]);
    expect(findSimilar("How to register for GeSY in Cyprus", existing).map((m) => m.number)).toEqual([1]);
  });

  it("ignores unrelated topics that share one word", () => {
    expect(findSimilar("Какие лекарства продают без рецепта в аптеке", existing)).toEqual([]);
    expect(findSimilar("Частные больницы Лимассола", existing)).toEqual([]);
  });

  it("matches an exact repeat", () => {
    expect(findSimilar("Как найти дежурную аптеку ночью", existing)[0]).toMatchObject({ number: 2, score: 1 });
  });

  it("drops stopwords and short words", () => {
    expect([...topicStems("Как и что на Кипре")]).toEqual([]);
  });
});
