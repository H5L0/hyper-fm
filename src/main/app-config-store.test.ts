import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    APP_CONFIG_PREF_KEYS,
    createAppConfigStore,
    loadLastSharedConfigPath,
    pathExists,
    resolveAppConfigRegistryPath,
    resolveStartupSharedConfigPath,
    saveLastSharedConfigPath,
    type AppConfigStoreBackend,
} from './app-config-store.js';

async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'fm-app-config-'));
}

function createMemoryBackend(): AppConfigStoreBackend {
    const values = new Map<string, string>();
    return {
        readValue: async key => values.get(key) ?? null,
        writeValue: async (key, value) => {
            values.set(key, value);
        },
        deleteValue: async key => {
            values.delete(key);
        },
    };
}

describe('app-config-store', () => {
    test('[resolveAppConfigRegistryPath] 应生成 Prefs 注册表路径', () => {
        expect(resolveAppConfigRegistryPath('hyper-fm')).toBe('HKCU\\Software\\hyper-fm\\Prefs');
    });

    test('[createAppConfigStore] 应支持读写字符串值', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        await store.setString('theme', 'dark');
        expect(await store.getString('theme')).toBe('dark');
    });

    test('[createAppConfigStore] 应支持读写 JSON 值', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        await store.setJson('window.bounds', { width: 1280, height: 800 });
        expect(await store.getJson<{ width: number; height: number }>('window.bounds')).toEqual({ width: 1280, height: 800 });
    });

    test('[createAppConfigStore] 应支持删除指定 key', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        await store.setString('language', 'zh-CN');
        await store.deleteKey('language');
        expect(await store.getString('language')).toBeNull();
    });

    test('[saveLastSharedConfigPath + loadLastSharedConfigPath] 应保存并读取最近一次 shared 配置路径', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'workspace.shared.json');
        await saveLastSharedConfigPath(store, sharedPath);
        expect(await loadLastSharedConfigPath(store)).toBe(sharedPath.replace(/\\/g, '/'));
        expect(await store.getString(APP_CONFIG_PREF_KEYS.lastSharedConfigPath)).toBe(sharedPath.replace(/\\/g, '/'));
    });

    test('[resolveStartupSharedConfigPath] 无最近配置且默认配置不存在时应返回 null', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const dir = await tmpDir();
        expect(await resolveStartupSharedConfigPath(store, path.join(dir, '.local', 'fm.shared.json'))).toBeNull();
    });

    test('[resolveStartupSharedConfigPath] 默认配置存在时应回退到默认配置', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const dir = await tmpDir();
        const defaultPath = path.join(dir, '.local', 'fm.shared.json');
        await fs.mkdir(path.dirname(defaultPath), { recursive: true });
        await fs.writeFile(defaultPath, '{}');
        expect(await resolveStartupSharedConfigPath(store, defaultPath)).toBe(defaultPath.replace(/\\/g, '/'));
        expect(await pathExists(defaultPath)).toBe(true);
    });

    test('[resolveStartupSharedConfigPath] 最近配置存在时应优先返回最近配置', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const dir = await tmpDir();
        const recentPath = path.join(dir, 'recent.shared.json');
        const defaultPath = path.join(dir, '.local', 'fm.shared.json');
        await fs.mkdir(path.dirname(defaultPath), { recursive: true });
        await fs.writeFile(recentPath, '{}');
        await fs.writeFile(defaultPath, '{}');
        await saveLastSharedConfigPath(store, recentPath);
        expect(await resolveStartupSharedConfigPath(store, defaultPath)).toBe(recentPath.replace(/\\/g, '/'));
    });
});
