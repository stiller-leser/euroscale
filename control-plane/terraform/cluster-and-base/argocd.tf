# ArgoCD Namespace
resource "kubernetes_namespace" "argocd" {
  metadata {
    name = "argocd"

    labels = {
      "app.kubernetes.io/name"      = "argocd"
      "app.kubernetes.io/component" = "gitops"
    }
  }
}

locals {
  # OIDC-only setup: local admin login bleibt nur waehrend Bootstrap aktiv
  # und wird am Ende von `stack apply` deaktiviert.
  # ArgoCD authentifiziert direkt gegen Keycloak - KEIN OAuth2 Proxy für Auth.
  # Der OAuth2 Proxy vor ArgoCD schützt nur den Ingress-Zugang (erste Verteidigungslinie),
  # aber ArgoCD's RBAC läuft vollständig über das direkte OIDC.
  argocd_local_admin_enabled     = var.argocd_local_admin_enabled
  keycloak_oidc_ca_cert_path     = "${path.module}/../../gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/certs/keycloak-oidc-ca.crt"
  keycloak_oidc_ca_pem           = try(trimspace(file(local.keycloak_oidc_ca_cert_path)), "")
  argocd_policy_csv_path         = "${path.module}/generated/argocd-policy.csv"
}

# Local GitOps repo registration for ArgoCD
resource "kubernetes_secret" "argocd_repo_local" {
  depends_on = [kubernetes_namespace.argocd]

  metadata {
    name      = "repo-local-gitops"
    namespace = kubernetes_namespace.argocd.metadata[0].name
    labels = {
      "argocd.argoproj.io/secret-type" = "repository"
    }
    annotations = {
      "managed-by" = "argocd.argoproj.io"
    }
  }

  type = "Opaque"

  data = {
    name = "local-gitops"
    url  = "file:///repo"
    type = "git"
  }
}

# ArgoCD Helm Release
resource "helm_release" "argocd" {
  depends_on = [
    kubernetes_namespace.argocd,
    kubernetes_secret.argocd_repo_local,
  ]

  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = var.argocd_version
  namespace  = kubernetes_namespace.argocd.metadata[0].name

  wait          = true
  wait_for_jobs = true
  timeout       = 600
  skip_crds     = false

  values = [
    yamlencode({
      crds = {
        install = true
        keep    = true
      }

      global = {
        domain = "argocd.internal.${var.base_domain}"
      }

      configs = {
        params = {
          "server.insecure"              = true
          "reposerver.enable.local.repo" = true
        }

        cm = merge(
          {
            url = "https://argocd.internal.${var.base_domain}"

            "admin.enabled" = local.argocd_local_admin_enabled ? "true" : "false"

            # Dedicated account for Backstage API access.
            "accounts.backstage" = "apiKey"

            # ArgoCD macht direktes OIDC zu Keycloak.
            # Rollen/Gruppen werden aus Claims gelesen, nicht als OIDC Scopes angefordert.
            # Der argocd Keycloak-Client ist confidential - clientSecret ist erforderlich.
            "oidc.config" = yamlencode({
              name            = "Keycloak"
              issuer          = "https://keycloak.internal.${var.base_domain}/realms/euroscale"
              clientID        = "argocd"
              # $oidcKeycloakClientSecret wird aus dem argocd-secret gelesen
              # (Key: oidcKeycloakClientSecret), das durch External Secrets
              # aus OpenBao gemerged wird.
              clientSecret    = "$oidcKeycloakClientSecret"
              # Nur Standard-Scopes anfordern; custom claims (roles/groups) kommen via mapper.
              requestedScopes = ["openid", "profile", "email"]
              rootCA          = local.keycloak_oidc_ca_pem
            })

            repositories = <<-EOT
              - url: file:///repo
                type: git
                name: local-gitops
            EOT
          },
          local.argocd_local_admin_enabled ? { "accounts.admin" = "apiKey,login" } : {}
        )

        rbac = {
          "policy.default" = "role:none"
          # Gruppen-/Rollen-Claims aus Keycloak erlauben (groups bevorzugt).
          "scopes" = "[groups, roles]"
          "policy.csv" = trimspace(file(local.argocd_policy_csv_path))
        }

      }
      server = {
        service = {
          type         = "NodePort"
          nodePortHttp = 30810
        }

        # Loopback-Proxy für Keycloak DNS-Problem (127.0.0.1 im Cluster)
        extraContainers = [
          {
            name            = "keycloak-loopback-proxy-443"
            image           = "alpine/socat:1.8.0.0"
            imagePullPolicy = "IfNotPresent"
            args = [
              "TCP-LISTEN:443,fork,reuseaddr,bind=127.0.0.1",
              "TCP:keycloak-nodeport.keycloak.svc.cluster.local:443",
            ]
          },
        ]

        volumeMounts = [
          {
            name      = "gitops-repo"
            mountPath = "/repo"
            readOnly  = true
          }
        ]

        volumes = [
          {
            name = "gitops-repo"
            hostPath = {
              path = local.euroscale_mount_path
              type = "Directory"
            }
          }
        ]
      }

      repoServer = {
        env = [
          {
            name  = "ARGOCD_EXEC_TIMEOUT"
            value = "5m"
          },
          {
            name  = "ARGOCD_EXEC_FATAL_TIMEOUT"
            value = "6m"
          },
          {
            name  = "ARGOCD_GIT_REQUEST_TIMEOUT"
            value = "5m"
          },
        ]

        volumeMounts = [
          {
            name      = "gitops-repo"
            mountPath = "/repo"
            readOnly  = true
          }
        ]

        volumes = [
          {
            name = "gitops-repo"
            hostPath = {
              path = local.euroscale_mount_path
              type = "Directory"
            }
          }
        ]
      }
    })
  ]
}

