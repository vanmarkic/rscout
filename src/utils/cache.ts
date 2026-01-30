import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { createChildLogger } from './logger.js';

const logger = createChildLogger('cache');

interface CacheEntry<T> {
  timestamp: number;
  value: T;
}

export class FileCache {
  constructor(
    private cacheDir: string,
    private ttlMs: number = 3600000 // 1 hour default
  ) {}

  private keyToPath(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
    return join(this.cacheDir, `${hash}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const path = this.keyToPath(key);
      const content = await readFile(path, 'utf-8');
      const data: CacheEntry<T> = JSON.parse(content);

      if (Date.now() - data.timestamp > this.ttlMs) {
        logger.debug({ key }, 'Cache entry expired');
        return null;
      }

      logger.debug({ key }, 'Cache hit');
      return data.value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ key, error }, 'Cache read error');
      }
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      const path = this.keyToPath(key);
      const data: CacheEntry<T> = {
        timestamp: Date.now(),
        value,
      };
      await writeFile(path, JSON.stringify(data));
      logger.debug({ key }, 'Cache set');
    } catch (error) {
      logger.warn({ key, error }, 'Cache write error');
    }
  }

  async clear(): Promise<void> {
    try {
      const files = await readdir(this.cacheDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map((f) => unlink(join(this.cacheDir, f)))
      );
      logger.info('Cache cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ error }, 'Cache clear error');
      }
    }
  }

  async prune(): Promise<number> {
    let pruned = 0;
    try {
      const files = await readdir(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const path = join(this.cacheDir, file);
        try {
          const content = await readFile(path, 'utf-8');
          const data: CacheEntry<unknown> = JSON.parse(content);

          if (now - data.timestamp > this.ttlMs) {
            await unlink(path);
            pruned++;
          }
        } catch {
          // Remove corrupted cache files
          await unlink(path);
          pruned++;
        }
      }

      if (pruned > 0) {
        logger.info({ pruned }, 'Cache entries pruned');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ error }, 'Cache prune error');
      }
    }

    return pruned;
  }

  async stats(): Promise<{ entries: number; sizeBytes: number }> {
    try {
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      let sizeBytes = 0;
      for (const file of jsonFiles) {
        const fileStat = await stat(join(this.cacheDir, file));
        sizeBytes += fileStat.size;
      }

      return { entries: jsonFiles.length, sizeBytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: 0, sizeBytes: 0 };
      }
      throw error;
    }
  }
}
