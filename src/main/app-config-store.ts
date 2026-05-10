import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePath } from '../shared/path-utils.js';
import type { AppPreferences } from '../shared/types.js';

export const APP_CONFIG_PREF_KEYS = {
    appPreferences: 'appPreferences',
    lastSharedConfigId: 'lastSharedConfigId',
    knownConfigs: 'knownConfigs',
} as const;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
    trayEnabled: true,
    autoLaunchEnabled: false,
    ui: {
        theme: 'system',
        view: 'grid',
    },
};

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
    filePath?: string;
}

interface AppConfigFileShape {
    version: 1;
    values: Record<string, string>;
}

function assertAppConfigKey(key: string): string {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
        throw new Error('应用配置键名不能为空');
    }
    return normalizedKey;
}

function normalizeAppConfigFilePath(filePath: string): string {
    const normalizedFilePath = filePath.trim();
    if (!normalizedFilePath) {
        throw new Error('应用配置文件路径不能为空');
    }
    return normalizePath(path.resolve(normalizedFilePath));
}

function isFileMissing(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: unknown }).code === 'ENOENT';
}

function isRenameReplaceError(error: unknown): boolean {
    const code = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    return code === 'EPERM' || code === 'EEXIST';
}

function normalizeStoredValues(input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object') {
        return {};
    }

    const container = 'values' in input
        && input.values
        && typeof input.values === 'object'
        ? input.values
        : input;

    return Object.fromEntries(
        Object.entries(container as Record<string, unknown>)
            .filter(([key, value]) => key !== 'version' && typeof value === 'string')
            .map(([key, value]) => [key, value as string] as const),
    );
}

async function readAppConfigFile(filePath: string): Promise<AppConfigFileShape> {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        return {
            version: 1,
            values: normalizeStoredValues(parsed),
        };
    } catch (error) {
        if (isFileMissing(error)) {
            return { version: 1, values: {} };
        }
        throw error;
    }
}

async function writeAppConfigFile(filePath: string, data: AppConfigFileShape): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf8');
    try {
        await fs.rename(tempPath, filePath);
    } catch (error) {
        if (!isRenameReplaceError(error)) {
            throw error;
        }
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath);
    }
}

function createFileAppConfigStoreBackend(filePath: string): AppConfigStoreBackend {
    const normalizedFilePath = normalizeAppConfigFilePath(filePath);

    return {
        readValue: async key => {
            const data = await readAppConfigFile(normalizedFilePath);
            return data.values[assertAppConfigKey(key)] ?? null;
        },
        writeValue: async (key, value) => {
            const data = await readAppConfigFile(normalizedFilePath);
            const next: AppConfigFileShape = {
                version: 1,
                values: {
                    ...data.values,
                    [assertAppConfigKey(key)]: value,
                },
            };
            await writeAppConfigFile(normalizedFilePath, next);
        },
        deleteValue: async key => {
            const data = await readAppConfigFile(normalizedFilePath);
            const normalizedKey = assertAppConfigKey(key);
            if (!(normalizedKey in data.values)) {
                return;
            }
            const nextValues = { ...data.values };
            delete nextValues[normalizedKey];
            if (Object.keys(nextValues).length === 0) {
                await fs.rm(normalizedFilePath, { force: true });
                return;
            }
            await writeAppConfigFile(normalizedFilePath, {
                version: 1,
                values: nextValues,
            });
        },
    };
}

export function resolveAppConfigFilePath(homeDir = os.homedir()): string {
    const normalizedHomeDir = homeDir.trim();
    if (!normalizedHomeDir) {
        throw new Error('用户目录不能为空');
    }
    return normalizePath(path.resolve(normalizedHomeDir, '.fm.json'));
}

