import { describe, expect, test } from 'vitest';
import {
  addCategory,
  addScanRoot,
  applyProjectPatch,
  mergeScanResult,
  removeCategory,
  removeScanRoot,
  renameCategory,
  updateScanRoot,
} from './project-repo.js';
import { createDefaultConfig } from '../shared/schema.js';
import type { ScanCandidate } from './scanner.js';

function withCategory(name = '游戏') {
  const base = createDefaultConfig();
  const { config, category } = addCategory(base, { name });
  return { config, category };
}

describe('project-repo / categories', () => {
  test('[addCategory] 重名应抛错', () => {
    const { config } = withCategory('游戏');
    expect(() => addCategory(config, { name: '游戏' })).toThrow();
  });

  test('[renameCategory] 应更新名称且检查冲突', () => {
    const { config, category } = withCategory('游戏');
    const { config: renamed } = renameCategory(config, category.id, '游戏开发');
    expect(renamed.categories[0]?.name).toBe('游戏开发');

    const { config: more } = addCategory(renamed, { name: 'Node' });
    expect(() => renameCategory(more, category.id, 'Node')).toThrow();
  });

  test('[removeCategory] 应解除项目关联', () => {
    const base = createDefaultConfig();
    const { config: c1, category } = addCategory(base, { name: '游戏' });
    const c2 = {
      ...c1,
      projects: [
        {
          id: 'prj_1',
          path: 'D:/x',
          rootId: 'root_1',
          name: 'X',
          tags: [],
          categoryId: category.id,
          hasMetaFile: false,
          lastScannedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const next = removeCategory(c2, category.id);
    expect(next.categories).toHaveLength(0);
    expect(next.projects[0]?.categoryId).toBeUndefined();
  });
});

describe('project-repo / scan roots', () => {
  test('[addScanRoot] 重复路径应抛错', () => {
    const base = createDefaultConfig();
    const { config } = addScanRoot(base, { path: 'D:/p' });
    expect(() => addScanRoot(config, { path: 'd:/p' })).toThrow();
  });

  test('[updateScanRoot] 应能修改 maxDepth 与 enabled', () => {
    const { config } = addScanRoot(createDefaultConfig(), { path: 'D:/p' });
    const id = config.scanRoots[0]!.id;
    const { config: next } = updateScanRoot(config, id, { maxDepth: 5, enabled: false });
    expect(next.scanRoots[0]?.maxDepth).toBe(5);
    expect(next.scanRoots[0]?.enabled).toBe(false);
  });

  test('[removeScanRoot] 应级联删除 root 下项目', () => {
    const { config: c1 } = addScanRoot(createDefaultConfig(), { path: 'D:/p' });
    const id = c1.scanRoots[0]!.id;
    const c2 = {
      ...c1,
      projects: [
        {
          id: 'prj_1',
          path: 'D:/p/x',
          rootId: id,
          name: 'X',
          tags: [],
          hasMetaFile: false,
          lastScannedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const next = removeScanRoot(c2, id);
    expect(next.projects).toHaveLength(0);
    expect(next.scanRoots).toHaveLength(0);
  });
});

describe('project-repo / mergeScanResult', () => {
  test('[mergeScanResult] 新增 + 移除 + 更新计数应正确', async () => {
    const { config: c1 } = addScanRoot(createDefaultConfig(), { path: 'D:/p' });
    const rootId = c1.scanRoots[0]!.id;

    const candA: ScanCandidate = {
      path: 'D:/p/a',
      name: 'a',
      mtime: '2026-01-01T00:00:00Z',
      hasMetaFile: false,
    };
    const candB: ScanCandidate = {
      path: 'D:/p/b',
      name: 'b',
      mtime: '2026-01-02T00:00:00Z',
      hasMetaFile: false,
    };
    const first = await mergeScanResult(
      { config: c1, rootId, platform: 'linux' },
      [candA, candB],
    );
    expect(first.report.added).toBe(2);
    expect(first.config.projects).toHaveLength(2);

    // 第二次扫描：a 仍在，c 新增，b 消失
    const candC: ScanCandidate = {
      path: 'D:/p/c',
      name: 'c',
      mtime: '2026-01-03T00:00:00Z',
      hasMetaFile: false,
    };
    const second = await mergeScanResult(
      { config: first.config, rootId, platform: 'linux' },
      [candA, candC],
    );
    expect(second.report.added).toBe(1);
    expect(second.report.updated).toBe(1);
    expect(second.report.removed).toBe(1);
    expect(second.config.projects.map(p => p.name).sort()).toEqual(['a', 'c']);
  });

  test('[mergeScanResult] metaResolver 应覆盖 name/description 并自动建分类', async () => {
    const { config: c1 } = addScanRoot(createDefaultConfig(), { path: 'D:/p' });
    const rootId = c1.scanRoots[0]!.id;
    const cand: ScanCandidate = {
      path: 'D:/p/g',
      name: 'g',
      mtime: '2026-01-01T00:00:00Z',
      hasMetaFile: true,
    };
    const out = await mergeScanResult(
      {
        config: c1,
        rootId,
        platform: 'linux',
        metaResolver: async () => ({
          schema: 'fm.meta/v1',
          name: 'GameX',
          category: '游戏',
          description: 'desc',
          tags: ['unity'],
        }),
      },
      [cand],
    );
    expect(out.config.categories.find(c => c.name === '游戏')).toBeDefined();
    const project = out.config.projects[0]!;
    expect(project.name).toBe('GameX');
    expect(project.tags).toEqual(['unity']);
    expect(project.categoryId).toBe(out.config.categories[0]!.id);
  });
});

describe('project-repo / applyProjectPatch', () => {
  test('[applyProjectPatch] 不存在的 categoryId 应抛错', () => {
    const config = {
      ...createDefaultConfig(),
      projects: [
        {
          id: 'prj_1',
          path: 'D:/x',
          rootId: 'root_1',
          name: 'X',
          tags: [],
          hasMetaFile: false,
          lastScannedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    expect(() =>
      applyProjectPatch(config, 'prj_1', { categoryId: 'cat_missing' }),
    ).toThrow();
  });

  test('[applyProjectPatch] 应裁剪 tags 中的空白项', () => {
    const config = {
      ...createDefaultConfig(),
      projects: [
        {
          id: 'prj_1',
          path: 'D:/x',
          rootId: 'root_1',
          name: 'X',
          tags: [],
          hasMetaFile: false,
          lastScannedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const { project } = applyProjectPatch(config, 'prj_1', {
      tags: [' a ', '', 'b'],
    });
    expect(project.tags).toEqual(['a', 'b']);
  });
});
