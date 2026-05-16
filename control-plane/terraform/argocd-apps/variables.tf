variable "cluster_name" {
  description = "Name of the Kind cluster"
  type        = string
  default     = "euroscale"
}

variable "argocd_namespace" {
  description = "Namespace where ArgoCD is installed"
  type        = string
  default     = "argocd"
}
