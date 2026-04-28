// ---------------------------------------------------------------------------
// .meta-data 文件读写
// 与项目根目录关联；schema 校验保持宽松（未知字段保留以便未来扩展）
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import { META_FILE_NAME, META_SCHEMA, type MetaFile } from '../shared/types.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:meta-file');

function metaPath(projectDir: string): string {
  return path.join(projectDir, META_FILE_NAME);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(item => typeof item === 'string');
}

function parseMeta(raw: string, source: string): MetaFile {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new FmError('CONFIG_INVALID', `${source} 不是合法 JSON`, error);
  }
  if (!isObject(value)) {
    throw new FmError('CONFIG_INVALID', `${source} 根必须为对象`);
  }
  return {
    schema: META_SCHEMA,
    name: typeof value.name === 'string' ? value.name : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    tags: isStringArray(value.tags) ? value.tags : undefined,
    ignore: isStringArray(value.ignore) ? value.ignore : undefined,
  };
}

export async function readMetaFile(projectDir: string): Promise<MetaFile | null> {
  const file = metaPath(projectDir);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return parseMeta(raw, file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new FmError('CONFIG_INVALID', `读取 .meta-data 失败：${file}`, error);
  }
}

export async function writeMetaFile(projectDir: string, meta: Omit<MetaFile, 'schema'>): Promise<void> {
  const file = metaPath(projectDir);
  const payload: MetaFile = { schema: META_SCHEMA, ...meta };
  // strip undefined for cleaner JSON
  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined),
  );
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
    logger.debug('已写入 .meta-data', { file });
  } catch (error) {
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore
    }
    throw new FmError('WRITE_FAILED', `写入 .meta-data 失败：${file}`, error);
  }
}

export async function removeMetaFile(projectDir: string): Promise<void> {
  const file = metaPath(projectDir);
  try {
    await fs.unlink(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new FmError('WRITE_FAILED', `删除 .meta-data 失败：${file}`, error);
  }
}

export async function metaFileExists(projectDir: string): Promise<boolean> {
  try {
    await fs.access(metaPath(projectDir));
    return true;
  } catch {
    return false;
  }
}
