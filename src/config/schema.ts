import { z } from 'zod';

export const ProviderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  rateLimit: z.number().positive().default(1),
});

export const BraveConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
  rateLimit: z.number().positive().default(1),
});

export const DuckDuckGoConfigSchema = ProviderConfigSchema;

export const RSSConfigSchema = ProviderConfigSchema.extend({
  feeds: z.array(z.string().url()).default([]),
});

export const SerpConfigSchema = ProviderConfigSchema.extend({
  apiKey: z.string().optional(),
});

export const ProvidersConfigSchema = z.object({
  brave: BraveConfigSchema.optional().default({ enabled: false, rateLimit: 1 }),
  duckduckgo: DuckDuckGoConfigSchema.optional().default({ enabled: true, rateLimit: 0.5 }),
  rss: RSSConfigSchema.optional().default({ enabled: true, rateLimit: 1, feeds: [] }),
  serp: SerpConfigSchema.optional().default({ enabled: false, rateLimit: 1 }),
});

export const SearchConfigSchema = z.object({
  defaultLimit: z.number().int().positive().default(20),
  timeout: z.number().int().positive().default(10000),
  retries: z.number().int().nonnegative().default(2),
});

export const ScoringWeightsSchema = z.object({
  recency: z.number().min(0).max(1).default(0.3),
  domainAuthority: z.number().min(0).max(1).default(0.2),
  keywordRelevance: z.number().min(0).max(1).default(0.5),
});

export const ScoringConfigSchema = z.object({
  weights: ScoringWeightsSchema.default({}),
  trustedDomains: z.array(z.string()).default([
    'wikipedia.org',
    'github.com',
    'developer.mozilla.org',
    'stackoverflow.com',
  ]),
});

export const DeduplicationConfigSchema = z.object({
  urlNormalization: z.boolean().default(true),
  contentFingerprint: z.boolean().default(true),
  similarityThreshold: z.number().min(0).max(1).default(0.85),
});

export const ObsidianConfigSchema = z.object({
  vault: z.string().optional(),
  folder: z.string().default('Resources/Aggregated'),
  tags: z.array(z.string()).default(['rscout', 'auto-aggregated']),
  frontmatter: z.boolean().default(true),
});

export const OutputConfigSchema = z.object({
  format: z.enum(['markdown', 'json']).default('markdown'),
  directory: z.string().default('./output'),
  template: z.string().default('obsidian'),
  obsidian: ObsidianConfigSchema.default({}),
});

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().default('./.rscout-cache'),
  ttlMs: z.number().int().positive().default(3600000), // 1 hour
});

export const ConfigSchema = z.object({
  providers: ProvidersConfigSchema.default({}),
  search: SearchConfigSchema.default({}),
  scoring: ScoringConfigSchema.default({}),
  deduplication: DeduplicationConfigSchema.default({}),
  output: OutputConfigSchema.default({}),
  cache: CacheConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;
export type DeduplicationConfig = z.infer<typeof DeduplicationConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type ObsidianConfig = z.infer<typeof ObsidianConfigSchema>;
