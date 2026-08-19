import { describe, expect, it } from "vitest";
import {
  itemBackupCsvFilename,
  parseItemBackupCsv,
  serializeItemBackupCsv,
} from "@/features/items/adapters/item-backup-csv";
import type { ItemBackup } from "@/features/items/application/item-export-data";

const backup: ItemBackup = {
  version: 1,
  exported_at: "2026-08-19T00:00:00.000Z",
  categories: [
    {
      id: 7,
      user_id: "user-1",
      name: '趣味, "写真"',
      color: "#112233",
      is_preset: false,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  items: [
    {
      id: 10,
      user_id: "user-1",
      status: "owned",
      name: "カメラ\n本体",
      image_url: null,
      jan_code: "0490000000000",
      quantity: 2,
      notes: '1行目\n"引用"あり',
      actual_price: 12000,
      purchased_at: "2026-08-10T00:00:00.000Z",
      deleted_at: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      category_ids: [7],
    },
  ],
};

describe("アイテムバックアップCSV", () => {
  it("UTF-8 BOMと日付付きCSVファイル名を生成する", () => {
    const csv = serializeItemBackupCsv(backup);

    expect(csv.startsWith("\uFEFFrecord_type,source_id,name,color")).toBe(true);
    expect(csv).toContain("\t0490000000000");
    expect(itemBackupCsvFilename(backup)).toBe("mono-log-2026-08-19.csv");
  });

  it("カンマ・引用符・改行を含むデータを往復変換する", () => {
    const result = parseItemBackupCsv(serializeItemBackupCsv(backup));

    expect(result).toEqual({
      ok: true,
      value: {
        categories: [
          { sourceId: "7", name: '趣味, "写真"', color: "#112233" },
        ],
        items: [
          {
            name: "カメラ\n本体",
            status: "owned",
            janCode: "0490000000000",
            quantity: 2,
            notes: '1行目\n"引用"あり',
            actualPrice: 12000,
            purchasedAt: "2026-08-10T00:00:00.000Z",
            categorySourceIds: ["7"],
          },
        ],
      },
    });
  });

  it("表計算ソフトの数式として解釈される文字列を無害化して復元する", () => {
    const formulaBackup: ItemBackup = {
      ...backup,
      categories: [{ ...backup.categories[0], name: "=HYPERLINK(\"https://example.com\")" }],
      items: [{ ...backup.items[0], name: "+SUM(1,2)", notes: "@command" }],
    };

    const csv = serializeItemBackupCsv(formulaBackup);
    const result = parseItemBackupCsv(csv);

    expect(csv).toContain("\t=HYPERLINK");
    expect(csv).toContain("\t+SUM");
    expect(result.ok && result.value.categories[0].name).toBe(
      '=HYPERLINK("https://example.com")',
    );
    expect(result.ok && result.value.items[0].name).toBe("+SUM(1,2)");
    expect(result.ok && result.value.items[0].notes).toBe("@command");
  });

  it("ヘッダー不足・閉じていない引用符・不正レコードを拒否する", () => {
    expect(parseItemBackupCsv("record_type,name\r\nitem,item\r\n")).toEqual({
      ok: false,
      error: "CSVヘッダー「source_id」がありません。",
    });
    expect(parseItemBackupCsv('"record_type')).toEqual({
      ok: false,
      error: "引用符が閉じられていません。",
    });

    const invalidRecord = serializeItemBackupCsv(backup).replace(
      "category,7",
      "unknown,7",
    );
    expect(parseItemBackupCsv(invalidRecord)).toEqual({
      ok: false,
      error: "2行目のrecord_type「unknown」は不正です。",
    });
  });

  it("既存の数値検証をCSV入力にも適用する", () => {
    const invalidPrice = serializeItemBackupCsv(backup).replace(
      ",12000,2026-08-10",
      ",-1,2026-08-10",
    );
    const result = parseItemBackupCsv(invalidPrice);

    expect(!result.ok && result.error).toContain("購入価格");
  });
});
