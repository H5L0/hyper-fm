// ---------------------------------------------------------------------------
// 项目仓库：在 AppConfig 之上封装查询/写入操作
// 所有操作返回新的 AppConfig（不可变更新），由调用方决定何时写盘
// ---------------------------------------------------------------------------

import {
  type AppConfig,
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
 * 与扫描相关的元字段），项目名称/描述/标签等用户编辑字段会被保留。
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
  };

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
// 手动添加项目
// ---------------------------------------------------------------------------

/**
 * 手动添加项目：不依赖扫描根。如果给定路径恰好位于某个扫描根之下，则归属该根；
 * 否则使用合成 rootId，避免被扫描的「removed」检测误删。
 */
export const MANUAL_ROOT_ID = 'manual';

export interface AddProjectInput {
  path: string;
  name?: string;
  description?: string;
  tags?: string[];
  hasMetaFile?: boolean;
  mtime?: string;
}

export function addProjectManual(
  config: AppConfig,
  input: AddProjectInput,
  platform: NodeJS.Platform,
): { config: AppConfig; project: Project } {
  const normalized = normalizePath(input.path);
  if (findProjectByPath(config, normalized, platform)) {
    throw new FmError('DUPLICATE_PATH', `项目已存在：${normalized}`);
  }
  const root = config.scanRoots.find(r => {
    const rp = normalizePath(r.path).toLowerCase();
    return normalized.toLowerCase().startsWith(`${rp}/`) || normalized.toLowerCase() === rp;
  });
  const name = input.name?.trim() || normalized.split('/').filter(Boolean).pop() || normalized;
  const project: Project = {
    id: generateId(ID_PREFIX.project),
    path: normalized,
    rootId: root?.id ?? MANUAL_ROOT_ID,
    name,
    description: input.description,
    tags: input.tags?.map(t => t.trim()).filter(Boolean) ?? [],
    hasMetaFile: input.hasMetaFile ?? false,
    lastScannedAt: new Date().toISOString(),
    lastModifiedAt: input.mtime ?? new Date().toISOString(),
  };
  return { config: { ...config, projects: [...config.projects, project] }, project };
}

export function removeProject(config: AppConfig, id: string): AppConfig {
  return { ...config, projects: config.projects.filter(p => p.id !== id) };
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
