import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  type PermissionCondition,
  type PermissionCriteria,
  isPermission,
  isResourcePermission,
} from '@backstage/plugin-permission-common';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import type {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  RESOURCE_TYPE_CATALOG_ENTITY,
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
  catalogEntityRefreshPermission,
  catalogLocationCreatePermission,
  catalogLocationDeletePermission,
} from '@backstage/plugin-catalog-common/alpha';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import {
  actionExecutePermission,
  taskCreatePermission,
  taskReadPermission,
  templateManagementPermission,
  templateParameterReadPermission,
  templateStepReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import { authzConfig } from '../generated/authzConfig';

const catalogMutationPermissions = new Set<string>([
  catalogEntityCreatePermission.name,
  catalogEntityDeletePermission.name,
  catalogEntityRefreshPermission.name,
  catalogLocationCreatePermission.name,
  catalogLocationDeletePermission.name,
]);

const scaffolderPermissions = new Set<string>([
  actionExecutePermission.name,
  taskCreatePermission.name,
  taskReadPermission.name,
  templateManagementPermission.name,
  templateParameterReadPermission.name,
  templateStepReadPermission.name,
]);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(v => String(v));
}

function roleCandidates(value: unknown): string[] {
  const input = String(value ?? '').trim().toLowerCase();
  if (!input) {
    return [];
  }

  const parts = input
    .split(/[/:]/)
    .map(part => part.trim())
    .filter(Boolean);

  return [input, ...parts];
}

function hasRole(user: PolicyQueryUser | undefined, role: string): boolean {
  if (!user) {
    return false;
  }

  const roleNeedle = role.toLowerCase();
  const refs = [
    user.info.userEntityRef,
    ...(user.info.ownershipEntityRefs ?? []),
  ];

  const hints = new Set<string>();
  for (const ref of refs) {
    for (const candidate of roleCandidates(ref)) {
      hints.add(candidate);
    }
  }

  const claims = (user as any)?.info?.claims ?? {};
  for (const claimGroup of asStringArray(claims.groups)) {
    for (const candidate of roleCandidates(claimGroup)) {
      hints.add(candidate);
    }
  }
  for (const candidate of roleCandidates(claims.preferred_username)) {
    hints.add(candidate);
  }
  for (const candidate of roleCandidates(claims.email)) {
    hints.add(candidate);
  }
  for (const claimRole of asStringArray(claims.roles)) {
    for (const candidate of roleCandidates(claimRole)) {
      hints.add(candidate);
    }
  }
  for (const claimRole of asStringArray(claims.realm_access?.roles)) {
    for (const candidate of roleCandidates(claimRole)) {
      hints.add(candidate);
    }
  }

  const resourceAccess = claims.resource_access;
  if (resourceAccess && typeof resourceAccess === 'object') {
    for (const clientValue of Object.values(resourceAccess as Record<string, unknown>)) {
      if (!clientValue || typeof clientValue !== 'object') {
        continue;
      }
      for (const claimRole of asStringArray((clientValue as any).roles)) {
        for (const candidate of roleCandidates(claimRole)) {
          hints.add(candidate);
        }
      }
    }
  }

  if (hints.has(roleNeedle)) {
    return true;
  }
  return false;
}

function hasAnyRole(user: PolicyQueryUser | undefined, roles: readonly string[]): boolean {
  return roles.some(role => hasRole(user, role));
}

type CatalogEntityPermissionCondition = PermissionCondition<'catalog-entity'>;
type CatalogEntityPermissionCriteria =
  PermissionCriteria<CatalogEntityPermissionCondition>;

function anyCatalogEntityScope(
  first: CatalogEntityPermissionCriteria,
  ...rest: CatalogEntityPermissionCriteria[]
): CatalogEntityPermissionCriteria {
  return { anyOf: [first, ...rest] };
}

function scopeCriteriaFromAnnotations(
  annotations: readonly { annotation: string; value?: string }[],
): CatalogEntityPermissionCriteria {
  const conditions = annotations.map(annotationDef =>
    annotationDef.value !== undefined
      ? catalogConditions.hasAnnotation({
          annotation: annotationDef.annotation,
          value: annotationDef.value,
        })
      : catalogConditions.hasAnnotation({
          annotation: annotationDef.annotation,
        }),
  );

  const [first, ...rest] = conditions;
  if (!first) {
    throw new Error('authzConfig catalog scope annotations must not be empty');
  }
  return rest.length === 0 ? first : anyCatalogEntityScope(first, ...rest);
}

