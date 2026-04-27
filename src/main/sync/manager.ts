// ---------------------------------------------------------------------------
// Sync manager：把 device + snapshot + zip + dir-bundle + transport 串起来
// 提供 IPC 层直接调用的高层操作
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type SyncManifest,
  type SyncProjectEntry,
  type SyncDiff,
  SYNC_SCHEMA,
  SYNC_BUNDLE_EXT,
} from '../../shared/sync-types.js';
import type { AppConfig, Project } from '../../shared/types.js';
import { ensureDeviceRegistry } from './device.js';
import { buildProjectSnapshot } from './snapshot.js';
import {
  packBundle,
  packProjectZip,
  unpackBundle,
  materializeProject,
  type ProjectSource,
} from './zip-bundle.js';
import {
  publishToBundleDir,
  aggregateRemoteManifest,
  readProjectZip,
  type PushPlanItem,
} from './dir-bundle.js';
import { diffManifests } from './diff.js';
import { readMetaFile } from '../meta-file.js';
import { FmError } from '../fm-error.js';

// ---------------------------------------------------------------------------
// 构建本地 manifest
// ---------------------------------------------------------------------------

async function ignorePatternsFor(config: AppConfig, project: Project): Promise<string[]> {
  const base = config.ignore?.globs ?? [];
  if (!project.hasMetaFile) return base;
  try {
    const meta = await readMetaFile(project.path);
    const extra = meta?.ignore ?? [];
    return [...base, ...extra];
  } catch {
    return base;
  }
}

export interface BuildLocalManifestOptions {
  /** 仅包含指定项目；省略表示全部 */
  projectIds?: string[];
}

export async function buildLocalManifest(
  config: AppConfig,
  options: BuildLocalManifestOptions = {},
): Promise<{ manifest: SyncManifest; entriesByProject: Map<string, SyncProjectEntry> }> {
  const { config: cfg } = ensureDeviceRegistry(config);
  if (!cfg.devices) throw new FmError('INTERNAL', '设备注册失败');
  const filter = options.projectIds ? new Set(options.projectIds) : null;
  const targets = cfg.projects.filter(p => (filter ? filter.has(p.id) : true));
  const categoriesById = new Map(cfg.categories.map(c => [c.id, c]));
  const entries: SyncProjectEntry[] = [];
  const map = new Map<string, SyncProjectEntry>();
  for (const project of targets) {
    const ignorePatterns = await ignorePatternsFor(cfg, project);
    const entry = await buildProjectSnapshot({
      projectId: project.id,
      projectPath: project.path,
      meta: {
        name: project.name,
        description: project.description,
        tags: project.tags,
        category: project.categoryId ? categoriesById.get(project.categoryId)?.name : undefined,
      },
      ignorePatterns,
    });
    entries.push(entry);
    map.set(project.id, entry);
  }
  const manifest: SyncManifest = {
    schema: SYNC_SCHEMA,
    generatedAt: new Date().toISOString(),
    device: { id: cfg.devices.selfId, name: cfg.devices.selfName },
    projects: entries,
  };
  return { manifest, entriesByProject: map };
}

// ---------------------------------------------------------------------------
// 共享目录：推/拉 + diff
// ---------------------------------------------------------------------------

export async function diffAgainstBundleDir(
  config: AppConfig,
  bundleDir: string,
  options: BuildLocalManifestOptions = {},
): Promise<{ diff: SyncDiff; localManifest: SyncManifest; remoteManifest: SyncManifest }> {
  const { manifest } = await buildLocalManifest(config, options);
  const remote = await aggregateRemoteManifest(bundleDir, manifest.device.id);
  return { diff: diffManifests(manifest, remote), localManifest: manifest, remoteManifest: remote };
}

export async function pushToBundleDir(
  config: AppConfig,
  bundleDir: string,
  projectIds: string[],
): Promise<{ pushed: string[] }> {
  const { manifest, entriesByProject } = await buildLocalManifest(config, { projectIds });
  const items: PushPlanItem[] = [];
  for (const id of projectIds) {
    const entry = entriesByProject.get(id);
    const project = config.projects.find(p => p.id === id);
    if (!entry || !project) continue;
    const zip = await packProjectZip(project.path, entry);
    items.push({ entry, zip });
  }
  const result = await publishToBundleDir(bundleDir, manifest, items);
  return { pushed: result.pushed };
}

