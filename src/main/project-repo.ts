// ---------------------------------------------------------------------------
// 项目仓库：在 AppConfig 之上封装查询/写入操作
// 所有操作返回新的 AppConfig（不可变更新），由调用方决定何时写盘
// ---------------------------------------------------------------------------

import {
  type AppConfig,
  type Category,
  type Project,
  type ProjectMetaPatch,
  type ScanReport,
  type MetaFile,
} from '../shared/types.js';
import { generateId, ID_PREFIX } from '../shared/id.js';
import { normalizePath, pathEquals } from '../shared/path-utils.js';
import { FmError } from './fm-error.js';
import type { ScanCandidate } from './scanner.js';

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function findProjectById(config: AppConfig, id: string): Project | undefined {
  return config.projects.find(p => p.id === id);
}

export function findProjectByPath(
  config: AppConfig,
  absPath: string,
  platform: NodeJS.Platform,
): Project | undefined {
  return config.projects.find(p => pathEquals(p.path, absPath, platform));
}

export function findCategoryByName(config: AppConfig, name: string): Category | undefined {
  const trimmed = name.trim();
  return config.categories.find(c => c.name === trimmed);
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

export function addCategory(config: AppConfig, input: { name: string; color?: string }): {
  config: AppConfig;
  category: Category;
} {
  const name = input.name.trim();
  if (!name) throw new FmError('CONFIG_INVALID', '分类名称不能为空');
  if (findCategoryByName(config, name)) {
    throw new FmError('CONFIG_INVALID', `分类已存在：${name}`);
  }
  const category: Category = { id: generateId(ID_PREFIX.category), name, color: input.color };
  return { config: { ...config, categories: [...config.categories, category] }, category };
}

export function renameCategory(config: AppConfig, id: string, name: string): {
  config: AppConfig;
  category: Category;
} {
  const trimmed = name.trim();
  if (!trimmed) throw new FmError('CONFIG_INVALID', '分类名称不能为空');
  const exists = config.categories.find(c => c.id === id);
  if (!exists) throw new FmError('CATEGORY_NOT_FOUND', `分类不存在：${id}`);
  if (config.categories.some(c => c.id !== id && c.name === trimmed)) {
    throw new FmError('CONFIG_INVALID', `分类名称冲突：${trimmed}`);
  }
  const updated: Category = { ...exists, name: trimmed };
  return {
    config: { ...config, categories: config.categories.map(c => (c.id === id ? updated : c)) },
    category: updated,
  };
}

export function setCategoryColor(config: AppConfig, id: string, color: string): {
  config: AppConfig;
  category: Category;
} {
  const exists = config.categories.find(c => c.id === id);
  if (!exists) throw new FmError('CATEGORY_NOT_FOUND', `分类不存在：${id}`);
  const updated: Category = { ...exists, color };
  return {
    config: { ...config, categories: config.categories.map(c => (c.id === id ? updated : c)) },
    category: updated,
  };
}

export function removeCategory(config: AppConfig, id: string): AppConfig {
  return {
    ...config,
    categories: config.categories.filter(c => c.id !== id),
    projects: config.projects.map(p =>
      p.categoryId === id ? { ...p, categoryId: undefined } : p,
    ),
  };
}

// ---------------------------------------------------------------------------
// 项目：扫描合并
// ---------------------------------------------------------------------------

interface MergeContext {
  config: AppConfig;
  rootId: string;
  platform: NodeJS.Platform;
  metaResolver?: (projectPath: string) => Promise<MetaFile | null>;
}

/**
 * 将一次扫描结果合并到 config 中，并返回新的 config 与 ScanReport。
 *
 * 注意：本函数只更新 DB 中的字段（hasMetaFile / lastScannedAt / lastModifiedAt 等
 * 与扫描相关的元字段），项目名称/分类/描述/标签等用户编辑字段会被保留。
 * 如需让 .meta-data 内容覆盖到 DB，需要由调用方传入 metaResolver。
 */
export async function mergeScanResult(
  ctx: MergeContext,
  candidates: readonly ScanCandidate[],
): Promise<{ config: AppConfig; report: ScanReport; durationMs?: never }> {
  const { config, rootId, platform } = ctx;
  const start = Date.now();

  let added = 0;
  let updated = 0;
  let categoriesUpdate = config.categories;

  const projectByPath = new Map<string, Project>();
  for (const p of config.projects) {
    projectByPath.set(normalizePath(p.path).toLowerCase(), p);
  }

  const result: Project[] = config.projects.filter(p => p.rootId !== rootId).slice();
  const seenPaths = new Set<string>();

  for (const cand of candidates) {
    const key = normalizePath(cand.path).toLowerCase();
    seenPaths.add(key);
    const existing = projectByPath.get(key);

    let project: Project;
    if (existing) {
      project = {
        ...existing,
        rootId,
        hasMetaFile: cand.hasMetaFile,
        lastScannedAt: new Date().toISOString(),
        lastModifiedAt: cand.mtime,
      };
      updated++;
    } else {
      project = {
        id: generateId(ID_PREFIX.project),
        path: normalizePath(cand.path),
        rootId,
        name: cand.name,
        tags: [],
        hasMetaFile: cand.hasMetaFile,
        lastScannedAt: new Date().toISOString(),
        lastModifiedAt: cand.mtime,
      };
      added++;
    }

    if (cand.hasMetaFile && ctx.metaResolver) {
      const meta = await ctx.metaResolver(cand.path);
      if (meta) {
        if (meta.name) project.name = meta.name;
        if (meta.description !== undefined) project.description = meta.description;
        if (meta.tags) project.tags = meta.tags;
        if (meta.category) {
          let cat = categoriesUpdate.find(c => c.name === meta.category);
          if (!cat) {
            cat = { id: generateId(ID_PREFIX.category), name: meta.category };
            categoriesUpdate = [...categoriesUpdate, cat];
          }
          project.categoryId = cat.id;
        }
      }
    }

    result.push(project);
  }

  // 在同一 root 下消失的项目算作 removed
  const removed = config.projects.filter(p => {
    if (p.rootId !== rootId) return false;
    const key = normalizePath(p.path).toLowerCase();
    return !seenPaths.has(key);
  }).length;

  const newConfig: AppConfig = {
    ...config,
    categories: categoriesUpdate,
    projects: result,
  };

  const report: ScanReport = {
    rootId,
    scanned: candidates.length,
    added,
    updated,
    removed,
    durationMs: Date.now() - start,
  };
  // platform 用于路径比较，但对结果没影响（仅 key 计算用 lowercase）；保留参数以便未来扩展
  void platform;
  return { config: newConfig, report };
}

// ---------------------------------------------------------------------------
// 项目元数据更新
// ---------------------------------------------------------------------------

export function applyProjectPatch(
  config: AppConfig,
  id: string,
  patch: ProjectMetaPatch,
): { config: AppConfig; project: Project } {
  const existing = findProjectById(config, id);
  if (!existing) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);

  const next: Project = {
    ...existing,
    name: patch.name?.trim() || existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    tags: patch.tags ? patch.tags.map(t => t.trim()).filter(Boolean) : existing.tags,
    categoryId:
      patch.categoryId === null
        ? undefined
        : patch.categoryId !== undefined
          ? patch.categoryId
          : existing.categoryId,
  };

  if (next.categoryId && !config.categories.some(c => c.id === next.categoryId)) {
    throw new FmError('CATEGORY_NOT_FOUND', `分类不存在：${next.categoryId}`);
  }

  return {
    config: {
      ...config,
      projects: config.projects.map(p => (p.id === id ? next : p)),
    },
    project: next,
  };
}

