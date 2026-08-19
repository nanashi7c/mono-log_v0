# EC2 がこのロールを引き受けられるようにする信頼ポリシー
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# EC2 用 IAM ロール
resource "aws_iam_role" "ec2" {
  name               = "${var.project_name}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json

  tags = {
    Name = "${var.project_name}-ec2-role"
  }
}

# SSM Session Manager（SSH不要でシェル接続できる）
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# ECR からのイメージ pull（読み取り専用）
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# /mono-log/* の SSM パラメータ読み取り + SecureString 復号（最小権限）
data "aws_iam_policy_document" "ssm_read" {
  statement {
    sid     = "ReadAppParameters"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/*"
    ]
  }
  statement {
    sid       = "DecryptViaSsmOnly"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    # KMS 復号は SSM 経由のときだけ許可（用途を限定して安全に）
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ssm_read" {
  name   = "${var.project_name}-ssm-read"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ssm_read.json
}

# アプリが使う S3（画像の presign/保存/削除）と Cognito（登録日時表示）の権限
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

# EC2 にロールを紐付けるためのインスタンスプロファイル
resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}


# --- EC2セキュリティグループ ---

# CloudFrontのオリジン向けIP範囲（AWS管理プレフィックスリスト）
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# EC2用セキュリティグループ（CloudFrontからの80のみ許可）
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
    protocol    = "-1" # 全プロトコル（ECR/SSMへの外向き通信に必要）
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-ec2-sg"
  }
}


# --- EC2インスタンス ---

# 最新のAmazon Linux 2023（ARM64・t4g用）AMIを取得
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  # 標準版に固定。"al2023-ami-*" は minimal / ecs-hvm 版にも一致し、most_recent が apply 時点の
  # 最新系統を引くため AMI 種別がブレる。minimal は SSM エージェント非同梱で send-command
  # (migrate.ps1 / deploy) が使えなくなるので、SSM・aws-cli 同梱の標準版だけに絞る。
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-arm64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# アプリを動かすEC2インスタンス（Dockerコンテナ実行・public配置）
resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t4g.micro" # 最安のmicro（ARM/Graviton）
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  depends_on             = [aws_ssm_parameter.cloudfront_origin_verify_secret]

  # 起動時に Docker を導入し、ECR からアプリを pull して起動する（SSH 不要・SSM 接続）。
  # 機密(DB/Cognito/S3)は実行時に SSM から取得。初回はイメージ未 push のため失敗するが、
  # 30 秒ごとに再試行し、push 後に自動起動する（Restart=on-failure）。
  user_data = <<-EOF
#!/bin/bash
set -euo pipefail
dnf install -y docker
systemctl enable --now docker

# Terraform が埋め込む非機密の設定
cat > /etc/mono-log.env <<ENV
REGION=${var.aws_region}
PROJECT=${var.project_name}
REGISTRY=${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com
IMAGE=${aws_ecr_repository.app.repository_url}:latest
ENV

# 起動スクリプト（実行時に SSM から機密を取得して docker run）
cat > /usr/local/bin/mono-log-run.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail
. /etc/mono-log.env
get() { aws ssm get-parameter --region "$REGION" --name "$1" $2 --query Parameter.Value --output text; }
DB_HOST=$(get "/$PROJECT/db/host" "")
DB_PORT=$(get "/$PROJECT/db/port" "")
DB_NAME=$(get "/$PROJECT/db/name" "")
DB_PASSWORD=$(get "/$PROJECT/db/app_password" "--with-decryption")
POOL=$(get "/$PROJECT/cognito/user_pool_id" "")
CLIENT=$(get "/$PROJECT/cognito/client_id" "")
BUCKET=$(get "/$PROJECT/s3/bucket" "")
ORIGIN_VERIFY_SECRET=$(get "/$PROJECT/cloudfront/origin_verify_secret" "--with-decryption")
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker pull "$IMAGE"
docker rm -f mono-log >/dev/null 2>&1 || true
docker run -d --name mono-log --restart unless-stopped -p 80:3000 \
  -e NODE_ENV=production \
  -e DB_HOST="$DB_HOST" -e DB_PORT="$DB_PORT" -e DB_NAME="$DB_NAME" \
  -e DB_USER=monolog_app -e DB_PASSWORD="$DB_PASSWORD" \
  -e AWS_REGION="$REGION" \
  -e COGNITO_USER_POOL_ID="$POOL" -e COGNITO_CLIENT_ID="$CLIENT" \
  -e S3_IMAGE_BUCKET="$BUCKET" \
  -e CLOUDFRONT_ORIGIN_VERIFY_SECRET="$ORIGIN_VERIFY_SECRET" \
  "$IMAGE"
SCRIPT
chmod +x /usr/local/bin/mono-log-run.sh

# systemd で管理（再起動後も起動。失敗時は30秒ごとに再試行）
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
EOF

  metadata_options {
    http_tokens = "required" # IMDSv2を強制（認証情報の盗用を防ぐ）
  }

  root_block_device {
    volume_size = 30 # AL2023(ARM)の最新AMIはスナップショットが30GBのため30以上が必要
    volume_type = "gp3"
    encrypted   = true # ルートボリュームを暗号化
  }

  tags = {
    Name = "${var.project_name}-ec2"
  }
}
