// ---------------------------------------------------------------------------
// zip 打包/解包：基于 fflate
// 单项目 zip 结构：
//   .fm-meta.json
//   files/...
// 多项目 bundle .fm-bundle.zip 结构：
//   manifest.json
//   projects/<slug>/...
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import { zip, unzip, type Zippable, type Unzipped } from 'fflate';
import {
  type SyncManifest,
  type SyncProjectEntry,
  SYNC_PROJECT_META_FILENAME,
  SYNC_BUNDLE_FILENAME,
} from '../../shared/sync-types.js';
import { FmError } from '../fm-error.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---------------------------------------------------------------------------
// 内部：fflate Promise 包装
// ---------------------------------------------------------------------------

function zipAsync(input: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(input, { level: 6 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function unzipAsync(input: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(input, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// ---------------------------------------------------------------------------
// 文件 IO 助手
// ---------------------------------------------------------------------------

async function loadProjectFiles(
  projectAbsPath: string,
  entry: SyncProjectEntry,
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const file of entry.files) {
    const abs = path.join(projectAbsPath, file.path);
    const buf = await fs.readFile(abs);
    out[`files/${file.path}`] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 打包：单项目 zip
// ---------------------------------------------------------------------------

export async function packProjectZip(
  projectAbsPath: string,
  entry: SyncProjectEntry,
): Promise<Uint8Array> {
  const files = await loadProjectFiles(projectAbsPath, entry);
  const meta = textEncoder.encode(JSON.stringify(entry, null, 2));
  return zipAsync({ [SYNC_PROJECT_META_FILENAME]: meta, ...files });
}

// ---------------------------------------------------------------------------
// 打包：多项目 bundle
// ---------------------------------------------------------------------------

export interface ProjectSource {
  /** 磁盘上的项目根 */
  projectAbsPath: string;
  /** snapshot 元信息 */
  entry: SyncProjectEntry;
}

export async function packBundle(
  manifest: SyncManifest,
  sources: ProjectSource[],
): Promise<Uint8Array> {
  const root: Zippable = {};
  root[SYNC_BUNDLE_FILENAME] = textEncoder.encode(JSON.stringify(manifest, null, 2));
  for (const src of sources) {
    const slug = src.entry.slug;
    root[`projects/${slug}/${SYNC_PROJECT_META_FILENAME}`] = textEncoder.encode(
      JSON.stringify(src.entry, null, 2),
    );
    for (const file of src.entry.files) {
      const abs = path.join(src.projectAbsPath, file.path);
      const buf = await fs.readFile(abs);
      root[`projects/${slug}/files/${file.path}`] = new Uint8Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength,
      );
    }
  }
  return zipAsync(root);
}

// ---------------------------------------------------------------------------
// 解包
// ---------------------------------------------------------------------------

export interface UnpackedBundle {
  manifest: SyncManifest;
  /** 每个 entry 的 slug -> { meta, files: { relPath -> bytes } } */
  projects: Record<string, { entry: SyncProjectEntry; files: Record<string, Uint8Array> }>;
}

function parseJson<T>(bytes: Uint8Array, where: string): T {
  try {
    return JSON.parse(textDecoder.decode(bytes)) as T;
  } catch (err) {
    throw new FmError('SYNC_BUNDLE_INVALID', `${where} 不是有效 JSON`, err);
  }
}

export async function unpackBundle(zipBytes: Uint8Array): Promise<UnpackedBundle> {
  const all = await unzipAsync(zipBytes);
  const manifestBytes = all[SYNC_BUNDLE_FILENAME];
  if (!manifestBytes) {
    throw new FmError('SYNC_BUNDLE_INVALID', `bundle 缺少 ${SYNC_BUNDLE_FILENAME}`);
  }
  const manifest = parseJson<SyncManifest>(manifestBytes, SYNC_BUNDLE_FILENAME);

  const projects: UnpackedBundle['projects'] = {};
  for (const [name, bytes] of Object.entries(all)) {
    if (!name.startsWith('projects/')) continue;
    const rest = name.slice('projects/'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) continue;
    const slug = rest.slice(0, slashIdx);
    const sub = rest.slice(slashIdx + 1);
    if (!projects[slug]) {
      projects[slug] = { entry: undefined as unknown as SyncProjectEntry, files: {} };
    }
    if (sub === SYNC_PROJECT_META_FILENAME) {
      projects[slug]!.entry = parseJson<SyncProjectEntry>(bytes, `${slug}/${SYNC_PROJECT_META_FILENAME}`);
    } else if (sub.startsWith('files/')) {
      projects[slug]!.files[sub.slice('files/'.length)] = bytes;
    }
  }

  for (const [slug, p] of Object.entries(projects)) {
    if (!p.entry) {
      throw new FmError('SYNC_BUNDLE_INVALID', `项目 ${slug} 缺少 ${SYNC_PROJECT_META_FILENAME}`);
    }
  }

  return { manifest, projects };
}

export async function unpackProjectZip(
  zipBytes: Uint8Array,
): Promise<{ entry: SyncProjectEntry; files: Record<string, Uint8Array> }> {
  const all = await unzipAsync(zipBytes);
  const metaBytes = all[SYNC_PROJECT_META_FILENAME];
  if (!metaBytes) {
    throw new FmError('SYNC_BUNDLE_INVALID', `项目 zip 缺少 ${SYNC_PROJECT_META_FILENAME}`);
  }
  const entry = parseJson<SyncProjectEntry>(metaBytes, SYNC_PROJECT_META_FILENAME);
  const files: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(all)) {
    if (name.startsWith('files/')) files[name.slice('files/'.length)] = bytes;
  }
  return { entry, files };
}

// ---------------------------------------------------------------------------
// 写盘：把项目文件落到目标目录
// ---------------------------------------------------------------------------

/**
 * 将解包后的项目写入目标目录。先写 .tmp，再 rename 进 final；
 * 已有 final 时由调用方决定是否覆盖（这里默认覆盖，先删再 rename）。
 */
export async function materializeProject(
  files: Record<string, Uint8Array>,
  targetAbsPath: string,
  options: { overwrite: boolean } = { overwrite: false },
): Promise<void> {
  const tmpPath = `${targetAbsPath}.fm-tmp-${Date.now().toString(36)}`;
  await fs.mkdir(tmpPath, { recursive: true });
  try {
    for (const [rel, bytes] of Object.entries(files)) {
      const abs = path.join(tmpPath, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, bytes);
    }
    if (options.overwrite) {
      await fs.rm(targetAbsPath, { recursive: true, force: true });
    } else {
      // 若目标已存在则报错
      try {
        await fs.access(targetAbsPath);
        throw new FmError('DUPLICATE_PATH', `目标目录已存在：${targetAbsPath}`);
      } catch (err) {
        if (err instanceof FmError) {
          await fs.rm(tmpPath, { recursive: true, force: true });
          throw err;
        }
        // ENOENT 即未存在，继续
      }
    }
    await fs.rename(tmpPath, targetAbsPath);
  } catch (err) {
    await fs.rm(tmpPath, { recursive: true, force: true }).catch(() => undefined);
    if (err instanceof FmError) throw err;
    throw new FmError('WRITE_FAILED', `写入项目失败：${targetAbsPath}`, err);
  }
}
