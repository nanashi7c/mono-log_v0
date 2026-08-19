# 付録B: 中核アプリ実装手順＋逐行解説

[setup-guide.md](setup-guide.md) の7章の詳細版。認証・DB・画像まわりの中核ファイルを**ファイル作成の手順形式**で実装し、各コードの直後に**逐行解説**を付けます。画面(`page.tsx`)・UI部品・計算・整形は[付録D](setup-guide-data.md)とリポジトリを参照。

- **前提**: 5〜6章で雛形・設定・依存導入が済んでいること。型(`types/item.ts`)・スキーマ(`prisma/schema.prisma`)・シリアライザ(`serialize.ts`)は[付録D](setup-guide-data.md)で先に作り、`npx prisma generate`まで済ませておくと、本章のコードがそのまま型チェックを通ります。
- 各Stepは「指定パスにファイルを新規作成し、下のコードを貼る」。最後のStep 8で型チェック。

### 前提知識（最初に1回）
- **Server Component**: 既定でサーバ実行されるReactコンポーネント。DBに直接アクセスできる。
- **Server Action**: `"use server"`を付けた関数。フォーム送信＝サーバ側の更新処理として呼べる。
- **middleware**: 全リクエストの前に走る関数（Edgeランタイム）。
- `@/...`: `src/`からの絶対import（`tsconfig`の`paths`）。

---

## Step 1. `src/db/client.ts` を作成

```ts
import { PrismaClient, Prisma } from "@prisma/client";

// アプリの接続URLを個別 env から組み立てる。アプリは常に DB_USER(=monolog_app・非所有者)で
// 接続して RLS を効かせる。Prisma CLI 用の DATABASE_URL は admin を指すため、ここでは使わない。
// RDS は rds.force_ssl=1 で SSL 必須なので本番のみ sslmode=require を付与する。
function buildDatabaseUrl(): string | undefined {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const pw = process.env.DB_PASSWORD;
  if (!host || !port || !name || !user || pw == null) return undefined;
  const ssl = process.env.NODE_ENV === "production" ? "?sslmode=require" : "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pw)}@${host}:${port}/${name}${ssl}`;
}

// dev のホットリロードで PrismaClient が増殖しないよう global に保持する。
const globalForPrisma = globalThis as unknown as { _monologPrisma?: PrismaClient };

// ビルド時は env が無く接続URLを組めないため、初回利用時に遅延生成する。
let cached: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (cached) return cached;
  if (globalForPrisma._monologPrisma) {
    cached = globalForPrisma._monologPrisma;
    return cached;
  }
  cached = new PrismaClient({ datasourceUrl: buildDatabaseUrl() });
  if (process.env.NODE_ENV !== "production") globalForPrisma._monologPrisma = cached;
  return cached;
}

// withUser のコールバックが受け取るトランザクションクライアント型。
export type Tx = Prisma.TransactionClient;

// 指定ユーザ(sub)の RLS コンテキストでクエリを実行するヘルパー。
export async function withUser<T>(
  sub: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${sub}, true)`;
    return fn(tx);
  });
}
```
**逐行解説**
- `import { PrismaClient, Prisma } from "@prisma/client"`: 生成済み Prisma Client と型名前空間（`Prisma.TransactionClient` 等）。
- `buildDatabaseUrl()`: `DB_*` から接続URLを組み立てる。**アプリは常に `DB_USER`(=monolog_app・非所有者)接続**で RLS を効かせる。本番のみ `?sslmode=require`（暗号化のみ・CA検証なし＝旧 `rejectUnauthorized:false` 相当）。`DATABASE_URL`(CLI用・admin)は使わない。
- `const globalForPrisma = ...`: PrismaClient 保持の受け皿。dev のホットリロードで増殖を防ぐ。
- `getPrisma()`: **遅延生成**。ビルド時は env が無く接続URLを組めないため、初回利用時に `new PrismaClient({ datasourceUrl })` する（cognito の verifier と同じ理由）。`cached` で本番も単一インスタンスを再利用。
- `export type Tx = Prisma.TransactionClient`: トランザクションクライアント型（他ファイルの引数型用）。
- `withUser(sub, fn)`: **RLSの肝**。Prisma の interactive transaction 内で `tx.$executeRaw\`select set_config('app.current_user_id', ${sub}, true)\``（このTXのみ有効）してから `fn(tx)` を実行＝「自分の行だけ」をDBが保証。

---

## Step 2. `src/lib/auth/cognito.ts` を作成

