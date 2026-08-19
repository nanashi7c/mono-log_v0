# 付録A: Terraform手順（インフラをゼロから作る）＋逐行解説

[setup-guide.md](setup-guide.md) の10章の詳細版。**ファイル作成→コマンド→確認**の手順形式で、空の`infra/`からAWS構成一式を作ります。各コードブロックの直後に**逐行解説**を付けています（同型の繰り返しは最初の1つを解説し、残りは差分のみ）。

- リージョン`ap-northeast-1`、プロジェクト名`mono-log`前提。
- 各ステップで`terraform plan`を打ち、「何が増えるか」を見ながら進めます。**実作成（課金開始）は最後のStep 8の`apply`**でまとめて行います。
- コマンドはすべて`infra/`内で実行します。

### HCLの基本文法（最初に1回だけ）
- `resource "種類" "名前" { ... }`: 作るリソース。`種類`はAWSの何か（例`aws_vpc`）、`名前`はTerraform内で参照する識別子。
- `data "種類" "名前" { ... }`: 既存情報の**読み取り**（作らない）。
- `変数参照`: `var.x`（変数）、`資源.名前.属性`（他リソースの値。例`aws_vpc.main.id`）、`data.種類.名前.属性`。
- `"${...}"`: 文字列中に値を埋め込む（補間）。例`"${var.project_name}-vpc"`。
- 依存関係はTerraformが参照から自動推論し、作成順を決める。

---

## Step 0. 準備（フォルダとtfstateバケット）

### 0-1. infraフォルダを作る
```bash
mkdir infra
cd infra
```
**逐行解説**
- `mkdir infra`: インフラ定義を入れるフォルダを作成。
- `cd infra`: 以降のコマンドはこの中で実行する。

### 0-2. 状態保存用のS3バケットを作る（最初の1回だけ）
```bash
aws sts get-caller-identity --query Account --output text
aws s3api create-bucket \
  --bucket mono-log-tfstate-＜あなたのアカウントID＞ \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1
```
**逐行解説**
- `aws sts get-caller-identity`: 今の認証情報が誰かを返す。`--query Account`でアカウントID(12桁)だけ、`--output text`で装飾なしの素の文字列で取り出す。
- `aws s3api create-bucket`: S3バケットを作る低レベルコマンド。
  - `--bucket ...`: バケット名。全世界で一意が必要なのでアカウントIDを付ける。
  - `--region ap-northeast-1`: 作成先リージョン。
  - `--create-bucket-configuration LocationConstraint=ap-northeast-1`: us-east-1以外では**リージョンの明示が必須**。これが無いとエラーになる。

> 手軽に試すだけなら0-2は省略し、Step 1の`backend "s3"`ブロックを削除してローカル保存にしてもよい。

---

## Step 1. 土台ファイルを作る → init

### 1-1. `infra/versions.tf`
```hcl
terraform {
  required_version = ">= 1.9"

  backend "s3" {
    bucket       = "mono-log-tfstate-＜あなたのアカウントID＞" # ← 変更
    key          = "infra/terraform.tfstate"
    region       = "ap-northeast-1"
    profile      = "default"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }
}
```
**逐行解説**
- `terraform { ... }`: Terraform自体の設定ブロック。
- `required_version = ">= 1.9"`: Terraform本体は1.9以上を要求（古いと文法差で動かないため）。
- `backend "s3" { ... }`: 状態ファイル(tfstate=現在の構成記録)の保存先をS3にする宣言。
  - `bucket`: 0-2で作った自分のバケット名。
  - `key`: バケット内でのファイルパス。
  - `region`: バケットのリージョン。
  - `profile = "default"`: 認証に使う`~/.aws`のプロファイル名。
  - `encrypt = true`: 保存時に暗号化（SSE）。
  - `use_lockfile = true`: S3だけで排他ロック（同時applyの衝突防止。従来必要だったDynamoDB不要）。
- `required_providers { ... }`: 使うプロバイダ（AWSを操作するプラグイン）の宣言。
  - `aws = { source = "hashicorp/aws", version = "~> 6.0" }`: AWSプロバイダの6.x系を使う（`~> 6.0`は「6系の最新」を許す書き方）。
  - `random = { ... "~> 3.0" }`: パスワード乱数生成に使うrandomプロバイダ3.x系。

### 1-2. `infra/provider.tf`
```hcl
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
```
**逐行解説**
- `provider "aws" { ... }`: AWSプロバイダの実設定。
- `region = var.aws_region`: 操作対象リージョンを変数から取る（1-3で定義）。
- `profile = var.aws_profile`: 使う認証プロファイルを変数から。
- `default_tags { tags = {...} }`: このプロバイダで作る**全リソースに自動で付くタグ**。`Project`と`ManagedBy`を付け、後で「これはTerraform管理/このプロジェクトのもの」と識別・課金集計しやすくする。

