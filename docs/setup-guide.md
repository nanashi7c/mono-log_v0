# mono-log セットアップ手順書（ゼロから本番デプロイまで）

開発・インフラ未経験の新卒メンバーが、空のフォルダから本番デプロイまで再現できるようにまとめた手順書です。最終構成（AWSネイティブ）のみを対象とし、過去のSupabase版には触れません。

> 注: このリポジトリはWindows環境を前提に整備されています（PowerShellスクリプト+git bash併用）。Mac/Linuxでも考え方は同じですが、`.ps1`の箇所は適宜読み替えてください。

---

## 0. この手順書の歩き方

上から順に実施すれば動きます。大きな流れは次の3段です。

1. **ローカルで動かす**（自分のPCで開発・確認）
2. **インフラを作る**（AWS上に土台をTerraformで構築）
3. **デプロイする**（アプリをコンテナにして本番で公開）

各章の最後に「ここまでで何ができたか」を書いています。詰まったら15章のトラブルシューティングを見てください。

**付録（ゼロから書き起こす場合はこちら）**
- [付録A: Terraform手順](setup-guide-terraform.md) — 空の`infra/`から作る手順形式（ファイル作成→plan→apply）。全`.tf`の中身入り（10章の詳細）
- [付録B: 中核アプリ実装手順](setup-guide-appcode.md) — 認証/DB/画像/actionsの中核ファイルをファイル作成→型チェックの手順形式で（完全コード＋逐行解説）
- [付録D: データ基盤の実装手順](setup-guide-data.md) — マイグレーションSQL・types/schema/serializeを手順形式で解説し、本番DB適用は実装の正本である`infra/migrate.ps1`へ案内
- [付録C: REST API実装手順](setup-guide-api.md) — 外部向けREST API(`/api/v1`)をファイル作成→確認の手順形式で実装（全コード入り）
- [APIリファレンス](api-reference.md) — 上記APIの仕様（エンドポイント・curl例）

> 付録のコードブロックは、同型の繰り返し（似たSSMパラメータ・テーブル定義・RLSポリシー等）を最初の1つで詳説し、残りはパターンとしてまとめています。運用スクリプトは実装との二重管理を避けるため、リポジトリ内の正本を参照します。

---

## 1. 全体像（アーキテクチャ）

```
                 HTTPS                 HTTP(80)
  ブラウザ  ───────────▶  CloudFront  ─────────▶  EC2(Docker: Next.js)
                          (TLS/CDN)               │  port 3000→80
                                                  ├──▶ RDS PostgreSQL (private・RLS)
                                                  ├──▶ Cognito        (認証・JWT発行)
                                                  └──▶ S3             (商品画像・署名付きURL)

  設定/機密: SSM Parameter Store ──(IAMロールで取得)──▶ EC2 起動スクリプト
```

- **CloudFront**: HTTPS終端とCDN。視聴者にHTTPSを強制し、オリジン（EC2）へはHTTPで転送。
- **EC2(t4g.micro, ARM)**: Dockerで Next.js コンテナを1つ動かすだけのサーバ。SSHは使わずSSMで操作。
- **RDS(PostgreSQL 16)**: 非公開（privateサブネット）。アプリは**非所有者ロール`monolog_app`**で接続し、**RLS（行レベルセキュリティ）**で「自分の行だけ」に制限。
- **Cognito**: サインアップ/ログインを担当しJWT（IDトークン等）を発行。ユーザの実体はCognito側、アプリDBには`users`行（id=Cognitoのsub）を持つ。
- **S3**: 商品画像を非公開保存。表示・保存は**署名付きURL**経由。
- **SSM Parameter Store**: DB接続情報・パスワード・CognitoのID・バケット名などを保管。EC2が起動時にIAMロールで読み取る。

ローカル開発では、RDSの代わりに**Dockerのローカル Postgres**を使い、Cognito/S3だけは**実物のAWSリソース**を参照します（Cognito/S3にローカル代替はないため）。

---

## 2. 用語ミニ辞典（先に眺めておくと楽）

| 用語 | ざっくり意味 |
|---|---|
| **Terraform** | インフラを「コード」で作る道具。`apply`で作成、`destroy`で削除。 |
| **IAMロール** | AWSリソース（EC2等）に与える「権限の身分証」。鍵を埋め込まず権限を渡せる。 |
| **SSM Parameter Store** | 設定値・パスワードの保管庫。`SecureString`は暗号化保存。 |
| **RLS** | PostgreSQLの行レベル制御。「`user_id`が自分の行だけ見える」をDB側で強制。 |
| **JWT** | ログイン後に配られる署名付きトークン。中身に`sub`（ユーザ識別子）等が入る。 |
| **standalone** | Next.jsの出力形態。実行に必要な最小ファイルだけまとめる（Docker向け）。 |
| **ECR** | Dockerイメージの保管庫（AWS版DockerHub）。 |
| **buildx** | Dockerのマルチプラットフォームビルド機能。ここでは`linux/arm64`を作る。 |

