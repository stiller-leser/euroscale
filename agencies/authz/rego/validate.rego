package euroscale.authz.validate

import rego.v1

default allow := false

required_role_names := {"argocd-admin", "agencies-admin", "openbao-admin", "kube-admin", "kcp-user"}
required_kcp_kubeconfig_users := {"kcp-user"}

forbidden_identity_roles := {"kube-admin", "kcp-user", "kube-admins", "kcp-users"}
forbidden_argocd_principals := {"kube-admin", "/kube-admin", "kube-admins", "/kube-admins", "kcp-user", "/kcp-user", "kcp-users", "/kcp-users"}

required_backstage_role_sets := {
  "agenciesAdmin": {"agencies-admin", "agencies-admins"},
  "argocdAdmin": {"argocd-admin", "argocd-admins"},
  "openbaoAdmin": {"openbao-admin", "openbao-admins"},
}

required_argocd_plugin_roles := {"argocd-admin", "argocd-admins", "agencies-admin", "agencies-admins"}

required_argocd_policy_lines := {
  "g, argocd-admin, role:admin",
  "g, argocd-admins, role:admin",
  "g, /argocd-admin, role:admin",
  "g, /argocd-admins, role:admin",
  "g, agencies-admin, role:agencies-read",
  "g, agencies-admins, role:agencies-read",
  "g, /agencies-admin, role:agencies-read",
  "g, /agencies-admins, role:agencies-read",
}

required_oauth2_backstage_roles := {"agencies-admin", "argocd-admin", "openbao-admin"}
required_oauth2_openbao_roles := {"openbao-admin"}

configured_role_names := {role.name | role := data.keycloak.realmRoles[_]}

configured_kcp_kubeconfig_users contains user if {
  user := data.kubeconfigs.kcpOidcUsers[_]
  user != ""
}

configured_kcp_kubeconfig_users contains user if {
  not data.kubeconfigs.kcpOidcUsers
  user := data.kubeconfigs.kcpOidcUser
  user != ""
}

configured_oauth2_backstage_roles contains role if {
  role := data.oauth2Proxy.backstageAllowedRoles[_]
  role != ""
}

configured_oauth2_openbao_roles contains role if {
  role := data.oauth2Proxy.openbaoAllowedRoles[_]
  role != ""
}

missing_role_names contains role_name if {
  role_name := required_role_names[_]
  not configured_role_names[role_name]
}

missing_kcp_kubeconfig_users contains user if {
  user := required_kcp_kubeconfig_users[_]
  not configured_kcp_kubeconfig_users[user]
}

extra_kcp_kubeconfig_users contains user if {
  user := configured_kcp_kubeconfig_users[_]
  user != "kcp-user"
}

missing_backstage_role_sets contains set_name if {
  required_backstage_role_sets[set_name]
  not data.backstage.roleSets[set_name]
}

missing_backstage_role_members contains entry if {
  required := required_backstage_role_sets[set_name]
  role := required[_]
  configured := data.backstage.roleSets[set_name]
  not role_in_array(configured, role)
  entry := sprintf("%s:%s", [set_name, role])
}

unexpected_backstage_role_members contains entry if {
  configured := data.backstage.roleSets[set_name]
  role := configured[_]
  required := required_backstage_role_sets[set_name]
  not required[role]
  entry := sprintf("%s:%s", [set_name, role])
}

missing_argocd_plugin_roles contains role if {
  role := required_argocd_plugin_roles[_]
  not role_in_array(data.backstage.argocdPluginRoles, role)
}

unexpected_argocd_plugin_roles contains role if {
  role := data.backstage.argocdPluginRoles[_]
  not required_argocd_plugin_roles[role]
}

missing_argocd_policy_lines contains line if {
  line := required_argocd_policy_lines[_]
  not line_in_array(data.argocd.policyCsvLines, line)
}

missing_oauth2_backstage_roles contains role if {
  role := required_oauth2_backstage_roles[_]
  not configured_oauth2_backstage_roles[role]
}

extra_oauth2_backstage_roles contains role if {
  role := configured_oauth2_backstage_roles[_]
  not required_oauth2_backstage_roles[role]
}

