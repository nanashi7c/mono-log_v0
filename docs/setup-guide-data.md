# 付録D: データ基盤の実装手順＋逐行解説

[setup-guide.md](setup-guide.md) の8章・11章の詳細版。アプリ／APIがコンパイル・起動するのに必須の土台を**ファイル作成の手順形式**で作り、各コードの直後に**逐行解説**を付けます。

作成順:
1. `prisma/migrations/<ts>_init/migration.sql`（DDL＋RLS＋ロール）
2. `prisma/migrations/<ts>_seed/migration.sql`（マスタ＋プリセット）
3. `src/types/item.ts`（型）
4. `prisma/schema.prisma`（Prismaのクエリ型。Step 6適用後に`db pull`で生成）
5. `src/db/serialize.ts`（schema/typesに依存）
6. ローカル適用（`prisma migrate deploy`）＆`generate`＆型チェック
7. `infra/migrate.ps1`（本番RDSへの適用スクリプト）

> 関係: SQL(①)が実テーブル・RLS・ロールを作り（**Prisma Migrate が管理**）、`schema.prisma`(④)が同じ表を Prisma Client の「クエリ型」として定義、serialize(⑤)が結果を型(③)の形へ整える。**CHECK制約・RLS・ロールは Prisma スキーマで表現できない**ため、自動生成ではなく手書きSQLを正とする。

---

## Step 1. `prisma/migrations/<ts>_init/migration.sql` を作成

