# 付録C: REST API実装手順（/api/v1）＋逐行解説

[setup-guide.md](setup-guide.md) の補足。外部向けREST API（items / categories / export）を**ファイル作成→確認**の手順形式で実装し、各コードブロックの直後に**逐行解説**を付けます。仕様は[APIリファレンス](api-reference.md)。

- **前提**: 7〜9章のアプリ（DB/認証/RLS）が動作。Cognito稼働。
- **方式**: REST、認可は`Authorization: Bearer <Cognito IDトークン>`、配置はNext.jsのRoute Handler。
- 既存の`db/client.ts`(`withUser`)・`cognito.ts`(`verifyIdToken`)・`serialize.ts`を再利用。

### Route Handlerの基本（最初に1回）
- `src/app/api/<パス>/route.ts`にHTTPメソッド名(`GET`/`POST`/`PUT`/`DELETE`)の関数を`export`すると、その関数がそのパスのAPIになる。
- 引数は`req: NextRequest`(要求)。動的セグメント(`[id]`)は第2引数`ctx.params`(Next 15ではPromise)で受け取る。
- 戻り値は`NextResponse`(JSON等)。
- `export const dynamic = "force-dynamic"`: キャッシュせず毎回実行(認証依存のため)。

---

## Step 1. middleware を API 対象外にする
```diff
 export const config = {
   matcher: [
-    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
+    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
   ],
 };
```
**逐行解説**
- `matcher`の正規表現の否定先読み`(?!...)`に`api`を追加。これで**`/api/*`はmiddlewareを通らない**。
- 理由: middlewareは未ログインの保護ルートを`/login`へ**HTMLリダイレクト**する。APIに適用するとJSONでなくリダイレクトが返ってしまう。APIは各ハンドラがBearer検証して`401 JSON`を返すべきなので除外する。

---

## Step 2. Bearer 認証ヘルパ `src/lib/auth/api.ts`
```ts
import { NextResponse, type NextRequest } from "next/server";
import { verifyIdToken } from "./cognito";

export type ApiUser = { sub: string; email: string };

export async function getApiUser(req: NextRequest): Promise<ApiUser | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const payload = await verifyIdToken(token);
    return { sub: payload.sub, email: payload.email as string };
  } catch {
    return null;
  }
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
export function unauthorized(): NextResponse { return jsonError(401, "unauthorized"); }
export function badRequest(message: string): NextResponse { return jsonError(400, message); }

const CLIENT_INPUT_DATABASE_ERROR_CODES = new Set([
  "P2000", "P2002", "P2003", "P2004", "P2006", "P2007",
  "P2011", "P2014", "P2019", "P2020", "P2033",
]);

export function dbErrorResponse(error: unknown): NextResponse {
  console.error("REST APIのデータ処理に失敗しました。", error);
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : null;
  if (typeof code === "string" && CLIENT_INPUT_DATABASE_ERROR_CODES.has(code)) {
    return jsonError(400, "invalid request");
  }
  return jsonError(500, "internal error");
}
```
**逐行解説**
- `ApiUser`型: APIで使うユーザ情報(`sub`/`email`)。
- `getApiUser(req)`: **Bearer認証の中核**。
  - `req.headers.get("authorization")`: `Authorization`ヘッダを取得。
  - `if (!header || !header.startsWith("Bearer "))`: 無い/`Bearer `で始まらなければ`null`。
  - `header.slice("Bearer ".length).trim()`: `"Bearer "`を除いたトークン部分を取り出す。
  - `await verifyIdToken(token)`: 既存の検証器(`cognito.ts`)でIDトークンを検証。`sub`/`email`を返す。
  - `catch { return null }`: 不正/失効は`null`(呼び元が401を返す)。