const agenciesEntityScope = scopeCriteriaFromAnnotations(
  authzConfig.catalogScopes.agenciesXrd,
);
const agenciesArgocdEntityScope = scopeCriteriaFromAnnotations(
  authzConfig.catalogScopes.agenciesArgocd,
);
const argocdEntityScope = scopeCriteriaFromAnnotations(authzConfig.catalogScopes.argocd);
const openbaoEntityScope = scopeCriteriaFromAnnotations(authzConfig.catalogScopes.openbao);

class CustomPermissionPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery, user?: PolicyQueryUser) {
    const permission = request.permission;
    const permissionName = permission.name;
    const isAgenciesAdmin = hasAnyRole(user, authzConfig.roleSets.agenciesAdmin);
    const isArgocdAdmin = hasAnyRole(user, authzConfig.roleSets.argocdAdmin);
    const isOpenbaoAdmin = hasAnyRole(user, authzConfig.roleSets.openbaoAdmin);
    const isScopedUser = isAgenciesAdmin || isArgocdAdmin || isOpenbaoAdmin;

    // Catalog ingestion and refresh must not be blocked by scoped user policy.
    if (catalogMutationPermissions.has(permissionName)) {
      if (!user) {
        return { result: AuthorizeResult.ALLOW };
      }
      return isAgenciesAdmin
        ? { result: AuthorizeResult.ALLOW }
        : { result: AuthorizeResult.DENY };
    }

    // Internal backend/plugin requests may not carry an end-user identity.
    // Allow catalog reads so auth resolvers and collators can function.
    if (!user && isPermission(permission, catalogEntityReadPermission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    if (isResourcePermission(permission, RESOURCE_TYPE_CATALOG_ENTITY)) {
      if (catalogMutationPermissions.has(permissionName)) {
        return { result: AuthorizeResult.DENY };
      }

      if (isPermission(permission, catalogEntityReadPermission)) {
        const scopes: CatalogEntityPermissionCriteria[] = [];
        if (isAgenciesAdmin) {
          scopes.push(agenciesEntityScope);
          scopes.push(agenciesArgocdEntityScope);
        }
        if (isArgocdAdmin) {
          scopes.push(argocdEntityScope);
        }
        if (isOpenbaoAdmin) {
          scopes.push(openbaoEntityScope);
        }

        if (scopes.length === 0) {
          return { result: AuthorizeResult.DENY };
        }
        const [firstScope, ...restScopes] = scopes;
        if (restScopes.length === 0) {
          return createCatalogConditionalDecision(permission, firstScope);
        }
        return createCatalogConditionalDecision(
          permission,
          anyCatalogEntityScope(firstScope, ...restScopes),
        );
      }
    }

    if (scaffolderPermissions.has(permissionName)) {
      if (!isAgenciesAdmin) {
        return { result: AuthorizeResult.DENY };
      }
      if (isPermission(permission, templateManagementPermission)) {
        return { result: AuthorizeResult.DENY };
      }
      return { result: AuthorizeResult.ALLOW };
    }

    // Crossplane backend routes currently perform permission checks with service credentials.
    // Keep service-level checks functional and enforce role checks for end users.
    if (permissionName.startsWith('crossplane.')) {
      if (!user) {
        return { result: AuthorizeResult.ALLOW };
      }
      return isAgenciesAdmin
        ? { result: AuthorizeResult.ALLOW }
        : { result: AuthorizeResult.DENY };
    }

    if (isScopedUser) {
      if (permissionName.startsWith('argocd.')) {
        return hasAnyRole(user, authzConfig.argocdPluginRoles)
          ? { result: AuthorizeResult.ALLOW }
          : { result: AuthorizeResult.DENY };
      }

      if (permissionName.startsWith('vault.')) {
        return isOpenbaoAdmin
          ? { result: AuthorizeResult.ALLOW }
          : { result: AuthorizeResult.DENY };
      }

      return { result: AuthorizeResult.DENY };
    }

    return { result: AuthorizeResult.DENY };
  }
}

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'custom-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new CustomPermissionPolicy());
      },
    });
  },
});
