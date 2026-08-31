export interface CsvRecord {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedCsv {
  headers: string[];
  records: CsvRecord[];
}

export function parseCsv(input: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  if (rows.length === 0) throw new Error("CSV contains no rows");

  const headers = rows[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  const records = rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])),
  }));

  return { headers, records };
}