```ts
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

// ID トークン検証 verifier（JWKS を自動取得・キャッシュ）。
// ビルド時は env が無く userPoolId が undefined になり create() が落ちるため遅延生成。
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
export async function confirmSignUp(email: string, code: string): Promise<void> {
  await client.send(
    new ConfirmSignUpCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
    }),
  );
}

// ログイン（email + password）→ トークン取得
export async function login(email: string, password: string): Promise<AuthTokens> {
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
  return { idToken: r.IdToken, accessToken: r.AccessToken, refreshToken: r.RefreshToken };
}

// リフレッシュトークンでトークンを更新
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
  if (!r?.IdToken || !r.AccessToken) throw new Error("トークン更新に失敗しました");
  return { idToken: r.IdToken, accessToken: r.AccessToken };
}

// ID トークンを検証して中身（sub / email 等）を返す。失敗時は例外
export async function verifyIdToken(idToken: string) {
  return getIdVerifier().verify(idToken);
}

// パスワード変更（アクセストークン＋現パスワードで検証）
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

// 自分自身のアカウントを削除（セルフサービス）
export async function deleteOwnUser(accessToken: string): Promise<void> {
  await client.send(new DeleteUserCommand({ AccessToken: accessToken }));
}

// メールアドレス変更を申請（新メールに確認コードが送られる）
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

// 新メールに届いた確認コードでメール変更を確定する
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

```
**逐行解説**
- `import { ... } from "@aws-sdk/client-cognito-identity-provider"`: 1操作=1コマンドクラス。
- `import { CognitoJwtVerifier } from "aws-jwt-verify"`: JWT検証(公開鍵JWKSを自動取得)。
- `const region/clientId = process.env...!`: 環境変数(`!`はnull非許容の断言)。
- `const client = new CognitoIdentityProviderClient({ region })`: SDKクライアント。
- `let idVerifier = ... | null` + `getIdVerifier()`: **遅延生成**。ビルド時はenv不在で`create()`が落ちるため初回利用時に作る。`tokenUse:"id"`=IDトークン検証。
- `AuthTokens`型: ID/アクセス/リフレッシュの3トークン。
- `signUp`: `SignUpCommand`で登録(emailをUsername＆属性に)。送信後Cognitoが確認コードをメール。
- `confirmSignUp`: `ConfirmSignUpCommand`で確認コード検証→有効化。
- `login`: `InitiateAuthCommand`＋`AuthFlow:"USER_PASSWORD_AUTH"`。3トークン揃わなければ例外。
- `refresh`: `AuthFlow:"REFRESH_TOKEN_AUTH"`で再発行。戻り型`Omit<...,"refreshToken">`(リフレッシュは返らない)。
- `verifyIdToken`: `getIdVerifier().verify(...)`。署名・期限・発行者を検証しペイロード返す。
- `changePassword`: `ChangePasswordCommand`(現/新パスワード)。現パスワード誤りは例外。
- `deleteOwnUser`: `DeleteUserCommand`で退会。
- `requestEmailUpdate`/`verifyEmailUpdate`: メール変更申請＋確認コード検証。

---

## Step 3. `src/lib/auth/session.ts` を作成

```ts
import { cookies } from "next/headers";
import { type AuthTokens, verifyIdToken } from "./cognito";

const ID_COOKIE = "ml_id";
const ACCESS_COOKIE = "ml_access";
const REFRESH_COOKIE = "ml_refresh";

const baseCookie = {
  httpOnly: true, // JS から読めない（XSS 対策）
  secure: process.env.NODE_ENV === "production", // 本番は HTTPS のみ
  sameSite: "lax" as const,
  path: "/",
};

// トークンを httpOnly Cookie に保存（login 成功時に呼ぶ）
export async function setSession(tokens: AuthTokens): Promise<void> {
  const store = await cookies();
  store.set(ID_COOKIE, tokens.idToken, baseCookie);
  store.set(ACCESS_COOKIE, tokens.accessToken, baseCookie);
  store.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie,
    maxAge: 60 * 60 * 24 * 30, // 30日
  });
}

// セッション Cookie を削除（logout 時に呼ぶ）
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ID_COOKIE);
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export type CurrentUser = { sub: string; email: string; authTime: number | null };

// 現在のユーザを取得（ID トークンを検証するだけ＝読み取り専用）。未ログインなら null。
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const idToken = store.get(ID_COOKIE)?.value;
  if (!idToken) return null;
  try {
    const payload = await verifyIdToken(idToken);
    return {
      sub: payload.sub,
      email: payload.email as string,
      authTime: typeof payload.auth_time === "number" ? payload.auth_time : null,
    };
  } catch {
    return null; // 署名不正・期限切れ等
  }
}

// アクセストークンを取得（パスワード変更・退会など Cognito 操作で使う）
export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

// リフレッシュトークンを取得
export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}

// ID/アクセストークンだけ差し替える（リフレッシュ後の即時反映用）
export async function setIdAndAccess(idToken: string, accessToken: string): Promise<void> {
  const store = await cookies();
  store.set(ID_COOKIE, idToken, baseCookie);
  store.set(ACCESS_COOKIE, accessToken, baseCookie);
}
```
**逐行解説**
- `import { cookies } from "next/headers"`: サーバ側Cookie読み書きAPI。
- `ID_COOKIE/ACCESS_COOKIE/REFRESH_COOKIE`: Cookie名定数。
- `baseCookie`: `httpOnly`(JS不可視)、`secure`(本番のみHTTPS)、`sameSite:"lax"`(CSRF緩和)、`path:"/"`。
- `setSession`: `await cookies()`でストア取得→3つ`set`。リフレッシュのみ`maxAge`30日(他は短命でmiddlewareが更新)。
- `clearSession`: 3つ`delete`(ログアウト)。
- `getCurrentUser`: IDトークンCookieを`verifyIdToken`で検証し`sub`/`email`/`auth_time`返す。失効は`null`(更新はmiddleware担当)。
- `getAccessToken`/`getRefreshToken`: 各Cookie値。
- `setIdAndAccess`: リフレッシュ後にID/アクセスのみ更新。