- `jsonError(status, message)`: `NextResponse.json({ error }, { status })`で**統一エラーJSON**。
- `unauthorized()`=401、`badRequest(msg)`=400 の薄いラッパ。
- `dbErrorResponse(error)`: DB例外の詳細をサーバーログに残し、クライアントへは固定メッセージだけを返す。入力値や整合性制約に対応する明示済みコードは`400 invalid request`、接続・トランザクション・実装上の障害などは`500 internal error`。

---

## Step 3. items 入力変換と永続化境界

JSON の検証・整形は、外部形式を内部形式へ変換する adapter に置きます。

`src/features/items/application/item-api-command-input.ts`と`src/features/items/adapters/parse-item-api-body.ts`:

```ts
// 公開contractの抜粋。検証処理の本体はこのファイルを参照してください。
import type { ItemStatus } from "@/features/items/domain/status";

export type ItemApiCommandInput = Readonly<{
  status: ItemStatus;
  name: string;
  janCode: string | null;
  quantity: number;
  notes: string | null;
  actualPrice: number | null;
  purchasedAt: string | null;
  categoryIds: readonly number[];
}>;

export function parseItemApiBody(body: unknown):
  | { ok: true; value: ItemApiCommandInput }
  | { ok: false; error: string } {
  // name、status、数値境界、category_idsを検証し、snake_caseをcamelCaseへ変換する。
}
```

**ポイント**
- `parseItemApiBody(body)`: 受け取ったJSONを検証・整形する純粋関数。戻り値は`ok`で判定できる共用体です。
- `ItemApiCommandInput`: application層に置くAPI更新専用の読み取り専用型です。フォーム入力用の型と混同しません。
- `status`: 未指定は`owned`。指定時はドメイン層の`isItemStatus`で検証します。
- `quantity`、`actual_price`、`category_ids`: 共通の数値検証関数でDB上限を含めて検証します。
- `purchased_at`: 共通の日付検証関数で`YYYY-MM-DD`形式と暦上の実在日を検証します。日時、存在しない日付、非文字列はrouteから400で返します。
- `category_ids`: 配列の各要素を正の整数へ変換します。

DBへ依存する一覧・詳細検索は、入力変換と分けて専用repositoryへ置きます。

`src/features/items/application/item-api-query-ports.ts`:

```ts
import type { ItemApiData } from "@/features/items/application/item-api-data";
import type { ItemStatus } from "@/features/items/domain/status";

export interface ItemApiQueryRepository {
  findMany(userId: string, status: ItemStatus | null): Promise<readonly ItemApiData[]>;
  findById(userId: string, itemId: number): Promise<ItemApiData | null>;
}
```

`prisma-item-api-query-repository.ts`がRLSトランザクション、Prisma検索、カテゴリIDの一括取得、API形式への変換を担当します。routeは認証・入力検証・HTTP応答だけを担当し、use caseを介してrepositoryを呼びます。

作成・更新も同様に、`item-api-command-ports.ts`と`item-api-command-use-cases.ts`をapplication層、`prisma-item-api-command-repository.ts`をinfrastructure層へ置きます。画面用writeは画像・plan・listingも同期するため再利用せず、REST v1のコア項目とカテゴリだけを扱う専用境界にします。

削除は画面とRESTで同じ契約なので、`item-delete-ports.ts`と`item-delete-use-case.ts`をapplication層、`prisma-item-delete-repository.ts`をinfrastructure層へ置いて共有します。DB削除を確定してからS3画像を後処理し、外部I/OをDBトランザクションの外へ分離します。

---

