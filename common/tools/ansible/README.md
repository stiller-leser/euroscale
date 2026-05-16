# Euroscale Ansible Playbook

This playbook orchestrates the full control-plane deployment:

- Cluster creation (Kind via CLI, or use existing remote cluster)
- OpenTofu bootstrap phases
- OpenBao initialization, auth configuration, and secret seeding
- ArgoCD token generation and Backstage integration
- Post-deploy hardening and kubeconfig export

## Run

```bash
cd tools/ansible
ansible-playbook site.yml
```

For a remote cluster (not Kind):

```bash
CLUSTER_TYPE=remote ansible-playbook site.yml -e cluster_type=remote
```

Or use the Makefile:

```bash
make apply                    # kind cluster (default)
CLUSTER_TYPE=remote make apply  # remote cluster
```

## Layout

- `site.yml`: Ordered orchestration matching the stack-apply flow (22 steps).
- `ops.yml`: Standalone operations (kind registry, credentials, OpenBao bootstrap, password reset, certs).
- `authz-tests.yml`: End-of-run live RBAC verification.
- `group_vars/all.yml`: Global defaults (secret paths, service URLs).
- `group_vars/authz.generated.yml`: Auto-generated authZ vars from `generate-authz-config.mjs`.

## Step Graph (site.yml)

| Step | Action | Description |
|------|--------|-------------|
| 1 | `preflight_dns` | Sync `service-dns.env` to all ArgoCD app directories |
| 2 | `certs` keycloak-oidc | Generate Keycloak OIDC root CA (key + self-signed cert) |
| 3 | `cluster` ensure_registry | Start local Docker registry (Kind only) |
| 4 | `terraform` init | Initialize all 3 OpenTofu roots |
| 5 | `cluster` create_kind | Create Kind cluster via CLI (Kind only; skip for remote) |
| 6 | `cluster` ensure_registry | Re-ensure registry wiring after cluster creation (Kind only) |
| 8 | `backstage` build_and_push | Build and push Backstage Docker image to local registry |
| 9 | `terraform` bootstrap | Apply bootstrap OpenTofu root (ArgoCD, cert-manager, SPIRE, Crossplane, ESO) |
| 10 | `terraform` argo_bootstrap | Apply argo-bootstrap OpenTofu root (bootstrap Argo Application) |
| 11 | `spire` | Verify SPIRE server health (namespace, StatefulSet, healthcheck) |
| 12 | `openbao` pre_argo | Init/unseal OpenBao, write initial secrets to KV (CNPG, Keycloak, KCP) |
| 12a | `openbao` wait_external_secrets_stores_exist | Wait for ClusterSecretStore CRDs and resources |
| 12b | *(inline)* | Wait for CNPG databases (keycloak-db, kcp-db) to be Ready |
| 13 | `openbao` post_argo | Configure Kubernetes auth, wait for Keycloak OIDC, configure OIDC roles |
| 14 | `openbao_spire` | Enable SPIRE auth method, write ACL policies, create backstage role |
| 15 | `terraform` argo | Apply main Argo OpenTofu root (main Argo Applications) |
| 16 | `openbao` wait_external_secrets_stores_ready | Wait for ClusterSecretStores to report Ready=True |
| 17 | `openbao` sync_kcp_kubeconfig | Wait for KCP, discover admin kubeconfig, write to OpenBao |
| 17b | `kubecfg` export_kcp_roles | Export KCP OIDC kubeconfigs per user |
| — | `argocd` set_backstage_token | Generate ArgoCD API token for Backstage, write to OpenBao, force ESO refresh |
| — | `backstage` refresh | Trigger ArgoCD hard refresh, rollout restart, wait for Backstage |
| — | `terraform` disable_argocd_admin | Re-apply bootstrap with ArgoCD local admin disabled |
| — | `keycloak` enforce_password_reset | Set UPDATE_PASSWORD required action on Keycloak admin |
| — | `kubecfg` export | Export Kind + OIDC kubeconfigs for human and technical users |
| — | `kcp` ensure_agencies_workspace | Ensure default `agencies` KCP workspace exists |
| — | `kcp` ensure_syncagent_bootstrap | Bootstrap KCP api-syncagent for agencies workspace |
| — | `authz_tests` | Validate authZ model with OPA, run live RBAC checks |

## Task File Index

### `roles/argocd/tasks/main.yml`
Generates an ArgoCD API token for the `backstage` account, writes it to OpenBao at `euroscale/backstage`, forces ExternalSecret refresh, waits for propagation, then restarts argocd-server.

### `roles/authz_tests/tasks/main.yml`
End-of-run validation: OPA model checks, ArgoCD RBAC ConfigMap verification, AppProject existence, oauth2-proxy role checks, Keycloak user/group/role audit via kcadm, OpenBao OIDC role binding verification, Backstage catalog metadata checks.

### `roles/backstage/tasks/main.yml`
Two modes: `build_and_push` (Docker build + push to local registry) and `refresh` (ArgoCD hard refresh, rollout restart, wait for ready).

### `roles/certs/tasks/main.yml`
Generates the Keycloak OIDC root CA (RSA 2048-bit private key, CSR, self-signed certificate with 3650d validity). Only supports `keycloak-oidc` target.

### `roles/cluster/tasks/main.yml`
Two modes: `ensure_registry` (manage local Docker registry, connect to kind network, configure containerd hosts.toml on nodes) and `create_kind` (render kind config template, run `kind create cluster`, export kubeconfig, inject Keycloak hostname into control-plane, restart kube-apiserver, verify cluster-info). All kind-specific steps are gated on `cluster_type == "kind"`.