```sql
-- mono-log AWS版 完全スキーマ（v1相当・Cognito/RLS対応）
-- アプリは非所有者ロール monolog_app で接続し、RLS が適用される。

create schema if not exists app;

create or replace function app.current_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'item_status') then
    create type public.item_status as enum ('planned','owned','listed','sold');
  end if;
end$$;

-- users（auth.users + profiles の代替。id = Cognito sub）
create table public.users (
  id         uuid primary key,
  email      text not null unique,
  username   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_set_updated_at before update on public.users
  for each row execute function app.set_updated_at();

-- categories（プリセット + ユーザ作成）
create table public.categories (
  id integer generated always as identity primary key,
  user_id uuid references public.users(id) on delete cascade,
  name text not null,
  color text not null default '#94a3b8',
  is_preset boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_owner_or_preset check (
    (is_preset and user_id is null) or (not is_preset and user_id is not null)
  ),
  unique nulls not distinct (user_id, name)
);
create index categories_user_idx on public.categories (user_id);
create trigger categories_set_updated_at before update on public.categories
  for each row execute function app.set_updated_at();

-- items（全カラム）
create table public.items (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  status public.item_status not null,
  name varchar(255) not null,
  image_url text,
  jan_code varchar(13),
  quantity integer not null check (quantity > 0),
  notes text,
  actual_price integer check (actual_price is null or actual_price >= 0),
  purchased_at date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_user_status_idx on public.items (user_id, status, created_at desc);
create index items_user_active_idx on public.items (user_id) where deleted_at is null;
create trigger items_set_updated_at before update on public.items
  for each row execute function app.set_updated_at();

-- items_categories（M:N）
create table public.items_categories (
  item_id bigint not null references public.items(id) on delete cascade,
  category_id integer not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, category_id)
);
create index items_categories_category_idx on public.items_categories (category_id);

-- plans
create table public.plans (
  id bigint generated always as identity primary key,
  item_id bigint not null unique references public.items(id) on delete cascade,
  planned_purchase_year smallint,
  planned_purchase_month smallint check (planned_purchase_month is null or planned_purchase_month between 1 and 12),
  list_price numeric(10,0) check (list_price is null or list_price >= 0),
  purchase_price numeric(10,0) check (purchase_price is null or purchase_price >= 0),
  product_url text,
  deal_period varchar(255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_set_updated_at before update on public.plans
  for each row execute function app.set_updated_at();

-- master: platforms / services / sizes
create table public.platforms (
  id integer generated always as identity primary key,
  name text not null unique,
  fee_rate numeric(5,4) not null check (fee_rate >= 0 and fee_rate <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger platforms_set_updated_at before update on public.platforms
  for each row execute function app.set_updated_at();

create table public.services (
  id integer generated always as identity primary key,
  shipping_service text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger services_set_updated_at before update on public.services
  for each row execute function app.set_updated_at();

create table public.sizes (
  id integer generated always as identity primary key,
  shipping_size text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sizes_set_updated_at before update on public.sizes
  for each row execute function app.set_updated_at();

create table public.shipping (
  id bigint generated always as identity primary key,
  shipping_service_id integer not null references public.services(id),
  shipping_size_id integer not null references public.sizes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipping_service_id, shipping_size_id)
);
create trigger shipping_set_updated_at before update on public.shipping
  for each row execute function app.set_updated_at();

create table public.shipping_fees (
  id bigint generated always as identity primary key,
  shipping_service_id integer not null references public.services(id),
  shipping_size_id integer not null references public.sizes(id),
  fee numeric(10,0) not null check (fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shipping_service_id, shipping_size_id)
);
create trigger shipping_fees_set_updated_at before update on public.shipping_fees
  for each row execute function app.set_updated_at();

-- listings（利益計算列はアプリが算出してセット）
create table public.listings (
  id bigint generated always as identity primary key,
  item_id bigint not null unique references public.items(id) on delete cascade,
  shipping_id bigint references public.shipping(id),
  platform_id integer references public.platforms(id),
  quantity integer check (quantity is null or quantity > 0),
  selling_price numeric(10,0) check (selling_price is null or selling_price >= 0),
  packaging_cost numeric(10,0) check (packaging_cost is null or packaging_cost >= 0),
  work_time_hours numeric(8,2) check (work_time_hours is null or work_time_hours >= 0),
  labor_rate numeric(10,0) check (labor_rate is null or labor_rate >= 0),
  selling_fee numeric(10,0),
  work_time_cost numeric(10,0),
  operating_benefit numeric(10,0),
  ordinary_profit numeric(10,0),
  is_listing boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger listings_set_updated_at before update on public.listings
  for each row execute function app.set_updated_at();

-- アプリ用ロール（非所有者・非superuser）
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'monolog_app') then
    create role monolog_app login password 'localapppw';
  end if;
end$$;

grant usage on schema public, app to monolog_app;
grant execute on function app.current_user_id() to monolog_app;
grant select, insert, update, delete on
  public.users, public.categories, public.items, public.items_categories,
  public.plans, public.listings to monolog_app;
grant select on public.platforms, public.services, public.sizes, public.shipping_fees to monolog_app;
grant select, insert on public.shipping to monolog_app;

-- RLS（ユーザ系のみ。マスタは参照用でRLSなし）
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.items_categories enable row level security;
alter table public.plans enable row level security;
alter table public.listings enable row level security;

create policy users_select on public.users for select using (id = app.current_user_id());
create policy users_insert on public.users for insert with check (id = app.current_user_id());
create policy users_update on public.users for update using (id = app.current_user_id()) with check (id = app.current_user_id());

create policy categories_select on public.categories for select using (is_preset or user_id = app.current_user_id());
create policy categories_insert on public.categories for insert with check (user_id = app.current_user_id() and not is_preset);
create policy categories_update on public.categories for update using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
create policy categories_delete on public.categories for delete using (user_id = app.current_user_id());

create policy items_select on public.items for select using (user_id = app.current_user_id());
create policy items_insert on public.items for insert with check (user_id = app.current_user_id());
create policy items_update on public.items for update using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
create policy items_delete on public.items for delete using (user_id = app.current_user_id());

create policy items_categories_select on public.items_categories for select using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy items_categories_insert on public.items_categories for insert with check (
  exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id())
  and exists (
    select 1 from public.categories c
    where c.id = category_id
      and (c.is_preset or c.user_id = app.current_user_id())
  )
);
create policy items_categories_delete on public.items_categories for delete using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));

create policy plans_select on public.plans for select using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy plans_insert on public.plans for insert with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy plans_update on public.plans for update using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id())) with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy plans_delete on public.plans for delete using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));

create policy listings_select on public.listings for select using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy listings_insert on public.listings for insert with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy listings_update on public.listings for update using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id())) with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
create policy listings_delete on public.listings for delete using (exists (select 1 from public.items i where i.id = item_id and i.user_id = app.current_user_id()));
```
**逐行解説**
- `create schema if not exists app;`: 関数を置く名前空間`app`。
- `app.current_user_id()`: **RLSの基準値**。`current_setting('app.current_user_id', true)`(未設定でもエラーにせずnull)を`nullif(...,'')`で空→null、`::uuid`でキャスト。`withUser`がここに`sub`を入れる。
- `app.set_updated_at()`: 更新時に`new.updated_at := now()`で更新時刻を自動更新するトリガ関数。
- `do $$ ... if not exists (... pg_type ... 'item_status') then create type ... enum (...) ...`: 4状態の列挙型を二重作成しないガード付きで作成。
- `create table public.users (...)`: 主キー`id uuid`(=Cognito sub)、`email`必須・一意、`username`必須、作成/更新時刻。続く`create trigger`で更新時刻を自動化(以後の各テーブルも同様)。
- `create table public.categories (...)`:
  - `id integer generated always as identity primary key`: 自動採番。
  - `user_id uuid references public.users(id) on delete cascade`: 所有者FK(NULL可＝プリセット用、連動削除)。
  - `constraint categories_owner_or_preset check (...)`: 「プリセットならuser_id null」「非プリセットならuser_id必須」を強制。
  - `unique nulls not distinct (user_id, name)`: 同名禁止(NULL同士も同一扱い)。
