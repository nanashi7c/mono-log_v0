"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getCurrentUser,
  getAccessToken,
  getRefreshToken,
  setIdAndAccess,
  clearSession,
} from "@/lib/auth/session";
import {
  login,
  refresh,
  changePassword as cognitoChangePassword,
  deleteOwnUser,
  requestEmailUpdate,
  verifyEmailUpdate,
} from "@/lib/auth/cognito";
import { withUser } from "@/db/client";
import { isDemoUserId } from "@/lib/auth/demo-account";

function back(qs: string): never {
  redirect(`/mypage?${qs}`);
}

function rejectProtectedDemoAccount(userId: string): void {
  if (isDemoUserId(userId)) back("error=demo-account-protected");
}

export async function updateProfile(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  if (!username) back("error=username-required");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await withUser(user.sub, (tx) =>
    tx.user.updateMany({ where: { id: user.sub }, data: { username } }),
  );

  revalidatePath("/mypage");
  back("ok=profile-updated");
}

export async function changePassword(formData: FormData) {
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (next.length < 6) back("error=password-too-short");
  if (next !== confirm) back("error=password-mismatch");

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  rejectProtectedDemoAccount(user.sub);
  const accessToken = await getAccessToken();
  if (!accessToken) redirect("/login");

  // Cognito の ChangePassword は現パスワードを必須とし、誤りなら例外を投げる。
  try {
    await cognitoChangePassword(accessToken, current, next);
  } catch {
    back("error=current-password-wrong");
  }

  back("ok=password-updated");
}

export async function requestEmailChange(formData: FormData) {
  const newEmail = String(formData.get("new_email") ?? "").trim().toLowerCase();
  if (!newEmail || !newEmail.includes("@")) back("error=email-invalid");

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  rejectProtectedDemoAccount(user.sub);
  const accessToken = await getAccessToken();
  if (!accessToken) redirect("/login");

  // Cognito が新メールへ確認コードを送る。検証完了まで旧メールでもログイン可能。
  try {
    await requestEmailUpdate(accessToken, newEmail);
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    const msg =
      name === "AliasExistsException"
        ? "このメールアドレスは既に使われています。"
        : name === "InvalidParameterException"
          ? "メールアドレスの形式が正しくありません。"
          : "メール変更の申請に失敗しました。時間をおいて再度お試しください。";
    back(`error=${encodeURIComponent(msg)}`);
  }

  back(`verify_email=${encodeURIComponent(newEmail)}`);
}

export async function confirmEmailChange(formData: FormData) {
  const newEmail = String(formData.get("new_email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  rejectProtectedDemoAccount(user.sub);
  const accessToken = await getAccessToken();
  if (!accessToken) redirect("/login");

  // 新メールに届いたコードで確定。
  try {
    await verifyEmailUpdate(accessToken, code);
  } catch {
    back(
      `verify_email=${encodeURIComponent(newEmail)}&error=${encodeURIComponent("確認コードが正しくありません。")}`,
    );
  }

  // DB 側のメールも更新。
  await withUser(user.sub, (tx) =>
    tx.user.updateMany({ where: { id: user.sub }, data: { email: newEmail } }),
  );

  // トークンを再発行して新メールを即時反映（失敗しても次回更新時に反映される）。
  try {
    const rt = await getRefreshToken();
    if (rt) {
      const t = await refresh(rt);
      await setIdAndAccess(t.idToken, t.accessToken);
    }
  } catch {
    // 反映は次回のトークン更新に委ねる
  }

  revalidatePath("/mypage");
  back("ok=email-updated");
}

export async function deleteAccount(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (confirmation !== "削除") back("error=confirmation-mismatch");

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  rejectProtectedDemoAccount(user.sub);
  if (!user.email) back("error=email-missing");

  // 本人確認: 現パスワードで再ログインを試行する。
  try {
    await login(user.email, password);
  } catch {
    back("error=password-wrong");
  }

  const accessToken = await getAccessToken();
  if (!accessToken) redirect("/login");

  // 先に DB の users 行を削除（items 等は FK の ON DELETE CASCADE で消える）。
  await withUser(user.sub, (tx) => tx.user.deleteMany({ where: { id: user.sub } }));

  // Cognito 上のユーザも削除（セルフサービス）。
  try {
    await deleteOwnUser(accessToken);
  } catch {
    // DB 側は削除済み。Cognito 削除に失敗してもセッションは破棄して LP へ。
  }

  await clearSession();
  redirect("/");
}
