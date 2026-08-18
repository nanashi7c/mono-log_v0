import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ItemImageField } from "@/components/item-form/item-image-field";

describe("ItemImageField", () => {
  it("画像ファイル本体をフォーム送信せず、対応形式と上限を案内する", () => {
    const html = renderToStaticMarkup(
      createElement(ItemImageField, {
        prepareImageUpload: vi.fn(),
        onUploadingChange: vi.fn(),
      }),
    );

    expect(html).toContain('type="file"');
    expect(html).not.toContain('name="image"');
    expect(html).toContain("image/jpeg,image/png,image/gif,image/webp");
    expect(html).toContain("10MBまで");
    expect(html).toContain('aria-live="polite"');
  });
});
