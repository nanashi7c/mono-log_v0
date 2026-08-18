"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { Category } from "@/types/item";
import { buildOwnedItemsFilterHref } from "./owned-items-toolbar-query";
import styles from "./owned-items-toolbar.module.css";

type Props = Readonly<{
  count: number;
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
}>;

export default function OwnedItemsToolbar({ count, categories }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentQ = params.get("q") ?? "";
  const currentCategory = params.get("category") ?? "";

  function update(next: Readonly<Record<string, string | null>>) {
    const href = buildOwnedItemsFilterHref(pathname, params.toString(), next);
    startTransition(() => router.replace(href));
  }

  return (
    <div className={styles.toolbar}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>所有物</h1>
          <p className={styles.count}>{count} 件</p>
        </div>
        <div className={styles.headerActions}>
          <span
            className={styles.pending}
            aria-live="polite"
            aria-atomic="true"
          >
            {pending ? "更新中…" : ""}
          </span>
          <Link href="/items/new" className={styles.cta}>
            + 追加
          </Link>
        </div>
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          placeholder="名前・メモで検索"
          defaultValue={currentQ}
          onChange={(event) => update({ q: event.target.value })}
          className={styles.search}
        />
        <select
          value={currentCategory}
          onChange={(event) =>
            update({ category: event.target.value || null })
          }
          className={styles.select}
        >
          <option value="">全カテゴリ</option>
          <option value="__none__">未分類</option>
          {categories.map((category) => (
            <option key={category.id} value={String(category.id)}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