- `create table public.items (...)`:
  - `id bigint ... identity`、`user_id ... not null references users(id) on delete cascade`(必須FK)。
  - `status public.item_status not null`(列挙)、`name varchar(255) not null`、`quantity ... check (quantity > 0)`、`actual_price ... check (null or >= 0)`、`purchased_at date`、`deleted_at`(論理削除用)。
  - 2インデックス: 一覧用と、`where deleted_at is null`の**部分インデックス**。
- `items_categories`: M:N中間表。双方FK＋`primary key (item_id, category_id)`で重複防止。
- `plans`: `item_id ... unique`でitemsと1:1。`planned_purchase_month ... between 1 and 12`等のcheck。
- `platforms/services/sizes/shipping/shipping_fees`: マスタ群。`fee_rate numeric(5,4) check (0〜1)`(手数料率)、`shipping`はサービス×サイズの組合せ(両FK＋`unique`)、`shipping_fees`はその送料。
- `listings`: `item_id ... unique`で1:1。`selling_price`〜`labor_rate`が入力、`selling_fee`〜`is_listing`は**アプリが計算してセットする列**。
- `do $$ ... create role monolog_app login password 'localapppw' ...`: **アプリ接続ロール**を作成(非所有者＝RLSが効く。初期パスワードは本番でALTER ROLE)。
- `grant ...`: スキーマ利用・基準関数実行・ユーザ系テーブルCRUD・マスタ参照・shippingの参照＋挿入を許可。
- `alter table ... enable row level security`: 各テーブルでRLS有効化。
- `create policy ... for select using (...)` / `for insert with check (...)`: **`using`=対象行の条件、`with check`=書き込む値の条件**。
  - users/categories/items: 自分の`user_id`(usersは`id`)か。categoriesのselectのみ`is_preset or ...`でプリセットも可視、insertは`and not is_preset`でプリセット作成禁止。
  - items_categories/plans/listings: `exists (select 1 from items i where i.id = item_id and i.user_id = app.current_user_id())`で**親アイテムが自分のものか**を判定(自前のuser_idが無いため)。items_categoriesのinsertは、さらにカテゴリがプリセットまたは自分所有であることも検査する。

---

## Step 2. `prisma/migrations/<ts>_seed/migration.sql` を作成

