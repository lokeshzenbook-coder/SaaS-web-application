# SaaS Web Application — Deployment Guide

Deployment guide for **`saas-web-application`**: GitOps continuous deployment
pipeline (`.github/workflows/cd.yaml`), Kubernetes manifests (Helm chart), and
the Terraform code that provisions the Amazon EKS cluster.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Repository Layout](#2-repository-layout)
3. [Kubernetes Manifests (Helm Chart)](#3-kubernetes-manifests-helm-chart)
4. [Continuous Deployment Pipeline (cd.yaml)](#4-continuous-deployment-pipeline-cdyaml)
5. [Terraform — EKS Infrastructure](#5-terraform--eks-infrastructure)
6. [Terraform — GitOps Tooling](#6-terraform--gitops-tooling)
7. [Secrets Management](#7-secrets-management)
8. [Rollback & Troubleshooting](#8-rollback--troubleshooting)

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ GitHub Actions                                                        │
│                                                                        │
│  ci.yml (CI)                              cd.yaml (CD, 14 stages)     │
│  ┌──────────────────────────┐             ┌──────────────────────────┐ │
│  │ 1. Secrets scan (Gitleaks)│            │ 1. Update Helm image tag │ │
│  │ 2. SAST (Semgrep)         │            │ 2. Commit to GitOps repo │ │
│  │ 3. SCA (OWASP DC)         │            │ 3. Argo CD detects       │ │
│  │ 4. Lint & format          │            │ 4. Sync (Argo CD)        │ │
│  │ 5. Unit tests + coverage  │  image     │ 5. Kyverno policies      │ │
│  │ 6. Build image            │ ───────►   │ 6. Deploy to EKS         │ │
│  │ 7. Trivy + Grype + SBOM   │            │ 7. Canary / blue-green   │ │
│  │ 8. Push to Docker Hub     │            │ 8. Smoke tests           │ │
│  └──────────────────────────┘             │ 9. ZAP  10. k6 11. Newman│ │
│                                           │ 12. Production release   │ │
│                                           │ 13. Falco (runtime)      │ │
│                                           │ 14. Slack                │ │
│                                           └──────────────────────────┘ │
└───────────────┬──────────────────────────────────────────┬─────────────┘
                │ image pushed (Docker Hub)                 │ git push
                ▼                                          ▼
        ┌───────────────┐                         ┌─────────────────┐
        │ Docker Hub    │                         │ GitOps repo     │
        │  :latest      │                         │ (this repo)     │
        │  :<short-sha> │                         │ gitops/charts/… │
        └───────┬───────┘                         └────────┬────────┘
                │ pulled by EKS workers                     │ watched by
                ▼                                            ▼
        ┌───────────────────────────────────────────────────────────┐
        │ Amazon EKS  (provisioned by terraform/eks)                │
        │  Argo CD syncs gitops/charts → namespaces, Deployments/   │
        │  Rollouts, Services, Ingress (ALB), HPA, PDB              │
        │  Kyverno validates every admitted resource                │
        │  Falco monitors runtime behaviour                         │
        │  Argo Rollouts performs canary / blue-green               │
        └───────────────────────────────────────────────────────────┘
```

**Flow:** CI builds, scans, and pushes the image → CD updates the Helm
`values.yaml` image tag in the GitOps path and commits → Argo CD picks up the
change, validates it through Kyverno admission policies, and syncs → Argo
Rollouts releases it progressively (canary/blue-green) → automated tests gate
promotion → Falco watches runtime → Slack notifies.

---

## 2. Repository Layout

```text
.github/
  workflows/
    ci.yml                     # CI: secrets scan, SAST, SCA, tests, build, image scan, push
    cd.yaml                    # CD: 14-stage deploy-to-EKS pipeline
gitops/
  charts/
    saas-web-application/      # Helm chart (source of truth for K8s manifests)
      Chart.yaml
      values.yaml              # image tag updated by cd.yaml stage 1
      templates/               # K8s manifests rendered by Argo CD
  argocd/
    applications/
      saas-web-application.yaml# Argo CD Application (points at the chart)
terraform/
  eks/                         # VPC + EKS cluster + node groups + IAM (run FIRST)
  tooling/                     # Helm releases: Argo CD, Kyverno, Falco, ... (run SECOND)
DEPLOYMENT.md                  # this file
```

---

## 3. Kubernetes Manifests (Helm Chart)

The Kubernetes manifests live in `gitops/charts/saas-web-application/templates/`.
Argo CD renders them with `helm template` using `gitops/charts/saas-web-application/values.yaml`.

### 3.1 Template files

| Template | Resource(s) | Purpose |
|----------|-------------|---------|
| `_helpers.tpl` | — | Labels, pod spec, container spec (shared) |
| `deployment.yaml` | `Deployment` | Used when `strategy.type: rolling` |
| `rollout.yaml` | `Rollout` (Argo Rollouts) | Canary / blue-green (cd.yaml stage 7) |
| `service.yaml` | `Service` (+ active/preview for blue-green) | In-cluster routing |
| `ingress.yaml` | `Ingress` (ALB) | External traffic via AWS Load Balancer Controller |
| `configmap.yaml` | `ConfigMap` | Non-sensitive env vars (`env.*`) |
| `secret.yaml` | `Secret` | Sensitive env vars (`secrets.*`) — placeholders |
| `sealedsecret.yaml` | `SealedSecret` | Production secret scaffold (optional) |
| `serviceaccount.yaml` | `ServiceAccount` | Pod identity |
| `hpa.yaml` | `HorizontalPodAutoscaler` | CPU/memory autoscaling |
| `pdb.yaml` | `PodDisruptionBudget` | Availability during node drains |
| `networkpolicy.yaml` | `NetworkPolicy` | Disabled by default (see §3.3) |
| `NOTES.txt` | — | Post-install hints |

### 3.2 Deployment strategies (stage 7)

Set `strategy.type` in `values.yaml`:

| `strategy.type` | Rendered kind | Behaviour |
|-----------------|---------------|-----------|
| `rolling` | `Deployment` | Standard RollingUpdate (`maxSurge`/`maxUnavailable`) |
| `canary` | `Rollout` | Weighted steps (10% → pause → 40% → pause → 80%) |
| `blue-green` | `Rollout` | `active` + `preview` Services; auto/pause promotion |

The cd.yaml `canary-deployment` job drives Rollouts:

```bash
kubectl argo rollouts set image saas-web-application \
  "saas-web-application=<image-repo>:<tag>" -n saas-web-application
kubectl argo rollouts status saas-web-application -n saas-web-application
```

> The container name must stay `saas-web-application` (`values.containerName`)
> — it is the target of the `set image` command.

### 3.3 Important values

- **Probes** use `/healthz` (the only health endpoint the app exposes).
- **Secrets** in `values.yaml` are **placeholders** — see §7.
- **NetworkPolicy** is `enabled: false` by default because ALB `target-type: ip`
  sources traffic from inside the VPC; a strict policy can block the ALB.
- Render locally to inspect the output:

  ```bash
  helm template saas-web-application gitops/charts/saas-web-application \
    --namespace saas-web-application --set strategy.type=canary
  ```

### 3.4 Argo CD Application

`gitops/argocd/applications/saas-web-application.yaml` tells Argo CD where the
chart lives and how to sync:

```yaml
source:
  repoURL: https://github.com/lokeshzenbook-coder/SaaS-web-application.git
  path: gitops/charts/saas-web-application
  targetRevision: main
destination:
  server: https://kubernetes.default.svc
  namespace: saas-web-application
syncPolicy:
  automated: { selfHeal: true, prune: true }
```

---

## 4. Continuous Deployment Pipeline (cd.yaml)

File: `.github/workflows/cd.yaml`. Triggered on push to `main` (excluding
`terraform/**`) or manually via `workflow_dispatch`.

### 4.1 The 14 stages

| # | Stage | Job | Tool | What it does |
|---|-------|-----|------|--------------|
| 1 | Update Helm Chart Image Tag | `update-helm-image-tag` | `yq` | Checks out the GitOps repo, rewrites `image.tag`/`image.repository` in `gitops/charts/saas-web-application/values.yaml`; uploads result as artifact |
| 2 | Commit to GitOps Repository | `commit-to-gitops` | `git` | Downloads the updated `values.yaml`, commits and pushes to the GitOps repo |
| 3 | Argo CD Detects Changes | `argocd-detect-changes` | `argocd` CLI | Polls `argocd app get` until the application reports `OutOfSync`/`Synced` |
| 4 | Sync Application to Kubernetes | `argocd-sync` | `argocd` CLI | `argocd app sync --prune --force` then `argocd app wait --health --sync` |
| 5 | Kubernetes Admission Policies | `admission-policies` | Kyverno / OPA Gatekeeper | Runs Kyverno against rendered manifests; fails on `PolicyReport` failures |
| 6 | Deploy to Amazon EKS | `deploy-to-eks` | `kubectl` | `kubectl rollout status`, verifies nodes Ready |
| 7 | Rolling / Blue-Green / Canary | `canary-deployment` | Argo Rollouts | `set image` on the Rollout, waits for progress; optional promote |
| 8 | Smoke Tests / Health Checks | `smoke-tests` | `curl` + `kubectl` | Resolves the ALB ingress host, gates on `/healthz`, verifies pods Ready; exposes `app_url` output |
| 9 | Dynamic Security | `dynamic-security-zap` | OWASP ZAP | Full scan of the live app; uploads HTML report; gates on high-risk findings |
| 10 | Performance Testing | `performance-testing` | k6 | Load test against SLOs (p95 < 500 ms, error rate < 1%) |
| 11 | Integration/API Testing | `integration-api-tests` | Postman / Newman | Runs the Postman collection; uploads HTML report |
| 12 | Production Release | `production-release` | GitHub Release | Tags `v<run_number>-<sha>`, creates a GitHub Release |
| 13 | Runtime Security | `runtime-security-falco` | Falco | Verifies Falco is running; fails on Critical/Emergency events |
| 14 | Slack Notification | `slack-notify` | Slack | Always runs; posts success/failure summary with links |

**Execution order:**

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 ─┬→ 9  ─┐
                                 ├→ 10 ─┼→ 12 → 14
                                 └→ 11 ─┘
                      6 ──────────────────→ 13 (parallel) → 14
```

Stages 9, 10, 11 run **in parallel** after stage 8. Stage 13 runs alongside,
starting after stage 6.

### 4.2 Required GitHub configuration

**Repository variables** (`Settings → Secrets and variables → Actions → Variables`):

| Variable | Example | Used by |
|----------|---------|---------|
| `AWS_REGION` | `us-east-1` | all AWS steps |
| `AWS_ACCOUNT_ID` | `123456789012` | role ARNs (`arn:aws:iam::…:role/github-actions-deploy`) |
| `EKS_CLUSTER_NAME` | `saas-web-application-prod-eks` | `eks update-kubeconfig` |
| `IMAGE_REPOSITORY` | `lokeshzenbook-coder/saas-web-application` | image tag + Rollout set-image |
| `GITOPS_REPOSITORY` | `lokeshzenbook-coder/SaaS-web-application` | checkout in stages 1–2 |
| `ARGO_APP_NAME` | `saas-web-application` | Argo CD CLI |

**Repository secrets** (`Settings → Secrets and variables → Actions → Secrets`):

| Secret | Purpose |
|--------|---------|
| `GITOPS_PAT` | Token with `repo` scope to commit/push the GitOps repo |
| `SLACK_BOT_TOKEN` | Slack app token (`slackapi/slack-github-action`) |
| `SLACK_WEBHOOK_URL` | Webhook fallback / Falco alerts |

**IAM roles** (created by Terraform, see §5.4):

- `github-actions-deploy` — assumed by every CD job; mapped to
  `AmazonEKSClusterAdminPolicy` via an EKS Access Entry.

**Argo CD secret** stored in AWS Secrets Manager:

```bash
aws secretsmanager create-secret --name "${EKS_CLUSTER_NAME}/argocd" \
  --secret-string '{"server":"https://<argocd-host>","password":"<admin-password>"}'
```

### 4.3 Triggering

```bash
# manual run with a specific tag
gh workflow run "CD - Deploy to Amazon EKS" -f image_tag=abc12345 -f promote=true
```

> CI (`ci.yml`) pushes images tagged with the **8-character short SHA**; cd.yaml
> shortens `github.sha` to 8 characters to match.

---

## 5. Terraform — EKS Infrastructure

Directory: `terraform/eks/`

### 5.1 Prerequisites

- Terraform ≥ 1.5, AWS CLI, `kubectl`, `helm`
- AWS credentials (or an assume-role profile) with permission to create the
  resources below
- An S3 bucket for state (recommended; see `versions.tf` backend block)

### 5.2 What it creates

| Area | Resources |
|------|-----------|
| VPC | VPC (`10.0.0.0/16`), 3 private + 3 public subnets, NAT gateways, DNS settings, correct `kubernetes.io/cluster` tags |
| EKS | Cluster (default K8s 1.31), private endpoint, API/audit/authenticator logs (30-day retention) |
| Addons | CoreDNS, kube-proxy, VPC CNI (prefix delegation), AWS EBS CSI driver |
| Nodes | On-demand group (`m5.large`, 2–8 nodes) + SPOT group (1–6 nodes), GP3 encrypted disks |
| IAM | GitHub Actions OIDC provider, `github-actions-deploy` role + EKS Access Entries, Cluster Autoscaler IRSA, EBS CSI IRSA |

### 5.3 Key variables (`variables.tf`, example in `terraform.tfvars.example`)

| Variable | Default | Notes |
|----------|---------|-------|
| `aws_region` | `us-east-1` | Region |
| `cluster_name` | — | **required** |
| `cluster_version` | `1.31` | EKS K8s version |
| `node_instance_types` | `["m5.large","m5a.large"]` | On-demand worker types |
| `node_min_size` / `node_max_size` / `node_desired_size` | `2` / `10` / `3` | Autoscaling bounds |
| `spot_node_*` | `1` / `8` / `2` | SPOT group bounds |
| `github_org` / `github_repo` | — | **required** — scopes the OIDC trust policy |
| `github_oidc_thumbprints` | GitHub thumbprint | Verify if GitHub rotates |
| `application_namespace` | `saas-web-application` | Namespace granted to the deploy role |

### 5.4 Deploy steps

```bash
cd terraform/eks
cp terraform.tfvars.example terraform.tfvars   # edit values
terraform init
terraform plan -out plan.tf
terraform apply plan.tf

# point kubectl at the new cluster
$(terraform output configure_kubectl)
```

### 5.5 Key outputs

| Output | Use |
|--------|-----|
| `cluster_name` / `cluster_endpoint` | kubectl + Argo CD |
| `oidc_provider_arn` | IRSA roles in tooling stack |
| `cluster_autoscaler_role_arn` | Cluster Autoscaler Helm values |
| `github_actions_deploy_role_arn` | set the `github-actions-deploy` reference |
| `configure_kubectl` | ready-to-run kubeconfig command |

---

## 6. Terraform — GitOps Tooling

Directory: `terraform/tooling/` — run **after** `terraform/eks`. It reads the
EKS stack outputs from remote state (`state_bucket` + `eks_state_key`) and
installs the cluster tooling with Helm.

### 6.1 What it installs

| Component | Chart / Repo | Namespace | Pipeline stage |
|-----------|--------------|-----------|----------------|
| Argo CD | `argo-cd` (argoproj) | `argocd` | 3, 4 |
| Argo Rollouts | `argo-rollouts` (argoproj) | `argocd` | 7 |
| Kyverno + 2 `ClusterPolicy`s | `kyverno` | `kyverno` | 5 |
| Falco | `falco` (falcosecurity) | `falco` | 13 |
| AWS Load Balancer Controller | `eks-charts` | `kube-system` | 6, 7 (ALB) |
| Cluster Autoscaler | `cluster-autoscaler` | `kube-system` | node autoscaling |
| kube-prometheus-stack | prometheus-community | `kube-prometheus` | metrics/dashboards |
| Sealed Secrets | bitnami-labs | `kube-system` | §7 |
| External Secrets | external-secrets | `external-secrets` | §7 |

Kyverno ships two enforced `ClusterPolicy`s:

- `require-image-tag-not-latest` — blocks mutable `latest` tags.
- `disallow-privileged-containers` — blocks privileged pods.

### 6.2 Deploy steps

```bash
cd terraform/tooling
cp terraform.tfvars.example terraform.tfvars   # edit values
terraform init
terraform plan -out plan.tf
terraform apply plan.tf

# initial Argo CD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

### 6.3 Post-install

1. Store Argo CD server + password in Secrets Manager (§4.2).
2. Apply the Argo CD Application (`gitops/argocd/applications/saas-web-application.yaml`)
   so Argo CD starts syncing the chart:

   ```bash
   kubectl apply -f gitops/argocd/applications/saas-web-application.yaml
   ```

---

## 7. Secrets Management

`values.yaml` contains **placeholder** secrets only. Choose one of:

1. **Sealed Secrets** (installed by tooling): encrypt a value and commit it:

   ```bash
   kubeseal --format yaml --scope cluster-wide \
     < secrets.yaml > sealed.yaml
   ```

   Then enable `secrets.sealed.enabled: true` in `values.yaml` and commit the
   sealed blob instead of plaintext.

2. **External Secrets** (installed by tooling): create a `SecretStore` pointing
   at AWS Secrets Manager, then a `Secret` that pulls `JWT_SECRET`:

   ```yaml
   apiVersion: external-secrets.io/v1beta1
   kind: ExternalSecret
   metadata: { name: saas-web-application, namespace: saas-web-application }
   spec:
     secretStoreRef: { name: aws-secretsmanager, kind: SecretStore }
     target: { name: saas-web-application }
     data:
       - secretKey: JWT_SECRET
         remoteRef: { key: saas/JWT_SECRET }
   ```

3. **GitHub/GitOps only flow**: store the value in the GitOps repo via a fine-
   grained PAT with restricted access (not recommended for production).

Generate a strong value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 8. Rollback & Troubleshooting

### 8.1 Rollback

| Layer | How |
|-------|-----|
| GitOps | `git revert` the `values.yaml` commit; Argo CD self-heals back |
| Argo CD | `argocd app rollback saas-web-application <revision>` |
| Argo Rollouts | `kubectl argo rollouts undo saas-web-application -n saas-web-application` |
| Kubernetes | `kubectl rollout undo deployment/saas-web-application -n saas-web-application` |

### 8.2 Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ImagePullBackOff` | wrong `IMAGE_REPOSITORY` or private image | set repo vars; add `imagePullSecrets` / grant pull access |
| Rollout stuck `Paused` | canary pause step waiting | `kubectl argo rollouts promote` |
| Argo CD `OutOfSync` loop | drift / `selfHeal` | check `argocd app diff`, commit drift |
| Kyverno blocks resource | policy violation (`latest` tag, privileged) | tag image with SHA; fix securityContext |
| ALB not creating | LB controller missing / wrong subnets | verify tooling stack; check subnet tags |
| Pipeline fails at ZAP | high-risk finding | fix app, or review report artifact |
| k6 SLO failure | under-provisioned nodes | raise `node_max_size` / HPA limits |

### 8.3 Useful commands

```bash
kubectl get all -n saas-web-application
kubectl argo rollouts get rollout saas-web-application -n saas-web-application
argocd app get saas-web-application
kubectl get policyreport -n saas-web-application
kubectl logs -n falco -l app.kubernetes.io/name=falco
kubectl get ingress -n saas-web-application
```
