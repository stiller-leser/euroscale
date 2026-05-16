# Get Started with the Euroscale Control Plane

This guide walks through the entire control plane from zero to running. No prior knowledge of the project is assumed — each concept is explained when it first appears.

---

## What is this?

The Euroscale control plane is a **local development environment** for a sovereign cloud platform. It bundles everything you need to experiment with a real-world GitOps platform:

- **ArgoCD** manages what runs in the cluster
- **OpenBao** handles secrets (no plaintext passwords in Git)
- **Keycloak** provides single sign-on (one login for all UIs)
- **Backstage** is the developer portal where you can see everything
- **KCP** provides multi-tenant workspaces
- **Crossplane** lets you define infrastructure as Kubernetes resources
- **Istio** handles traffic routing and mTLS between services

Everything runs inside a **Kind cluster** (Kubernetes in Docker). You can also point it at an existing cluster with `CLUSTER_TYPE=remote`.

---

## What will I get?

After deployment you will have a Kubernetes cluster running these services:

| Service | What it does | Access |
|---------|-------------|--------|
| ArgoCD | GitOps — syncs Kubernetes manifests from Git | `https://argocd.internal.euroscale.local` |
| OpenBao | Secrets management (like HashiCorp Vault) | `https://openbao.internal.euroscale.local` |
| Keycloak | Single sign-on and identity provider | `https://keycloak.internal.euroscale.local` |
| Backstage | Developer portal and service catalog | `https://backstage.internal.euroscale.local` |
| KCP | Kubernetes control plane for multi-tenancy | Internal API |
| Crossplane | Infrastructure as Code via Kubernetes CRDs | Internal |
| Istio | Service mesh with mTLS and ingress gateway | Internal |
| SPIRE | Workload identity (SPIFFE SVIDs) | Internal |

---

## Before you begin

You need these tools installed:

- **Docker** — the kind cluster runs in containers
- **Kind** (`kind`) — Kubernetes in Docker
- **kubectl** — Kubernetes CLI
- **OpenTofu** (`tofu`) — like Terraform, used for bootstrap infrastructure
- **Go** (1.22+) — needed for some built components
- **Node.js** (22 or 24) — for authZ config generation
- **Yarn 4** — for Backstage development (enable with `corepack enable`)
- **Ansible** — the deployment orchestrator (usually via pip)

Quick prerequisites check:

```bash
make prereqs
```

Optional: run the helper installer to set up missing tools:

```bash
./scripts/setup.sh
```

### Local DNS configuration

The platform uses DNS hostnames under a configurable base domain (default: `euroscale.local`) for all services:

| Service | Hostname |
|---------|----------|
| ArgoCD  | `argocd.internal.euroscale.local` |
| OpenBao | `openbao.internal.euroscale.local` |
| Keycloak| `keycloak.internal.euroscale.local` |
| Backstage| `backstage.internal.euroscale.local` |
| KCP     | `kcp.internal.euroscale.local` |

You need to configure your local DNS resolution to point these hostnames to `127.0.0.1`. The easiest way is to add entries to `/etc/hosts`:

```bash
echo "
127.0.0.1 argocd.internal.euroscale.local
127.0.0.1 openbao.internal.euroscale.local
127.0.0.1 keycloak.internal.euroscale.local
127.0.0.1 backstage.internal.euroscale.local
127.0.0.1 kcp.internal.euroscale.local
127.0.0.1 *.localhost
" | sudo tee -a /etc/hosts
```

Or use a local DNS resolver like `dnsmasq` or `systemd-resolved` to forward `*.euroscale.local` to `127.0.0.1`.

**To change the base domain**, set the `BASE_DOMAIN` environment variable:

```bash
BASE_DOMAIN=my-dev.local make apply
```

This generates all service hostnames from the base domain automatically.

---

## Deploy the control plane

One command deploys everything:

```bash
make apply
```

This runs for 15–30 minutes on first deploy (most time is waiting for Helm charts to download and pods to start). Subsequent runs are faster.

To deploy against an existing cluster instead of creating a Kind one:

```bash
CLUSTER_TYPE=remote make apply
```

See [REMOTE_CLUSTER.md](./REMOTE_CLUSTER.md) for detailed requirements and instructions.

---

## What just happened? (walkthrough)

Here is what `make apply` does, step by step:

### 1. AuthZ config generation
A Node.js script reads the centralized authorization model (`agencies/authz/model.json`) and generates configuration files for ArgoCD, Keycloak, Backstage, and OpenBao. This ensures roles, policies, and permissions stay in sync.

