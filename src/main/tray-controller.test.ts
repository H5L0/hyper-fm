import { describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../shared/types.js';
import { FAVORITE_TAG_GROUP_NAME } from '../shared/dynamic-tags.js';
import { createDefaultSyncConfig } from '../shared/sync-types.js';
import { listTrayProjectEntries, listTraySyncActions } from './tray-controller.js';

const tempDirs: string[] = [];

async function createTempDir(prefix = 'fm-tray-'): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

async function cleanupTempDirs(): Promise<void> {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
}

function createConfig(projectPath: string): AppConfig {
    return {
        version: 2,
        name: 'fm',
        description: '',
        scanRoots: [],
        ignore: { respectGitignore: true, globs: [] },
        projects: [
            {
                projectId: 'pj-1',
                id: 'pj-1',
                path: projectPath,
                rootId: 'root-1',
                name: 'Alpha',
                description: '',
                tags: ['featured'],
                ignore: [],
                fingerprint: { kind: 'folder-name', folderName: 'alpha' },
                hasMetaFile: false,
                lastScannedAt: '2026-05-09T00:00:00.000Z',
            },
        ],
        ui: { theme: 'system', view: 'grid' },
        warnings: [],
        ignoredPaths: [],
        tagGroups: [{ name: FAVORITE_TAG_GROUP_NAME, tags: ['featured'] }],
        commands: [
            {
                id: 'cmd-1',
                label: '打开 JetBrains IDE',
                command: 'idea64',
                args: ['{{path}}'],
                cwd: 'project',
            },
        ],
        syncConfigs: [
            {
                ...createDefaultSyncConfig('folder', 'local'),
                id: 'sync-folder',
                name: '文件夹同步',
            },
            {
                ...createDefaultSyncConfig('shared-dir', 'shared'),
                id: 'sync-shared',
                name: '共享目录同步',
            },
            {
                ...createDefaultSyncConfig('zip', 'local'),
                id: 'sync-zip',
                name: 'ZIP 备份',
            },
        ],
    };
}

describe('tray-controller', () => {
    test('[listTrayProjectEntries] 应只返回收藏组中的项目并附带常用命令与自定义命令', async () => {
        const dir = await createTempDir();
        const entries = listTrayProjectEntries(createConfig(dir));
        expect(entries).toHaveLength(1);
        expect(entries[0]?.commands.map(command => command.id)).toEqual([
            'open.explorer',
            'open.vscode',
            'open.terminal',
            'cmd-1',
        ]);
        await cleanupTempDirs();
    });

    test('[listTrayProjectEntries] 缺少收藏组时也应虚拟补上并按最近一月筛选', async () => {
        const dir = await createTempDir();
        const config = createConfig(dir);
        config.tagGroups = [{ name: '其他分组', tags: ['sync'] }];

        const entries = listTrayProjectEntries(config);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.projectId).toBe('pj-1');
        await cleanupTempDirs();
    });

    test('[listTraySyncActions] 应仅返回托盘可直接执行的同步配置', () => {
        const actions = listTraySyncActions(createConfig('D:/projects/alpha'));
        expect(actions.map(action => action.configId)).toEqual(['sync-folder', 'sync-shared']);
    });
});
