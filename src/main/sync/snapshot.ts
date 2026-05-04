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
  respectGitignore: boolean;
  /** 单文件大小上限（字节）；超过则跳过 */
  maxFileBytes: number;
}

interface ScopedGitignoreRule {
  baseSegments: string[];
  dirOnly: boolean;
  rooted: boolean;
  hasSlash: boolean;
  segments: Array<{ literal?: string; star?: true }>;
}

function parseGitignoreRule(baseSegments: readonly string[], line: string): ScopedGitignoreRule | null {
  let source = line.trim();
  if (!source || source.startsWith('#') || source.startsWith('!')) return null;

  const dirOnly = source.endsWith('/');
  if (dirOnly) source = source.slice(0, -1);

  const rooted = source.startsWith('/');
  if (rooted) source = source.slice(1);

  const hasSlash = source.includes('/');
  const segments = source.split('/').filter(Boolean).map(segment => (
    segment === '*'
      ? { star: true as const }
      : { literal: segment }
  ));

  if (segments.length === 0) return null;

  return {
    baseSegments: [...baseSegments],
    dirOnly,
    rooted,
    hasSlash,
    segments,
  };
}

function matchGitignoreSegment(segment: { literal?: string; star?: true }, name: string): boolean {
  if (segment.star) return true;
  return segment.literal === name;
}

function matchScopedGitignoreRule(rule: ScopedGitignoreRule, relativeSegments: readonly string[], isDir: boolean): boolean {
  if (rule.dirOnly && !isDir) return false;
  if (relativeSegments.length < rule.baseSegments.length) return false;

  for (let index = 0; index < rule.baseSegments.length; index += 1) {
    if (relativeSegments[index] !== rule.baseSegments[index]) {
      return false;
    }
  }

  const localSegments = relativeSegments.slice(rule.baseSegments.length);
  if (localSegments.length === 0) return false;

  if (rule.rooted || rule.hasSlash) {
    if (rule.segments.length !== localSegments.length) return false;
    for (let index = 0; index < rule.segments.length; index += 1) {
      if (!matchGitignoreSegment(rule.segments[index]!, localSegments[index]!)) {
        return false;
      }
    }
    return true;
  }

  if (rule.segments.length !== 1) return false;
  return matchGitignoreSegment(rule.segments[0]!, localSegments[localSegments.length - 1]!);
}

async function readGitignoreLines(directory: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(directory, '.gitignore'), 'utf8');
    return raw.split(/\r?\n/);
  } catch {
    return [];
  }
}

async function walk(
  rootAbs: string,
  relDir: string,
  options: WalkOptions,
  gitignoreRules: readonly ScopedGitignoreRule[],
  out: SyncFileEntry[],
): Promise<void> {
  const dirAbs = path.join(rootAbs, relDir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }

  const baseSegments = relDir.split('/').filter(Boolean);
  const localRules = options.respectGitignore
    ? (await readGitignoreLines(dirAbs))
      .map(line => parseGitignoreRule(baseSegments, line))
      .filter((rule): rule is ScopedGitignoreRule => rule !== null)
    : [];
  const mergedGitignoreRules = localRules.length > 0 ? [...gitignoreRules, ...localRules] : gitignoreRules;

  for (const ent of entries) {
    const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
    const childSegments = childRel.split('/').filter(Boolean);
    if (options.ignore.isIgnored(childRel, ent.isDirectory())) continue;
    if (mergedGitignoreRules.some(rule => matchScopedGitignoreRule(rule, childSegments, ent.isDirectory()))) continue;
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      await walk(rootAbs, childRel, options, mergedGitignoreRules, out);
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
  /** 是否额外遵循项目目录中的 .gitignore（含嵌套目录） */
  respectGitignore?: boolean;
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
  await walk(
    projectPath,
    '',
    {
      ignore: matcher,
      respectGitignore: input.respectGitignore === true,
      maxFileBytes: input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    },
    [],
    files,
  );
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
