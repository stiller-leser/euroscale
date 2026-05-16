#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const controlPlaneRoot = path.join(repoRoot, 'control-plane');
const agenciesRoot = path.resolve(repoRoot, 'agencies');
const authzRoot = path.join(agenciesRoot, 'authz');
const modelPath = path.join(authzRoot, 'model.json');
const compileRegoPath = path.join(authzRoot, 'rego', 'compile.rego');
const validateRegoPath = path.join(authzRoot, 'rego', 'validate.rego');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeIfChanged(filePath, content) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  let current = null;
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch {
    current = null;
  }
  if (current === normalized) {
    return false;
  }
  ensureDir(filePath);
  fs.writeFileSync(filePath, normalized, 'utf8');
  return true;
}

function yamlScalar(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  return String(value);
}

function renderKeycloakRealmRoles(realmRoles, indent) {
  return realmRoles
    .map(role => {
      const lines = [`${indent}- name: ${yamlScalar(role.name)}`];
      if (role.description) {
        lines.push(`${indent}  description: ${yamlScalar(role.description)}`);
      }
      return lines.join('\n');
    })
    .join('\n');
}

function renderKeycloakGroups(groups, indent) {
  return groups.map(group => `${indent}- name: ${yamlScalar(group.name)}`).join('\n');
}

function renderStringList(key, values, indent) {
  if (!Array.isArray(values) || values.length === 0) {
    return '';
  }
  const lines = [`${indent}${key}:`];
  for (const value of values) {
    lines.push(`${indent}  - ${yamlScalar(value)}`);
  }
  return lines.join('\n');
}

function renderCredentials(credentials, indent) {
  if (!Array.isArray(credentials) || credentials.length === 0) {
    return '';
  }
  const lines = [`${indent}credentials:`];
  for (const credential of credentials) {
    lines.push(`${indent}  - type: ${yamlScalar(credential.type)}`);
    lines.push(`${indent}    value: ${yamlScalar(credential.value)}`);
    lines.push(`${indent}    temporary: ${yamlScalar(credential.temporary)}`);
  }
  return lines.join('\n');
}

function renderClientRoles(clientRoles, indent) {
  if (!clientRoles || typeof clientRoles !== 'object') {
    return '';
  }
  const clientNames = Object.keys(clientRoles);
  if (!clientNames.length) {
    return '';
  }
  const lines = [`${indent}clientRoles:`];
  for (const clientName of clientNames) {
    lines.push(`${indent}  ${clientName}:`);
    const roles = Array.isArray(clientRoles[clientName]) ? clientRoles[clientName] : [];
    for (const role of roles) {
      lines.push(`${indent}    - ${yamlScalar(role)}`);
    }
  }
  return lines.join('\n');
}

function renderKeycloakUsers(users, indent) {
  const renderedUsers = [];
  for (const user of users) {
    const lines = [];
    lines.push(`${indent}- username: ${yamlScalar(user.username)}`);
    lines.push(`${indent}  enabled: ${yamlScalar(Boolean(user.enabled))}`);
    lines.push(`${indent}  emailVerified: ${yamlScalar(Boolean(user.emailVerified))}`);
    if (user.email !== undefined) {
      lines.push(`${indent}  email: ${yamlScalar(user.email)}`);
    }
    if (user.firstName !== undefined) {
      lines.push(`${indent}  firstName: ${yamlScalar(user.firstName)}`);
    }
    if (user.lastName !== undefined) {
      lines.push(`${indent}  lastName: ${yamlScalar(user.lastName)}`);
    }

    const requiredActions = renderStringList('requiredActions', user.requiredActions, `${indent}  `);
    if (requiredActions) {
      lines.push(requiredActions);
    }

    const realmRoles = renderStringList('realmRoles', user.realmRoles, `${indent}  `);
    if (realmRoles) {
      lines.push(realmRoles);
    }

    const groups = renderStringList('groups', user.groups, `${indent}  `);
    if (groups) {
      lines.push(groups);
    }

    const clientRoles = renderClientRoles(user.clientRoles, `${indent}  `);
    if (clientRoles) {
      lines.push(clientRoles);
    }

    const credentials = renderCredentials(user.credentials, `${indent}  `);
    if (credentials) {
      lines.push(credentials);
    }

    renderedUsers.push(lines.join('\n'));
  }
  return renderedUsers.join('\n');
}