```sql
-- マスタ＋プリセットカテゴリの seed。ON CONFLICT DO NOTHING で再実行は no-op。

insert into public.platforms (name, fee_rate) values
  ('メルカリ',       0.1000),
  ('ラクマ',         0.0600),
  ('Yahoo!フリマ',   0.0500),
  ('Yahoo!オークション', 0.1000)
on conflict (name) do nothing;

insert into public.services (shipping_service) values
  ('らくらくメルカリ便'),
  ('ゆうゆうメルカリ便'),
  ('ヤマト宅急便'),
  ('日本郵便（ゆうパック）')
on conflict (shipping_service) do nothing;

insert into public.sizes (shipping_size) values
  ('ネコポス'),
  ('ゆうパケット'),
  ('宅急便コンパクト'),
  ('60サイズ'),
  ('80サイズ'),
  ('100サイズ'),
  ('120サイズ'),
  ('140サイズ'),
  ('160サイズ')
on conflict (shipping_size) do nothing;

with svc as (select id, shipping_service from public.services),
     sz  as (select id, shipping_size from public.sizes)
insert into public.shipping_fees (shipping_service_id, shipping_size_id, fee)
select s.id, z.id, f.fee
from (values
  ('らくらくメルカリ便',  'ネコポス',         210),
  ('らくらくメルカリ便',  '宅急便コンパクト', 450),
  ('らくらくメルカリ便',  '60サイズ',          750),
  ('らくらくメルカリ便',  '80サイズ',          850),
  ('らくらくメルカリ便',  '100サイズ',        1050),
  ('らくらくメルカリ便',  '120サイズ',        1200),
  ('らくらくメルカリ便',  '140サイズ',        1450),
  ('らくらくメルカリ便',  '160サイズ',        1700),
  ('ゆうゆうメルカリ便',  'ゆうパケット',      215),
  ('ゆうゆうメルカリ便',  '60サイズ',          770),
  ('ゆうゆうメルカリ便',  '80サイズ',          870),
  ('ゆうゆうメルカリ便',  '100サイズ',        1070),
  ('ヤマト宅急便',         '60サイズ',          940),
  ('ヤマト宅急便',         '80サイズ',         1150),
  ('ヤマト宅急便',         '100サイズ',        1390),
  ('ヤマト宅急便',         '120サイズ',        1610),
  ('ヤマト宅急便',         '140サイズ',        1850),
  ('ヤマト宅急便',         '160サイズ',        2070),
  ('日本郵便（ゆうパック）','60サイズ',          810),
  ('日本郵便（ゆうパック）','80サイズ',         1030),
  ('日本郵便（ゆうパック）','100サイズ',        1270),
  ('日本郵便（ゆうパック）','120サイズ',        1510),
  ('日本郵便（ゆうパック）','140サイズ',        1760),
  ('日本郵便（ゆうパック）','160サイズ',        2010)
) as f(service, size, fee)
join svc s on s.shipping_service = f.service
join sz  z on z.shipping_size = f.size
on conflict (shipping_service_id, shipping_size_id) do nothing;

insert into public.categories (user_id, name, is_preset, color) values
  (null, '電子機器',           true, '#4a6cf7'),
  (null, '衣類',               true, '#ec4899'),
  (null, '本・コミック',       true, '#f59e0b'),
  (null, 'ホビー・おもちゃ',   true, '#10b981'),
  (null, '家具・インテリア',   true, '#a855f7'),
  (null, '食品・飲料',         true, '#ef4444'),
  (null, 'スポーツ',           true, '#06b6d4'),
  (null, '美容・健康',         true, '#f472b6'),
  (null, 'その他',             true, '#94a3b8')
on conflict (user_id, name) do nothing;
```
**逐行解説**
- `insert into ... values (...),(...) on conflict (列) do nothing`: 複数行を一括挿入し、既存キーは**何もしない**(再実行しても安全＝冪等)。platforms/services/sizesはこの形。
- `fee_rate`は小数(例`0.1000`=10%)。
- shipping_fees: `with svc/sz`で名前→idの対応表を作り、`from (values (...名前..., 料金)) as f(...)`の仮想表を`join`してidに変換しつつ挿入(idを直書きしない)。
- categories: プリセットは`user_id`が`null`・`is_preset`が`true`(Step1のcheckを満たす)。

---

## Step 3. `src/types/item.ts` を作成

