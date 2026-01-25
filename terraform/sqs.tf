resource "aws_sqs_queue" "video_queue" {
  name                       = "${var.project_name}-queue"
  visibility_timeout_seconds = 910 # Slightly longer than Lambda timeout
}

resource "aws_sqs_queue_policy" "video_queue_policy" {
  queue_url = aws_sqs_queue.video_queue.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.video_queue.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_s3_bucket.video_bucket.arn
          }
        }
      }
    ]
  })
}
