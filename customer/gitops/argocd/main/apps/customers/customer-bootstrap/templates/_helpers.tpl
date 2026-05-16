{{- define "customer.normalizeLabel" -}}
{{- $raw := . | lower -}}
{{- $norm := regexReplaceAll "[^a-z0-9-]+" $raw "-" | trimAll "-" -}}
{{- if eq $norm "" -}}tenant{{- else -}}{{- $norm -}}{{- end -}}
{{- end -}}

{{- define "customer.agencyLabel" -}}
{{- include "customer.normalizeLabel" (required "agencyName is required" .Values.agencyName) -}}
{{- end -}}

{{- define "customer.customerLabel" -}}
{{- include "customer.normalizeLabel" (required "customerName is required" .Values.customerName) -}}
{{- end -}}

{{- define "customer.id" -}}
{{- $raw := printf "%s-%s" (include "customer.agencyLabel" .) (include "customer.customerLabel" .) -}}
{{- trunc 32 $raw | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.host" -}}
{{- printf "%s.%s.euroscale.local" (include "customer.customerLabel" .) (include "customer.agencyLabel" .) -}}
{{- end -}}

{{- define "customer.realmName" -}}
{{- printf "%s-%s" (default "agency" .Values.keycloak.realmPrefix) (include "customer.agencyLabel" .) -}}
{{- end -}}

{{- define "customer.vclusterNamespace" -}}
{{- printf "vcluster-%s" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.vclusterReleaseName" -}}
{{- printf "cust-%s-vc" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.crossplaneProviderConfigName" -}}
{{- printf "cust-%s-helm" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.kubernetesProviderConfigName" -}}
{{- printf "cust-%s-k8s" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.crossplaneReleaseName" -}}
{{- printf "cust-%s-crossplane" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.kubevirtReleaseName" -}}
{{- printf "cust-%s-kubevirt" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.kubeovnReleaseName" -}}
{{- printf "cust-%s-kubeovn" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.submarinerJoinJobName" -}}
{{- printf "cust-%s-subctl-join" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.kubeconfigSecretName" -}}
{{- printf "vc-%s" (include "customer.vclusterReleaseName" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.backstageReleaseName" -}}
{{- printf "backstage-cust-%s" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.backstageOauthProxyName" -}}
{{- printf "backstage-cust-%s-oauth2-proxy" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.catalogConfigMapName" -}}
{{- printf "customer-%s-catalog" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.allowedEmailsConfigMapName" -}}
{{- printf "backstage-cust-%s-allowed-emails" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.argocdApplicationName" -}}
{{- $fromValues := default "" .Values.argocd.applicationName -}}
{{- if ne $fromValues "" -}}
{{- $fromValues -}}
{{- else -}}
{{- printf "customer-%s-%s" (include "customer.agencyLabel" .) (include "customer.customerLabel" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "customer.gatewayName" -}}
{{- printf "customer-%s-gateway" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "customer.certificateName" -}}
{{- printf "customer-%s-tls" (include "customer.id" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