---

## 3. 必要なものを準備

### アカウント
- **AWSアカウント**（クレジットカード登録済み。RDS/EC2/CloudFrontは課金されます）
- GitHubアカウント（任意。コード管理に使うなら）

### ツール（インストール）
| ツール | 用途 | 確認コマンド |
|---|---|---|
| Node.js 22.x | アプリのビルド/実行 | `node -v` |
| Git（Windowsは Git for Windows = git bash同梱） | バージョン管理・push用シェル | `git --version` |
| Docker Desktop | ローカルDB・コンテナビルド | `docker -v` / `docker buildx version` |
| AWS CLI v2 | AWS操作 | `aws --version` |
| Terraform 1.9+ | インフラ構築 | `terraform -version` |
| VSCode（任意） | エディタ | - |

> Windowsの本番デプロイは`infra/deploy.ps1`で行います。スクリプト内でPowerShellのstdin問題を避け、固定イメージタグとロールバック状態を一括管理します。

### ここまでの確認
すべてのコマンドがバージョンを表示すればOKです。

---

## 4. AWS の初期設定

1. AWSコンソールで**IAMユーザ**（または IAM Identity Center のユーザ）を作り、プログラムアクセス用の**アクセスキー**を発行します。手早く始めるなら管理者権限相当でも可（本番運用では最小権限へ）。
2. CLIに認証情報を設定します。

```bash
aws configure
# AWS Access Key ID     : 発行したキー
# AWS Secret Access Key : 発行したシークレット
# Default region name   : ap-northeast-1
# Default output format : json
```

3. 通ることを確認します。

```bash
aws sts get-caller-identity
```

`Account`（12桁の数字 = アカウントID）が表示されればOK。**このアカウントIDは後で何度も使う**のでメモしておきます。

---

## 5. プロジェクト雛形の作成

任意の場所にフォルダを作り、Next.js（App Router・TypeScript・srcディレクトリ）の雛形を用意します。

```bash
# 例（フォルダ名は任意）
npx create-next-app@latest mono-log --ts --app --src-dir --eslint --no-tailwind --import-alias "@/*"
cd mono-log
```

> 既存リポジトリを引き継ぐ場合は `git clone` して `npm install` でも構いません。その場合は5〜8章（雛形・設定・ソース作成）は読み飛ばし、9章（ローカル起動）から進めてください。

### 依存パッケージの追加
このアプリ固有の依存を入れます（用途つき）。

```bash
npm install \
  @aws-sdk/client-cognito-identity-provider \  # Cognito操作（登録/ログイン/退会等）
  @aws-sdk/client-s3 \                          # S3操作（画像の保存/削除）
  @aws-sdk/s3-request-presigner \               # 署名付きURL生成
  aws-jwt-verify \                              # CognitoのJWT検証（JWKS自動取得）
  @prisma/client                                # Prisma Client（クエリ実行）

npm install -D prisma                           # Prisma CLI（generate/migrate/db pull）
```

`package.json`の`scripts`に型チェックと Prisma 用コマンドを足しておくと便利です。

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate deploy"
}
```

> Prisma は `postinstall` で `prisma generate` を自動実行しません（Docker の deps 段階に schema が無く失敗するため）。`npm install` 後はローカルで `npx prisma generate` を1回実行します（[付録D](setup-guide-data.md)）。

---

## 6. 設定ファイル

### next.config.ts
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Docker用に最小実行ファイルをまとめる
  // Prisma はネイティブのクエリエンジンを使うため、バンドルせず node_modules から解決させる
  serverExternalPackages: ["@prisma/client", "prisma"],
  images: {
    // S3の署名付きURLをnext/imageで表示するため許可
    remotePatterns: [
      { protocol: "https", hostname: "*.s3.ap-northeast-1.amazonaws.com" },
      { protocol: "https", hostname: "s3.ap-northeast-1.amazonaws.com" },
    ],
  },
};
export default nextConfig;
```

### Dockerfile（マルチステージ。standaloneを最小イメージで動かす）
```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma Client を生成（node_modules/.prisma にクエリエンジン含む）。
# schema の binaryTargets で linux-musl-arm64 エンジンも取得される。
RUN npx prisma generate
# 設定はすべて実行時の環境変数から読むため build-arg は不要
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Prisma のクエリエンジン(linux-musl)は openssl を必要とする
RUN apk add --no-cache openssl
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Prisma の生成物（クエリエンジン含む）を standalone に確実に含める
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -T 5 -O /dev/null \
    --header="x-mono-log-origin-verify: ${CLOUDFRONT_ORIGIN_VERIFY_SECRET}" \
    http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
```

