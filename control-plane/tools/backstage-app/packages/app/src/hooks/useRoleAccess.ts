import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useMemo, useState } from 'react';
import { authzConfig } from '../generated/authzConfig';

type RoleAccessState = {
  loading: boolean;
  hasRole: (role: string) => boolean;
  isAgenciesAdmin: boolean;
  isArgocdAdmin: boolean;
  isOpenbaoAdmin: boolean;
};

function decodeJwtPayload(token: string): Record<string, any> | undefined {
  const parts = token.split('.');
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v));
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map(v => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeHint(value: string): string[] {
  const v = String(value).trim().toLowerCase();
  if (!v) {
    return [];
  }

  const parts = v
    .split(/[/:]/)
    .map(p => p.trim())
    .filter(Boolean);

  return [v, ...parts];
}

function collectRoleHints(claims: Record<string, any> | undefined): Set<string> {
  const values = new Set<string>();

  if (!claims) {
    return values;
  }

  const username = String(claims.preferred_username ?? claims.email ?? '').trim();
  for (const hint of normalizeHint(username)) {
    values.add(hint);
  }

  for (const group of asStringArray(claims.groups)) {
    for (const hint of normalizeHint(group)) {
      values.add(hint);
    }
  }

  for (const role of asStringArray(claims.roles)) {
    for (const hint of normalizeHint(role)) {
      values.add(hint);
    }
  }

  for (const role of asStringArray(claims.realm_access?.roles)) {
    for (const hint of normalizeHint(role)) {
      values.add(hint);
    }
  }

  const resourceAccess = claims.resource_access;
  if (resourceAccess && typeof resourceAccess === 'object') {
    for (const clientValue of Object.values(resourceAccess)) {
      if (!clientValue || typeof clientValue !== 'object') {
        continue;
      }
      for (const role of asStringArray((clientValue as any).roles)) {
        for (const hint of normalizeHint(role)) {
          values.add(hint);
        }
      }
    }
  }

  for (const hint of normalizeHint(claims.sub ?? '')) {
    values.add(hint);
  }

  return values;
}

export function useRoleAccess(): RoleAccessState {
  const identityApi = useApi(identityApiRef);
  const [loading, setLoading] = useState(true);
  const [hints, setHints] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const collected = new Set<string>();

      try {
        const identity = await identityApi.getBackstageIdentity();
        for (const value of [
          identity.userEntityRef,
          ...(identity.ownershipEntityRefs ?? []),
        ]) {
          for (const hint of normalizeHint(value)) {
            collected.add(hint);
          }
        }
      } catch {
        // Ignore; can happen before first successful login.
      }

      try {
        const res = await fetch('/oauth2/userinfo', {
          credentials: 'include',
        });
        if (res.ok) {
          const claims = (await res.json()) as Record<string, any>;
          for (const hint of collectRoleHints(claims)) {
            collected.add(hint);
          }
        } else {
          const headerToken = res.headers.get('x-auth-request-access-token');
          if (headerToken) {
            const claims = decodeJwtPayload(headerToken);
            for (const hint of collectRoleHints(claims)) {
              collected.add(hint);
            }
          }
        }
      } catch {
        // Ignore; endpoint is unavailable if oauth2-proxy isn't in path.
      }

      if (!cancelled) {
        setHints(collected);
        setLoading(false);
      }
    };

    load();
    const intervalId = window.setInterval(load, 5000);
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [identityApi]);

  const hasRole = useMemo(
    () => (role: string) => {
      const needle = role.toLowerCase();
      return hints.has(needle);
    },
    [hints],
  );

  const isArgocdAdmin = authzConfig.roleSets.argocdAdmin.some((role: string) => hasRole(role));
  const isOpenbaoAdmin = authzConfig.roleSets.openbaoAdmin.some((role: string) => hasRole(role));
  const isAgenciesAdmin = authzConfig.roleSets.agenciesAdmin.some((role: string) => hasRole(role));

  return {
    loading,
    hasRole,
    isAgenciesAdmin,
    isArgocdAdmin,
    isOpenbaoAdmin,
  };
}

export function useIsAgenciesAdmin() {
  const { loading, isAgenciesAdmin } = useRoleAccess();
  return { loading, isAgenciesAdmin };
}
