import { describe, expect, it } from "vitest";
import { parseItemForm } from "@/features/items/adapters/parse-item-form";

function validFormData(): FormData {
  const formData = new FormData();
  formData.set("name", "  カメラ  ");
  formData.set("status", "listed");
  formData.set("quantity", "2");
  formData.append("category_ids", "3");
  formData.set("new_category_names", "趣味、 売却候補");
  formData.set("jan_code", " 1234567890123 ");
  formData.set("selling_price", "1000");
  formData.set("delete_image", "1");
  return formData;
}

describe("parseItemForm", () => {
  it("FormDataを内部書き込みデータへ変換する", () => {
    const result = parseItemForm(validFormData());

    expect(result).toMatchObject({
      ok: true,
      value: {
        input: {
          name: "カメラ",
          status: "listed",
          categoryIds: [3],
          newCategoryNames: ["趣味", "売却候補"],
          janCode: "1234567890123",
          quantity: 2,
          purchasedAt: null,
          listing: {
            sellingPrice: 1000,
          },
        },
        deleteImage: true,
      },
    });
  });

  it("数量が0なら検証エラーを返す", () => {
    const formData = validFormData();
    formData.set("quantity", "0");

    expect(parseItemForm(formData).ok).toBe(false);
  });

  it.each(["2026-08-20", "9999-12-31"])(
    "実在する購入日%sを受け付ける",
    (purchasedAt) => {
      const formData = validFormData();
      formData.set("purchased_at", purchasedAt);

      expect(parseItemForm(formData)).toMatchObject({
        ok: true,
        value: { input: { purchasedAt } },
      });
    },
  );

  it.each([
    "200045-03-04",
    "0000-01-01",
    "2026-02-30",
    "2026-08-20T00:00:00Z",
  ])("不正な購入日%jを拒否する", (purchasedAt) => {
    const formData = validFormData();
    formData.set("purchased_at", purchasedAt);

    expect(parseItemForm(formData)).toEqual({
      ok: false,
      error: "購入日はYYYY-MM-DD形式の正しい日付で入力してください。",
    });
  });

  it("フォームで選択できないsoldはownedへ戻す", () => {
    const formData = validFormData();
    formData.set("status", "sold");

    expect(parseItemForm(formData)).toMatchObject({
      ok: true,
      value: {
        input: { status: "owned" },
      },
    });
  });

  it("直接アップロード済み画像のIDを保持する", () => {
    const formData = validFormData();
    const imageUploadId = "123e4567-e89b-42d3-a456-426614174000";
    formData.set("image_upload_id", imageUploadId);

    expect(parseItemForm(formData)).toMatchObject({
      ok: true,
      value: { imageUploadId },
    });
  });

  it("画像アップロードIDがUUIDでなければ拒否する", () => {
    const formData = validFormData();
    formData.set("image_upload_id", "not-an-upload-id");

    expect(parseItemForm(formData)).toEqual({
      ok: false,
      error: "画像アップロードIDが不正です。",
    });
  });
});