### 2. DNS sync
The playbook copies a shared `service-dns.env` file into every ArgoCD application directory that needs it. This is how all services know each other's hostnames.

### 3. TLS certificates
The playbook generates a self-signed root CA for Keycloak OIDC. This CA is used by kube-apiserver to trust Keycloak-issued identities.

### 4. Kind cluster creation (kind only)
If `CLUSTER_TYPE=kind` (default), the playbook creates a Kind cluster with:
- One control-plane node + one worker node
- kube-apiserver configured with OIDC flags pointing to Keycloak
- Port mappings: 30080 (HTTP), 30880 (HTTPS), 30843 (Keycloak OIDC direct)
- Pods get IPs from `10.0.0.0/15`, services from `10.2.0.0/16`

The control-plane node's `/etc/hosts` is patched so `keycloak.internal.euroscale.local` resolves via the Docker gateway — this lets kube-apiserver reach Keycloak.

### 5. Local Docker registry (kind only)
A local Docker registry starts on port 5001. Backstage's custom image is pushed here. Kind nodes are configured to pull from this registry.

### 6. Backstage image build
A Docker image is built from `Dockerfile.oidc` and pushed to the local registry. This image includes OIDC authentication middleware and custom Backstage plugins.

### 7. OpenTofu bootstrap phases
The playbook runs three OpenTofu phases:

| Phase | What it creates |
|-------|----------------|
| **bootstrap** | ArgoCD, cert-manager, SPIRE, Crossplane, External Secrets Operator, the Kind cluster used to live in this phase but is now managed by Ansible instead. |
| **argo-bootstrap** | An ArgoCD Application called `bootstrap` that manages foundational services. |
| **argo** | An ArgoCD Application called `apps` that manages platform services (KCP, Backstage, oauth2-proxy). |

### 8. ArgoCD sync waves
Once the bootstrap ArgoCD Application is created, ArgoCD takes over and deploys services in ordered waves:

- **Wave 0**: Namespaces, operators (CNPG, External Secrets, Keycloak Operator)
- **Wave 1**: cert-manager and Crossplane
- **Wave 2**: SPIRE and Crossplane providers
- **Wave 3**: OpenBao, CNPG databases, External Secrets resources
- **Wave 4**: Certificate resources (TLS certs via cert-manager)
- **Wave 5**: Keycloak resources (realm, clients, users)

### 9. Service mesh deployment
Once SPIRE is healthy (verified in Ansible Step 14), Istio Applications are deployed directly from the `gitops/argocd/service-mesh/` directory:

- **Istio base + istiod** (sync-wave 0) — configured with `pilotCertProvider: spire` from the start
- **Istio gateway** (sync-wave 1) — ingress gateway
- **mTLS policy** (sync-wave 1) — PeerAuthentication STRICT

Because SPIRE is already healthy when Istio first deploys, istiod picks up SPIRE certificates on first boot — no post-deployment restart needed.

### 10. OpenBao initialization
OpenBao is initialized with a root token and unsealed. Then the playbook:

- Mounts KV engines (`secret/` and `agencies/`)
- Writes initial secrets: CNPG database passwords, Keycloak admin credentials, Backstage sync token, KCP database credentials
- Writes ACL policies for External Secrets, SPIRE workloads, and Backstage
- Configures Kubernetes auth so External Secrets can authenticate via SA tokens
- Waits for Keycloak OIDC discovery URL to be reachable (this can take a while)
- Configures OIDC auth roles so users can log in to OpenBao with their Keycloak credentials

### 11. SPIRE auth
OpenBao's `auth/spire` method is enabled and configured. SPIRE-issued workload identities (SPIFFE SVIDs) can authenticate to OpenBao without ever needing a Kubernetes ServiceAccount token. Backstage uses this path.

### 12. Finalization
- An ArgoCD API token is generated for Backstage and written to OpenBao
- Backstage is hard-refreshed and its deployment is rolled out
- ArgoCD local admin login is disabled (security hardening)
- Keycloak admin password reset is enforced
- Kubeconfigs are exported to `kubeconfig/` for different user types
- KCP's `agencies` workspace is created

### 13. AuthZ validation
The playbook runs a comprehensive set of checks:
- OPA evaluates the authZ model against Rego rules
- ArgoCD RBAC ConfigMap is verified against expected policies
- Keycloak users, groups, and roles are checked
- OpenBao OIDC role bindings are validated
- Backstage catalog metadata is audited

---

## Explore your platform

### Check deployment status

```bash
make status
```

