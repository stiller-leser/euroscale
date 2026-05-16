import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';
import * as k8s from '@kubernetes/client-node';
import fs from 'node:fs/promises';
import path from 'node:path';

type JsonMap = Record<string, unknown>;

function asObject(value: unknown): JsonMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonMap;
}

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'resource';
}

function deleteByPath(target: JsonMap, dottedPath: string): void {
  const parts = dottedPath.split('.').map(p => p.trim()).filter(Boolean);
  if (!parts.length) {
    return;
  }

  let cursor: unknown = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return;
    }
    cursor = (cursor as JsonMap)[key];
  }

  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    return;
  }
  delete (cursor as JsonMap)[parts[parts.length - 1]];
}

function pruneEmptyValues(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value;
  }

  if (Array.isArray(value)) {
    const prunedArray = value
      .map(item => pruneEmptyValues(item))
      .filter(item => item !== undefined);
    return prunedArray.length ? prunedArray : undefined;
  }

  if (typeof value === 'object') {
    const obj = value as JsonMap;
    const prunedObject: JsonMap = {};
    for (const [key, inner] of Object.entries(obj)) {
      const prunedInner = pruneEmptyValues(inner);
      if (prunedInner !== undefined) {
        prunedObject[key] = prunedInner;
      }
    }
    return Object.keys(prunedObject).length ? prunedObject : undefined;
  }

  return value;
}

function flattenCrossplaneFields(spec: JsonMap): void {
  const crossplane = asObject(spec.crossplane);
  if (!Object.keys(crossplane).length) {
    delete spec.crossplane;
    return;
  }

  const compositionUpdatePolicy = crossplane.compositionUpdatePolicy;
  if (typeof compositionUpdatePolicy === 'string' && compositionUpdatePolicy) {
    spec.compositionUpdatePolicy = compositionUpdatePolicy;
  }

  const compositeDeletePolicy = crossplane.compositeDeletePolicy;
  if (typeof compositeDeletePolicy === 'string' && compositeDeletePolicy) {
    spec.compositeDeletePolicy = compositeDeletePolicy;
  }

  const writeConnectionSecretToRef = asObject(crossplane.writeConnectionSecretToRef);
  if (Object.keys(writeConnectionSecretToRef).length) {
    spec.writeConnectionSecretToRef = writeConnectionSecretToRef;
  }

  const selectionStrategy = crossplane.compositionSelectionStrategy;
  const compositionRef = asObject(crossplane.compositionRef);
  const compositionSelector = asObject(crossplane.compositionSelector);

  if (selectionStrategy === 'direct-reference' && Object.keys(compositionRef).length) {
    spec.compositionRef = compositionRef;
  }
  if (selectionStrategy === 'label-selector' && Object.keys(compositionSelector).length) {
    spec.compositionSelector = compositionSelector;
  }

  delete spec.crossplane;
}

function normalizeAgencyStackSpec(kind: string, spec: JsonMap): void {
  const normalizedKind = kind.trim().toLowerCase();
  if (normalizedKind !== 'agencystackclaim' && normalizedKind !== 'agencystack') {
    return;
  }

  const cluster = asObject(spec.cluster);
  const target = asObject(cluster.target);

  const legacyClusterClass =
    typeof spec.clusterClass === 'string' ? spec.clusterClass.trim() : '';
  const nestedClusterClass =
    typeof cluster.class === 'string' ? String(cluster.class).trim() : '';
  const effectiveClass = nestedClusterClass || legacyClusterClass || 'local-vcluster';

  cluster.class = effectiveClass;

  const targetClusterName =
    typeof target.argocdClusterName === 'string'
      ? target.argocdClusterName.trim()
      : '';
  target.argocdClusterName = targetClusterName || 'in-cluster';

  const targetNamespace =
    typeof target.namespace === 'string' ? target.namespace.trim() : '';
  target.namespace = targetNamespace || 'argocd';

  cluster.target = target;
  spec.cluster = cluster;
  delete spec.clusterClass;
}