- `HEALTHCHECK`: 30秒ごとに`/api/health`を確認し、3回連続で失敗したコンテナを`unhealthy`にする。DB等の外部サービスには接続せず、Next.jsプロセスの死活だけを確認する。
- オリジン検証が有効な本番環境でも内部確認できるよう、コンテナへ渡された検証秘密値をヘッダーに設定する。秘密値そのものはDockerイメージに保存しない。

### .dockerignore（ビルドコンテキストを軽くする）
```
node_modules
.next
.git
.gitignore
npm-debug.log
Dockerfile
.dockerignore
.env*
README.md
docs
supabase
.claude
infra
migrations
compose.yaml
```

> `infra`を除外しないと`.terraform`のプロバイダバイナリ（数百MB）まで送られてビルドが激重になります。

### compose.yaml（ローカル開発用のPostgres）
```yaml
services:
  db:
    image: postgres:16
    container_name: monolog-dev-db
    environment:
      POSTGRES_USER: monolog_admin # RDSと同じマスターユーザ名
      POSTGRES_PASSWORD: localdev  # ローカル専用（本番はSSM）
      POSTGRES_DB: monolog
    ports:
      - "5433:5432"                # ホストの5433でアクセス
    volumes:
      - monolog-dev-db:/var/lib/postgresql/data
volumes:
  monolog-dev-db:
```

### tsconfig.json
`create-next-app`が生成したもので概ねOKです。`paths`に`"@/*": ["./src/*"]`が入っていることだけ確認してください（`@/db/client`等の表記に必要）。

### .env.local（ローカル用の環境変数）
アプリが読む環境変数は次の通りです（用途つき）。**Cognito/S3の値は10章でTerraformを実行した後に確定**するので、ここはいったん空でも雛形だけ用意し、後で埋めます。

```bash
# DB（アプリ実行用。ローカルはDocker Postgresに接続）
# アプリは常にこの DB_* から接続URLを組み立てる（非所有者 monolog_app ＝ RLS が効く）。
DB_HOST=localhost
DB_PORT=5433
DB_NAME=monolog
DB_USER=monolog_app      # RLSを効かせるため非所有者ロールで接続
DB_PASSWORD=localapppw   # マイグレーションが作る初期パスワード（8章）

# AWS（Cognito/S3は実物を参照。認証情報は ~/.aws を自動使用）
AWS_REGION=ap-northeast-1
COGNITO_USER_POOL_ID=（10章のterraform後にSSM/出力から）
COGNITO_CLIENT_ID=（同上）
S3_IMAGE_BUCKET=mono-log-item-images-＜あなたのアカウントID＞
```

> **Prisma CLI 用の `DATABASE_URL`** は別物です。`migrate`/`generate`/`db pull` は所有者(`monolog_admin`)で接続するため、CLI実行時にインライン指定するか `.env` に置きます（アプリは上の `DB_*` を使い、`DATABASE_URL` は参照しません）:
> `DATABASE_URL="postgresql://monolog_admin:localdev@localhost:5433/monolog" npx prisma migrate deploy`

---

## 7. アプリのソース構成（役割と勘所）

アプリ本体のコードは量が多いので、ここでは**各ファイルの役割**と、**未経験者が特に理解すべき勘所**をまとめます。中核ファイル（cognito/session/middleware/client/image/actions）の**完全版は[付録B: 主要アプリコード全文](setup-guide-appcode.md)**に、それ以外はリポジトリの実ファイルを参照してください。

### ディレクトリ構成
```
src/
  middleware.ts            … オリジン検証とトークン期限切れ時の自動リフレッシュ
  app/
    layout.tsx, page.tsx   … 共通レイアウト/ランディング
    login/ signup/ confirm/… 認証画面
    auth/actions.ts        … サインアップ/ログイン/ログアウトのサーバアクション
    items/                 … 一覧/詳細/新規/編集/状態遷移
    items/actions.ts       … アイテムCRUDのサーバアクション（RLS下でINSERT/UPDATE）
    dashboard/ mypage/      … ダッシュボード/マイページ（退会・メール変更）
    import/                … CSV等の取込
    api/export/route.ts    … エクスポートAPI（ブラウザのCookie認証・ダウンロード用）
    api/v1/                 … 外部向けREST API（Cognito Bearer認証）。items/categories/export
  features/items/          … itemsのdomain/application/infrastructure/adapters
  lib/auth/api.ts          … REST APIのBearer認証ヘルパ + JSONエラー応答
  components/              … UI部品（item-card, item-form, nav-bar, filter-bar）
  db/
    client.ts              … Prisma Client(遅延生成) + withUser(RLSコンテキスト実行)
    serialize.ts           … Prisma行(BigInt/Decimal/Date) → アプリ型(number/文字列)変換
  lib/
    origin-verification.ts … CloudFrontが付ける秘密ヘッダーの照合
    auth/cognito.ts        … Cognito SDKラッパ + JWT検証
    auth/session.ts        … httpOnly Cookieでトークン保持
    image.ts               … S3への保存/削除/署名付きURL
    listing-calc.ts        … 出品の利益計算
    format.ts              … 表示整形
  types/item.ts            … アプリ共通の型
```

