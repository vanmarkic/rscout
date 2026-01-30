import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type Config } from './schema.js';
import { ConfigError } from '../utils/errors.js';

function expandEnvVariables(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
      return process.env[envVar] ?? '';
    });
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVariables);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = expandEnvVariables(val);
    }
    return result;
  }
  return value;
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const paths = configPath
    ? [configPath]
    : [
        './config/local.yaml',
        './config/default.yaml',
        './rscout.yaml',
        './rscout.yml',
      ];

  let configData: unknown = {};
  let loadedPath: string | null = null;

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = await readFile(path, 'utf-8');
        configData = parseYaml(content);
        loadedPath = path;
        break;
      } catch (error) {
        throw new ConfigError(`Failed to parse config file: ${path}`, { cause: error });
      }
    }
  }

  // Expand environment variables
  const expandedConfig = expandEnvVariables(configData);

  // Validate with Zod
  const result = ConfigSchema.safeParse(expandedConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new ConfigError(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

export function mergeConfigWithCLI(
  config: Config,
  cliOptions: Partial<{
    providers: string[];
    limit: number;
    timeout: number;
    output: string;
    format: 'markdown' | 'json';
  }>
): Config {
  const merged = { ...config };

  if (cliOptions.providers) {
    const enabledProviders = new Set(cliOptions.providers);
    merged.providers = {
      brave: {
        ...config.providers.brave,
        enabled: enabledProviders.has('brave') && !!config.providers.brave.apiKey,
      },
      duckduckgo: {
        ...config.providers.duckduckgo,
        enabled: enabledProviders.has('duckduckgo'),
      },
      rss: {
        ...config.providers.rss,
        enabled: enabledProviders.has('rss'),
      },
      serp: {
        ...config.providers.serp,
        enabled: enabledProviders.has('serp') && !!config.providers.serp.apiKey,
      },
    };
  }

  if (cliOptions.limit !== undefined) {
    merged.search = { ...merged.search, defaultLimit: cliOptions.limit };
  }

  if (cliOptions.timeout !== undefined) {
    merged.search = { ...merged.search, timeout: cliOptions.timeout };
  }

  if (cliOptions.output !== undefined) {
    merged.output = { ...merged.output, directory: cliOptions.output };
  }

  if (cliOptions.format !== undefined) {
    merged.output = { ...merged.output, format: cliOptions.format };
  }

  return merged;
}