function normalizeCustomerStackSpec(kind: string, spec: JsonMap): void {
  const normalizedKind = kind.trim().toLowerCase();
  if (normalizedKind !== 'customerstackclaim' && normalizedKind !== 'customerstack') {
    return;
  }

  const agencyFromRuntime = String(process.env.BACKSTAGE_AGENCY_NAME ?? '')
    .trim()
    .toLowerCase();
  const agencyFromSpec =
    typeof spec.agencyName === 'string' ? spec.agencyName.trim().toLowerCase() : '';
  const effectiveAgency = agencyFromRuntime || agencyFromSpec;
  if (!effectiveAgency) {
    throw new Error(
      "Missing required field 'agencyName' for CustomerStack and BACKSTAGE_AGENCY_NAME is not set",
    );
  }

  // Force tenant scoping when this action runs in an agency Backstage instance.
  spec.agencyName = effectiveAgency;

  const cluster = asObject(spec.cluster);
  const target = asObject(cluster.target);

  const clusterClass = typeof cluster.class === 'string' ? cluster.class.trim() : '';
  cluster.class = clusterClass || 'local-vcluster';

  const targetClusterName =
    typeof target.argocdClusterName === 'string'
      ? target.argocdClusterName.trim()
      : '';
  target.argocdClusterName = targetClusterName || 'in-cluster';

  const targetNamespace =
    typeof target.namespace === 'string' ? target.namespace.trim() : '';
  target.namespace = targetNamespace || 'argocd';

  cluster.target = target;
  spec.cluster = cluster;

  const kcp = asObject(spec.kcp);
  const workspacePath =
    typeof kcp.workspacePath === 'string' ? kcp.workspacePath.trim() : '';
  kcp.workspacePath = workspacePath || `root:agencies:${effectiveAgency}`;
  spec.kcp = kcp;

  const network = asObject(spec.network);
  const interconnect = asObject(network.interconnect);
  if (typeof interconnect.enabled !== 'boolean') {
    interconnect.enabled = false;
  }
  const mode = typeof interconnect.mode === 'string' ? interconnect.mode.trim() : '';
  interconnect.mode = mode || 'submariner';
  const cableDriver =
    typeof interconnect.cableDriver === 'string'
      ? interconnect.cableDriver.trim()
      : '';
  interconnect.cableDriver = cableDriver || 'wireguard';
  if (typeof interconnect.globalnet !== 'boolean') {
    interconnect.globalnet = false;
  }
  network.interconnect = interconnect;
  spec.network = network;
}

function buildManifest(input: {
  parameters: JsonMap;
  nameParam: string;
  namespaceParam?: string;
  ownerParam?: string;
  excludeParams?: string[];
  apiVersion: string;
  kind: string;
  removeEmptyParams?: boolean;
}): JsonMap {
  const parameters = JSON.parse(JSON.stringify(input.parameters ?? {})) as JsonMap;
  const name = String(parameters[input.nameParam] ?? '').trim();
  if (!name) {
    throw new Error(`Missing required parameter '${input.nameParam}'`);
  }

  const namespaceKey = String(input.namespaceParam ?? '').trim();
  const namespace = namespaceKey ? String(parameters[namespaceKey] ?? '').trim() : '';

  const spec = JSON.parse(JSON.stringify(parameters)) as JsonMap;
  const exclude = new Set(
    [
      input.nameParam,
      namespaceKey,
      input.ownerParam,
      'pushToGit',
      'applyToCluster',
      'manifestLayout',
      'basePath',
      'targetBranch',
      'repoUrl',
      'clusters',
      '_editData',
      ...(input.excludeParams ?? []),
    ].filter((value): value is string => Boolean(value)),
  );

  for (const key of exclude) {
    deleteByPath(spec, key);
  }

  flattenCrossplaneFields(spec);
  normalizeAgencyStackSpec(input.kind, spec);
  normalizeCustomerStackSpec(input.kind, spec);

  const manifest: JsonMap = {
    apiVersion: input.apiVersion,
    kind: input.kind,
    metadata: {
      name,
    },
    spec: input.removeEmptyParams ? pruneEmptyValues(spec) ?? {} : spec,
  };

  if (namespace) {
    (manifest.metadata as JsonMap).namespace = namespace;
  }

  return manifest;
}

function isClaimKind(kind: string): boolean {
  return kind.toLowerCase().endsWith('claim');
}

