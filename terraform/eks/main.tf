# =============================================================================
# VPC - network foundation for the EKS cluster
# =============================================================================
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8.0"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs             = var.availability_zones
  private_subnets = var.private_subnets
  public_subnets  = var.public_subnets

  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = false
  enable_vpn_gateway     = false
  enable_dns_hostnames   = true
  enable_dns_support     = true

  private_subnet_tags = {
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "kubernetes.io/role/internal-elb"           = "1"
  }

  public_subnet_tags = {
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "kubernetes.io/role/elb"                    = "1"
  }

  nat_gateway_tags = {
    Name = "${var.cluster_name}-nat"
  }

  tags = var.tags
}

# =============================================================================
# EKS cluster
# =============================================================================
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.24.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  cluster_endpoint_public_access           = var.cluster_endpoint_public_access
  cluster_endpoint_private_access          = var.cluster_endpoint_private_access
  cluster_endpoint_public_access_cidrs     = var.cluster_endpoint_public_access_cidrs
  cluster_security_group_additional_rules  = var.cluster_security_group_additional_rules

  # Control plane logging
  cluster_enabled_log_types = [
    "api",
    "audit",
    "authenticator",
    "controllerManager",
    "scheduler",
  ]
  cloudwatch_log_group_retention_in_days = var.log_retention_days

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # EKS managed addons
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
      configuration_values = jsonencode({
        env = {
          ENABLE_PREFIX_DELEGATION = "true"
          ENABLE_POD_ENI           = "true"
        }
      })
    }
    aws-ebs-csi-driver = {
      most_recent = true
    }
  }

  # Managed node group
  eks_managed_node_groups = {
    workers = {
      name = "workers"

      instance_types = var.node_instance_types
      ami_type       = "AL2_x86_64"

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size

      capacity_type  = var.node_capacity_type
      disk_size      = var.node_disk_size
      force_update_version = true

      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = var.node_disk_size
            volume_type           = "gp3"
            encrypted             = true
            delete_on_termination = true
          }
        }
      }

      update_config = {
        max_unavailable_percentage = 25
      }

      labels = {
        "node.kubernetes.io/role" = "workers"
      }

      tags = merge(var.tags, {
        "k8s.io/cluster-autoscaler/enabled"      = "true"
        "k8s.io/cluster-autoscaler/${var.cluster_name}" = "owned"
      })
    }

    # Fargate-style spot workers for cost savings
    spot-workers = {
      name = "spot-workers"

      instance_types = var.spot_node_instance_types
      capacity_type  = "SPOT"

      min_size     = var.spot_node_min_size
      max_size     = var.spot_node_max_size
      desired_size = var.spot_node_desired_size

      labels = {
        "node.kubernetes.io/role"    = "spot"
        "node.kubernetes.io/lifecycle" = "spot"
      }

      tags = var.tags
    }
  }

  # IRSA for Cluster Autoscaler / LB controller / external-dns etc.
  enable_irsa = true

  # Security group rules for ingress traffic
  node_security_group_additional_rules = {
    ingress_self_all = {
      description = "Allow all ingress between nodes"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "ingress"
      self        = true
    }
    ingress_allow_access_from_control_plane = {
      description = "Allow ingress from control plane"
      protocol    = "tcp"
      from_port   = 1025
      to_port     = 65535
      type        = "ingress"
      source_cluster_security_group = true
    }
  }

  tags = var.tags
}

# =============================================================================
# IAM role for GitHub Actions deployments (used by the CD pipeline)
# =============================================================================
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprints

  tags = var.tags
}

resource "aws_iam_role" "github_actions_deploy" {
  name        = "github-actions-deploy"
  description = "Role assumed by GitHub Actions to deploy to EKS"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = [
              "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/main",
              "repo:${var.github_org}/${var.github_repo}:environment:production",
            ]
          }
        }
      }
    ]
  })

  tags = var.tags
}

# Grant GitHub Actions permissions to manage resources in the cluster
# via EKS Access Entries (requires EKS >= 1.23)
resource "aws_eks_access_entry" "github_actions_deploy" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_actions_deploy.arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "github_actions_deploy_admin" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_actions_deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

resource "aws_eks_access_policy_association" "github_actions_deploy_view" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_actions_deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy"

  access_scope {
    type = "namespace"
    namespaces = [
      var.application_namespace,
      "argocd",
      "kyverno",
      "falco",
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_eks_cluster_admin" {
  name = "github-actions-eks-cluster-admin"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "eks:DescribeCluster",
          "eks:ListClusters",
          "eks:AccessKubernetesApi",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ]
        Resource = "*"
      }
    ]
  })
}

# Cluster-autoscaler role + policy
module "cluster_autoscaler_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.40.0"

  role_name                     = "cluster-autoscaler"
  attach_cluster_autoscaler_policy = true
  cluster_autoscaler_cluster_ids   = [module.eks.cluster_name]

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:cluster-autoscaler"]
    }
  }

  tags = var.tags
}

# EBS CSI Driver (managed addon above needs a role)
module "ebs_csi_driver_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.40.0"

  role_name                          = "ebs-csi-driver"
  attach_ebs_csi_policy              = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }

  tags = var.tags
}
