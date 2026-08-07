# =============================================================================
# Namespaces for tooling
# =============================================================================
resource "kubernetes_namespace_v1" "argocd" {
  metadata {
    name = "argocd"
  }
}

resource "kubernetes_namespace_v1" "kyverno" {
  metadata {
    name = "kyverno"
  }
}

resource "kubernetes_namespace_v1" "falco" {
  metadata {
    name = "falco"
  }
}

resource "kubernetes_namespace_v1" "application" {
  metadata {
    name = var.application_namespace
  }
}

# =============================================================================
# Argo CD - GitOps engine (Stage 3 & 4 of the pipeline)
# =============================================================================
resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  namespace        = kubernetes_namespace_v1.argocd.metadata[0].name
  create_namespace = false
  version          = var.argocd_chart_version
  timeout          = 600
  atomic           = true

  values = [
    <<-EOT
    global:
      domain: ${var.argocd_domain}
    server:
      ingress:
        enabled: ${var.argocd_ingress_enabled}
        ingressClassName: aws-load-balancer
        annotations:
          kubernetes.io/ingress.class: alb
          alb.ingress.kubernetes.io/scheme: internet-facing
          alb.ingress.kubernetes.io/target-type: ip
          alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'
        hosts:
          - ${var.argocd_domain}
    configs:
      params:
        server.insecure: "true"
      rbac:
        policy.csv: |
          g, cicd-bot, role:admin
        policy.default: role:readonly
      repositories:
        gitops:
          url: ${var.gitops_repo_url}
          username: ${var.gitops_repo_username}
          password: ${var.gitops_repo_token}
    EOT
  ]
}

# =============================================================================
# Argo Rollouts - Canary / Blue-Green deployment controller (Stage 7)
# =============================================================================
resource "helm_release" "argo_rollouts" {
  name             = "argo-rollouts"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-rollouts"
  namespace        = "argocd"
  create_namespace = false
  version          = var.argo_rollouts_chart_version
  timeout          = 300
  atomic           = true

  set {
    name  = "controller.ingress.enabled"
    value = "false"
  }
}

# =============================================================================
# Kyverno - Kubernetes Admission Policies (Stage 5)
# =============================================================================
resource "helm_release" "kyverno" {
  name             = "kyverno"
  repository       = "https://kyverno.github.io/kyverno/"
  chart            = "kyverno"
  namespace        = kubernetes_namespace_v1.kyverno.metadata[0].name
  create_namespace = false
  version          = var.kyverno_chart_version
  timeout          = 300
  atomic           = true

  values = [
    <<-EOT
    admissionController:
      replicas: 2
    backgroundController:
      replicas: 2
    cleanupController:
      enabled: true
    reportsController:
      enabled: true
    EOT
  ]
}

# Example admission policy: block `latest` image tags (Stage 5)
resource "kubectl_manifest" "kyverno_block_latest" {
  depends_on = [helm_release.kyverno]

  yaml_body = <<-YAML
  apiVersion: kyverno.io/v1
  kind: ClusterPolicy
  metadata:
    name: require-image-tag-not-latest
  spec:
    validationFailureAction: Enforce
    background: true
    rules:
      - name: require-image-tag
        match:
          any:
            - resources:
                kinds:
                  - Deployment
                  - StatefulSet
                  - DaemonSet
        validate:
          message: "Using a mutable image tag like 'latest' is not allowed"
          foreach:
            - list: "request.object.spec.template.spec.containers"
              deny:
                conditions:
                  all:
                    - key: "{{ element.image }}"
                      operator: AnyIn
                      value:
                        - ":latest"
                        - "latest"
  YAML
}

# Example admission policy: disallow privileged containers (Stage 5)
resource "kubectl_manifest" "kyverno_disallow_privileged" {
  depends_on = [helm_release.kyverno]

  yaml_body = <<-YAML
  apiVersion: kyverno.io/v1
  kind: ClusterPolicy
  metadata:
    name: disallow-privileged-containers
  spec:
    validationFailureAction: Enforce
    background: true
    rules:
      - name: validate-privileged
        match:
          any:
            - resources:
                kinds:
                  - Pod
        validate:
          message: "Privileged containers are not allowed"
          pattern:
            spec:
              containers:
                - securityContext:
                    privileged: false
  YAML
}

