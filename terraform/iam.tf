# --- Lambda Worker Role ---
resource "aws_iam_role" "worker_role" {
  name = "${var.project_name}-worker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "worker_policy" {
  name = "${var.project_name}-worker-policy"
  role = aws_iam_role.worker_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Effect   = "Allow"
        Resource = [
          aws_s3_bucket.video_bucket.arn,
          "${aws_s3_bucket.video_bucket.arn}/*",
          aws_s3_bucket.analysis_results.arn,
          "${aws_s3_bucket.analysis_results.arn}/*"
        ]
      },
      {
        Action   = ["s3:PutObject"]
        Effect   = "Allow"
        Resource = ["${aws_s3_bucket.analysis_results.arn}/*"]
      },
      {
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Effect   = "Allow"
        Resource = aws_sqs_queue.video_queue.arn
      },
      {
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Effect   = "Allow"
        Resource = var.phase >= 3 ? [aws_dynamodb_table.user_metadata[0].arn] : ["*"]
      },
      {
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Effect   = "Allow"
        Resource = "*"
      },
      {
        # X-Ray: send trace segments and fetch sampling rules
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}
# --- API Gateway S3 Role ---
resource "aws_iam_role" "apigw_s3_role" {
  name = "${var.project_name}-apigw-s3-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "apigw_s3_policy" {
  name = "${var.project_name}-apigw-s3-policy"
  role = aws_iam_role.apigw_s3_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["s3:GetObject"]
        Effect   = "Allow"
        Resource = ["${aws_s3_bucket.analysis_results.arn}/*"]
      }
    ]
  })
}