### 1-3. `infra/variables.tf`
```hcl
variable "aws_region" {
  description = "リソースを作成する AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_profile" {
  description = "認証に使う AWS CLI プロファイル名"
  type        = string
  default     = "default"
}

variable "project_name" {
  description = "リソース名やタグに使うプロジェクト名"
  type        = string
  default     = "mono-log"
}

variable "db_deletion_safety" {
  description = "RDS の削除保護と最終スナップショットをまとめて制御する。通常は既定値を使用する。"
  type = object({
    protection_enabled        = bool
    final_snapshot_identifier = optional(string)
  })
  default = {
    protection_enabled = true
  }

  validation {
    condition = var.db_deletion_safety.protection_enabled ? (
      var.db_deletion_safety.final_snapshot_identifier == null
      ) : try(
      length(var.db_deletion_safety.final_snapshot_identifier) <= 255 &&
      can(regex("^[A-Za-z][A-Za-z0-9-]*$", var.db_deletion_safety.final_snapshot_identifier)) &&
      !endswith(var.db_deletion_safety.final_snapshot_identifier, "-") &&
      !strcontains(var.db_deletion_safety.final_snapshot_identifier, "--"),
      false
    )
    error_message = "削除保護を無効にする場合は、英字で始まり、英数字と単一ハイフンだけを使う255文字以内の final_snapshot_identifier が必要です。通常運用では protection_enabled=true のみを指定してください。"
  }
}
```
**逐行解説**
- `variable "aws_region" { ... }`: 入力変数の定義。`var.aws_region`で参照される。
  - `description`: 説明（`terraform`の表示やドキュメント用）。
  - `type = string`: 文字列型。
  - `default = "ap-northeast-1"`: 未指定時の既定値（指定しなければ東京）。
- `aws_profile`/`project_name`の既定値は、それぞれ`default`/`mono-log`。
- `db_deletion_safety`: 通常は`protection_enabled=true`でRDSの誤削除を防ぐ。保護を解除する場合は、AWSの命名規則を満たす`final_snapshot_identifier`も必須にする。
- `validation`: 通常モードと意図的な削除モード以外の組み合わせを、AWSへ変更を送る前に拒否する。

### 1-4. `infra/main.tf`
```hcl
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
```
**逐行解説**
- `data "aws_caller_identity" "current" {}`: 今の実行者（アカウントID/ARN）を**読み取る**。`data.aws_caller_identity.current.account_id`等で他ファイルから使う（S3バケット名やIAM ARN組み立てに必要）。
- `data "aws_region" "current" {}`: 現在のリージョンを読み取る。

### 1-5. `infra/output.tf`
```hcl
output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
output "caller_arn" {
  value = data.aws_caller_identity.current.arn
}
output "region" {
  value = data.aws_region.current.region
}
```
**逐行解説**
- `output "account_id" { value = ... }`: `terraform apply`後や`terraform output`で表示される値。確認用。
- 3つともデータソースから値を取り出して表示するだけ（リソースは作らない）。

### 1-6. 初期化
```bash
terraform init
terraform plan
```
**逐行解説**
- `terraform init`: プロバイダのダウンロードとbackend(S3)の初期化。最初と、プロバイダ/backend変更時に実行。
- `terraform plan`: 現状と定義の差分を計算して表示（**何も作らない**読み取り操作）。この時点では実リソースが無いのでほぼ「0 to add」。

---

## Step 2. ネットワーク（VPC）→ plan

### 2-1. `infra/network.tf`
```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "${var.project_name}-vpc" }
}
```
**逐行解説**
- `resource "aws_vpc" "main"`: 仮想ネットワーク(VPC)を1つ作る。`main`はTerraform内の名前。
- `cidr_block = "10.0.0.0/16"`: このVPCで使うプライベートIP範囲（10.0.0.0〜10.0.255.255の約6.5万個）。
- `enable_dns_support = true`: VPC内でDNS解決を有効化。
- `enable_dns_hostnames = true`: 起動リソースにDNSホスト名を付与（RDS等が名前で繋ぐのに必要）。
- `tags = { Name = "${var.project_name}-vpc" }`: コンソール表示名（例`mono-log-vpc`）。

```hcl
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}
```
**逐行解説**
- `aws_internet_gateway`: VPCをインターネットに繋ぐ出入口(IGW)。
- `vpc_id = aws_vpc.main.id`: どのVPCに付けるか。`aws_vpc.main.id`で上のVPCのIDを参照（この参照によりTerraformは「VPC→IGWの順」と判断）。

```hcl
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.0.0/24"
  availability_zone       = "ap-northeast-1a"
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project_name}-public-a" }
}
```
**逐行解説**
- `aws_subnet "public_a"`: VPCを区切ったサブネット（EC2を置くpublic用）。
- `vpc_id`: 所属VPC。
- `cidr_block = "10.0.0.0/24"`: このサブネットのIP範囲（256個）。VPCの`/16`の一部。
- `availability_zone = "ap-northeast-1a"`: 物理的に分かれたデータセンタ群の1つ（AZ）。
- `map_public_ip_on_launch = true`: ここで起動したEC2に自動でパブリックIPを付与（外部到達に必要）。

