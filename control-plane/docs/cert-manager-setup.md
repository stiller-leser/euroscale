# Certificate Setup (cert-manager + OpenBao)

This document describes the current TLS setup for Keycloak, Istio ingress, and OAuth2-proxy.

## Goal

Use cert-manager for certificate issuance so local uses a self-managed CA now, and production can switch issuers later with minimal manifest changes.

## Current Model

1. A stable local root CA for Keycloak OIDC is still bootstrapped by Ansible.
2. Ansible writes that CA cert/key into OpenBao path `euroscale/keycloak/oidc-ca`.
3. External Secrets syncs the CA into `cert-manager/euroscale-local-root-ca`.
4. cert-manager `ClusterIssuer` `euroscale-local-ca` signs all leaf certificates.
5. Services consume cert-manager-managed Secrets directly.

## GitOps Resources

Bootstrap apps:

- `gitops/argocd/bootstrap/cert-manager.yaml`
- `gitops/argocd/bootstrap/cert-manager-resources.yaml`

cert-manager resources:

- `gitops/argocd/bootstrap/apps/infrastructure/cert-manager-resources/root-ca-external-secret.yaml`
- `gitops/argocd/bootstrap/apps/infrastructure/cert-manager-resources/cluster-issuer.yaml`
- `gitops/argocd/bootstrap/apps/infrastructure/cert-manager-resources/certificates.yaml`

## Issued Certificates

1. `Certificate` `euroscale-local-wildcard-tls` in namespace `istio-system`
- Secret name: `euroscale-local-wildcard-tls`
- Used by Istio gateway wildcard HTTPS listener.

2. `Certificate` `keycloak-oidc-tls` in namespace `keycloak`
- Secret name: `keycloak-oidc-tls`
- Used by `keycloak-https-proxy` deployment.

3. `Certificate` `keycloak-oidc-tls-gateway` in namespace `istio-system`
- Secret name: `keycloak-oidc-tls`
- Used by Istio gateway Keycloak SNI server.

4. `Certificate` `keycloak-oidc-ca` in namespace `oauth2-proxy`
- Secret name: `keycloak-oidc-ca`
- Mounted by oauth2-proxy as provider CA file.

## Ansible Integration

1. `common/tools/ansible/roles/certs/tasks/main.yml`
- Now ensures only the stable Keycloak OIDC root CA material.
- Leaf cert generation was removed from this role.

2. `common/tools/ansible/roles/openbao/tasks/pre_argo.yml`
- Writes `euroscale/keycloak/oidc-ca` to OpenBao.

3. `common/tools/ansible/site.yml`
- Removed legacy internal gateway cert generation step.

## Rotation

1. Local CA rotation
- Regenerate root CA via Ansible cert role.
- Re-run `make apply`.
- cert-manager reissues leaf certificates from the updated CA.

2. Production issuer switch
- Add production `Issuer`/`ClusterIssuer` (for example Vault/ACME/internal PKI).
- Change `issuerRef` in the `Certificate` resources.
- Keep existing Secret names unchanged to avoid consumer changes.

## Verification

```bash
kubectl -n cert-manager get externalsecret,secret
kubectl get clusterissuer euroscale-local-ca
kubectl -n istio-system get certificate,secret euroscale-local-wildcard-tls keycloak-oidc-tls
kubectl -n keycloak get certificate,secret keycloak-oidc-tls
kubectl -n oauth2-proxy get certificate,secret keycloak-oidc-ca
```

## Notes

1. The Kubernetes API server OIDC trust still depends on a bootstrap CA file mounted into kind nodes.
2. cert-manager does not replace this bootstrap requirement for kube-apiserver startup.
3. Ingress TLS and user-facing certificates are fully cert-manager-managed.
4. Workload identity and pod-to-pod mTLS are handled by SPIRE (workload identity federation) integrated with Istio.
5. cert-manager and SPIRE coexist: cert-manager handles external-facing TLS, SPIRE handles internal service identity.