function replaceMarkedBlock(filePath, beginMarker, endMarker, content) {
  const input = fs.readFileSync(filePath, 'utf8');
  const beginIndex = input.indexOf(beginMarker);
  if (beginIndex < 0) {
    throw new Error(`Missing begin marker '${beginMarker}' in ${filePath}`);
  }

  const beginLineEnd = input.indexOf('\n', beginIndex);
  if (beginLineEnd < 0) {
    throw new Error(`Invalid begin marker line in ${filePath}`);
  }

  const endIndex = input.indexOf(endMarker, beginLineEnd + 1);
  if (endIndex < 0) {
    throw new Error(`Missing end marker '${endMarker}' in ${filePath}`);
  }

  const endLineStart = input.lastIndexOf('\n', endIndex);
  if (endLineStart < 0) {
    throw new Error(`Invalid end marker line in ${filePath}`);
  }

  const next =
    input.slice(0, beginLineEnd + 1) +
    `${content.trimEnd()}\n` +
    input.slice(endLineStart + 1);

  return writeIfChanged(filePath, next);
}

function renderBackstageArgocdComponents(components) {
  const docs = [];
  for (const component of components) {
    const annotations = [
      `    argocd/project-name: ${yamlScalar(component.project)}`,
    ];
    if (component.scopeArgocd) {
      annotations.push('    backstage.euroscale.io/scope-argocd: "true"');
    }
    if (component.scopeAgenciesArgocd) {
      annotations.push('    backstage.euroscale.io/scope-agencies-argocd: "true"');
    }

    docs.push([
      'apiVersion: backstage.io/v1alpha1',
      'kind: Component',
      'metadata:',
      `  name: ${component.name}`,
      '  annotations:',
      ...annotations,
      'spec:',
      '  type: service',
      '  lifecycle: production',
      `  owner: ${component.owner}`,
      `  system: ${component.system}`,
    ].join('\n'));
  }

  return `${docs.join('\n---\n')}\n---`;
}

function renderOpenbaoRoleBindingsYaml(model) {
  const rawKcpUsers = Array.isArray(model.kubeconfigs.kcpOidcUsers)
    ? model.kubeconfigs.kcpOidcUsers
    : [model.kubeconfigs.kcpOidcUser];
  const kcpUsers = [...new Set(rawKcpUsers.filter(user => typeof user === 'string' && user.trim().length > 0).map(user => user.trim()))];
  const primaryKcpUser = kcpUsers[0] ?? model.kubeconfigs.kcpOidcUser;

  const lines = [
    '---',
    '# AUTO-GENERATED by scripts/generate-authz-config.mjs. Do not edit manually.',
    `kube_oidc_kubeconfig_user: ${yamlScalar(model.kubeconfigs.kubeOidcUser)}`,
    `kcp_oidc_kubeconfig_user: ${yamlScalar(primaryKcpUser)}`,
    ...(kcpUsers.length
      ? ['kcp_oidc_kubeconfig_users:', ...kcpUsers.map(user => `  - ${yamlScalar(user)}`)]
      : ['kcp_oidc_kubeconfig_users: []']),
    `kcp_oidc_kubeconfig_server_url: ${yamlScalar(model.kubeconfigs.kcpOidcServerUrl)}`,
    'openbao_oidc_role_bindings:',
  ];

  for (const binding of model.openbao.oidcRoleBindings) {
    lines.push(`  - name: ${yamlScalar(binding.name)}`);
    lines.push(`    token_policies: ${yamlScalar(binding.tokenPolicies)}`);
    lines.push('    bound_roles:');
    for (const role of binding.boundRoles ?? []) {
      lines.push(`      - ${yamlScalar(role)}`);
    }
  }

  return lines.join('\n');
}

function renderAllowedRoleLine(roles, indent) {
  const resolved = Array.isArray(roles)
    ? roles.filter(role => typeof role === 'string' && role.trim().length > 0).map(role => role.trim())
    : [];
  return `${indent}allowed-role: ${yamlScalar(resolved.join(','))}`;
}

