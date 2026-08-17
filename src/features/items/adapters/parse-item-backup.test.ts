import { describe, expect, it } from "vitest";
import { parseItemBackup } from "@/features/items/adapters/parse-item-backup";

describe("parseItemBackup", () => {
  it("バックアップを正規化した変更不能な入力へ変換する", () => {
    const result = parseItemBackup(
      JSON.stringify({
        categories: [
          { id: 5, name: "  家電  ", color: "#112233" },
          { id: 6, name: "   " },
          null,
        ],
        items: [
          {
            name: "  カメラ  ",
            status: "listed",
            jan_code: " 1234567890123 ",
            quantity: "2",
            notes: "  メモ ",
            actual_price: "12000",
            purchased_at: "2026-08-15",
            category_ids: [5, 5, "unknown"],
          },
          { name: " " },
          1,
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        categories: [
          { sourceId: "5", name: "家電", color: "#112233" },
        ],
        items: [
          {
            name: "カメラ",
            status: "listed",
            janCode: "1234567890123",
            quantity: 2,
            notes: "メモ",
            actualPrice: 12_000,
            purchasedAt: "2026-08-15",
            categorySourceIds: ["5", "unknown"],
          },
        ],
      },
    });
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
    expect(result.ok && Object.isFrozen(result.value.items[0])).toBe(true);
  });

  it("JSONでない文字列をエラーにする", () => {
    const result = parseItemBackup("not-json");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("JSONとして解析できません");
  });

  it("配列やnullをルートに持つJSONを拒否する", () => {
    expect(parseItemBackup("[]")).toEqual({
      ok: false,
      error: "invalid-format",
    });
    expect(parseItemBackup("null")).toEqual({
      ok: false,
      error: "invalid-format",
    });
  });

  it("省略値へ既定値を適用する", () => {
    const result = parseItemBackup(
      JSON.stringify({ items: [{ name: "item", status: "unknown" }] }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            status: "owned",
            quantity: 1,
            actualPrice: null,
            purchasedAt: null,
          },
        ],
      },
    });
  });

  it.each([
    [{ name: "item", quantity: 0 }, "数量は1以上"],
    [{ name: "item", actual_price: -1 }, "購入価格は0以上"],
    [{ name: "item", purchased_at: "invalid" }, "有効な日付"],
  ])("不正なアイテム値を拒否する", (item, message) => {
    const result = parseItemBackup(JSON.stringify({ items: [item] }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });
});
