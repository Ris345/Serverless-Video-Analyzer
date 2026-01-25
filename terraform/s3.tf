resource "aws_s3_bucket" "video_bucket" {
  bucket_prefix = "${var.project_name}-videos-"
  force_destroy = true
}

resource "aws_s3_bucket_cors_configuration" "video_bucket_cors" {
  bucket = aws_s3_bucket.video_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["http://localhost:3000"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}


resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = aws_s3_bucket.video_bucket.id

  queue {
    queue_arn     = aws_sqs_queue.video_queue.arn
    events        = ["s3:ObjectCreated:*"]
  }
}

resource "aws_s3_bucket" "analysis_results" {
  bucket_prefix = "${var.project_name}-results-"
  force_destroy = true
}

resource "aws_s3_bucket_cors_configuration" "analysis_results_cors" {
  bucket = aws_s3_bucket.analysis_results.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["*"] # Allow frontend to read if needed, or restricted to API
    max_age_seconds = 3000
  }
}
