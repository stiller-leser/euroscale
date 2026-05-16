# Project Overview

## Purpose

`control-plane` deploys a local Euroscale platform (defaults to Kind, supports remote clusters via `CLUSTER_TYPE=remote`) using:

1. Ansible orchestration (`common/tools/ansible/site.yml`) via `make apply`.
2. OpenTofu for infra bootstrap roots.
3. ArgoCD App-of-Apps for GitOps resources.
4. OpenBao + External Secrets for secret delivery.
5. Keycloak for identity and OIDC.

## Execution Model

Primary entrypoint:

```bash
make apply
```

This runs:

```bash
cd common/tools/ansible && ansible-playbook site.yml
```

Ansible executes ordered roles (DNS sync, certs, registry, cluster creation, terraform phases, OpenBao workflows, token finalization, hardening, kubeconfig export). Cluster type (`kind` or `remote`) controls whether kind-specific steps run.

## Repository Layout

- `common/tools/ansible/`: authoritative deployment workflow (site.yml, roles, ops.yml). Creates Kind cluster via CLI (`cluster` role), manages registry, injects hostnames, then proceeds to OpenTofu phases.
- `common/scripts/`: shared scripts including `generate-authz-config.mjs` (centralized authZ generator).
- `control-plane/terraform/bootstrap`: Provider-agnostic OpenTofu root (ArgoCD installation, RBAC, OIDC bootstrap).
- `terraform/argo-bootstrap`: creates Argo app `bootstrap`.
- `terraform/argo`: creates Argo app `apps` (main stage).
- `gitops/argocd/bootstrap`: foundational apps (namespaces, crossplane, ESO, openbao, keycloak).
- `gitops/argocd/service-mesh`: Istio Application YAMLs (istio, istio-gateway, istio-mtls), applied directly by Ansible.
- `gitops/argocd/main`: platform apps (kcp, vcluster, oauth2-proxy, backstage, keycloak-routing).
- `tools/backstage-app`: Backstage source (frontend + backend modules).

## Core Services

- Kubernetes runtime: Kind cluster `euroscale`.
- GitOps control plane: ArgoCD.
- Secrets backend: OpenBao.
- Secret sync: External Secrets Operator.
- Identity provider: Keycloak realm `euroscale`.
- Platform control services: Crossplane, KCP, vCluster.
- Developer portal: Backstage.

## Most Used Targets

- `make apply`: full deployment via Ansible.
- `make status`: stack health snapshot.
- `make connect`: local port-forwards for ArgoCD/OpenBao/Keycloak/Backstage.
- `make credentials`: prints credential helpers and URLs.
- `make openbao-init`: manual OpenBao init/unseal recovery.
- `make backstage-image`: build/push Backstage custom image.
- `make deploy-backstage`: rollout restart Backstage.
- `make destroy`: teardown across Terraform roots.

## Current Access Endpoints

Ingress hosts:

- `https://argocd.internal.euroscale.local`
- `https://openbao.internal.euroscale.local`
- `https://backstage.internal.euroscale.local`
- `https://keycloak.internal.euroscale.local`

Local forwarding (`make connect`):

- ArgoCD: `http://localhost:30810`
- OpenBao: `http://localhost:8200`
- Keycloak Admin: `http://localhost:8400/admin`
- Keycloak OIDC: `https://localhost:30843`
- Backstage: `http://localhost:7007`

## Hardening Behavior

During `make apply`:

1. ArgoCD local admin login is temporarily enabled to bootstrap service token material.
2. Final phase re-applies bootstrap with `TF_VAR_argocd_local_admin_enabled=false`.
3. Keycloak admin `UPDATE_PASSWORD` required action is enforced.

## Secret Source of Truth

Runtime secrets are written/read in OpenBao mount `euroscale` (and `agencies` for tenancy paths), then synced into Kubernetes by External Secrets.

Examples:

- `euroscale/argocd/oidc-client`
- `euroscale/oauth2-proxy/openbao`
- `euroscale/oauth2-proxy/backstage`
- `euroscale/backstage` (contains `argocd_api_token`)
