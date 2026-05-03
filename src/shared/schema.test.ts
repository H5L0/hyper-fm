import { describe, expect, test } from 'vitest';
import {
    composeAppConfig,
    createDefaultConfig,
    createDefaultLocalConfig,
    createDefaultSharedConfig,
    mergeAppConfigIntoLocal,
    mergeAppConfigIntoShared,
    validateLocalConfig,
    validateSharedConfig,
} from './schema.js';
import { CONFIG_SCHEMA_VERSION } from './types.js';
import { createDefaultSyncConfig } from './sync-types.js';

describe('schema', () => {
    test('[createDefaultConfig] 应返回带默认 shared/local 合并视图的空配置', () => {
        const config = createDefaultConfig();
        expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
        expect(config.scanRoots).toEqual([]);
        expect(config.projects).toEqual([]);
        expect(config.ignore.respectGitignore).toBe(true);
        expect(config.ui.theme).toBe('system');
        expect(config.warnings).toEqual([]);
        expect(config.ignoredPaths).toEqual([]);
    });

    test('[validateSharedConfig] 缺失字段应回退默认值', () => {
        const { config, errors } = validateSharedConfig({});
        expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
        expect(config.name).toBe('fm');
        expect(config.projects).toEqual([]);
        expect(config.ignore.globs.length).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    test('[validateLocalConfig] 缺失字段应回退默认值', () => {
        const { config, errors } = validateLocalConfig({});
        expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
        expect(config.sharedConfigPath).toBe('');
        expect(config.scanRoots).toEqual([]);
        expect(config.bindings).toEqual([]);
        expect(config.ui.view).toBe('grid');
        expect(errors).toEqual([]);
    });

    test('[validateSharedConfig] schema 版本过高应抛出', () => {
        expect(() => validateSharedConfig({ version: 9999 })).toThrow(/schema/);
    });

    test('[validateLocalConfig] 非对象根应抛出', () => {
        expect(() => validateLocalConfig(null)).toThrow();
        expect(() => validateLocalConfig([])).toThrow();
    });

    test('[composeAppConfig] 应只合并已绑定的共享项目', () => {
        const shared = createDefaultSharedConfig();
        shared.projects.push(
            {
                id: 'pj-aaaaaa',
                name: 'Game A',
                tags: ['unity'],
                ignore: [],
                fingerprint: { kind: 'metadata' },
            },
            {
                id: 'pj-bbbbbb',
                name: 'Game B',
                tags: ['rust'],
                ignore: ['dist/'],
                fingerprint: { kind: 'folder-name', folderName: 'game-b' },
            },
        );
        const local = createDefaultLocalConfig();
        local.bindings.push({
            projectId: 'pj-aaaaaa',
            id: 'pj-aaaaaa',
            path: 'D:/projects/game-a',
            rootId: 'root_1',
            hasMetaFile: true,
            lastScannedAt: '2026-01-01T00:00:00Z',
        });

        const config = composeAppConfig(shared, local);
        expect(config.projects).toHaveLength(1);
        expect(config.projects[0]?.id).toBe('pj-aaaaaa');
        expect(config.projects[0]?.fingerprint.kind).toBe('metadata');
        expect(config.projects[0]?.ignore).toEqual([]);
        expect(config.name).toBe('fm');
    });

    test('[validateSharedConfig] 完整有效共享配置应原样保留', () => {
        const input = {
            version: CONFIG_SCHEMA_VERSION,
            name: 'workspace',
            description: 'shared config',
            ignore: { respectGitignore: false, globs: ['x'] },
            projects: [
                {
                    id: 'pj-aaaaaa',
                    name: 'Game',
                    tags: ['unity'],
                    ignore: ['dist/'],
                    fingerprint: { kind: 'file-paths', paths: ['package.json', 'src/main.ts'] },
                },
            ],
            tags: [{ name: 'unity', color: '#fff' }],
        };
        const { config, errors } = validateSharedConfig(input);
        expect(errors).toEqual([]);
        expect(config.name).toBe('workspace');
        expect(config.description).toBe('shared config');
        expect(config.projects[0]?.fingerprint.kind).toBe('file-paths');
        expect(config.projects[0]?.ignore).toEqual(['dist/']);
        expect(config.tags?.[0]?.name).toBe('unity');
    });

    test('[validateLocalConfig] 应兼容旧版 sync 并迁移为 syncConfigs', () => {
        const { config, errors } = validateLocalConfig({
            sync: {
                bundleDir: 'D:/sync',
                network: {
                    listenPort: 42424,
                    autoStart: true,
                    relayMode: true,
                },
            },
        });
        expect(errors).toEqual([]);
        expect(config.syncConfigs).toHaveLength(2);
        expect(config.syncConfigs?.[0]?.type).toBe('shared-dir');
        expect(config.syncConfigs?.[1]?.type).toBe('p2p');
        expect(config.syncConfigs?.[1]?.scope).toBe('local');
    });

    test('[composeAppConfig + mergeAppConfigIntoShared/Local] 应按 scope 拆分并合并 syncConfigs', () => {
        const shared = createDefaultSharedConfig();
        const local = createDefaultLocalConfig();
        shared.syncConfigs = [
            {
                ...createDefaultSyncConfig('shared-dir', 'shared'),
                name: '团队共享',
                sharedDir: { bundleDir: 'D:/team-sync' },
            },
        ];
        local.syncConfigs = [
            {
                ...createDefaultSyncConfig('p2p', 'local'),
                name: '本机 P2P',
                network: {
                    ...createDefaultSyncConfig('p2p', 'local').network,
                    listenPort: 42555,
                },
            },
        ];

        const app = composeAppConfig(shared, local);
        expect(app.syncConfigs).toHaveLength(2);
        expect(app.syncConfigs?.map(item => item.scope)).toEqual(['shared', 'local']);

        const nextShared = mergeAppConfigIntoShared(shared, app);
        const nextLocal = mergeAppConfigIntoLocal(app, 'D:/cfg/fm.shared.json');
        expect(nextShared.syncConfigs).toHaveLength(1);
        expect(nextShared.syncConfigs?.[0]?.scope).toBe('shared');
        expect(nextLocal.syncConfigs).toHaveLength(1);
        expect(nextLocal.syncConfigs?.[0]?.scope).toBe('local');
    });
});
