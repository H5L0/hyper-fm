// ---------------------------------------------------------------------------
// 配置存储：shared / local 加载、保存、原子写入
// 不直接依赖 electron，便于在 vitest（node 环境）中测试
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import {
    type ConfigPaths,
    type ConfigSnapshot,
    type LocalConfig,
    type SharedConfig,
    DEFAULT_LOCAL_CONFIG_FILENAME,
    DEFAULT_SHARED_CONFIG_FILENAME,
} from '../shared/types.js';
import {
    composeAppConfig,
    createDefaultLocalConfig,
    createDefaultSharedConfig,
    validateLocalConfig,
    validateSharedConfig,
} from '../shared/schema.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:config-store');

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

export function deriveLocalConfigPath(sharedConfigPath: string): string {
    return path.resolve(path.dirname(sharedConfigPath), DEFAULT_LOCAL_CONFIG_FILENAME);
}

export function resolveDefaultConfigPaths(execDir: string): ConfigPaths {
    return {
        sharedPath: path.resolve(execDir, DEFAULT_SHARED_CONFIG_FILENAME),
        localPath: path.resolve(execDir, DEFAULT_LOCAL_CONFIG_FILENAME),
    };
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

export async function loadSharedConfig(filePath: string): Promise<SharedConfig> {
    const raw = await readJson(filePath);
    let result;
    try {
        result = validateSharedConfig(raw);
    } catch (error) {
        throw new FmError('CONFIG_INVALID', (error as Error).message, error);
    }
    if (result.errors.length > 0) {
        logger.warn('共享配置存在结构问题，已尽量恢复', { filePath, errors: result.errors });
    }
    return result.config;
}

export async function loadLocalConfig(filePath: string): Promise<LocalConfig> {
    const raw = await readJson(filePath);
    let result;
    try {
        result = validateLocalConfig(raw);
    } catch (error) {
        throw new FmError('CONFIG_INVALID', (error as Error).message, error);
    }
    if (result.errors.length > 0) {
        logger.warn('本地配置存在结构问题，已尽量恢复', { filePath, errors: result.errors });
    }
    return result.config;
}

export async function loadConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const localPath = deriveLocalConfigPath(sharedPath);
    const [shared, local] = await Promise.all([loadSharedConfig(sharedPath), loadLocalConfig(localPath)]);
    return { paths: { sharedPath, localPath }, data: composeAppConfig(shared, local) };
}

export async function saveConfig(paths: ConfigPaths, shared: SharedConfig, local: LocalConfig): Promise<void> {
    await Promise.all([
        atomicWriteJson(paths.sharedPath, shared),
        atomicWriteJson(paths.localPath, local),
    ]);
    logger.debug('共享/本地配置已保存', paths);
}

export async function createConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const paths = { sharedPath, localPath: deriveLocalConfigPath(sharedPath) };
    if ((await exists(paths.sharedPath)) || (await exists(paths.localPath))) {
        throw new FmError('WRITE_FAILED', `目标配置已存在：${paths.sharedPath} / ${paths.localPath}`);
    }
    const shared = createDefaultSharedConfig();
    const local = createDefaultLocalConfig();
    await saveConfig(paths, shared, local);
    return { paths, data: composeAppConfig(shared, local) };
}

export async function loadOrInitConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const paths = { sharedPath, localPath: deriveLocalConfigPath(sharedPath) };
    const sharedExists = await exists(paths.sharedPath);
    const localExists = await exists(paths.localPath);

    if (!sharedExists) {
        logger.info('未发现共享配置，创建默认配置', { sharedPath: paths.sharedPath });
        await atomicWriteJson(paths.sharedPath, createDefaultSharedConfig());
    }
    if (!localExists) {
        logger.info('未发现本地配置，创建默认配置', { localPath: paths.localPath });
        await atomicWriteJson(paths.localPath, createDefaultLocalConfig());
    }
    return loadConfig(paths.sharedPath);
}
