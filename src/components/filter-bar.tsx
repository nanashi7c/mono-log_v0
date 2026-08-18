"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { Category } from "@/types/item";
import styles from "./filter-bar.module.css";

type Props = {
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
  // Search placeholder differs per list; let callers override.
  placeholder?: string;
};

export default function FilterBar({ categories, placeholder = "名前・メモで検索" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentQ = params.get("q") ?? "";
  const currentCategory = params.get("category") ?? "";

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") sp.delete(key);
      else sp.set(key, value);
    }
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div className={styles.bar}>
      <input
        type="search"
        placeholder={placeholder}
        defaultValue={currentQ}
        onChange={(e) => update({ q: e.target.value })}
        className={styles.search}
      />
      <select
        value={currentCategory}
        onChange={(e) => update({ category: e.target.value || null })}
        className={styles.select}
      >
        <option value="">全カテゴリ</option>
        <option value="__none__">未分類</option>
        {categories.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.name}
          </option>
        ))}
      </select>
      {pending ? <span className={styles.pending}>更新中…</span> : null}
    </div>
  );
}
