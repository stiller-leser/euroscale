#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🔍 Checking Docker-based local setup...${NC}"

OS_RAW="$(uname -s)"
case "${OS_RAW}" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *)
    echo -e "${RED}❌ Unsupported operating system: ${OS_RAW}${NC}"
    exit 1
    ;;
esac

ARCH_RAW="$(uname -m)"
case "${ARCH_RAW}" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo -e "${RED}❌ Unsupported architecture: ${ARCH_RAW}${NC}"
    exit 1
    ;;
esac

echo -e "${GREEN}✓ Detected platform: ${OS}/${ARCH}${NC}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_krew_path() {
  export PATH="${HOME}/.krew/bin:${PATH}"
  local line='export PATH="$HOME/.krew/bin:$PATH"'
  if [ -f "${HOME}/.bashrc" ] && grep -Fq "${line}" "${HOME}/.bashrc"; then
    return
  fi
  echo "${line}" >> "${HOME}/.bashrc"
}

install_docker_if_missing() {
  if require_cmd docker; then
    echo -e "${GREEN}✓ Docker found: $(docker --version)${NC}"
    return
  fi

  if [ "${OS}" != "linux" ]; then
    echo -e "${RED}❌ Automatic Docker install is only implemented for Linux in this script.${NC}"
    echo -e "${YELLOW}Install Docker manually, then re-run this script.${NC}"
    exit 1
  fi

  echo -e "${YELLOW}⚙️  Installing Docker (docker.io)...${NC}"
  sudo apt-get update
  sudo apt-get install -y docker.io
  echo -e "${GREEN}✓ Docker installed: $(docker --version)${NC}"
}

install_kind_if_missing() {
  if require_cmd kind; then
    echo -e "${GREEN}✓ Kind found: $(kind --version)${NC}"
    return
  fi

  echo -e "${YELLOW}⚙️  Installing Kind...${NC}"
  curl -fsSL -o /tmp/kind "https://kind.sigs.k8s.io/dl/v0.23.0/kind-${OS}-${ARCH}"
  chmod +x /tmp/kind
  sudo install -m 0755 /tmp/kind /usr/local/bin/kind
  rm -f /tmp/kind
  echo -e "${GREEN}✓ Kind found: $(kind --version)${NC}"
}

install_kubectl_if_missing() {
  if require_cmd kubectl; then
    echo -e "${GREEN}✓ kubectl found: $(kubectl version --client --output=yaml 2>/dev/null | head -n1 || kubectl version --client)${NC}"
    return
  fi

  echo -e "${YELLOW}⚙️  Installing kubectl...${NC}"
  KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
  curl -fsSL -o /tmp/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/${OS}/${ARCH}/kubectl"
  chmod +x /tmp/kubectl
  sudo install -m 0755 /tmp/kubectl /usr/local/bin/kubectl
  rm -f /tmp/kubectl
  echo -e "${GREEN}✓ kubectl found: $(kubectl version --client --output=yaml 2>/dev/null | head -n1 || kubectl version --client)${NC}"
}

install_tofu_if_missing() {
  if require_cmd tofu; then
    echo -e "${GREEN}✓ OpenTofu found: $(tofu version | head -n1)${NC}"
    return
  fi

  if [ "${OS}" != "linux" ]; then
    echo -e "${RED}❌ Automatic OpenTofu install in this script is only implemented for Linux.${NC}"
    echo -e "${YELLOW}Install OpenTofu manually, then re-run this script.${NC}"
    exit 1
  fi

  echo -e "${YELLOW}⚙️  Installing OpenTofu...${NC}"
  curl --proto '=https' --tlsv1.2 -fsSL https://get.opentofu.org/install-opentofu.sh -o /tmp/install-opentofu.sh
  chmod +x /tmp/install-opentofu.sh
  sudo /tmp/install-opentofu.sh --install-method deb
  rm -f /tmp/install-opentofu.sh
  echo -e "${GREEN}✓ OpenTofu found: $(tofu version | head -n1)${NC}"
}

install_opa_if_missing() {
  if require_cmd opa; then
    echo -e "${GREEN}✓ OPA found: $(opa version | head -n1)${NC}"
    return
  fi

  echo -e "${YELLOW}⚙️  Installing OPA...${NC}"
  local opa_url opa_tmp
  opa_tmp="/tmp/opa"

  if [ "${OS}" = "linux" ]; then
    # Prefer static Linux binary; fall back to non-static if needed.
    if ! curl -fsSL -o "${opa_tmp}" "https://openpolicyagent.org/downloads/latest/opa_${OS}_${ARCH}_static"; then
      curl -fsSL -o "${opa_tmp}" "https://openpolicyagent.org/downloads/latest/opa_${OS}_${ARCH}"
    fi
  else
    curl -fsSL -o "${opa_tmp}" "https://openpolicyagent.org/downloads/latest/opa_${OS}_${ARCH}"
  fi

  chmod +x "${opa_tmp}"
  sudo install -m 0755 "${opa_tmp}" /usr/local/bin/opa
  rm -f "${opa_tmp}"
  echo -e "${GREEN}✓ OPA found: $(opa version | head -n1)${NC}"
}

