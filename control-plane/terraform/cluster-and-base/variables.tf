variable "cluster_name" {
  description = "Name des Kind Clusters"
  type        = string
  default     = "euroscale"
}

variable "argocd_version" {
  description = "ArgoCD Helm Chart Version"
  type        = string
  default     = "5.51.6"  # Stabile Version, aktuell Jan 2025
}

variable "openbao_version" {
  description = "OpenBao Helm Chart Version"
  type        = string
  default     = "0.3.0"
}

variable "openbao_nodeport" {
  description = "NodePort for OpenBao UI"
  type        = number
  default     = 30201
}

variable "gitops_repo_path" {
  description = "Absoluter Pfad zum Argo apps directory (wird als file:// URL gemountet)"
  type        = string
  default     = ""  # Wird automatisch per abspath() gesetzt
}

variable "enable_openbao_auto_unseal" {
  description = "Aktiviert Auto-Unseal für OpenBao (Dev-Mode)"
  type        = bool
  default     = false
}

variable "enable_argocd_initial_admin_secret_lookup" {
  description = "Liest das argocd-initial-admin-secret fuer Outputs. Fuer destroy auf false setzen."
  type        = bool
  default     = true
}

variable "argocd_local_admin_enabled" {
  description = "Aktiviert den lokalen ArgoCD admin Login waehrend Bootstrap."
  type        = bool
  default     = true
}

variable "base_domain" {
  description = "Basisdomain fuer DNS Einträge (z.B. euroscale.local)"
  type        = string
  default     = "euroscale.local"
}