```hcl
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "ap-northeast-1a"
  tags              = { Name = "${var.project_name}-private-a" }
}
resource "aws_subnet" "private_c" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "ap-northeast-1c"
  tags              = { Name = "${var.project_name}-private-c" }
}
```
**逐行解説**
- RDS用のprivateサブネット2つ。`public_a`との違いは`map_public_ip_on_launch`が**無い**（=外部IPを付けない＝非公開）こと。
- 2つ作る理由: RDSは「DBサブネットグループに**2つ以上のAZ**」を要求するため。`private_a`(1a)と`private_c`(1c)で別AZにしている。CIDRは重複しないよう`10.0.10.0/24`と`10.0.11.0/24`。

```hcl
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project_name}-public-rt" }
}
resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}
```
**逐行解説**
- `aws_route_table "public"`: 通信の行き先表（ルートテーブル）。
- `route { cidr_block = "0.0.0.0/0"; gateway_id = ...igw }`: 「すべての宛先(0.0.0.0/0=インターネット)はIGWへ流す」というルール。これでpublicサブネットは外に出られる。
- `aws_route_table_association "public_a"`: ルートテーブルとサブネットの**紐付け**。`subnet_id`(public_a)に`route_table_id`(public)を適用。

```hcl
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-private-rt" }
}
resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}
resource "aws_route_table_association" "private_c" {
  subnet_id      = aws_subnet.private_c.id
  route_table_id = aws_route_table.private.id
}
```
**逐行解説**
- privateルートテーブルは`route`ブロックを**持たない**。VPC内のローカル通信(自動付与)だけになり、**インターネットへは出られない**（RDSを隔離する意図）。
- 2つのprivateサブネットを同じprivateルートテーブルに紐付け。

### 2-2. 確認
```bash
terraform plan
```
**逐行解説**: VPC/IGW/サブネット3/ルートテーブル2/関連付け3 などが「will be created」と並べばOK。

---

## Step 3. 認証・保管庫（Cognito / S3 / ECR）→ plan

### 3-1. `infra/cognito.tf`
```hcl
resource "aws_cognito_user_pool" "main" {
  name                     = "${var.project_name}-user-pool"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  tags = { Name = "${var.project_name}-user-pool" }
}
```
**逐行解説**
- `aws_cognito_user_pool "main"`: 認証基盤(ユーザの入れ物)。
- `name`: プール名。
- `username_attributes = ["email"]`: **メールアドレスをログインID**にする。
- `auto_verified_attributes = ["email"]`: 登録時にメール確認コードを自動送信し確認させる。
- `password_policy { ... }`: パスワード要件。最低8文字・小文字・大文字・数字を必須、記号は不要。
- `account_recovery_setting { recovery_mechanism { name = "verified_email"; priority = 1 } }`: パスワード回復は「確認済みメール」経由を最優先(priority 1)に。
- `tags`: 表示名。

```hcl
resource "aws_cognito_user_pool_client" "web" {
  name            = "${var.project_name}-web-client"
  user_pool_id    = aws_cognito_user_pool.main.id
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}
```
**逐行解説**
- `aws_cognito_user_pool_client "web"`: アプリが認証に使う「クライアント」設定。
- `user_pool_id`: どのプールに属するか。
- `generate_secret = false`: クライアントシークレットを**作らない**（ブラウザ/公開クライアント想定。秘密を埋め込めないため）。
- `explicit_auth_flows = [...]`: 許可する認証方式。`USER_PASSWORD_AUTH`(email+password)、`USER_SRP_AUTH`(安全なSRP)、`REFRESH_TOKEN_AUTH`(再発行)。アプリはこれらを使う。
- `*_token_validity` と `token_validity_units`: トークン有効期限。アクセス/IDは1時間、リフレッシュは30日。`units`で単位(hours/days)を指定。

```hcl
resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name  = "/${var.project_name}/cognito/user_pool_id"
  type  = "String"
  value = aws_cognito_user_pool.main.id
}
resource "aws_ssm_parameter" "cognito_client_id" {
  name  = "/${var.project_name}/cognito/client_id"
  type  = "String"
  value = aws_cognito_user_pool_client.web.id
}
```
**逐行解説**
- `aws_ssm_parameter`: 設定値の保管(SSM Parameter Store)。アプリ(EC2)が起動時に読む。
- `name`: パラメータのパス（例`/mono-log/cognito/user_pool_id`）。
- `type = "String"`: 非機密の平文（IDは秘密でないため。パスワード類は後で`SecureString`）。
- `value`: 上で作ったプールID/クライアントIDを参照して格納。
- 2つは`name`と`value`だけ違う同形。

