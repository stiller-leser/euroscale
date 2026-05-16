# Euroscale Cloud Stack - Main Configuration
# Deployt einen lokalen Kind-Cluster mit ArgoCD und OpenBao

# Locals für wiederverwendbare Werte
locals {
  vcluster_root_path  = abspath("${path.module}/../../..")
  vcluster_mount_path = "/workspace/euroscale/control-plane"
  gitops_repo_path    = abspath("${path.module}/../../apps")
  # Mount repo root for Argo local repo mode with control-plane paths.
  euroscale_root_path = abspath("${path.module}/../../..")
  euroscale_mount_path = "/workspace/euroscale"
  cluster_name     = var.cluster_name
  
  common_labels = {
    "managed-by"   = "opentofu"
    "environment"  = "local"
    "project"      = "euroscale"
  }
}

# Ausgaben werden von outputs.tf verwaltet
