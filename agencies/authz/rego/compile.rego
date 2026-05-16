package euroscale.authz.compile

import rego.v1

generated := {
  "argocd": {
    "policyCsvLines": data.argocd.policyCsvLines,
  },
  "keycloak": {
    "realmRoles": data.keycloak.realmRoles,
    "groups": data.keycloak.groups,
    "users": data.keycloak.users,
  },
  "backstage": {
    "roleSets": data.backstage.roleSets,
    "argocdPluginRoles": data.backstage.argocdPluginRoles,
    "catalogScopes": data.backstage.catalogScopes,
    "menu": data.backstage.menu,
    "argocdCatalogComponents": data.backstage.argocdCatalogComponents,
  },
  "openbao": {
    "oidcRoleBindings": data.openbao.oidcRoleBindings,
  },
  "oauth2Proxy": {
    "backstageAllowedRoles": data.oauth2Proxy.backstageAllowedRoles,
    "openbaoAllowedRoles": data.oauth2Proxy.openbaoAllowedRoles,
  },
  "kubeconfigs": {
    "kubeOidcUser": data.kubeconfigs.kubeOidcUser,
    "kcpOidcUser": data.kubeconfigs.kcpOidcUser,
    "kcpOidcUsers": data.kubeconfigs.kcpOidcUsers,
    "kcpOidcServerUrl": data.kubeconfigs.kcpOidcServerUrl,
  },
}

# Backward-compatible single outputs for tooling that still reads individual keys.
argocd_policy_csv := concat("\n", generated.argocd.policyCsvLines)

keycloak_realm_roles := generated.keycloak.realmRoles
keycloak_groups := generated.keycloak.groups
keycloak_users := generated.keycloak.users

backstage_role_sets := generated.backstage.roleSets
backstage_catalog_scopes := generated.backstage.catalogScopes

openbao_oidc_role_bindings := generated.openbao.oidcRoleBindings

kubeconfig_users := {
  "kube_oidc_kubeconfig_user": generated.kubeconfigs.kubeOidcUser,
  "kcp_oidc_kubeconfig_user": generated.kubeconfigs.kcpOidcUser,
  "kcp_oidc_kubeconfig_users": generated.kubeconfigs.kcpOidcUsers,
  "kcp_oidc_kubeconfig_server_url": generated.kubeconfigs.kcpOidcServerUrl,
}
