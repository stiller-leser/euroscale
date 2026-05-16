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

resource "null_resource" "apps_bootstrap_apply" {
  depends_on = [null_resource.wait_for_argocd]

  triggers = {
    root_app = "bootstrap"
    spec_sha = filesha256("${path.module}/main.tf")
  }

  provisioner "local-exec" {
    command = <<-EOT
      kubectl apply -f - <<'APP'
      apiVersion: argoproj.io/v1alpha1
      kind: Application
      metadata:
        name: bootstrap
        namespace: ${var.argocd_namespace}
        annotations:
          argocd.argoproj.io/sync-wave: "0"
      spec:
        project: default
        source:
          repoURL: file:///repo
          targetRevision: HEAD
          path: control-plane/gitops/argocd/bootstrap
        destination:
          server: https://kubernetes.default.svc
          namespace: ${var.argocd_namespace}
        syncPolicy:
          automated:
            prune: true
            selfHeal: true
          retry:
            limit: 20
            backoff:
              duration: 20s
              factor: 2
              maxDuration: 5m
          syncOptions:
          - CreateNamespace=true
      APP
    EOT
    environment = {
      KUBECONFIG = pathexpand("~/.kube/config")
    }
  }
}