missing_oauth2_openbao_roles contains role if {
  role := required_oauth2_openbao_roles[_]
  not configured_oauth2_openbao_roles[role]
}

extra_oauth2_openbao_roles contains role if {
  role := configured_oauth2_openbao_roles[_]
  not required_oauth2_openbao_roles[role]
}

invalid_kube_oidc_user if {
  data.kubeconfigs.kubeOidcUser != "kube-admin"
}

invalid_kcp_oidc_user if {
  data.kubeconfigs.kcpOidcUser != "kcp-user"
}

missing_kcp_oidc_users if {
  count({u | configured_kcp_kubeconfig_users[u]}) == 0
}

argocd_forbidden_policy_lines contains line if {
  line := data.argocd.policyCsvLines[_]
  principal := forbidden_argocd_principals[_]
  contains(line, sprintf(", %s,", [principal]))
}

argocd_forbidden_policy_lines contains line if {
  line := data.argocd.policyCsvLines[_]
  contains(line, "openbao-admin")
}

backstage_forbidden_roles contains role if {
  role := data.backstage.roleSets[_][_]
  forbidden_identity_roles[role]
}

backstage_forbidden_roles contains role if {
  role := data.backstage.argocdPluginRoles[_]
  forbidden_identity_roles[role]
}

openbao_forbidden_roles contains role if {
  role := data.openbao.oidcRoleBindings[_].boundRoles[_]
  forbidden_identity_roles[role]
}

openbao_non_admin_bound_roles contains role if {
  role := data.openbao.oidcRoleBindings[_].boundRoles[_]
  role != "openbao-admin"
}

openbao_admin_binding_exists if {
  binding := data.openbao.oidcRoleBindings[_]
  binding.name == "openbao-admin"
  role_in_array(binding.boundRoles, "openbao-admin")
}

missing_openbao_admin_binding if {
  not openbao_admin_binding_exists
}

kcp_user_missing_role if {
  user := data.keycloak.users[_]
  user.username == "kcp-user"
  not user_has_role(user, "kcp-user")
}

kcp_user_wrong_role if {
  user := data.keycloak.users[_]
  user.username == "kcp-user"
  user_has_role(user, "kube-admin")
}

kcp_user_missing_group if {
  user := data.keycloak.users[_]
  user.username == "kcp-user"
  not user_in_group(user, "kcp-user")
}

kcp_user_wrong_group if {
  user := data.keycloak.users[_]
  user.username == "kcp-user"
  user_in_group(user, "kube-admin")
}

missing_kcp_user if {
  count([u | u := data.keycloak.users[_]; u.username == "kcp-user"]) == 0
}

allow if {
  count(missing_role_names) == 0
  count(missing_kcp_kubeconfig_users) == 0
  count(extra_kcp_kubeconfig_users) == 0
  count(missing_backstage_role_sets) == 0
  count(missing_backstage_role_members) == 0
  count(unexpected_backstage_role_members) == 0
  count(missing_argocd_plugin_roles) == 0
  count(unexpected_argocd_plugin_roles) == 0
  count(missing_argocd_policy_lines) == 0
  count(argocd_forbidden_policy_lines) == 0
  count(backstage_forbidden_roles) == 0
  count(openbao_forbidden_roles) == 0
  count(openbao_non_admin_bound_roles) == 0
  count(missing_oauth2_backstage_roles) == 0
  count(extra_oauth2_backstage_roles) == 0
  count(missing_oauth2_openbao_roles) == 0
  count(extra_oauth2_openbao_roles) == 0
  not missing_openbao_admin_binding
  not invalid_kube_oidc_user
  not invalid_kcp_oidc_user
  not missing_kcp_oidc_users
  not kcp_user_missing_role
  not kcp_user_wrong_role
  not kcp_user_missing_group
  not kcp_user_wrong_group
  not missing_kcp_user
}

errors contains msg if {
  role_name := missing_role_names[_]
  msg := sprintf("missing required keycloak role: %s", [role_name])
}

errors contains msg if {
  invalid_kube_oidc_user
  msg := sprintf("kubeconfigs.kubeOidcUser must be kube-admin (got %v)", [data.kubeconfigs.kubeOidcUser])
}

