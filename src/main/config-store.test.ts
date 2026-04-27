import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createConfig,
  loadConfig,
  loadOrInitConfig,
  resolveDefaultConfigPath,
  saveConfig,
} from './config-store.js';
import { createDefaultConfig } from '../shared/schema.js';
import { isFmError } from './fm-error.js';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fm-config-'));
}

describe('config-store', () => {
  test('[resolveDefaultConfigPath] 应在指定目录拼接默认文件名', () => {
    expect(resolveDefaultConfigPath('/tmp')).toMatch(/fm\.config\.json$/);
  });

  test('[loadConfig] 文件不存在应抛 FmError(CONFIG_NOT_FOUND)', async () => {
    try {
      await loadConfig(path.join(await tmpDir(), 'missing.json'));
      throw new Error('未抛出');
    } catch (error) {
      expect(isFmError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  test('[createConfig] 应写入默认配置且重复创建报错', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'fm.config.json');
    const snapshot = await createConfig(file);
    expect(snapshot.path).toBe(file);
    expect(snapshot.data.version).toBe(1);
    expect(snapshot.data.scanRoots).toEqual([]);

    try {
      await createConfig(file);
      throw new Error('未抛出');
    } catch (error) {
      expect(isFmError(error)).toBe(true);
    }
  });

  test('[saveConfig + loadConfig] 应原子写回并能重新加载', async () => {
    const file = path.join(await tmpDir(), 'fm.config.json');
    const data = createDefaultConfig();
    data.scanRoots.push({ id: 'root_x', path: 'D:/p', maxDepth: 2, enabled: true });
    await saveConfig(file, data);

    const reloaded = await loadConfig(file);
    expect(reloaded.data.scanRoots).toHaveLength(1);
    expect(reloaded.data.scanRoots[0]?.path).toBe('D:/p');
  });

  test('[loadOrInitConfig] 不存在时应初始化', async () => {
    const file = path.join(await tmpDir(), 'fm.config.json');
    const snap = await loadOrInitConfig(file);
    expect(snap.data.version).toBe(1);
    const exists = await fs.stat(file);
    expect(exists.isFile()).toBe(true);
  });
});
