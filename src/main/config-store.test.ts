import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    createConfigInDirectory,
    createLocalConfigForShared,
    createConfig,
    deriveLocalConfigPath,
    inspectOpenConfig,
    loadConfig,
    loadOrInitConfig,
    resolveDefaultConfigPaths,
    saveConfig,
} from './config-store.js';
import { createDefaultLocalConfig, createDefaultSharedConfig } from '../shared/schema.js';
import { isFmError } from './fm-error.js';
import { createDefaultSyncConfig } from '../shared/sync-types.js';

async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'fm-config-'));
}

describe('config-store', () => {
    test('[resolveDefaultConfigPaths] 应在指定目录拼接 shared/local 默认文件名', () => {
        const paths = resolveDefaultConfigPaths('/tmp');
        expect(paths.sharedPath).toMatch(/\.local\/fm\.shared\.json$/);
        expect(paths.localPath).toMatch(/\.local\/fm\.local\.json$/);
    });

    test('[deriveLocalConfigPath] 应从 shared 路径推导同目录 local 路径', () => {
        expect(deriveLocalConfigPath('/tmp/foo.shared.json').replace(/\\/g, '/')).toMatch(/\/tmp\/foo\.local\.json$/);
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
        expect(snapshot.paths.sharedPath.replace(/\\/g, '/')).toBe(file.replace(/\\/g, '/'));
        expect(snapshot.paths.localPath.replace(/\\/g, '/')).toBe(path.join(dir, 'fm.local.json').replace(/\\/g, '/'));
        expect(snapshot.data.version).toBe(2);
        expect(snapshot.data.name).toBe('fm');
        expect(snapshot.data.scanRoots).toEqual([]);

        try {
            await createConfig(file);
            throw new Error('未抛出');
        } catch (error) {
            expect(isFmError(error)).toBe(true);
        }
    });

    test('[createConfigInDirectory] 应在指定目录创建默认命名的 shared/local', async () => {
        const dir = await tmpDir();
        const snapshot = await createConfigInDirectory(dir);
        expect(snapshot.paths.sharedPath.replace(/\\/g, '/')).toBe(path.join(dir, 'fm.shared.json').replace(/\\/g, '/'));
        expect(snapshot.paths.localPath.replace(/\\/g, '/')).toBe(path.join(dir, 'fm.local.json').replace(/\\/g, '/'));
    });

    test('[saveConfig + loadConfig] 应写回 shared/local 并能重新加载', async () => {
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'fm.shared.json');
        const localPath = path.join(dir, 'fm.local.json');
        const shared = createDefaultSharedConfig();
        const local = createDefaultLocalConfig(sharedPath);
        shared.projects.push({
            id: 'pj-aaaaaa',
            name: 'demo',
            tags: [],
            ignore: [],
            fingerprint: { kind: 'folder-name', folderName: 'demo' },
        });
        shared.tagGroups = [{ name: '示例组', tags: ['demo'] }];
        local.scanRoots.push({ id: 'root_x', path: 'D:/p', maxDepth: 2, enabled: true });
        local.bindings.push({
            projectId: 'pj-aaaaaa',
            id: 'pj-aaaaaa',
            path: 'D:/p/demo',
            rootId: 'root_x',
            hasMetaFile: false,
            lastScannedAt: '2026-01-01T00:00:00Z',
        });
        shared.syncConfigs = [
            {
                ...createDefaultSyncConfig('shared-dir', 'shared'),
                name: '共享目录',
                sharedDir: { bundleDir: 'D:/sync/team' },
            },
        ];
        local.syncConfigs = [
            {
                ...createDefaultSyncConfig('zip', 'local'),
                name: 'ZIP 备份',
                zip: { exportFile: 'D:/exports/fm.zip' },
            },
        ];
        await saveConfig({ sharedPath, localPath }, shared, local);

        const reloaded = await loadConfig(sharedPath);
        expect(reloaded.data.scanRoots).toHaveLength(1);
        expect(reloaded.data.projects).toHaveLength(1);
        expect(reloaded.data.projects[0]?.path).toBe('D:/p/demo');
        expect(reloaded.data.tagGroups).toEqual([{ name: '示例组', tags: ['demo'] }]);
        expect(reloaded.data.syncConfigs).toHaveLength(2);
        expect(reloaded.paths.localPath.replace(/\\/g, '/')).toBe(localPath.replace(/\\/g, '/'));
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

    test('[inspectOpenConfig] 选择 shared 时应返回对应 local 是否存在', async () => {
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'demo.shared.json');
        await fs.writeFile(sharedPath, JSON.stringify(createDefaultSharedConfig({ name: 'demo' })));
        const inspection = await inspectOpenConfig(sharedPath);
        expect(inspection.selectedKind).toBe('shared');
        expect(inspection.localExists).toBe(false);
        expect(inspection.localPath.replace(/\\/g, '/')).toMatch(/demo\.local\.json$/);
    });

    test('[createLocalConfigForShared] 应为指定 shared 自动创建同名 local', async () => {
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'workspace.shared.json');
        await fs.writeFile(sharedPath, JSON.stringify(createDefaultSharedConfig({ name: 'workspace' })));
        const snapshot = await createLocalConfigForShared(sharedPath);
        expect(snapshot.paths.localPath.replace(/\\/g, '/')).toMatch(/workspace\.local\.json$/);
        const stat = await fs.stat(snapshot.paths.localPath);
        expect(stat.isFile()).toBe(true);
    });

    test('[inspectOpenConfig] 选择 local 时应读取其中记录的 shared 路径', async () => {
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'team.shared.json');
        const localPath = path.join(dir, 'team.local.json');
        await fs.writeFile(sharedPath, JSON.stringify(createDefaultSharedConfig({ name: 'team' })));
        await fs.writeFile(localPath, JSON.stringify(createDefaultLocalConfig(sharedPath)));
        const inspection = await inspectOpenConfig(localPath);
        expect(inspection.selectedKind).toBe('local');
        expect(inspection.sharedPath).toBe(sharedPath.replace(/\\/g, '/'));
    });
});
