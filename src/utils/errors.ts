import type { ProviderName } from '../providers/types.js';

export class RscoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RscoutError';
  }
}

export class ConfigError extends RscoutError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export class ProviderError extends RscoutError {
  public readonly provider: ProviderName;
  public readonly statusCode?: number;

  constructor(
    provider: ProviderName,
    message: string,
    statusCode?: number,
    options?: ErrorOptions
  ) {
    super(`[${provider}] ${message}`, options);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export class OutputError extends RscoutError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OutputError';
  }
}

export class CacheError extends RscoutError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CacheError';
  }
}
