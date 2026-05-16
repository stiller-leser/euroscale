# SPIRE Setup (Workload Identity)

This document describes the SPIRE (SPIFFE Runtime Environment) integration for workload identity in Euroscale.

## Overview

SPIRE provides a foundation of cryptographic identity for every workload in the cluster. It:

- Issues SPIFFE Verifiable Identity Documents (SVIDs) to workloads based on their Kubernetes service account
- Integrates with Istio for workload-to-workload mTLS (replacing Citadel)
- Provides JWT SVIDs for workloads to authenticate to OpenBao
- Replaces Kubernetes Service Account token-based authentication for internal services

## Trust Domain

The SPIRE trust domain is `euroscale.svc.id`. All workloads receive SPIFFE IDs of the form `spiffe://euroscale.svc.id/ns/<namespace>/sa/<service-account>`.

## Components

### SPIRE Server

- Runs as a StatefulSet (1 replica) in `spire-system` namespace
- Issues SVIDs, maintains the certificate authority
- Uses SQLite for data storage (1Gi PVC)
- Node attestation via `k8s_psat` (Projected Service Account Token)
- Exposes gRPC endpoint on port 8081

### SPIRE Agent

- Runs as a DaemonSet on every node in `spire-system` namespace
- Attests workloads via the Kubernetes Workload Attestor
- Provides the Workload API via Unix socket at `/run/spire/sockets/spire-agent.sock`
- Workloads access the agent socket via the `spiffe-csi-driver` CSI driver

### SPIRE CSI Driver

- Runs as a separate DaemonSet (`spiffe-csi-driver`) in `spire-system` namespace
- Implements the `csi.spiffe.io` CSI driver
- Makes the SPIRE agent socket available to pods via ephemeral CSI inline volumes
- Workloads declare a CSI volume with `driver: csi.spiffe.io` to access the agent socket
- Deployed as a sidecar with `node-driver-registrar` for kubelet registration
- Image: `ghcr.io/spiffe/spiffe-csi-driver:0.2.11`

## GitOps Resources

Bootstrap app `spire.yaml` (sync-wave 2):

- `apps/infrastructure/spire/server-account.yaml` — ServiceAccount for SPIRE Server
- `apps/infrastructure/spire/server-cluster-role.yaml` — RBAC for pod listing + CSR management
- `apps/infrastructure/spire/server-configmap.yaml` — Server config with trust domain, `k8s_psat` attestor, SQLite datastore
- `apps/infrastructure/spire/server-statefulset.yaml` — StatefulSet with 1Gi PVC for data
- `apps/infrastructure/spire/server-service.yaml` — ClusterIP service on port 8081
- `apps/infrastructure/spire/agent-account.yaml` — ServiceAccount for SPIRE Agent
- `apps/infrastructure/spire/agent-cluster-role.yaml` — RBAC for pod listing
- `apps/infrastructure/spire/agent-configmap.yaml` — Agent config with `k8s` workload attestor
- `apps/infrastructure/spire/agent-daemonset.yaml` — DaemonSet with hostPID/hostNetwork
- `apps/infrastructure/spire/csi-driver.yaml` — CSIDriver registration + spiffe-csi-driver DaemonSet
- `apps/infrastructure/spire/kustomization.yaml` — Kustomize aggregator

## Ansible Integration

### Role: `roles/spire/`

- `tasks/main.yml` — Waits for SPIRE health: namespace, StatefulSet ready replicas, `spire-server healthcheck`

### Playbook Steps

- **Step 14** — Verify SPIRE health (before service-mesh and OpenBao post-argo)
- **Step 19** — Configure OpenBao SPIRE auth method (after OpenBao post-argo, see below)

## OpenBao SPIRE Auth Method

### Role: `roles/openbao_spire/`

Configured during Step 19, after OpenBao post-argo bootstrap (Step 18) and service-mesh deployment (Steps 15-17):

1. Enable `auth/spire` authentication method
2. Configure trust domain, server address, server port
3. Write ACL policies:
   - `spire-workload` — Basic read/list on `euroscale/metadata/*`
   - `spire-backstage` — Read/list on `euroscale/metadata/*` + `euroscale/data/*`
4. Create auth role `backstage` bound to `spiffe://euroscale.svc.id/backstage/backstage` with `spire-backstage` policy

### Backstage Integration

Backstage `openbaoProxy.ts` (`packages/backend/src/modules/openbaoProxy.ts`) uses a `CredentialProvider` abstraction with two modes:

