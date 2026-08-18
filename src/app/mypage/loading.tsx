import styles from "./page.module.css";

export default function MyPageLoading() {
  return (
    <div className={styles.container} aria-busy="true" aria-live="polite">
      <h1 className={styles.title}>マイページ</h1>
      <section className={styles.section}>
        <p className={styles.note}>アカウント情報を読み込んでいます…</p>
      </section>
    </div>
  );
}
