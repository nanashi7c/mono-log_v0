# Application logs are retained independently from the disposable EC2 instance.
resource "aws_cloudwatch_log_group" "application" {
  name              = "/${var.project_name}/application"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-application-logs"
  }
}

# The EC2 role can create streams and write events only in the application log group.
data "aws_iam_policy_document" "cloudwatch_logs" {
  statement {
    sid       = "DescribeApplicationLogStreams"
    actions   = ["logs:DescribeLogStreams"]
    resources = [aws_cloudwatch_log_group.application.arn]
  }

  statement {
    sid       = "WriteApplicationLogStreams"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.application.arn}:*"]
  }
}

resource "aws_iam_role_policy" "cloudwatch_logs" {
  name   = "${var.project_name}-cloudwatch-logs"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.cloudwatch_logs.json
}
