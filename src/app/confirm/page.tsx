import { confirmAction } from "@/app/auth/actions";
import styles from "../login/page.module.css";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email, error } = await searchParams;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>確認コードの入力</h1>
      <p>登録したメールに届いた確認コードを入力してください。</p>
      <form action={confirmAction} className={styles.form}>
        <input type="hidden" name="email" value={email ?? ""} />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>確認コード</span>
          <input
            name="code"
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            className={styles.input}
          />
        </label>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : null}
        <button type="submit" className={styles.submit}>
          確認する
        </button>
      </form>
    </div>
  );
}