function buildBackendTsConfig(model) {
  const payload = {
    roleSets: model.backstage.roleSets,
    argocdPluginRoles: model.backstage.argocdPluginRoles,
    catalogScopes: model.backstage.catalogScopes,
  };

  return [
    '// AUTO-GENERATED by scripts/generate-authz-config.mjs. Do not edit manually.',
    '',
    'export type AuthzScopeAnnotation = {',
    '  annotation: string;',
    '  value?: string;',
    '};',
    '',
    'export const authzConfig = ',
    `${JSON.stringify(payload, null, 2)} as const;`,
    '',
  ].join('\n');
}

function validateModel(model) {
  const requiredTopLevel = ['argocd', 'keycloak', 'backstage', 'openbao', 'oauth2Proxy', 'kubeconfigs'];
  for (const key of requiredTopLevel) {
    if (!model[key]) {
      throw new Error(`agencies/authz/model.json is missing top-level key '${key}'`);
    }
  }
}

function evalOpa(repoRootDir, query, regoFiles) {
  const args = ['eval', '-f', 'json', '-d', modelPath];
  for (const regoFile of regoFiles) {
    args.push('-d', regoFile);
  }
  args.push(query);
  return spawnSync(
    'opa',
    args,
    {
      cwd: repoRootDir,
      encoding: 'utf8',
    },
  );
}

function readOpaValue(evalResult) {
  const parsed = JSON.parse(evalResult.stdout || '{}');
  return parsed?.result?.[0]?.expressions?.[0]?.value;
}

function maybeLoadCompiledModelFromOpa(repoRootDir, required) {
  const compileEval = evalOpa(
    repoRootDir,
    'data.euroscale.authz.compile.generated',
    [compileRegoPath],
  );

  if (compileEval.error && compileEval.error.code === 'ENOENT') {
    if (required) {
      throw new Error(
        'OPA CLI is required for --require-opa but was not found in PATH.',
      );
    }
    return null;
  }

  if (compileEval.status !== 0) {
    throw new Error(
      `OPA compile query failed:\\n${compileEval.stderr || compileEval.stdout}`,
    );
  }

  const compiled = readOpaValue(compileEval);
  if (!compiled || typeof compiled !== 'object') {
    throw new Error('OPA compile query returned empty or invalid model.');
  }
  return compiled;
}

function runRequiredOpaValidation(repoRootDir, required) {
  const allowEval = evalOpa(
    repoRootDir,
    'data.euroscale.authz.validate.allow',
    [validateRegoPath],
  );
  if (allowEval.error && allowEval.error.code === 'ENOENT') {
    if (!required) {
      return false;
    }
    throw new Error(
      'OPA CLI is required for --require-opa but was not found in PATH.',
    );
  }
  if (allowEval.status !== 0) {
    throw new Error(
      `OPA validation query failed:\\n${allowEval.stderr || allowEval.stdout}`,
    );
  }

  const allowValue = readOpaValue(allowEval) === true;
  if (allowValue) {
    return true;
  }

  const errorEval = evalOpa(
    repoRootDir,
    'data.euroscale.authz.validate.errors',
    [validateRegoPath],
  );
  if (errorEval.status !== 0) {
    throw new Error(
      `OPA error query failed:\\n${errorEval.stderr || errorEval.stdout}`,
    );
  }
  const errors = readOpaValue(errorEval) ?? [];
  const renderedErrors = Array.isArray(errors) ? errors : [errors];
  throw new Error(
    `OPA validation failed:\\n- ${renderedErrors.join('\\n- ')}`,
  );
}

const requireOpa = process.argv.includes('--require-opa');

const compiledModel = maybeLoadCompiledModelFromOpa(repoRoot, requireOpa);
const model = compiledModel ?? readJson(modelPath);
validateModel(model);

if (compiledModel) {
  runRequiredOpaValidation(repoRoot, requireOpa);
  console.log('Using OPA/Rego compiled authz model.');
} else if (requireOpa) {
  runRequiredOpaValidation(repoRoot, true);
} else {
  console.warn('OPA CLI not found; using agencies/authz/model.json directly (no Rego compile at generation time).');
}

const changed = [];

if (
  writeIfChanged(
    path.join(repoRoot, 'terraform/bootstrap/generated/argocd-policy.csv'),
    model.argocd.policyCsvLines.join('\n'),
  )
) {
  changed.push('terraform/bootstrap/generated/argocd-policy.csv');
}

