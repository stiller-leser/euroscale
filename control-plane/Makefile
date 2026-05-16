.PHONY: help init plan apply destroy clean openbao-init keycloak-admin-reset prereqs status connect connection credentials keycloak-certs internal-gateway-certs service-dns-sync backstage-secrets backstage-image deploy-backstage istio-images kind-registry authz-generate authz-opa-check authz-test

.DEFAULT_GOAL := help

.PHONY: status

# Farben für Output
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
NC     := \\033[0m # No Color
KIND_ENV := DOCKER_HOST=unix:///var/run/docker.sock KIND_EXPERIMENTAL_PROVIDER=
TF_PLUGIN_CACHE_DIR := $(PWD)/.tofu/plugin-cache
TOFU_ENV := TF_PLUGIN_CACHE_DIR=$(TF_PLUGIN_CACHE_DIR) $(KIND_ENV)
TOFU_DESTROY_ENV := $(TOFU_ENV) TF_VAR_enable_argocd_initial_admin_secret_lookup=false
TF_ROOT_BOOTSTRAP := terraform/cluster-and-base
TF_ROOT_ARGO_BOOTSTRAP := terraform/argocd-bootstrap
TF_ROOT_ARGO := terraform/argocd-apps

DNS_CONFIG_FILE ?= gitops/config/service-dns.env
-include $(DNS_CONFIG_FILE)

ARGOCD_HOST ?= argocd.internal.$(BASE_DOMAIN)
OPENBAO_HOST ?= openbao.internal.$(BASE_DOMAIN)
BACKSTAGE_HOST ?= backstage.internal.$(BASE_DOMAIN)

CLUSTER_NAME := euroscale
CLUSTER_TYPE ?= kind
BASE_DOMAIN ?= euroscale.local
KUBECONFIG := $(HOME)/.kube/config
ISTIO_VERSION ?= 1.27.0
LOCAL_REGISTRY_NAME ?= kind-registry
LOCAL_REGISTRY_PORT ?= 5001
LOCAL_REGISTRY_ADDR ?= localhost:$(LOCAL_REGISTRY_PORT)
BACKSTAGE_IMAGE ?= $(LOCAL_REGISTRY_ADDR)/backstage-oidc:local
help: ## Zeigt diese Hilfe an
	@echo "$(GREEN)Sovereign Cloud Stack - Lokales Setup$(NC)"
	@echo ""
	@echo "$(YELLOW)Verfügbare Targets:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

prereqs: ## Prüft Docker für Kind
	@echo "$(GREEN)🔍 Checking prerequisites (Docker)...$(NC)"
	@command -v docker >/dev/null 2>&1 || (echo "$(RED)❌ docker not found$(NC)" && exit 1)
	@docker info >/dev/null 2>&1 || (echo "$(RED)❌ docker daemon not reachable$(NC)" && exit 1)
init: prereqs ## Initialisiert OpenTofu
	@echo "$(GREEN)🎯 Initializing OpenTofu...$(NC)"
	cd $(TF_ROOT_BOOTSTRAP) && $(TOFU_ENV) tofu init
	cd $(TF_ROOT_ARGO_BOOTSTRAP) && $(TOFU_ENV) tofu init
	cd $(TF_ROOT_ARGO) && $(TOFU_ENV) tofu init

plan: init ## Zeigt geplante Infrastruktur-Änderungen
	@echo "$(GREEN)📋 Planning infrastructure...$(NC)"
	cd $(TF_ROOT_BOOTSTRAP) && $(TOFU_ENV) tofu plan
	cd $(TF_ROOT_ARGO_BOOTSTRAP) && $(TOFU_ENV) tofu plan
	cd $(TF_ROOT_ARGO) && $(TOFU_ENV) tofu plan

# Support resuming from a specific step: make apply START_AT_STEP=9
# Step numbers match site.yml (1-23).
START_AT_STEP ?=

apply: prereqs ## Deployt die komplette Stack (Kind + ArgoCD + OpenBao) via Ansible. Use START_AT_STEP=<N> to resume.
	@echo "$(GREEN)🚀 Applying stack via Ansible playbook...$(NC)"
	@$(MAKE) authz-generate
	@PATH="$$(dirname $$(which node)):$$PATH" cd ../common/tools/ansible && \
	  if [ -n "$(START_AT_STEP)" ]; then \
	    STEP_NAME=$$(grep -E "\- name: Step $(START_AT_STEP)[^0-9]" site.yml | head -1 | sed 's/.*- name: //'); \
	    if [ -z "$$STEP_NAME" ]; then \
	      echo "$(RED)❌ Step '$(START_AT_STEP)' not found in site.yml.$(NC)" >&2; \
	      exit 1; \
	    fi; \
	    echo "$(YELLOW)▶️  Resuming from step $(START_AT_STEP): $$STEP_NAME$(NC)"; \
	    ansible-playbook site.yml --start-at-task "$$STEP_NAME" --extra-vars "control_plane_root=/home/kajmo/workspace/euroscale/control-plane ansible_python_interpreter=/home/kajmo/workspace/euroscale/.venv/bin/python cluster_type=$(CLUSTER_TYPE) base_domain=$(BASE_DOMAIN)"; \
	  else \
	    ansible-playbook site.yml --extra-vars "control_plane_root=/home/kajmo/workspace/euroscale/control-plane ansible_python_interpreter=/home/kajmo/workspace/euroscale/.venv/bin/python cluster_type=$(CLUSTER_TYPE) base_domain=$(BASE_DOMAIN)"; \
	  fi; \
	  rc=$$?; \
	  if [ $$rc -ne 0 ]; then \
	    echo "$(RED)❌ Playbook failed with exit code $$rc.$(NC)"; \
	    echo "$(YELLOW)To resume from a specific step, run:$(NC)"; \
	    echo "  make apply START_AT_STEP=<step-number>"; \
	    echo "$(YELLOW)Available: 1-31 (with a/b sub-steps like 12a). Steps listed in site.yml.$(NC)"; \
	    exit $$rc; \
	  fi

destroy: ## Zerstört die gesamte Infrastruktur
	@echo "$(RED)💣 Destroying infrastructure...$(NC)"
	@echo "$(YELLOW)Cleaning ArgoCD finalizers if present...$(NC)"
	@kubectl get applications -n argocd -o name --request-timeout=5s 2>/dev/null | \
		xargs -r -I{} kubectl patch {} -n argocd -p '{"metadata":{"finalizers":[]}}' --type=merge --request-timeout=5s 2>/dev/null || true
	@kubectl get namespace argocd --request-timeout=5s 2>/dev/null | grep -q argocd && \
		kubectl delete namespace argocd --wait=false --request-timeout=5s 2>/dev/null || true
	@echo "$(YELLOW)Destroying Argo app-of-apps Terraform root...$(NC)"
	@cd $(TF_ROOT_ARGO) && ARGO_STATE_LIST=$$(tofu state list 2>/dev/null || true) && \
	if [ -z "$$ARGO_STATE_LIST" ]; then \
		echo "$(YELLOW)No resources in $(TF_ROOT_ARGO); skipping tofu destroy$(NC)"; \
	else \
		$(TOFU_ENV) tofu destroy -auto-approve; \
	fi
	@echo "$(YELLOW)Destroying Argo bootstrap Terraform root...$(NC)"
	@cd $(TF_ROOT_ARGO_BOOTSTRAP) && ARGO_BOOTSTRAP_STATE_LIST=$$(tofu state list 2>/dev/null || true) && \
	if [ -z "$$ARGO_BOOTSTRAP_STATE_LIST" ]; then \
		echo "$(YELLOW)No resources in $(TF_ROOT_ARGO_BOOTSTRAP); skipping tofu destroy$(NC)"; \
	else \
		$(TOFU_ENV) tofu destroy -auto-approve; \
	fi
	@echo "$(YELLOW)Destroying bootstrap Terraform root...$(NC)"
	@cd $(TF_ROOT_BOOTSTRAP) && STATE_LIST=$$(tofu state list 2>/dev/null || true) && \
	if [ -z "$$STATE_LIST" ]; then \
		echo "$(YELLOW)No resources in $(TF_ROOT_BOOTSTRAP); skipping tofu destroy$(NC)"; \
	else \
		if ! $(TOFU_DESTROY_ENV) tofu destroy -auto-approve; then \
			echo "$(YELLOW)OpenTofu destroy failed. Checking Kubernetes API availability...$(NC)"; \
			if kubectl get namespace kube-system --request-timeout=5s >/dev/null 2>&1; then \
				echo "$(RED)Kubernetes API reachable; aborting fallback to avoid state drift.$(NC)"; \
				exit 1; \
			fi; \
			echo "$(YELLOW)Kubernetes API unreachable. Forcing state cleanup...$(NC)"; \
			tofu state list 2>/dev/null | xargs -r tofu state rm >/dev/null || true; \
		fi; \
	fi
	@if [ "$(CLUSTER_TYPE)" = "kind" ] && command -v kind >/dev/null 2>&1; then \
		echo "$(YELLOW)Deleting kind cluster $(CLUSTER_NAME)...$(NC)"; \
		kind delete cluster --name $(CLUSTER_NAME) 2>/dev/null || true; \
	fi
	@echo "$(YELLOW)Removing local Keycloak OIDC cert artifacts...$(NC)"
	@rm -f gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-ca.crt \
		gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-ca.key \
		gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-ca.srl \
		gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-tls.crt \
		gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-tls.csr \
		gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-tls.ext \
		gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-tls.key \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-ca.crt \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-ca.key \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-ca.srl \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-wildcard-tls.crt \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-wildcard-tls.csr \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-wildcard-tls.ext \
		gitops/argocd/bootstrap/apps/infrastructure/istio/certs/euroscale-local-wildcard-tls.key

authz-generate: ## Generiert zentrale AuthZ-Artefakte für Argo, Keycloak, Backstage und OpenBao
	@echo "$(GREEN)🧩 Generating centralized authz artifacts...$(NC)"
	@dir=$$(dirname $$(which node)) && PATH="$$dir:$$PATH" cd ../common/scripts && node ./generate-authz-config.mjs

authz-opa-check: ## Validiert agencies/authz/model.json gegen Rego-Regeln (benötigt opa im PATH)
	@echo "$(GREEN)🧪 Validating authz model via OPA/Rego...$(NC)"
	@dir=$$(dirname $$(which node)) && PATH="$$dir:$$PATH" cd ../common/scripts && node ./generate-authz-config.mjs --require-opa

smoke-test: ## Führt umfassende Cluster-Health-Checks nach dem Deployment aus
	@echo "$(GREEN)🔬 Running post-deployment smoke tests...$(NC)"
	@../common/scripts/smoke-test.sh

authz-test: prereqs authz-generate ## Führt nur die zentralen AuthZ/RBAC Live-Checks aus (ohne komplettes apply)
	@echo "$(GREEN)🧪 Running fast AuthZ/RBAC live checks...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook authz-tests.yml --extra-vars "ansible_python_interpreter=/home/kajmo/workspace/euroscale/.venv/bin/python"

openbao-init: ## Bootstrap OpenBao with initial secrets (requires cluster running)
	@echo "$(GREEN)🔐 Initializing OpenBao...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t openbao_bootstrap

keycloak-admin-reset: ## Enforce Keycloak admin first-login password reset
	@echo "$(GREEN)🔐 Enforcing Keycloak admin first-login password reset...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t password_reset

keycloak-certs: ## Generate and apply Keycloak OIDC certificates
	@echo "$(GREEN)🔐 Generating Keycloak OIDC certificates...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t keycloak_oidc

internal-gateway-certs: ## Generate and apply internal gateway wildcard certificates
	@echo "$(GREEN)🔐 Generating internal gateway certificates...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t internal_gateway

service-dns-sync: ## Synchronisiert zentrale DNS-Konfiguration in app-lokale Kustomize-Dateien
	@echo "$(GREEN)🔁 Syncing service DNS config into app-local kustomize files...$(NC)"
	@./scripts/sync-service-dns.sh

backstage-secrets: ## Configure Backstage ArgoCD Token via Ansible and store in OpenBao (euroscale/backstage)
	@echo "$(GREEN)🔐 Configuring Backstage ArgoCD token...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t argocd
	@kubectl -n argocd annotate application backstage argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true
	@echo "$(GREEN)✅ Stored Backstage ArgoCD token in OpenBao path euroscale/backstage$(NC)"

backstage-image: prereqs ## Baut OIDC-faehiges Backstage Image und pusht es in die lokale kind Registry
	@echo "$(GREEN)🧱 Building Backstage image with OIDC backend module: $(BACKSTAGE_IMAGE)$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t kind_registry
	@docker build -t "$(BACKSTAGE_IMAGE)" -f gitops/argocd/main/apps/infrastructure/backstage/Dockerfile.oidc .
	@echo "$(GREEN)📤 Pushing image to local registry: $(LOCAL_REGISTRY_ADDR)$(NC)"
	@docker push "$(BACKSTAGE_IMAGE)"
	@echo "$(GREEN)🔄 Triggering Backstage resync in ArgoCD$(NC)"
	@kubectl -n argocd annotate application backstage argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true
	@echo "$(GREEN)✅ Backstage custom image ready$(NC)"

deploy-backstage: ## Rollt Backstage Deployment neu aus und wartet auf Ready (ohne Image-Build)
	@echo "$(GREEN)🚀 Deploying Backstage rollout...$(NC)"
	@kubectl -n argocd annotate application backstage argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true
	@kubectl -n backstage rollout restart deployment/backstage
	@kubectl -n backstage rollout status deployment/backstage --timeout=300s
	@kubectl -n backstage get pods -l app.kubernetes.io/name=backstage -o wide
	@echo "$(GREEN)✅ Backstage deploy complete$(NC)"

istio-images: prereqs ## Spiegelt benoetigte Istio Images in die lokale kind Registry
	@echo "$(GREEN)🧱 Mirroring Istio images into local registry: $(LOCAL_REGISTRY_ADDR)$(NC)"
	@cd ../common/tools/ansible && ansible-playbook ops.yml -t kind_registry
	@LOCAL_REGISTRY_ADDR="$(LOCAL_REGISTRY_ADDR)" ISTIO_VERSION="$(ISTIO_VERSION)" ./scripts/mirror-istio-images.sh
	@echo "$(GREEN)✅ Istio images ready in local registry$(NC)"

connect: connection ## Alias: Port-forward all UIs

connection: ## Port-forward all UIs
	@echo "$(GREEN)🔌 Port-forwarding UIs (ArgoCD, OpenBao, Keycloak)...$(NC)"; \
	echo "$(GREEN)🌐 Port-forwards starting:$(NC)"; \
	echo "  ArgoCD:  http://localhost:30810"; \
	echo "  OpenBao: http://localhost:8200"; \
	echo "  Keycloak Admin: http://localhost:8400/admin"; \
	echo "  Keycloak OIDC:  https://localhost:30843"; \
	echo "  Backstage: http://localhost:7007"; \
	echo ""; \
	kubectl port-forward svc/argocd-server -n argocd 30810:443 >/dev/null 2>&1 & \
	PF_ARGO_PID=$$!; \
	PF_BAO_PID=""; \
	PF_KC_PID=""; \
	PF_KC_OIDC_PID=""; \
	PF_BACK_7007_PID=""; \
	trap 'echo ""; echo "$(YELLOW)Stopping port-forwards...$(NC)"; kill $$PF_ARGO_PID $$PF_BAO_PID $$PF_KC_PID $$PF_KC_OIDC_PID $$PF_BACK_7007_PID 2>/dev/null || true' INT TERM; \
	echo "$(YELLOW)Checking Keycloak readiness (non-blocking for ArgoCD/OpenBao)...$(NC)"; \
	if kubectl -n keycloak get job/euroscale-realm >/dev/null 2>&1; then \
		if ! kubectl -n keycloak wait --for=condition=complete job/euroscale-realm --timeout=60s >/dev/null 2>&1; then \
			echo "$(YELLOW)⚠️  Keycloak realm import still running; continuing without waiting.$(NC)"; \
		fi; \
	else \
		echo "$(YELLOW)⚠️  Keycloak realm job not found; skipping Keycloak wait. ArgoCD remains available.$(NC)"; \
	fi; \
	echo "$(YELLOW)Waiting for Keycloak pod readiness (keycloak-0, timeout 5m)...$(NC)"; \
	KC_READY=0; \
	if kubectl -n keycloak wait --for=condition=Ready pod/keycloak-0 --timeout=5m >/dev/null 2>&1 && \
		kubectl -n keycloak get svc/keycloak-service >/dev/null 2>&1 && \
		[ -n "$$(kubectl -n keycloak get endpoints keycloak-service -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null)" ]; then \
		KC_READY=1; \
	fi; \
	if [ "$$KC_READY" -ne 1 ]; then \
		echo "$(YELLOW)⚠️  Keycloak pod/service not ready; skipping Keycloak port-forward. ArgoCD remains available.$(NC)"; \
	fi; \
	kubectl port-forward svc/openbao-ui -n openbao 8200:8200 >/dev/null 2>&1 & \
	PF_BAO_PID=$$!; \
	kubectl port-forward svc/backstage -n backstage 7007:7007 >/dev/null 2>&1 & \
	PF_BACK_7007_PID=$$!; \
	if [ "$$KC_READY" -eq 1 ]; then \
		echo "$(GREEN)✅ Keycloak now available.$(NC)"; \
		kubectl port-forward svc/keycloak-service -n keycloak 8400:8080 >/dev/null 2>&1 & \
		PF_KC_PID=$$!; \
		kubectl port-forward svc/keycloak-nodeport -n keycloak 30843:443 >/dev/null 2>&1 & \
		PF_KC_OIDC_PID=$$!; \
	fi; \
	echo "$(GREEN)Port-forwards active. Press Ctrl-C to stop.$(NC)"; \
	wait

credentials: ## Prints admin credentials (ArgoCD, OpenBao, Keycloak)
	@echo "$(GREEN)🔐 Fetching credentials...$(NC)"
	@CONTROL_PLANE_ROOT="$(shell pwd)" cd ../common/tools/ansible && ansible-playbook ops.yml -t credentials -e credentials_verbose=true
	@echo ""
	@echo "$(YELLOW)OpenBao UI (protected by OAuth2 Proxy):$(NC)"
	@echo "  URL:  https://$(OPENBAO_HOST)"
	@echo "  Login user: openbao-admin / ChangeMe123! (temporary, password change required on first login)"
	@echo "  Required Keycloak realm role: openbao-admin"
	@echo ""
	@echo "$(YELLOW)Backstage UI (protected by OAuth2 Proxy):$(NC)"
	@echo "  URL:  https://$(BACKSTAGE_HOST)"
	@echo "  Dynamic agencies form: https://$(BACKSTAGE_HOST)/api/proxy/agencies-admin/"
	@echo "  Agencies Admin user: agencies-admin / ChangeMe123! (temporary, password change required on first login)"
	@echo ""
	@echo "$(YELLOW)Kubernetes OIDC test user (for kubeconfig/humans/keycloak.kubeconfig):$(NC)"
	@echo "  Username: kube-admin"
	@echo "  Password: ChangeMe123! (temporary, password change required on first login)"
	@echo "  Realm: euroscale"
	@echo "  Role: kube-admin"

logs-argocd: ## Zeigt ArgoCD Logs
	@kubectl logs -n argocd -l app.kubernetes.io/name=argocd-server --tail=100 -f

logs-openbao: ## Zeigt OpenBao Logs
	@kubectl logs -n openbao -l app.kubernetes.io/name=openbao --tail=100 -f

status: ## Zeigt Status aller Komponenten
	@echo "$(GREEN)📊 Component Status:$(NC)"
	@echo ""
	@echo "$(YELLOW)OpenTofu State (bootstrap):$(NC)"
	@cd $(TF_ROOT_BOOTSTRAP) && BOOTSTRAP_STATE_LIST=$$(tofu state list 2>/dev/null || true) && \
		if [ -z "$$BOOTSTRAP_STATE_LIST" ]; then \
			echo "  ⏳ No resources in state"; \
		else \
			echo "$$BOOTSTRAP_STATE_LIST" | sed 's/^/  - /'; \
		fi
	@echo ""
	@echo "$(YELLOW)OpenTofu State (argo):$(NC)"
	@cd $(TF_ROOT_ARGO) && ARGO_STATE_LIST=$$(tofu state list 2>/dev/null || true) && \
		if [ -z "$$ARGO_STATE_LIST" ]; then \
			echo "  ⏳ No resources in state"; \
		else \
			echo "$$ARGO_STATE_LIST" | sed 's/^/  - /'; \
		fi
	@echo ""
	@echo "$(YELLOW)OpenTofu State (argo-bootstrap):$(NC)"
	@cd $(TF_ROOT_ARGO_BOOTSTRAP) && ARGO_BOOTSTRAP_STATE_LIST=$$(tofu state list 2>/dev/null || true) && \
		if [ -z "$$ARGO_BOOTSTRAP_STATE_LIST" ]; then \
			echo "  ⏳ No resources in state"; \
		else \
			echo "$$ARGO_BOOTSTRAP_STATE_LIST" | sed 's/^/  - /'; \
		fi
	@echo ""
	@echo "$(YELLOW)GitOps Argo Roots:$(NC)"
	@echo "  bootstrap: gitops/argocd/bootstrap"
	@echo "  main:      gitops/argocd/main"
	@echo ""
	@echo "$(YELLOW)ArgoCD Applications:$(NC)"
	@kubectl get applications -n argocd -o wide 2>/dev/null || echo "  ❌ ArgoCD Applications not available"
	@echo ""
	@echo "$(YELLOW)Detailed GitOps App Status:$(NC)"
	@echo "  🔍 external-secrets:"
	@kubectl get application external-secrets -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n external-secrets --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 openbao:"
	@kubectl get application openbao -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  🔐 Seal state:"
	@OPENBAO_POD=$$(kubectl get pods -n openbao -l app.kubernetes.io/name=openbao -o jsonpath='{.items[0].metadata.name}' 2>/dev/null); \
		if [ -z "$$OPENBAO_POD" ]; then \
			echo "    ❌ OpenBao pod not found"; \
		else \
			STATUS_JSON=$$(kubectl exec -n openbao "$$OPENBAO_POD" -- bao status -format=json 2>/dev/null || true); \
			if [ -z "$$STATUS_JSON" ]; then \
				echo "    ⚠️  Unable to query seal status"; \
			elif echo "$$STATUS_JSON" | grep -Eq '"sealed"[[:space:]]*:[[:space:]]*true'; then \
				echo "    🔒 SEALED - run: make openbao-init"; \
				echo "    ⚠️  Back up: openbao-init.log (root_token + keys[0..4])"; \
			elif echo "$$STATUS_JSON" | grep -Eq '"sealed"[[:space:]]*:[[:space:]]*false'; then \
				echo "    🔓 Unsealed"; \
			else \
				echo "    ⚠️  Unknown seal state"; \
			fi; \
		fi
	@echo "  📦 Pods:"
	@kubectl get pods -n openbao --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 kcp:"
	@kubectl get application kcp -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n kcp --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 keycloak-operator:"
	@kubectl get application keycloak-operator -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n keycloak --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 vcluster-controller:"
	@kubectl get application vcluster-controller -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n vcluster-system --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 istio:"
	@kubectl get application istio -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n istio-system --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 oauth2-proxy:"
	@kubectl get application oauth2-proxy -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n oauth2-proxy --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo "  🔍 crossplane:"
	@kubectl get application crossplane -n argocd -o jsonpath='{"  Status: "}{.status.health.status}{"\n  Sync: "}{.status.sync.status}{"\n"}' 2>/dev/null || echo "    ❌ Not available"
	@echo "  📦 Pods:"
	@kubectl get pods -n crossplane-system --no-headers 2>/dev/null || echo "    ⏳ No pods found"
	@echo ""
	@echo "$(YELLOW)GitOps Status Summary:$(NC)"
	@echo "  🟢 Healthy Apps: "$$(kubectl get applications -n argocd -o jsonpath='{range .items[?(@.status.health.status=="Healthy")]}{.metadata.name}{" "}{end}' 2>/dev/null | wc -w)
	@echo "  🟡 Progressing Apps: "$$(kubectl get applications -n argocd -o jsonpath='{range .items[?(@.status.health.status=="Progressing")]}{.metadata.name}{" "}{end}' 2>/dev/null | wc -w)
	@echo "  🔴 Missing Apps: "$$(kubectl get applications -n argocd -o jsonpath='{range .items[?(@.status.health.status=="Missing")]}{.metadata.name}{" "}{end}' 2>/dev/null | wc -w)
	@echo "  🔄 Synced Apps: "$$(kubectl get applications -n argocd -o jsonpath='{range .items[?(@.status.sync.status=="Synced")]}{.metadata.name}{" "}{end}' 2>/dev/null | wc -w)
	@echo "  ⏳ OutOfSync Apps: "$$(kubectl get applications -n argocd -o jsonpath='{range .items[?(@.status.sync.status=="OutOfSync")]}{.metadata.name}{" "}{end}' 2>/dev/null | wc -w)
	@echo ""
	@echo "$(YELLOW)Kind Cluster:$(NC)"
	@kind get clusters 2>/dev/null || echo "  ❌ No cluster found"
	@echo ""
	@echo "$(YELLOW)ArgoCD:$(NC)"
	@kubectl get pods -n argocd 2>/dev/null || echo "  ❌ ArgoCD not deployed"
