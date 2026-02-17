output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.worker.repository_url
}

output "video_bucket_name" {
  description = "Video upload bucket name"
  value       = aws_s3_bucket.video_bucket.id
}

output "results_bucket_name" {
  description = "Results bucket name"
  value       = aws_s3_bucket.analysis_results.id
}

output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = var.phase >= 2 ? aws_api_gateway_stage.prod[0].invoke_url : "Provision Phase 2 to get endpoint"
}
