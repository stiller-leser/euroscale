# Euroscale — Sovereign Cloud Platform

[![CNCF? Not yet](https://img.shields.io/badge/cncf-%2Dnot%20yet-lightgrey?style=flat-square)]()
[![Built with Kind](https://img.shields.io/badge/built%20with-Kind-326CE5?style=flat-square&logo=kubernetes)]()
[![GitOps](https://img.shields.io/badge/GitOps-ArgoCD-EF7B4D?style=flat-square)]()
[![Secrets](https://img.shields.io/badge/secrets-OpenBao-FFD54F?style=flat-square)]()
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)]()

**Euroscale** is an open platform for operating sovereign, self-hosted cloud infrastructure — designed for cloud hosters who want to offer their customers true **cloud provider freedom**.

Deploy a complete GitOps-driven control plane on any Kubernetes cluster. Let your customers run workloads on any provider without vendor lock-in, without data sovereignty compromises, and without giving up control.

**DISCLAIMER**: This project is currently in a PoC phase and actively being developed. While all decisions, conecpts and security decisions are human driven, large language models are used for the grunt work. This is meant to get the project to an usuable status quickly and prove its viability. Before any productive use a thurrow review will be needed.

---

## The Sovereignty Promise

Most cloud platforms tie you to a single provider. Euroscale breaks that model:

- **Your infrastructure, your rules.** Run on Hetzner, AWS, GCP, Azure, on-prem — or all of them at once.
- **Your customers stay free.** Workloads move between providers without rewriting deployments. No provider-specific APIs, no proprietary formats, no exit fees.
- **Your data stays yours.** Secrets never touch third-party systems. OpenBao holds every credential from day one — no external secret manager, no vendor-managed KMS.
- **Your platform, your brand.** Every component is open-source and self-hosted. No proprietary control plane. No license fees per cluster.
- **Your project!** Missing a feature? Help implement it!

Euroscale makes **cloud agnosticism a technical reality, not a sales pitch**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Control Plane                           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  ArgoCD  │  │ Keycloak │  │  OpenBao  │  │ Backstage  │ │
│  │ (GitOps) │  │  (IdP)   │  │ (Secrets) │  │ (Portal)   │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘ │
│       │             │             │               │        │
│  ┌────▼─────────────▼─────────────▼───────────────▼──────┐ │
│  │              External Secrets Operator                 │ │
│  │     syncs OpenBao → Kubernetes Secrets                 │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Crossplane  │  KCP (Multi-Tenancy)  │  Istio       │  │
│  │  (IaC Compositions)                  │  (mTLS + In) │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              SPIRE (Workload Identity)                │  │
│  │     Every pod gets a SPIFFE identity — no SA tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │
         │  Provider-agnostic workload placement
         ▼
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  Hetzner │  │    AWS   │  │    GCP   │  │  On-Prem   │ │
│  │  (K8s)   │  │  (EKS)   │  │  (GKE)   │  │  (K8s)     │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

The control plane runs on **any Kubernetes cluster** — Kind for development, any production-grade distribution for real workloads. 

---

## Core Features

### 🔐 Secrets-Native by Design
No secrets in Git. No secrets in CI/CD. Every credential lives in OpenBao from the moment of creation and is synced into the cluster by External Secrets Operator. No plaintext passwords ever touch disk.

### 🚀 GitOps from Day One
ArgoCD drives everything. Cluster state is the Git state. Push a manifest, ArgoCD reconciles. No imperative commands, no SSH, no drift. The platform bootstraps itself from a single `make apply`.

### 🏢 Multi-Tenant by Default
KCP provides logical workspaces. Each tenant gets their own control plane slice — isolated RBAC, separate secrets paths, independent resource quotas. Built for cloud hosters from the ground up.

### 🔄 Provider-Agnostic Workload Placement
Workloads declare *what* they need, not *where* they run. The same `AgencyStack` definition works on any provider. Move between clouds without changing a single line of YAML.

### 🛡️ Workload Identity Without Secrets
SPIRE issues SPIFFE SVIDs to every pod. Workloads authenticate by identity, not by shared tokens. No more rotating ServiceAccount secrets, no more stolen token attacks.

### 🔌 Pluggable Infrastructure
Crossplane Compositions define what a "tenant" looks like — vCluster, KCP workspace, OpenBao path, network policies. Swap implementations without changing the API. Your infrastructure, your abstractions.

---

## Quick Start

**Prerequisites**: Docker, Kind, kubectl, OpenTofu, Node.js 22+, Go 1.22+

```bash
# Deploy the full control plane locally
make apply

# Check status
make status

# Open the UIs
make connect

# Get credentials
make credentials

# Tear it down
make destroy
```

For an existing cluster:
```bash
CLUSTER_TYPE=remote make apply
```

> 📖 Full walkthrough → [`control-plane/docs/GET_STARTED.md`](control-plane/docs/GET_STARTED.md)

---

## Platform Components

| Component | Role |
|-----------|------|
| [ArgoCD](https://argoproj.github.io/cd/) | GitOps reconciliation engine |
| [OpenBao](https://openbao.org/) | Secrets and encryption management |
| [Keycloak](https://www.keycloak.org/) | Identity provider and SSO |
| [Backstage](https://backstage.io/) | Developer portal and service catalog |
| [KCP](https://www.kcp.io/) | Multi-tenant Kubernetes control planes |
| [Crossplane](https://www.crossplane.io/) | Infrastructure as Code via Kubernetes CRDs |
| [Istio](https://istio.io/) | Service mesh with mTLS and ingress gateway |
| [SPIRE](https://spiffe.io/docs/latest/spire-about/) | SPIFFE workload identity |
| [CloudNative PG](https://cloudnative-pg.io/) | PostgreSQL operator for databases |
| [cert-manager](https://cert-manager.io/) | Automated TLS certificate management |
| [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) | Authentication proxy for ingress |

---

## Development Phases

### ✅ Phase 1: Control Plane (current)
The control plane is ready for development and improvements. Core services deploy and integrate on Kind.

### 🔄 Phase 2: Agency Layer (in progress)
Tenant provisioning via `AgencyStack` Crossplane Compositions. Each agency gets an isolated KCP workspace, dedicated OpenBao secret paths, and a self-service Backstage endpoint.

### 📋 Phase 3: Customer Layer (planned)
Per-customer virtual clusters (for development purposes) within agencies, with independent network policies, resource quotas, and provider placement. Customer workloads move between clouds without code changes.

### 🔭 Phase 4: Production Infrastructure (future)
[Gardener shoot clusters](gardener.cloud) (or any K8s distribution) instead of vCluster, OpenBao HA with auto-unseal, managed PostgreSQL, multi-region replication.

---

## Development Workflow

```bash
make prereqs          # Check prerequisites
make apply            # Full deployment
make status           # Health snapshot
make connect          # Port-forwards to all UIs
make credentials      # Print admin passwords and tokens
make destroy          # Full teardown
```

Build and iterate on Backstage:
```bash
make backstage-image  # Build custom Backstage Docker image
make deploy-backstage # Rollout restart after image update
```

Validate authorization:
```bash
make authz-test       # Run live RBAC checks across all components
```

---

## Project Structure

```
├── control-plane/          # The control plane — everything you need to run the platform
│   ├── docs/               # Architecture, setup, operations guides
│   ├── terraform/          # OpenTofu roots (bootstrap, argo-bootstrap, argo)
│   ├── gitops/             # ArgoCD application manifests
│   │   ├── argocd/         # ArgoCD configuration
│   │   │   ├── bootstrap/  # Foundation apps (operators, OpenBao, Keycloak, Istio)
│   │   │   └── main/       # Platform apps (Backstage, KCP, oauth2-proxy)
│   │   └── config/         # Shared config (service DNS, certs)
│   └── tools/backstage-app/# Backstage frontend and backend modules
├── common/
│   ├── tools/ansible/      # Deployment orchestrator (site.yml)
│   └── scripts/            # Shared tooling (authZ generator)
├── agencies/               # (in progress) Agency definitions and authZ model
└── customer/               # (planned) Customer stack and runtime configs
```

---

## License

MIT

---

**Euroscale** — sovereign cloud infrastructure, open to everyone.
