"use client";

import Link from "next/link";
import { useState } from "react";
import { BasicItemSection } from "@/components/item-form/basic-item-section";
import { FormActions } from "@/components/item-form/form-actions";
import { ListedItemSection } from "@/components/item-form/listed-item-section";
import { PlannedItemSection } from "@/components/item-form/planned-item-section";
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
import styles from "./item-form.module.css";

type Props = Readonly<{
  mode: "create" | "edit";
  item?: Readonly<Item>;
  plan?: Readonly<Plan> | null;
  listing?: Readonly<Listing> | null;
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
}>;

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
        <BasicItemSection
          item={item}
          imageUrl={imageUrl}
          categories={categories}
          initialSelectedCategoryIds={selectedCategoryIds}
          status={status}
          onStatusChange={setStatus}
        />

        {status === "planned" ? <PlannedItemSection plan={plan} /> : null}

        {status === "listed" ? (
          <ListedItemSection
            listing={listing}
            platforms={platforms}
            services={services}
            sizes={sizes}
            initialServiceId={initialServiceId}
            initialSizeId={initialSizeId}
          />
        ) : null}

        <FormActions mode={mode} item={item} onDelete={onDelete} />
      </form>
    </div>
  );
}
