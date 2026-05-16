# ArgoCD Outputs
output "argocd_info" {
  description = "ArgoCD Zugriffsinformationen"
  value = {
    url      = "http://localhost:30810"
    username = "admin"
  }
}

output "argocd_password" {
  description = "ArgoCD Admin Passwort"
  value       = try(nonsensitive(data.kubernetes_secret.argocd_initial_admin[0].data["password"]), null)
  sensitive   = true
}

# OpenBao Outputs
output "openbao_info" {
  description = "OpenBao Zugriffsinformationen"
  value = {
    url        = "kubectl port-forward -n openbao svc/openbao 8200:8200"
    root_token = var.enable_openbao_auto_unseal ? "root" : "Siehe Logs des openbao-init Jobs"
    dev_mode   = var.enable_openbao_auto_unseal
  }
}

output "openbao_url" {
  description = "OpenBao UI URL (via port-forward)"
  value       = "kubectl port-forward -n openbao svc/openbao 8200:8200"
}

output "openbao_root_token" {
  description = "OpenBao Root Token (Dev-Mode only!)"
  value       = var.enable_openbao_auto_unseal ? "root" : "siehe openbao-init.log"
  sensitive   = true
}

# Zusammenfassung
output "deployment_summary" {
  description = "Zusammenfassung des Deployments"
  value = <<-EOT
    ✅ Stack deployed successfully!

    Next steps:
      1. make openbao-init     # Initialize and unseal OpenBao
      2. make status           # Check all components
      3. make argocd-ui        # Access ArgoCD (localhost:8080)
      4. make openbao-ui       # Access OpenBao (localhost:8200)
  EOT
}
