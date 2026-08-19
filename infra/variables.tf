variable "aws_region" {
  description = "リソースを作成する AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_profile" {
  description = "認証に使う AWS CLI プロファイル名（~/.aws/credentials の項目）"
  type        = string
  default     = "default"
}

variable "project_name" {
  description = "リソース名やタグに使うプロジェクト名"
  type        = string
  default     = "mono-log"
}

# RDS をスナップショットから復元する一度きりの操作でのみ指定する。
# 通常は null（＝新規作成・復元しない）。復元時だけ apply に -var で渡す。
variable "db_snapshot_identifier" {
  description = "RDS 復元元スナップショット名。通常は null。復元時のみ -var で指定する。"
  type        = string
  default     = null
}

# 通常運用では削除保護を有効にする。意図的に削除する場合だけ、削除保護の解除と
# 最終スナップショット名を一つの値として渡し、不完全な削除設定を防ぐ。
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

variable "s3_upload_allowed_origins" {
  description = "ブラウザから商品画像をS3へ直接送信できる追加オリジン"
  type        = list(string)
  default     = ["http://localhost:3000", "http://127.0.0.1:3000"]
}

variable "demo_account" {
  description = "READMEで公開するデモログインと、そのデータを所有する固定DBユーザー"
  type = object({
    user_id  = string
    email    = string
    password = string
  })
  default = {
    user_id  = "c7f46a48-50f1-707a-22c0-bfc1746db566"
    email    = "test@example.com"
    password = "Passw0rd"
  }
  sensitive = true

  validation {
    condition = (
      can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.demo_account.user_id)) &&
      can(regex("^[^@[:space:]]+@[^@[:space:]]+$", var.demo_account.email)) &&
      length(var.demo_account.password) >= 8
    )
    error_message = "demo_accountにはUUID形式のuser_id、有効なemail、8文字以上のpasswordが必要です。"
  }
}
