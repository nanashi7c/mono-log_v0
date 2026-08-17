import { describe, expect, it } from "vitest";
import {
  EDITABLE_ITEM_STATUSES,
  ITEM_STATUSES,
  isEditableItemStatus,
  isItemStatus,
  itemStatusOrDefault,
} from "@/features/items/domain/status";

describe("アイテムステータス", () => {
  it.each(ITEM_STATUSES)("%sを有効と判定する", (status) => {
    expect(isItemStatus(status)).toBe(true);
  });

  it.each([null, undefined, "", "archived", 1, {}])(
    "%jを無効と判定する",
    (value) => {
      expect(isItemStatus(value)).toBe(false);
    },
  );

  it.each(EDITABLE_ITEM_STATUSES)("%sを編集可能と判定する", (status) => {
    expect(isEditableItemStatus(status)).toBe(true);
  });

  it("soldを編集可能と判定しない", () => {
    expect(isEditableItemStatus("sold")).toBe(false);
  });

  it("不正値にはownedを使用する", () => {
    expect(itemStatusOrDefault("archived")).toBe("owned");
  });

  it("指定した既定値を使用できる", () => {
    expect(itemStatusOrDefault(null, "planned")).toBe("planned");
  });
});
