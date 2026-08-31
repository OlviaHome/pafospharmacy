import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a BOM, Greek text, escaped quotes, commas, and embedded newlines", () => {
    const parsed = parseCsv(
      '\uFEFFName,Address,Notes\r\n"Μαρία","Οδός 1, Πάφος","Line one\nLine ""two"""\r\n',
    );

    expect(parsed.headers).toEqual(["Name", "Address", "Notes"]);
    expect(parsed.records).toEqual([
      {
        rowNumber: 2,
        values: {
          Name: "Μαρία",
          Address: "Οδός 1, Πάφος",
          Notes: 'Line one\nLine "two"',
        },
      },
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('Name\n"unfinished')).toThrow("CSV ended inside a quoted field");
  });
});
