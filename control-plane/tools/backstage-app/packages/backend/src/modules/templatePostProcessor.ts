import {
  coreServices,
  createBackendModule,
  type LoggerService,
} from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { Config } from '@backstage/config';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import type { CatalogProcessor } from '@backstage/plugin-catalog-node';

type JsonObject = Record<string, unknown>;

type TemplateMatchRule = {
  kind?: string;
  apiVersion?: string;
  sourceLabel?: string;
  specType?: string;
  specTypeRegex?: string;
  nameRegex?: string;
  annotationPresent?: string[];
  annotationEquals?: Record<string, string>;
  tagIncludes?: string[];
};

type TemplateProfile = {
  removeParameterGroups: string[];
  removeRequired: string[];
  removeProperties: string[];
  defaults: Record<string, unknown>;
};

type TemplateRule = {
  profile: string;
  match: TemplateMatchRule;
};

type ProcessorSettings = {
  enabled: boolean;
  profiles: Map<string, TemplateProfile>;
  rules: TemplateRule[];
};

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => String(item ?? '').trim())
    .filter(Boolean);
}

function toStringRecord(value: unknown): Record<string, string> {
  const record = asObject(value);
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const parsed = String(rawValue ?? '').trim();
    if (parsed) {
      result[key] = parsed;
    }
  }
  return result;
}