> リポジトリ直下に `prisma/schema.prisma`（Prismaのテーブル定義＝クエリ型）と `prisma/migrations/`（DDL＋RLS＋seedの手書きSQL）があります。

> 外部向けREST API（`/api/v1`・Cognito Bearer認証）の実装は[付録C: REST API実装手順](setup-guide-api.md)、仕様は[APIリファレンス](api-reference.md)を参照。Server Actions（画面用）とは別に、モバイル/外部連携向けのJSON APIを用意しています。

### 勘所（ここが理解の山）

1. **RLSコンテキスト（`db/client.ts`の`withUser`）**
   アプリはDBに非所有者`monolog_app`で接続します。各操作を`withUser(sub, fn)`で包むと、Prismaの**interactive transaction**内で`tx.$executeRaw\`select set_config('app.current_user_id', ${sub}, true)\``を実行し、その中で`fn(tx)`を走らせます。RLSポリシーは`user_id = app.current_user_id()`なので、**自分の行しか読み書きできない**ことをDB側が保証します。

2. **本番DB接続はSSL必須（`db/client.ts`）**
   RDSは`rds.force_ssl=1`でSSL必須。`PrismaClient`の接続URLに本番のみ`?sslmode=require`を付与します（`require`は暗号化のみでCA検証なし＝従来の`rejectUnauthorized:false`相当。ローカルのDocker Postgresは非SSL）。これを忘れると本番で「no pg_hba.conf entry ... no encryption」で接続拒否されます。アプリは常に`DB_*`(monolog_app)から接続URLを組み立てる（CLI用`DATABASE_URL`(admin)は使わない）点に注意。

3. **BigInt / Decimal の変換（`db/serialize.ts`）**
   Prismaは`bigint`列を`BigInt`、`numeric`列を`Decimal`で返します。`items.id`等はBigIntのため、**`NextResponse.json`に渡すと例外**になります。`serialize.ts`で `BigInt→Number` / `Decimal→.toNumber()` / `Date→ISO文字列` に変換し、アプリ型(snake_case・number)へ揃えます。`where`でidを使う箇所は`BigInt(id)`にします。

4. **ログインの順序（`app/auth/actions.ts`）**
   `loginAction`は **users行をupsertしてからセッションCookieを発行**します。逆順だと、失敗時に「Cookieあり/users行なし」の不整合（orphanセッション）が残り、以降のアイテム作成で外部キー違反になります。

5. **JWT検証は遅延生成（`lib/auth/cognito.ts`）**
   `CognitoJwtVerifier.create()`をモジュール読み込み時に呼ぶと、ビルド時は環境変数が無く`userPoolId`がundefinedで`next build`が落ちます。初回利用時に生成する関数で包みます。`PrismaClient`も同様にビルド時クラッシュ回避のため遅延生成します。

6. **オリジン要求の検証（`middleware.ts`）**
   本番EC2では、CloudFrontだけが付ける秘密ヘッダーを全リクエストの最初に照合します。セキュリティグループのCloudFront向けIP制限と組み合わせ、別のCloudFront distributionからEC2へ到達した要求も403にします。ローカルとVercelでは検証用環境変数を設定しないため、この検証だけを無効にできます。

7. **トークン自動更新（`middleware.ts`）**
   IDトークンの期限（約1時間）切れを検知し、リフレッシュトークンで再発行してCookieを差し替えます。これでこまめに再ログインせずに済みます。

---

## 8. データベース設計（スキーマ + RLS）

DDL（テーブル定義・RLS・ロール作成・seed）は**手書きSQL**を `prisma/migrations/<timestamp>_*/migration.sql` に置き、**Prisma Migrate**（`prisma migrate deploy`）で適用・管理します。CHECK制約・部分index・RLS・ロールはPrismaのスキーマでは表現しきれないため、自動生成DDLではなく手書きSQLを正とします。`prisma/schema.prisma` は**イントロスペクション（`prisma db pull`）で既存DBから生成**し、**Prisma Clientのクエリ型**として使います（フィールドは`@map`でcamelCaseに寄せる）。**SQL全文・`schema.prisma`・`serialize.ts`・`types/item.ts`は[付録D: データ基盤の実装手順](setup-guide-data.md)**にあります（写経でDB＋型が揃う）。

