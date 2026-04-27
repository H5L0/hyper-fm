// ---------------------------------------------------------------------------
// 项目扫描器
// 给定扫描根，遍历目录树寻找「项目候选」（叶子目录或被显式标记的目录）
// 项目识别策略（M1）：
//   - 扫描深度 >= 1
//   - 任一目录下若存在以下标志之一，即视为项目根并停止下钻：
//       .meta-data, .git, package.json, Cargo.toml, *.sln, *.csproj, pyproject.toml
//   - 否则继续递归直到 maxDepth；触底仍没有标志的目录视为「普通目录」，本身也作为项目入库
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import { normalizePath } from '../shared/path-utils.js';
import { createIgnoreMatcher, type IgnoreMatcher } from './ignore-matcher.js';
import { metaFileExists } from './meta-file.js';

const logger = createLogger('main:scanner');

const PROJECT_MARKERS = new Set([
  '.meta-data',
  '.git',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
]);

const PROJECT_MARKER_SUFFIX = ['.sln', '.csproj', '.xcodeproj'];

function hasMarker(entries: string[]): boolean {
  for (const e of entries) {
    if (PROJECT_MARKERS.has(e)) return true;
    for (const suffix of PROJECT_MARKER_SUFFIX) {
      if (e.endsWith(suffix)) return true;
    }
  }
  return false;
}

export interface ScanCandidate {
  /** 绝对正斜杠路径 */
  path: string;
  name: string;
  /** 目录 mtime ISO */
  mtime: string;
  hasMetaFile: boolean;
}

export interface ScanOptions {
  rootPath: string;
  maxDepth: number;
  ignoreGlobs: readonly string[];
  respectGitignore: boolean;
  /** 进度回调：每发现一个目录或项目时调用 */
  onProgress?: (info: { scanned: number; found: number }) => void;
}

interface WalkContext {
  matcher: IgnoreMatcher;
  rootAbs: string;
  maxDepth: number;
  candidates: ScanCandidate[];
  scanned: number;
  onProgress?: ScanOptions['onProgress'];
}

async function readDirEntries(dir: string): Promise<{ files: string[]; dirs: string[] } | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // 避免循环
      if (entry.isDirectory()) dirs.push(entry.name);
      else if (entry.isFile()) files.push(entry.name);
    }
    return { files, dirs };
  } catch (error) {
    logger.warn('目录读取失败，跳过', { dir, error: (error as Error).message });
    return null;
  }
}

async function readGitignoreLines(dir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    return raw.split(/\r?\n/);
  } catch {
    return [];
  }
}

async function pushCandidate(ctx: WalkContext, absDir: string): Promise<void> {
  const stat = await fs.stat(absDir).catch(() => null);
  const mtime = stat?.mtime?.toISOString() ?? new Date(0).toISOString();
  const hasMeta = await metaFileExists(absDir);
  ctx.candidates.push({
    path: normalizePath(absDir),
    name: path.basename(absDir),
    mtime,
    hasMetaFile: hasMeta,
  });
  ctx.onProgress?.({ scanned: ctx.scanned, found: ctx.candidates.length });
}

async function walk(
  ctx: WalkContext,
  absDir: string,
  depth: number,
  extraIgnores: readonly string[],
): Promise<void> {
  ctx.scanned++;
  ctx.onProgress?.({ scanned: ctx.scanned, found: ctx.candidates.length });

  const entries = await readDirEntries(absDir);
  if (!entries) return;

  // 项目识别：发现标志立即作为项目入库，不再下钻
  if (depth >= 1 && hasMarker([...entries.files, ...entries.dirs])) {
    await pushCandidate(ctx, absDir);
    return;
  }

  if (depth >= ctx.maxDepth) {
    if (depth >= 1) {
      // 触底仍未发现标志：把当前目录本身视作项目（覆盖「普通文件夹」用例）
      await pushCandidate(ctx, absDir);
    }
    return;
  }

  // 合并本级 .gitignore（仅当父级已开启 respectGitignore 时通过 extraIgnores 注入）
  const localIgnores = await readGitignoreLines(absDir);
  const merged = [...extraIgnores, ...localIgnores];
  const matcher = merged.length === extraIgnores.length ? ctx.matcher : createIgnoreMatcher(merged);

  for (const dirName of entries.dirs) {
    const childAbs = path.join(absDir, dirName);
    const rel = normalizePath(path.relative(ctx.rootAbs, childAbs));
    if (matcher.isIgnored(rel, true)) continue;
    await walk({ ...ctx, matcher }, childAbs, depth + 1, merged);
  }
}

export async function scanRoot(options: ScanOptions): Promise<ScanCandidate[]> {
  const rootAbs = path.resolve(options.rootPath);
  const stat = await fs.stat(rootAbs).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`扫描根不是有效目录：${rootAbs}`);
  }

  const baseIgnores = [...options.ignoreGlobs];
  if (options.respectGitignore) {
    const rootGitignore = await readGitignoreLines(rootAbs);
    baseIgnores.push(...rootGitignore);
  }
  const matcher = createIgnoreMatcher(baseIgnores);

  const ctx: WalkContext = {
    matcher,
    rootAbs,
    maxDepth: Math.max(1, options.maxDepth),
    candidates: [],
    scanned: 0,
    onProgress: options.onProgress,
  };
  await walk(ctx, rootAbs, 0, baseIgnores);
  return ctx.candidates;
}
