import { createChildLogger } from './logger.js';

const logger = createChildLogger('rate-limiter');

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(
    private name: string,
    requestsPerSecond: number
  ) {
    this.maxTokens = Math.max(1, requestsPerSecond);
    this.tokens = this.maxTokens;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      logger.debug({ name: this.name, tokens: this.tokens }, 'Token acquired');
      return;
    }

    // Calculate wait time for next token
    const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
    logger.debug({ name: this.name, waitTime }, 'Rate limited, waiting');

    await this.sleep(waitTime);
    this.refill();
    this.tokens -= 1;
  }

  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class RateLimiterRegistry {
  private limiters = new Map<string, RateLimiter>();

  get(name: string, requestsPerSecond: number): RateLimiter {
    const existing = this.limiters.get(name);
    if (existing) {
      return existing;
    }

    const limiter = new RateLimiter(name, requestsPerSecond);
    this.limiters.set(name, limiter);
    return limiter;
  }

  remove(name: string): void {
    this.limiters.delete(name);
  }

  clear(): void {
    this.limiters.clear();
  }
}

export const rateLimiterRegistry = new RateLimiterRegistry();
