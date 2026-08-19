import { parseItemBackup, type ParseItemBackupResult } from "@/features/items/adapters/parse-item-backup";
import type { ItemBackup } from "@/features/items/application/item-export-data";

const CSV_HEADERS = [
  "record_type",
  "source_id",
  "name",
  "color",
  "status",
  "jan_code",
  "quantity",
  "notes",
  "actual_price",
  "purchased_at",
  "category_source_ids",
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];
type CsvRowsResult =
  | Readonly<{ ok: true; rows: readonly (readonly string[])[] }>
  | Readonly<{ ok: false; error: string }>;

function escapeCsvCell(value: string | number | null): string {
  if (value == null) return "";
  const rawText = String(value);
  const text = typeof value === "string" && /^[=+\-@]/.test(rawText)
    ? `\t${rawText}`
    : rawText;
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function restoreSpreadsheetSafeText(value: string): string {
  return /^\t[=+\-@]/.test(value) ? value.slice(1) : value;
}

function preserveSpreadsheetText(value: string | null): string | null {
  return value == null ? null : `\t${value}`;
}

function csvRow(values: readonly (string | number | null)[]): string {
  return values.map(escapeCsvCell).join(",");
}

export function itemBackupCsvFilename(backup: ItemBackup): string {
  return `mono-log-${backup.exported_at.slice(0, 10)}.csv`;
}

export function serializeItemBackupCsv(backup: ItemBackup): string {
  const rows: string[] = [csvRow(CSV_HEADERS)];

  for (const category of backup.categories) {
    rows.push(
      csvRow([
        "category",
        category.id,
        category.name,
        category.color,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]),
    );
  }

  for (const item of backup.items) {
    rows.push(
      csvRow([
        "item",
        item.id,
        item.name,
        null,
        item.status,
        preserveSpreadsheetText(item.jan_code),
        item.quantity,
        item.notes,
        item.actual_price,
        item.purchased_at,
        item.category_ids.join("|"),
      ]),
    );
  }

  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

function parseCsvRows(text: string): CsvRowsResult {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  function finishField() {
    row.push(field);
    field = "";
    afterQuote = false;
  }

  function finishRow() {
    finishField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ",") {
        finishField();
        continue;
      }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && source[index + 1] === "\n") index += 1;
        finishRow();
        continue;
      }
      return { ok: false, error: "引用符の後に不正な文字があります。" };
    }

    if (char === '"') {
      if (field !== "") {
        return { ok: false, error: "フィールドの途中に不正な引用符があります。" };
      }
      inQuotes = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      field += char;
    }
  }

  if (inQuotes) return { ok: false, error: "引用符が閉じられていません。" };
  if (field !== "" || row.length > 0 || afterQuote) finishRow();
  return { ok: true, rows: Object.freeze(rows.map((values) => Object.freeze(values))) };
}

function headerIndex(headers: readonly string[]):
  | Readonly<{ ok: true; indexes: ReadonlyMap<CsvHeader, number> }>
  | Readonly<{ ok: false; error: string }> {
  const indexes = new Map<CsvHeader, number>();
  for (const header of CSV_HEADERS) {
    const matches = headers.flatMap((value, index) => value === header ? [index] : []);
    if (matches.length === 0) {
      return { ok: false, error: `CSVヘッダー「${header}」がありません。` };
    }
    if (matches.length > 1) {
      return { ok: false, error: `CSVヘッダー「${header}」が重複しています。` };
    }
    indexes.set(header, matches[0]);
  }
  return { ok: true, indexes };
}

export function parseItemBackupCsv(text: string): ParseItemBackupResult {
  const parsedRows = parseCsvRows(text);
  if (!parsedRows.ok) return parsedRows;
  const [headers, ...dataRows] = parsedRows.rows;
  if (!headers) return { ok: false, error: "CSVヘッダーがありません。" };

  const indexed = headerIndex(headers);
  if (!indexed.ok) return indexed;
  const indexes = indexed.indexes;
  const categories: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];

  function value(row: readonly string[], header: CsvHeader): string {
    return restoreSpreadsheetSafeText(row[indexes.get(header)!] ?? "");
  }

  for (const [rowIndex, row] of dataRows.entries()) {
    const recordType = value(row, "record_type").trim();
    if (recordType === "category") {
      categories.push({
        id: value(row, "source_id").trim() || null,
        name: value(row, "name"),
        color: value(row, "color"),
      });
      continue;
    }
    if (recordType === "item") {
      items.push({
        name: value(row, "name"),
        status: value(row, "status"),
        jan_code: value(row, "jan_code"),
        quantity: value(row, "quantity"),
        notes: value(row, "notes"),
        actual_price: value(row, "actual_price"),
        purchased_at: value(row, "purchased_at"),
        category_ids: value(row, "category_source_ids")
          .split("|")
          .map((sourceId) => sourceId.trim())
          .filter(Boolean),
      });
      continue;
    }
    return {
      ok: false,
      error: `${rowIndex + 2}行目のrecord_type「${recordType}」は不正です。`,
    };
  }

  return parseItemBackup(JSON.stringify({ categories, items }));
}
