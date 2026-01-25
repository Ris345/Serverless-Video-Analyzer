resource "aws_dynamodb_table" "interview_analysis" {
  name         = "InterviewAnalysis"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "videoId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "videoId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "user_metadata" {
  name         = "UserMetadata"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userEmail"

  attribute {
    name = "userEmail"
    type = "S"
  }
}

resource "aws_dynamodb_table" "next_auth" {
  name           = "next-auth"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "pk"
  range_key      = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name               = "GSI1"
    hash_key           = "GSI1PK"
    range_key          = "GSI1SK"
    projection_type    = "ALL"
  }
}
