import { describe, expect, test } from 'vitest';
import { FAVORITE_TAG_GROUP_NAME, getDynamicTagDefinition } from './dynamic-tags.js';
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
        expect(config.tagGroups).toEqual([{ name: FAVORITE_TAG_GROUP_NAME, tags: [getDynamicTagDefinition('recent-month').label] }]);
    });

    test('[createDefaultSharedConfig] 应预置收藏标签组并默认包含最近一月', () => {
        const config = createDefaultSharedConfig();
        expect(config.tagGroups).toEqual([
            {
                name: FAVORITE_TAG_GROUP_NAME,
                tags: [getDynamicTagDefinition('recent-month').label],
            },
        ]);
    });

    test('[validateSharedConfig] 缺失字段应回退默认值', () => {
        const { config, errors } = validateSharedConfig({});
        expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
        expect(config.name).toBe('fm');
        expect(config.projects).toEqual([]);
        expect(config.ignore.globs.length).toBeGreaterThan(0);
        expect(config.tagGroups).toEqual([{ name: FAVORITE_TAG_GROUP_NAME, tags: [getDynamicTagDefinition('recent-month').label] }]);
        expect(errors).toEqual([]);
    });

    test('[validateLocalConfig] 缺失字段应回退默认值', () => {
        const { config, errors } = validateLocalConfig({});
        expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
        expect(config.sharedConfigId).toBe('');
        expect(config.scanRoots).toEqual([]);
        expect(config.bindings).toEqual([]);
        expect(config.ui.view).toBe('grid');
        expect(errors).toEqual([]);
    });

    test('[validateLocalConfig] 应忽略 local.bindings 中的 lastModifiedAt 持久化字段', () => {
        const { config } = validateLocalConfig({
            bindings: [
                {
                    projectId: 'pj-aaaaaa',
                    path: 'D:/projects/demo',
                    rootId: 'root_1',
                    hasMetaFile: false,
                    lastScannedAt: '2026-01-01T00:00:00Z',
                    lastModifiedAt: '2026-01-02T00:00:00Z',
                },
            ],
        });

        expect(config.bindings[0]).not.toHaveProperty('lastModifiedAt');
    });

    test('[validateLocalConfig] 应保留项目绑定上的命令列表', () => {
        const { config } = validateLocalConfig({
            bindings: [
                {
                    projectId: 'pj-aaaaaa',
                    path: 'D:/projects/demo',
                    rootId: 'root_1',
                    hasMetaFile: false,
                    lastScannedAt: '2026-01-01T00:00:00Z',
                    commands: [
                        {
                            id: 'cmd_1',
                            label: '运行',
                            command: 'pnpm',
                            args: [' dev ', ' --host '],
                            cwd: 'project',
                        },
                    ],
                },
            ],
        });

        expect(config.bindings[0]?.actions).toEqual([
            {
                id: 'cmd_1',
                label: '运行',
                command: 'pnpm',
                args: ['dev', '--host'],
                cwd: 'project',
                description: undefined,
            },
        ]);
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
            path: 'D:/projects/game-a',
            rootId: 'root_1',
            hasMetaFile: true,
            lastScannedAt: '2026-01-01T00:00:00Z',
            actions: [{ id: 'cmd_local', label: '项目动作', command: 'echo project', cwd: 'project' }],
        });
        const project = shared.projects[0]!;
        shared.projects[0] = {
            ...project,
            actions: [{ id: 'cmd_shared', label: '共享动作', command: 'echo shared', cwd: 'project' }],
        };

        const config = composeAppConfig(shared, local);
        expect(config.projects).toHaveLength(1);
        expect(config.projects[0]?.id).toBe('pj-aaaaaa');
        expect(config.projects[0]?.fingerprint.kind).toBe('metadata');
        expect(config.projects[0]?.ignore).toEqual([]);
        expect(config.projects[0]?.favoriteFiles).toEqual([]);
        expect(config.projects[0]?.actions?.map(a => a.id)).toEqual(['cmd_local']);
        expect(config.projects[0]?.sharedActions?.map(a => a.id)).toEqual(['cmd_shared']);
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
                    favoriteFiles: [' src/main.ts ', 'README.md', 'src\\main.ts'],
                    syncRespectGitignore: true,
                    commands: [{ id: 'cmd_shared', label: '共享命令', command: 'pnpm dev', cwd: 'project' }],
                    fingerprint: { kind: 'file-paths', paths: ['package.json', 'src/main.ts'] },
                },
            ],
            tags: [{ name: 'unity', color: '#fff' }],
            tagGroups: [{ name: '引擎项目', tags: ['unity'] }],
        };
        const { config, errors } = validateSharedConfig(input);
        expect(errors).toEqual([]);
        expect(config.name).toBe('workspace');
        expect(config.description).toBe('shared config');
        expect(config.projects[0]?.fingerprint.kind).toBe('file-paths');
        expect(config.projects[0]?.favoriteFiles).toEqual(['README.md', 'src/main.ts']);
        expect(config.projects[0]?.ignore).toEqual(['dist/']);
        expect(config.projects[0]?.syncRespectGitignore).toBe(true);
        expect(config.projects[0]?.actions?.map(a => a.id)).toEqual(['cmd_shared']);
        expect(config.tags?.[0]?.name).toBe('unity');
        expect(config.tagGroups).toEqual([
            { name: FAVORITE_TAG_GROUP_NAME, tags: [getDynamicTagDefinition('recent-month').label] },
            { name: '引擎项目', tags: ['unity'] },
        ]);
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
        const entry0 = config.syncConfigs?.[0];
        const entry1 = config.syncConfigs?.[1];
        expect(entry0?.kind).toBe('standalone');
        expect(entry1?.kind).toBe('standalone');
        if (entry0?.kind === 'standalone') {
            expect(entry0.config.type).toBe('shared-dir');
        }
        if (entry1?.kind === 'standalone') {
            expect(entry1.config.type).toBe('p2p');
            expect(entry1.config.scope).toBe('local');
        }
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
        shared.tagGroups = [
            { name: '客户端', tags: ['electron', 'react'] },
        ];
        local.syncConfigs = [
            {
                kind: 'standalone' as const,
                config: {
                    ...createDefaultSyncConfig('p2p', 'local'),
                    name: '本机 P2P',
                    network: {
                        ...createDefaultSyncConfig('p2p', 'local').network,
                        listenPort: 42555,
                    },
                },
            },
        ];

        const app = composeAppConfig(shared, local);
        expect(app.syncConfigs).toHaveLength(2);
        expect(app.syncConfigs?.map(item => item.scope)).toEqual(['shared', 'local']);

        const nextShared = mergeAppConfigIntoShared(shared, app);
        const nextLocal = mergeAppConfigIntoLocal(app, shared);
        expect(nextShared.syncConfigs).toHaveLength(1);
        expect(nextShared.syncConfigs?.[0]?.scope).toBe('shared');
        expect(nextShared.tagGroups).toEqual([
            { name: FAVORITE_TAG_GROUP_NAME, tags: [getDynamicTagDefinition('recent-month').label] },
            { name: '客户端', tags: ['electron', 'react'] },
        ]);
        // shared-scope configs 转为 override 条目，local-scope 为 standalone
        expect(nextLocal.syncConfigs).toHaveLength(2);
        const overrideEntry = nextLocal.syncConfigs?.find(e => e.kind === 'override');
        const standaloneEntry = nextLocal.syncConfigs?.find(e => e.kind === 'standalone');
        expect(overrideEntry).toBeTruthy();
        expect(standaloneEntry).toBeTruthy();
        if (standaloneEntry?.kind === 'standalone') {
            expect(standaloneEntry.config.scope).toBe('local');
        }
    });

    test('[mergeAppConfigIntoLocal] 不应写入项目目录修改时间等运行时字段', () => {
        const app = createDefaultConfig();
        app.projects = [
            {
                projectId: 'pj-aaaaaa',
                id: 'pj-aaaaaa',
                path: 'D:/projects/demo',
                rootId: 'root_1',
                hasMetaFile: false,
                lastScannedAt: '2026-01-01T00:00:00Z',
                name: 'Demo',
                tags: [],
                ignore: [],
                favoriteFiles: ['README.md', 'src/main.ts'],
                fingerprint: { kind: 'metadata' },
                actions: [{ id: 'cmd_local', label: '本地动作', command: 'echo demo', cwd: 'project' }],
                sharedActions: [{ id: 'cmd_shared', label: '共享动作', command: 'echo shared', cwd: 'project' }],
            },
        ];

        const shared = createDefaultSharedConfig();
        const local = mergeAppConfigIntoLocal(app, shared);
        expect(local.bindings[0]).not.toHaveProperty('lastModifiedAt');
        expect(local.bindings[0]?.actions?.map(a => a.id)).toEqual(['cmd_local']);
    });

    test('[mergeAppConfigIntoShared] 应将项目 favoriteFiles 写回共享配置', () => {
        const shared = createDefaultSharedConfig();
        const app = createDefaultConfig();
        app.projects = [
            {
                projectId: 'pj-aaaaaa',
                id: 'pj-aaaaaa',
                path: 'D:/projects/demo',
                rootId: 'root_1',
                hasMetaFile: false,
                lastScannedAt: '2026-01-01T00:00:00Z',
                name: 'Demo',
                tags: [],
                ignore: [],
                favoriteFiles: ['README.md', 'src/main.ts'],
                fingerprint: { kind: 'metadata' },
            },
        ];

        const nextShared = mergeAppConfigIntoShared(shared, app);
        expect(nextShared.projects[0]?.favoriteFiles).toEqual(['README.md', 'src/main.ts']);
    });

    test('[mergeAppConfigIntoShared] 应将项目 sharedCommands 写回共享配置', () => {
        const shared = createDefaultSharedConfig();
        const app = createDefaultConfig();
        app.projects = [
            {
                projectId: 'pj-aaaaaa',
                id: 'pj-aaaaaa',
                path: 'D:/projects/demo',
                rootId: 'root_1',
                hasMetaFile: false,
                lastScannedAt: '2026-01-01T00:00:00Z',
                name: 'Demo',
                tags: [],
                ignore: [],
                fingerprint: { kind: 'metadata' },
                sharedActions: [{ id: 'cmd_shared', label: '共享动作', command: 'echo shared', cwd: 'project' }],
            },
        ];

        const nextShared = mergeAppConfigIntoShared(shared, app);
        expect(nextShared.projects[0]?.actions?.map(a => a.id)).toEqual(['cmd_shared']);
    });
});