```ts
export type ItemStatus = "planned" | "owned" | "listed" | "sold";

export type Category = {
  id: number;
  user_id: string | null;
  name: string;
  color: string;
  is_preset: boolean;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: number;
  user_id: string;
  status: ItemStatus;
  name: string;
  image_url: string | null;
  jan_code: string | null;
  quantity: number;
  actual_price: number | null;
  purchased_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
};

export type ItemCategory = {
  item_id: number;
  category_id: number;
  created_at: string;
};

export type Plan = {
  id: number;
  item_id: number;
  planned_purchase_year: number | null;
  planned_purchase_month: number | null;
  list_price: number | null;
  purchase_price: number | null;
  product_url: string | null;
  deal_period: string | null;
  created_at: string;
  updated_at: string;
};

export type Platform = {
  id: number;
  name: string;
  fee_rate: number;
  created_at: string;
  updated_at: string;
};

export type Service = {
  id: number;
  shipping_service: string;
  created_at: string;
  updated_at: string;
};

export type Size = {
  id: number;
  shipping_size: string;
  created_at: string;
  updated_at: string;
};

export type Shipping = {
  id: number;
  shipping_service_id: number;
  shipping_size_id: number;
  created_at: string;
  updated_at: string;
};

export type ShippingFee = {
  id: number;
  shipping_service_id: number;
  shipping_size_id: number;
  fee: number;
  created_at: string;
  updated_at: string;
};

export type Listing = {
  id: number;
  item_id: number;
  shipping_id: number | null;
  platform_id: number | null;
  quantity: number | null;
  selling_price: number | null;
  packaging_cost: number | null;
  work_time_hours: number | null;
  labor_rate: number | null;
  selling_fee: number | null;
  work_time_cost: number | null;
  operating_benefit: number | null;
  ordinary_profit: number | null;
  is_listing: boolean | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: number;
  user_id: string;
  username: string;
  created_at: string;
  updated_at: string;
};

export type ItemWithCategories = Item & {
  categories: Pick<Category, "id" | "name" | "color">[];
};

export type PlannedItem = ItemWithCategories & { plan: Plan | null };
export type ListedItem = ItemWithCategories & { listing: Listing | null };
```
**逐行解説**
- 全型は**snake_case**(serializeの出力＝API/UIが使う形に一致)。
- `ItemStatus`: 4状態のユニオン型。
- `Item`/`Category`/`Plan`/`Listing`/各マスタ: Step1のテーブル列に1対1対応。`number | null`等でNULL許容を表現、日時は`string`(ISO/日付文字列)。
- `ItemWithCategories = Item & {...}`: **交差型**(Item＋`categories`配列)。`Pick<Category, "id"|"name"|"color">`はCategoryから3項目だけ抜いた型。
- `PlannedItem`/`ListedItem`: さらに`plan`/`listing`を足した画面用型。

---

## Step 4. `prisma/schema.prisma` を作成（イントロスペクション）

DBにマイグレーション適用後（Step 6）、`prisma db pull` で既存テーブルから生成し、フィールドを `@map` で **camelCase** に、モデルを PascalCase（`@@map` で実テーブル名へ）に整えます。これが Prisma Client のクエリ型になります。

