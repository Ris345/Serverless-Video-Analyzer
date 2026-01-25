# REST API (v1) for S3 Proxy Support

resource "aws_api_gateway_rest_api" "api" {
  name        = "${var.project_name}-api"
  description = "Video Analyzer REST API"
  
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# --- IAM Role for API Gateway to Access S3 ---
resource "aws_iam_role" "apigateway_s3_role" {
  name = "${var.project_name}-apigateway-s3-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "apigateway.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "apigateway_s3_policy" {
  name = "${var.project_name}-apigateway-s3-policy"
  role = aws_iam_role.apigateway_s3_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["s3:GetObject"]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.analysis_results.arn}/*"
      }
    ]
  })
}

# --- /login (POST) -> Lambda ---
resource "aws_api_gateway_resource" "login" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "login"
}

resource "aws_api_gateway_method" "login_post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.login.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "login_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.login.id
  http_method             = aws_api_gateway_method.login_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api_login.invoke_arn
}

# --- /analysis/{userId} (GET) -> Lambda ---
resource "aws_api_gateway_resource" "analysis" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "analysis"
}

resource "aws_api_gateway_resource" "analysis_user_id" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.analysis.id
  path_part   = "{userId}"
}

resource "aws_api_gateway_method" "analysis_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.analysis_user_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "analysis_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.analysis_user_id.id
  http_method             = aws_api_gateway_method.analysis_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api_analysis.invoke_arn
}

# --- /results/{userId}/{filename} (GET) -> S3 Proxy ---
resource "aws_api_gateway_resource" "results" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "results"
}

resource "aws_api_gateway_resource" "results_user_id" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.results.id
  path_part   = "{userId}"
}

resource "aws_api_gateway_resource" "results_filename" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.results_user_id.id
  path_part   = "{filename}"
}

resource "aws_api_gateway_method" "results_get" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.results_filename.id
  http_method   = "GET"
  authorization = "NONE"
  
  request_parameters = {
    "method.request.path.userId"   = true
    "method.request.path.filename" = true
  }
}

resource "aws_api_gateway_integration" "results_s3_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.results_filename.id
  http_method             = aws_api_gateway_method.results_get.http_method
  integration_http_method = "GET"
  type                    = "AWS"
  uri                     = "arn:aws:apigateway:${var.aws_region}:s3:path/${aws_s3_bucket.analysis_results.bucket}/{userId}/{filename}"
  credentials             = aws_iam_role.apigateway_s3_role.arn
  
  request_parameters = {
    "integration.request.path.userId"   = "method.request.path.userId"
    "integration.request.path.filename" = "method.request.path.filename"
  }
}

resource "aws_api_gateway_method_response" "results_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_filename.id
  http_method = aws_api_gateway_method.results_get.http_method
  status_code = "200"
  
  response_parameters = {
    "method.response.header.Content-Type" = true
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_integration_response" "results_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_filename.id
  http_method = aws_api_gateway_method.results_get.http_method
  status_code = aws_api_gateway_method_response.results_200.status_code
  
  response_parameters = {
    "method.response.header.Content-Type" = "integration.response.header.Content-Type"
    "method.response.header.Access-Control-Allow-Origin" = "'*'"
  }
  
  depends_on = [aws_api_gateway_integration.results_s3_integration]
}

# --- CORS (OPTIONS) for /results/{userId}/{filename} ---
resource "aws_api_gateway_method" "results_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.results_filename.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "results_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_filename.id
  http_method = aws_api_gateway_method.results_options.http_method
  type        = "MOCK"
  
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "results_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_filename.id
  http_method = aws_api_gateway_method.results_options.http_method
  status_code = "200"
  
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true,
    "method.response.header.Access-Control-Allow-Methods" = true,
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "results_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_filename.id
  http_method = aws_api_gateway_method.results_options.http_method
  status_code = aws_api_gateway_method_response.results_options_200.status_code
  
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'",
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  
  depends_on = [aws_api_gateway_integration.results_options_integration]
}


# --- Deployment ---
resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.login.id,
      aws_api_gateway_method.login_post.id,
      aws_api_gateway_integration.login_integration.id,
      aws_api_gateway_resource.analysis.id,
      aws_api_gateway_method.analysis_get.id,
      aws_api_gateway_integration.analysis_integration.id,
      aws_api_gateway_resource.results.id,
      aws_api_gateway_method.results_get.id,
      aws_api_gateway_integration.results_s3_integration.id,
      aws_api_gateway_method.results_options.id,
      aws_api_gateway_integration.results_options_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "prod"
}

# --- Lambda Permissions ---
resource "aws_lambda_permission" "login_gw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_login.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*/*"
}

resource "aws_lambda_permission" "analysis_gw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_analysis.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*/*"
}
