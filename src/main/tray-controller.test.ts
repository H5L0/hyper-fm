import { describe, expect, test } from 'vitest';
import type { AppConfig } from '../shared/types.js';
import { createDefaultSyncConfig } from '../shared/sync-types.js';
import { listTrayProjectEntries, listTraySyncActions } from './tray-controller.js';

function createConfig(): AppConfig {
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
                path: 'D:/projects/alpha',
                rootId: 'root-1',
                name: 'Alpha',
                description: '',
                tags: [],
                ignore: [],
                fingerprint: { kind: 'folder-name', folderName: 'alpha' },
                hasMetaFile: false,
                lastScannedAt: '2026-05-09T00:00:00.000Z',
            },
        ],
        ui: { theme: 'system', view: 'grid' },
        warnings: [],
        ignoredPaths: [],
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
    test('[listTrayProjectEntries] 应为每个项目附带常用命令与自定义命令', () => {
        const entries = listTrayProjectEntries(createConfig());
        expect(entries).toHaveLength(1);
        expect(entries[0]?.commands.map(command => command.id)).toEqual([
            'open.explorer',
            'open.vscode',
            'open.terminal',
            'cmd-1',
        ]);
    });

    test('[listTraySyncActions] 应仅返回托盘可直接执行的同步配置', () => {
        const actions = listTraySyncActions(createConfig());
        expect(actions.map(action => action.configId)).toEqual(['sync-folder', 'sync-shared']);
    });
});