```prisma
// DDL（テーブル/RLS/ロール/トリガ/関数/seed）は prisma/migrations の手書きSQLが正。
// このスキーマは Prisma Client のクエリ型として使う（イントロスペクション由来）。
generator client {
  provider      = "prisma-client-js"
  // native: ローカル開発 / linux-musl-arm64: 本番Docker(node:22-alpine, t4g/ARM)
  binaryTargets = ["native", "linux-musl-arm64-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @db.Uuid
  email     String   @unique
  username  String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  categories Category[]
  items      Item[]

  @@map("users")
}

model Category {
  id        Int      @id @default(autoincrement())
  userId    String?  @map("user_id") @db.Uuid
  name      String
  color     String   @default("#94a3b8")
  isPreset  Boolean  @default(false) @map("is_preset")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  user           User?          @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  itemCategories ItemCategory[]

  @@unique([userId, name])
  @@index([userId], map: "categories_user_idx")
  @@map("categories")
}

model Item {
  id          BigInt     @id @default(autoincrement())
  userId      String     @map("user_id") @db.Uuid
  status      ItemStatus
  name        String     @db.VarChar(255)
  imageUrl    String?    @map("image_url")
  janCode     String?    @map("jan_code") @db.VarChar(13)
  quantity    Int
  notes       String?
  actualPrice Int?       @map("actual_price")
  purchasedAt DateTime?  @map("purchased_at") @db.Date
  deletedAt   DateTime?  @map("deleted_at") @db.Timestamptz(6)
  createdAt   DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime   @default(now()) @map("updated_at") @db.Timestamptz(6)

  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  itemCategories ItemCategory[]
  listing        Listing?
  plan           Plan?

  @@index([userId, status, createdAt(sort: Desc)], map: "items_user_status_idx")
  @@map("items")
}

model ItemCategory {
  itemId     BigInt   @map("item_id")
  categoryId Int      @map("category_id")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  item     Item     @relation(fields: [itemId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@id([itemId, categoryId])
  @@index([categoryId], map: "items_categories_category_idx")
  @@map("items_categories")
}

model Plan {
  id                   BigInt   @id @default(autoincrement())
  itemId               BigInt   @unique @map("item_id")
  plannedPurchaseYear  Int?     @map("planned_purchase_year") @db.SmallInt
  plannedPurchaseMonth Int?     @map("planned_purchase_month") @db.SmallInt
  listPrice            Decimal? @map("list_price") @db.Decimal(10, 0)
  purchasePrice        Decimal? @map("purchase_price") @db.Decimal(10, 0)
  productUrl           String?  @map("product_url")
  dealPeriod           String?  @map("deal_period") @db.VarChar(255)
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  item Item @relation(fields: [itemId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@map("plans")
}

model Platform {
  id        Int       @id @default(autoincrement())
  name      String    @unique
  feeRate   Decimal   @map("fee_rate") @db.Decimal(5, 4)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
  listings  Listing[]

  @@map("platforms")
}

model Service {
  id              Int           @id @default(autoincrement())
  shippingService String        @unique @map("shipping_service")
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime      @default(now()) @map("updated_at") @db.Timestamptz(6)
  shipping        Shipping[]
  shippingFees    ShippingFee[]

  @@map("services")
}

model Size {
  id           Int           @id @default(autoincrement())
  shippingSize String        @unique @map("shipping_size")
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime      @default(now()) @map("updated_at") @db.Timestamptz(6)
  shipping     Shipping[]
  shippingFees ShippingFee[]

  @@map("sizes")
}

model Shipping {
  id                BigInt   @id @default(autoincrement())
  shippingServiceId Int      @map("shipping_service_id")
  shippingSizeId    Int      @map("shipping_size_id")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  listings Listing[]
  service  Service  @relation(fields: [shippingServiceId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  size     Size     @relation(fields: [shippingSizeId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@unique([shippingServiceId, shippingSizeId])
  @@map("shipping")
}

model ShippingFee {
  id                BigInt   @id @default(autoincrement())
  shippingServiceId Int      @map("shipping_service_id")
  shippingSizeId    Int      @map("shipping_size_id")
  fee               Decimal  @db.Decimal(10, 0)
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  service Service @relation(fields: [shippingServiceId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  size    Size    @relation(fields: [shippingSizeId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@unique([shippingServiceId, shippingSizeId])
  @@map("shipping_fees")
}

model Listing {
  id               BigInt   @id @default(autoincrement())
  itemId           BigInt   @unique @map("item_id")
  shippingId       BigInt?  @map("shipping_id")
  platformId       Int?     @map("platform_id")
  quantity         Int?
  sellingPrice     Decimal? @map("selling_price") @db.Decimal(10, 0)
  packagingCost    Decimal? @map("packaging_cost") @db.Decimal(10, 0)
  workTimeHours    Decimal? @map("work_time_hours") @db.Decimal(8, 2)
  laborRate        Decimal? @map("labor_rate") @db.Decimal(10, 0)
  sellingFee       Decimal? @map("selling_fee") @db.Decimal(10, 0)
  workTimeCost     Decimal? @map("work_time_cost") @db.Decimal(10, 0)
  operatingBenefit Decimal? @map("operating_benefit") @db.Decimal(10, 0)
  ordinaryProfit   Decimal? @map("ordinary_profit") @db.Decimal(10, 0)
  isListing        Boolean? @map("is_listing")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  item     Item      @relation(fields: [itemId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  platform Platform? @relation(fields: [platformId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  shipping Shipping? @relation(fields: [shippingId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@map("listings")
}

enum ItemStatus {
  planned
  owned
  listed
  sold

  @@map("item_status")
}
```
**逐行解説**
- `generator client { binaryTargets = [...] }`: Prisma Client を生成。`native`(ローカル)＋`linux-musl-arm64-openssl-3.0.x`(本番Docker)の両エンジンを取得。
- `datasource db { url = env("DATABASE_URL") }`: 接続先。CLI(`migrate`/`db pull`)が読む（アプリは`db/client.ts`がDB_*から組み立て）。
- `model User { ... @@map("users") }`: モデル名は PascalCase、`@@map`で実テーブル名へ。
- 列は`フィールド 型 @map("DB列名") @db.型詳細`。例`createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)`＝`timestamptz not null default now()`。`@map`で**コードはcamelCase / DBはsnake_case**を橋渡し。
- `id BigInt @id @default(autoincrement())`: `bigint`の自動採番。**返却時はBigInt**なので`serialize`でnumber化（Step 5）。
- `Decimal? @db.Decimal(10,0)`: `numeric`。**返却時はDecimal**なので`serialize`で`.toNumber()`。
- `@relation(fields:[..], references:[..], onDelete: Cascade)`: FK（連動削除）。逆side（`Item[]`等）でリレーションを張る。
- `@@id([itemId, categoryId])`複合主キー、`@unique`(plans/listingsのitemId)で1:1。
- CHECK制約・部分index・`nulls not distinct`・RLSは Prisma スキーマでは表現されない（Step 1のSQLが正）。`prisma db pull`実行時に警告が出るが無視してよい。