if (
  writeIfChanged(
    path.join(controlPlaneRoot, 'tools/backstage-app/packages/backend/src/generated/authzConfig.ts'),
    buildBackendTsConfig(model),
  )
) {
  changed.push('tools/backstage-app/packages/backend/src/generated/authzConfig.ts');
}

if (
  writeIfChanged(
    path.join(__dirname, '..', '..', 'common', 'tools', 'ansible', 'group_vars', 'authz.generated.yml'),
    renderOpenbaoRoleBindingsYaml(model),
  )
) {
  changed.push('tools/ansible/group_vars/authz.generated.yml');
}

const keycloakFile = path.join(
  controlPlaneRoot,
  'gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/realm-import.yaml',
);
if (
  replaceMarkedBlock(
    keycloakFile,
    '# BEGIN AUTHZ GENERATED KEYCLOAK_REALM_ROLES',
    '# END AUTHZ GENERATED KEYCLOAK_REALM_ROLES',
    renderKeycloakRealmRoles(model.keycloak.realmRoles, '        '),
  )
) {
  changed.push('gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/realm-import.yaml (realm roles)');
}
if (
  replaceMarkedBlock(
    keycloakFile,
    '# BEGIN AUTHZ GENERATED KEYCLOAK_GROUPS',
    '# END AUTHZ GENERATED KEYCLOAK_GROUPS',
    renderKeycloakGroups(model.keycloak.groups, '      '),
  )
) {
  changed.push('gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/realm-import.yaml (groups)');
}
if (
  replaceMarkedBlock(
    keycloakFile,
    '# BEGIN AUTHZ GENERATED KEYCLOAK_USERS',
    '# END AUTHZ GENERATED KEYCLOAK_USERS',
    renderKeycloakUsers(model.keycloak.users, '      '),
  )
) {
  changed.push('gitops/argocd/bootstrap/apps/identity-management/keycloak-resources/realm-import.yaml (users)');
}

const oauth2ProxyFile = path.join(
  controlPlaneRoot,
  'gitops/argocd/main/apps/infrastructure/oauth2-proxy/helm-releases.yaml',
);
if (
  replaceMarkedBlock(
    oauth2ProxyFile,
    '# BEGIN AUTHZ GENERATED OPENBAO_ALLOWED_ROLE',
    '# END AUTHZ GENERATED OPENBAO_ALLOWED_ROLE',
    renderAllowedRoleLine(model.oauth2Proxy.openbaoAllowedRoles, '        '),
  )
) {
  changed.push('gitops/argocd/main/apps/infrastructure/oauth2-proxy/helm-releases.yaml (openbao allowed-role)');
}
if (
  replaceMarkedBlock(
    oauth2ProxyFile,
    '# BEGIN AUTHZ GENERATED BACKSTAGE_ALLOWED_ROLE',
    '# END AUTHZ GENERATED BACKSTAGE_ALLOWED_ROLE',
    renderAllowedRoleLine(model.oauth2Proxy.backstageAllowedRoles, '        '),
  )
) {
  changed.push('gitops/argocd/main/apps/infrastructure/oauth2-proxy/helm-releases.yaml (backstage allowed-role)');
}

const catalogFiles = [
  path.join(controlPlaneRoot, 'tools/backstage-app/catalog-info.yaml'),
  path.join(controlPlaneRoot, 'tools/backstage-app/catalog-entities.yaml'),
];
for (const catalogFile of catalogFiles) {
  if (
    replaceMarkedBlock(
      catalogFile,
      '# BEGIN AUTHZ GENERATED BACKSTAGE_ARGOCD_COMPONENTS',
      '# END AUTHZ GENERATED BACKSTAGE_ARGOCD_COMPONENTS',
      renderBackstageArgocdComponents(model.backstage.argocdCatalogComponents),
    )
  ) {
    changed.push(path.relative(repoRoot, catalogFile));
  }
}

if (changed.length) {
  console.log('Updated authz-generated artifacts:');
  for (const file of changed) {
    console.log(`- ${file}`);
  }
} else {
  console.log('Authz-generated artifacts are up to date.');
}