### 3-2. `infra/storage.tf`
```hcl
resource "aws_s3_bucket" "item_images" {
  bucket = "${var.project_name}-item-images-${data.aws_caller_identity.current.account_id}"
  tags   = { Name = "${var.project_name}-item-images" }
}
```
**逐行解説**
- `aws_s3_bucket "item_images"`: 商品画像用バケット。
- `bucket = "...-${data.aws_caller_identity.current.account_id}"`: 名前は全世界一意が必要なので、末尾にアカウントIDを補間して衝突回避。

```hcl
resource "aws_s3_bucket_public_access_block" "item_images" {
  bucket                  = aws_s3_bucket.item_images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```
**逐行解説**
- 公開を全方向でブロックする安全設定。4つの`true`で「ACLでの公開」「ポリシーでの公開」を作成も適用も禁止。誤って画像が全世界公開されるのを防ぐ（アプリは署名付きURLで配るので公開不要）。

```hcl
resource "aws_s3_bucket_server_side_encryption_configuration" "item_images" {
  bucket = aws_s3_bucket.item_images.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
```
**逐行解説**
- 保存時の暗号化(SSE-S3/AES256)を既定にする。

```hcl
resource "aws_ssm_parameter" "s3_bucket" {
  name  = "/${var.project_name}/s3/bucket"
  type  = "String"
  value = aws_s3_bucket.item_images.bucket
}
```
**逐行解説**: バケット名をSSMへ。EC2が`S3_IMAGE_BUCKET`として読む。

### 3-3. `infra/ecr.tf`
```hcl
resource "aws_ecr_repository" "app" {
  name                 = "${var.project_name}-app"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
  tags = { Name = "${var.project_name}-app" }
}

resource "aws_ssm_parameter" "deployed_image_tag" {
  name        = "/${var.project_name}/deploy/image_tag"
  description = "Immutable ECR image tag currently selected for deployment"
  type        = "String"
  value       = "not-deployed"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "previous_deployed_image_tag" {
  name        = "/${var.project_name}/deploy/previous_image_tag"
  description = "Previous immutable ECR image tag available for rollback"
  type        = "String"
  value       = "not-deployed"
  lifecycle { ignore_changes = [value] }
}
```
**逐行解説**
- `aws_ecr_repository "app"`: Dockerイメージ置き場(ECR)。
- `image_tag_mutability = "IMMUTABLE"`: commit SHA等の同じタグを上書きできないようにし、タグとイメージ内容の対応を固定する。
- `image_scanning_configuration { scan_on_push = true }`: push時に脆弱性スキャン。
- `encryption_configuration { encryption_type = "AES256" }`: 保存時暗号化。
- 2つのSSMパラメータは現在と直前の配備タグを保持する。初回は`not-deployed`で、`deploy.ps1`が実際のタグへ変更する。
- `ignore_changes = [value]`: Terraformはパラメータ自体を管理しつつ、デプロイ後の値を初期値へ戻さない。

```hcl
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}
```
**逐行解説**
- 古いイメージを自動削除する寿命ポリシー（容量=コスト管理）。
- `jsonencode({...})`: HCLのオブジェクトをJSON文字列に変換（ECRのpolicyはJSONを要求するため）。
- `selection`: 「タグ問わず(any)、10個を超えた(imageCountMoreThan 10)分」を対象に、`action.type = "expire"`で期限切れ＝削除。

### 3-4. 確認
```bash
terraform plan
```
**逐行解説**: Cognito/S3/ECR/各SSMが追加予定で並べばOK。

---

## Step 4. データベース（RDS）→ plan

### 4-1. `infra/database.tf`
```hcl
resource "random_password" "db" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}
```
**逐行解説**
- `random_password "db"`: マスターパスワードを乱数生成。
- `length = 24`: 24文字。
- `special = true`: 記号を含める。
- `override_special = "..."`: 使う記号集合を指定。RDSが禁止する`/ @ "`と空白を**除外**した集合にしている（これらを含むと作成失敗するため）。

```hcl
resource "aws_ssm_parameter" "db_password" {
  name        = "/${var.project_name}/db/password"
  description = "RDS master password (${var.project_name})"
  type        = "SecureString"
  value       = random_password.db.result
}
```
**逐行解説**
- 生成したマスターパスワードをSSMへ。
- `type = "SecureString"`: **KMSで暗号化**して保存（機密のため。Cognito IDの`String`と違う）。
- `value = random_password.db.result`: 上の乱数の結果(`.result`)を格納。

```hcl
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]
  tags       = { Name = "${var.project_name}-db-subnet-group" }
}
```
**逐行解説**
- RDSを配置するサブネットの集合。`subnet_ids`に**2つのprivateサブネット**(別AZ)を渡す（RDSのマルチAZ要件）。

