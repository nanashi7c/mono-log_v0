import { Field } from "@/components/item-form/field";
import { DECIMAL_8_2_MAX, DECIMAL_10_0_MAX, INTEGER_MAX } from "@/lib/validation/numeric";
import type { Listing, Platform, Service, Size } from "@/types/item";
import styles from "@/components/item-form.module.css";

type ListedItemSectionProps = Readonly<{
  listing?: Readonly<Listing> | null;
  platforms: readonly Readonly<Pick<Platform, "id" | "name">>[];
  services: readonly Readonly<Pick<Service, "id" | "shipping_service">>[];
  sizes: readonly Readonly<Pick<Size, "id" | "shipping_size">>[];
  initialServiceId?: number | null;
  initialSizeId?: number | null;
}>;

export function ListedItemSection({
  listing,
  platforms,
  services,
  sizes,
  initialServiceId,
  initialSizeId,
}: ListedItemSectionProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>出品情報</h2>
      <p className={styles.note}>すべて任意。未入力で保存して後から追記できます。</p>
      <div className={styles.grid2}>
        <Field label="プラットフォーム">
          <select
            name="platform_id"
            defaultValue={listing?.platform_id ?? ""}
            className={styles.select}
          >
            <option value="">未選択</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="出品数">
          <input
            name="listing_quantity"
            type="number"
            min={1}
            max={INTEGER_MAX}
            step={1}
            defaultValue={listing?.quantity ?? ""}
            className={styles.input}
          />
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label="配送サービス">
          <select name="service_id" defaultValue={initialServiceId ?? ""} className={styles.select}>
            <option value="">未選択</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.shipping_service}
              </option>
            ))}
          </select>
        </Field>
        <Field label="配送サイズ">
          <select name="size_id" defaultValue={initialSizeId ?? ""} className={styles.select}>
            <option value="">未選択</option>
            {sizes.map((size) => (
              <option key={size.id} value={size.id}>
                {size.shipping_size}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label="売価">
          <input
            name="selling_price"
            type="number"
            min={0}
            max={DECIMAL_10_0_MAX}
            step={1}
            defaultValue={listing?.selling_price ?? ""}
            className={styles.input}
          />
        </Field>
        <Field label="梱包材費">
          <input
            name="packaging_cost"
            type="number"
            min={0}
            max={DECIMAL_10_0_MAX}
            step={1}
            defaultValue={listing?.packaging_cost ?? ""}
            className={styles.input}
          />
        </Field>
      </div>
      <div className={styles.grid2}>
        <Field label="作業時間（時）">
          <input
            name="work_time_hours"
            type="number"
            min={0}
            max={DECIMAL_8_2_MAX}
            step={0.25}
            defaultValue={listing?.work_time_hours ?? ""}
            className={styles.input}
          />
        </Field>
        <Field label="時給">
          <input
            name="labor_rate"
            type="number"
            min={0}
            max={DECIMAL_10_0_MAX}
            step={1}
            defaultValue={listing?.labor_rate ?? ""}
            className={styles.input}
          />
        </Field>
      </div>
    </section>
  );
}