## Step 4. items 一覧/作成 `src/app/api/v1/items/route.ts`
```ts
import { NextResponse, type NextRequest } from "next/server";
import { getApiUser, unauthorized, badRequest, dbErrorResponse } from "@/lib/auth/api";
import { parseItemApiBody } from "@/features/items/adapters/parse-item-api-body";
import { createApiItemUseCase } from "@/features/items/application/item-api-command-use-cases";
import { loadApiItemsUseCase } from "@/features/items/application/item-api-query-use-cases";
import { isItemStatus, type ItemStatus } from "@/features/items/domain/status";
import { prismaItemApiCommandRepository } from "@/features/items/infrastructure/prisma-item-api-command-repository";
import { prismaItemApiQueryRepository } from "@/features/items/infrastructure/prisma-item-api-query-repository";

export const dynamic = "force-dynamic";

const itemApiQueryDependencies = Object.freeze({
  repository: prismaItemApiQueryRepository,
});
const itemApiCommandDependencies = Object.freeze({
  repository: prismaItemApiCommandRepository,
});

export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();

  const statusParam = req.nextUrl.searchParams.get("status");
  let status: ItemStatus | null = null;
  if (statusParam !== null) {
    if (!isItemStatus(statusParam)) {
      return badRequest(`invalid status: ${statusParam}`);
    }
    status = statusParam;
  }

  try {
    const items = await loadApiItemsUseCase(itemApiQueryDependencies, {
      userId: user.sub,
      status,
    });
    return NextResponse.json({ items });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
```
**逐行解説（このGETで「APIハンドラの定番形」を理解する）**
- `export const dynamic = "force-dynamic"`: 毎回サーバ実行(キャッシュ無効)。
- `const user = await getApiUser(req); if (!user) return unauthorized();`: **全ハンドラ共通の入口**。Bearer検証、失敗で401。
- `req.nextUrl.searchParams.get("status")`: クエリ`?status=`を取得。
- `isItemStatus(statusParam)`: ドメイン層の状態判定を使い、不正statusは400。
- `loadApiItemsUseCase(...)`: 認証済みユーザーIDとstatusをquery境界へ渡す。RLS、`deletedAt: null`、カテゴリIDの一括取得、API形式への変換はrepository内で行う。
- `return NextResponse.json({ items })`: 一覧をJSONで返す。
- `catch (e) { return dbErrorResponse(e) }`: DB例外を400/500に振り分け。

```ts
export async function POST(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();

  let body: unknown;
  try { body = await req.json(); } catch { return badRequest("invalid JSON body"); }
  const parsed = parseItemApiBody(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const result = await createApiItemUseCase(itemApiCommandDependencies, {
      actor: { userId: user.sub, email: user.email },
      input: parsed.value,
    });
    if (result.status === "invalid_categories") {
      return badRequest("invalid category_ids");
    }
    return NextResponse.json({ item: result.item }, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
```
**逐行解説**
- `let body; try { body = await req.json() } catch { return badRequest(...) }`: リクエストボディをJSONとして読む。壊れていれば400。
- `const parsed = parseItemApiBody(body); if (!parsed.ok) return badRequest(parsed.error)`: 検証。失敗で400。
- `createApiItemUseCase(...)`: 認証済みユーザーと検証済み入力をcommand境界へ渡す。
- `prismaItemApiCommandRepository`: 1つのRLSトランザクションでカテゴリ可視性検証、`users`行の自動確保、item作成、カテゴリ紐付け、API DTO変換を行う。利用できるのはプリセットまたは自分のカテゴリだけ。
- `result.status === "invalid_categories"`: 存在しないカテゴリと他ユーザーの非公開カテゴリを区別せず**400**にし、情報漏えいを防ぐ。
- `NextResponse.json({ item: result.item }, { status: 201 })`: **201 Created**で返す。

---

## Step 5. items 取得/更新/削除 `src/app/api/v1/items/[id]/route.ts`
```ts
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
```
**逐行解説**: パスの`id`文字列を正の整数に。不正なら`null`(呼び元が400)。

