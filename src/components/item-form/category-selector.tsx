import { useState } from "react";
import { toggleCategorySelection } from "@/components/item-form/category-selection";
import { FieldGroup } from "@/components/item-form/field";
import type { Category } from "@/types/item";
import styles from "@/components/item-form.module.css";

type CategorySelectorProps = Readonly<{
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
  initialSelectedCategoryIds: readonly number[];
}>;

export function CategorySelector({
  categories,
  initialSelectedCategoryIds,
}: CategorySelectorProps) {
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<ReadonlySet<number>>(
    () => new Set(initialSelectedCategoryIds),
  );

  function handleCategoryChange(categoryId: number) {
    setSelectedCategoryIds((currentCategoryIds) =>
      toggleCategorySelection(currentCategoryIds, categoryId),
    );
  }

  return (
    <FieldGroup label="カテゴリ（複数選択可）">
      {categories.length === 0 ? (
        <p className={styles.categoriesEmpty}>
          登録済みカテゴリはありません。下の入力欄から作成できます。
        </p>
      ) : (
        <div className={styles.categoriesBox}>
          {categories.map((category) => {
            const isSelected = selectedCategoryIds.has(category.id);
            return (
              <label
                key={category.id}
                className={`${styles.categoryChip} ${isSelected ? styles.categoryChipActive : ""}`}
                style={isSelected ? { borderColor: category.color, color: category.color } : undefined}
              >
                <input
                  type="checkbox"
                  name="category_ids"
                  value={category.id}
                  checked={isSelected}
                  onChange={() => handleCategoryChange(category.id)}
                />
                <span
                  aria-hidden="true"
                  className={styles.categoryDot}
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
              </label>
            );
          })}
        </div>
      )}
      <input
        name="new_category_names"
        placeholder="新規カテゴリをカンマ区切りで追加（任意）"
        className={styles.input}
        style={{ marginTop: "0.5rem" }}
      />
    </FieldGroup>
  );
}
