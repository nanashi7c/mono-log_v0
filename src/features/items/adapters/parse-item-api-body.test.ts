import { describe, expect, it } from "vitest";
import { parseItemApiBody } from "@/features/items/adapters/parse-item-api-body";
import { INTEGER_MAX } from "@/lib/validation/numeric";

describe("parseItemApiBody", () => {
  it("公開フィールドを検証し、API入力を内部形式へ変換する", () => {
    const categoryIds = Object.freeze([3, "5"]);
    const body = Object.freeze({
      name: "  テスト商品  ",
      status: "listed",
      jan_code: "  4901234567890  ",
      quantity: "2",
      notes: "  メモ  ",
      actual_price: "1200",
      purchased_at: "  2026-06-01  ",
      category_ids: categoryIds,
    });

    const result = parseItemApiBody(body);

    expect(result).toEqual({
      ok: true,
      value: {
        status: "listed",
        name: "テスト商品",
        janCode: "4901234567890",
        quantity: 2,
        notes: "メモ",
        actualPrice: 1200,
        purchasedAt: "2026-06-01",
        categoryIds: [3, 5],
      },
    });
    if (result.ok) {
      expect(result.value.categoryIds).not.toBe(categoryIds);
    }
  });

  it("任意項目を省略したとき既定値へ変換する", () => {
    expect(parseItemApiBody({ name: "item" })).toEqual({
      ok: true,
      value: {
        status: "owned",
        name: "item",
        janCode: null,
        quantity: 1,
        notes: null,
        actualPrice: null,
        purchasedAt: null,
        categoryIds: [],
      },
    });
  });

  it.each([null, 1, "item", true])("JSONオブジェクトでない%jを拒否する", (body) => {
    expect(parseItemApiBody(body)).toEqual({
      ok: false,
      error: "body must be a JSON object",
    });
  });

  it.each([{}, [], { name: "  " }, { name: 1 }])("有効なnameがない%jを拒否する", (body) => {
    expect(parseItemApiBody(body)).toEqual({
      ok: false,
      error: "name is required",
    });
  });

  it.each(["planned", "owned", "listed", "sold"])("status %sを受け付ける", (status) => {
    expect(parseItemApiBody({ name: "item", status })).toMatchObject({
      ok: true,
      value: { status },
    });
  });

  it("未知のstatusを外部公開済みのエラーで拒否する", () => {
    expect(parseItemApiBody({ name: "item", status: "archived" })).toEqual({
      ok: false,
      error: "invalid status: archived",
    });
  });

  it.each([1, INTEGER_MAX])("quantityの境界値%dを受け付ける", (quantity) => {
    expect(parseItemApiBody({ name: "item", quantity })).toMatchObject({
      ok: true,
      value: { quantity },
    });
  });

  it.each([null, ""])("quantityの空入力%jを既定値1へ変換する", (quantity) => {
    expect(parseItemApiBody({ name: "item", quantity })).toMatchObject({
      ok: true,
      value: { quantity: 1 },
    });
  });

  it.each([0, 1.5, INTEGER_MAX + 1, {}])("不正なquantity %jを拒否する", (quantity) => {
    expect(parseItemApiBody({ name: "item", quantity })).toEqual({
      ok: false,
      error: "quantityは1以上2,147,483,647以下の整数で入力してください。",
    });
  });

  it.each([0, INTEGER_MAX])("actual_priceの境界値%dを受け付ける", (actualPrice) => {
    expect(parseItemApiBody({ name: "item", actual_price: actualPrice })).toMatchObject({
      ok: true,
      value: { actualPrice },
    });
  });

  it.each([null, ""])("actual_priceの空入力%jをnullへ変換する", (actualPrice) => {
    expect(parseItemApiBody({ name: "item", actual_price: actualPrice })).toMatchObject({
      ok: true,
      value: { actualPrice: null },
    });
  });

  it.each([-1, 1.5, INTEGER_MAX + 1])("不正なactual_price %dを拒否する", (actualPrice) => {
    expect(parseItemApiBody({ name: "item", actual_price: actualPrice })).toEqual({
      ok: false,
      error: "購入価格は0以上2,147,483,647以下の整数で入力してください。",
    });
  });

  it.each(["2026-01-01", "2024-02-29"])(
    "実在するpurchased_at %sを受け付ける",
    (purchasedAt) => {
      expect(
        parseItemApiBody({ name: "item", purchased_at: purchasedAt }),
      ).toMatchObject({
        ok: true,
        value: { purchasedAt },
      });
    },
  );

  it.each([
    "2023-02-29",
    "2026-6-1",
    "2026-01-01T00:00:00Z",
    20260101,
    {},
  ])("不正なpurchased_at %jを拒否する", (purchasedAt) => {
    expect(
      parseItemApiBody({ name: "item", purchased_at: purchasedAt }),
    ).toEqual({
      ok: false,
      error: "purchased_at must be YYYY-MM-DD or null",
    });
  });

  it("category_idsの重複を含む現行の並びを維持する", () => {
    expect(parseItemApiBody({ name: "item", category_ids: [3, "3", 5] })).toMatchObject({
      ok: true,
      value: { categoryIds: [3, 3, 5] },
    });
  });

  it("空のcategory_idsを受け付ける", () => {
    expect(parseItemApiBody({ name: "item", category_ids: [] })).toMatchObject({
      ok: true,
      value: { categoryIds: [] },
    });
  });

  it("category_idsが配列でない入力を拒否する", () => {
    expect(parseItemApiBody({ name: "item", category_ids: 3 })).toEqual({
      ok: false,
      error: "category_ids must be an array",
    });
  });

  it.each([0, 1.5, INTEGER_MAX + 1])("不正なcategory_id %dを拒否する", (categoryId) => {
    expect(parseItemApiBody({ name: "item", category_ids: [categoryId] })).toEqual({
      ok: false,
      error: "category_idsは1以上2,147,483,647以下の整数で入力してください。",
    });
  });

  it.each([null, ""])("空のcategory_id %jを拒否する", (categoryId) => {
    expect(parseItemApiBody({ name: "item", category_ids: [categoryId] })).toEqual({
      ok: false,
      error: "category_idsを入力してください。",
    });
  });

  it("nullable文字列の空白をnullへ、非文字列を文字列へ変換する現行仕様を維持する", () => {
    expect(
      parseItemApiBody({
        name: "item",
        jan_code: 4901234567890,
        notes: "  ",
        purchased_at: null,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        janCode: "4901234567890",
        notes: null,
        purchasedAt: null,
      },
    });
  });
});
