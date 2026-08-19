# Dockerイメージの保管庫（アプリのコンテナイメージを置く）
resource "aws_ecr_repository" "app" {
  name                 = "${var.project_name}-app"
  image_tag_mutability = "IMMUTABLE" # commit SHA等の同じタグを上書きさせない

  image_scanning_configuration {
    scan_on_push = true # プッシュ時に脆弱性スキャン
  }

  encryption_configuration {
    encryption_type = "AES256" # 保存時暗号化
  }

  tags = {
    Name = "${var.project_name}-app"
  }
}

# 古いイメージを自動削除（容量=コスト管理。直近10個だけ残す）
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# deploy.ps1 が更新し、EC2 が起動時・再起動時に読む配備タグ。
# Terraform はパラメータの器だけを管理し、実際の配備状態は上書きしない。
resource "aws_ssm_parameter" "deployed_image_tag" {
  name        = "/${var.project_name}/deploy/image_tag"
  description = "Immutable ECR image tag currently selected for deployment"
  type        = "String"
  value       = "not-deployed"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "previous_deployed_image_tag" {
  name        = "/${var.project_name}/deploy/previous_image_tag"
  description = "Previous immutable ECR image tag available for rollback"
  type        = "String"
  value       = "not-deployed"

  lifecycle {
    ignore_changes = [value]
  }
}
