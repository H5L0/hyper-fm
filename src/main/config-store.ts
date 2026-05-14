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

const FM_CONFIG_DIR_NAME = '.fm';

export function resolveLocalConfigDir(): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? process.env.HOMEPATH ?? '';
    return normalizePath(path.resolve(home, FM_CONFIG_DIR_NAME));
}

export function resolveLocalConfigPath(configId: string): string {
    return normalizePath(path.resolve(resolveLocalConfigDir(), `${configId}.local.json`));
}

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

/** 返回 exe 同级目录下的默认 shared 配置路径（local 路径由 configId 派生）。 */
export function resolveDefaultSharedConfigPath(execDir: string): string {
    return normalizePath(path.resolve(execDir, DEFAULT_SHARED_CONFIG_FILENAME));
}

// ---------------------------------------------------------------------------
// 兼容迁移
// ---------------------------------------------------------------------------

/**
 * 旧版 local 与 shared 放在同一目录。
 * 如果旧位置存在且 ~/.fm/ 下还没有对应文件，则迁移。
 */
async function tryMigrateLocalConfig(oldLocalPath: string, configId: string): Promise<LocalConfig | null> {
    const newPath = resolveLocalConfigPath(configId);
    if (await exists(newPath)) return null;
    if (!await exists(oldLocalPath)) return null;

    let raw: unknown;
    try {
        raw = JSON.parse(await fs.readFile(oldLocalPath, 'utf8')) as unknown;
    } catch {
        return null;
    }
    const result = validateLocalConfig(raw);
    const local = result.config;
    // 写入新位置（with sharedConfigId）
    const migrated: LocalConfig = { ...local, sharedConfigId: configId };
    await atomicWriteJson(newPath, migrated);
    logger.info('本地配置已迁移', { from: oldLocalPath, to: newPath });
    return migrated;
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

function configPathsFromSharedConfig(sharedPath: string, shared: SharedConfig): ConfigPaths {
    return {
        sharedPath: normalizeConfigFilePath(sharedPath),
        localPath: resolveLocalConfigPath(shared.configId),
        configId: shared.configId,
    };
}

export async function inspectOpenConfig(filePath: string): Promise<ConfigOpenInspection> {
    const selectedPath = normalizeConfigFilePath(filePath);
    if (isLocalConfigPath(selectedPath)) {
        const local = await loadLocalConfig(selectedPath);
        const configId = local.sharedConfigId || '';
        const sharedPath = configId
            ? undefined // can't derive shared path from configId alone; will need knownConfigs
            : deriveSharedConfigPath(selectedPath);
        return {
            selectedPath,
            selectedKind: 'local',
            sharedPath: sharedPath ?? '',
            localPath: selectedPath,
            localExists: true,
        };
    }

    const sharedPath = selectedPath;
    const shared = await loadSharedConfig(sharedPath);
    const localPath = resolveLocalConfigPath(shared.configId);
    const localExists = await exists(localPath);

    // 检查旧位置的 local 是否需要迁移
    const oldLocalPath = deriveLocalConfigPath(sharedPath);
    if (!localExists && (await exists(oldLocalPath))) {
        await tryMigrateLocalConfig(oldLocalPath, shared.configId);
        return {
            selectedPath,
            selectedKind: 'shared',
            sharedPath,
            localPath,
            localExists: await exists(localPath),
        };
    }

    return {
        selectedPath,
        selectedKind: 'shared',
        sharedPath,
        localPath,
        localExists,
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
        paths: configPathsFromSharedConfig(inspection.sharedPath, shared),
        data: composeAppConfig(shared, local),
        hasLoadedConfig: true,
    };
}

export async function saveConfig(paths: ConfigPaths, shared: SharedConfig, local: LocalConfig): Promise<void> {
    const normalizedSharedPath = normalizeConfigFilePath(paths.sharedPath);
    const normalizedLocalPath = paths.localPath || resolveLocalConfigPath(paths.configId);
    await Promise.all([
        atomicWriteJson(normalizedSharedPath, shared),
        atomicWriteJson(normalizedLocalPath, local),
    ]);
    logger.debug('共享/本地配置已保存', { sharedPath: normalizedSharedPath, localPath: normalizedLocalPath });
}

export async function createConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const normalizedSharedPath = normalizeConfigFilePath(sharedPath);
    const shared = createDefaultSharedConfig({ name: deriveDefaultSharedName(normalizedSharedPath) });
    const local = createDefaultLocalConfig(shared.configId);
    const paths = configPathsFromSharedConfig(normalizedSharedPath, shared);

    if ((await exists(paths.sharedPath)) || (await exists(paths.localPath))) {
        throw new FmError('WRITE_FAILED', `目标配置已存在：${paths.sharedPath} / ${paths.localPath}`);
    }
    await saveConfig(paths, shared, local);
    return { paths, data: composeAppConfig(shared, local), hasLoadedConfig: true };
}

async function hasOriginalConfigId(filePath: string): Promise<boolean> {
    try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
        return typeof raw.configId === 'string' && raw.configId.trim() !== '';
    } catch {
        return false;
    }
}

export async function createLocalConfigForShared(sharedPath: string): Promise<ConfigSnapshot> {
    const normalizedSharedPath = normalizeConfigFilePath(sharedPath);
    const shared = await loadSharedConfig(normalizedSharedPath);
    // 若原始 shared 文件缺失 configId（由 validateSharedConfig 自动生成），
    // 必须写回文件，否则下次 loadSharedConfig 生成不同的 configId 导致 local 匹配不上。
    if (!(await hasOriginalConfigId(normalizedSharedPath))) {
        await atomicWriteJson(normalizedSharedPath, shared);
    }
    const localPath = resolveLocalConfigPath(shared.configId);
    if (!(await exists(localPath))) {
        await atomicWriteJson(localPath, createDefaultLocalConfig(shared.configId));
    }
    return loadConfig(normalizedSharedPath);
}

export async function loadOrInitConfig(sharedPath: string): Promise<ConfigSnapshot> {
    const normalizedSharedPath = normalizeConfigFilePath(sharedPath);
    const sharedExists = await exists(normalizedSharedPath);

    if (!sharedExists) {
        logger.info('未发现共享配置，创建默认配置', { sharedPath: normalizedSharedPath });
        await atomicWriteJson(
            normalizedSharedPath,
            createDefaultSharedConfig({ name: deriveDefaultSharedName(normalizedSharedPath) }),
        );
    }

    const shared = await loadSharedConfig(normalizedSharedPath);
    const localPath = resolveLocalConfigPath(shared.configId);
    const localExists = await exists(localPath);

    if (!localExists) {
        // 检查旧位置
        const oldLocalPath = deriveLocalConfigPath(normalizedSharedPath);
        if (await exists(oldLocalPath)) {
            const migrated = await tryMigrateLocalConfig(oldLocalPath, shared.configId);
            if (migrated) {
                return {
                    paths: configPathsFromSharedConfig(normalizedSharedPath, shared),
                    data: composeAppConfig(shared, migrated),
                    hasLoadedConfig: true,
                };
            }
        }
        logger.info('未发现本地配置，创建默认配置', { localPath });
        await atomicWriteJson(localPath, createDefaultLocalConfig(shared.configId));
    }

    return loadConfig(normalizedSharedPath);
}
