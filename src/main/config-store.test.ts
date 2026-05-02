import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    createConfig,
    deriveLocalConfigPath,
    loadConfig,
    loadOrInitConfig,
    resolveDefaultConfigPaths,
    saveConfig,
} from './config-store.js';
import { createDefaultLocalConfig, createDefaultSharedConfig } from '../shared/schema.js';
import { isFmError } from './fm-error.js';

async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'fm-config-'));
}

describe('config-store', () => {
    test('[resolveDefaultConfigPaths] 应在指定目录拼接 shared/local 默认文件名', () => {
        const paths = resolveDefaultConfigPaths('/tmp');
        expect(paths.sharedPath).toMatch(/fm\.shared\.json$/);
        expect(paths.localPath).toMatch(/fm\.local\.json$/);
    });

    test('[deriveLocalConfigPath] 应从 shared 路径推导同目录 local 路径', () => {
        expect(deriveLocalConfigPath('/tmp/foo.json').replace(/\\/g, '/')).toMatch(/\/tmp\/fm\.local\.json$/);
    });

    test('[loadConfig] 文件不存在应抛 FmError(CONFIG_NOT_FOUND)', async () => {
        try {
            await loadConfig(path.join(await tmpDir(), 'missing.shared.json'));
            throw new Error('未抛出');
        } catch (error) {
            expect(isFmError(error)).toBe(true);
            expect((error as { code: string }).code).toBe('CONFIG_NOT_FOUND');
        }
    });

    test('[createConfig] 应同时写入 shared/local 且重复创建报错', async () => {
        const dir = await tmpDir();
        const file = path.join(dir, 'fm.shared.json');
        const snapshot = await createConfig(file);
        expect(snapshot.paths.sharedPath).toBe(file);
        expect(snapshot.paths.localPath).toBe(path.join(dir, 'fm.local.json'));
        expect(snapshot.data.version).toBe(2);
        expect(snapshot.data.scanRoots).toEqual([]);

        try {
            await createConfig(file);
            throw new Error('未抛出');
        } catch (error) {
            expect(isFmError(error)).toBe(true);
        }
    });

    test('[saveConfig + loadConfig] 应写回 shared/local 并能重新加载', async () => {
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'fm.shared.json');
        const localPath = path.join(dir, 'fm.local.json');
        const shared = createDefaultSharedConfig();
        const local = createDefaultLocalConfig();
        shared.projects.push({
            id: 'pj-aaaaaa',
            name: 'demo',
            tags: [],
            fingerprint: { kind: 'folder-name', folderName: 'demo' },
        });
        local.scanRoots.push({ id: 'root_x', path: 'D:/p', maxDepth: 2, enabled: true });
        local.bindings.push({
            projectId: 'pj-aaaaaa',
            id: 'pj-aaaaaa',
            path: 'D:/p/demo',
            rootId: 'root_x',
            hasMetaFile: false,
            lastScannedAt: '2026-01-01T00:00:00Z',
        });
        await saveConfig({ sharedPath, localPath }, shared, local);

        const reloaded = await loadConfig(sharedPath);
        expect(reloaded.data.scanRoots).toHaveLength(1);
        expect(reloaded.data.projects).toHaveLength(1);
        expect(reloaded.data.projects[0]?.path).toBe('D:/p/demo');
    });

    test('[loadOrInitConfig] 不存在时应初始化 shared/local', async () => {
        const file = path.join(await tmpDir(), 'fm.shared.json');
        const snap = await loadOrInitConfig(file);
        expect(snap.data.version).toBe(2);
        const sharedExists = await fs.stat(file);
        const localExists = await fs.stat(path.join(path.dirname(file), 'fm.local.json'));
        expect(sharedExists.isFile()).toBe(true);
        expect(localExists.isFile()).toBe(true);
    });
});
