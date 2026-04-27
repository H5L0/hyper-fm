import { describe, expect, test } from 'vitest';
import { explainMatch, highlight, matchProject, parseSearchQuery } from './search.js';
import type { Project } from './types.js';

const baseProject: Project = {
  id: 'prj_1',
  path: 'D:/projects/game-zero',
  rootId: 'root_1',
  name: 'Game Zero',
  description: 'Unity 小游戏原型',
  tags: ['unity', 'prototype'],
  hasMetaFile: false,
  lastScannedAt: '2026-01-01T00:00:00Z',
};

describe('search', () => {
  test('[parseSearchQuery] 多关键字应按 AND 切分', () => {
    const q = parseSearchQuery('zero unity');
    expect(q.terms).toEqual([
      { field: 'any', value: 'zero' },
      { field: 'any', value: 'unity' },
    ]);
  });

  test('[parseSearchQuery] 字段前缀应被识别', () => {
    const q = parseSearchQuery('tag:unity cat:游戏 path:projects');
    expect(q.terms).toEqual([
      { field: 'tag', value: 'unity' },
      { field: 'category', value: '游戏' },
      { field: 'path', value: 'projects' },
    ]);
  });

  test('[parseSearchQuery] 未知前缀应回落为 any', () => {
    const q = parseSearchQuery('foo:bar');
    expect(q.terms).toEqual([{ field: 'any', value: 'foo:bar' }]);
  });

  test('[matchProject] 空查询应返回空命中', () => {
    const r = matchProject(baseProject, parseSearchQuery(''));
    expect(r).toEqual({ fields: [], values: [] });
  });

  test('[matchProject] 多关键字 AND 任一不命中应返回 null', () => {
    const r = matchProject(baseProject, parseSearchQuery('unity nonexistent'));
    expect(r).toBeNull();
  });

  test('[matchProject] 字段限定应仅在指定字段查找', () => {
    const r = matchProject(baseProject, parseSearchQuery('tag:unity'));
    expect(r?.fields).toEqual(['tag']);
    const r2 = matchProject(baseProject, parseSearchQuery('tag:zero'));
    expect(r2).toBeNull();
  });

  test('[matchProject] any 模式应跨字段命中并回报字段', () => {
    const r = matchProject(baseProject, parseSearchQuery('zero'));
    expect(r?.fields).toContain('name');
  });

  test('[highlight] 应切分匹配子串', () => {
    const segs = highlight('Unity prototype', ['unity']);
    expect(segs).toEqual([
      { text: 'Unity', hit: true },
      { text: ' prototype', hit: false },
    ]);
  });

  test('[highlight] 多关键字应都被高亮', () => {
    const segs = highlight('abc xyz abc', ['abc', 'xyz']);
    expect(segs.filter(s => s.hit).map(s => s.text)).toEqual(['abc', 'xyz', 'abc']);
  });

  test('[explainMatch] 应输出中文解释', () => {
    const exp = explainMatch({ fields: ['name', 'tag'], values: ['unity'] });
    expect(exp).toContain('名称');
    expect(exp).toContain('标签');
    expect(exp).toContain('unity');
  });
});
