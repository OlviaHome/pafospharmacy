import { describe, expect, it } from "vitest";

import { adminActor, secretMatches, type TelegramUpdate } from "./auth";

const ADMIN = "123456789";

function message(fromId: number, chatId = fromId, type = "private"): TelegramUpdate {
  return {
    update_id: 1,
    message: { message_id: 1, from: { id: fromId }, chat: { id: chatId, type }, text: "/new тема" },
  };
}

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret-value-123456", "s3cret-value-123456")).toBe(true);
    expect(secretMatches("s3cret-value-123457", "s3cret-value-123456")).toBe(false);
    expect(secretMatches("s3cret", "s3cret-value-123456")).toBe(false);
  });

  it("rejects missing values", () => {
    expect(secretMatches(null, "s3cret-value-123456")).toBe(false);
    expect(secretMatches(undefined, "s3cret-value-123456")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("adminActor", () => {
  it("accepts the admin in a private chat", () => {
    expect(adminActor(message(123456789), ADMIN)).toEqual({ chatId: 123456789, kind: "message" });
  });

  it("ignores any other user", () => {
    expect(adminActor(message(987654321), ADMIN)).toBeNull();
  });

  it("ignores the admin writing in a group", () => {
    expect(adminActor(message(123456789, -100200300, "supergroup"), ADMIN)).toBeNull();
    expect(adminActor(message(123456789, 555, "private"), ADMIN)).toBeNull();
  });

  it("ignores bots and messages without a sender", () => {
    const fromBot = message(123456789);
    fromBot.message!.from!.is_bot = true;
    expect(adminActor(fromBot, ADMIN)).toBeNull();
    const anonymous: TelegramUpdate = {
      update_id: 2,
      message: { message_id: 1, chat: { id: 123456789, type: "private" } },
    };
    expect(adminActor(anonymous, ADMIN)).toBeNull();
  });

  it("accepts admin button presses and rejects others", () => {
    const press = (fromId: number): TelegramUpdate => ({
      update_id: 3,
      callback_query: {
        id: "q",
        from: { id: fromId },
        data: "pub:1",
        message: { message_id: 5, chat: { id: 123456789, type: "private" } },
      },
    });
    expect(adminActor(press(123456789), ADMIN)).toEqual({ chatId: 123456789, kind: "callback" });
    expect(adminActor(press(42), ADMIN)).toBeNull();
  });

  it("ignores unsupported update types", () => {
    expect(adminActor({ update_id: 4 }, ADMIN)).toBeNull();
  });
});
