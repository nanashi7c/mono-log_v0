# REST API リファレンス（/api/v1）

mono-log の外部向け REST API。Next.js の Route Handler（`src/app/api/v1/*`）として実装され、アプリ本体と同じコンテナで動きます。

- **ベースURL**: `https://<CloudFrontドメイン>/api/v1`（ローカルは `http://localhost:3000/api/v1`）
- **形式**: リクエスト/レスポンスともに JSON
- **認可**: `Authorization: Bearer <Cognito ID トークン>`。RLS により**自分のデータのみ**操作可能
- **スコープ(v1)**: items / categories / export。画像アップロードと plan・listing は v1 では非対応（画面からのみ）

### レート制限

`/api/v1`は接続元IPごとに1分間120リクエストまで受け付けます。上限を超えた場合は`429 Too Many Requests`を返し、再試行までの秒数を`Retry-After`ヘッダーで通知します。カウンターは現在の単一EC2プロセス内で管理され、アプリの再起動時に初期化されます。

---

## 認証

Cognito でログインして **ID トークン**を取得し、`Authorization` ヘッダに付けます。

### トークン取得（例: AWS CLI）
```bash
CLIENT_ID=$(aws ssm get-parameter --region ap-northeast-1 --name /mono-log/cognito/client_id --query Parameter.Value --output text)

TOKEN=$(aws cognito-idp initiate-auth \
  --region ap-northeast-1 \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME=you@example.com,PASSWORD='YourPassw0rd' \
  --query 'AuthenticationResult.IdToken' --output text)
```

> ID トークンは約1時間で失効します。失効後は同様に `REFRESH_TOKEN_AUTH`（または再ログイン）で取り直してください。アプリのブラウザ用とは別に、APIクライアントは自前でトークン管理します。

### 呼び出し例
```bash
BASE=https://<CloudFrontドメイン>/api/v1
curl -s "$BASE/items" -H "Authorization: Bearer $TOKEN"
```

---

## エラー形式
すべて JSON で `{ "error": "<メッセージ>" }`。主なステータス:

| ステータス | 意味 |
|---|---|
| 400 | リクエスト不正（JSON不正・必須項目欠落・値が不正・整合性制約違反） |
| 401 | 未認証（Bearer 無し/不正/失効） |
| 404 | 対象が存在しない（または他人の行で見えない） |
| 500 | サーバ内部エラー |

入力検証で判定できるエラーは具体的な安全なメッセージを返します。DB制約違反の詳細やSQL・Prismaなどの内部情報は返さず、入力起因のDBエラーは`invalid request`、それ以外は`internal error`とします。詳細はサーバーログにだけ記録します。

---

