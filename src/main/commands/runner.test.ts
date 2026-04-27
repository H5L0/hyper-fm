import { describe, expect, test } from 'vitest';
import { substitute } from './runner.js';

describe('runner', () => {
  test('[substitute] 应替换 path/name/category 占位符', () => {
    const out = substitute('open {{path}} as {{name}} in {{category}}', {
      path: '/tmp/x',
      name: 'demo',
      category: '游戏',
      tags: [],
    });
    expect(out).toBe('open /tmp/x as demo in 游戏');
  });

  test('[substitute] category 缺失应替换为空串', () => {
    const out = substitute('cd {{category}}', {
      path: '/tmp/x',
      name: 'demo',
      tags: [],
    });
    expect(out).toBe('cd ');
  });

  test('[substitute] tag:foo 命中应返回标签名', () => {
    const out = substitute('flag={{tag:unity}}', {
      path: '/tmp/x',
      name: 'demo',
      tags: ['unity', 'godot'],
    });
    expect(out).toBe('flag=unity');
  });

  test('[substitute] tag:foo 未命中应返回空串', () => {
    const out = substitute('flag={{tag:unreal}}', {
      path: '/tmp/x',
      name: 'demo',
      tags: ['unity'],
    });
    expect(out).toBe('flag=');
  });

  test('[substitute] 未知占位符应替换为空串', () => {
    const out = substitute('x={{foo}}', { path: '/x', name: 'n', tags: [] });
    expect(out).toBe('x=');
  });

  test('[substitute] 应支持空白和多次出现', () => {
    const out = substitute('{{ name }}-{{name}}', {
      path: '/x',
      name: 'demo',
      tags: [],
    });
    expect(out).toBe('demo-demo');
  });
});
