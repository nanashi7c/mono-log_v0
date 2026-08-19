import Link from "next/link";
import { signupAction } from "@/app/auth/actions";
import styles from "./page.module.css";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>新規登録</h1>
      <form action={signupAction} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>メール</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            パスワード（8文字以上・大文字小文字・数字を含む）
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={styles.input}
          />
        </label>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : null}
        {message ? (
          <p className={styles.success}>{decodeURIComponent(message)}</p>
        ) : null}
        <button type="submit" className={styles.submit}>
          登録
        </button>
      </form>
      <p className={styles.footer}>
        登録済みの方は{" "}
        <Link href="/login" className={styles.footerLink}>
          ログイン
        </Link>
      </p>
    </div>
  );
}
