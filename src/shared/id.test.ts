import { describe, expect, test } from 'vitest';
import { generateId, generateProjectId, ID_PREFIX } from './id.js';

describe('id', () => {
  test('[generateProjectId] 项目 ID 应使用 pj- 前缀', () => {
    const id = generateProjectId(6);
    expect(id).toMatch(/^pj-[a-z0-9]{6}$/);
  });

  test('[generateId] 非项目实体仍使用下划线分隔', () => {
    const id = generateId(ID_PREFIX.device, 6);
    expect(id).toMatch(/^dev_[a-z0-9]{6}$/);
  });

  test('[generateProjectId] 多次生成不应完全重复', () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateProjectId());
    expect(set.size).toBeGreaterThan(190);
  });
});
