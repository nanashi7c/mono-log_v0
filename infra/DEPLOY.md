# デプロイ / 再デプロイ手順

AWS 構成: CloudFront → EC2(Docker) → RDS(Postgres) / Cognito / S3。
コスト削減のため RDS・EC2・CloudFront は普段 destroy しておき、使うときだけ再作成する運用。

## 前提
- AWS CLI v2・Docker（buildx 有効）・Terraform 1.9+ が導入済み
- `aws sts get-caller-identity` が通る（default プロファイル）
- リージョンは `ap-northeast-1`、プロジェクト名は `mono-log`
- 残存リソース: VPC / Cognito / S3 / ECR / SSM / IAM（destroy していない）

## 再デプロイ（3ステップ）

### 1. インフラを再作成（RDS / EC2 / CloudFront）
```powershell
cd infra
terraform init      # 初回や別マシンのみ
terraform plan      # 作成内容を確認
terraform apply     # yes で作成（RDS は数分かかる）
```
- 新しい RDS エンドポイント・EC2・CloudFront が作られ、SSM パラメータと CloudFront オリジンは自動で更新される
- EC2 はこの時点ではまだアプリ未起動（イメージが ECR に無いため、systemd が 30 秒ごとに再試行中）

### 2. DB マイグレーション（RDS 再作成のたびに1回）
```powershell
powershell -File migrate.ps1
```
- `0001_init.sql` / `0002_seed.sql` を S3 経由で EC2 に渡し、SSM 経由で RDS に適用
- 併せて `monolog_app` ロールのパスワードを SSM (`/mono-log/db/app_password`) の値に設定
- 出力 `Status: Success` を確認

### 3. アプリをビルドして配備
```powershell
powershell -File deploy.ps1
```
- `linux/arm64`（t4g 用）でビルド → ECR へ push → SSM で EC2 のコンテナを更新
- 最後に表示される CloudFront ドメイン（`xxxx.cloudfront.net`）にブラウザでアクセス
- 以降アプリのコードを更新したら **3 だけ** 再実行すればよい

## 課金を止める（使い終わったら）
RDS・EC2・CloudFront だけ削除します（Cognito/S3/ECR/VPC は残します）。RDS は通常、削除保護が有効なため、最終スナップショットを指定してから削除保護を解除します。

`mono-log-db-final-20260819-1530`の部分は、実行日時などを含む未使用の名前へ置き換えてください。同名のスナップショットが既にあるとRDSを削除できません。

```powershell
cd infra
$env:TF_VAR_db_deletion_safety = '{"protection_enabled":false,"final_snapshot_identifier":"mono-log-db-final-20260819-1530"}'

# RDSの変更が「削除保護の解除」と「最終スナップショット名の設定」だけか確認して適用
terraform plan -target=aws_db_instance.main
terraform apply -target=aws_db_instance.main

# 同じ設定を渡して削除。RDSは最終スナップショットの作成後に削除される
terraform destroy `
  -target=aws_cloudfront_distribution.app `
  -target=aws_instance.app `
  -target=aws_db_instance.main

Remove-Item Env:TF_VAR_db_deletion_safety
```
- `plan`が既存RDSの**更新（update in-place）だけ**であることを確認する。新規作成（add）や置換（replace）が表示された場合はapplyしない
- RDSが既に存在しない場合は環境変数を削除し、`aws_db_instance.main`を外してEC2とCloudFrontだけをdestroyする
- 解除後に削除を中止した場合は、`Remove-Item Env:TF_VAR_db_deletion_safety`の後に`terraform apply -target=aws_db_instance.main`を実行して削除保護を有効に戻す
- 最終スナップショットはRDS削除後も残り、保存容量に応じて課金される。不要になったら内容を確認してAWS上で削除する
- 新しい空のRDSで再開する場合は手順2のマイグレーションをやり直す。保存したデータを使う場合は`db_snapshot_identifier`を指定して復元する
- 完全に消す場合は `terraform destroy`（tfstate/S3/Cognito は別管理なので残ることがある）

## メモ
- RDS/EC2/CloudFront は起動中ずっと課金される（最小構成で約 $20〜24/月）。使い終わったら destroy する
- アプリの設定（DB/Cognito/S3）は EC2 起動時に SSM から読み込む（`/etc/mono-log.env` と `mono-log-run.sh`）
- ローカル開発は `compose.yaml` の Postgres + `.env.local`。本番とは独立
