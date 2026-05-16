import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { proxyEndpointsExtensionPoint } from '@backstage/plugin-proxy-node/alpha';
import { readFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

type OpenBaoLoginResponse = {
  auth?: {
    client_token?: string;
    lease_duration?: number;
  };
};

type CredentialProvider = {
  type: 'kubernetes' | 'spire';
  mountPath: string;
  role: string;
  getJWT(): Promise<string>;
};

function createCredentialProvider(config: {
  authMountPath: string;
  role: string;
  serviceAccountTokenFile: string;
  spireSocketPath?: string;
  spireJWTPath?: string;
}): CredentialProvider {
  if (config.authMountPath === 'spire' || config.spireSocketPath) {
    const jwtPath = config.spireJWTPath || '/var/run/secrets/spiffe/jwt-svid.token';
    return {
      type: 'spire',
      mountPath: 'spire',
      role: config.role,
      getJWT: async () => {
        try {
          const jwt = (await readFile(jwtPath, 'utf8')).trim();
          if (jwt) return jwt;
        } catch {
          // File not found, fall through to socket
        }
        if (config.spireSocketPath) {
          const { stdout } = await execAsync(
            `spire-agent api fetch jwt -audience openbao -socketPath ${config.spireSocketPath} -output json`,
          );
          const parsed = JSON.parse(stdout);
          return parsed.svid || parsed.token || parsed.jwt;
        }
        throw new Error('No SPIRE JWT SVID available');
      },
    };
  }
  return {
    type: 'kubernetes',
    mountPath: config.authMountPath || 'kubernetes',
    role: config.role,
    getJWT: async () => {
      const jwt = (await readFile(config.serviceAccountTokenFile, 'utf8')).trim();
      if (!jwt) {
        throw new Error(
          `service account token file ${config.serviceAccountTokenFile} is empty`,
        );
      }
      return jwt;
    },
  };
}

class OpenBaoTokenManager {
  private token?: string;
  private expiresAtMs = 0;
  private refreshInFlight?: Promise<void>;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly options: {
      openbaoBaseUrl: string;
      credentialProvider: CredentialProvider;
      refreshSkewMs: number;
      fallbackTtlMs: number;
    },
    private readonly logger: { debug: (message: string) => void; warn: (message: string, meta?: Error) => void },
  ) {}

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async start(): Promise<void> {
    await this.refreshIfNeeded(true);
    this.refreshTimer = setInterval(() => {
      void this.refreshIfNeeded(false);
    }, 30_000);
    this.refreshTimer.unref();
  }

  getToken(): string | undefined {
    if (this.shouldRefreshSoon()) {
      void this.refreshIfNeeded(false);
    }
    return this.token;
  }

  private shouldRefreshSoon(): boolean {
    if (!this.token) {
      return true;
    }
    return Date.now() + this.options.refreshSkewMs >= this.expiresAtMs;
  }

  private async refreshIfNeeded(force: boolean): Promise<void> {
    if (!force && !this.shouldRefreshSoon()) {
      return;
    }
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }

    this.refreshInFlight = this.refreshToken().finally(() => {
      this.refreshInFlight = undefined;
    });
    await this.refreshInFlight;
  }

  private async refreshToken(): Promise<void> {
    try {
      const jwt = await this.options.credentialProvider.getJWT();

      const mountPath = this.options.credentialProvider.mountPath.replace(/^\/+|\/+$/g, '');
      const loginUrl = `${this.options.openbaoBaseUrl.replace(
        /\/+$/g,
        '',
      )}/v1/auth/${mountPath}/login`;
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: this.options.credentialProvider.role,
          jwt,
        }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(
          `OpenBao ${this.options.credentialProvider.type} auth login failed (${response.status}): ${responseText}`,
        );
      }

      const payload = (await response.json()) as OpenBaoLoginResponse;
      const clientToken = payload.auth?.client_token?.trim();
      if (!clientToken) {
        throw new Error(
          `OpenBao ${this.options.credentialProvider.type} auth login returned an empty client token`,
        );
      }

      const leaseDurationSec = Number(payload.auth?.lease_duration ?? 0);
      const tokenTtlMs =
        leaseDurationSec > 0
          ? leaseDurationSec * 1000
          : this.options.fallbackTtlMs;

      this.token = clientToken;
      this.expiresAtMs = Date.now() + tokenTtlMs;
      this.logger.debug(
        `Refreshed OpenBao runtime token via ${this.options.credentialProvider.type} (ttl=${Math.round(tokenTtlMs / 1000)}s)`,
      );
    } catch (error) {
      const errorObject =
        error instanceof Error ? error : new Error(String(error));
      this.logger.warn('Failed to refresh OpenBao runtime token', errorObject);
    }
  }
}

export const openbaoProxyModule = createBackendModule({
  pluginId: 'proxy',
  moduleId: 'openbao-runtime-auth',
  register(reg) {
    reg.registerInit({
      deps: {
        proxy: proxyEndpointsExtensionPoint,
        config: coreServices.rootConfig,
        lifecycle: coreServices.lifecycle,
        logger: coreServices.logger,
      },
      async init({ proxy, config, lifecycle, logger }) {
        const openbaoBaseUrl =
          config.getOptionalString('vault.host') ??
          'http://openbao.openbao.svc.cluster.local:8200';
        const authMountPath =
          config.getOptionalString('openbaoRuntimeAuth.mountPath') ??
          'kubernetes';
        const serviceAccountTokenFile =
          config.getOptionalString(
            'openbaoRuntimeAuth.serviceAccountTokenFile',
          ) ?? '/var/run/secrets/kubernetes.io/serviceaccount/token';
        const spireSocketPath =
          config.getOptionalString('openbaoRuntimeAuth.spireSocketPath') ?? '';
        const spireJWTPath =
          config.getOptionalString('openbaoRuntimeAuth.spireJWTPath') ?? '';
        const refreshSkewSeconds =
          config.getOptionalNumber('openbaoRuntimeAuth.refreshSkewSeconds') ??
          60;
        const fallbackTtlSeconds =
          config.getOptionalNumber(
            'openbaoRuntimeAuth.fallbackTokenTtlSeconds',
          ) ?? 900;

        const role =
          config.getOptionalString('openbaoRuntimeAuth.role') ?? 'backstage';

        const credentialProvider = createCredentialProvider({
          authMountPath,
          role,
          serviceAccountTokenFile,
          spireSocketPath: spireSocketPath || undefined,
          spireJWTPath: spireJWTPath || undefined,
        });

        const tokenManager = new OpenBaoTokenManager(
          {
            openbaoBaseUrl,
            credentialProvider,
            refreshSkewMs: refreshSkewSeconds * 1000,
            fallbackTtlMs: fallbackTtlSeconds * 1000,
          },
          logger,
        );

        await tokenManager.start();
        lifecycle.addShutdownHook(async () => {
          tokenManager.stop();
        });

        proxy.addProxyEndpoints({
          '/openbao': {
            target: openbaoBaseUrl,
            changeOrigin: true,
            credentials: 'require',
            onProxyReq(proxyReq) {
              const token = tokenManager.getToken();
              if (!token) {
                logger.warn(
                  'OpenBao runtime token unavailable; forwarding request without X-Vault-Token header',
                );
                return;
              }
              proxyReq.setHeader('X-Vault-Token', token);
            },
          },
        });
      },
    });
  },
});

export default openbaoProxyModule;
