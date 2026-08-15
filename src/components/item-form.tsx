"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type {
  Category,
  Item,
  ItemStatus,
  Listing,
  Plan,
  Platform,
  Service,
  Size,
} from "@/types/item";
import { ACTUAL_PRICE_MAX } from "@/lib/validation/actual-price";
import {
  DECIMAL_8_2_MAX,
  DECIMAL_10_0_MAX,
  INTEGER_MAX,
} from "@/lib/validation/numeric";
import styles from "./item-form.module.css";

type Props = {
  mode: "create" | "edit";
  item?: Item;
  plan?: Plan | null;
  listing?: Listing | null;
  imageUrl?: string | null;
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
  selectedCategoryIds?: readonly number[];
  platforms: readonly Readonly<Pick<Platform, "id" | "name">>[];
  services: readonly Readonly<Pick<Service, "id" | "shipping_service">>[];
  sizes: readonly Readonly<Pick<Size, "id" | "shipping_size">>[];
  // shipping_id (listings) is composed of (service_id, size_id) at save time.
  initialServiceId?: number | null;
  initialSizeId?: number | null;
  action: (formData: FormData) => void;
  onDelete?: (formData: FormData) => void;
  error?: string;
};

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: "planned", label: "購入予定" },
  { value: "owned", label: "所有中" },
  { value: "listed", label: "出品中" },
];

export default function ItemForm({
  mode,
  item,
  plan,
  listing,
  imageUrl,
  categories,
  selectedCategoryIds = [],
  platforms,
  services,
  sizes,
  initialServiceId = null,
  initialSizeId = null,
  action,
  onDelete,
  error,
}: Props) {
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? "owned");
  const [selectedCats, setSelectedCats] = useState<Set<number>>(new Set(selectedCategoryIds));
  const [deleteImage, setDeleteImage] = useState(false);

  function toggleCategory(id: number) {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {mode === "create" ? "アイテムを追加" : "アイテムを編集"}
        </h1>
        <Link href={mode === "edit" && item ? `/items/${item.id}` : "/items"} className={styles.backLink}>
          ← 戻る
        </Link>
      </div>

      {error ? <p className={styles.error}>{decodeURIComponent(error)}</p> : null}

      <form action={action} className={styles.form}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>基本情報</h2>

          <Field label="アイテム種別 *">
            <div className={styles.statusGroup}>
              {STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`${styles.statusRadio} ${status === opt.value ? styles.statusRadioActive : ""}`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={opt.value}
                    checked={status === opt.value}
                    onChange={() => setStatus(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="名前 *">
            <input name="name" required defaultValue={item?.name ?? ""} className={styles.input} />
          </Field>

          <Field label="カテゴリ（複数選択可）">
            {categories.length === 0 ? (
              <p className={styles.categoriesEmpty}>登録済みカテゴリはありません。下の入力欄から作成できます。</p>
            ) : (
              <div className={styles.categoriesBox}>
                {categories.map((c) => {
                  const active = selectedCats.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`${styles.categoryChip} ${active ? styles.categoryChipActive : ""}`}
                      style={active ? { borderColor: c.color, color: c.color } : undefined}
                    >
                      <input
                        type="checkbox"
                        name="category_ids"
                        value={c.id}
                        checked={active}
                        onChange={() => toggleCategory(c.id)}
                      />
                      ● {c.name}
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
          </Field>

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

          <Field label="画像">
            {imageUrl && !deleteImage ? (
              <div className={styles.imagePreview}>
                <div className={styles.imageBox}>
                  <Image src={imageUrl} alt="" fill sizes="96px" className={styles.imageBoxImg} />
                </div>
                <label className={styles.deleteImageLabel}>
                  <input
                    type="checkbox"
                    checked={deleteImage}
                    onChange={(e) => setDeleteImage(e.target.checked)}
                  />
                  画像を削除
                </label>
                <input type="hidden" name="delete_image" value={deleteImage ? "1" : "0"} />
              </div>
            ) : null}
            <input
              name="image"
              type="file"
              accept="image/*"
              className={styles.fileInput}
            />
            {imageUrl && deleteImage ? (
              <input type="hidden" name="delete_image" value="1" />
            ) : null}
          </Field>
        </section>

        {status === "planned" ? (
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
        ) : null}

        {status === "listed" ? (
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
                  {platforms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
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
                <select
                  name="service_id"
                  defaultValue={initialServiceId ?? ""}
                  className={styles.select}
                >
                  <option value="">未選択</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shipping_service}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="配送サイズ">
                <select name="size_id" defaultValue={initialSizeId ?? ""} className={styles.select}>
                  <option value="">未選択</option>
                  {sizes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shipping_size}
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
        ) : null}

        <div className={styles.actions}>
          <button type="submit" className={styles.submit}>
            {mode === "create" ? "追加" : "保存"}
          </button>
          {onDelete && item ? (
            <button
              type="submit"
              formAction={onDelete}
              formNoValidate
              onClick={(e) => {
                if (!confirm(`「${item.name}」を削除しますか？`)) e.preventDefault();
              }}
              className={styles.delete}
            >
              削除
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
