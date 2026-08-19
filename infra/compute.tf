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
  depends_on = [
    aws_iam_role_policy.cloudwatch_logs,
    aws_ssm_parameter.cloudfront_origin_verify_secret,
    aws_ssm_parameter.deployed_image_tag,
    aws_ssm_parameter.demo_user_id,
    aws_ssm_parameter.demo_email,
    aws_ssm_parameter.demo_password,
    aws_ssm_parameter.demo_session_token,
    aws_ssm_parameter.demo_reset_secret,
  ]

  # User data runs only at launch, so replace this stateless instance when it changes.
  user_data_replace_on_change = true

  # 起動時に Docker と CloudWatch Agent を導入し、ECR からアプリを pull して起動する（SSH 不要・SSM 接続）。
  # 機密(DB/Cognito/S3)と配備タグは実行時に SSM から取得。初回は配備タグが未設定のため
  # 30 秒ごとに再試行し、deploy.ps1 がタグを設定してserviceを再起動する。
  user_data = <<-EOF
#!/bin/bash
set -euo pipefail
dnf install -y docker

# Keep docker logs available locally for immediate SSM troubleshooting without unbounded disk growth.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DOCKERCONFIG'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DOCKERCONFIG
systemctl enable --now docker

# Forward the current container JSON log without making application startup depend on monitoring.
if dnf install -y amazon-cloudwatch-agent; then
  cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'CWAGENT'
{
  "agent": {
    "region": "${var.aws_region}"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/containers/*/*-json.log",
            "log_group_name": "${aws_cloudwatch_log_group.application.name}",
            "log_stream_name": "{instance_id}/application"
          }
        ]
      }
    }
  }
}
CWAGENT
  if /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config -m ec2 -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json; then
    systemctl enable amazon-cloudwatch-agent || echo "Failed to enable CloudWatch Agent at boot" >&2
  else
    echo "Failed to start CloudWatch Agent; application startup will continue" >&2
  fi
else
  echo "Failed to install CloudWatch Agent; application startup will continue" >&2
fi

# Terraform が埋め込む非機密の設定
cat > /etc/mono-log.env <<ENV
REGION=${var.aws_region}
PROJECT=${var.project_name}
REGISTRY=${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com
REPOSITORY=${aws_ecr_repository.app.repository_url}
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
DEMO_USER_ID=$(get "/$PROJECT/demo/user_id" "")
DEMO_USER_EMAIL=$(get "/$PROJECT/demo/email" "")
DEMO_USER_PASSWORD=$(get "/$PROJECT/demo/password" "--with-decryption")
DEMO_SESSION_TOKEN=$(get "/$PROJECT/demo/session_token" "--with-decryption")
DEMO_RESET_SECRET=$(get "/$PROJECT/demo/reset_secret" "--with-decryption")
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
  -e DB_HOST="$DB_HOST" -e DB_PORT="$DB_PORT" -e DB_NAME="$DB_NAME" \
  -e DB_USER=monolog_app -e DB_PASSWORD="$DB_PASSWORD" \
  -e AWS_REGION="$REGION" \
  -e COGNITO_USER_POOL_ID="$POOL" -e COGNITO_CLIENT_ID="$CLIENT" \
  -e S3_IMAGE_BUCKET="$BUCKET" \
  -e CLOUDFRONT_ORIGIN_VERIFY_SECRET="$ORIGIN_VERIFY_SECRET" \
  -e DEMO_USER_ID="$DEMO_USER_ID" -e DEMO_USER_EMAIL="$DEMO_USER_EMAIL" \
  -e DEMO_USER_PASSWORD="$DEMO_USER_PASSWORD" \
  -e DEMO_SESSION_TOKEN="$DEMO_SESSION_TOKEN" \
  -e DEMO_RESET_SECRET="$DEMO_RESET_SECRET" \
  -e API_RATE_LIMIT_MAX=120 \
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

# 公開デモのデータだけを毎日03:00（日本時間）に初期化する。
cat > /usr/local/bin/mono-log-demo-reset.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail
. /etc/mono-log.env
get_secret() {
  aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption \
    --query Parameter.Value --output text
}
RESET_SECRET=$(get_secret "/$PROJECT/demo/reset_secret")
ORIGIN_SECRET=$(get_secret "/$PROJECT/cloudfront/origin_verify_secret")
curl --fail-with-body --silent --show-error \
  --request POST http://127.0.0.1/api/internal/demo-reset \
  --header "Authorization: Bearer $RESET_SECRET" \
  --header "X-Mono-Log-Origin-Verify: $ORIGIN_SECRET"
SCRIPT
chmod +x /usr/local/bin/mono-log-demo-reset.sh

cat > /etc/systemd/system/mono-log-demo-reset.service <<'UNIT'
[Unit]
Description=Reset mono-log public demo data
After=mono-log.service
Requires=mono-log.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/mono-log-demo-reset.sh
UNIT

cat > /etc/systemd/system/mono-log-demo-reset.timer <<'UNIT'
[Unit]
Description=Reset mono-log public demo data every day

[Timer]
OnCalendar=*-*-* 18:00:00 UTC
Persistent=true
RandomizedDelaySec=5m
Unit=mono-log-demo-reset.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now mono-log-demo-reset.timer
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