export function createAppConfigStore(options: AppConfigStoreOptions = {}): AppConfigStore {
    const backend = options.backend
        ?? createFileAppConfigStoreBackend(options.filePath ?? resolveAppConfigFilePath());

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

function normalizeAppPreferences(value: Partial<AppPreferences> | null | undefined): AppPreferences {
    const uiValue = value?.ui;
    return {
        trayEnabled: typeof value?.trayEnabled === 'boolean'
            ? value.trayEnabled
            : DEFAULT_APP_PREFERENCES.trayEnabled,
        autoLaunchEnabled: typeof value?.autoLaunchEnabled === 'boolean'
            ? value.autoLaunchEnabled
            : DEFAULT_APP_PREFERENCES.autoLaunchEnabled,
        ui: {
            theme: uiValue?.theme === 'light' || uiValue?.theme === 'dark' || uiValue?.theme === 'system'
                ? uiValue.theme
                : DEFAULT_APP_PREFERENCES.ui.theme,
            view: uiValue?.view === 'grid' || uiValue?.view === 'list'
                ? uiValue.view
                : DEFAULT_APP_PREFERENCES.ui.view,
        },
    };
}

export async function loadAppPreferences(store: AppConfigStore): Promise<AppPreferences> {
    const value = await store.getJson<Partial<AppPreferences>>(APP_CONFIG_PREF_KEYS.appPreferences);
    return normalizeAppPreferences(value);
}

export async function saveAppPreferences(
    store: AppConfigStore,
    value: Partial<AppPreferences> | AppPreferences,
): Promise<AppPreferences> {
    const normalizedValue = normalizeAppPreferences(value);
    await store.setJson(APP_CONFIG_PREF_KEYS.appPreferences, normalizedValue);
    return normalizedValue;
}

// ---- configId → sharedPath 映射 (knownConfigs) ----

export async function loadKnownConfigs(store: AppConfigStore): Promise<Record<string, string>> {
    const value = await store.getJson<Record<string, string>>(APP_CONFIG_PREF_KEYS.knownConfigs);
    if (!value || typeof value !== 'object') return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
        if (k.trim() && typeof v === 'string' && v.trim()) {
            clean[k.trim()] = v.trim();
        }
    }
    return clean;
}

export async function addKnownConfig(store: AppConfigStore, configId: string, sharedPath: string): Promise<void> {
    const known = await loadKnownConfigs(store);
    known[configId] = normalizeStoredPath(sharedPath);
    await store.setJson(APP_CONFIG_PREF_KEYS.knownConfigs, known);
}

// ---- lastSharedConfigId ----

export async function loadLastSharedConfigId(store: AppConfigStore): Promise<string | null> {
    const value = await store.getString(APP_CONFIG_PREF_KEYS.lastSharedConfigId);
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return normalizedValue || null;
}

export async function saveLastSharedConfigId(store: AppConfigStore, configId: string): Promise<void> {
    await store.setString(APP_CONFIG_PREF_KEYS.lastSharedConfigId, configId.trim());
}

// ---- 兼容旧版 lastSharedConfigPath ----

async function tryLoadLegacyLastSharedConfigPath(store: AppConfigStore): Promise<string | null> {
    const value = await store.getString('lastSharedConfigPath');
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return normalizedValue ? normalizeStoredPath(normalizedValue) : null;
}

// ---- 启动路径解析 ----

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
    // 1. 通过 lastSharedConfigId + knownConfigs 查找
    const configId = await loadLastSharedConfigId(store);
    if (configId) {
        const knownConfigs = await loadKnownConfigs(store);
        const knownPath = knownConfigs[configId];
        if (knownPath && await exists(knownPath)) {
            return knownPath;
        }
        // configId 存在但路径映射丢失，无法恢复
    }

    // 2. 兼容旧版 lastSharedConfigPath
    const legacyPath = await tryLoadLegacyLastSharedConfigPath(store);
    if (legacyPath && await exists(legacyPath)) {
        return legacyPath;
    }

    // 3. 默认路径
    const normalizedDefaultSharedPath = normalizeStoredPath(defaultSharedPath);
    return await exists(normalizedDefaultSharedPath) ? normalizedDefaultSharedPath : null;
}
