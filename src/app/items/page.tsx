import Link from "next/link";
import { redirect } from "next/navigation";
import ItemCard from "@/components/item-card";
import OwnedItemsToolbar from "@/components/owned-items-toolbar";
import { parseOwnedItemsFilter } from "@/features/items/adapters/parse-owned-items-filter";
import { loadOwnedItemsUseCase } from "@/features/items/application/item-list-query-use-cases";
import { prismaItemListQueryRepository } from "@/features/items/infrastructure/prisma-item-list-query-repository";
import { getCurrentUser } from "@/lib/auth/session";
import { signedImageUrl } from "@/lib/image";
import { listItem, restoreToPlanned } from "./transitions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const itemListQueryDependencies = {
  repository: prismaItemListQueryRepository,
};

type Search = { q?: string; category?: string };

export default async function OwnedItemsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { q, category } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { items: list, categoryOptions } = await loadOwnedItemsUseCase(
    itemListQueryDependencies,
    {
      userId: user.sub,
      filter: parseOwnedItemsFilter(q, category),
    },
  );

  const signedUrls = await Promise.all(list.map((i) => signedImageUrl(i.image_url)));

  return (
    <div className={styles.container}>
      <OwnedItemsToolbar count={list.length} categories={categoryOptions} />

      {list.length === 0 ? (
        <div className={styles.empty}>
          まだアイテムがありません。
          <Link href="/items/new" className={styles.emptyLink}>
            最初の1件を追加
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {list.map((item, i) => (
            <li key={item.id} className={styles.row}>
              <ItemCard item={item} imageUrl={signedUrls[i]} />
              <div className={styles.actions}>
                {item.status === "owned" ? (
                  <>
                    <form action={listItem.bind(null, item.id)}>
                      <button type="submit" className={styles.actionButton}>
                        出品する
                      </button>
                    </form>
                    <form action={restoreToPlanned.bind(null, item.id)}>
                      <button type="submit" className={styles.actionButton}>
                        購入予定へ戻す
                      </button>
                    </form>
                  </>
                ) : (
                  <span className={styles.actionButton} aria-disabled>
                    出品中（管理は出品リスト）
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
