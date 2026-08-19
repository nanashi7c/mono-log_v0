# mono-log

所有物・購入予定・出品をまとめて管理するアプリ。Next.js (App Router) + React + TypeScript / Server Actions + REST API。バックエンドは **AWS ネイティブ**（Cognito 認証 / RDS PostgreSQL + Prisma + RLS / S3）。

## 動作画面

### ランディング画面

![mono-logのランディング画面](docs/images/landing.png)

### アイテム追加画面

![アイテム追加画面](docs/images/item-create.png)

### 追加後の所有物一覧

![Raspberry Pi 5を追加した所有物一覧](docs/images/item-list.png)

> アイテム画像: [Raspberry-Pi 5.jpg](https://commons.wikimedia.org/wiki/File:Raspberry-Pi_5.jpg)（CC0 1.0）

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| フロント/サーバ | Next.js 15 (App Router) / React 19 / TypeScript / Server Actions / CSS Modules |
| 認証 | Amazon Cognito（JWT 発行・`aws-jwt-verify` で検証・httpOnly Cookie・middleware で自動更新） |
| DB | RDS PostgreSQL。**Prisma Client**（クエリ）/ **Prisma Migrate**（DDL・RLS・seed の手書きSQL） |
| 認可 | 非所有者ロール `monolog_app` で接続し、トランザクション内 `set_config('app.current_user_id', …)` で **行レベルセキュリティ(RLS)** |
| 画像 | S3（非公開）＋ 署名付き GET / POST。画像本体はブラウザからS3へ直接送信 |
| API | 外部向け REST `/api/v1`（Cognito の Bearer トークン認証） |
| ホスティング | EC2 + Docker + CloudFront。IaC は **Terraform**。ローカルは Docker の PostgreSQL |

## アーキテクチャ

実行時は、画面操作と外部APIをCloudFront経由でNext.jsへ集約します。認証はCognito、永続化と認可はRDS PostgreSQL、画像本体は非公開S3が担当します。

画像の選択時だけ通信経路が異なります。Next.jsは認証・入力検証・署名付きPOSTの発行を行い、画像本体はアプリサーバーを経由せずブラウザからS3へ直接送信します。これにより、EC2の通信量とメモリ使用量を抑えます。

```mermaid
flowchart LR
    Browser["ブラウザ<br/>画面・httpOnly Cookie"]
    ApiClient["外部クライアント<br/>REST・Bearer JWT"]
    CF["CloudFront<br/>HTTPS終端"]

    subgraph Runtime["EC2 / Docker / Next.js standalone"]
        MW["middleware<br/>トークン更新"]
        Delivery["App Router<br/>Server Components / Actions / Route Handlers"]
        UseCase["Application<br/>Use Cases / Ports"]
        Domain["Domain<br/>状態遷移・純粋関数"]
        Infra["Infrastructure<br/>Prisma / AWS adapters"]
        MW --> Delivery --> UseCase
        UseCase --> Domain
        UseCase --> Infra
    end

    Browser -->|"HTTPS"| CF
    ApiClient -->|"HTTPS / api/v1"| CF
    CF -->|"HTTP :80"| MW
    Delivery <-->|"認証・JWT"| Cognito["Amazon Cognito"]
    Infra -->|"Prisma transaction<br/>set_config + RLS"| RDS[("RDS PostgreSQL<br/>private subnet")]
    Infra -->|"署名発行・検査・削除"| S3["S3 item-images<br/>非公開"]
    Browser -->|"署名付きPOST / GET<br/>画像本体を直接転送"| S3
    SSM["SSM Parameter Store"] -->|"起動時に環境変数を注入"| Runtime
    ECR["ECR"] -->|"Docker image pull"| Runtime
```

アプリ内部は、技術詳細をapplication/domainから遠ざける方向で分割しています。画面・Server Action・Route Handlerがユースケースを呼び、DBやS3の実装はapplication層で定義したportを実装します。

```mermaid
flowchart LR
    Presentation["Presentation<br/>app / components / API routes"] --> Application["Application<br/>use cases / input / ports"]
    Application --> Domain["Domain<br/>rules / calculations / transitions"]
    Infrastructure["Infrastructure<br/>Prisma repositories / S3 stores"] -. "portsを実装" .-> Application
    Presentation -. "依存を組み立てる" .-> Infrastructure
    Adapters["Adapters<br/>Form・API・CSVの変換"] --> Application
    Infrastructure --> External["RDS / Cognito / S3"]
```

設計上の原則は次のとおりです。

- DB操作は`withUser`内のトランザクションに閉じ、RLSの利用者コンテキストを必ず設定する。
- domainはI/Oを持たない純粋関数、applicationはユースケースとport、infrastructureはPrisma・AWS SDKの詳細を担当する。
- Cookie・URL・DBを状態の正本とし、クライアント側はフォームやメニューなど短命なUI状態だけをReact hooksで持つ。
- S3の署名はアプリが発行し、画像本体の転送はブラウザとS3の間で行う。ただしアイテム保存との確定状態はDBで管理する。

AWSリソース、ネットワーク、Docker、運用上の制約と改善優先度は[インフラ設計](docs/infra-design.md)を参照してください。

## データベース構成

カラム名と型は、実際のPostgreSQL上の定義を表しています。詳細は [DBスキーマ設計](docs/db-design.md) を参照してください。

```mermaid
erDiagram
    USERS {
        uuid id PK
        text email UK
        text username
        timestamptz created_at
        timestamptz updated_at
    }

    CATEGORIES {
        integer id PK
        uuid user_id FK "nullable"
        text name
        text color
        boolean is_preset
        timestamptz created_at
        timestamptz updated_at
    }

    ITEMS {
        bigint id PK
        uuid user_id FK
        item_status status
        varchar name
        text image_url "nullable"
        varchar jan_code "nullable"
        integer quantity
        text notes "nullable"
        integer actual_price "nullable"
        date purchased_at "nullable"
        timestamptz deleted_at "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    ITEMS_CATEGORIES {
        bigint item_id PK, FK
        integer category_id PK, FK
        timestamptz created_at
    }

    PLANS {
        bigint id PK
        bigint item_id FK, UK
        smallint planned_purchase_year "nullable"
        smallint planned_purchase_month "nullable"
        numeric list_price "nullable"
        numeric purchase_price "nullable"
        text product_url "nullable"
        varchar deal_period "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    LISTINGS {
        bigint id PK
        bigint item_id FK, UK
        bigint shipping_id FK "nullable"
        integer platform_id FK "nullable"
        integer quantity "nullable"
        numeric selling_price "nullable"
        numeric packaging_cost "nullable"
        numeric work_time_hours "nullable"
        numeric labor_rate "nullable"
        numeric selling_fee "nullable"
        numeric work_time_cost "nullable"
        numeric operating_benefit "nullable"
        numeric ordinary_profit "nullable"
        boolean is_listing "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    PLATFORMS {
        integer id PK
        text name UK
        numeric fee_rate
        timestamptz created_at
        timestamptz updated_at
    }

    SERVICES {
        integer id PK
        text shipping_service UK
        timestamptz created_at
        timestamptz updated_at
    }

    SIZES {
        integer id PK
        text shipping_size UK
        timestamptz created_at
        timestamptz updated_at
    }

    SHIPPING {
        bigint id PK
        integer shipping_service_id FK
        integer shipping_size_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    SHIPPING_FEES {
        bigint id PK
        integer shipping_service_id FK
        integer shipping_size_id FK
        numeric fee
        timestamptz created_at
        timestamptz updated_at
    }

    USERS o|--o{ CATEGORIES : owns
    USERS ||--o{ ITEMS : owns
    ITEMS ||--o{ ITEMS_CATEGORIES : categorized_by
    CATEGORIES ||--o{ ITEMS_CATEGORIES : contains
    ITEMS ||--o| PLANS : has
    ITEMS ||--o| LISTINGS : has
    PLATFORMS o|--o{ LISTINGS : used_by
    SHIPPING o|--o{ LISTINGS : used_by
    SERVICES ||--o{ SHIPPING : provides
    SIZES ||--o{ SHIPPING : defines
    SERVICES ||--o{ SHIPPING_FEES : prices
    SIZES ||--o{ SHIPPING_FEES : prices
```

## 機能

- **アイテム管理**: 名前・カテゴリ・JANコード・数量・購入価格・購入日・メモ・画像。状態は **購入予定 / 所有 / 出品中 / 売却**
- **状態遷移**: 購入予定→所有（購入済み）、所有→出品、出品→売却（論理削除）/ 出品取り下げ、など
- **カテゴリ**: プリセット＋自分用に作成。一覧でキーワード検索（名前・メモ）／カテゴリ絞り込み（「未分類」も指定可）
- **ダッシュボード**: 登録数 / 合計金額 / 平均 / カテゴリ別の数と金額バー
- **購入予定リスト**: 購入予定年月・定価・購入予定価格・商品リンク・お買い得期間
- **出品リスト**: 販売手数料・送料・作業時間コストを含む**損益を自動計算**し、出品可否を判定
- **マイページ**: プロフィール編集・メールアドレス変更・パスワード変更・退会
- **CSV エクスポート / インポート**（ダッシュボード画面、アイテム＋カテゴリ）
- **REST API**: items / categories / export（モバイル・外部連携向け）

## セットアップ（ローカル開発）

最短手順（詳細・本番デプロイは [docs/setup-guide.md](docs/setup-guide.md)）:

```bash
# 1. ローカル DB（PostgreSQL）を起動
docker compose up -d

# 2. マイグレーション適用（所有者 URL で Prisma Migrate）
DATABASE_URL="postgresql://monolog_admin:localdev@localhost:5433/monolog" npx prisma migrate deploy

# 3. 依存導入 & Prisma Client 生成
npm install
npx prisma generate

# 4. 環境変数（AWS版テンプレートをコピーして埋める）
cp .env.local.example .env.local
#   DB_* / AWS_REGION / COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / S3_IMAGE_BUCKET

# 5. 起動
npm run dev
# http://localhost:3000
```

> 注: 認証(Cognito)と画像(S3)は**実物の AWS リソース**を参照します。これらは Terraform で作成します（[docs/setup-guide.md](docs/setup-guide.md) の10章）。DB だけ確認するなら4までで進められます。

## ドキュメント

- [docs/setup-guide.md](docs/setup-guide.md) … ゼロから本番デプロイまでの手順（付録A: Terraform / B: 中核コード / C: REST API / D: データ基盤）
- [docs/infra-design.md](docs/infra-design.md) … インフラ設計（AWS構成と **Vercel 代替案**）
- [docs/db-design.md](docs/db-design.md) … DB スキーマ設計
- [docs/api-reference.md](docs/api-reference.md) … REST API 仕様（エンドポイント・curl例）

## ディレクトリ構成

```
prisma/
  schema.prisma           Prisma のテーブル定義（クエリ型。db pull 由来・@map で camelCase）
  migrations/             DDL＋RLS＋ロール＋seed の手書きSQL（Prisma Migrate 管理）
src/
  middleware.ts           全リクエスト前処理（トークン期限切れ時の自動リフレッシュ）
  app/
    page.tsx              ランディング
    login/ signup/ confirm/   認証画面
    auth/actions.ts       サインアップ/ログイン/ログアウト（Server Actions）
    items/                一覧/詳細/新規/編集/状態遷移
    items/actions.ts      アイテム CRUD（RLS 下で create/update/delete）
    dashboard/ mypage/    集計 / マイページ（退会・メール変更）
    import/               CSV 取り込み（画面操作用）
    api/export/route.ts   CSV ダウンロード（Cookie 認証）
    api/v1/               外部向け JSON REST API（Bearer 認証）items/categories/export
  components/             UI（item-card / item-form / nav-bar / filter-bar）
  features/home/          トップ画面のユーザー名・件数Query
  features/items/         itemsのdomain/application/infrastructure/adapters
  features/users/         マイページのプロフィールQuery
  db/
    client.ts             Prisma Client（遅延生成）＋ withUser（RLS コンテキスト実行）
    serialize.ts          Prisma 行（BigInt/Decimal/Date）→ アプリ型（number/文字列）変換
  lib/
    auth/cognito.ts       Cognito SDK ラッパ + JWT 検証
    auth/session.ts       httpOnly Cookie でトークン保持
    auth/api.ts           REST API の Bearer 認証ヘルパ
    image.ts              S3 の削除/存在確認/署名付き GET・POST
    listing-calc.ts       出品の損益計算
    format.ts             表示整形
  types/item.ts           アプリ共通の型
infra/                    Terraform（VPC/Cognito/RDS/S3/ECR/EC2/CloudFront/SSM/IAM）
```

## セキュリティ方針

- アプリは **非所有者ロール `monolog_app`** で DB に接続し、各操作を `withUser(sub, fn)`（トランザクション内 `set_config(..., true)`）で包む。RLS ポリシーは `user_id = app.current_user_id()` で**自分の行だけ**に制限（オブジェクトレベル認可）。
- 認証は **Cognito**。ID トークンは **JWKS** で署名検証し、トークンは httpOnly Cookie に保存。失効時は middleware が自動リフレッシュ。
- 画像は**非公開 S3**。表示は署名付き GET、送信は形式・10MB上限・5分期限を持つ署名付き POST を使う。画像本体はアプリサーバーを経由しない。
- 画像選択時にユーザー専用の `pending_item_image_uploads` を作り、アイテム保存とpending消費を同じDBトランザクションで確定する。DB保存に失敗した画像はpendingのまま残り、期限後の次回アップロード準備時にS3から削除する。
- 本番 DB 接続は **SSL 必須**（`sslmode=require`）。EC2 は IAM ロールで最小権限（SSM 読取 / S3 オブジェクト RW）。機密は SSM Parameter Store（SecureString）で管理し、コードに秘密を書かない。

## 既知の制限

- 画像は1アイテムあたり1枚
- インポートは追記のみ（重複検出なし）
- 単一ユーザーモデル（共有・閲覧権限の譲渡は無し）