---

## Step 4-1. `src/lib/origin-verification.ts` を作成

```ts
export const CLOUDFRONT_ORIGIN_VERIFY_HEADER =
  "x-mono-log-origin-verify" as const;

export function isOriginRequestAllowed(
  presentedSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (expectedSecret === undefined) return true;
  return expectedSecret.length > 0 && presentedSecret === expectedSecret;
}
```

**逐行解説**
- `CLOUDFRONT_ORIGIN_VERIFY_HEADER`: TerraformのCloudFront origin設定と共有するヘッダー名。HTTPヘッダー名は大文字小文字を区別しないため、取得側は小文字で統一する。
- `isOriginRequestAllowed`: リクエストのヘッダー値と本番コンテナの環境変数を比較する純粋関数。
- 環境変数自体が未設定なら許可する。これによりCloudFrontを使わないローカル開発やVercelを維持する。
- 環境変数が空文字なら設定ミスとして全要求を拒否する。秘密値が設定された本番EC2では完全一致だけを許可する。

---

## Step 4-2. `src/middleware.ts` を作成

```ts
import { NextResponse, type NextRequest } from "next/server";
import {
  CLOUDFRONT_ORIGIN_VERIFY_HEADER,
  isOriginRequestAllowed,
} from "@/lib/origin-verification";

// 認証不要のパス（ランディング・認証系）
const PUBLIC_PREFIXES = ["/", "/login", "/signup", "/confirm"];

const SESSION_COOKIES = ["ml_id", "ml_access", "ml_refresh"];

const SESSION_AUTH_EXEMPT_PREFIXES = ["/api", "/_next"];
const PUBLIC_ASSET_PATH = /\.(?:svg|png|jpg|jpeg|gif|webp)$/;

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// JWT の exp を署名検証せずに読む（Edge ランタイムで動くよう atob のみ）。
function decodeExp(token: string | undefined): number | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isExpired(token: string | undefined): boolean {
  const exp = decodeExp(token);
  return exp == null || exp * 1000 <= Date.now();
}

// Cognito の REFRESH_TOKEN_AUTH を fetch で実行（Edge 対応・公開クライアントなので認証情報不要）。
async function refreshTokens(
  refreshToken: string,
): Promise<{ idToken: string; accessToken: string } | null> {
  const region = process.env.AWS_REGION;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!region || !clientId) return null;
  try {
    const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      AuthenticationResult?: { IdToken?: string; AccessToken?: string };
    };
    const r = data.AuthenticationResult;
    if (!r?.IdToken || !r.AccessToken) return null;
    return { idToken: r.IdToken, accessToken: r.AccessToken };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const presentedOriginSecret = request.headers.get(
    CLOUDFRONT_ORIGIN_VERIFY_HEADER,
  );
  if (
    !isOriginRequestAllowed(
      presentedOriginSecret,
      process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET,
    )
  ) {
    return new NextResponse(null, { status: 403 });
  }

  const path = request.nextUrl.pathname;
  const skipsSessionAuthentication =
    SESSION_AUTH_EXEMPT_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) ||
    path === "/favicon.ico" ||
    PUBLIC_ASSET_PATH.test(path);
  if (skipsSessionAuthentication) return NextResponse.next();

  const idToken = request.cookies.get("ml_id")?.value;
  const refreshToken = request.cookies.get("ml_refresh")?.value;
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => path === p || (p !== "/" && path.startsWith(`${p}/`)),
  );

  let loggedIn = !isExpired(idToken);
  let refreshed: { idToken: string; accessToken: string } | null = null;

  // ID トークンが失効していてもリフレッシュトークンがあれば自動更新を試みる。
  if (!loggedIn && refreshToken) {
    refreshed = await refreshTokens(refreshToken);
    if (refreshed) {
      loggedIn = true;
      request.cookies.set("ml_id", refreshed.idToken);
      request.cookies.set("ml_access", refreshed.accessToken);
    }
  }

  function applyRefreshed(res: NextResponse): NextResponse {
    if (refreshed) {
      res.cookies.set("ml_id", refreshed.idToken, cookieOpts);
      res.cookies.set("ml_access", refreshed.accessToken, cookieOpts);
    }
    return res;
  }

  // 未ログイン（更新も不可）で保護ルート → /login。失効 Cookie は破棄し、ループを防ぐ。
  if (!loggedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    const res = NextResponse.redirect(url);
    if (idToken || refreshToken) for (const c of SESSION_COOKIES) res.cookies.delete(c);
    return res;
  }

  // ログイン済みで /login・/signup → /items
  if (loggedIn && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/items";
    return applyRefreshed(NextResponse.redirect(url));
  }

  return applyRefreshed(NextResponse.next({ request }));
}
```
**逐行解説**
- `PUBLIC_PREFIXES`: 認証不要パス。`SESSION_COOKIES`: 失効時に消すCookie。`cookieOpts`: 応答に載せる属性。
- `SESSION_AUTH_EXEMPT_PREFIXES`/`PUBLIC_ASSET_PATH`: API、Next.js内部ファイル、公開画像には画面用Cookie認証を適用しない。ただしオリジン検証はその前に全リクエストへ適用する。
- `decodeExp`: JWTの`exp`を**署名検証せず**読む。`token.split(".")[1]`=ペイロード、`atob(... base64url→base64 ...)`で復号、`JSON.parse(...).exp`。
- `isExpired`: `exp`がnullか、`exp*1000`(ms)が現在以下なら失効。
- `refreshTokens`: SDKでなく`fetch`でCognitoのHTTP APIを直叩き(Edge対応・公開クライアント)。`X-Amz-Target:...InitiateAuth`＋`REFRESH_TOKEN_AUTH`。失敗/欠落は`null`。
- `middleware(request)`本体:
  - 最初にCloudFrontの秘密ヘッダーを環境変数と比較し、不一致なら本文なしの403を返す。
  - API・Next.js内部ファイル・公開画像はオリジン検証後に続行する。API固有のBearer認証は各Route Handlerが行う。
  - Cookieから`idToken`/`refreshToken`、`path`、`isPublic`(公開判定)を求める。
  - `let loggedIn = !isExpired(idToken)`。失効でもリフレッシュトークンがあれば`refreshTokens`で更新し`request.cookies.set`(同リクエストのServer Componentが新トークンを読めるよう要求側も更新)。
  - `applyRefreshed(res)`: 新トークンを応答(ブラウザ)にも載せる。
  - `if (!loggedIn && !isPublic)`: 未ログインで保護ルート→`/login`へ。`redirect`クエリで戻り先記憶、失効Cookie削除でループ防止。
  - `if (loggedIn && (/login|/signup))`: ログイン済みは`/items`へ。
  - 既定は`NextResponse.next({ request })`で続行。
