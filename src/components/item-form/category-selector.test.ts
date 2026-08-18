import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CategorySelector } from "@/components/item-form/category-selector";

const categories = Object.freeze([
  Object.freeze({ id: 1, name: "家電", color: "#123456" }),
  Object.freeze({ id: 2, name: "スポーツ", color: "#abcdef" }),
]);

describe("CategorySelector", () => {
  it("複数選択領域をfieldsetで表現し、未選択を含む全カテゴリの色を表示する", () => {
    const html = renderToStaticMarkup(
      createElement(CategorySelector, {
        categories,
        initialSelectedCategoryIds: [2],
      }),
    );

    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html.match(/<label/g)).toHaveLength(categories.length);
    expect(html).toContain("background-color:#123456");
    expect(html).toContain("background-color:#abcdef");
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
});
