"use server";

import { redirect } from "next/navigation";
import {
  signUp,
  confirmSignUp,
  login,
  verifyIdToken,
} from "@/lib/auth/cognito";
import { setSession, setDemoSession, clearSession } from "@/lib/auth/session";
import {
  getDemoAccountConfig,
  isDemoEmail,
  matchesDemoCredentials,
} from "@/lib/auth/demo-account";
import { withUser } from "@/db/client";

// サインアップ → 確認コード入力ページへ
export async function signupAction(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  try {
    await signUp(email, password);
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    const msg =
      name === "UsernameExistsException"
        ? "このメールアドレスは既に登録されています。ログインしてください。"
        : name === "InvalidPasswordException"
          ? "パスワードが要件を満たしていません（8文字以上・大文字・小文字・数字を含む）。"
          : name === "InvalidParameterException"
            ? "入力内容に誤りがあります（メール形式・パスワード要件をご確認ください）。"
            : "登録に失敗しました。時間をおいて再度お試しください。";
    redirect(`/signup?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/confirm?email=${encodeURIComponent(email)}`);
}

// 確認コード検証 → ログインページへ
export async function confirmAction(formData: FormData) {
  const email = String(formData.get("email"));
  const code = String(formData.get("code"));
  try {
    await confirmSignUp(email, code);
  } catch {
    redirect(
      `/confirm?email=${encodeURIComponent(email)}&error=${encodeURIComponent("確認コードが正しくありません")}`,
    );
  }
  redirect("/login?confirmed=1");
}

// ログイン → トークン保存 → users 行作成 → items へ
export async function loginAction(formData: FormData) {
  const email = String(formData.get("email")).trim().toLowerCase();
  const password = String(formData.get("password"));
  try {
    if (isDemoEmail(email)) {
      if (!matchesDemoCredentials(email, password)) {
        throw new Error("invalid demo login");
      }
      const demo = getDemoAccountConfig();
      if (!demo) throw new Error("demo account is not configured");
      await withUser(demo.userId, async (tx) => {
        await tx.user.upsert({
          where: { id: demo.userId },
          update: { email: demo.email },
          create: {
            id: demo.userId,
            email: demo.email,
            username: "デモユーザー",
          },
        });
      });
      await setDemoSession();
    } else {
      const tokens = await login(email, password);

      // 初回ログイン時に users 行を作成（id = Cognito の sub）。RLS 下で自分の行を insert。
      // Cookie 発行より前に行うことで、INSERT 失敗時に「セッションあり/行なし」を防ぐ。
      const payload = await verifyIdToken(tokens.idToken);
      const sub = payload.sub;
      const userEmail = payload.email as string;
      await withUser(sub, async (tx) => {
        await tx.user.upsert({
          where: { id: sub },
          update: {},
          create: { id: sub, email: userEmail, username: userEmail.split("@")[0] },
        });
      });

      // users 行が確保できてからセッション Cookie を発行する。
      await setSession(tokens);
    }
  } catch {
    redirect(
      `/login?error=${encodeURIComponent("メールまたはパスワードが違います")}`,
    );
  }
  redirect("/items");
}

// ログアウト → Cookie 削除 → ログインへ
export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
