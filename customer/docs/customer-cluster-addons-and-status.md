# Customer Cluster Addons and Status Visibility

This document explains how customer clusters get platform addons and how customers can track provisioning progress.

## Goal

When a new `CustomerStackClaim` is created:

1. Bootstrap the customer runtime.
2. Install required cluster addons (KubeVirt and Kube-OVN).
3. Prepare interconnect path so new clusters can join existing clusters.
4. Expose deployment status through ArgoCD and customer Backstage.

## Addons Installed Automatically

Current customer bootstrap installs the following into each customer cluster (`clusterClass=local-vcluster`):

1. `crossplane` (tenant runtime)
2. `kubevirt`
3. `kube-ovn`
4. `submariner-operator` (when `spec.network.interconnect.enabled=true`)

Templates:

1. `customer/gitops/argocd/main/apps/customers/customer-bootstrap/templates/customer-crossplane-release.yaml`
2. `customer/gitops/argocd/main/apps/customers/customer-bootstrap/templates/customer-kubevirt-release.yaml`
3. `customer/gitops/argocd/main/apps/customers/customer-bootstrap/templates/customer-kubeovn-release.yaml`
4. `customer/gitops/argocd/main/apps/customers/customer-bootstrap/templates/customer-submariner-operator-release.yaml`

## Interconnect Model for New and Existing Clusters

Baseline behavior:

1. `spec.network.interconnect.enabled` defaults to `true`.
2. `submariner-global` ConfigMap is applied with `use-nftables=false` for Kube-OVN compatibility.
3. Optional `subctl join` job can auto-join the customer cluster to an existing Submariner broker mesh.

Resources:

1. `customer-submariner-global-configmap.yaml`
2. `customer-submariner-autojoin-job.yaml`

To enable auto-join in a claim:

1. `spec.network.interconnect.autoJoin.enabled=true`
2. Provide broker info secret in customer vCluster namespace:
   - secret name: `submariner-broker-info` (default)
   - key: `broker-info.subm` (default)
3. Optionally set:
   - `spec.network.interconnect.autoJoin.clusterCIDR`
   - `spec.network.interconnect.autoJoin.serviceCIDR`

## How Customers See Provisioning Status

Each customer gets:

1. A dedicated ArgoCD application (`customer-<agency>-<customer>`).
2. Backstage catalog entities annotated with `argocd/app-name` for that app.
3. A status ConfigMap with addon/interconnect fields.

Key status entity wiring:

1. Catalog config: `customer-backstage-catalog-configmap.yaml`
2. Status ConfigMap: `customer-status-configmap.yaml`

Useful status keys in ConfigMap:

1. `kubevirtEnabled`, `kubevirtRelease`
2. `kubeovnEnabled`, `kubeovnRelease`
3. `interconnectEnabled`, `interconnectMode`, `cableDriver`
4. `interconnectAutoJoinEnabled`, `interconnectBrokerSecret`
5. `interconnectJoinHint`

## Verification Commands

```bash
kubectl -n argocd get app | grep customer-
kubectl -n argocd get release.helm.crossplane.io | grep -E 'kubevirt|kubeovn|submariner'
kubectl -n argocd get configmap | grep customer-.*-status
kubectl get jobs -A | grep subctl-join
```

## Notes

1. Auto-join is optional by design; keep it `false` if broker-secret distribution is not automated yet.
2. The customer Backstage view is intentionally scoped to the customer’s Argo app via catalog annotations.
3. For non-`local-vcluster` classes (EKS/GKE/AKS/Gardener), reuse the same interconnect and status model while switching cluster provisioning composition/class.