function ensureClaimNamespace(manifest: JsonMap): void {
  const kind = String(manifest.kind ?? '').trim();
  if (!kind || !isClaimKind(kind)) {
    return;
  }

  const metadata = asObject(manifest.metadata);
  const namespace = String(metadata.namespace ?? '').trim();
  if (!namespace) {
    metadata.namespace = 'default';
    manifest.metadata = metadata;
  }
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const typed = error as {
    statusCode?: number;
    body?: { code?: number };
    response?: { statusCode?: number };
  };

  return typed.statusCode ?? typed.body?.code ?? typed.response?.statusCode;
}

function loadKubeConfig(): k8s.KubeConfig {
  const kubeConfig = new k8s.KubeConfig();
  try {
    kubeConfig.loadFromCluster();
  } catch {
    kubeConfig.loadFromDefault();
  }
  return kubeConfig;
}

async function upsertManifest(
  kubeApi: k8s.KubernetesObjectApi,
  manifest: JsonMap,
): Promise<void> {
  const object = JSON.parse(JSON.stringify(manifest)) as k8s.KubernetesObject;
  object.metadata = object.metadata ?? {};

  try {
    await kubeApi.create(object);
    return;
  } catch (error) {
    if (statusCodeOf(error) !== 409) {
      throw error;
    }
  }

  const existingResponse = await (kubeApi as any).read(object);
  const existing = (existingResponse as any).body ?? existingResponse;
  const existingMetadata = asObject((existing as JsonMap).metadata);
  const resourceVersion = String(existingMetadata.resourceVersion ?? '').trim();
  if (!resourceVersion) {
    throw new Error('Unable to update manifest: missing resourceVersion on existing object');
  }

  const metadata = asObject(object.metadata);
  metadata.resourceVersion = resourceVersion;
  object.metadata = metadata;
  await (kubeApi as any).replace(object);
}

function isCustomerStackKind(kind: string): boolean {
  const normalizedKind = kind.trim().toLowerCase();
  return normalizedKind === 'customerstackclaim' || normalizedKind === 'customerstack';
}

function workspaceServer(baseServer: string, workspacePath: string): string {
  const root = baseServer.includes('/clusters/')
    ? baseServer.split('/clusters/')[0]
    : baseServer.replace(/\/+$/, '');
  return `${root}/clusters/${workspacePath.replace(/^\/+/, '')}`;
}

async function loadKcpWorkspaceKubeConfig(agencyName: string): Promise<k8s.KubeConfig> {
  const inCluster = loadKubeConfig();
  const coreApi = inCluster.makeApiClient(k8s.CoreV1Api);
  const secret = await coreApi.readNamespacedSecret({
    name: 'kcp-root-kubeconfig',
    namespace: 'crossplane-system',
  });
  const secretData = (secret.data ?? {}) as Record<string, string>;
  const encoded = secretData.kubeconfig;
  if (!encoded) {
    throw new Error(
      "Secret crossplane-system/kcp-root-kubeconfig does not contain key 'kubeconfig'",
    );
  }

  const kubeconfigText = Buffer.from(encoded, 'base64').toString('utf8');
  const kubeConfig = new k8s.KubeConfig();
  kubeConfig.loadFromString(kubeconfigText);

  if (!kubeConfig.clusters?.length) {
    throw new Error('KCP kubeconfig has no clusters');
  }

  const cluster = kubeConfig.clusters[0];
  const patchedCluster = {
    ...cluster,
    server: workspaceServer(cluster.server, `root:agencies:${agencyName}`),
  };
  (kubeConfig as any).clusters = [patchedCluster, ...kubeConfig.clusters.slice(1)];
  return kubeConfig;
}

async function applyManifestToCluster(manifest: JsonMap): Promise<void> {
  const kind = String(manifest.kind ?? '');
  const scopedAgency = String(process.env.BACKSTAGE_AGENCY_NAME ?? '')
    .trim()
    .toLowerCase();

  if (isCustomerStackKind(kind) && scopedAgency) {
    const kcpKubeConfig = await loadKcpWorkspaceKubeConfig(scopedAgency);
    const kcpApi = k8s.KubernetesObjectApi.makeApiClient(kcpKubeConfig);
    await upsertManifest(kcpApi, manifest);
    return;
  }

  const kubeConfig = loadKubeConfig();
  const kubeApi = k8s.KubernetesObjectApi.makeApiClient(kubeConfig);
  await upsertManifest(kubeApi, manifest);
}