export interface PullPlanItem {
  /** 远端 entry 的 id */
  projectId: string;
  /** 来源设备 id（可由 bundleDir.index 提供） */
  fromDeviceId: string;
  /** 落盘目标绝对路径（默认覆盖到本地已有项目；新项目由 UI 选目录） */
  targetPath: string;
  /** 是否覆盖已有目录 */
  overwrite: boolean;
}

export interface PullResultItem {
  projectId: string;
  targetPath: string;
  hash: string;
  fromDeviceId: string;
}

export async function pullFromBundleDir(
  bundleDir: string,
  items: PullPlanItem[],
): Promise<PullResultItem[]> {
  const out: PullResultItem[] = [];
  for (const item of items) {
    // 找到远端 entry：从对应设备 manifest 中读
    const remoteManifest = await import('./dir-bundle.js').then(m =>
      m.readDeviceManifest(bundleDir, item.fromDeviceId),
    );
    if (!remoteManifest) {
      throw new FmError('SYNC_BUNDLE_INVALID', `bundleDir 中无设备 ${item.fromDeviceId} 的 manifest`);
    }
    const entry = remoteManifest.projects.find(p => p.id === item.projectId);
    if (!entry) {
      throw new FmError('PROJECT_NOT_FOUND', `项目不存在于远端：${item.projectId}`);
    }
    const zipBytes = await readProjectZip(bundleDir, item.fromDeviceId, entry.slug);
    const { unpackProjectZip } = await import('./zip-bundle.js');
    const { files } = await unpackProjectZip(zipBytes);
    await materializeProject(files, item.targetPath, { overwrite: item.overwrite });
    out.push({
      projectId: item.projectId,
      targetPath: item.targetPath,
      hash: entry.hash,
      fromDeviceId: item.fromDeviceId,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// zip 导入/导出
// ---------------------------------------------------------------------------

export async function exportBundleZip(
  config: AppConfig,
  projectIds: string[],
  outputFile: string,
): Promise<{ outputFile: string; projects: number }> {
  const { manifest, entriesByProject } = await buildLocalManifest(config, { projectIds });
  const sources: ProjectSource[] = [];
  for (const id of projectIds) {
    const entry = entriesByProject.get(id);
    const project = config.projects.find(p => p.id === id);
    if (!entry || !project) continue;
    sources.push({ projectAbsPath: project.path, entry });
  }
  const final =
    outputFile.endsWith('.zip') ? outputFile : `${outputFile}${SYNC_BUNDLE_EXT}`;
  await fs.mkdir(path.dirname(final), { recursive: true });
  const bytes = await packBundle(manifest, sources);
  const tmp = `${final}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, final);
  return { outputFile: final, projects: sources.length };
}

export interface ImportBundlePreview {
  manifest: SyncManifest;
  /** entryId -> entry */
  entries: SyncProjectEntry[];
}

export async function previewBundleZip(zipFile: string): Promise<ImportBundlePreview> {
  const buf = await fs.readFile(zipFile);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const { manifest, projects } = await unpackBundle(bytes);
  return { manifest, entries: Object.values(projects).map(p => p.entry) };
}

export interface ImportBundlePlanItem {
  projectId: string;
  /** 'skip' 跳过；'create' 新建到 targetPath；'overwrite' 覆盖 targetPath */
  action: 'skip' | 'create' | 'overwrite';
  targetPath?: string;
}

export interface ImportBundleResultItem {
  projectId: string;
  applied: boolean;
  targetPath?: string;
}

export async function applyBundleZip(
  zipFile: string,
  plan: ImportBundlePlanItem[],
): Promise<ImportBundleResultItem[]> {
  const buf = await fs.readFile(zipFile);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const { projects } = await unpackBundle(bytes);
  const bySlug = new Map<string, { entry: SyncProjectEntry; files: Record<string, Uint8Array> }>();
  for (const [slug, item] of Object.entries(projects)) bySlug.set(slug, item);

  const results: ImportBundleResultItem[] = [];
  for (const item of plan) {
    if (item.action === 'skip') {
      results.push({ projectId: item.projectId, applied: false });
      continue;
    }
    if (!item.targetPath) {
      throw new FmError('CONFIG_INVALID', `项目 ${item.projectId} 缺少目标路径`);
    }
    const found = [...bySlug.values()].find(p => p.entry.id === item.projectId);
    if (!found) {
      throw new FmError('PROJECT_NOT_FOUND', `bundle 中无项目：${item.projectId}`);
    }
    await materializeProject(found.files, item.targetPath, { overwrite: item.action === 'overwrite' });
    results.push({ projectId: item.projectId, applied: true, targetPath: item.targetPath });
  }
  return results;
}