- matcherを置かず全パスへmiddlewareを適用する。セッション認証の対象外判定を関数内へ移すことで、APIや静的ファイルもオリジン検証の対象にできる。

---

## Step 5. `src/lib/image.ts` を作成

```ts
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.S3_IMAGE_BUCKET!;
const SIGNED_TTL = 60 * 60; // 1 hour

// 認証情報は環境（ローカルは ~/.aws、EC2 は IAM ロール）から自動取得する。
const s3 = new S3Client({ region: process.env.AWS_REGION });

export const IMAGE_BUCKET = BUCKET;

// S3 オブジェクトキーから署名付き GET URL を生成する。キーが無ければ null。
export async function signedImageUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
      expiresIn: SIGNED_TTL,
    });
  } catch {
    return null;
  }
}

// 画像を S3 に保存する。
export async function putImage(
  key: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

// 画像を S3 から削除する。
export async function deleteImage(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
```
**逐行解説**
- `import { S3Client, GetObjectCommand, ... }`: S3操作クラス。`getSignedUrl`は署名付きURL生成。
- `const BUCKET = process.env.S3_IMAGE_BUCKET!`: バケット名。`SIGNED_TTL = 60*60`=URL有効1時間。
- `const s3 = new S3Client({ region })`: 認証情報は環境(ローカル`~/.aws`、EC2はIAMロール)から自動。
- `signedImageUrl(key)`: キーが無ければnull。`getSignedUrl(s3, new GetObjectCommand({Bucket,Key}), {expiresIn})`で**一時閲覧URL**(バケットは非公開のため直リンク不可)。
- `putImage(key, body, contentType?)`: `PutObjectCommand`で保存。
- `deleteImage(key)`: `DeleteObjectCommand`で削除。