## エンドポイント一覧

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/items` | アイテム一覧（`?status=` で絞り込み可） |
| POST | `/items` | アイテム作成 |
| GET | `/items/{id}` | アイテム取得 |
| PUT | `/items/{id}` | アイテム更新 |
| DELETE | `/items/{id}` | アイテム削除（画像は削除後に S3 から後処理） |
| GET | `/categories` | カテゴリ一覧（プリセット＋自分） |
| POST | `/categories` | カテゴリ作成 |
| DELETE | `/categories/{id}` | 自分のカテゴリ削除 |
| GET | `/export` | 自分の全データを JSON で取得 |

---

## items

### アイテムの形
```jsonc
{
  "id": 12,
  "user_id": "c7242aa8-...",
  "status": "owned",          // planned | owned | listed | sold
  "name": "テスト商品",
  "image_url": null,           // 画像キー（APIからは設定不可・画面で設定）
  "jan_code": null,
  "quantity": 1,
  "notes": null,
  "actual_price": null,        // 0以上の整数 or null
  "purchased_at": null,        // "YYYY-MM-DD" or null
  "deleted_at": null,
  "created_at": "2026-06-12T...Z",
  "updated_at": "2026-06-12T...Z",
  "category_ids": [3, 5]
}
```

### GET /items
クエリ: `status`（任意。`planned|owned|listed|sold`）。
```bash
curl -s "$BASE/items?status=owned" -H "Authorization: Bearer $TOKEN"
```
レスポンス `200`:
```json
{ "items": [ { "id": 12, "name": "...", "category_ids": [3] } ] }
```

### POST /items
ボディ（`name`必須。他は任意）:
```json
{
  "name": "テスト商品",
  "status": "owned",
  "quantity": 1,
  "jan_code": null,
  "notes": null,
  "actual_price": 1200,
  "purchased_at": "2026-06-01",
  "category_ids": [3, 5]
}
```
```bash
curl -s -X POST "$BASE/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"テスト商品","status":"owned","quantity":1}'
```
レスポンス `201`: `{ "item": { ... } }`

`category_ids`に指定できるのは、プリセットカテゴリまたは認証ユーザー自身が作成したカテゴリだけです。存在しないIDや他ユーザーの非公開カテゴリIDを含む場合は、存在・所有者を区別せず`400 { "error": "invalid category_ids" }`を返し、商品は作成しません。
`purchased_at`は`YYYY-MM-DD`形式の実在する日付、`null`、空文字だけを受け付けます。日時形式や存在しない日付は`400 { "error": "purchased_at must be YYYY-MM-DD or null" }`となります。
過去のデータに利用できないカテゴリとの関連が残っていても、そのIDはGETレスポンスへ含めません。

### GET /items/{id}
```bash
curl -s "$BASE/items/12" -H "Authorization: Bearer $TOKEN"
```
`200`: `{ "item": { ... } }` / 無ければ `404`

### PUT /items/{id}
ボディは POST と同形（`name`必須）。`category_ids`は**置換**（指定した集合に入れ替え）。
```bash
curl -s -X PUT "$BASE/items/12" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"改名","status":"listed","quantity":2,"category_ids":[3]}'
```
`200`: `{ "item": { ... } }` / 無ければ `404`。利用できない`category_ids`を含む場合は`400`となり、商品本体と既存カテゴリは変更されません。

### DELETE /items/{id}
```bash
curl -s -X DELETE "$BASE/items/12" -H "Authorization: Bearer $TOKEN" -i
```
`204`（本文なし）/ 無ければ `404`。DB上のアイテムを削除した後、画像があれば S3 から削除します。S3の後処理に失敗してもDB削除は取り消さず`204`を返し、失敗をサーバーログへ記録します。その場合は未参照の画像がS3に残る可能性があります。

---

## categories

### カテゴリの形
```jsonc
{
  "id": 3,
  "user_id": "c7242aa8-...", // プリセットは null
  "name": "ガジェット",
  "color": "#94a3b8",
  "is_preset": false,
  "created_at": "...",
  "updated_at": "..."
}
```

### GET /categories
プリセット＋自分のカテゴリを返す。
```bash
curl -s "$BASE/categories" -H "Authorization: Bearer $TOKEN"
```
`200`: `{ "categories": [ ... ] }`

### POST /categories
ボディ: `{ "name": "新カテゴリ", "color": "#ff0000" }`（`name`必須・`color`任意）。
同名が既にあればそれを返す（その場合 `200`、新規作成は `201`）。
```bash
curl -s -X POST "$BASE/categories" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"新カテゴリ"}'
```
`201`/`200`: `{ "category": { ... } }`

### DELETE /categories/{id}
自分のカテゴリのみ削除可（プリセットは対象外＝`404`）。
```bash
curl -s -X DELETE "$BASE/categories/3" -H "Authorization: Bearer $TOKEN" -i
```
`204` / 対象なし `404`

---

## export

### GET /export
自分の全データ（自作カテゴリ＋全アイテム）を JSON で返す。
```bash
curl -s "$BASE/export" -H "Authorization: Bearer $TOKEN"
```
`200`:
```json
{
  "version": 1,
  "exported_at": "2026-06-12T...Z",
  "categories": [ ... ],
  "items": [ { ...item, "category_ids": [3] } ]
}
```

---

## 設計メモ・制約（v1）
- **認証**: Cognito の**IDトークン**を Bearer に使用（`aws-jwt-verify` で検証、`tokenUse: "id"`）。`sub` を RLS の `app.current_user_id()` に流し込み、自分の行だけに制限。
- **users 行の自動確保**: 書き込み系(POST)では FK のため `users` 行を Prisma の `upsert` で先に確保する（Web ログイン未経験のAPI専用クライアントでも動く）。
- **middleware 対象外**: `/api/*` は `middleware` のリダイレクト対象から除外済み（Bearer クライアントに `/login` リダイレクトでなく JSON を返すため）。
- **未対応(将来)**: 画像アップロード（multipart/base64）、plan・listing のAPI公開、CORS（ブラウザの別オリジンから叩く場合に必要）、ページング、レート制限。必要になったら追加します。
