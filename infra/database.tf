# DB マスターパスワードを自動生成する
resource "random_password" "db" {
  length  = 24
  special = true
  # RDS のマスターパスワードで使えない文字（/ @ " と空白）を除外した記号集合
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# 生成したパスワードを SSM Parameter Store に暗号化保管（SecureString）
resource "aws_ssm_parameter" "db_password" {
  name        = "/${var.project_name}/db/password" # 例: /mono-log/db/password
  description = "RDS master password (${var.project_name})"
  type        = "SecureString"            # KMS で暗号化して保存
  value       = random_password.db.result # 上で生成したパスワード値
}

# --- RDS (PostgreSQL) ---

# RDSを配置するprivateサブネットのグループ（マルチAZ要件で2つ）
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]

  tags = {
    Name = "${var.project_name}-db-subnet-group"
  }
}

# RDS用セキュリティグループ（アプリEC2からの5432のみ許可）
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
    protocol    = "-1" # 全プロトコル
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-rds-sg"
  }
}

# RDS PostgreSQL本体（db.t4g.micro・Single-AZ・private・最小構成）
resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "16"           # メジャー16系（最新マイナーを自動選択）
  instance_class = "db.t4g.micro" # 最小クラス（ARM/Graviton・最安）

  # スナップショット復元は一度きりの運用操作。DB名を直書きせず、復元時だけ
  # apply に -var="db_snapshot_identifier=<snap名>" を渡す。通常時は null で復元しない。
  snapshot_identifier = var.db_snapshot_identifier

  allocated_storage = 20 # GB単位（最小構成）
  storage_type      = "gp2"
  storage_encrypted = true # 保存時暗号化

  db_name  = "monolog"
  username = "monolog_admin"
  password = random_password.db.result # 生成したパスワードを使用

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = false # コスト最小のためSingle-AZ
  publicly_accessible    = false # インターネット非公開

  auto_minor_version_upgrade = true
  backup_retention_period    = 7

  # 通常は削除を拒否する。意図的な削除時だけ、削除保護の解除と
  # 最終スナップショット名を db_deletion_safety で同時に指定する。
  deletion_protection       = var.db_deletion_safety.protection_enabled
  skip_final_snapshot       = var.db_deletion_safety.final_snapshot_identifier == null
  final_snapshot_identifier = var.db_deletion_safety.final_snapshot_identifier

  tags = {
    Name = "${var.project_name}-db"
  }

  # snapshot_identifier は一度きりの復元専用。通常運用で null との差分が出ても
  # RDS を作り直さない（＝復元データを失わない）よう変更を無視する。
  # 復元は意図的に `terraform apply -replace=aws_db_instance.main -var=...` で行う。
  lifecycle {
    ignore_changes = [snapshot_identifier]
  }
}


# --- DB接続情報をSSMに保存（非機密なのでString型。アプリが読み出す） ---

resource "aws_ssm_parameter" "db_host" {
  name  = "/${var.project_name}/db/host"
  type  = "String"
  value = aws_db_instance.main.address # RDSエンドポイントのホスト名
}

resource "aws_ssm_parameter" "db_port" {
  name  = "/${var.project_name}/db/port"
  type  = "String"
  value = tostring(aws_db_instance.main.port) # 5432
}

resource "aws_ssm_parameter" "db_name" {
  name  = "/${var.project_name}/db/name"
  type  = "String"
  value = aws_db_instance.main.db_name # monolog
}

resource "aws_ssm_parameter" "db_username" {
  name  = "/${var.project_name}/db/username"
  type  = "String"
  value = aws_db_instance.main.username # monolog_admin
}

# --- アプリ接続ロール(monolog_app)のパスワード ---
# RLS が効く非所有者ロール。本番ではデプロイ時に ALTER ROLE で適用する（migration のベタ書きは使わない）。

resource "random_password" "db_app" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?" # RDS で使えない文字を除外
}

resource "aws_ssm_parameter" "db_app_password" {
  name        = "/${var.project_name}/db/app_password"
  description = "Password for the non-owner app role monolog_app"
  type        = "SecureString"
  value       = random_password.db_app.result
}
