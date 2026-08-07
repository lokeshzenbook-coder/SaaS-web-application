variable "aws_region" {
  description = "AWS region where the EKS cluster is deployed"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.31"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for subnets"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "private_subnets" {
  description = "Private subnets CIDRs"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "public_subnets" {
  description = "Public subnets CIDRs"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "single_nat_gateway" {
  description = "Use a single shared NAT gateway (cost saving for dev)"
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access" {
  description = "Allow public access to the EKS API endpoint"
  type        = bool
  default     = false
}

variable "cluster_endpoint_private_access" {
  description = "Allow private (in-VPC) access to the EKS API endpoint"
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the public EKS API endpoint"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "cluster_security_group_additional_rules" {
  description = "Additional security group rules for the EKS cluster"
  type        = map(any)
  default     = {}
}

variable "log_retention_days" {
  description = "CloudWatch log group retention for EKS control plane logs"
  type        = number
  default     = 30
}

variable "node_instance_types" {
  description = "Instance types for the on-demand worker node group"
  type        = list(string)
  default     = ["m5.large", "m5a.large"]
}

variable "node_capacity_type" {
  description = "Capacity type for the primary node group (ON_DEMAND or SPOT)"
  type        = string
  default     = "ON_DEMAND"
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 10
}

variable "node_desired_size" {
  type    = number
  default = 3
}

variable "node_disk_size" {
  description = "Root disk size (GiB) for worker nodes"
  type        = number
  default     = 50
}

variable "spot_node_instance_types" {
  description = "Instance types for the SPOT worker node group"
  type        = list(string)
  default     = ["m5.large", "c5.large", "t3.large"]
}

variable "spot_node_min_size" {
  type    = number
  default = 1
}

variable "spot_node_max_size" {
  type    = number
  default = 8
}

variable "spot_node_desired_size" {
  type    = number
  default = 2
}

variable "github_org" {
  description = "GitHub organization that owns the application repo"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "github_oidc_thumbprints" {
  description = "OIDC thumbprints for the GitHub Actions provider"
  type        = list(string)
  default = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
  ]
}

variable "application_namespace" {
  description = "Namespace where the application will be deployed"
  type        = string
  default     = "saas-web-application"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default = {
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}
