import { describe, expect, test } from 'vitest';
import { generateId, ID_PREFIX } from './id.js';

describe('id', () => {
  test('[generateId] 应包含前缀且长度正确', () => {
    const id = generateId(ID_PREFIX.project, 6);
    expect(id).toMatch(/^prj_[a-z0-9]{6}$/);
  });

  test('[generateId] 多次生成不应完全重复', () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateId(ID_PREFIX.project));
    expect(set.size).toBeGreaterThan(190);
  });
});