---

## Step 6. `src/app/auth/actions.ts` を作成

```ts
"use server";

import { redirect } from "next/navigation";
import {
  signUp,
  confirmSignUp,
  login,
  verifyIdToken,
} from "@/lib/auth/cognito";
import { setSession, clearSession } from "@/lib/auth/session";
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

// ログイン → users 行作成 → トークン保存 → items へ
export async function loginAction(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  try {
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
  } catch {
    redirect(`/login?error=${encodeURIComponent("メールまたはパスワードが違います")}`);
  }
  redirect("/items");
}

// ログアウト → Cookie 削除 → ログインへ
export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
```
**逐行解説**
- `"use server"`: このファイルの関数は**サーバアクション**。
- `signupAction`: `signUp(email,password)`→例外名で日本語メッセージを選び`/signup?error=`へ。成功で`/confirm`。
- `confirmAction`: `confirmSignUp(email,code)`→失敗で`/confirm`にエラー、成功で`/login?confirmed=1`。
- `loginAction`（**順序が肝**）:
  - `login(...)`でトークン取得→`verifyIdToken`で`sub`/`email`取得。
  - `withUser(sub, ... tx.user.upsert({ where:{id}, update:{}, create:{...} }))`: **users行を先に確保**（あれば何もしない）。
  - `setSession(tokens)`: **行確保後にCookie発行**(逆順だとorphanセッション。7章勘所4)。
  - 失敗で`/login?error=`、成功で`/items`。
- `logoutAction`: `clearSession()`→`/login`。

---

## Step 7. `src/app/items/actions.ts` を作成

アイテムのCRUD（作成/更新/削除）と補助。長いので**完全コードを貼った後、ブロックごとに逐行解説**します。

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { withUser, type Tx } from "@/db/client";
import { putImage, deleteImage } from "@/lib/image";
import { computeListingMetrics } from "@/lib/listing-calc";
import type { ItemStatus } from "@/types/item";

const STATUSES: ItemStatus[] = ["planned", "owned", "listed"];

type ParsedForm = {
  name: string;
  status: ItemStatus;
  category_ids: number[];
  new_category_names: string[];
  jan_code: string | null;
  quantity: number;
  notes: string | null;
  actual_price: number | null;
  purchased_at: string | null;
  image: File | null;
  delete_image: boolean;
  plan: {
    planned_purchase_year: number | null;
    planned_purchase_month: number | null;
    list_price: number | null;
    purchase_price: number | null;
    product_url: string | null;
    deal_period: string | null;
  };
  listing: {
    platform_id: number | null;
    service_id: number | null;
    size_id: number | null;
    quantity: number | null;
    selling_price: number | null;
    packaging_cost: number | null;
    work_time_hours: number | null;
    labor_rate: number | null;
  };
};

function intOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Math.floor(Number(s));
  return Number.isFinite(n) ? n : null;
}

