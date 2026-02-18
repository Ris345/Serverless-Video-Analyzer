# --- API Gateway (REST API) ---
resource "aws_api_gateway_rest_api" "api" {
  name = "${var.project_name}-api"
}

resource "aws_api_gateway_resource" "parsed" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "parsed"
}

resource "aws_api_gateway_method" "get_parsed" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.parsed.id
  http_method   = "GET"
  authorization = "NONE"
}

# MOCK fallback so /parsed always has an integration (required for deployment)
resource "aws_api_gateway_integration" "parsed_mock" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.parsed.id
  http_method = aws_api_gateway_method.get_parsed.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

# Lambda Integration (Phase 2)
resource "aws_api_gateway_integration" "lambda_integration" {
  count       = var.phase >= 2 ? 1 : 0
  
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.parsed.id
  http_method = aws_api_gateway_method.get_parsed.http_method
  
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.worker[0].invoke_arn
}

resource "aws_api_gateway_resource" "results" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "results"
}

resource "aws_api_gateway_resource" "results_proxy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.results.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "get_results" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.results_proxy.id
  http_method   = "GET"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "s3_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.get_results.http_method

  type                    = "AWS"
  integration_http_method = "GET"
  uri                     = "arn:aws:apigateway:${var.aws_region}:s3:path/${aws_s3_bucket.analysis_results.bucket}/{proxy}"
  credentials             = aws_iam_role.apigw_s3_role.arn

  request_parameters = {
    "integration.request.path.proxy" = "method.request.path.proxy"
  }
}

resource "aws_api_gateway_method_response" "results_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.get_results.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_method_response" "results_4xx" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.get_results.http_method
  status_code = "403"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_integration_response" "s3_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.get_results.http_method
  status_code = aws_api_gateway_method_response.results_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = "'*'"
  }

  depends_on = [aws_api_gateway_integration.s3_integration]
}

resource "aws_api_gateway_integration_response" "s3_integration_response_4xx" {
  rest_api_id       = aws_api_gateway_rest_api.api.id
  resource_id       = aws_api_gateway_resource.results_proxy.id
  http_method       = aws_api_gateway_method.get_results.http_method
  status_code       = aws_api_gateway_method_response.results_4xx.status_code
  selection_pattern = "4\\d{2}"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = "'*'"
  }

  depends_on = [aws_api_gateway_integration.s3_integration]
}

# Gateway responses ensure CORS headers are present even on API Gateway-generated errors
resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
  }
}

# OPTIONS Method (CORS Preflight)
resource "aws_api_gateway_method" "options_results" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.results_proxy.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.options_results.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.options_results.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results_proxy.id
  http_method = aws_api_gateway_method.options_results.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }

  depends_on = [aws_api_gateway_method_response.options_200]
}

resource "aws_api_gateway_deployment" "deployment" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.results.id,
      aws_api_gateway_resource.results_proxy.id,
      aws_api_gateway_method.get_results.id,
      aws_api_gateway_integration.s3_integration.id,
      aws_api_gateway_integration_response.s3_integration_response.id,
      aws_api_gateway_integration_response.s3_integration_response_4xx.id,
      aws_api_gateway_method.options_results.id,
      aws_api_gateway_integration.options_integration.id,
      aws_api_gateway_integration.parsed_mock.id,
      aws_api_gateway_gateway_response.cors_4xx.id,
      aws_api_gateway_gateway_response.cors_5xx.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.parsed_mock,
    aws_api_gateway_integration.s3_integration,
    aws_api_gateway_integration_response.s3_integration_response,
    aws_api_gateway_integration_response.s3_integration_response_4xx,
    aws_api_gateway_integration.options_integration,
    aws_api_gateway_integration_response.options_integration_response,
    aws_api_gateway_gateway_response.cors_4xx,
    aws_api_gateway_gateway_response.cors_5xx,
  ]
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "prod"
}
