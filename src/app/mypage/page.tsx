import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { loadUserProfileUseCase } from "@/features/users/application/user-profile-query-use-cases";
import { prismaUserProfileQueryRepository } from "@/features/users/infrastructure/prisma-user-profile-query-repository";
import {
  changePassword,
  confirmEmailChange,
  deleteAccount,
  requestEmailChange,
  updateProfile,
} from "./actions";
import styles from "./page.module.css";
import { isDemoUserId } from "@/lib/auth/demo-account";

export const dynamic = "force-dynamic";

const userProfileQueryDependencies = {
  repository: prismaUserProfileQueryRepository,
};

const ERROR_MESSAGES: Record<string, string> = {
  "username-required": "ユーザー名を入力してください。",
  "password-too-short": "新しいパスワードは 6 文字以上で入力してください。",
  "password-mismatch": "新しいパスワードと確認用パスワードが一致しません。",
  "current-password-wrong": "現在のパスワードが正しくありません。",
  "password-wrong": "パスワードが正しくありません。",
  "confirmation-mismatch": "確認テキストが一致しません。「削除」と正確に入力してください。",
  "admin-not-configured": "アカウント削除は管理者設定が必要です。",
  "email-missing": "メールアドレスが取得できません。",
  "email-invalid": "メールアドレスの形式が正しくありません。",
  "demo-account-protected": "デモアカウントの認証情報とアカウントは変更できません。",
};

const SUCCESS_MESSAGES: Record<string, string> = {
  "profile-updated": "プロフィールを更新しました。",
  "password-updated": "パスワードを変更しました。",
  "email-updated": "メールアドレスを変更しました。",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; verify_email?: string }>;
}) {
  const { error, ok, verify_email } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profile = await loadUserProfileUseCase(
    userProfileQueryDependencies,
    { userId: user.sub },
  );
  const username = profile?.username ?? "";
  const createdAt = profile?.createdAt ?? null;
  const lastSignIn = user.authTime != null ? new Date(user.authTime * 1000).toISOString() : null;
  const isDemoAccount = isDemoUserId(user.sub);
  // 退会は Cognito のセルフサービスで常に可能。
  const adminConfigured = true;

  const errorMsg = error ? ERROR_MESSAGES[error] ?? error : null;
  const okMsg = ok ? SUCCESS_MESSAGES[ok] ?? decodeURIComponent(ok) : null;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>マイページ</h1>

      {errorMsg ? <p className={styles.error}>{errorMsg}</p> : null}
      {okMsg ? <p className={styles.success}>{okMsg}</p> : null}

      {isDemoAccount ? (
        <p className={styles.demoNotice}>
          デモアカウントではメールアドレス・パスワードの変更と退会を無効にしています。登録データは毎日初期状態へ戻ります。
        </p>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>アカウント情報</h2>
        <dl className={styles.grid2}>
          <dt className={styles.gridLabel}>ログインID（メールアドレス）</dt>
          <dd className={styles.readonly}>{user.email}</dd>
          <dt className={styles.gridLabel}>利用開始日</dt>
          <dd className={styles.readonly}>{formatDateTime(createdAt)}</dd>
          <dt className={styles.gridLabel}>最終ログイン</dt>
          <dd className={styles.readonly}>{formatDateTime(lastSignIn)}</dd>
        </dl>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>プロフィール編集</h2>
        <form action={updateProfile}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>ユーザー名</span>
            <input
              name="username"
              required
              defaultValue={username}
              className={styles.input}
            />
          </label>
          <button type="submit" className={styles.submit} style={{ marginTop: "0.75rem" }}>
            保存
          </button>
        </form>
      </section>

      {!isDemoAccount ? (
        <section className={styles.section}>
        <h2 className={styles.sectionTitle}>メールアドレス変更</h2>
        {verify_email ? (
          <form action={confirmEmailChange}>
            <p className={styles.note}>
              新しいメールアドレス（{verify_email}）宛に確認コードを送信しました。届いたコードを入力してください。
            </p>
            <input type="hidden" name="new_email" value={verify_email} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>確認コード</span>
              <input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                className={styles.input}
              />
            </label>
            <button type="submit" className={styles.submit} style={{ marginTop: "0.75rem" }}>
              確認して変更
            </button>
          </form>
        ) : (
          <form action={requestEmailChange}>
            <p className={styles.note}>
              変更すると新しいアドレスに確認コードが届きます。コードの入力が完了するまで現在のアドレスでログインできます。
            </p>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>新しいメールアドレス</span>
              <input
                name="new_email"
                type="email"
                required
                autoComplete="email"
                className={styles.input}
              />
            </label>
            <button type="submit" className={styles.submit} style={{ marginTop: "0.75rem" }}>
              確認コードを送信
            </button>
          </form>
        )}
        </section>
      ) : null}

      {!isDemoAccount ? (
        <section className={styles.section}>
        <h2 className={styles.sectionTitle}>パスワード変更</h2>
        <form action={changePassword}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>現在のパスワード</span>
            <input
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              className={styles.input}
            />
          </label>
          <label className={styles.field} style={{ marginTop: "0.5rem" }}>
            <span className={styles.fieldLabel}>新しいパスワード（6 文字以上）</span>
            <input
              name="new_password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className={styles.input}
            />
          </label>
          <label className={styles.field} style={{ marginTop: "0.5rem" }}>
            <span className={styles.fieldLabel}>新しいパスワード（確認）</span>
            <input
              name="confirm_password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className={styles.input}
            />
          </label>
          <button type="submit" className={styles.submit} style={{ marginTop: "0.75rem" }}>
            パスワードを変更
          </button>
        </form>
        </section>
      ) : null}

      {!isDemoAccount ? (
        <section className={`${styles.section} ${styles.danger}`}>
        <h2 className={`${styles.sectionTitle} ${styles.dangerTitle}`}>アカウント削除</h2>
        <p className={styles.note}>
          アカウントを削除すると、登録済みのアイテム・購入予定・出品情報・カテゴリがすべて消えます。元に戻すことはできません。
        </p>
        {!adminConfigured ? (
          <p className={styles.note}>
            アカウント削除を有効化するには、サーバー環境変数を設定してください。
          </p>
        ) : null}
        <form action={deleteAccount}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>パスワード（本人確認）</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={styles.input}
            />
          </label>
          <label className={styles.field} style={{ marginTop: "0.5rem" }}>
            <span className={styles.fieldLabel}>
              削除する場合は「削除」と入力してください
            </span>
            <input name="confirmation" required className={styles.input} />
          </label>
          <button
            type="submit"
            className={styles.submit}
            disabled={!adminConfigured}
            style={{ marginTop: "0.75rem" }}
          >
            アカウントを削除
          </button>
        </form>
        </section>
      ) : null}
    </div>
  );
}