- `prisma/migrations/<ts>_init/migration.sql`
  - `app.current_user_id()`関数（`current_setting`からsubを取り出す）
  - `item_status`列挙型、各テーブル（users, categories, items, items_categories, plans, listings, 各マスタ）
  - **アプリ用ロール`monolog_app`を自動作成**（`create role monolog_app login password 'localapppw'`。本番ではデプロイ時に`ALTER ROLE`で強いパスワードへ差し替え）
  - `grant`（必要な表に限定）と **RLS有効化 + 各ポリシー**（`user_id = app.current_user_id()`）
- `prisma/migrations/<ts>_seed/migration.sql`
  - プラットフォーム/配送サービス/サイズ/送料などの**マスタデータ投入**

`users.id`はCognitoの`sub`（uuid）を入れ、`items.user_id`が`users.id`を参照します（だから「ログイン時にusers行を作る」のが前提になります）。

---

## 9. ローカルで動かす

### 9-1. ローカルDBを起動
```bash
docker compose up -d         # postgres:16 をバックグラウンド起動
docker compose ps            # 稼働確認（5433で待ち受け）
```

### 9-2. マイグレーションを適用（Prisma Migrate）
所有者(`monolog_admin`)の `DATABASE_URL` で `prisma migrate deploy` を実行すると、`prisma/migrations` のSQL（スキーマ/RLS/ロール → マスタ/seed）が順に適用されます。

```bash
DATABASE_URL="postgresql://monolog_admin:localdev@localhost:5433/monolog" npx prisma migrate deploy
```
> 初期マイグレーションが`monolog_app`ロールを初期パスワード`localapppw`で作るので、`.env.local`の`DB_PASSWORD=localapppw`と一致します。

### 9-2b. Prisma Client を生成
```bash
npx prisma generate
```
> `@prisma/client`の型・クエリエンジンを生成します（`npm install`では自動実行されません）。schema を変えたら都度実行します。

### 9-3. Cognito/S3 の値を .env.local に入れる
**10章のTerraform実行後**に、CognitoのIDとバケット名が確定します。次のコマンドで取得して`.env.local`へ書き込みます。

```bash
aws ssm get-parameter --region ap-northeast-1 --name /mono-log/cognito/user_pool_id --query Parameter.Value --output text
aws ssm get-parameter --region ap-northeast-1 --name /mono-log/cognito/client_id    --query Parameter.Value --output text
aws ssm get-parameter --region ap-northeast-1 --name /mono-log/s3/bucket            --query Parameter.Value --output text
```

> つまり「完全なローカル動作」にはCognito/S3が必要なので、**先に10章のinfra構築（少なくともCognito/S3）を済ませる**とスムーズです。DB周りだけの確認なら先にここまで進めてOKです。

### 9-4. 開発サーバ起動
```bash
npm run dev
# http://localhost:3000 を開く
```

### ここまでで
ローカルでサインアップ→ログイン→アイテム作成まで動けば、アプリ単体は完成です。

---

## 10. インフラ構築（Terraform）

`infra/`配下にVPC/Cognito/RDS/S3/ECR/EC2/CloudFront/SSM/IAMの定義があります。**ゼロから作る手順は[付録A: Terraform手順](setup-guide-terraform.md)**にあります（ファイル作成→`plan`→`apply`の手順形式・全`.tf`の中身入り）。

### 10-1. tfstateバケットの用意（最初の1回だけ）
Terraformの状態ファイル（tfstate）をS3に保存する設定（`infra/versions.tf`の`backend "s3"`）になっています。バケット名は**アカウント固有**なので、**自分用に作って名前を書き換え**ます。

```bash
# アカウントIDを確認
aws sts get-caller-identity --query Account --output text

# 状態保存用バケットを作成（東京リージョンはLocationConstraintが必要）
aws s3api create-bucket \
  --bucket mono-log-tfstate-＜あなたのアカウントID＞ \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1
```

作ったら`infra/versions.tf`の`bucket = "mono-log-tfstate-..."`を**自分のバケット名**に書き換えます。

> 手軽に試すだけなら、`backend "s3" { ... }`ブロックを丸ごとコメントアウトすれば、tfstateはローカルファイルに保存されます（チーム共有しないなら十分）。

### 10-2. 初期化〜適用
```bash
cd infra
terraform init     # プロバイダ取得・backend初期化
terraform plan     # 作成内容を確認（読み取り専用）
terraform apply    # yes で作成。RDS作成に数分かかる
```