install_jq_if_missing() {
  if require_cmd jq; then
    return
  fi

  if [ "${OS}" != "linux" ]; then
    echo -e "${RED}❌ jq is required for kcp release resolution and is missing.${NC}"
    echo -e "${YELLOW}Install jq manually, then re-run this script.${NC}"
    exit 1
  fi

  echo -e "${YELLOW}⚙️  Installing jq...${NC}"
  sudo apt-get update
  sudo apt-get install -y jq
}

install_krew_if_missing() {
  ensure_krew_path
  if require_cmd kubectl-krew; then
    return
  fi

  echo -e "${YELLOW}⚙️  Installing kubectl krew...${NC}"
  local tmpdir krew_tar krew_bin
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN
  krew_tar="${tmpdir}/krew.tar.gz"
  krew_bin="krew-${OS}_${ARCH}"

  curl -fsSL -o "${krew_tar}" "https://github.com/kubernetes-sigs/krew/releases/latest/download/${krew_bin}.tar.gz"
  tar -xzf "${krew_tar}" -C "${tmpdir}"
  "${tmpdir}/${krew_bin}" install krew >/dev/null

  ensure_krew_path
  if ! require_cmd kubectl-krew; then
    echo -e "${RED}❌ kubectl-krew not found after install. Ensure ${HOME}/.krew/bin is in your PATH.${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ kubectl krew installed${NC}"
}

install_oidc_login_if_missing() {
  if kubectl oidc-login --help >/dev/null 2>&1 || require_cmd kubectl-oidc_login; then
    echo -e "${GREEN}✓ kubectl oidc-login plugin found${NC}"
    return
  fi

  echo -e "${YELLOW}⚙️  Installing kubectl oidc-login plugin...${NC}"
  install_krew_if_missing
  kubectl krew install oidc-login >/dev/null
  echo -e "${GREEN}✓ kubectl oidc-login plugin installed${NC}"
}

install_kcp_if_missing() {
  if require_cmd kcp && (require_cmd kubectl-kcp || require_cmd kubectl-kcp-plugin); then
    echo -e "${GREEN}✓ kcp found: $(kcp --version 2>/dev/null || echo installed)${NC}"
    echo -e "${GREEN}✓ kubectl kcp plugin found${NC}"
    return
  fi

  echo -e "${YELLOW}⚙️  Installing kcp and kubectl-kcp-plugin...${NC}"
  install_jq_if_missing
  local version
  version="$(curl -fsSL https://api.github.com/repos/kcp-dev/kcp/releases/latest | jq -r '.tag_name' 2>/dev/null || true)"
  if [ -z "${version}" ] || [ "${version}" = "null" ]; then
    version="v0.30.0"
    echo -e "${YELLOW}⚠️  Could not resolve latest kcp version, using fallback ${version}${NC}"
  fi

  local version_nov
  version_nov="${version#v}"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN

  local kcp_tar plugin_tar
  kcp_tar="${tmpdir}/kcp.tar.gz"
  plugin_tar="${tmpdir}/kubectl-kcp-plugin.tar.gz"

  curl -fsSL -o "${kcp_tar}" "https://github.com/kcp-dev/kcp/releases/download/${version}/kcp_${version_nov}_${OS}_${ARCH}.tar.gz"
  tar -xzf "${kcp_tar}" -C "${tmpdir}"

  local kcp_bin
  kcp_bin="$(find "${tmpdir}" -type f -name kcp | head -n1 || true)"
  if [ -n "${kcp_bin}" ]; then
    sudo install -m 0755 "${kcp_bin}" /usr/local/bin/kcp
  else
    echo -e "${RED}❌ kcp binary not found in kcp archive${NC}"
    exit 1
  fi

  if ! require_cmd kubectl-kcp; then
    install_krew_if_missing
    kubectl krew index add kcp-dev https://github.com/kcp-dev/krew-index.git >/dev/null 2>&1 || true
    kubectl krew install kcp-dev/kcp >/dev/null
    kubectl krew install kcp-dev/ws >/dev/null
    kubectl krew install kcp-dev/create-workspace >/dev/null
  fi

  echo -e "${GREEN}✓ kcp installed${NC}"
  echo -e "${GREEN}✓ kubectl kcp plugins installed${NC}"
}

install_docker_if_missing
install_kind_if_missing
install_kubectl_if_missing
install_tofu_if_missing
install_opa_if_missing
install_krew_if_missing
install_oidc_login_if_missing
install_kcp_if_missing

echo -e "${YELLOW}Testing Docker...${NC}"
if docker ps >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Docker is working correctly${NC}"
else
  echo -e "${RED}❌ Docker test failed. Ensure Docker daemon is running and your user can access it.${NC}"
  exit 1
fi

echo -e "${YELLOW}📊 System Resources:${NC}"
echo -e "  CPU Cores:  $(nproc)"
echo -e "  Memory:     $(free -h | awk '/^Mem:/ {print $2}')"
echo -e "  Disk:       $(df -h / | awk 'NR==2 {print $4}') available"

echo ""
echo -e "${GREEN}✅ Docker setup complete!${NC}"
echo -e "${YELLOW}Next: Run 'make apply' to deploy the stack${NC}"
