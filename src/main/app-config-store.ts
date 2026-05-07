import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizePath } from '../shared/path-utils.js';

export const APP_CONFIG_PREF_KEYS = {
    lastSharedConfigPath: 'lastSharedConfigPath',
} as const;

export interface AppConfigStoreBackend {
    readValue(key: string): Promise<string | null>;
    writeValue(key: string, value: string): Promise<void>;
    deleteValue(key: string): Promise<void>;
}

export interface AppConfigStore {
    getString(key: string): Promise<string | null>;
    setString(key: string, value: string): Promise<void>;
    getJson<T>(key: string): Promise<T | null>;
    setJson(key: string, value: unknown): Promise<void>;
    deleteKey(key: string): Promise<void>;
}

interface AppConfigStoreOptions {
    backend?: AppConfigStoreBackend;
    registryPath?: string;
}

function assertAppConfigKey(key: string): string {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
        throw new Error('应用配置键名不能为空');
    }
    return normalizedKey;
}

function encodeRegistryValueName(key: string): string {
    return `pref_${Buffer.from(assertAppConfigKey(key), 'utf8').toString('base64url')}`;
}

function runRegistryCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile('reg.exe', args, {
            windowsHide: true,
            encoding: 'utf8',
        }, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stdout, stderr }));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function isRegistryValueMissing(error: unknown): boolean {
    const commandError = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    const output = `${commandError.stderr ?? ''}\n${commandError.stdout ?? ''}\n${commandError.message ?? ''}`.toLowerCase();
    return commandError.code === 1
        || output.includes('unable to find')
        || output.includes('无法找到');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRegistryQueryValue(stdout: string, valueName: string): string | null {
    const pattern = new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_\\w+\\s+(.*)$`, 'imu');
    const match = stdout.match(pattern);
    if (!match) {
        return null;
    }
    return match[1] ?? '';
}

function createRegistryAppConfigStoreBackend(registryPath: string): AppConfigStoreBackend {
    const normalizedRegistryPath = registryPath.trim();
    if (!normalizedRegistryPath) {
        throw new Error('注册表路径不能为空');
    }
    if (process.platform !== 'win32') {
        throw new Error('Windows 注册表存储仅支持 win32 平台');
    }

    return {
        readValue: async key => {
            const valueName = encodeRegistryValueName(key);
            try {
                const { stdout } = await runRegistryCommand(['query', normalizedRegistryPath, '/v', valueName]);
                return parseRegistryQueryValue(stdout, valueName);
            } catch (error) {
                if (isRegistryValueMissing(error)) {
                    return null;
                }
                throw error;
            }
        },
        writeValue: async (key, value) => {
            await runRegistryCommand([
                'add',
                normalizedRegistryPath,
                '/v',
                encodeRegistryValueName(key),
                '/t',
                'REG_SZ',
                '/d',
                value,
                '/f',
            ]);
        },
        deleteValue: async key => {
            try {
                await runRegistryCommand(['delete', normalizedRegistryPath, '/v', encodeRegistryValueName(key), '/f']);
            } catch (error) {
                if (isRegistryValueMissing(error)) {
                    return;
                }
                throw error;
            }
        },
    };
}

export function resolveAppConfigRegistryPath(appName: string): string {
    const normalizedAppName = appName.trim() || 'hyper-fm';
    return `HKCU\\Software\\${normalizedAppName}\\Prefs`;
}

export function createAppConfigStore(options: AppConfigStoreOptions = {}): AppConfigStore {
    const backend = options.backend
        ?? createRegistryAppConfigStoreBackend(options.registryPath ?? resolveAppConfigRegistryPath('hyper-fm'));

    return {
        getString: async key => {
            const value = await backend.readValue(assertAppConfigKey(key));
            return value === null ? null : String(value);
        },
        setString: async (key, value) => {
            await backend.writeValue(assertAppConfigKey(key), value);
        },
        getJson: async <T>(key: string): Promise<T | null> => {
            const raw = await backend.readValue(assertAppConfigKey(key));
            if (raw === null) {
                return null;
            }
            return JSON.parse(raw) as T;
        },
        setJson: async (key, value) => {
            await backend.writeValue(assertAppConfigKey(key), JSON.stringify(value));
        },
        deleteKey: async key => {
            await backend.deleteValue(assertAppConfigKey(key));
        },
    };
}

function normalizeStoredPath(filePath: string): string {
    return normalizePath(path.resolve(filePath));
}

export async function loadLastSharedConfigPath(store: AppConfigStore): Promise<string | null> {
    const value = await store.getString(APP_CONFIG_PREF_KEYS.lastSharedConfigPath);
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return normalizedValue ? normalizeStoredPath(normalizedValue) : null;
}

export async function saveLastSharedConfigPath(store: AppConfigStore, sharedConfigPath: string): Promise<void> {
    await store.setString(APP_CONFIG_PREF_KEYS.lastSharedConfigPath, normalizeStoredPath(sharedConfigPath));
}

export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(normalizeStoredPath(filePath));
        return true;
    } catch {
        return false;
    }
}

export async function resolveStartupSharedConfigPath(
    store: AppConfigStore,
    defaultSharedPath: string,
    exists: (filePath: string) => Promise<boolean> = pathExists,
): Promise<string | null> {
    const recentSharedPath = await loadLastSharedConfigPath(store);
    if (recentSharedPath && await exists(recentSharedPath)) {
        return recentSharedPath;
    }

    const normalizedDefaultSharedPath = normalizeStoredPath(defaultSharedPath);
    return await exists(normalizedDefaultSharedPath) ? normalizedDefaultSharedPath : null;
}