### 10-3. 作られるもの（主なもの）
- **network.tf**: VPC / IGW / publicサブネット×1（EC2用）/ privateサブネット×2（RDS用）/ ルートテーブル
- **cognito.tf**: User Pool + Webクライアント（USER_PASSWORD_AUTH/SRP/REFRESH許可）+ SSM（user_pool_id, client_id）
- **storage.tf**: 画像用S3（全公開ブロック+SSE）+ SSM（s3/bucket）
- **database.tf**: RDS（`db.t4g.micro`, PG16, private, 20GB）+ マスタ/アプリ両ロールのパスワードをSSMに（`db/password`, `db/app_password`）+ 接続情報SSM（host/port/name/username）
- **ecr.tf**: 上書き不可のイメージ保管庫 + 現在/直前の配備タグを持つSSM + 直近10個保持のライフサイクル
- **compute.tf**: EC2用IAMロール（SSM読取・ECR読取・S3 RW）+ EC2（ARM, Docker/CloudWatch Agent自動導入, 起動時にSSMから設定・固定イメージタグ・オリジン検証秘密値を取得して`docker run`）+ ルート30GB
- **monitoring.tf**: コンテナログ用CloudWatch Logs（14日保持）+ EC2から対象ロググループだけへ書き込む最小権限
- **cdn.tf**: CloudFront（HTTPS強制・キャッシュ無効・全ヘッダ転送、オリジン=EC2、オリジン検証用の秘密ヘッダー）

> 初回構築では配備タグが`not-deployed`のため、アプリは未起動（systemdが30秒ごとに再試行）です。次の11〜12章で固定タグのイメージを投入します。再作成時はSSMに残ったタグのイメージがECRにあれば自動起動します。

### ここまでで
土台（ネットワーク/DB/認証/保管庫/サーバ/CDN）がAWS上に揃いました。9-3に戻って`.env.local`を埋めれば、ローカルから実Cognito/実S3を使った確認もできます。

---

## 11. 本番DBマイグレーション（migrate.ps1）

RDSは非公開でローカルから`prisma migrate deploy`を直接打てないため、`prisma/migrations`のSQLを**S3経由でEC2に渡し、EC2上の`psql`コンテナからRDSへ適用**します。`infra/migrate.ps1`が一連を自動化しています。**RDSを作り直すたびに1回**、作成方法に合うモードで実行します。

```powershell
# 空のRDSを作成した場合
powershell -ExecutionPolicy Bypass -File migrate.ps1

# 初期マイグレーション適用済みスナップショットから復元した場合
powershell -ExecutionPolicy Bypass -File migrate.ps1 -RestoredSnapshot

# AWSやDBを変更せず、候補になるマイグレーションだけ確認する場合
powershell -ExecutionPolicy Bypass -File migrate.ps1 -RestoredSnapshot -ListMigrations
```

やっていること:
- `prisma/migrations`を日時順に自動検出し、空DBには全件、復元DBにはスナップショットに含まれない追加分だけを適用
- 適用済みの名前とSHA-256を`app.schema_migrations`へ記録し、再実行時や将来の追加時は未適用分だけを実行。同名SQLの内容が変わっていた場合は停止
- 復元指定の誤りや、適用履歴のない既存DBへの通常実行をSQL適用前に停止
- 選択したSQLを1トランザクションで適用し、途中失敗時は今回の変更全体をロールバック
- 仕上げに`ALTER ROLE monolog_app WITH PASSWORD '<SSMの app_password>'`で、アプリ用ロールのパスワードを**SSMの強いパスワード**に差し替え（ローカルの`localapppw`から変更）
- 出力に`migrations completed successfully`が出れば成功

> アプリコンテナは`DB_PASSWORD`を同じSSM（`/mono-log/db/app_password`）から読むので、ここで設定した値と自動的に一致します。

---

## 12. デプロイ（ビルド → ECR → コンテナ起動）

`infra/deploy.ps1`が、Git commit SHAの決定、必要な場合だけのビルドとpush、SSMの配備タグ更新、EC2コンテナ更新を一括で行います。`latest`は使わず、同じタグを上書きできないため、どのコードが稼働しているかを追跡できます。