export function setProjectMetaFlag(
  config: AppConfig,
  id: string,
  hasMetaFile: boolean,
): AppConfig {
  return {
    ...config,
    projects: config.projects.map(p => (p.id === id ? { ...p, hasMetaFile } : p)),
  };
}

// ---------------------------------------------------------------------------
// 扫描根
// ---------------------------------------------------------------------------

export function addScanRoot(
  config: AppConfig,
  input: { path: string; label?: string; maxDepth?: number },
): { config: AppConfig; root: AppConfig['scanRoots'][number] } {
  const normalized = normalizePath(input.path);
  if (config.scanRoots.some(r => normalizePath(r.path).toLowerCase() === normalized.toLowerCase())) {
    throw new FmError('DUPLICATE_PATH', `扫描根已存在：${normalized}`);
  }
  const root = {
    id: generateId(ID_PREFIX.scanRoot),
    path: normalized,
    label: input.label,
    maxDepth: input.maxDepth && input.maxDepth >= 1 ? Math.floor(input.maxDepth) : 3,
    enabled: true,
  };
  return { config: { ...config, scanRoots: [...config.scanRoots, root] }, root };
}

export function updateScanRoot(
  config: AppConfig,
  id: string,
  patch: Partial<Omit<AppConfig['scanRoots'][number], 'id'>>,
): { config: AppConfig; root: AppConfig['scanRoots'][number] } {
  const existing = config.scanRoots.find(r => r.id === id);
  if (!existing) throw new FmError('CONFIG_INVALID', `扫描根不存在：${id}`);
  const next = {
    ...existing,
    ...patch,
    path: patch.path ? normalizePath(patch.path) : existing.path,
    maxDepth: patch.maxDepth && patch.maxDepth >= 1 ? Math.floor(patch.maxDepth) : existing.maxDepth,
  };
  return {
    config: { ...config, scanRoots: config.scanRoots.map(r => (r.id === id ? next : r)) },
    root: next,
  };
}

export function removeScanRoot(config: AppConfig, id: string): AppConfig {
  return {
    ...config,
    scanRoots: config.scanRoots.filter(r => r.id !== id),
    projects: config.projects.filter(p => p.rootId !== id),
  };
}
