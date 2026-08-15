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

  it("空ではない画像ファイルを保持する", () => {
    const formData = validFormData();
    const image = new File(["image"], "photo.png", { type: "image/png" });
    formData.set("image", image);

    expect(parseItemForm(formData)).toMatchObject({
      ok: true,
      value: { image },
    });
  });
});
