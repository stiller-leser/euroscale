import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  ScmAuth,
} from '@backstage/integration-react';
import {
  AnyApiFactory,
  configApiRef,
  createApiFactory,
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import { ArgoCDApiClient, argoCDApiRef } from '@roadiehq/backstage-plugin-argo-cd';
import {
  type VaultApi,
  type VaultSecret,
  vaultApiRef,
} from '@backstage-community/plugin-vault';

function trimSlashes(input: string): string {
  return String(input).replace(/^\/+|\/+$/g, '');
}

function encodeVaultPath(path: string): string {
  return trimSlashes(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function defaultOpenbaoUiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const currentUrl = new URL(window.location.origin);
    if (currentUrl.hostname.startsWith('backstage.')) {
      currentUrl.hostname = currentUrl.hostname.replace(
        /^backstage\./,
        'openbao.',
      );
    }
    return currentUrl.origin;
  } catch {
    return '';
  }
}

class ProxyVaultApi implements VaultApi {
  constructor(
    private readonly fetchApi: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
    private readonly configApi: { getOptionalString: (key: string) => string | undefined },
  ) {}

  async listSecrets(
    secretPath: string,
    options?: { secretEngine?: string },
  ): Promise<VaultSecret[]> {
    const requestedPath = trimSlashes(secretPath);
    const secretEngine = trimSlashes(
      options?.secretEngine ??
        this.configApi.getOptionalString('vault.secretEngine') ??
        'euroscale',
    );
    const pathWithoutEnginePrefix =
      requestedPath === secretEngine
        ? ''
        : requestedPath.startsWith(`${secretEngine}/`)
          ? requestedPath.slice(secretEngine.length + 1)
          : requestedPath;
    const metadataPath = encodeVaultPath(pathWithoutEnginePrefix);
    const metadataPathSuffix = metadataPath ? `/${metadataPath}` : '';

    const response = await this.fetchApi.fetch(
      `/api/proxy/openbao/v1/${encodeVaultPath(secretEngine)}/metadata${metadataPathSuffix}?list=true`,
      { credentials: 'include' },
    );

    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Vault secrets for "${requestedPath}" (HTTP ${response.status})`,
      );
    }

    const payload = (await response.json()) as {
      data?: { keys?: string[] };
    };
    const keys = payload?.data?.keys ?? [];

    const openbaoUiBaseUrl =
      this.configApi.getOptionalString('vault.uiBaseUrl') ??
      defaultOpenbaoUiBaseUrl();

    return keys.map(rawKey => {
      const name = String(rawKey).replace(/\/+$/g, '');
      const fullPath = pathWithoutEnginePrefix
        ? `${pathWithoutEnginePrefix}/${name}`
        : name;
      const uiPath = encodeVaultPath(fullPath);
      const showUrl = openbaoUiBaseUrl
        ? `${openbaoUiBaseUrl}/ui/vault/secrets/${secretEngine}/show/${uiPath}`
        : '#';
      const editUrl = openbaoUiBaseUrl
        ? `${openbaoUiBaseUrl}/ui/vault/secrets/${secretEngine}/edit/${uiPath}`
        : '#';

      return {
        name,
        path: requestedPath,
        showUrl,
        editUrl,
      };
    });
  }
}

export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: scmIntegrationsApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => ScmIntegrationsApi.fromConfig(configApi),
  }),
  createApiFactory({
    api: argoCDApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      identityApi: identityApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, identityApi, configApi }) =>
      new ArgoCDApiClient({
        discoveryApi,
        identityApi,
        backendBaseUrl: configApi.getString('backend.baseUrl'),
        searchInstances: false,
        useNamespacedApps: true,
      }),
  }),
  createApiFactory({
    api: vaultApiRef,
    deps: {
      fetchApi: fetchApiRef,
      configApi: configApiRef,
    },
    factory: ({ fetchApi, configApi }) => new ProxyVaultApi(fetchApi, configApi),
  }),
  ScmAuth.createDefaultApiFactory(),
];