### `roles/cluster/defaults/main.yml`
Default vars: `cluster_type: kind`, cluster/Docker/kind configuration parameters.

### `roles/cluster/templates/kind-cluster.yaml.j2`
Jinja2 template for `kind create cluster --config`. Defines 1 control-plane + 1 worker node with OIDC patches, extra mounts, port mappings, and pod/service CIDRs.

### `roles/credentials/tasks/main.yml`
Retrieves and displays admin credentials from Kubernetes secrets (ArgoCD admin password, Keycloak admin credentials, OpenBao root token).

### `roles/kcp/tasks/main.yml`
Two modes: `ensure_agencies_workspace` (wait for KCP, locate admin.kubeconfig, apply Workspace CR) and `ensure_syncagent_bootstrap` (create APIExport/APIBinding, persist syncagent kubeconfig to OpenBao, force ESO refresh, apply syncagent manifests, wait for CRDs, create PublishedResources).

### `roles/keycloak/tasks/main.yml`
Enforces Keycloak admin password reset via kcadm (sets `requiredActions=["UPDATE_PASSWORD"]`).

### `roles/keycloak_password_reset/tasks/main.yml`
Alternative password reset using `k8s_exec` module instead of shell (used by `ops.yml`).

### `roles/kubecfg/tasks/main.yml`
Two modes: `export` (export kind kubeconfig via CLI or copy existing for remote, extract server/CA, render OIDC kubeconfigs for human and technical users) and `export_kcp_roles` (extract KCP admin kubeconfig, resolve server URL with override chain, prefer cert-manager TLS secret CA, render per-user OIDC kubeconfigs).

### `roles/openbao/tasks/main.yml`
Action dispatcher for OpenBao workflows: `pre_argo`, `post_argo`, `wait_external_secrets_stores_exist`, `wait_external_secrets_stores_ready`, `sync_kcp_kubeconfig`. Delegates to per-action task files.

### `roles/openbao/tasks/_ensure_runtime.yml`
Shared helper: waits for OpenBao pod, ensures `bao status` returns initialized, runs `bao operator init` + `bao operator unseal` if needed, reads or writes root token.

### `roles/openbao/tasks/pre_argo.yml`
Mounts KV engines, seeds initial secrets (CNPG superuser, Keycloak postgres/admin, Backstage sync, ArgoCD admin, KCP postgres), writes ACL policies, creates test token for External Secrets.

### `roles/openbao/tasks/post_argo.yml`
Configures Kubernetes auth (`auth/kubernetes`), waits for Keycloak OIDC discovery (with realm import recreation on 404), configures OIDC auth roles for all services, writes role bindings.

### `roles/openbao/tasks/sync_kcp_kubeconfig.yml`
Waits for KCP deployment, discovers admin kubeconfig path, extracts it, and writes to OpenBao at `euroscale/kcp/admin-kubeconfig`.

### `roles/openbao/tasks/wait_external_secrets_stores_exist.yml`
Waits for ClusterSecretStore CRDs to be installed and the actual ClusterSecretStore resources to appear.

### `roles/openbao/tasks/wait_external_secrets_stores_ready.yml`
Waits for ClusterSecretStore conditions to report `Ready=True`.

### `roles/openbao_spire/tasks/main.yml`
Enables `spire` auth method in OpenBao, configures trust domain and server address, writes ACL policies (`spire-workload`, `spire-backstage`) from HCL files, creates auth role `backstage` with bound SPIFFE ID.

### `roles/spire/tasks/main.yml`
Waits for SPIRE namespace, StatefulSet with ready replicas, and successful `spire-server healthcheck`.

### `roles/terraform/tasks/main.yml`
Five phases: `init` (tofu init on all 3 roots), `bootstrap` (apply with ArgoCD admin enabled, retry on DNS errors, rescue re-export), `argo_bootstrap`, `argo`, `disable_argocd_admin` (re-apply with admin disabled).

### `roles/preflight_dns/tasks/main.yml`
Checks `service-dns.env` exists at config root, copies it to 8 ArgoCD app directories.

### `roles/kind_registry/tasks/main.yml`
Standalone registry management (used by `ops.yml`): starts registry Docker container, connects to kind network, configures containerd hosts.toml on nodes, creates `local-registry-hosting` ConfigMap.

### `roles/certs_keycloak_oidc/tasks/main.yml`
Full Keycloak OIDC certificate chain: CA CSR/self-signed, TLS key/CSR, TLS cert signed by CA with SANs, creates Kubernetes TLS secret.

### `roles/certs_internal_gateway/tasks/main.yml`
Internal gateway certificates: CA key/cert, wildcard TLS key/CSR, signed wildcard cert, creates CA Secret in istio namespace.

### `roles/openbao_bootstrap/tasks/main.yml`
Standalone OpenBao bootstrap (used by `ops.yml`): waits for pod readiness, ensures KV mounts, writes initial secrets via `community.hashi_vault` modules.

## Notes

- Secrets used by `make apply` are generated at runtime when not explicitly provided in `group_vars/all.yml`.
- Kubernetes object discovery/apply flows use `kubernetes.core.k8s` / `kubernetes.core.k8s_info` where applicable.
- Kind-specific steps are gated on `cluster_type` — set `CLUSTER_TYPE=remote` to deploy to an existing cluster.
