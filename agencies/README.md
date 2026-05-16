# Agencies Layer

This folder contains the agencies-specific layer that runs on top of `control-plane`.

Current scope:

- ArgoCD AppProject for agencies
- Agency Crossplane XRD/Composition (KCP workspace + per-agency ArgoCD project)
- Agency Argo bootstrap Helm chart (vcluster provisioning flow for `local-vcluster`)
- Per-agency Backstage endpoint at `https://<agency>.agencies.euroscale.local`
- Per-agency Keycloak realm (`agency-<agency>`) with agency member users

Control-plane references this layer via Argo applications and composition source paths.