### 通常のデプロイ
```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

- 未コミット変更がある場合は停止します。先に変更をcommitしてください。
- 既定タグはGit HEADの40文字commit SHAです。同じSHAがECRにあれば既存イメージを再利用します。
- `--provenance=false`を付けて、EC2のDockerが取得できる単一イメージmanifestとしてpushします。
- 独自タグが必要な場合だけ`-Tag release-2026-08-19`のように指定できます。
- EC2でコンテナを再起動した後、DockerのHTTPヘルスチェックが`healthy`になるまで待ちます。正常になった場合だけ、現在タグと直前タグを確定します。
- 新しいコンテナが正常にならなければ、SSMの現在タグを元に戻し、直前まで稼働していたイメージを再起動して`healthy`になるまで確認します。
- 初回配備で直前のイメージがない場合は、失敗したコンテナを削除し、現在タグを`not-deployed`へ戻して失敗終了します。ログに表示された原因を修正してから再実行してください。
- 現在タグと直前タグはSSM上の共有状態なので、複数の`deploy.ps1`を同時に実行しないでください。

### 直前のイメージへロールバック
```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1 -Rollback
```

SSMの`previous_image_tag`が指すイメージを再配備します。成功後は現在タグと直前タグが入れ替わるため、同じコマンドで切り戻しもできます。ロールバック先が正常にならない場合は、開始前に稼働していたイメージへ自動的に戻します。ECRのライフサイクルにより直近10イメージを超えたものは削除されるため、ロールバックできません。

### CloudFrontドメインを確認
```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='mono-log app distribution'].DomainName" --output text
```

表示されたドメインの`/api/health`へアクセスし、Next.jsプロセスが応答できることを確認します。

```powershell
Invoke-RestMethod https://xxxxx.cloudfront.net/api/health
```

`deploy.ps1`はEC2内部から同じヘルスエンドポイントを確認します。ここで`status`が`ok`なら、さらにCloudFrontからコンテナまでの公開経路とNext.jsプロセスも正常です。どちらの確認もDB・Cognito・S3の稼働状態までは検査しません。

---

## 13. 動作確認

1. 上で得た`https://xxxxx.cloudfront.net`をブラウザで開く
2. サインアップ→確認コード（メール）→ログイン
3. アイテムを作成し、保存・画像表示まで確認

問題が出たら、まずCloudWatch Logsでコンテナログを確認します。通常の課金停止手順でEC2を削除した後も、ロググループを残すためログは14日間保持されます。

```bash
aws logs tail /mono-log/application --region ap-northeast-1 --since 30m --follow
```

CloudWatchへの転送自体が疑わしい場合は、SSM経由でEC2上のローカルログを確認します。

```bash
INSTANCE=i-xxxxxxxx   # 自分のインスタンスID
CID=$(aws ssm send-command --region ap-northeast-1 --instance-ids $INSTANCE \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker logs --tail 150 mono-log 2>&1 | tr -cd \"\\11\\12\\15\\40-\\176\""]' \
  --query Command.CommandId --output text)
aws ssm get-command-invocation --region ap-northeast-1 --command-id $CID --instance-id $INSTANCE \
  --query StandardOutputContent --output text
```
> `tr -cd ...`で非ASCII（Next.jsログの「✓」等）を除去しています。これを入れないとWindowsのAWS CLIがcp932エンコードエラーで落ちることがあります。

Dockerのローカルログは1ファイル10MB、最大3ファイルです。CloudWatch Agentの状態は`systemctl status amazon-cloudwatch-agent`で確認できます。

---

## 14. 課金停止（teardown）と再開

**RDS/EC2/CloudFrontは起動中ずっと課金**されます。使い終わったらこの3つだけ消し、VPC/Cognito/ECR/S3/SSMは残します（再開を楽にするため）。

RDSは通常、削除保護が有効です。意図的に削除する場合は、最終スナップショット名を指定して削除保護を解除してから、同じ設定で削除します。`mono-log-db-final-20260819-1530`は実行日時などを含む未使用の名前に置き換えてください。

```bash
cd infra
export TF_VAR_db_deletion_safety='{"protection_enabled":false,"final_snapshot_identifier":"mono-log-db-final-20260819-1530"}'

# 削除保護の解除と最終スナップショット名の設定だけか確認して適用
terraform plan -target=aws_db_instance.main
terraform apply -target=aws_db_instance.main

# 同じ設定で削除。RDSは最終スナップショットの作成後に削除される
terraform destroy \
  -target=aws_cloudfront_distribution.app \
  -target=aws_instance.app \
  -target=aws_db_instance.main

unset TF_VAR_db_deletion_safety
```

- `plan`が既存RDSの**更新（update in-place）だけ**であることを確認してください。新規作成（add）や置換（replace）が表示された場合はapplyしないでください。
- RDSが既に存在しない場合は環境変数を解除し、`aws_db_instance.main`を外してEC2とCloudFrontだけをdestroyしてください。
- 同名のスナップショットが既にある場合、RDSの削除は失敗します。別の名前を指定してください。
- 解除後に削除を中止した場合は、`unset TF_VAR_db_deletion_safety`の後に`terraform apply -target=aws_db_instance.main`で削除保護を有効に戻してください。
- 最終スナップショットはRDS削除後も保存料金がかかります。不要になったら内容を確認してAWS上で削除してください。

