resource "null_resource" "wait_for_argocd" {
  provisioner "local-exec" {
    command = <<-EOT
      kubectl wait --for=condition=Established crd/applications.argoproj.io --timeout=180s
      kubectl -n ${var.argocd_namespace} rollout status deployment/argocd-server --timeout=180s
    EOT
    environment = {
      KUBECONFIG = pathexpand("~/.kube/config")
    }
  }
}

resource "null_resource" "wait_for_keycloak_ready" {
  depends_on = [null_resource.wait_for_argocd]

  provisioner "local-exec" {
    command = <<-EOT
      kubectl -n keycloak wait --for=condition=Ready pod -l app=keycloak --timeout=1800s
    EOT
    environment = {
      KUBECONFIG = pathexpand("~/.kube/config")
    }
  }
}

resource "null_resource" "argocd_apps_apply" {
  depends_on = [null_resource.wait_for_keycloak_ready]

  triggers = {
    root_app = "apps"
    spec_sha = filesha256("${path.module}/main.tf")
  }

  provisioner "local-exec" {
    command = <<-EOT
      kubectl apply -f - <<'APP'
      apiVersion: argoproj.io/v1alpha1
      kind: Application
      metadata:
        name: apps
        namespace: ${var.argocd_namespace}
        annotations:
          argocd.argoproj.io/sync-wave: "0"
      spec:
        project: default
        source:
          repoURL: file:///repo
          targetRevision: HEAD
          path: control-plane/gitops/argocd/main
        destination:
          server: https://kubernetes.default.svc
          namespace: ${var.argocd_namespace}
        syncPolicy:
          automated:
            prune: true
            selfHeal: true
      APP
    EOT
    environment = {
      KUBECONFIG = pathexpand("~/.kube/config")
    }
  }
}
