import { importBackup } from "./actions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const IMPORT_ERROR_MESSAGES = Object.freeze({
  "no-file": "CSVファイルを選択してください。",
  "import-failed":
    "インポートに失敗しました。内容を確認し、時間をおいてもう一度お試しください。",
} as const);

function importErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  return (
    IMPORT_ERROR_MESSAGES[error as keyof typeof IMPORT_ERROR_MESSAGES] ?? error
  );
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  const errorMessage = importErrorMessage(error);

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>CSV インポート</h1>
      <p className={styles.desc}>
        ダッシュボードからエクスポートした CSV を読み込み、自分のアカウントに追加します。既存データは保持され、新しい id で重複登録される可能性があります。
      </p>

      {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
      {ok ? <p className={styles.success}>{ok}</p> : null}

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
