# --- API Gateway CloudWatch Logging ---
# aws_api_gateway_account is a singleton — one per AWS account.
# It tells API Gateway which IAM role to use when writing execution logs
# to CloudWatch. This does NOT create a new API Gateway.

resource "aws_iam_role" "apigateway_logging" {
  name = "${var.project_name}-apigw-logging-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

# Inline policy instead of aws_iam_role_policy_attachment.
# Inline policies only require iam:PutRolePolicy (which video-analyzer-user
# already has, proven by the existing worker_policy and apigw_s3_policy).
# Managed policy attachments require iam:AttachRolePolicy, which this user
# does not have.
resource "aws_iam_role_policy" "apigateway_logging" {
  name = "${var.project_name}-apigw-logging-policy"
  role = aws_iam_role.apigateway_logging.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:PutLogEvents",
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_api_gateway_account" "api" {
  cloudwatch_role_arn = aws_iam_role.apigateway_logging.arn

  # Role must have its policy attached before API Gateway validates the ARN.
  depends_on = [aws_iam_role_policy.apigateway_logging]
}

# --- Grafana CloudWatch Access ---
# Grafana IAM user removed from Terraform — iam:CreateUser is not available
# to video-analyzer-user. Configure Grafana's CloudWatch datasource with the
# existing video-analyzer-user credentials instead (see outputs.tf for the
# access key, or use the AWS_ACCESS_KEY_ID/SECRET already in your env).
