// ---------------------------------------------------------------------------
// 配置存储：shared / local 加载、保存、原子写入
// 不直接依赖 electron，便于在 vitest（node 环境）中测试
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import {
    type ConfigOpenInspection,
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
import { basename, normalizePath } from '../shared/path-utils.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:config-store');

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

function normalizeConfigFilePath(filePath: string): string {
    return normalizePath(path.resolve(filePath));
}

function replaceConfigSuffix(fileName: string, fromSuffix: RegExp, fallbackSuffix: string): string {
    if (fromSuffix.test(fileName)) {
        return fileName.replace(fromSuffix, fallbackSuffix);
    }
    if (/\.json$/i.test(fileName)) {
        return fileName.replace(/\.json$/i, fallbackSuffix);
    }
    return `${fileName}${fallbackSuffix}`;
}

function deriveDefaultSharedName(sharedConfigPath: string): string {
    const fileName = basename(sharedConfigPath);
    return fileName
        .replace(/\.shared\.json$/i, '')
        .replace(/\.json$/i, '')
        .trim() || 'fm';
}

export function isLocalConfigPath(filePath: string): boolean {
    return normalizeConfigFilePath(filePath).toLowerCase().endsWith('.local.json');
}

export function isSharedConfigPath(filePath: string): boolean {
    return normalizeConfigFilePath(filePath).toLowerCase().endsWith('.shared.json');
}

export function deriveLocalConfigPath(sharedConfigPath: string): string {
    const normalized = normalizeConfigFilePath(sharedConfigPath);
    const fileName = basename(normalized);
    const localName = replaceConfigSuffix(fileName, /\.shared\.json$/i, '.local.json');
    return normalizePath(path.resolve(path.dirname(normalized), localName));
}

export function deriveSharedConfigPath(localConfigPath: string): string {
    const normalized = normalizeConfigFilePath(localConfigPath);
    const fileName = basename(normalized);
    const sharedName = replaceConfigSuffix(fileName, /\.local\.json$/i, '.shared.json');
    return normalizePath(path.resolve(path.dirname(normalized), sharedName));
}

export function resolveDefaultConfigPaths(execDir: string): ConfigPaths {
    return {
        sharedPath: normalizePath(path.resolve(execDir, DEFAULT_SHARED_CONFIG_FILENAME)),
        localPath: normalizePath(path.resolve(execDir, DEFAULT_LOCAL_CONFIG_FILENAME)),
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
    return {
        ...result.config,
        sharedConfigPath: result.config.sharedConfigPath
            ? normalizeConfigFilePath(result.config.sharedConfigPath)
            : '',
    };
}

export async function inspectOpenConfig(filePath: string): Promise<ConfigOpenInspection> {
    const selectedPath = normalizeConfigFilePath(filePath);
    if (isLocalConfigPath(selectedPath)) {
        const local = await loadLocalConfig(selectedPath);
        const sharedPath = local.sharedConfigPath
            ? normalizeConfigFilePath(local.sharedConfigPath)
            : deriveSharedConfigPath(selectedPath);
        return {
            selectedPath,
            selectedKind: 'local',
            sharedPath,
            localPath: selectedPath,
            localExists: true,
        };
    }

    const sharedPath = selectedPath;
    const localPath = deriveLocalConfigPath(sharedPath);
    return {
        selectedPath,
        selectedKind: 'shared',
        sharedPath,
        localPath,
        localExists: await exists(localPath),
    };
}

export async function loadConfig(filePath: string): Promise<ConfigSnapshot> {
    const inspection = await inspectOpenConfig(filePath);
    if (!inspection.localExists) {
        throw new FmError('CONFIG_NOT_FOUND', `未找到对应本地配置：${inspection.localPath}`);
    }
    const [shared, local] = await Promise.all([
        loadSharedConfig(inspection.sharedPath),
        loadLocalConfig(inspection.localPath),
    ]);
    return {
        paths: { sharedPath: inspection.sharedPath, localPath: inspection.localPath },
        data: composeAppConfig(shared, { ...local, sharedConfigPath: inspection.sharedPath }),
    };
}

export async function saveConfig(paths: ConfigPaths, shared: SharedConfig, local: LocalConfig): Promise<void> {
    const normalizedPaths = {
        sharedPath: normalizeConfigFilePath(paths.sharedPath),
        localPath: normalizeConfigFilePath(paths.localPath),
    };
    await Promise.all([
        atomicWriteJson(normalizedPaths.sharedPath, shared),
        atomicWriteJson(normalizedPaths.localPath, {
            ...local,
            sharedConfigPath: normalizedPaths.sharedPath,
        }),
    ]);
    logger.debug('共享/本地配置已保存', normalizedPaths);
}

export async function createConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const normalizedSharedPath = normalizeConfigFilePath(sharedPath);
    const paths = { sharedPath: normalizedSharedPath, localPath: deriveLocalConfigPath(normalizedSharedPath) };
    if ((await exists(paths.sharedPath)) || (await exists(paths.localPath))) {
        throw new FmError('WRITE_FAILED', `目标配置已存在：${paths.sharedPath} / ${paths.localPath}`);
    }
    const shared = createDefaultSharedConfig({ name: deriveDefaultSharedName(paths.sharedPath) });
    const local = createDefaultLocalConfig(paths.sharedPath);
    await saveConfig(paths, shared, local);
    return { paths, data: composeAppConfig(shared, local) };
}

export async function createLocalConfigForShared(sharedPath: string): Promise<ConfigSnapshot> {
    const normalizedSharedPath = normalizeConfigFilePath(sharedPath);
    await loadSharedConfig(normalizedSharedPath);
    const localPath = deriveLocalConfigPath(normalizedSharedPath);
    if (!(await exists(localPath))) {
        await atomicWriteJson(localPath, createDefaultLocalConfig(normalizedSharedPath));
    }
    return loadConfig(normalizedSharedPath);
}

export async function loadOrInitConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const normalizedSharedPath = normalizeConfigFilePath(sharedPath);
    const paths = { sharedPath: normalizedSharedPath, localPath: deriveLocalConfigPath(normalizedSharedPath) };
    const sharedExists = await exists(paths.sharedPath);
    const localExists = await exists(paths.localPath);

    if (!sharedExists) {
        logger.info('未发现共享配置，创建默认配置', { sharedPath: paths.sharedPath });
        await atomicWriteJson(
            paths.sharedPath,
            createDefaultSharedConfig({ name: deriveDefaultSharedName(paths.sharedPath) }),
        );
    }
    if (!localExists) {
        logger.info('未发现本地配置，创建默认配置', { localPath: paths.localPath });
        await atomicWriteJson(paths.localPath, createDefaultLocalConfig(paths.sharedPath));
    }
    return loadConfig(paths.sharedPath);
}
