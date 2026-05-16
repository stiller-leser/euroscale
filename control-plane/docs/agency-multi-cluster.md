# Agency Multi-Cluster Model

This repository now supports a provider-agnostic agency API on top of KCP.

## Core Idea

1. Agency intent is declared as `AgencyStackClaim` in KCP.
2. The claim always creates a KCP workspace for tenancy separation.
3. A dedicated ArgoCD `AppProject` is created per agency (`project = agencyName`).
4. A dedicated agency Keycloak realm is created (`agency-<agencyName>`).
5. A dedicated agency Backstage endpoint is exposed at `https://<agencyName>.agencies.euroscale.local`.
6. Workload placement is configured by `spec.cluster` and routed through ArgoCD destinations.

## API Fields

`AgencyStackClaim.spec` supports:

1. `agencyName`: tenant identifier.
2. `members`: member emails allowed on agency Backstage oauth2-proxy.
3. `kcpWorkspace.type`: KCP workspace type (`universal`, `home`, `organization`).
4. `cluster.class`: `local-vcluster`, `external`, `eks`, `gke`, `aks`, `gardener-shoot`.
5. `cluster.target.argocdClusterName`: Argo destination name (default `in-cluster`).
6. `cluster.target.namespace`: destination namespace for agency app (default `argocd`).
7. `cluster.target.server`: optional explicit destination server URL.
8. `cluster.bootstrap.path`: optional override for bootstrap chart path.
9. `cluster.bootstrap.values`: optional additional Helm values.
10. `cluster.provider`: free-form provider parameters for future controllers.

## What Gets Provisioned For `local-vcluster`

For `cluster.class: local-vcluster`, the agency bootstrap app creates:

1. A vCluster namespace and Crossplane Helm `Release` (`agency-<agency>-vcluster`).
2. A tenant Backstage Helm `Release` (`backstage-<agency>`).
3. A tenant oauth2-proxy Helm `Release` (`backstage-<agency>-oauth2-proxy`).
4. An agency Keycloak realm import (`agency-<agency>`), including listed member users.
5. An Istio `VirtualService` for `https://<agency>.agencies.euroscale.local`.
6. A tenant Backstage catalog entry that points ArgoCD plugin to the agency project.

## Example

```yaml
apiVersion: euro.scale/v1alpha1
kind: AgencyStackClaim
metadata:
  name: acme
spec:
  agencyName: acme
  members:
    - donald@duck.com
    - daisy@duck.com
  cluster:
    class: gardener-shoot
    target:
      argocdClusterName: gardener-acme
      namespace: argocd
    provider:
      project: acme-project
      region: eu10
  kcpWorkspace:
    type: universal
```

## Managed Kubernetes Constraints

For managed control planes (EKS/GKE/AKS/Gardener) where API server flags are constrained:

1. Keep KCP as the central control API.
2. Use ArgoCD cluster destinations to target workload clusters.
3. Use provider-native workload identity for machine access.
4. Use Pinniped for portable human auth flows where direct API-server OIDC flag control is not available.
