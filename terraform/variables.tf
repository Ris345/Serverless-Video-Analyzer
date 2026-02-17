variable "phase" {
  description = "Deployment phase (1: Infra, 2: Lambda, 3: User DB)"
  type        = number
  default     = 1
}

variable "aws_region" {
  description = "AWS Region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "video-analyzer"
}

variable "environment" {
  description = "Environment (dev, prod)"
  type        = string
  default     = "dev"
}

variable "openai_api_key" {
  description = "OpenAI API Key for analysis Lambda"
  type        = string
  sensitive   = true
}
