#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_FILE="${SOURCE_FILE:-${ROOT_DIR}/gitops/config/service-dns.env}"

TARGET_FILES=(
  "${ROOT_DIR}/gitops/argocd/bootstrap/apps/infrastructure/istio/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/bootstrap/apps/infrastructure/istio-gateway/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/bootstrap/apps/infrastructure/cert-manager-resources/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/main/apps/infrastructure/oauth2-proxy/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/main/apps/infrastructure/oauth2-proxy-routing/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/main/apps/infrastructure/kcp-routing/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/bootstrap/apps/infrastructure/keycloak-routing/service-dns.env"
  "${ROOT_DIR}/gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/service-dns.env"
)

if [[ ! -f "${SOURCE_FILE}" ]]; then
  echo "Missing source DNS config: ${SOURCE_FILE}" >&2
  exit 1
fi

for target in "${TARGET_FILES[@]}"; do
  mkdir -p "$(dirname "${target}")"
  cp "${SOURCE_FILE}" "${target}"
done

echo "Synchronized service DNS config to app-local kustomize files."
