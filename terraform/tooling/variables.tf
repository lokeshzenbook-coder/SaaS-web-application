variable "aws_region" {
  description = "AWS region where the cluster lives"
  type        = string
  default     = "us-east-1"
}

variable "state_bucket" {
  description = "S3 bucket holding the shared Terraform state"
  type        = string
}

variable "eks_state_key" {
  description = "State key of the EKS stack (e.g. env:/prod/eks/terraform.tfstate)"
  type        = string
}

variable "application_namespace" {
  description = "Namespace where the application is deployed"
  type        = string
  default     = "saas-web-application"
}

variable "gitops_repo_url" {
  description = "GitOps (Helm manifests) repository URL"
  type        = string
}

variable "gitops_repo_username" {
  description = "Username for the GitOps repo (e.g. cicd-bot)"
  type        = string
  default     = ""
}

variable "gitops_repo_token" {
  description = "Token/PAT for the GitOps repo"
  type        = string
  sensitive   = true
  default     = ""
}

variable "argocd_domain" {
  description = "Domain for the Argo CD UI"
  type        = string
  default     = "argocd.example.com"
}

variable "argocd_ingress_enabled" {
  description = "Enable ALB ingress for Argo CD server"
  type        = bool
  default     = false
}

variable "argocd_chart_version" {
  type    = string
  default = "7.4.0"
}

variable "argo_rollouts_chart_version" {
  type    = string
  default = "2.37.0"
}

variable "kyverno_chart_version" {
  type    = string
  default = "3.2.4"
}

variable "falco_chart_version" {
  type    = string
  default = "4.8.0"
}

variable "falco_slack_enabled" {
  description = "Enable Falco Slack notifications"
  type        = bool
  default     = false
}

variable "falco_slack_channel" {
  type    = string
  default = "#security"
}

variable "falco_slack_webhook" {
  type      = string
  sensitive = true
  default   = ""
}

variable "aws_lb_controller_chart_version" {
  type    = string
  default = "1.9.0"
}

variable "cluster_autoscaler_chart_version" {
  type    = string
  default = "9.43.2"
}

variable "prometheus_chart_version" {
  type    = string
  default = "61.8.0"
}

variable "sealed_secrets_chart_version" {
  type    = string
  default = "2.16.2"
}

variable "external_secrets_chart_version" {
  type    = string
  default = "0.13.0"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default = {
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}
