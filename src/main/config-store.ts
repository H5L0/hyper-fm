// ---------------------------------------------------------------------------
// 配置存储：加载 / 保存 / 原子写入
// 不直接依赖 electron，便于在 vitest（node 环境）中测试
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import {
  type AppConfig,
  type ConfigSnapshot,
  DEFAULT_CONFIG_FILENAME,
} from '../shared/types.js';
import { createDefaultConfig, validateConfig } from '../shared/schema.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:config-store');

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

/**
 * 解析默认配置路径：与可执行文件（或开发模式 cwd）同级的 fm.config.json。
 * 调用方（main/index.ts）可改用 app.getPath('userData') 等替代。
 */
export function resolveDefaultConfigPath(execDir: string): string {
  return path.resolve(execDir, DEFAULT_CONFIG_FILENAME);
}

// ---------------------------------------------------------------------------
// 文件 IO
// ---------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new FmError('CONFIG_NOT_FOUND', `配置文件不存在：${filePath}`);
    }
    throw new FmError('CONFIG_INVALID', `配置文件读取失败：${filePath}`, error);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new FmError('CONFIG_INVALID', `配置文件不是合法 JSON：${filePath}`, error);
  }
}

/** 原子写入：先写 .tmp 再 rename */
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, filePath);
  } catch (error) {
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw new FmError('WRITE_FAILED', `配置写入失败：${filePath}`, error);
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

export async function loadConfig(filePath: string): Promise<ConfigSnapshot> {
  const raw = await readJson(filePath);
  let result;
  try {
    result = validateConfig(raw);
  } catch (error) {
    throw new FmError('CONFIG_INVALID', (error as Error).message, error);
  }
  if (result.errors.length > 0) {
    logger.warn('配置存在结构问题，已尽量恢复', { filePath, errors: result.errors });
  }
  return { path: filePath, data: result.config };
}

export async function saveConfig(filePath: string, data: AppConfig): Promise<void> {
  await atomicWriteJson(filePath, data);
  logger.debug('配置已保存', { filePath });
}

/**
 * 创建默认配置：若路径已存在则报错，避免覆盖用户文件。
 */
export async function createConfig(filePath: string): Promise<ConfigSnapshot> {
  if (await exists(filePath)) {
    throw new FmError('WRITE_FAILED', `目标文件已存在：${filePath}`);
  }
  const data = createDefaultConfig();
  await atomicWriteJson(filePath, data);
  return { path: filePath, data };
}

/**
 * 加载或初始化：若文件不存在则在该路径创建默认配置。
 */
export async function loadOrInitConfig(filePath: string): Promise<ConfigSnapshot> {
  if (!(await exists(filePath))) {
    logger.info('未发现配置，创建默认配置', { filePath });
    return createConfig(filePath);
  }
  return loadConfig(filePath);
}
