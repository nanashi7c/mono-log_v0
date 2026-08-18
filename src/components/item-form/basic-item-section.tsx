import { CategorySelector } from "@/components/item-form/category-selector";
import { Field, FieldGroup } from "@/components/item-form/field";
import { ItemImageField } from "@/components/item-form/item-image-field";
import { ACTUAL_PRICE_MAX } from "@/lib/validation/actual-price";
import { INTEGER_MAX } from "@/lib/validation/numeric";
import type { Category, Item, ItemStatus } from "@/types/item";
import styles from "@/components/item-form.module.css";

type BasicItemSectionProps = Readonly<{
  item?: Readonly<Item>;
  imageUrl?: string | null;
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
  initialSelectedCategoryIds: readonly number[];
  status: ItemStatus;
  onStatusChange: (status: ItemStatus) => void;
}>;

const STATUS_OPTIONS: readonly Readonly<{ value: ItemStatus; label: string }>[] = [
  { value: "planned", label: "購入予定" },
  { value: "owned", label: "所有中" },
  { value: "listed", label: "出品中" },
];

export function BasicItemSection({
  item,
  imageUrl,
  categories,
  initialSelectedCategoryIds,
  status,
  onStatusChange,
}: BasicItemSectionProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>基本情報</h2>

      <FieldGroup label="アイテム種別 *">
        <div className={styles.statusGroup}>
          {STATUS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`${styles.statusRadio} ${status === option.value ? styles.statusRadioActive : ""}`}
            >
              <input
                type="radio"
                name="status"
                value={option.value}
                checked={status === option.value}
                onChange={() => onStatusChange(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </FieldGroup>

      <Field label="名前 *">
        <input name="name" required defaultValue={item?.name ?? ""} className={styles.input} />
      </Field>

      <CategorySelector
        categories={categories}
        initialSelectedCategoryIds={initialSelectedCategoryIds}
      />

      <div className={styles.grid2}>
        <Field label="数量 *">
          <input
            name="quantity"
            type="number"
            min={1}
            max={INTEGER_MAX}
            step={1}
            required
            defaultValue={item?.quantity ?? 1}
            className={styles.input}
          />
        </Field>
        <Field label="JAN コード">
          <input
            name="jan_code"
            inputMode="numeric"
            pattern="\d{13}"
            maxLength={13}
            placeholder="13桁の数字"
            defaultValue={item?.jan_code ?? ""}
            className={styles.input}
          />
        </Field>
      </div>

      <div className={styles.grid2}>
        <Field label="購入価格（円）">
          <input
            name="actual_price"
            type="number"
            min={0}
            max={ACTUAL_PRICE_MAX}
            step={1}
            defaultValue={item?.actual_price ?? ""}
            className={styles.input}
          />
        </Field>
        <Field label="購入日">
          <input
            name="purchased_at"
            type="date"
            defaultValue={item?.purchased_at ?? ""}
            className={styles.input}
          />
        </Field>
      </div>

      <Field label="備考">
        <textarea
          name="notes"
          rows={3}
          defaultValue={item?.notes ?? ""}
          className={styles.input}
        />
      </Field>

      <ItemImageField imageUrl={imageUrl} />
    </section>
  );
}