function resolveManifestPaths(input: {
  parameters: JsonMap;
  kind: string;
  name: string;
  namespace?: string;
  clusters?: string[];
}): string[] {
  const parameters = asObject(input.parameters);
  const pushToGit = parameters.pushToGit === true;
  const manifestLayout = String(parameters.manifestLayout ?? '').trim();
  const kindDir = sanitizePathSegment(input.kind);
  const fileName = `${sanitizePathSegment(input.name)}.yaml`;

  if (pushToGit) {
    if (manifestLayout === 'cluster-scoped') {
      const clusters = (input.clusters ?? [])
        .map(cluster => cluster.trim())
        .filter(cluster => cluster.length > 0 && cluster !== 'temp');
      if (clusters.length > 0) {
        return clusters.map(cluster =>
          path.posix.join(sanitizePathSegment(cluster), kindDir, fileName),
        );
      }
    } else if (manifestLayout === 'namespace-scoped') {
      const namespace = sanitizePathSegment(input.namespace || 'default');
      return [path.posix.join(namespace, kindDir, fileName)];
    } else if (manifestLayout === 'custom') {
      const basePath = String(parameters.basePath ?? '').trim().replace(/^\/+/, '');
      if (basePath) {
        return [path.posix.join(basePath, kindDir, fileName)];
      }
    }
  }

  return [path.posix.join(kindDir, fileName)];
}

async function writeManifestFiles(
  workspacePath: string,
  filePaths: string[],
  manifestText: string,
): Promise<void> {
  for (const relPath of filePaths) {
    const normalizedRelPath = relPath.replace(/^\/+/, '');
    const absolutePath = path.join(workspacePath, normalizedRelPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, manifestText, 'utf8');
  }
}

function createTeraskyTemplateAction(input: {
  id: 'terasky:claim-template' | 'terasky:crd-template';
  description: string;
}) {
  return createTemplateAction({
    id: input.id,
    description: input.description,
    schema: {
      input: {
        parameters: z => z.record(z.any()),
        nameParam: z => z.string(),
        namespaceParam: z => z.string().optional(),
        ownerParam: z => z.string().optional(),
        excludeParams: z => z.array(z.string()).optional(),
        apiVersion: z => z.string(),
        kind: z => z.string(),
        clusters: z => z.array(z.string()).optional(),
        removeEmptyParams: z => z.boolean().optional(),
      },
      output: {
        manifestEncoded: z => z.string(),
        filePaths: z => z.array(z.string()),
        appliedToCluster: z => z.boolean(),
      },
    },
    async handler(ctx) {
      const manifest = buildManifest({
        parameters: ctx.input.parameters,
        nameParam: ctx.input.nameParam,
        namespaceParam: ctx.input.namespaceParam,
        ownerParam: ctx.input.ownerParam,
        excludeParams: ctx.input.excludeParams,
        apiVersion: ctx.input.apiVersion,
        kind: ctx.input.kind,
        removeEmptyParams: ctx.input.removeEmptyParams,
      });
      ensureClaimNamespace(manifest);

      const metadata = asObject(manifest.metadata);
      const name = String(metadata.name ?? '');
      const namespace = String(metadata.namespace ?? '');
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

      const filePaths = resolveManifestPaths({
        parameters: ctx.input.parameters,
        kind: ctx.input.kind,
        name,
        namespace,
        clusters: ctx.input.clusters,
      });

      await writeManifestFiles(ctx.workspacePath, filePaths, manifestText);

      const parameters = asObject(ctx.input.parameters);
      const pushToGit = parameters.pushToGit === true;
      const applyToCluster = parameters.applyToCluster !== false;
      const shouldApplyInCluster =
        input.id === 'terasky:claim-template' && !pushToGit && applyToCluster;

      if (shouldApplyInCluster) {
        await applyManifestToCluster(manifest);
      }

      ctx.output('manifestEncoded', Buffer.from(manifestText, 'utf8').toString('base64'));
      ctx.output('filePaths', filePaths);
      ctx.output('appliedToCluster', shouldApplyInCluster);
    },
  });
}

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'agency-actions',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolder }) {
        scaffolder.addActions(
          createTeraskyTemplateAction({
            id: 'terasky:claim-template',
            description: 'Generate a claim manifest from scaffolder parameters',
          }),
          createTeraskyTemplateAction({
            id: 'terasky:crd-template',
            description: 'Generate a CRD manifest from scaffolder parameters',
          }),
        );
      },
    });
  },
});