### 再開するとき
```bash
cd infra
terraform apply        # 空のRDS/EC2/CloudFrontを再作成（DNS/CloudFrontドメインは新しくなる）
# → 11章 migrate.ps1
# → 12章 deploy（ビルド→push→起動）
```

現在保存している`mono-log-db-20260629`から再開する場合は、`terraform plan`と`terraform apply`の両方に`-var="db_snapshot_identifier=mono-log-db-20260629"`を付けます。このスナップショットは適用履歴導入前のため、その後に11章の`migrate.ps1 -RestoredSnapshot`で初期2件を履歴へ登録し、追加分を適用します。今後作成する`app.schema_migrations`入りのスナップショットは、復元後も通常の`migrate.ps1`で未適用分だけを適用できます。

### コード更新だけのとき
インフラを消していなければ、**12章のデプロイだけ**再実行すれば反映されます。

---

## 15. トラブルシューティング（実際にハマった点）

| 症状 | 原因 | 対処 |
|---|---|---|
| 本番でログイン/一覧が「Server Componentsエラー」 | RDSがSSL必須なのにアプリが非SSL接続（`no pg_hba.conf entry ... no encryption`） | 接続URLに本番のみ`?sslmode=require`を付与。勘所2参照 |
| API応答で`Do not know how to serialize a BigInt` | `items.id`等がPrismaのBigIntのまま`NextResponse.json`へ | `serialize.ts`で`BigInt→Number`/`Decimal→number`変換（勘所3） |
| アイテム作成で外部キー違反（`items_user_id_fkey`） | users行が無いのにCookieだけ有効（orphanセッション） | ログアウト→再ログインでusers行作成。恒久対策は「upsert→Cookie」順（勘所4） |
| `docker pull`が`unsupported media type application/vnd.in-toto+json` | buildx既定のprovenanceアテステーション | ビルドに`--provenance=false`を付ける |
| 本番で`Query engine ... not found` | Prismaエンジンがstandaloneに含まれない/openssl不足 | Dockerfileで`prisma generate`＋`.prisma`コピー＋`apk add openssl`（6章） |
| `next build`が`parseUserPoolId`でクラッシュ | JWT verifierをモジュール読み込み時に生成（env不在） | 遅延生成に変更（勘所5） |
| `.ps1`が文字化け/パースエラー | Windows PowerShell 5.1がBOM無しUTF-8をShift-JISと誤読 | スクリプトはASCIIで書く（日本語コメントを避ける） |
| `terraform apply`が`InvalidBlockDeviceMapping`（20GB<snapshot） | 最新AL2023(ARM) AMIのスナップショットが30GB | `compute.tf`のルートボリュームを30GBに |
| AWS CLIが`cp932 codec can't encode`で落ちる（git bash） | 出力の非ASCII文字 | サーバ側で`tr -cd`して非ASCIIを除去 |
| PowerShellでECR push が401/400 | stdinパイプがトークンを破損 | `deploy.ps1`を使う（取得したパスワードを`docker login --password`へ直接渡す） |

---

## 16. 日々の更新フロー（まとめ）

- **アプリのコードを直した** → 12章のデプロイ（①②③）だけ再実行
- **DBスキーマを変えた** → `prisma/migrations/` に新しいマイグレーションSQLを追加し、`prisma db pull`＋`prisma generate`でschema/型を更新。ローカル(9-2)と本番(11章)へ適用
- **インフラを変えた** → `infra/`を編集して`terraform plan`→`apply`
- **使い終わった** → 14章のteardownで課金停止

---

### 付録: アプリが読む環境変数一覧
| 変数 | 使う場所 | ローカル | 本番(EC2) |
|---|---|---|---|
| `DB_HOST`/`DB_PORT`/`DB_NAME` | `db/client.ts` | localhost/5433/monolog | SSMから |
| `DB_USER`/`DB_PASSWORD` | `db/client.ts` | monolog_app / localapppw | monolog_app / SSM`app_password` |
| `AWS_REGION` | cognito/image | ap-northeast-1 | ap-northeast-1 |
| `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID` | `lib/auth/cognito.ts` | SSM/出力の値 | SSMから |
| `S3_IMAGE_BUCKET` | `lib/image.ts` | `mono-log-item-images-<acct>` | SSMから |
| `CLOUDFRONT_ORIGIN_VERIFY_SECRET` | `middleware.ts` | 未設定（検証無効） | SSM `cloudfront/origin_verify_secret`から |
| `NODE_ENV` | client/session | development | production（SSL・secure Cookie有効） |