```ts
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  const id = parseId((await ctx.params).id);
  if (id == null) return badRequest("invalid id");
  try {
    const item = await loadApiItemUseCase(itemApiQueryDependencies, {
      userId: user.sub,
      itemId: id,
    });
    if (!item) return jsonError(404, "not found");
    return NextResponse.json({ item });
  } catch (e) { return dbErrorResponse(e); }
}
```
**逐行解説**
- 第2引数`ctx: { params: Promise<{ id: string }> }`: 動的セグメント。Next 15では`params`がPromiseなので`await ctx.params`。
- `const id = parseId((await ctx.params).id)`: idを整数化。不正なら400。
- `loadApiItemUseCase(...)`: 1件取得をquery repositoryへ委譲。RLSで他人の行は見えないので、無ければ`null`→**404**。
- repositoryが`toItem`変換と`category_ids`付与を行い、routeは`{ item }`で返す。

```ts
export async function PUT(req, ctx) {
  /* getApiUser → parseId → req.json → parseItemApiBody */
  const result = await updateApiItemUseCase(itemApiCommandDependencies, {
    userId: user.sub,
    itemId: id,
    input: parsed.value,
  });
  if (result.status === "not_found") return jsonError(404, "not found");
  if (result.status === "invalid_categories") return badRequest("invalid category_ids");
  return NextResponse.json({ item: result.item });
}
```
**逐行解説**
- 入口はPOSTと同様(認証・id・body検証)。
- `updateApiItemUseCase(...)`へユーザーID、item ID、検証済み入力を渡す。
- repositoryはRLS下で存在確認とカテゴリ可視性検証を行い、コア項目とカテゴリだけを同一トランザクションで更新する。画像・plan・listingは変更しない。
- 他人または存在しないitemは`not_found`→**404**。利用できないカテゴリは`invalid_categories`→**400**となり、既存データは変更しない。更新成功時はimmutableなAPI DTOを返す。

```ts
export async function DELETE(req, ctx) {
  const result = await deleteItemUseCase(itemDeleteDependencies, {
    userId: user.sub,
    itemId: id,
  });
  if (result.type === "not_found") return jsonError(404, "not found");
  return new NextResponse(null, { status: 204 });
}
```
**逐行解説**
- `deleteItemUseCase(...)`: repositoryへDB削除を依頼し、成功後に返された以前の画像キーをS3から削除する。DBトランザクション中にS3通信は行わない。
- repositoryの`tx.item.deleteMany(...)`: 行削除（関連は`on delete cascade`）。RLSにより他人の行は見えず、`not_found`となる。
- S3削除はベストエフォート。失敗はログへ通知するが、すでに確定したDB削除は取り消さず**204**を返す。未参照画像の再試行・定期清掃は将来の拡張点。
- 対象が無ければ404、成功は**204 No Content**(本文なし)。

---

## Step 6. categories `route.ts` / `[id]/route.ts`
```ts
export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  try {
    const result = await withUser(user.sub, async (tx) => {
      const rows = await tx.category.findMany();
      return rows.map(toCategory);
    });
    return NextResponse.json({ categories: result });
  } catch (e) { return dbErrorResponse(e); }
}
```
**逐行解説**
- `tx.category.findMany()`: RLSの`categories_select`(`is_preset or user_id=自分`)により、**プリセット＋自分のカテゴリ**だけが返る。
- `rows.map(toCategory)`: API形に変換して返す。

```ts
export async function POST(req: NextRequest) {
  /* getApiUser, req.json */
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return badRequest("name is required");
  if (b.color !== undefined && typeof b.color !== "string") return badRequest("color must be a string");
  const color = typeof b.color === "string" && b.color.trim() ? b.color.trim() : undefined;
  try {
    const { category, created } = await withUser(user.sub, async (tx) => {
      await tx.user.upsert({ where: { id: user.sub }, update: {}, create: { id: user.sub, email: user.email, username: user.email.split("@")[0] } });
      // 同名(user_id, name)があればそれを返す。無ければ作成。
      const existing = await tx.category.findFirst({ where: { userId: user.sub, name } });
      if (existing) return { category: toCategory(existing), created: false };
      const row = await tx.category.create({ data: { userId: user.sub, name, ...(color ? { color } : {}) } });
      return { category: toCategory(row), created: true };
    });
    return NextResponse.json({ category }, { status: created ? 201 : 200 });
  } catch (e) { return dbErrorResponse(e); }
}
```
**逐行解説**
- `name`必須、`color`は任意(文字列のみ)。`...(color ? { color } : {})`は**色指定があるときだけ`color`を含める**(無ければDB既定色)。
- `users`行を upsert で確保(FK対策)。
- **check→create**: `findFirst`で同名を探し、あれば`created:false`で返す。無ければ`create`で作り`created:true`。（Prismaの対話TXは衝突例外で中断するため、`onConflict`相当は使わず先に確認する）
- `status: created ? 201 : 200`: 新規は201、既存返却は200。