function nonNegIntOrNull(v: FormDataEntryValue | null): number | null {
  const n = intOrNull(v);
  return n != null && n >= 0 ? n : null;
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseForm(formData: FormData): ParsedForm {
  const statusRaw = String(formData.get("status") ?? "");
  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as ItemStatus) : "owned";

  const category_ids = formData
    .getAll("category_ids")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  const new_category_names = String(formData.get("new_category_names") ?? "")
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const quantityRaw = nonNegIntOrNull(formData.get("quantity"));
  const quantity = quantityRaw != null && quantityRaw > 0 ? quantityRaw : 1;

  const file = formData.get("image");
  const image = file instanceof File && file.size > 0 ? file : null;

  return {
    name: String(formData.get("name") ?? "").trim(),
    status,
    category_ids,
    new_category_names,
    jan_code: strOrNull(formData.get("jan_code")),
    quantity,
    notes: strOrNull(formData.get("notes")),
    actual_price: nonNegIntOrNull(formData.get("actual_price")),
    purchased_at: strOrNull(formData.get("purchased_at")),
    image,
    delete_image: String(formData.get("delete_image") ?? "") === "1",
    plan: {
      planned_purchase_year: intOrNull(formData.get("planned_purchase_year")),
      planned_purchase_month: (() => {
        const m = intOrNull(formData.get("planned_purchase_month"));
        return m != null && m >= 1 && m <= 12 ? m : null;
      })(),
      list_price: nonNegIntOrNull(formData.get("list_price")),
      purchase_price: nonNegIntOrNull(formData.get("purchase_price")),
      product_url: strOrNull(formData.get("product_url")),
      deal_period: strOrNull(formData.get("deal_period")),
    },
    listing: {
      platform_id: intOrNull(formData.get("platform_id")),
      service_id: intOrNull(formData.get("service_id")),
      size_id: intOrNull(formData.get("size_id")),
      quantity: nonNegIntOrNull(formData.get("listing_quantity")),
      selling_price: nonNegIntOrNull(formData.get("selling_price")),
      packaging_cost: nonNegIntOrNull(formData.get("packaging_cost")),
      work_time_hours: (() => {
        const v = formData.get("work_time_hours");
        if (v == null) return null;
        const s = String(v).trim();
        if (s === "") return null;
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      labor_rate: nonNegIntOrNull(formData.get("labor_rate")),
    },
  };
}

async function authed() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// 画像を S3 に保存し、保存キー（items.image_url に入れる値）を返す。
async function uploadImage(file: File, userId: string, itemId: number): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const key = `${userId}/${itemId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await putImage(key, buffer, file.type || undefined);
  return key;
}

async function removeImage(key: string) {
  await deleteImage(key);
}

// (service_id, size_id) の組合せに対応する shipping 行を取得（無ければ作成）。
async function resolveShippingId(
  tx: Tx,
  serviceId: number | null,
  sizeId: number | null,
): Promise<bigint | null> {
  if (serviceId == null || sizeId == null) return null;
  const row = await tx.shipping.upsert({
    where: { shippingServiceId_shippingSizeId: { shippingServiceId: serviceId, shippingSizeId: sizeId } },
    update: {},
    create: { shippingServiceId: serviceId, shippingSizeId: sizeId },
    select: { id: true },
  });
  return row.id;
}

// 新規カテゴリ名を作成（冪等）し、選択された全カテゴリ ID を返す。
async function resolveCategoryIds(tx: Tx, parsed: ParsedForm, userId: string): Promise<number[]> {
  const ids = new Set(parsed.category_ids);
  for (const name of parsed.new_category_names) {
    let cat = await tx.category.findFirst({ where: { userId, name }, select: { id: true } });
    if (!cat) cat = await tx.category.create({ data: { userId, name }, select: { id: true } });
    ids.add(cat.id);
  }
  return [...ids];
}

async function syncItemCategories(tx: Tx, itemId: number, categoryIds: number[]) {
  // 置換方式: 現行行を削除し、新しい行を挿入する。
  await tx.itemCategory.deleteMany({ where: { itemId: BigInt(itemId) } });
  if (categoryIds.length === 0) return;
  await tx.itemCategory.createMany({
    data: categoryIds.map((cid) => ({ itemId: BigInt(itemId), categoryId: cid })),
  });
}

async function upsertPlan(tx: Tx, itemId: number, parsed: ParsedForm) {
  if (parsed.status !== "planned") {
    await tx.plan.deleteMany({ where: { itemId: BigInt(itemId) } });
    return;
  }
  const data = {
    plannedPurchaseYear: parsed.plan.planned_purchase_year,
    plannedPurchaseMonth: parsed.plan.planned_purchase_month,
    listPrice: parsed.plan.list_price,
    purchasePrice: parsed.plan.purchase_price,
    productUrl: parsed.plan.product_url,
    dealPeriod: parsed.plan.deal_period,
  };
  await tx.plan.upsert({
    where: { itemId: BigInt(itemId) },
    update: data,
    create: { itemId: BigInt(itemId), ...data },
  });
}

async function lookupShippingFee(
  tx: Tx,
  serviceId: number | null,
  sizeId: number | null,
): Promise<number | null> {
  if (serviceId == null || sizeId == null) return null;
  const r = await tx.shippingFee.findUnique({
    where: { shippingServiceId_shippingSizeId: { shippingServiceId: serviceId, shippingSizeId: sizeId } },
    select: { fee: true },
  });
  return r ? r.fee.toNumber() : null;
}

async function lookupPlatformFeeRate(tx: Tx, platformId: number | null): Promise<number | null> {
  if (platformId == null) return null;
  const r = await tx.platform.findUnique({ where: { id: platformId }, select: { feeRate: true } });
  return r ? r.feeRate.toNumber() : null;
}

async function upsertListing(tx: Tx, itemId: number, parsed: ParsedForm) {
  if (parsed.status !== "listed") {
    await tx.listing.deleteMany({ where: { itemId: BigInt(itemId) } });
    return;
  }
  const shippingId = await resolveShippingId(tx, parsed.listing.service_id, parsed.listing.size_id);
  // Prisma の対話トランザクションは逐次実行が安全なため Promise.all は使わない。
  const shipping_fee = await lookupShippingFee(tx, parsed.listing.service_id, parsed.listing.size_id);
  const platform_fee_rate = await lookupPlatformFeeRate(tx, parsed.listing.platform_id);

  const calc = computeListingMetrics({
    selling_price: parsed.listing.selling_price,
    packaging_cost: parsed.listing.packaging_cost,
    work_time_hours: parsed.listing.work_time_hours,
    labor_rate: parsed.listing.labor_rate,
    shipping_fee,
    platform_fee_rate,
  });

  const data = {
    shippingId,
    platformId: parsed.listing.platform_id,
    quantity: parsed.listing.quantity,
    sellingPrice: parsed.listing.selling_price,
    packagingCost: parsed.listing.packaging_cost,
    workTimeHours: parsed.listing.work_time_hours,
    laborRate: parsed.listing.labor_rate,
    sellingFee: calc.selling_fee,
    workTimeCost: calc.work_time_cost,
    operatingBenefit: calc.operating_benefit,
    ordinaryProfit: calc.ordinary_profit,
    isListing: calc.is_listing,
  };
  await tx.listing.upsert({
    where: { itemId: BigInt(itemId) },
    update: data,
    create: { itemId: BigInt(itemId), ...data },
  });
}

function revalidateAll(itemId?: number) {
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/items/planned");
  revalidatePath("/items/selling");
  revalidatePath("/dashboard");
  if (itemId != null) {
    revalidatePath(`/items/${itemId}`);
    revalidatePath(`/items/${itemId}/edit`);
  }
}

export async function createItem(formData: FormData) {
  const parsed = parseForm(formData);
  if (!parsed.name) redirect("/items/new?error=name-required");

  const user = await authed();

  let newId: number;
  try {
    newId = await withUser(user.sub, async (tx) => {
      const categoryIds = await resolveCategoryIds(tx, parsed, user.sub);

      const row = await tx.item.create({
        data: {
          userId: user.sub,
          status: parsed.status,
          name: parsed.name,
          janCode: parsed.jan_code,
          quantity: parsed.quantity,
          notes: parsed.notes,
          actualPrice: parsed.actual_price,
          purchasedAt: parsed.purchased_at ? new Date(parsed.purchased_at) : null,
        },
      });
      const itemId = Number(row.id);

      await syncItemCategories(tx, itemId, categoryIds);
      await upsertPlan(tx, itemId, parsed);
      await upsertListing(tx, itemId, parsed);

      if (parsed.image) {
        const key = await uploadImage(parsed.image, user.sub, itemId);
        await tx.item.update({ where: { id: row.id }, data: { imageUrl: key } });
      }

      return itemId;
    });
  } catch (e) {
    redirect(`/items/new?error=${encodeURIComponent((e as Error).message)}`);
  }

  revalidateAll(newId);
  redirect(`/items/${newId}`);
}

export async function updateItem(itemId: number, formData: FormData) {
  const parsed = parseForm(formData);
  if (!parsed.name) redirect(`/items/${itemId}/edit?error=name-required`);

  const user = await authed();

  try {
    await withUser(user.sub, async (tx) => {
      const categoryIds = await resolveCategoryIds(tx, parsed, user.sub);

      const existing = await tx.item.findFirst({
        where: { id: BigInt(itemId) },
        select: { imageUrl: true },
      });
      const currentKey = existing?.imageUrl ?? null;

      let nextImageUrl: string | null | undefined;
      if (parsed.delete_image && currentKey) {
        await removeImage(currentKey);
        nextImageUrl = null;
      }
      if (parsed.image) {
        if (currentKey) await removeImage(currentKey);
        nextImageUrl = await uploadImage(parsed.image, user.sub, itemId);
      }

      await tx.item.updateMany({
        where: { id: BigInt(itemId) },
        data: {
          status: parsed.status,
          name: parsed.name,
          janCode: parsed.jan_code,
          quantity: parsed.quantity,
          notes: parsed.notes,
          actualPrice: parsed.actual_price,
          purchasedAt: parsed.purchased_at ? new Date(parsed.purchased_at) : null,
          ...(nextImageUrl !== undefined ? { imageUrl: nextImageUrl } : {}),
        },
      });

      await syncItemCategories(tx, itemId, categoryIds);
      await upsertPlan(tx, itemId, parsed);
      await upsertListing(tx, itemId, parsed);
    });
  } catch (e) {
    redirect(`/items/${itemId}/edit?error=${encodeURIComponent((e as Error).message)}`);
  }

  revalidateAll(itemId);
  redirect(`/items/${itemId}`);
}

export async function deleteItem(itemId: number) {
  const user = await authed();

  await withUser(user.sub, async (tx) => {
    const existing = await tx.item.findFirst({
      where: { id: BigInt(itemId) },
      select: { imageUrl: true },
    });
    if (existing?.imageUrl) await removeImage(existing.imageUrl);
    await tx.item.deleteMany({ where: { id: BigInt(itemId) } });
  });

  revalidateAll();
  redirect("/items");
}
```
**逐行解説（ブロックごと）**
- **import / STATUSES / ParsedForm**: 依存(redirect・revalidatePath・認証・DB(`withUser`/`Tx`)・image・利益計算・型)を読み込み。Prismaはモデルアクセサ(`tx.item`等)で書くため、テーブルオブジェクトのimportは不要。`STATUSES`は入力で受け付ける状態。`ParsedForm`は整形後フォームの型(共通項目＋`plan`＋`listing`)。
- **intOrNull / nonNegIntOrNull / strOrNull**: フォームの空欄をNULLに、数値/非負整数/文字列へ整える定型ヘルパ。
- **parseForm**: フォーム全体を`ParsedForm`へ。`status`は`STATUSES`に無ければ`owned`、`category_ids`は数値化＋正の数のみ、`new_category_names`はカンマ分割、`quantity`は正整数or1、`image`は`File`かつサイズ>0のみ。`plan`/`listing`も各ヘルパで整形(`planned_purchase_month`は1〜12、`work_time_hours`は0以上の小数)。
- **authed**: `getCurrentUser`が無ければ`/login`。あればユーザを返す。
- **uploadImage**: 拡張子＋`userId/itemId/時刻.ext`のキーで`putImage`にS3保存しキーを返す。**removeImage**: `deleteImage`の薄いラッパ。
- **resolveShippingId**: (service,size)に対応する`shipping`行を`tx.shipping.upsert`で取得/作成し`id`(BigInt)を返す(出品の送料計算用)。
- **resolveCategoryIds**: 新規カテゴリ名を`findFirst`→無ければ`create`で確保し、選択済みIDと合わせて返す(`Set`で重複排除。Prismaの対話TXは失敗で中断するため check→create 方式)。
- **syncItemCategories**: 中間表を置換(`deleteMany`→`createMany`)。`itemId`は`BigInt(itemId)`。
- **upsertPlan**: `status`が`planned`のときだけ`tx.plan.upsert({ where:{itemId}, update, create })`(あれば更新/なければ挿入)、それ以外は`deleteMany`。
- **lookupShippingFee / lookupPlatformFeeRate**: 送料・手数料率をマスタから`findUnique`で取得し`Decimal.toNumber()`で数値化。
- **upsertListing**: `status`が`listed`のときだけ、送料・手数料率を引いて`computeListingMetrics`で利益計算し、結果を`tx.listing.upsert`。それ以外は`deleteMany`。Prismaの対話TXは逐次が安全なので`Promise.all`は使わない。
- **revalidateAll**: 一覧・ダッシュボード等のキャッシュを無効化(更新を反映)。
- **createItem**: `parseForm`→名前必須チェック→`authed`→`withUser`内で「カテゴリ確定→`tx.item.create`(作成行が返る)→`itemId = Number(row.id)`→中間表/plan/listing同期→画像があればS3保存して`tx.item.update`で`image_url`更新」。`catch`でエラーをURLに載せ、成功で`revalidateAll`＋詳細へ。
- **updateItem**: `createItem`同様だが、既存`image_url`を`findFirst`で読み`delete_image`/新画像でS3を消し/差し替え、`tx.item.updateMany({ where:{ id: BigInt(itemId) }, data })`で更新（404にせず該当のみ更新）。`...(nextImageUrl !== undefined ? { imageUrl: nextImageUrl } : {})`は**画像変更時だけ`imageUrl`を更新**する条件スプレッド。
- **deleteItem**: 画像があればS3削除→`tx.item.deleteMany({ where:{ id: BigInt(itemId) } })`で行削除(関連は`on delete cascade`)。RLSで他人の行は対象外。

---

## Step 8. 型チェックで確認

```bash
npx tsc --noEmit
```
**逐行解説**
- 付録D（schema.prisma/serialize/types）も作成済みで`npx prisma generate`を実行済みなら、ここまでのファイルが型エラーなく通る。エラーが出たら、`@prisma/client`が生成済みか・import先（`@/db/client`等）のパスが正しいかを確認。
- `listing-calc.ts`（`computeListingMetrics`）など未収録の依存はリポジトリ参照。

---

## 残りのファイル
画面(`app/*/page.tsx`)・UI部品(`components/*`)・`lib/listing-calc.ts`・`lib/format.ts`・`mypage`/`import`/`export`の各処理は、[付録D](setup-guide-data.md)とリポジトリの実ファイルを参照してください。
