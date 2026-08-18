# 商品画像用S3バケット（非公開。アプリはpresigned URLでアクセス）
resource "aws_s3_bucket" "item_images" {
  # バケット名は全世界一意。アカウントIDを付けて衝突を回避
  bucket = "${var.project_name}-item-images-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-item-images"
  }
}

# パブリックアクセスを全ブロック（誤公開を防ぐ）
resource "aws_s3_bucket_public_access_block" "item_images" {
  bucket                  = aws_s3_bucket.item_images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 保存時の暗号化（SSE-S3 / AES256）
resource "aws_s3_bucket_server_side_encryption_configuration" "item_images" {
  bucket = aws_s3_bucket.item_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 画像本体はアプリサーバーを経由せず、短命な署名付きPOSTでブラウザから直接送信する。
resource "aws_s3_bucket_cors_configuration" "item_images" {
  bucket = aws_s3_bucket.item_images.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = concat(
      ["https://${aws_cloudfront_distribution.app.domain_name}"],
      var.s3_upload_allowed_origins,
    )
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

# アプリが読むバケット名をSSMに保存（非機密なのでString。EC2が S3_IMAGE_BUCKET として読む）
resource "aws_ssm_parameter" "s3_bucket" {
  name  = "/${var.project_name}/s3/bucket"
  type  = "String"
  value = aws_s3_bucket.item_images.bucket
}
