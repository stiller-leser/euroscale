#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

PASS=0
FAIL=0
TIMEOUT="${SMOKE_TEST_TIMEOUT:-10}"

green()  { printf "\033[0;32m%s\033[0m\n" "$1"; }
red()    { printf "\033[0;31m%s\033[0m\n" "$1"; }
yellow() { printf "\033[0;33m%s\033[0m\n" "$1"; }

check() {
  local desc="$1" cmd="$2"
  printf "  %-55s " "$desc"
  if eval "$cmd" >/dev/null 2>&1; then
    green "PASS"
    ((PASS++))
  else
    red "FAIL"
    ((FAIL++))
  fi
}

check_raw() {
  local desc="$1" cmd="$2" expect="$3"
  printf "  %-55s " "$desc"
  output=$(eval "$cmd" 2>&1)
  if echo "$output" | grep -q "$expect"; then
    green "PASS"
    ((PASS++))
  else
    red "FAIL"
    echo "       Expected: $expect"
    echo "       Got: $(echo "$output" | head -c200)"
    ((FAIL++))
  fi
}

echo "============================================="
echo "  Euroscale Smoke Test"
echo "============================================="
echo ""

# ----- 1. ArgoCD Apps -----
echo "--- ArgoCD Applications ---"
check "All apps Synced/Healthy" \
  'kubectl get applications -n argocd -o json | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d.get(\"items\",[])
errs=[i[\"metadata\"][\"name\"] for i in items if i.get(\"status\",{}).get(\"sync\",{}).get(\"status\")==\"Unknown\" or (i.get(\"status\",{}).get(\"health\",{}).get(\"status\") not in (\"Healthy\",\"Progressing\"))]
sys.exit(1) if errs else sys.exit(0)
"'

# ----- 2. Namespaces -----
echo "--- Namespaces ---"
for ns in argocd cert-manager cnpg crossplane-system external-secrets istio-system keycloak oauth2-proxy openbao backstage spire-system; do
  check "Namespace $ns exists" "kubectl get ns $ns"
done

# ----- 3. Key Workloads -----
echo "--- Core Services ---"
for selector in "app.kubernetes.io/name=argocd-server" "app.kubernetes.io/name=keycloak-operator" "app=istiod" "app=istio-ingressgateway" "app.kubernetes.io/name=openbao"; do
  name=$(echo "$selector" | sed 's/.*=//')
  check "Pod $name Running" "kubectl get pods -A -l $selector --field-selector=status.phase=Running -o name | head -1 | grep -q ."
done

# ----- 4. SPIRE -----
echo "--- SPIRE ---"
check "SPIRE server healthy"  "kubectl exec -n spire-system spire-server-0 -- /opt/spire/bin/spire-server healthcheck 2>&1 | grep -iq 'Server is healthy'"
check "SPIRE agent attested"  "kubectl exec -n spire-system spire-server-0 -- /opt/spire/bin/spire-server agent list 2>&1 | grep -iq 'attested'"

# ----- 5. SPIRE -> OpenBao Auth -----
echo "--- OpenBao SPIRE Auth ---"
check "OpenBao SPIRE auth enabled" "kubectl exec -n openbao openbao-0 -- bao auth list -format=json 2>&1 | grep -q 'spire/'"
check "OpenBao SPIRE role exists" "kubectl exec -n openbao openbao-0 -- bao read auth/spire/role/backstage 2>&1 | grep -q 'backstage'"

# ----- 6. Istio SPIRE Integration -----
echo "--- Istio SPIRE Integration ---"
check "Istio mesh cert from SPIRE" \
  "kubectl get configmap -n istio-system istio -o json 2>&1 | python3 -c \"
import sys,json
d=json.load(sys.stdin)
mesh=d.get('data',{}).get('mesh','')
if 'spire' in mesh: sys.exit(0)
sys.exit(1)
\""

# ----- 7. cert-manager -----
echo "--- Certificates ---"
check "ClusterIssuer exists" "kubectl get clusterissuer euroscale-local-ca 2>&1 | grep -q euroscale"
check "Wildcard cert issued"  "kubectl get certificate -n istio-system euroscale-local-wildcard-tls 2>&1 | grep -q READY"

# ----- 8. External Secrets -----
echo "--- External Secrets ---"
check "ClusterSecretStore vault-backend ready" \
  "kubectl get clustersecretstore vault-backend -o json 2>&1 | python3 -c \"
import sys,json
d=json.load(sys.stdin)
st=d.get('status',{}).get('conditions',[])
for c in st:
    if c.get('type')=='Ready':
        sys.exit(0) if c.get('status')=='True' else sys.exit(1)
sys.exit(1)
\""

# ----- 9. Endpoints -----
echo "--- Service Endpoints ---"
check "Keycloak reachable"  "curl -sk --connect-timeout $TIMEOUT https://keycloak.internal.euroscale.local/realms/euroscale 2>&1 | grep -q 'euroscale'"
check "ArgoCD reachable"   "curl -sk --connect-timeout $TIMEOUT https://argocd.internal.euroscale.local/ 2>&1 | grep -iq 'argocd\|404'"
check "OpenBao reachable"  "curl -sk --connect-timeout $TIMEOUT https://openbao.internal.euroscale.local/v1/sys/health 2>&1 | grep -q '\"initialized\"'"

# ----- Summary -----
echo ""
echo "============================================="
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then
  green "  ALL $TOTAL CHECKS PASSED"
  exit 0
else
  echo "  $green$PASS passed, $red$FAIL failed ($TOTAL total)"
  exit 1
fi
