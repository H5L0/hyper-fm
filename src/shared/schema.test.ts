import { describe, expect, test } from 'vitest';
import { createDefaultConfig, validateConfig } from './schema.js';
import { CONFIG_SCHEMA_VERSION } from './types.js';

describe('schema', () => {
  test('[createDefaultConfig] 应返回带默认 ignore 与 ui 的空配置', () => {
    const config = createDefaultConfig();
    expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
    expect(config.scanRoots).toEqual([]);
    expect(config.projects).toEqual([]);
    expect(config.ignore.respectGitignore).toBe(true);
    expect(config.ui.theme).toBe('system');
  });

  test('[validateConfig] 缺失字段应回退默认值并不报致命错误', () => {
    const { config, errors } = validateConfig({});
    expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
    expect(config.scanRoots).toEqual([]);
    expect(config.ui.view).toBe('grid');
    expect(errors).toEqual([]);
  });

  test('[validateConfig] schema 版本过高应抛出', () => {
    expect(() => validateConfig({ version: 9999 })).toThrow(/schema/);
  });

  test('[validateConfig] 非对象根应抛出', () => {
    expect(() => validateConfig(null)).toThrow();
    expect(() => validateConfig([])).toThrow();
  });

  test('[validateConfig] 完整有效配置应原样保留', () => {
    const input = {
      version: 1,
      scanRoots: [{ id: 'root_1', path: 'D:/p', maxDepth: 2, enabled: true, label: '主' }],
      ignore: { respectGitignore: false, globs: ['x'] },
      projects: [
        {
          id: 'prj_1',
          path: 'D:/p/game',
          rootId: 'root_1',
          name: 'Game',
          tags: ['unity'],
          hasMetaFile: false,
          lastScannedAt: '2026-01-01T00:00:00Z',
        },
      ],
      ui: { theme: 'dark', view: 'list' },
    };
    const { config, errors } = validateConfig(input);
    expect(errors).toEqual([]);
    expect(config.scanRoots).toHaveLength(1);
    expect(config.projects[0]?.tags).toEqual(['unity']);
    expect(config.ui).toEqual({ theme: 'dark', view: 'list' });
  });

  test('[validateConfig] 非法子项应被丢弃并记录错误', () => {
    const { config, errors } = validateConfig({
      version: 1,
      scanRoots: [{ id: 'root_1', path: 'D:/p', maxDepth: 0, enabled: true }, 'bad'],
      projects: [{}],
    });
    expect(config.projects).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
