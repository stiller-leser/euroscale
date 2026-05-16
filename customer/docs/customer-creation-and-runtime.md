# Customer Creation and Runtime Flow

This runbook describes how customer environments are created and managed.

## Scope

1. Customer API: `CustomerStackClaim` (`euro.scale/v1alpha1`).
2. Entry point: agency Backstage (auto-discovered Crossplane claim template).
3. Reconcile path: KCP workspace -> syncagent -> control-plane Crossplane composition.
4. Runtime target (current baseline): per-customer vCluster + per-customer Backstage.

## Create a Customer (Agency Admin)

1. Log in to agency Backstage: `https://<agency>.agencies.euroscale.local`.
2. Go to `Create` and select the auto-discovered `CustomerStackClaim` template.
3. Fill customer fields (at minimum `customerName`; `agencyName` is enforced/scoped by runtime).
4. Submit.

Notes:

1. Agency scoping is enforced by backend action (`BACKSTAGE_AGENCY_NAME`).
2. `CustomerStackClaim` is applied against KCP workspace `root:agencies:<agency>`.

## What Gets Provisioned

For each customer claim, the composition creates an ArgoCD Application in the agency project and bootstraps:

1. A dedicated customer vCluster (`local-vcluster` baseline).
2. A tenant Crossplane runtime inside that vCluster.
3. KubeVirt in the customer cluster.
4. Kube-OVN in the customer cluster.
5. Submariner operator + baseline Kube-OVN/Submariner prep for interconnect.
6. A dedicated customer Backstage deployment.
7. A dedicated oauth2-proxy for that customer Backstage.
8. Customer TLS + Istio gateway + virtual service.
9. Customer status ConfigMap with runtime metadata.

## Customer Backstage URL

Each customer gets:

1. `https://<customer>.<agency>.euroscale.local`

Examples:

1. `https://acme.contoso.euroscale.local`
2. `https://northwind.commonpeople.euroscale.local`

## Interconnect Intent (Kube-OVN/Submariner)

`CustomerStackClaim.spec.network.interconnect` can carry network intent:

1. `enabled`
2. `mode` (submariner)
3. `cableDriver` (wireguard/libreswan/vxlan)
4. `globalnet`

Current baseline stores and propagates this intent into customer bootstrap values and status metadata, deploys Submariner operator, and supports optional `subctl join` automation for broker-based mesh join.

To have new clusters automatically connect to existing clusters, provide a broker info secret in the customer vCluster namespace (default secret name `submariner-broker-info`, key `broker-info.subm`) and keep:

1. `spec.network.interconnect.enabled=true`
2. `spec.network.interconnect.mode=submariner`
3. `spec.network.interconnect.cableDriver=wireguard`
4. `spec.network.interconnect.autoJoin.enabled=true`
5. Optionally set `spec.network.interconnect.autoJoin.brokerInfoSecretName` / `brokerInfoSecretKey` if you use non-default secret naming.

## Verify Provisioning

### ArgoCD objects

```bash
kubectl -n argocd get app | grep customer-
kubectl -n argocd get appproject
kubectl get jobs -A | grep subctl-join
```

### Customer bootstrap resources

```bash
kubectl -n argocd get configmap | grep customer-.*-status
kubectl -n istio-system get gateway | grep customer-
kubectl -n istio-system get certificate | grep customer-
kubectl -n oauth2-proxy get virtualservice | grep customer-
kubectl -n argocd get release.helm.crossplane.io | grep -E 'kubevirt|kubeovn|submariner'
```

### Customer runtime

```bash
kubectl get ns | grep vcluster-
kubectl -n argocd get release.helm.crossplane.io | grep cust-
```

## Troubleshooting

1. Customer template not visible in agency Backstage:
   - Check `kubernetesIngestor.crossplane.xrds.ingestAllXRDs: true` in agency Backstage appConfig.
   - Confirm XRD exists: `kubectl get xrd customerstacks.euro.scale`.
2. Claim submit succeeds but no resources appear:
   - Check backend logs for scaffolder action errors.
   - Verify `kcp-root-kubeconfig` exists in `crossplane-system`.
3. Customer URL fails:
   - Verify cert, gateway, virtualservice for that customer host.
   - Ensure DNS for `*.euroscale.local` resolves to ingress gateway endpoint.
4. OIDC callback fails:
   - Confirm agency realm client includes wildcard customer callback/origin for `*.{agency}.euroscale.local`.
