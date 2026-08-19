"use client";

import styles from "./error.module.css";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className={styles.container}>
      <p className={styles.title}>エラーが発生しました</p>
      <p className={styles.message}>
        処理を完了できませんでした。時間をおいてもう一度お試しください。
      </p>
      <button type="button" onClick={reset} className={styles.retry}>
        再試行
      </button>
    </div>
  );
}
