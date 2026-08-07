terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.15.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.32.0"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.15.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12.0"
    }
  }
}

# Remote backend (uncomment and fill in to persist state in S3 + DynamoDB)
# backend "s3" {
#   bucket         = "my-terraform-state-bucket"
#   key            = "env:/dev/eks/terraform.tfstate"
#   region         = "us-east-1"
#   dynamodb_table = "terraform-locks"
#   encrypt        = true
# }