```hcl
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds-sg"
  description = "PostgreSQL access for RDS"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from app EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project_name}-rds-sg" }
}
```
**逐行解説**
- `aws_security_group "rds"`: RDSの仮想ファイアウォール。
- `ingress { ... }`: 受信ルール。`from_port`/`to_port`=5432(PostgreSQL)、`protocol="tcp"`、`security_groups=[EC2のSG]`＝**アプリEC2からの5432だけ**許可。同じVPC内でも、EC2用SGが付いていないリソースからは接続できない。
- `egress { from_port=0; to_port=0; protocol="-1"; cidr_blocks=["0.0.0.0/0"] }`: 送信は全許可(`-1`=全プロトコル)。

```hcl
resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true

  db_name  = "monolog"
  username = "monolog_admin"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = false
  publicly_accessible    = false

  auto_minor_version_upgrade = true
  backup_retention_period    = 7

  deletion_protection       = var.db_deletion_safety.protection_enabled
  skip_final_snapshot       = var.db_deletion_safety.final_snapshot_identifier == null
  final_snapshot_identifier = var.db_deletion_safety.final_snapshot_identifier
  tags                = { Name = "${var.project_name}-db" }
}
```
**逐行解説**
- `identifier`: RDSの識別子(名前)。
- `engine = "postgres"` / `engine_version = "16"`: PostgreSQL 16。
- `instance_class = "db.t4g.micro"`: 最小クラス(ARM/Graviton・最安)。
- `allocated_storage = 20` / `storage_type = "gp2"` / `storage_encrypted = true`: 20GB・汎用SSD・暗号化。
- `db_name = "monolog"`: 初期DB名。
- `username = "monolog_admin"` / `password = random_password.db.result`: マスターユーザと、上で生成したパスワード。
- `db_subnet_group_name` / `vpc_security_group_ids`: 配置するサブネットグループとSG。
- `multi_az = false`: コスト最小のためSingle-AZ。
- `publicly_accessible = false`: インターネット非公開。
- `auto_minor_version_upgrade = true`: マイナー版自動更新。
- `backup_retention_period = 7`: 自動バックアップ7日保持。
- `deletion_protection`: 通常は`true`となり、RDS APIによる削除を拒否する。
- `skip_final_snapshot`: 最終スナップショット名がある意図的な削除モードだけ`false`となる。
- `final_snapshot_identifier`: 削除前に作成するスナップショットの名前。削除保護を解除するときは必須。

```hcl
resource "aws_ssm_parameter" "db_host" {
  name  = "/${var.project_name}/db/host"
  type  = "String"
  value = aws_db_instance.main.address
}
resource "aws_ssm_parameter" "db_port" {
  name  = "/${var.project_name}/db/port"
  type  = "String"
  value = tostring(aws_db_instance.main.port)
}
resource "aws_ssm_parameter" "db_name" {
  name  = "/${var.project_name}/db/name"
  type  = "String"
  value = aws_db_instance.main.db_name
}
resource "aws_ssm_parameter" "db_username" {
  name  = "/${var.project_name}/db/username"
  type  = "String"
  value = aws_db_instance.main.username
}
```
**逐行解説**
- 接続情報4つをSSMへ（アプリが読む）。すべて`String`(非機密)。
- `db_host`: `aws_db_instance.main.address`＝RDSのエンドポイント(ホスト名)。
- `db_port`: `tostring(...port)`＝ポートは数値なので`tostring`で文字列化(SSMは文字列)。
- `db_name`/`db_username`: それぞれDB名・マスターユーザ名。

```hcl
resource "random_password" "db_app" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}
resource "aws_ssm_parameter" "db_app_password" {
  name        = "/${var.project_name}/db/app_password"
  description = "Password for the non-owner app role monolog_app"
  type        = "SecureString"
  value       = random_password.db_app.result
}
```
**逐行解説**
- マスターとは別に、**アプリ接続ロール`monolog_app`用のパスワード**を生成しSSM(`SecureString`)へ。
- このロールはRLSが効く非所有者。パスワードの**適用**(ALTER ROLE)はデプロイ時に`migrate.ps1`が行う（ここは値の保管のみ）。

### 4-2. 確認
```bash
terraform plan
```
**逐行解説**: RDS・サブネットグループ・SG・各SSMが並べばOK。

---

## Step 5. サーバ（EC2 + IAM + SG）→ plan

### 5-1. `infra/compute.tf`（核心。ブロックごとに解説）

```hcl
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}
```
**逐行解説**
- `data "aws_iam_policy_document"`: IAMポリシーのJSONを組み立てるヘルパ。
- `statement { actions = ["sts:AssumeRole"]; principals { type="Service"; identifiers=["ec2.amazonaws.com"] } }`: 「**EC2サービスがこのロールを引き受け(AssumeRole)てよい**」という信頼ポリシー。これがないとEC2にロールを持たせられない。

```hcl
resource "aws_iam_role" "ec2" {
  name               = "${var.project_name}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = { Name = "${var.project_name}-ec2-role" }
}
```
**逐行解説**
- EC2に持たせるIAMロール本体。`assume_role_policy`に上の信頼ポリシーの`.json`を渡す。