function toUnknownRecord(value: unknown): Record<string, unknown> {
  return asObject(value);
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function toRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function sanitizeRegexPattern(pattern: string): string {
  return pattern
    .replaceAll('[[:space:]]', '\\s')
    .replaceAll('[[:digit:]]', '\\d')
    .replaceAll('[[:word:]]', '\\w')
    .replaceAll('[[:alpha:]]', 'A-Za-z');
}

function sanitizeTemplateRegexes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeTemplateRegexes(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: JsonObject = {};
  for (const [key, inner] of Object.entries(value as JsonObject)) {
    if (key === 'pattern' && typeof inner === 'string') {
      output[key] = sanitizeRegexPattern(inner);
      continue;
    }
    output[key] = sanitizeTemplateRegexes(inner);
  }
  return output;
}

function readSettings(config: Config, logger: LoggerService): ProcessorSettings {
  const section = config.getOptionalConfig('templatePostProcessor');
  if (!section) {
    return {
      enabled: false,
      profiles: new Map(),
      rules: [],
    };
  }

  const enabled = section.getOptionalBoolean('enabled') ?? false;
  const profiles = new Map<string, TemplateProfile>();
  const profileSection = section.getOptionalConfig('profiles');

  if (profileSection) {
    for (const profileName of profileSection.keys()) {
      const profileConfig = profileSection.getOptionalConfig(profileName);
      if (!profileConfig) {
        continue;
      }

      profiles.set(profileName, {
        removeParameterGroups: toStringArray(
          profileConfig.getOptional('removeParameterGroups'),
        ),
        removeRequired: toStringArray(profileConfig.getOptional('removeRequired')),
        removeProperties: toStringArray(profileConfig.getOptional('removeProperties')),
        defaults: toUnknownRecord(profileConfig.getOptional('defaults')),
      });
    }
  }

  const rules: TemplateRule[] = [];
  for (const ruleConfig of section.getOptionalConfigArray('rules') ?? []) {
    const profile = ruleConfig.getOptionalString('profile');
    if (!profile) {
      continue;
    }

    const matchConfig = ruleConfig.getOptionalConfig('match');
    const match: TemplateMatchRule = matchConfig
      ? {
          kind: matchConfig.getOptionalString('kind'),
          apiVersion: matchConfig.getOptionalString('apiVersion'),
          sourceLabel: matchConfig.getOptionalString('sourceLabel'),
          specType: matchConfig.getOptionalString('specType'),
          specTypeRegex: matchConfig.getOptionalString('specTypeRegex'),
          nameRegex: matchConfig.getOptionalString('nameRegex'),
          annotationPresent: toStringArray(
            matchConfig.getOptional('annotationPresent'),
          ),
          annotationEquals: toStringRecord(
            matchConfig.getOptional('annotationEquals'),
          ),
          tagIncludes: toStringArray(matchConfig.getOptional('tagIncludes')),
        }
      : {};

    if (!profiles.has(profile)) {
      logger.warn(
        `templatePostProcessor: rule references unknown profile '${profile}', skipping`,
      );
      continue;
    }

    rules.push({ profile, match });
  }

  return { enabled, profiles, rules };
}

class TemplatePostProcessor implements CatalogProcessor {
  private readonly settings: ProcessorSettings;

  constructor(config: Config, logger: LoggerService) {
    this.settings = readSettings(config, logger);
  }

  getProcessorName(): string {
    return 'TemplatePostProcessor';
  }

  getPriority(): number {
    return 100;
  }

  async postProcessEntity(
    entity: Entity,
    _location: any,
    _emit: any,
    _cache: any,
  ): Promise<Entity> {
    if (entity.kind !== 'Template') {
      return entity;
    }

    let currentEntity = sanitizeTemplateRegexes(entity) as Entity;
    if (!this.settings.enabled || !this.settings.rules.length) {
      return currentEntity;
    }

    for (const rule of this.settings.rules) {
      if (!this.matches(currentEntity, rule.match)) {
        continue;
      }

      const profile = this.settings.profiles.get(rule.profile);
      if (!profile) {
        continue;
      }
      currentEntity = this.applyProfile(currentEntity, profile);
    }

    return currentEntity;
  }

  private matches(entity: Entity, match: TemplateMatchRule): boolean {
    if (match.kind && normalize(entity.kind) !== normalize(match.kind)) {
      return false;
    }
    if (
      match.apiVersion &&
      normalize(entity.apiVersion) !== normalize(match.apiVersion)
    ) {
      return false;
    }

    const metadata = asObject(entity.metadata);
    const labels = asObject(metadata.labels);
    const annotations = asObject(metadata.annotations);
    const tags = toStringArray(metadata.tags);
    const spec = asObject((entity as JsonObject).spec);

    if (
      match.sourceLabel &&
      normalize(labels.source) !== normalize(match.sourceLabel)
    ) {
      return false;
    }
    if (match.specType && normalize(spec.type) !== normalize(match.specType)) {
      return false;
    }

    if (match.specTypeRegex) {
      const regex = toRegExp(match.specTypeRegex);
      if (!regex || !regex.test(String(spec.type ?? ''))) {
        return false;
      }
    }

    if (match.nameRegex) {
      const regex = toRegExp(match.nameRegex);
      if (!regex || !regex.test(String(metadata.name ?? ''))) {
        return false;
      }
    }

    for (const key of match.annotationPresent ?? []) {
      if (!(key in annotations)) {
        return false;
      }
    }

    for (const [key, value] of Object.entries(match.annotationEquals ?? {})) {
      if (normalize(annotations[key]) !== normalize(value)) {
        return false;
      }
    }

    for (const tag of match.tagIncludes ?? []) {
      const expected = normalize(tag);
      const found = tags.some(actual => normalize(actual) === expected);
      if (!found) {
        return false;
      }
    }

    return true;
  }

  private applyProfile(entity: Entity, profile: TemplateProfile): Entity {
    const template = JSON.parse(JSON.stringify(entity)) as Entity;
    const spec = asObject((template as JsonObject).spec);
    const rawParameters = spec.parameters;
    if (!Array.isArray(rawParameters)) {
      return template;
    }

    const hiddenGroupTitles = new Set(
      profile.removeParameterGroups.map(value => normalize(value)),
    );
    const removeRequired = new Set(profile.removeRequired.map(value => normalize(value)));
    const removeProperties = new Set(
      profile.removeProperties.map(value => normalize(value)),
    );

    const parameters = rawParameters
      .filter(item => {
        const group = asObject(item);
        if (!hiddenGroupTitles.size) {
          return true;
        }
        const title = normalize(group.title);
        return !hiddenGroupTitles.has(title);
      })
      .map(item => {
        const group = JSON.parse(JSON.stringify(item)) as JsonObject;
        const required = toStringArray(group.required);
        const properties = asObject(group.properties);

        if (removeRequired.size > 0) {
          group.required = required.filter(
            key => !removeRequired.has(normalize(key)),
          );
        }

        if (removeProperties.size > 0) {
          for (const propertyName of Object.keys(properties)) {
            if (removeProperties.has(normalize(propertyName))) {
              delete properties[propertyName];
            }
          }
          group.properties = properties;
        }

        if (Object.keys(profile.defaults).length > 0) {
          for (const [propertyName, defaultValue] of Object.entries(profile.defaults)) {
            const propertySchema = asObject(properties[propertyName]);
            if (!Object.keys(propertySchema).length) {
              continue;
            }
            propertySchema.default = defaultValue;
            properties[propertyName] = propertySchema;
          }
          group.properties = properties;
        }

        return group;
      });

    spec.parameters = parameters;
    (template as JsonObject).spec = spec;
    return template;
  }
}

export default createBackendModule({
  pluginId: 'catalog',
  moduleId: 'template-post-processor',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ catalog, config, logger }) {
        catalog.addProcessor(new TemplatePostProcessor(config, logger));
      },
    });
  },
});
