import { describe, expect, test } from 'vitest';
import { createIgnoreMatcher } from './ignore-matcher.js';

describe('ignore-matcher', () => {
  test('[createIgnoreMatcher] 精确名称应被忽略', () => {
    const m = createIgnoreMatcher(['node_modules', '.git']);
    expect(m.isIgnored('node_modules', true)).toBe(true);
    expect(m.isIgnored('a/b/.git', true)).toBe(true);
    expect(m.isIgnored('src', true)).toBe(false);
  });

  test('[createIgnoreMatcher] 目录后缀 / 仅匹配目录', () => {
    const m = createIgnoreMatcher(['build/']);
    expect(m.isIgnored('build', true)).toBe(true);
    expect(m.isIgnored('build', false)).toBe(false);
  });

  test('[createIgnoreMatcher] 注释与空行应被跳过', () => {
    const m = createIgnoreMatcher(['# comment', '', 'foo']);
    expect(m.isIgnored('foo', false)).toBe(true);
    expect(m.isIgnored('comment', false)).toBe(false);
  });

  test('[createIgnoreMatcher] 单段 * 应匹配任意名称', () => {
    const m = createIgnoreMatcher(['*.tmp']);
    // 仅简化通配，不展开后缀；仅当整段为 * 才匹配，因此 *.tmp 会作为字面量保留
    expect(m.isIgnored('a.tmp', false)).toBe(false);
  });

  test('[createIgnoreMatcher] 否定规则当前不支持，应被忽略', () => {
    const m = createIgnoreMatcher(['foo', '!foo']);
    expect(m.isIgnored('foo', false)).toBe(true);
  });
});