| Mode | Mount Path | Token Source |
|------|-----------|------------|
| `spire` | `auth/spire/login` | JWT SVID file (`/var/run/secrets/spiffe/jwt-svid.token`) |
| `kubernetes` | `auth/kubernetes/login` | SA token file (`/var/run/secrets/kubernetes.io/serviceaccount/token`) |

The provider attempts `spire` first by checking if the JWT SVID file exists. If the JWT SVID file is unavailable, it falls back to calling `spire-agent api fetch jwt` via the SPIRE agent socket (available via CSI volume). If that also fails, it falls back to `kubernetes` using the pod's service account token.

The Backstage Docker image includes the `spire-agent` binary (`ghcr.io/spiffe/spire-agent:1.10.0` binary at `/opt/spire/bin/spire-agent`), enabling the `spireAgentCLI` fallback path.

Currently Backstage uses the **spire** auth path via the CSI-mounted agent socket and the `spire-agent` binary. The `kubernetes` fallback remains as a safety net.

### Workload CSI Volumes

The following workloads mount the SPIRE CSI volume for agent socket access:

| Workload | Location | Purpose |
|----------|----------|---------|
| Backstage | `apps/infrastructure/backstage/helm-release.yaml` | JWT SVID for OpenBao auth via SPIRE |
| OpenBao | `apps/secrets-management/openbao/helm-release.yaml` | Future SPIRE auth for operators |
| Keycloak | `apps/identity-management/keycloak/keycloak.yaml` | Future SPIRE auth for sync |
| oauth2-proxy | `apps/infrastructure/oauth2-proxy/helm-releases.yaml` | Future SPIRE auth |

## Istio Integration

Istio is deployed via its own `service-mesh` Argo umbrella app (`gitops/argocd/service-mesh/`) after SPIRE health verification (Step 14). This ensures Istio's `pilotCertProvider: spire` configuration works from first boot — no post-deployment restart is needed.

Key configuration in `bootstrap/apps/infrastructure/istio/helm-releases.yaml`:

```yaml
meshConfig:
  certificateAuthority:
    spire:
      address: spire-agent.spire-system.svc:8081
```

This makes Istio's control plane fetch workload certificates from SPIRE instead of using its internal Citadel, enabling consistent workload identity across the mesh.

A `PeerAuthentication` resource enforces `STRICT` mTLS mode in the `istio-system` namespace, ensuring all mesh traffic requires SVID-based mutual TLS.

## Verification

```bash
# SPIRE Server health
kubectl -n spire-system exec statefulset/spire-server -- /opt/spire/bin/spire-server healthcheck

# SPIRE Agent health
kubectl -n spire-system exec daemonset/spire-agent -- /opt/spire/bin/spire-agent healthcheck --shallow

# List registered workloads
kubectl -n spire-system exec statefulset/spire-server -- /opt/spire/bin/spire-server entry show

# Check CSI driver registration
kubectl get csidriver csi.spiffe.io

# Check CSI driver DaemonSet
kubectl -n spire-system get daemonset spiffe-csi-driver

# Verify OpenBao SPIRE auth
bao auth list | grep spire

# Verify Backstage can authenticate
kubectl -n backstage logs deploy/backstage -c backstage | grep "Refreshed OpenBao runtime token"
```

## Troubleshooting

- **SPIRE Server not starting** — Check PVC is available (`kubectl get pvc -n spire-system`), verify ConfigMap is correctly formatted
- **Agent not connecting to server** — Verify server DNS: `spire-server.spire-system.svc.cluster.local:8081`, check `k8s_psat` cluster name matches
- **CSI driver not working** — Check `spiffe-csi-driver` DaemonSet pod logs (`kubectl -n spire-system logs daemonset/spiffe-csi-driver`), verify kubelet plugin dir exists on nodes
- **Backstage auth failing** — Check Backstage openbaoProxy logs (`kubectl -n backstage logs deploy/backstage -c backstage`), verify `spire-agent` binary exists in container (`kubectl -n backstage exec deploy/backstage -c backstage -- which spire-agent`), verify CSI volume is mounted
- **Istio mTLS broken** — Temporarily set `PeerAuthentication` to `PERMISSIVE` for debugging, verify Istiod can reach SPIRE agent at `spire-agent.spire-system.svc:8081`

## Notes

1. SPIRE uses raw Kustomize manifests (not Helm) for fine-grained control over server, agent, and CSI driver configuration.
2. The trust domain `euroscale.svc.id` must match across SPIRE Server, Agent, and OpenBao SPIRE auth config.
3. cert-manager handles ingress/user-facing TLS; SPIRE handles internal workload identity and mTLS.
4. The `spire-agent` binary version should match the `spire-server` version (currently 1.10.0).
