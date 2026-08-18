import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ChangePasswordCommand,
  DeleteUserCommand,
  UpdateUserAttributesCommand,
  VerifyUserAttributeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const region = process.env.AWS_REGION!;
const clientId = process.env.COGNITO_CLIENT_ID!;

const client = new CognitoIdentityProviderClient({ region });

// ID トークンを検証する verifier（JWKS を自動取得・キャッシュする）。
// ビルド時は env が無く userPoolId が undefined になり create() が落ちるため、初回利用時に遅延生成する。
let idVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
function getIdVerifier() {
  if (!idVerifier) {
    idVerifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      clientId: process.env.COGNITO_CLIENT_ID!,
      tokenUse: "id",
    });
  }
  return idVerifier;
}

export type AuthTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
};

// サインアップ（Cognito が確認コードをメール送信する）
export async function signUp(email: string, password: string): Promise<void> {
  await client.send(
    new SignUpCommand({
      ClientId: clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    }),
  );
}

// メールに届いた確認コードを検証してアカウントを有効化
export async function confirmSignUp(
  email: string,
  code: string,
): Promise<void> {
  await client.send(
    new ConfirmSignUpCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
    }),
  );
}

// ログイン（email + password）→ トークン取得
export async function login(
  email: string,
  password: string,
): Promise<AuthTokens> {
  const res = await client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  const r = res.AuthenticationResult;
  if (!r?.IdToken || !r.AccessToken || !r.RefreshToken) {
    throw new Error("認証に失敗しました");
  }
  return {
    idToken: r.IdToken,
    accessToken: r.AccessToken,
    refreshToken: r.RefreshToken,
  };
}

// リフレッシュトークンでトークンを更新（refreshToken は返らない場合があるので呼び元で保持）
export async function refresh(
  refreshToken: string,
): Promise<Omit<AuthTokens, "refreshToken">> {
  const res = await client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "REFRESH_TOKEN_AUTH",
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  );
  const r = res.AuthenticationResult;
  if (!r?.IdToken || !r.AccessToken)
    throw new Error("トークン更新に失敗しました");
  return { idToken: r.IdToken, accessToken: r.AccessToken };
}

// ID トークンを検証して中身（sub / email 等）を返す。失敗時は例外
export async function verifyIdToken(idToken: string) {
  return getIdVerifier().verify(idToken);
}

// パスワード変更（アクセストークン＋現パスワードで検証。現パスワード誤りは例外）
export async function changePassword(
  accessToken: string,
  previous: string,
  proposed: string,
): Promise<void> {
  await client.send(
    new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: previous,
      ProposedPassword: proposed,
    }),
  );
}

// 自分自身のアカウントを削除（セルフサービス。アクセストークンで認可）
export async function deleteOwnUser(accessToken: string): Promise<void> {
  await client.send(new DeleteUserCommand({ AccessToken: accessToken }));
}

// メールアドレス変更を申請（新メールに確認コードが送られる）。検証は verifyEmailUpdate で。
export async function requestEmailUpdate(
  accessToken: string,
  newEmail: string,
): Promise<void> {
  await client.send(
    new UpdateUserAttributesCommand({
      AccessToken: accessToken,
      UserAttributes: [{ Name: "email", Value: newEmail }],
    }),
  );
}

// 新メールに届いた確認コードでメール変更を確定する。
export async function verifyEmailUpdate(
  accessToken: string,
  code: string,
): Promise<void> {
  await client.send(
    new VerifyUserAttributeCommand({
      AccessToken: accessToken,
      AttributeName: "email",
      Code: code,
    }),
  );
}
