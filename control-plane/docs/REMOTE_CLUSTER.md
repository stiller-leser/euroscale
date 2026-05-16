# Using Euroscale with a Remote Cluster

This guide explains how to deploy the Euroscale control plane against an existing Kubernetes cluster (remote cluster) instead of the default Kind cluster.

## Prerequisites

Before you begin, ensure you have:

1. An existing Kubernetes cluster (version 1.24+ recommended) accessible via `kubectl`.
2. Your `kubectl` context is set to the target cluster:
   ```bash
   kubectl cluster-info
   ```
3. The cluster must have:
   - Sufficient resources (minimum 2 CPU, 4GB RAM for control plane components)
   - Ability to create namespaces, deployments, services, etc.
   - Support for LoadBalancer or NodePort services (for exposing UIs)
   - Internet access to pull container images (unless you mirror them)
4. The same prerequisites as for Kind installation (except Docker and Kind):
   - OpenTofu, kubectl, Go, Node.js, Yarn, Ansible
   - Optional: Docker is only needed if you plan to build the Backstage image locally

## Preparation

### 1. Verify Cluster Access

Ensure you can interact with your cluster:
```bash
kubectl get nodes
```

### 2. (Optional) Configure a Local Docker Registry

If your cluster cannot access external registries (e.g., Docker Hub), you may need to:
- Set up a local registry accessible to your cluster
- Configure your cluster nodes to use it as a mirror
- Or, pre-pull all required images and push them to your registry

The Euroscale control plane pulls images from:
- `ghcr.io/spiffe/spire-agent:1.10.0`
- `ghcr.io/spiffe/spire-server:1.10.0`
- `docker.io/bitnami/postgresql:14` (for CNPG, if not using the operator's images)
- Various Helm charts (ArgoCD, cert-manager, etc.)

### 3. DNS Configuration

The platform uses DNS hostnames under a configurable base domain (default: `euroscale.local`).

You have two options:

**Option A: Use /etc/hosts (simplest)**
Add entries for all service hostnames pointing to your cluster's ingress controller or load balancer IP:
```bash
# Replace <INGRESS_IP> with your cluster's ingress IP
echo "
<INGRESS_IP> argocd.internal.euroscale.local
<INGRESS_IP> openbao.internal.euroscale.local
<INGRESS_IP> keycloak.internal.euroscale.local
<INGRESS_IP> backstage.internal.euroscale.local
<INGRESS_IP> kcp.internal.euroscale.local
" | sudo tee -a /etc/hosts
```

**Option B: Use a Local DNS Resolver**
Configure `dnsmasq`, `systemd-resolved`, or similar to forward `*.euroscale.local` to your ingress IP.

### 4. Ingress Controller

Ensure your cluster has an ingress controller installed (e.g., NGINX, Traefik, Istio) that can:
- Accept traffic on ports 80 and 443 (or configure NodePort services)
- Route to the services deployed by Euroscale

Euroscale deploys:
- ArgoCD (via `argocd-server` service)
- OpenBao (via `openbao` service)
- Keycloak (via `keycloak` service)
- Backstage (via `backstage` service)
- KCP (via `kcp` service)

These are exposed as ClusterIP services. You will need an Ingress or LoadBalancer to make them accessible.

Alternatively, you can access services via port-forward or NodePort if you prefer not to set up ingress.

## Deployment

To deploy against your remote cluster:

```bash
CLUSTER_TYPE=remote make apply
```

This will skip:
- Kind cluster creation
- Local Docker registry setup
- Hostname injection into Kind nodes
- Kind-specific kubeconfig context settings

It will:
- Use your current `kubectl` context
- Deploy all components (ArgoCD, OpenBao, Keycloak, Backstage, etc.) to your cluster
- Rely on your cluster's infrastructure for networking and storage

## What to Expect

### Service Access

After deployment, you can access the services via:
- The hostnames configured in your DNS or `/etc/hosts`
- Through your ingress controller (if configured)
- Or via `kubectl port-forward` for temporary access

Example:
```bash
# Port-forward ArgoCD
kubectl -n argocd port-forward svc/argocd-server 8080:443
# Then visit https://localhost:8080
```

### Kubeconfigs

The `make kubecfg` command (or the final step of `make apply`) will export kubeconfigs to the `kubeconfig/` directory:
- `kubeconfig/<CLUSTER_NAME>.kubeconfig` - A copy of your current context
- `kubeconfig/humans/<USER>.kubeconfig` - For human users via Keycloak OIDC
- `kubeconfig/technical/<USER>.kubeconfig` - For technical automation via Keycloak

Note: These are based on your current cluster context.

## Differences from Kind Deployment

| Feature | Kind Cluster | Remote Cluster |
|---------|--------------|----------------|
| Cluster Creation | Automatic (Ansible) | Manual (user-provided) |
| Local Registry | Automatic (port 5001) | User must configure |
| Hostname Injection | Automatic (into Kind nodes) | Manual (via DNS or /etc/hosts) |
| kubeconfig Context | `kind-<cluster_name>` | Current context |
| Docker Required | Yes (for Kind and registry) | Only for Backstage build (optional) |
| Resource Isolation | Dedicated Kind nodes | Shared with other workloads |

## Troubleshooting

### Common Issues

1. **ImagePullBackOff**: 
   - Check if your cluster can pull the required images
   - Ensure your registry credentials are configured if using a private registry

2. **Services Not Accessible**:
   - Verify your ingress controller is correctly configured
   - Check that services are of type ClusterIP and have corresponding Ingress rules
   - Try port-forwarding to isolate ingress issues

3. **DNS Resolution Failures**:
   - Confirm your `/etc/hosts` entries or DNS resolver is working
   - Check that services are deployed and have ClusterIPs

4. **Permission Errors**:
   - Ensure your `kubectl` user has sufficient RBAC permissions to create namespaces, deployments, etc.

### Logs and Debugging

- Check ArgoCD application status: `argocd app get <app-name>`
- Inspect pod logs: `kubectl -n <namespace> logs <pod-name>`
- Review events: `kubectl -n <namespace> describe <resource>`

## Cleanup

To remove the platform from your remote cluster:
```bash
CLUSTER_TYPE=remote make destroy
```

This will:
- Delete all ArgoCD applications and their resources
- Remove namespaces created by Euroscale
- Leave your cluster otherwise intact

Note: It does not delete your cluster or affect other workloads.

---

## Example: Using EKS, GKE, or AKS

The process is the same for any Kubernetes cluster:

### EKS
```bash
aws eks update-kubeconfig --name my-cluster --region us-west-2
CLUSTER_TYPE=remote make apply
```

### GKE
```bash
gcloud container clusters get-credentials my-cluster --zone us-central1-a
CLUSTER_TYPE=remote make apply
```

### AKS
```bash
az aks get-credentials --resource-group my-rg --name my-cluster
CLUSTER_TYPE=remote make apply
```

## Feedback

If you encounter issues or have suggestions for improving remote cluster support, please open an issue or contribute to the documentation.
