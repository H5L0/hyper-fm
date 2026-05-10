import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAVORITE_TAG_GROUP_NAME, getDynamicTagDefinition } from '../shared/dynamic-tags.js';
import {
    createConfig,
    deriveLocalConfigPath,
    inspectOpenConfig,
    loadConfig,
    loadOrInitConfig,
    resolveLocalConfigPath,
    saveConfig,
} from './config-store.js';
import { createDefaultLocalConfig, createDefaultSharedConfig } from '../shared/schema.js';
import { isFmError } from './fm-error.js';
import { createDefaultSyncConfig } from '../shared/sync-types.js';

async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'fm-config-'));
}

describe('config-store', () => {
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
        // local 写入 ~/.fm/<configId>.local.json
        expect(snapshot.paths.localPath).toBeTruthy();
        expect(snapshot.paths.localPath.replace(/\\/g, '/')).toBe(
            snapshot.paths.localPath.replace(/\\/g, '/'),
        );
        expect(snapshot.data.version).toBe(2);
        expect(snapshot.data.name).toBe('fm');
        expect(snapshot.data.scanRoots).toEqual([]);
        expect(snapshot.data.tagGroups).toEqual([
            { name: FAVORITE_TAG_GROUP_NAME, tags: [getDynamicTagDefinition('recent-month').label] },
        ]);

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
        const shared = createDefaultSharedConfig();
        const local = createDefaultLocalConfig(shared.configId);
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
                kind: 'standalone' as const,
                config: {
                    ...createDefaultSyncConfig('zip', 'local'),
                    name: 'ZIP 备份',
                    zip: { exportFile: 'D:/exports/fm.zip' },
                },
            },
        ];
        const localPath = resolveLocalConfigPath(shared.configId);
        await saveConfig({ sharedPath, localPath, configId: shared.configId }, shared, local);

        const reloaded = await loadConfig(sharedPath);
        expect(reloaded.data.scanRoots).toHaveLength(1);
        expect(reloaded.data.projects).toHaveLength(1);
        expect(reloaded.data.projects[0]?.path).toBe('D:/p/demo');
        expect(reloaded.data.tagGroups).toEqual([
            { name: FAVORITE_TAG_GROUP_NAME, tags: [getDynamicTagDefinition('recent-month').label] },
            { name: '示例组', tags: ['demo'] },
        ]);
        expect(reloaded.data.syncConfigs).toHaveLength(2);
        expect(reloaded.paths.localPath.replace(/\\/g, '/')).toBe(localPath.replace(/\\/g, '/'));
    });

    test('[loadOrInitConfig] 不存在时应初始化 shared/local', async () => {
        const file = path.join(await tmpDir(), 'fm.shared.json');
        const snap = await loadOrInitConfig(file);
        expect(snap.data.version).toBe(2);
        const sharedExists = await fs.stat(file);
        expect(sharedExists.isFile()).toBe(true);
        // local 现在写入 ~/.fm/<configId>.local.json
        expect(snap.paths.localPath).toBeTruthy();
        const localExists = await fs.stat(snap.paths.localPath);
        expect(localExists.isFile()).toBe(true);
    });

    test('[inspectOpenConfig] 选择 shared 时应返回对应 local 是否存在（local 路径由 configId 派生）', async () => {
        const dir = await tmpDir();
        const sharedPath = path.join(dir, 'demo.shared.json');
        const shared = createDefaultSharedConfig({ name: 'demo' });
        await fs.writeFile(sharedPath, JSON.stringify(shared));
        const inspection = await inspectOpenConfig(sharedPath);
        expect(inspection.selectedKind).toBe('shared');
        expect(inspection.localExists).toBe(false);
        expect(inspection.localPath).toBe(resolveLocalConfigPath(shared.configId));
    });

    test('[inspectOpenConfig] 选择 local 时 configId 存在则无法反推 shared 路径', async () => {
        const dir = await tmpDir();
        const shared = createDefaultSharedConfig({ name: 'team' });
        const sharedPath = path.join(dir, 'team.shared.json');
        const localPath = path.join(dir, 'team.local.json');
        await fs.writeFile(sharedPath, JSON.stringify(shared));
        await fs.writeFile(localPath, JSON.stringify(createDefaultLocalConfig(shared.configId)));
        const inspection = await inspectOpenConfig(localPath);
        expect(inspection.selectedKind).toBe('local');
        // 有 configId 时无法从 local 反推 shared 路径
        expect(inspection.sharedPath).toBe('');
    });
});
