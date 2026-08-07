output "argocd_server_service" {
  description = "Argo CD server service name"
  value       = "argocd-server.argocd.svc.cluster.local"
}

output "argocd_initial_password_command" {
  description = "Command to fetch the initial Argo CD admin password"
  value       = "kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
}

output "kyverno_namespace" {
  value = "kyverno"
}

output "falco_namespace" {
  value = "falco"
}

output "aws_load_balancer_controller_role_arn" {
  description = "IRSA role ARN of the AWS Load Balancer Controller"
  value       = module.aws_load_balancer_controller.iam_role_arn
}
