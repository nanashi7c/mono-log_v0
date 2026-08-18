import Link from "next/link";
import { loadHomeOverviewUseCase } from "@/features/home/application/home-overview-query-use-cases";
import { prismaHomeOverviewQueryRepository } from "@/features/home/infrastructure/prisma-home-overview-query-repository";
import { getCurrentUser } from "@/lib/auth/session";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const homeOverviewQueryDependencies = {
  repository: prismaHomeOverviewQueryRepository,
};

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (!user) return <UnauthenticatedLanding />;

  const overview = await loadHomeOverviewUseCase(
    homeOverviewQueryDependencies,
    { userId: user.sub },
  );
  const username = overview.username ?? user.email.split("@")[0];

  return (
    <div>
      <div className={styles.welcomeRow}>
        <div>
          <h1 className={styles.welcomeTitle}>こんにちは、{username} さん</h1>
          <p className={styles.welcomeSub}>管理したい所有物を選んでください。</p>
        </div>
      </div>

      <div className={styles.cards}>
        <NavCard
          href="/items"
          label="OWNED"
          title="所有物"
          count={overview.owned}
          desc="手元にある物・出品中の物を一覧表示"
        />
        <NavCard
          href="/items/planned"
          label="PLANNED"
          title="購入予定"
          count={overview.planned}
          desc="買おうとしている物を管理"
        />
        <NavCard
          href="/items/selling"
          label="LISTED"
          title="出品中"
          count={overview.listed}
          desc="出品中の物と損益を確認"
        />
        <NavCard href="/dashboard" label="STATS" title="ダッシュボード" desc="保有資産・カテゴリ別の集計" />
      </div>
    </div>
  );
}

function NavCard({
  href,
  label,
  title,
  count,
  desc,
}: {
  href: string;
  label: string;
  title: string;
  count?: number;
  desc: string;
}) {
  return (
    <Link href={href} className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <h2 className={styles.cardTitle}>{title}</h2>
      {count != null ? <span className={styles.cardCount}>{count}</span> : null}
      <p className={styles.cardDesc}>{desc}</p>
    </Link>
  );
}

function UnauthenticatedLanding() {
  return (
    <div>
      <section className={styles.hero}>
        <h1 className={styles.tagline}>所有物・購入予定・出品をひとつに。</h1>
        <p className={styles.sub}>
          バラバラに管理していた「持ち物・欲しい物・売りたい物」を mono-log で一元管理しましょう。
        </p>
        <div className={styles.heroActions}>
          <Link href="/signup" className={styles.primary}>
            無料で始める
          </Link>
          <Link href="/login" className={styles.secondary}>
            ログイン
          </Link>
        </div>
      </section>

      <section className={styles.features}>
        <article className={styles.feature}>
          <h2 className={styles.featureTitle}>所有物リスト</h2>
          <p className={styles.featureDesc}>
            手元にある物を画像・カテゴリ・購入価格とともに記録。検索でいつでも探せます。
          </p>
        </article>
        <article className={styles.feature}>
          <h2 className={styles.featureTitle}>購入予定リスト</h2>
          <p className={styles.featureDesc}>
            買う前から記録して、購入予定年月や定価、商品リンクを管理。買ったらワンクリックで所有物へ。
          </p>
        </article>
        <article className={styles.feature}>
          <h2 className={styles.featureTitle}>出品リスト</h2>
          <p className={styles.featureDesc}>
            販売手数料・送料・作業時間を含めた損益を自動計算し、出品すべきかを判定します。
          </p>
        </article>
      </section>
    </div>
  );
}