Shows pods across all namespaces, ArgoCD sync status, and health endpoints.

### Open the UIs

```bash
make connect
```

This starts port-forwards so you can access the services locally:

| Service | URL | Notes |
|---------|-----|-------|
| ArgoCD | `http://localhost:30810` | GitOps dashboard |
| OpenBao | `http://localhost:8200` | Secrets management |
| Keycloak admin | `http://localhost:8400/admin` | Identity management (master realm) |
| Backstage | `http://localhost:7007` | Developer portal |

The ingress gateway also serves the services at their internal hostnames if you add them to `/etc/hosts`:

```
# All services resolve to the Kind cluster ingress (127.0.0.1 with port-forwards, or the Kind node IP without):
127.0.0.1  argocd.internal.euroscale.local  openbao.internal.euroscale.local  keycloak.internal.euroscale.local  backstage.internal.euroscale.local
```

### Get credentials

```bash
make credentials
```

Prints:

- **ArgoCD admin** password (from `argocd-initial-admin-secret`)
- **Keycloak admin** username and password
- **OpenBao root token**

### Generated kubeconfigs

The final step exports kubeconfigs to `kubeconfig/`:

| File | Purpose |
|------|---------|
| `kubeconfig/kind.kubeconfig` | Direct cluster admin access |
| `kubeconfig/humans/keycloak.kubeconfig` | Human users authenticate via Keycloak OIDC |
| `kubeconfig/technical/keycloak.kubeconfig` | Technical users (automation) authenticate via Keycloak |

Try it:

```bash
kubectl --kubeconfig kubeconfig/humans/keycloak.kubeconfig get ns
```

This opens a browser window where you log in with your Keycloak credentials.

---

## Common tasks

### Rebuild and redeploy Backstage

```bash
make backstage-image
make deploy-backstage
```

### Reset Keycloak admin password

```bash
make keycloak-admin-reset
```

### Re-initialize OpenBao

If the OpenBao root token is lost or the cluster was recreated:

```bash
make openbao-init
```

### Check authorization model

```bash
make authz-test
```

Validates the live cluster against the centralized authZ model.

---

## Understanding the architecture

The deployment follows a **layered approach**:

```
make apply
  └─ Ansible (common/tools/ansible/site.yml)
       ├─ Creates Kind cluster (or uses existing)
       ├─ Runs OpenTofu to bootstrap ArgoCD
       ├─ OpenTofu creates ArgoCD Applications
       ├─ ArgoCD syncs Kubernetes manifests from git
       └─ Ansible finalizes secrets, tokens, exports
```

**Key principle**: OpenTofu handles the bootstrap infrastructure (ArgoCD, its service accounts, the initial applications). ArgoCD handles everything else — it watches the `gitops/` directory and reconciles the cluster state.

For the full architecture breakdown, see [architecture.md](architecture.md).

---

## Troubleshooting

### Deployment fails on Helm chart download

This is usually a DNS issue. The playbook retries automatically. If it persists:

```bash
make apply START_AT_STEP=9
```

This resumes from the OpenTofu bootstrap phase.

### Keycloak stays in Init:0/1

Keycloak waits for its PostgreSQL database. Check:

```bash
kubectl -n cnpg get cluster
```

Both `keycloak-db` and `kcp-db` should be `Ready`. The playbook waits for them (step 12b).

### Backstage shows errors in UI

Check the Backstage pod logs:

```bash
kubectl -n backstage logs deployment/backstage
```

Common issues: missing secrets (check ExternalSecrets in `backstage` namespace), or OpenBao connectivity.

### OpenBao API not ready

The playbook waits up to 20 minutes for OpenBao. If it times out:

```bash
kubectl -n openbao logs openbao-0
```

---

## Cleaning up

```bash
make destroy
```

This:
1. Removes ArgoCD finalizers and namespace
2. Destroys all 3 OpenTofu roots in reverse order
3. Deletes the Kind cluster (if `CLUSTER_TYPE=kind`)
4. Removes locally generated certificate artifacts

---

## What's next

Once the control plane is running, explore:

- **Add a user**: See [addUsers.md](addUsers.md)
- **Define permissions**: See [add-user-scoped-permissions.md](add-user-scoped-permissions.md)
- **Create an agency**: See [agency-multi-cluster.md](../agencies/docs/agency-multi-cluster.md)
- **Understand authorization**: See [authz-centralized-opa-rego.md](authz-centralized-opa-rego.md)
- **Deploy to a real cluster**: Set `CLUSTER_TYPE=remote` and configure kubeconfig before `make apply`
