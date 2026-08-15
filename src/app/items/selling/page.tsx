import Link from "next/link";
import { redirect } from "next/navigation";
import { loadSellingItemsUseCase } from "@/features/items/application/item-list-query-use-cases";
import { prismaItemListQueryRepository } from "@/features/items/infrastructure/prisma-item-list-query-repository";
import { getCurrentUser } from "@/lib/auth/session";
import { formatYen } from "@/lib/format";
import { markAsSold, unlistItem } from "../transitions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const itemListQueryDependencies = {
  repository: prismaItemListQueryRepository,
};

export default async function SellingItemsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await loadSellingItemsUseCase(itemListQueryDependencies, {
    userId: user.sub,
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>出品中</h1>
          <p className={styles.count}>{rows.length} 件</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>出品中のアイテムはありません。</div>
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => {
            const ord = r.listing?.ordinary_profit;
            return (
              <li key={r.id} className={styles.row}>
                <div>
                  <h3 className={styles.name}>{r.name}</h3>
                  <div className={styles.figures}>
                    <Stat label="所有数" value={String(r.quantity)} />
                    <Stat label="出品数" value={r.listing?.quantity != null ? String(r.listing.quantity) : "—"} />
                    <Stat label="売価" value={formatYen(r.listing?.selling_price)} />
                    <Stat
                      label="送料"
                      value={formatYen(r.shippingFee)}
                    />
                    <Stat label="販売手数料" value={formatYen(r.listing?.selling_fee)} />
                    <Stat label="梱包材費" value={formatYen(r.listing?.packaging_cost)} />
                    <Stat label="作業時間コスト" value={formatYen(r.listing?.work_time_cost)} />
                    <Stat label="営業利益" value={formatYen(r.listing?.operating_benefit)} />
                    <Stat
                      label="経常利益"
                      value={formatYen(ord)}
                      className={ord == null ? undefined : ord >= 0 ? styles.profit : styles.loss}
                    />
                    <Stat
                      label="出品可否"
                      value={r.listing?.is_listing == null ? "—" : r.listing.is_listing ? "推奨" : "非推奨"}
                      className={
                        r.listing?.is_listing == null
                          ? undefined
                          : r.listing.is_listing
                            ? styles.profit
                            : styles.loss
                      }
                    />
                  </div>
                </div>
                <div className={styles.actions}>
                  <form action={markAsSold.bind(null, r.id)}>
                    <button type="submit" className={styles.sold}>
                      売却済み
                    </button>
                  </form>
                  <form action={unlistItem.bind(null, r.id)}>
                    <button type="submit" className={styles.unlist}>
                      出品取り下げ
                    </button>
                  </form>
                  <Link href={`/items/${r.id}`} className={styles.editLink}>
                    詳細
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <span className={`${styles.figureValue} ${className ?? ""}`}>{value}</span>
    </div>
  );
}
