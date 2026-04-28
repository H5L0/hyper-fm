import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { metaFileExists, readMetaFile, removeMetaFile, writeMetaFile } from './meta-file.js';
import { META_FILE_NAME } from '../shared/types.js';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fm-meta-'));
}

describe('meta-file', () => {
  test('[readMetaFile] 不存在应返回 null', async () => {
    const dir = await tmpDir();
    expect(await readMetaFile(dir)).toBeNull();
    expect(await metaFileExists(dir)).toBe(false);
  });

  test('[writeMetaFile + readMetaFile] 应能写回并读取', async () => {
    const dir = await tmpDir();
    await writeMetaFile(dir, {
      name: 'MyGame',
      description: 'Unity 原型',
      tags: ['unity'],
    });
    expect(await metaFileExists(dir)).toBe(true);
    const meta = await readMetaFile(dir);
    expect(meta?.name).toBe('MyGame');
    expect(meta?.tags).toEqual(['unity']);
  });

  test('[readMetaFile] 非法 JSON 应抛错', async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, META_FILE_NAME), '{not json');
    await expect(readMetaFile(dir)).rejects.toThrow();
  });

  test('[removeMetaFile] 应删除且对不存在静默返回', async () => {
    const dir = await tmpDir();
    await writeMetaFile(dir, { name: 'x' });
    await removeMetaFile(dir);
    expect(await metaFileExists(dir)).toBe(false);
    await expect(removeMetaFile(dir)).resolves.toBeUndefined();
  });
});