```hcl
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}
```
**逐行解説**
- AWS管理ポリシーをロールに**アタッチ**。
- `ssm_core`: SSM接続(SSH不要でシェル/コマンド実行)に必要な`AmazonSSMManagedInstanceCore`。
- `ecr_read`: ECRからイメージをpullするための読み取り権限。

```hcl
data "aws_iam_policy_document" "ssm_read" {
  statement {
    sid       = "ReadAppParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/*"]
  }
  statement {
    sid       = "DecryptViaSsmOnly"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}
```
**逐行解説**
- 自前の最小権限ポリシー(2文)。
- 文1 `ReadAppParameters`: `ssm:GetParameter*`を、**`/mono-log/*`のパラメータに限定**して許可(`resources`のARNで絞る)。
- 文2 `DecryptViaSsmOnly`: `SecureString`復号に要る`kms:Decrypt`を許可するが、`condition`で`kms:ViaService = ssm...`＝**SSM経由の復号に限定**（KMSを直接叩く濫用を防ぐ）。

```hcl
resource "aws_iam_role_policy" "ssm_read" {
  name   = "${var.project_name}-ssm-read"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ssm_read.json
}
```
**逐行解説**: 上のポリシー文をロールに**インライン**で付与。

```hcl
data "aws_iam_policy_document" "app" {
  statement {
    sid       = "ItemImagesObjectRW"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.item_images.arn}/*"]
  }
}
resource "aws_iam_role_policy" "app" {
  name   = "${var.project_name}-app"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.app.json
}
```
**逐行解説**
- アプリ機能に要る権限。
- S3の画像オブジェクトの読み/書き/削除を、**そのバケットのオブジェクト(`/*`)に限定**。
- `aws_iam_role_policy "app"`でロールに付与。

```hcl
resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}
```
**逐行解説**
- EC2にIAMロールを渡すための「インスタンスプロファイル」(EC2はロールを直接ではなくこれ経由で持つ)。

```hcl
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
```
**逐行解説**
- AWS管理の「CloudFrontのオリジン向けIP範囲」一覧を読み取る。これをSGで使い、**CloudFront以外からのアクセスを弾く**。

```hcl
resource "aws_security_group" "ec2" {
  name        = "${var.project_name}-ec2-sg"
  description = "Allow HTTP from CloudFront only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from CloudFront"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project_name}-ec2-sg" }
}
```
**逐行解説**
- EC2のSG。`ingress`は80番(HTTP)を`prefix_list_ids`(CloudFrontのオリジン向けIP範囲)からのみ許可し、インターネットからEC2への直接接続を防ぐ。別のCloudFront distributionとの区別は、後述する秘密ヘッダーの照合で行う。
- `egress`は全許可(ECR/SSM/Cognito/S3への外向き通信に必要)。

```hcl
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
```
**逐行解説**
- 起動に使うOSイメージ(AMI)を検索。`owners=["amazon"]`、`name`が`al2023-ami-*-arm64`(Amazon Linux 2023のARM版)、`virtualization-type=hvm`の条件で、`most_recent=true`で**最新**を選ぶ。

```hcl
resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t4g.micro"
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  depends_on = [
    aws_ssm_parameter.cloudfront_origin_verify_secret,
    aws_ssm_parameter.deployed_image_tag,
  ]
  user_data = <<-EOF
... (後述の起動スクリプト) ...
EOF
  metadata_options {
    http_tokens = "required"
  }
  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }
  tags = { Name = "${var.project_name}-ec2" }
}
```
**逐行解説（EC2本体）**
- `ami`: 上で見つけた最新AL2023。
- `instance_type = "t4g.micro"`: 最小ARMインスタンス。
- `subnet_id = aws_subnet.public_a.id`: publicサブネットに配置(外部到達のため)。
- `vpc_security_group_ids`: 上のEC2用SGを適用。
- `iam_instance_profile`: 上のプロファイル＝ロールを付与。
- `depends_on`: オリジン検証秘密値と配備タグ用SSMパラメータが作られてからEC2を起動し、初回の設定取得失敗を防ぐ。
- `user_data = <<-EOF ... EOF`: **起動時に1回だけ走るシェルスクリプト**(下で詳説)。`<<-EOF`はヒアドキュメント(複数行文字列)。
- `metadata_options { http_tokens = "required" }`: IMDSv2を強制(認証情報の盗用対策)。
- `root_block_device { volume_size = 30; volume_type = "gp3"; encrypted = true }`: ルートディスク30GB(最新AL2023 AMIのスナップショットが30GBのため20では作成失敗)・gp3・暗号化。

