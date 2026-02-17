resource "aws_sqs_queue" "video_dlq" {
  name                      = "${var.project_name}-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "video_queue" {
  name                       = "${var.project_name}-queue"
  visibility_timeout_seconds = 910

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.video_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "video_queue_policy" {
  queue_url = aws_sqs_queue.video_queue.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "s3.amazonaws.com" }
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

resource "aws_sqs_queue_redrive_allow_policy" "dlq_allow" {
  queue_url = aws_sqs_queue.video_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.video_queue.arn]
  })
}