errors contains msg if {
  invalid_kcp_oidc_user
  msg := sprintf("kubeconfigs.kcpOidcUser must be kcp-user (got %v)", [data.kubeconfigs.kcpOidcUser])
}

errors contains msg if {
  missing_kcp_oidc_users
  msg := "kubeconfigs.kcpOidcUsers (or kcpOidcUser) must be set"
}

errors contains msg if {
  user := missing_kcp_kubeconfig_users[_]
  msg := sprintf("kubeconfigs.kcpOidcUsers must include %s", [user])
}

errors contains msg if {
  user := extra_kcp_kubeconfig_users[_]
  msg := sprintf("kubeconfigs.kcpOidcUsers must not include %s", [user])
}

errors contains msg if {
  set_name := missing_backstage_role_sets[_]
  msg := sprintf("backstage.roleSets is missing required set %s", [set_name])
}

errors contains msg if {
  entry := missing_backstage_role_members[_]
  msg := sprintf("backstage.roleSets is missing required member %s", [entry])
}

errors contains msg if {
  entry := unexpected_backstage_role_members[_]
  msg := sprintf("backstage.roleSets contains unexpected member %s", [entry])
}

errors contains msg if {
  role := missing_argocd_plugin_roles[_]
  msg := sprintf("backstage.argocdPluginRoles is missing required role %s", [role])
}

errors contains msg if {
  role := unexpected_argocd_plugin_roles[_]
  msg := sprintf("backstage.argocdPluginRoles contains unexpected role %s", [role])
}

errors contains msg if {
  line := missing_argocd_policy_lines[_]
  msg := sprintf("argocd.policyCsvLines is missing required line %s", [line])
}

errors contains msg if {
  role := backstage_forbidden_roles[_]
  msg := sprintf("backstage role mappings must not include identity role %s", [role])
}

errors contains msg if {
  role := openbao_forbidden_roles[_]
  msg := sprintf("openbao bound roles must not include identity role %s", [role])
}

errors contains msg if {
  role := openbao_non_admin_bound_roles[_]
  msg := sprintf("openbao bound roles must remain openbao-admin only (found %s)", [role])
}

errors contains msg if {
  line := argocd_forbidden_policy_lines[_]
  msg := sprintf("argocd policy contains forbidden principal/role mapping: %s", [line])
}

errors contains msg if {
  role := missing_oauth2_backstage_roles[_]
  msg := sprintf("oauth2Proxy.backstageAllowedRoles missing %s", [role])
}

errors contains msg if {
  role := extra_oauth2_backstage_roles[_]
  msg := sprintf("oauth2Proxy.backstageAllowedRoles contains unexpected role %s", [role])
}

errors contains msg if {
  role := missing_oauth2_openbao_roles[_]
  msg := sprintf("oauth2Proxy.openbaoAllowedRoles missing %s", [role])
}

errors contains msg if {
  role := extra_oauth2_openbao_roles[_]
  msg := sprintf("oauth2Proxy.openbaoAllowedRoles contains unexpected role %s", [role])
}

errors contains msg if {
  missing_openbao_admin_binding
  msg := "openbao.oidcRoleBindings must contain binding name=openbao-admin with bound role openbao-admin"
}

errors contains msg if {
  kcp_user_missing_role
  msg := "keycloak user kcp-user must include realm role kcp-user"
}

errors contains msg if {
  kcp_user_wrong_role
  msg := "keycloak user kcp-user must not include realm role kube-admin"
}

errors contains msg if {
  kcp_user_missing_group
  msg := "keycloak user kcp-user must be in group kcp-user"
}

errors contains msg if {
  kcp_user_wrong_group
  msg := "keycloak user kcp-user must not be in group kube-admin"
}

errors contains msg if {
  missing_kcp_user
  msg := "keycloak user kcp-user must exist"
}

role_in_array(arr, role) if {
  arr[_] == role
}

line_in_array(arr, line) if {
  arr[_] == line
}

user_has_role(user, role) if {
  user.realmRoles[_] == role
}

user_in_group(user, group) if {
  user.groups[_] == group
}