**user_data（起動スクリプト）の逐行解説**
```bash
#!/bin/bash
set -euo pipefail
dnf install -y docker
systemctl enable --now docker
```
- `#!/bin/bash`: bashで実行。
- `set -euo pipefail`: エラーで停止(`-e`)・未定義変数で停止(`-u`)・パイプ失敗も検知(`pipefail`)。安全実行の定番。
- `dnf install -y docker`: Dockerを導入(`-y`で確認なし)。
- `systemctl enable --now docker`: Dockerを起動＋自動起動有効化。

```bash
cat > /etc/mono-log.env <<ENV
REGION=${var.aws_region}
PROJECT=${var.project_name}
REGISTRY=${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com
REPOSITORY=${aws_ecr_repository.app.repository_url}
ENV
```
- `cat > /etc/mono-log.env <<ENV ... ENV`: 非機密の設定ファイルを書き出す。`${var...}`等は**Terraformが値を埋め込む**(apply時に確定)。
- `REGISTRY`/`REPOSITORY`: ECRのログイン先とリポジトリURL。可変の配備タグはSSMから別に取得する。

```bash
cat > /usr/local/bin/mono-log-run.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail
. /etc/mono-log.env
get() { aws ssm get-parameter --region "$REGION" --name "$1" $2 --query Parameter.Value --output text; }
DB_HOST=$(get "/$PROJECT/db/host" "")
...
ORIGIN_VERIFY_SECRET=$(get "/$PROJECT/cloudfront/origin_verify_secret" "--with-decryption")
IMAGE_TAG=$(get "/$PROJECT/deploy/image_tag" "")
if [ -z "$IMAGE_TAG" ] || [ "$IMAGE_TAG" = "not-deployed" ]; then
  echo "No deployed image tag is configured in SSM" >&2
  exit 1
fi
IMAGE="$REPOSITORY:$IMAGE_TAG"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker pull "$IMAGE"
docker rm -f mono-log >/dev/null 2>&1 || true
docker run -d --name mono-log --restart unless-stopped -p 80:3000 \
  -e NODE_ENV=production \
  -e DB_HOST="$DB_HOST" ... \
  -e CLOUDFRONT_ORIGIN_VERIFY_SECRET="$ORIGIN_VERIFY_SECRET" \
  "$IMAGE"
SCRIPT
chmod +x /usr/local/bin/mono-log-run.sh
```
- `cat > ... <<'SCRIPT' ... SCRIPT`: コンテナ起動スクリプトを書き出す。クォート付き`'SCRIPT'`なので**中の`$`はそのまま**(Terraformでなく実行時のbashが評価)。
- `. /etc/mono-log.env`: 上のenvファイルを読み込み(`REGION`等が使える)。
- `get() { aws ssm get-parameter ... }`: SSMから値を取る関数。`$2`に`--with-decryption`を渡せば`SecureString`を復号。
- `DB_HOST=$(get ...)`等: DB接続情報・Cognito ID・バケット名・**アプリ用DBパスワードとCloudFrontオリジン検証秘密値(復号)**に加え、現在の固定イメージタグをSSMから取得。
- 配備タグが初期値`not-deployed`なら、存在しないイメージを暗黙に使わず明示的に停止する。`deploy.ps1`の初回成功後は、再起動時も同じタグをpullする。
- `aws ecr get-login-password | docker login ...`: ECRにログイン。
- `docker pull "$IMAGE"` → `docker rm -f mono-log || true` → `docker run -d ...`: SSMで選ばれた固定タグを取得し、既存コンテナを消してから起動。
- `docker run`の主オプション: `-d`(常駐)、`--restart unless-stopped`(再起動時も自動復帰)、`-p 80:3000`(ホスト80→コンテナ3000)、`-e KEY=VALUE`(環境変数。DB/Cognito/S3/オリジン検証秘密値/NODE_ENV=productionを渡す)。
- `chmod +x`: スクリプトに実行権限。

```bash
cat > /etc/systemd/system/mono-log.service <<'UNIT'
[Unit]
Description=mono-log app container
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/mono-log-run.sh
Restart=on-failure
RestartSec=30
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now mono-log.service || true
```
- systemdサービス定義。`After/Requires=docker.service`でDocker起動後に動く。
- `Type=oneshot`+`RemainAfterExit=yes`: 一度走って終わる処理を「起動済み」とみなす。
- `ExecStart`: 上の起動スクリプトを実行。
- `Restart=on-failure`/`RestartSec=30`: 失敗時に30秒ごと再試行。初回は配備タグが`not-deployed`なので待機し、`deploy.ps1`がタグを設定してserviceを再起動する。
- `systemctl daemon-reload` → `enable --now`: 定義を読み込み、有効化＋起動。

### 5-2. 確認
```bash
terraform plan
```
**逐行解説**: IAMロール/ポリシー/プロファイル・EC2用SG・EC2本体が並べばOK。

---

## Step 6. CDN（CloudFront）→ plan

