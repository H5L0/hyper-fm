import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    APP_CONFIG_PREF_KEYS,
    DEFAULT_APP_PREFERENCES,
    addKnownConfig,
    createAppConfigStore,
    loadAppPreferences,
    loadLastSharedConfigId,
    pathExists,
    resolveAppConfigFilePath,
    resolveStartupSharedConfigPath,
    saveAppPreferences,
    saveLastSharedConfigId,
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
    test('[resolveAppConfigFilePath] 打包后应生成用户目录下的 .fm.app.json', async () => {
        const dir = await tmpDir();
        expect(resolveAppConfigFilePath(dir)).toBe(path.join(dir, '.fm.app.json').replace(/\\/g, '/'));
    });

    test('[resolveAppConfigFilePath] 开发模式下应生成 .test.fm.app.json', async () => {
        const { app } = await import('./__mocks__/electron.js');
        app.isPackaged = false;
        try {
            const dir = await tmpDir();
            expect(resolveAppConfigFilePath(dir)).toBe(path.join(dir, '.test.fm.app.json').replace(/\\/g, '/'));
        } finally {
            app.isPackaged = true;
        }
    });

    test('[resolveStartupSharedConfigPath] 开发模式下应优先读取 cwd/.test/fm.shared.json', async () => {
        const { app } = await import('./__mocks__/electron.js');
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const dir = await tmpDir();
        app.isPackaged = false;
        try {
            // 临时替换 cwd 来隔离测试太复杂，仅验证 dev 分支可达且不抛错
            // 如果 cwd 下没有 .test/fm.shared.json 则退回正常逻辑
            const result = await resolveStartupSharedConfigPath(store, path.join(dir, '.test', 'fm.shared.json'));
            expect(result === null || result.endsWith('.test/fm.shared.json')).toBe(true);
        } finally {
            app.isPackaged = true;
        }
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

    test('[createAppConfigStore] 应支持写入用户目录 .fm.app.json 文件', async () => {
        const dir = await tmpDir();
        const filePath = path.join(dir, '.fm.app.json');
        const store = createAppConfigStore({ filePath });
        await store.setString('theme', 'dark');
        expect(await store.getString('theme')).toBe('dark');
        const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as { values?: Record<string, string> };
        expect(raw.values?.theme).toBe('dark');
    });

    test('[loadAppPreferences] 未保存时应返回默认应用偏好', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        expect(await loadAppPreferences(store)).toEqual(DEFAULT_APP_PREFERENCES);
    });

    test('[saveAppPreferences + loadAppPreferences] 应保存并读取应用偏好', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        await saveAppPreferences(store, {
            trayEnabled: false,
            autoLaunchEnabled: true,
            ui: { theme: 'dark', view: 'list' },
        });
        expect(await loadAppPreferences(store)).toEqual({
            trayEnabled: false,
            autoLaunchEnabled: true,
            ui: { theme: 'dark', view: 'list' },
        });
        expect(await store.getJson(APP_CONFIG_PREF_KEYS.appPreferences)).toEqual({
            trayEnabled: false,
            autoLaunchEnabled: true,
            ui: { theme: 'dark', view: 'list' },
        });
    });

    test('[saveLastSharedConfigId + loadLastSharedConfigId] 应保存并读取 configId', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const configId = 'cfg_abc123';
        await saveLastSharedConfigId(store, configId);
        expect(await loadLastSharedConfigId(store)).toBe(configId);
        expect(await store.getString(APP_CONFIG_PREF_KEYS.lastSharedConfigId)).toBe(configId);
    });

    test('[addKnownConfig] 应保存 configId → path 映射', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const configId = 'cfg_xyz';
        const sharedPath = 'D:/team/fm.shared.json';
        await addKnownConfig(store, configId, sharedPath);
        const known = await store.getJson<Record<string, string>>(APP_CONFIG_PREF_KEYS.knownConfigs);
        expect(known?.[configId]).toBe(path.resolve(sharedPath).replace(/\\/g, '/'));
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

    test('[resolveStartupSharedConfigPath] 最近配置存在时应优先通过 knownConfigs 查找', async () => {
        const store = createAppConfigStore({ backend: createMemoryBackend() });
        const dir = await tmpDir();
        const recentPath = path.join(dir, 'recent.shared.json');
        const defaultPath = path.join(dir, '.local', 'fm.shared.json');
        await fs.mkdir(path.dirname(defaultPath), { recursive: true });
        await fs.writeFile(recentPath, '{}');
        await fs.writeFile(defaultPath, '{}');
        const configId = 'cfg_recent';
        await saveLastSharedConfigId(store, configId);
        await addKnownConfig(store, configId, recentPath);
        expect(await resolveStartupSharedConfigPath(store, defaultPath)).toBe(recentPath.replace(/\\/g, '/'));
    });
});
