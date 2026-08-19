import { importBackup } from "./actions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>CSV インポート</h1>
      <p className={styles.desc}>
        ダッシュボードからエクスポートした CSV を読み込み、自分のアカウントに追加します。既存データは保持され、新しい id で重複登録される可能性があります。
      </p>

      {error ? (
        <p className={styles.error}>{decodeURIComponent(error)}</p>
      ) : null}
      {ok ? (
        <p className={styles.success}>{decodeURIComponent(ok)}</p>
      ) : null}

      <form action={importBackup} className={styles.form}>
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className={styles.fileInput}
        />
        <button type="submit" className={styles.submit}>
          インポート
        </button>
      </form>
    </div>
  );
}