# Warte bis ArgoCD Server bereit ist
resource "time_sleep" "wait_for_argocd" {
  depends_on = [null_resource.sync_argocd_oidc_trust]

  create_duration = "45s"
}

# Hält den Keycloak OIDC Trust Store in ArgoCD aktuell
resource "null_resource" "sync_argocd_oidc_trust" {
  depends_on = [helm_release.argocd]

  triggers = {
    keycloak_oidc_ca_cert_sha256 = try(filesha256(local.keycloak_oidc_ca_cert_path), "")
  }

  provisioner "local-exec" {
    command = <<-EOT
      kubectl --context kind-${var.cluster_name} -n argocd create configmap argocd-tls-certs-cm \
        --from-file=keycloak.internal.${var.base_domain}=${local.keycloak_oidc_ca_cert_path} \
        --dry-run=client -o yaml | kubectl --context kind-${var.cluster_name} apply -f -
      kubectl --context kind-${var.cluster_name} -n argocd rollout restart deployment/argocd-server
      kubectl --context kind-${var.cluster_name} -n argocd rollout status deployment/argocd-server --timeout=180s
    EOT
    environment = {
      KUBECONFIG = pathexpand("~/.kube/config")
    }
  }
}

# Wartet bis ArgoCD CRDs bereit sind
resource "null_resource" "wait_for_argocd_crds" {
  depends_on = [time_sleep.wait_for_argocd]

  provisioner "local-exec" {
    command = "kubectl --context kind-${var.cluster_name} wait --for=condition=Established crd/applications.argoproj.io --timeout=180s"
    environment = {
      KUBECONFIG = pathexpand("~/.kube/config")
    }
  }
}

# Initial Admin Secret - nur relevant wenn argocd_local_admin_enabled = true
data "kubernetes_secret" "argocd_initial_admin" {
  count      = var.enable_argocd_initial_admin_secret_lookup && local.argocd_local_admin_enabled ? 1 : 0
  depends_on = [time_sleep.wait_for_argocd]

  metadata {
    name      = "argocd-initial-admin-secret"
    namespace = kubernetes_namespace.argocd.metadata[0].name
  }
}

output "argocd_admin_password" {
  description = "ArgoCD Initial Admin Password (nur wenn local admin aktiviert)"
  value       = try(data.kubernetes_secret.argocd_initial_admin[0].data["password"], null)
  sensitive   = true
}

output "argocd_server_url" {
  description = "ArgoCD Server URL"
  value       = "https://argocd.internal.euroscale.local"
}
