# --- Worker Lambda (Docker-based) ---
# This resource is only created in Phase 2
resource "aws_lambda_function" "worker" {
  count         = var.phase >= 2 ? 1 : 0
  
  function_name = "${var.project_name}-worker"
  role          = aws_iam_role.worker_role.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker.repository_url}:latest"
  timeout       = 900
  memory_size   = 2048
  architectures = ["arm64"]

  environment {
    variables = {
      RESULTS_BUCKET_NAME     = aws_s3_bucket.analysis_results.bucket
      OPENAI_API_KEY          = var.openai_api_key
    }
  }
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  count            = var.phase >= 2 ? 1 : 0
  
  event_source_arn = aws_sqs_queue.video_queue.arn
  function_name    = aws_lambda_function.worker[0].arn
  batch_size       = 1
}

# Permission for API Gateway to invoke Lambda
resource "aws_lambda_permission" "apigw_lambda" {
  count         = var.phase >= 2 ? 1 : 0
  
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*/*"
}
