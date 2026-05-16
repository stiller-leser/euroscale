# Backstage Integration

This document reflects the current Backstage deployment and role scoping.

## Deployment Source

Backstage is deployed as a Crossplane Helm `Release`:

- `gitops/argocd/main/apps/infrastructure/backstage/helm-release.yaml`

Custom image build path used by Ansible:

- Dockerfile: `gitops/argocd/main/apps/infrastructure/backstage/Dockerfile.oidc`
- Build/push role: `common/tools/ansible/roles/backstage/tasks/main.yml`

## Enabled Backend Modules

From `tools/backstage-app/packages/backend/src/index.ts`:

1. Core Backstage backends (app/proxy/auth/catalog/scaffolder/search/techdocs).
2. OpenBao runtime auth proxy module (`openbaoProxy`).
3. Custom permission policy module (`customPermissionPolicy`).
4. TeraSky kubernetes-ingestor backend plugin.
5. TeraSky crossplane-resources backend plugin.
6. Compatibility scaffolder actions for TeraSky templates:
- `terasky:claim-template`
- `terasky:crd-template`
7. Generic catalog template post-processor module (`templatePostProcessor`).

## Ingested Platform Data

`kubernetesIngestor` is enabled for:

1. Kubernetes components.
2. Crossplane XRD APIs and scaffolder templates.

Configured in:

- `gitops/argocd/main/apps/infrastructure/backstage/helm-release.yaml`

## Template Slimming (Generic)

The `templatePostProcessor` module rewrites generated templates by rule/profile.

Current default profile:

1. Remove group `Crossplane Settings`.
2. Remove group `Creation Settings`.
3. Remove `owner` from required fields.

Current default rule target:

- `kind: Template`
- `metadata.labels.source: crossplane`
- `spec.type` regex: `^[a-z0-9.-]+\.euro\.scale$`

So new XRDs matching that naming convention are automatically slimmed without custom per-XRD code.

## Plugin Access Model

Frontend role checks:

- Hook: `tools/backstage-app/packages/app/src/hooks/useRoleAccess.ts`
- Sidebar: `tools/backstage-app/packages/app/src/components/Root/Root.tsx`
- Entity pages: `tools/backstage-app/packages/app/src/components/catalog/EntityPage.tsx`

Behavior:

1. `argocd-admin`: sees ArgoCD plugin pages/cards.
2. `openbao-admin`: sees Vault/OpenBao plugin pages/cards.
3. `agencies-admin`: sees agency scaffolder and Crossplane pages.

Backend enforcement:

- `tools/backstage-app/packages/backend/src/modules/customPermissionPolicy.ts`

Default posture is deny unless explicitly allowed by role and permission prefix/scope.

## ArgoCD Plugin Data Path

```mermaid
flowchart LR
  A[Ansible argocd role] --> B[OpenBao euroscale/backstage argocd_api_token]
  B --> C[ExternalSecret backstage-secrets]
  C --> D[Backstage env ARGOCD_API_TOKEN]
  D --> E[/argocd/api proxy]
  E --> F[argocd-server API]
```

## OpenBao Plugin Data Path

```mermaid
flowchart LR
  CP[openbaoProxy.ts CredentialProvider] --> D{SPIRE JWT SVID file exists?}
  D -- Yes --> S[Read JWT SVID]
  D -- No --> K[Read SA token]
  S --> LS[OpenBao auth/spire/login role backstage]
  K --> LK[OpenBao auth/kubernetes/login role backstage]
  LS --> T[Short-lived OpenBao token]
  LK --> T
  T --> P[/api/proxy/openbao]
  P --> M[euroscale mount metadata/data]
```

## Operational Commands

Rebuild and deploy custom Backstage image:

```bash
make backstage-image
make deploy-backstage
```

Trigger only rollout:

```bash
make deploy-backstage
```

## Troubleshooting Quick Checks

Backstage pod status:

```bash
kubectl -n backstage get pods -l app.kubernetes.io/name=backstage
```

Backstage secret contains Argo token:

```bash
kubectl -n backstage get secret backstage-secrets -o jsonpath='{.data.ARGOCD_API_TOKEN}' | base64 -d
```

Backstage app refresh from Argo:

```bash
kubectl -n argocd annotate application backstage argocd.argoproj.io/refresh=hard --overwrite
```
