resource "random_password" "demo_session" {
  length  = 48
  special = false
}

resource "random_password" "demo_reset" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "demo_user_id" {
  name        = "/${var.project_name}/demo/user_id"
  description = "Fixed database user ID used only by the public demo session"
  type        = "String"
  value       = var.demo_account.user_id
}

resource "aws_ssm_parameter" "demo_email" {
  name        = "/${var.project_name}/demo/email"
  description = "Public demo login email"
  type        = "String"
  value       = var.demo_account.email
}

resource "aws_ssm_parameter" "demo_password" {
  name        = "/${var.project_name}/demo/password"
  description = "Public demo login password"
  type        = "SecureString"
  value       = var.demo_account.password
}

resource "aws_ssm_parameter" "demo_session_token" {
  name        = "/${var.project_name}/demo/session_token"
  description = "Server-only token for the restricted demo session cookie"
  type        = "SecureString"
  value       = random_password.demo_session.result
}

resource "aws_ssm_parameter" "demo_reset_secret" {
  name        = "/${var.project_name}/demo/reset_secret"
  description = "Server-only authorization secret for the demo reset endpoint"
  type        = "SecureString"
  value       = random_password.demo_reset.result
}