---

## Step 5. `src/db/serialize.ts` を作成

```ts
import { Prisma } from "@prisma/client";
import type {
  Item as ItemRow,
  Category as CategoryRow,
  Plan as PlanRow,
  Listing as ListingRow,
} from "@prisma/client";
import type { Item, Category, Plan, Listing } from "@/types/item";

// timestamptz(Date) → ISO 文字列
function iso(d: Date): string {
  return d.toISOString();
}
function isoOrNull(d: Date | null): string | null {
  return d == null ? null : d.toISOString();
}
// date 列(Date) → "YYYY-MM-DD"
function ymdOrNull(d: Date | null): string | null {
  return d == null ? null : d.toISOString().slice(0, 10);
}
// numeric(Decimal) → number
function decOrNull(d: Prisma.Decimal | null): number | null {
  return d == null ? null : d.toNumber();
}
// bigint → number（NextResponse.json は BigInt で例外になるため）
function bigToNum(b: bigint): number {
  return Number(b);
}
function bigToNumOrNull(b: bigint | null): number | null {
  return b == null ? null : Number(b);
}

export function toItem(r: ItemRow): Item {
  return {
    id: bigToNum(r.id),
    user_id: r.userId,
    status: r.status,
    name: r.name,
    image_url: r.imageUrl,
    jan_code: r.janCode,
    quantity: r.quantity,
    notes: r.notes,
    actual_price: r.actualPrice,
    purchased_at: ymdOrNull(r.purchasedAt),
    deleted_at: isoOrNull(r.deletedAt),
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}

export function toCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    user_id: r.userId,
    name: r.name,
    color: r.color,
    is_preset: r.isPreset,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}

export function toPlan(r: PlanRow): Plan {
  return {
    id: bigToNum(r.id),
    item_id: bigToNum(r.itemId),
    planned_purchase_year: r.plannedPurchaseYear,
    planned_purchase_month: r.plannedPurchaseMonth,
    list_price: decOrNull(r.listPrice),
    purchase_price: decOrNull(r.purchasePrice),
    product_url: r.productUrl,
    deal_period: r.dealPeriod,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}

export function toListing(r: ListingRow): Listing {
  return {
    id: bigToNum(r.id),
    item_id: bigToNum(r.itemId),
    shipping_id: bigToNumOrNull(r.shippingId),
    platform_id: r.platformId,
    quantity: r.quantity,
    selling_price: decOrNull(r.sellingPrice),
    packaging_cost: decOrNull(r.packagingCost),
    work_time_hours: decOrNull(r.workTimeHours),
    labor_rate: decOrNull(r.laborRate),
    selling_fee: decOrNull(r.sellingFee),
    work_time_cost: decOrNull(r.workTimeCost),
    operating_benefit: decOrNull(r.operatingBenefit),
    ordinary_profit: decOrNull(r.ordinaryProfit),
    is_listing: r.isListing,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}
```
**逐行解説**
- このファイルは**Prisma行(camelCase・BigInt/Decimal/Date) → アプリ型(snake_case・number・文字列)変換層**。画面/APIの型を変えずにバックエンドを差し替えられる。
- `import type { Item as ItemRow, ... } from "@prisma/client"`: 生成済みモデル行型をエイリアスでimport（`@/types/item`の同名型と衝突しないよう別名に）。
- `bigToNum`/`bigToNumOrNull`: **BigInt→number**。`NextResponse.json`はBigIntで例外になるため必須。
- `decOrNull`: **Decimal→number**（`.toNumber()`）。`ymdOrNull`: date列の`Date`→`"YYYY-MM-DD"`。`iso`/`isoOrNull`: timestamptzの`Date`→ISO文字列。
- `toItem(r)`: `r.userId→user_id`等の詰め替え＋上記変換。`toCategory`/`toPlan`/`toListing`も同様（idはBigInt→number、金額はDecimal→number）。

