import { Field } from "@/components/item-form/field";
import { DECIMAL_10_0_MAX } from "@/lib/validation/numeric";
import type { Plan } from "@/types/item";
import styles from "@/components/item-form.module.css";

type PlannedItemSectionProps = Readonly<{
  plan?: Readonly<Plan> | null;
}>;

export function PlannedItemSection({ plan }: PlannedItemSectionProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>購入予定情報</h2>
      <div className={styles.grid2}>
        <Field label="購入予定年">
          <input
            name="planned_purchase_year"
            type="number"
            min={2000}
            max={2100}
            defaultValue={plan?.planned_purchase_year ?? ""}
            className={styles.input}
          />
        </Field>
        <Field label="購入予定月">
          <input
            name="planned_purchase_month"
            type="number"
            min={1}
            max={12}
            defaultValue={plan?.planned_purchase_month ?? ""}
            className={styles.input}
          />
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label="定価">
          <input
            name="list_price"
            type="number"
            min={0}
            max={DECIMAL_10_0_MAX}
            step={1}
            defaultValue={plan?.list_price ?? ""}
            className={styles.input}
          />
        </Field>
        <Field label="購入予定価格">
          <input
            name="purchase_price"
            type="number"
            min={0}
            max={DECIMAL_10_0_MAX}
            step={1}
            defaultValue={plan?.purchase_price ?? ""}
            className={styles.input}
          />
        </Field>
      </div>
      <Field label="商品リンク">
        <input
          name="product_url"
          type="url"
          placeholder="https://..."
          defaultValue={plan?.product_url ?? ""}
          className={styles.input}
        />
      </Field>
      <Field label="お買い得期間">
        <input
          name="deal_period"
          placeholder="例: 6/1 〜 6/30、月初セール 等"
          defaultValue={plan?.deal_period ?? ""}
          className={styles.input}
        />
      </Field>
    </section>
  );
}