```ts
// categories/[id]/route.ts
export async function DELETE(req, ctx) {
  const deleted = await withUser(user.sub, async (tx) => {
    const res = await tx.category.deleteMany({ where: { id } });
    return res.count > 0;
  });
  if (!deleted) return jsonError(404, "not found");
  return new NextResponse(null, { status: 204 });
}
```
**逐行解説**
- `tx.category.deleteMany({ where: { id } })`: 削除し`count`で判定。RLS`categories_delete`(`user_id=自分`)により、**プリセット(user_id null)や他人の行は対象外**＝0件→404。
- 自分のカテゴリが消えれば204。

---

## Step 7. export `src/app/api/v1/export/route.ts`
```ts
export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  try {
    const backup = await exportItemsUseCase(itemExportDependencies, {
      userId: user.sub,
    });
    return NextResponse.json(backup);
  } catch (e) { return dbErrorResponse(e); }
}
```
**逐行解説**
- `exportItemsUseCase(...)`: バックアップ対象の取得と`version`/`exported_at`の組み立てをapplication層へ委譲する。
- `prismaItemExportRepository`: RLS下で自作カテゴリと全アイテムを読み、各アイテムに`category_ids`を付与する。
- routeはBearer認証とHTTP応答だけを担当する。

---

## Step 8. 型チェック & 動作確認
```bash
npx tsc --noEmit
npm run dev
```
**逐行解説**
- `npx tsc --noEmit`: 型エラーが無いか確認(出力なし)。
- `npm run dev`: ローカル起動。別ターミナルでトークン取得＋curl(下記)。

```bash
CLIENT_ID=$(aws ssm get-parameter --region ap-northeast-1 --name /mono-log/cognito/client_id --query Parameter.Value --output text)
TOKEN=$(aws cognito-idp initiate-auth --region ap-northeast-1 \
  --auth-flow USER_PASSWORD_AUTH --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME=you@example.com,PASSWORD='YourPassw0rd' \
  --query 'AuthenticationResult.IdToken' --output text)
BASE=http://localhost:3000/api/v1
curl -s -X POST "$BASE/items" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"api-test","status":"owned","quantity":1}'
curl -s "$BASE/items" -H "Authorization: Bearer $TOKEN"
```
**逐行解説**
- `CLIENT_ID=$(...)`: SSMからCognitoクライアントIDを取得。
- `TOKEN=$(aws cognito-idp initiate-auth ...)`: email/passwordでログインし**IDトークン**を取り出す(`--query 'AuthenticationResult.IdToken'`)。
- `curl -X POST .../items -H "Authorization: Bearer $TOKEN" -d '{...}'`: 作成。`-H "Content-Type: application/json"`でJSON指定。
- `curl .../items -H "Authorization: Bearer $TOKEN"`: 一覧取得。

本番反映は[12章のデプロイ](setup-guide.md#12-デプロイビルド--ecr--コンテナ起動)。

---

## まとめ・制約
- 仕様とcurl例: [APIリファレンス](api-reference.md)。
- v1未対応(将来): 画像アップロード・plan/listingのAPI公開・CORS・ページング・レート制限。