# =============================================================================
# Falco - Runtime Security (Stage 13)
# =============================================================================
resource "helm_release" "falco" {
  name             = "falco"
  repository       = "https://falcosecurity.github.io/charts"
  chart            = "falco"
  namespace        = kubernetes_namespace_v1.falco.metadata[0].name
  create_namespace = false
  version          = var.falco_chart_version
  timeout          = 300
  atomic           = true

  values = [
    <<-EOT
    falco:
      rules_files:
        - /etc/falco/falco_rules.yaml
        - /etc/falco/falco_rules.local.yaml
        - /etc/falco/k8s_audit_rules.yaml
      outputs:
        stdout:
          enabled: true
        slack:
          enabled: ${var.falco_slack_enabled}
          channel: ${var.falco_slack_channel}
          webhook_url: ${var.falco_slack_webhook}
      alert_rules:
        enable: true
    tolerations:
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
    EOT
  ]
}

# =============================================================================
# AWS Load Balancer Controller - ALB/NLB provisioning for Ingress (Stage 6/7)
# =============================================================================
module "aws_load_balancer_controller" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.40.0"

  role_name                              = "aws-load-balancer-controller"
  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = data.terraform_remote_state.eks.outputs.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }

  tags = var.tags
}

resource "helm_release" "aws_load_balancer_controller" {
  name             = "aws-load-balancer-controller"
  repository       = "https://aws.github.io/eks-charts"
  chart            = "aws-load-balancer-controller"
  namespace        = "kube-system"
  create_namespace = false
  version          = var.aws_lb_controller_chart_version
  timeout          = 300
  atomic           = true

  set {
    name  = "clusterName"
    value = data.terraform_remote_state.eks.outputs.cluster_name
  }
  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.aws_load_balancer_controller.iam_role_arn
  }
}

# =============================================================================
# Cluster Autoscaler (uses the IRSA role from the eks stack)
# =============================================================================
resource "helm_release" "cluster_autoscaler" {
  name             = "cluster-autoscaler"
  repository       = "https://kubernetes.github.io/autoscaler"
  chart            = "cluster-autoscaler"
  namespace        = "kube-system"
  create_namespace = false
  version          = var.cluster_autoscaler_chart_version
  timeout          = 300
  atomic           = true

  set {
    name  = "autoDiscovery.clusterName"
    value = data.terraform_remote_state.eks.outputs.cluster_name
  }
  set {
    name  = "awsRegion"
    value = var.aws_region
  }
  set {
    name  = "rbac.serviceAccount.name"
    value = "cluster-autoscaler"
  }
  set {
    name  = "rbac.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = data.terraform_remote_state.eks.outputs.cluster_autoscaler_role_arn
  }
  set {
    name  = "extraArgs.logtostderr"
    value = "true"
  }
}

# =============================================================================
# Prometheus + Grafana stack - metrics for performance tests / Dashboards
# =============================================================================
resource "helm_release" "prometheus" {
  name             = "prometheus"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  namespace        = "kube-prometheus"
  create_namespace = true
  version          = var.prometheus_chart_version
  timeout          = 600
  atomic           = true

  set {
    name  = "grafana.service.type"
    value = "ClusterIP"
  }
}

# =============================================================================
# Sealed Secrets - encrypt secrets in the GitOps repo
# =============================================================================
resource "helm_release" "sealed_secrets" {
  name             = "sealed-secrets"
  repository       = "https://bitnami-labs.github.io/sealed-secrets"
  chart            = "sealed-secrets"
  namespace        = "kube-system"
  create_namespace = false
  version          = var.sealed_secrets_chart_version
  timeout          = 300
  atomic           = true
}

# =============================================================================
# External Secrets / AWS Secrets Manager provider (for Argo CD creds)
# =============================================================================
resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  namespace        = "external-secrets"
  create_namespace = true
  version          = var.external_secrets_chart_version
  timeout          = 300
  atomic           = true
}
