resource "aws_dynamodb_table" "user_metadata" {
  count        = var.phase >= 3 ? 1 : 0
  
  name         = "UserMetadata"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userEmail"

  attribute {
    name = "userEmail"
    type = "S"
  }
}

