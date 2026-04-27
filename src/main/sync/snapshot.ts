// ---------------------------------------------------------------------------
// 项目快照：扫描项目目录，构建 SyncProjectEntry（含 file 列表与 sha1 指纹）
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  type SyncFileEntry,
  type SyncProjectEntry,
  type SyncProjectMeta,
} from '../../shared/sync-types.js';
import { type IgnoreMatcher, createIgnoreMatcher } from '../ignore-matcher.js';
import { toPosix, basename } from '../../shared/path-utils.js';

// ---------------------------------------------------------------------------
// slug 计算：basename + 短哈希，避免重名冲突
// ---------------------------------------------------------------------------

function shortHash(input: string, length = 6): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

export function buildProjectSlug(projectId: string, projectPath: string): string {
  const base = basename(projectPath).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 32) || 'project';
  return `${base}-${shortHash(projectId)}`;
}

// ---------------------------------------------------------------------------
// 文件遍历
// ---------------------------------------------------------------------------

async function sha1OfFile(absPath: string): Promise<string> {
  const h = createHash('sha1');
  const fh = await fs.open(absPath, 'r');
  try {
    const stream = fh.createReadStream();
    for await (const chunk of stream) h.update(chunk);
  } finally {
    await fh.close();
  }
  return h.digest('hex');
}

interface WalkOptions {
  ignore: IgnoreMatcher;
  /** 单文件大小上限（字节）；超过则跳过 */
  maxFileBytes: number;
}

async function walk(
  rootAbs: string,
  relDir: string,
  options: WalkOptions,
  out: SyncFileEntry[],
): Promise<void> {
  const dirAbs = path.join(rootAbs, relDir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
    if (options.ignore.isIgnored(childRel, ent.isDirectory())) continue;
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      await walk(rootAbs, childRel, options, out);
      continue;
    }
    if (!ent.isFile()) continue;
    const absChild = path.join(rootAbs, childRel);
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(absChild);
    } catch {
      continue;
    }
    if (stat.size > options.maxFileBytes) continue;
    const sha1 = await sha1OfFile(absChild);
    out.push({
      path: toPosix(childRel),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      sha1,
    });
  }
}

/**
 * 基于文件清单计算项目内容指纹。顺序无关：先按 path 排序后拼接 sha1。
 */
export function computeProjectHash(files: SyncFileEntry[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha1');
  for (const f of sorted) {
    h.update(f.path);
    h.update('\0');
    h.update(f.sha1);
    h.update('\0');
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface BuildSnapshotInput {
  projectId: string;
  projectPath: string;
  meta: SyncProjectMeta;
  /** 同步专用忽略规则（基于 AppConfig.ignore.globs + 项目 .meta-data.ignore 合并） */
  ignorePatterns: readonly string[];
  /** 单文件大小上限，超出忽略。默认 50MB */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

export async function buildProjectSnapshot(
  input: BuildSnapshotInput,
): Promise<SyncProjectEntry> {
  const { projectId, projectPath, meta } = input;
  const matcher = createIgnoreMatcher(input.ignorePatterns);
  const files: SyncFileEntry[] = [];
  await walk(projectPath, '', { ignore: matcher, maxFileBytes: input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES }, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  let mtime = '1970-01-01T00:00:00.000Z';
  try {
    const stat = await fs.stat(projectPath);
    mtime = stat.mtime.toISOString();
  } catch {
    /* keep epoch */
  }

  return {
    id: projectId,
    slug: buildProjectSlug(projectId, projectPath),
    meta,
    files,
    hash: computeProjectHash(files),
    modifiedAt: mtime,
  };
}