---

## Step 6. ローカル適用＆Client生成＆型チェック

```bash
# 所有者(monolog_admin)のURLで Prisma Migrate を適用（スキーマ/RLS/ロール → マスタ/seed）
DATABASE_URL="postgresql://monolog_admin:localdev@localhost:5433/monolog" npx prisma migrate deploy

# 既存DBから schema.prisma を生成（Step 4の形に camelCase 整形）。初回のみ
# DATABASE_URL="postgresql://monolog_admin:localdev@localhost:5433/monolog" npx prisma db pull

# Prisma Client を生成（型・クエリエンジン）
npx prisma generate

# 型チェック（schema.prisma/serialize/types と付録Bが揃っていれば通る）
npx tsc --noEmit
```
**逐行解説**
- `prisma migrate deploy`: `prisma/migrations`のSQLを順に適用。`DATABASE_URL`は所有者(`monolog_admin`)を指す（DDL/ロール作成のため）。
- 適用後、`monolog_app`ロールが初期パスワード`localapppw`で作られる(`.env.local`の`DB_PASSWORD=localapppw`と一致)。
- `prisma db pull`: 既存DBから`schema.prisma`を生成（Step 4の camelCase 整形は初回に1回）。以後スキーマ変更時に再実行。
- `prisma generate`: `@prisma/client`の型・クエリエンジンを生成。`npm install`では自動実行されない。
- `npx tsc --noEmit`: 型エラーが無いか確認。

---

## Step 7. `infra/migrate.ps1` を作成（本番RDSへの適用）

RDSは非公開でローカルから到達できず`prisma migrate deploy`を直接実行できないため、**`prisma/migrations`のSQLをS3経由でEC2に渡し、EC2の`psql`コンテナからRDSへ適用**する。実装の正本は[`infra/migrate.ps1`](../infra/migrate.ps1)とし、この付録には運用上の境界だけを記載する。スクリプトを複製するとマイグレーション追加時に手順書だけ古くなるため、全文は重複掲載しない。

```powershell
# 空のRDS: 全マイグレーションを適用
powershell -ExecutionPolicy Bypass -File migrate.ps1

# 初期マイグレーション適用済みスナップショットから復元: 追加分だけ適用
powershell -ExecutionPolicy Bypass -File migrate.ps1 -RestoredSnapshot

# AWSやDBを変更せず、候補だけ確認
powershell -ExecutionPolicy Bypass -File migrate.ps1 -RestoredSnapshot -ListMigrations
```

**処理の要点**

- `Get-ChildItem ... | Sort-Object Name`: `prisma/migrations`をディレクトリ名の日時順で列挙する。マイグレーション追加時にスクリプトへファイル名を追記する必要はない。
- `$SnapshotBaselineMigrations`: 保存済みスナップショットに含まれる初期マイグレーションを明示し、復元初回に適用済みとして記録する。
- `app.schema_migrations`: 適用済みのディレクトリ名を記録し、再実行や将来のSQL追加では未適用分だけを選ぶ。履歴のない既存DBを通常モードで変更しない。
- 実行ごとの一意なS3プレフィックス: 並行実行や前回の一時ファイルとの混在を防ぎ、処理後はローカル・S3・EC2の一時ファイルを削除する。
- `psql --single-transaction -v ON_ERROR_STOP=1`: 選択した全SQL、適用履歴、`monolog_app`のパスワード更新を1トランザクションにまとめる。1つでも失敗した場合、今回のDB変更は全体がロールバックされる。
- SSMコマンドの状態を最大10分ポーリングし、`Success`以外を失敗として扱う。タイムアウト時はキャンセルを要求し、表示されたコマンドIDが終了状態になるまで再実行しない。`migrations completed successfully`が表示されれば完了。

> `-RestoredSnapshot`は、現在保存している初期2件適用済みスナップショット向けである。将来、より新しいマイグレーションを含むスナップショットを基準にする場合は、`$SnapshotBaselineMigrations`とこの説明を同じPRで更新する。

---

## これで揃うもの
付録D(データ基盤)＋付録B(中核)＋付録C(API)＋付録A(インフラ)で、画面UI以外の構成と実装方針を追えます。運用スクリプトと残るUI(`app/*/page.tsx`・`components/*`・css)は、二重管理を避けるためリポジトリ内の実装を正本として参照します。
