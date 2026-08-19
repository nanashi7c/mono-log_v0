# CloudFront のキャッシュ/オリジンリクエストはマネージドポリシーを使う
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# 特定のCloudFront distributionからのリクエストだけをEC2で受け付けるための共有秘密値。
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

# CDN/TLS。オリジンは EC2（HTTP）、視聴者には HTTPS を強制
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
      origin_protocol_policy = "http-only" # CloudFront から EC2 へは HTTP
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "ec2-origin"
    viewer_protocol_policy = "redirect-to-https" # 視聴者には HTTPS を強制
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]

    # 動的アプリなのでキャッシュ無効＋全ヘッダ/Cookie/クエリを転送
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true # *.cloudfront.net の証明書を使う
  }

  price_class = "PriceClass_200" # 北米/欧州/アジア（日本含む）。全エッジより安い

  tags = {
    Name = "${var.project_name}-cdn"
  }
}
