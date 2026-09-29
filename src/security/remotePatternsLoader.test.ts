/**
 * Unit tests for Remote Patterns Loader (T1.8.3, M1.8, DEC-027).
 *
 * Test coverage:
 *  - Cache: read/write, TTL validation, fallback
 *  - Fetch: remote URL loading, timeout, error handling
 *  - Validation: pattern format validation
 *  - Integration: loader + filter integration
 */

import { RemotePatternsLoader, createRemotePatternsLoader } from './remotePatternsLoader';
import type { InjectionPattern } from './promptInjectionFilter';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RemotePatternsLoader', () => {
  let loader: RemotePatternsLoader;
  let testCachePath: string;
  let testRemoteUrl: string;

  beforeEach(() => {
    testCachePath = join(tmpdir(), `vsl-test-remote-cache-${Date.now()}.json`);
    testRemoteUrl = 'https://example.com/patterns.json';
    
    loader = new RemotePatternsLoader({
      remoteUrl: testRemoteUrl,
      cachePath: testCachePath,
      cacheTtlMs: 60000, // 1 minute for tests
      timeoutMs: 3000,
    });
  });

  afterEach(() => {
    // Очищаем тестовый кэш
    if (existsSync(testCachePath)) {
      try {
        unlinkSync(testCachePath);
      } catch {
        // Игнорируем ошибки очистки
      }
    }
  });

  describe('Cache operations', () => {
    it('should return empty when cache does not exist and fetch fails', async () => {
      // Mock fetch to fail
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await loader.load();

      expect(result.patterns).toHaveLength(0);
      expect(result.source).toBe('none');
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('Network error');
    });

    it('should use cache when TTL is valid', async () => {
      // Создаём валидный кэш
      const cachedPatterns: InjectionPattern[] = [
        {
          id: 'cached_001',
          pattern: 'cached pattern',
          type: 'regex',
          severity: 'high',
          action: 'strip',
          description: 'Cached test pattern',
        },
      ];

      const cacheData = {
        metadata: {
          lastFetched: new Date().toISOString(),
          sourceUrl: testRemoteUrl,
          patternCount: 1,
        },
        patterns: cachedPatterns,
      };

      writeFileSync(testCachePath, JSON.stringify(cacheData), 'utf-8');

      const result = await loader.load();

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]!.id).toBe('cached_001');
      expect(result.source).toBe('cache');
      expect(result.fallbackUsed).toBe(false);
    });

    it('should fetch remote when cache is expired', async () => {
      // Создаём expired кэш
      const expiredDate = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
      const cacheData = {
        metadata: {
          lastFetched: expiredDate,
          sourceUrl: testRemoteUrl,
          patternCount: 1,
        },
        patterns: [
          {
            id: 'old_cached',
            pattern: 'old pattern',
            type: 'regex',
            severity: 'low',
            action: 'log',
            description: 'Old cached pattern',
          },
        ],
      };

      writeFileSync(testCachePath, JSON.stringify(cacheData), 'utf-8');

      // Mock fetch to return new patterns
      const newPatterns: InjectionPattern[] = [
        {
          id: 'new_remote',
          pattern: 'new pattern',
          type: 'regex',
          severity: 'high',
          action: 'strip',
          description: 'New remote pattern',
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(newPatterns),
      });

      const result = await loader.load();

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]!.id).toBe('new_remote');
      expect(result.source).toBe('remote');
      expect(result.fallbackUsed).toBe(false);

      // Проверяем, что кэш обновлён
      expect(existsSync(testCachePath)).toBe(true);
    });

    it('should fallback to cache when fetch fails', async () => {
      // Создаём валидный кэш
      const cachedPatterns: InjectionPattern[] = [
        {
          id: 'fallback_001',
          pattern: 'fallback pattern',
          type: 'regex',
          severity: 'medium',
          action: 'log',
          description: 'Fallback pattern',
        },
      ];

      const cacheData = {
        metadata: {
          lastFetched: new Date(Date.now() - 120000).toISOString(), // Expired
          sourceUrl: testRemoteUrl,
          patternCount: 1,
        },
        patterns: cachedPatterns,
      };

      writeFileSync(testCachePath, JSON.stringify(cacheData), 'utf-8');

      // Mock fetch to fail
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await loader.load();

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]!.id).toBe('fallback_001');
      expect(result.source).toBe('cache');
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('Network error');
    });

    it('should clear cache', async () => {
      // Создаём кэш
      const cacheData = {
        metadata: {
          lastFetched: new Date().toISOString(),
          sourceUrl: testRemoteUrl,
          patternCount: 0,
        },
        patterns: [],
      };

      writeFileSync(testCachePath, JSON.stringify(cacheData), 'utf-8');
      expect(existsSync(testCachePath)).toBe(true);

      loader.clearCache();

      // Кэш должен быть очищен (файл существует, но пустой)
      const content = readFileSync(testCachePath, 'utf-8');
      expect(content).toBe('');
    });

    it('should get cache info', async () => {
      const cachedPatterns: InjectionPattern[] = [
        {
          id: 'info_001',
          pattern: 'info pattern',
          type: 'regex',
          severity: 'low',
          action: 'log',
          description: 'Info test pattern',
        },
      ];

      const cacheData = {
        metadata: {
          lastFetched: new Date().toISOString(),
          sourceUrl: testRemoteUrl,
          patternCount: 1,
        },
        patterns: cachedPatterns,
      };

      writeFileSync(testCachePath, JSON.stringify(cacheData), 'utf-8');

      const info = loader.getCacheInfo();

      expect(info.exists).toBe(true);
      expect(info.lastFetched).toBeDefined();
      expect(info.patternCount).toBe(1);
    });

    it('should return empty cache info when cache does not exist', () => {
      const info = loader.getCacheInfo();

      expect(info.exists).toBe(false);
      expect(info.lastFetched).toBeUndefined();
      expect(info.patternCount).toBeUndefined();
    });
  });

  describe('Fetch operations', () => {
    it('should fetch and validate remote patterns', async () => {
      const remotePatterns: InjectionPattern[] = [
        {
          id: 'remote_001',
          pattern: 'remote pattern',
          type: 'regex',
          severity: 'high',
          action: 'strip',
          description: 'Remote test pattern',
        },
        {
          id: 'remote_002',
          pattern: 'another remote',
          type: 'regex',
          severity: 'medium',
          action: 'log',
          description: 'Another remote pattern',
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(remotePatterns),
      });

      const result = await loader.load();

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0]!.id).toBe('remote_001');
      expect(result.patterns[1]!.id).toBe('remote_002');
      expect(result.source).toBe('remote');
    });

    it('should handle HTTP errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await loader.load();

      expect(result.patterns).toHaveLength(0);
      expect(result.source).toBe('none');
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('404');
    });

    it('should handle invalid JSON format', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalid: 'format' }),
      });

      const result = await loader.load();

      expect(result.patterns).toHaveLength(0);
      expect(result.source).toBe('none');
      expect(result.fallbackUsed).toBe(true);
    });

    it('should filter invalid patterns from remote response', async () => {
      const mixedData = [
        {
          id: 'valid_001',
          pattern: 'valid pattern',
          type: 'regex',
          severity: 'high',
          action: 'strip',
          description: 'Valid pattern',
        },
        {
          id: 'invalid_001',
          pattern: 'invalid',
          type: 'invalid_type', // Invalid type
          severity: 'high',
          action: 'strip',
          description: 'Invalid pattern',
        },
        {
          id: 'valid_002',
          pattern: 'another valid',
          type: 'regex',
          severity: 'medium',
          action: 'log',
          description: 'Another valid pattern',
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mixedData),
      });

      const result = await loader.load();

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0]!.id).toBe('valid_001');
      expect(result.patterns[1]!.id).toBe('valid_002');
    });
  });

  describe('Configuration', () => {
    it('should return empty when disabled', async () => {
      const disabledLoader = new RemotePatternsLoader({
        enabled: false,
        cachePath: testCachePath,
      });

      const result = await disabledLoader.load();

      expect(result.patterns).toHaveLength(0);
      expect(result.source).toBe('none');
      expect(result.fallbackUsed).toBe(false);
    });

    it('should get and set remote URL', () => {
      expect(loader.getRemoteUrl()).toBe(testRemoteUrl);

      loader.setRemoteUrl('https://new-url.com/patterns.json');
      expect(loader.getRemoteUrl()).toBe('https://new-url.com/patterns.json');
    });
  });

  describe('Factory function', () => {
    it('should create loader via factory function', () => {
      const factoryLoader = createRemotePatternsLoader({
        remoteUrl: 'https://factory.com/patterns.json',
        cachePath: testCachePath,
      });

      expect(factoryLoader).toBeInstanceOf(RemotePatternsLoader);
      expect(factoryLoader.getRemoteUrl()).toBe('https://factory.com/patterns.json');
    });

    it('should use default options when none provided', () => {
      const defaultLoader = createRemotePatternsLoader();

      expect(defaultLoader.getRemoteUrl()).toBe('https://raw.githubusercontent.com/MaxZhadobin/visual-scene-language/vsl_mcp/patterns/latest.json');
    });
  });
});