### 6-1. `infra/cdn.tf`
```hcl
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "random_password" "cloudfront_origin_verify" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "cloudfront_origin_verify_secret" {
  name        = "/${var.project_name}/cloudfront/origin_verify_secret"
  description = "Shared secret for verifying CloudFront origin requests"
  type        = "SecureString"
  value       = random_password.cloudfront_origin_verify.result
}
```
**逐行解説**
- AWS管理のポリシーを読み取る。`Managed-CachingDisabled`=キャッシュしない、`Managed-AllViewer`=全ヘッダ/Cookie/クエリをオリジンへ転送。動的アプリ向け。
- `random_password`: 特定のCloudFront distributionとEC2上のアプリだけが共有する48文字の秘密値を生成。
- `aws_ssm_parameter`: 生成値をSecureStringとして保存し、EC2起動時に復号してコンテナへ渡す。秘密値をコードやEC2のuser dataへ直接埋め込まない。

```hcl
resource "aws_cloudfront_distribution" "app" {
  enabled = true
  comment = "${var.project_name} app distribution"

  origin {
    domain_name = aws_instance.app.public_dns
    origin_id   = "ec2-origin"
    custom_header {
      name  = "X-Mono-Log-Origin-Verify"
      value = random_password.cloudfront_origin_verify.result
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "ec2-origin"
    viewer_protocol_policy    = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  price_class = "PriceClass_200"
  tags        = { Name = "${var.project_name}-cdn" }
}
```
**逐行解説**
- `aws_cloudfront_distribution "app"`: CDN/TLS終端。
- `origin { domain_name = aws_instance.app.public_dns; ... }`: 配信元はEC2のパブリックDNS。
  - `custom_header`: CloudFrontからオリジンへ送る要求へ秘密ヘッダーを追加する。同名ヘッダーを閲覧者が送ってもCloudFrontの設定値で上書きされる。
  - `custom_origin_config`: EC2への接続設定。`origin_protocol_policy = "http-only"`＝CloudFront→EC2は**HTTP**(内部)。`origin_ssl_protocols`はHTTPS時のTLS版(ここでは未使用だが必須項目)。
- `default_cache_behavior { ... }`: 既定の配信動作。
  - `viewer_protocol_policy = "redirect-to-https"`: 視聴者には**HTTPSを強制**(HTTPはHTTPSへリダイレクト)。
  - `allowed_methods`: 全メソッド許可(更新系APIのため)。`cached_methods`はGET/HEADのみ。
  - `cache_policy_id`/`origin_request_policy_id`: 上の「キャッシュ無効」「全転送」を適用。
- `restrictions { geo_restriction { restriction_type = "none" } }`: 地域制限なし。
- `viewer_certificate { cloudfront_default_certificate = true }`: `*.cloudfront.net`の既定証明書を使う(独自ドメイン不要)。
- `price_class = "PriceClass_200"`: 配信エッジ範囲(北米/欧州/アジア含む。全エッジより安い)。

### 6-2. 確認
```bash
terraform plan
```
**逐行解説**: CloudFront distribution、秘密値、SSM SecureStringが並べばOK。秘密値そのものがplan出力へ表示されていないことも確認する。

---

## Step 7. 全体の最終確認 → Step 8. apply

```bash
terraform plan
terraform apply   # yes
```
**逐行解説**
- `plan`: 「Plan: NN to add, 0 to change, 0 to destroy」(NNは40件前後)を確認。まだ未作成。
- `apply`: `yes`で実作成。**RDS/CloudFrontは数分**かかる。完了でSSMに各値が入る。

### 確認
```bash
terraform output
aws ssm get-parameter --region ap-northeast-1 --name /mono-log/cognito/user_pool_id --query Parameter.Value --output text
aws ssm get-parameter --region ap-northeast-1 --name /mono-log/s3/bucket            --query Parameter.Value --output text
aws ssm get-parameter --region ap-northeast-1 --name /mono-log/db/host              --query Parameter.Value --output text
```
**逐行解説**
- `terraform output`: 1-5で定義した出力(アカウントID等)を表示。
- 各`aws ssm get-parameter`: アプリが使う値(Cognito ID/バケット名/DBホスト)が実際に入っているか確認。`--query Parameter.Value`で値だけ、`--output text`で素の文字列。

> 初回構築では配備タグが`not-deployed`のためアプリ未起動（systemdが再試行中）。再作成時はSSMに残る固定タグのイメージがECRにあれば自動起動する。

---

## 次のステップ
1. [11章: 本番DBマイグレーション](setup-guide.md#11-本番dbマイグレーションmigrateps1)
2. [12章: デプロイ](setup-guide.md#12-デプロイビルド--ecr--コンテナ起動)
3. [13章: 動作確認](setup-guide.md#13-動作確認)

### 段階的applyの補足
各ステップ直後に`terraform apply -target=<リソース>`で部分適用も可能。ただし依存(compute→network/ecr/cognito/storage、cdn→compute)があるため、最終的には`-target`なしの`apply`で全体を揃える。
