output "analysis_results_bucket" {
  value = aws_s3_bucket.analysis_results.bucket
}

output "api_endpoint" {
  description = "API Gateway Endpoint URL"
  value       = aws_api_gateway_stage.prod.invoke_url
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.video_bucket.id
}

output "worker_lambda_arn" {
  description = "ARN of the worker Lambda"
  value       = aws_lambda_function.worker.arn
}

output "repository_url" {
  description = "Use this to push images if you manage ECR elsewhere"
  value       = var.worker_image_uri
}
