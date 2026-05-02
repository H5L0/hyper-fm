import { describe, expect, test } from 'vitest';
import {
    composeAppConfig,
    createDefaultConfig,
    createDefaultLocalConfig,
    createDefaultSharedConfig,
    validateLocalConfig,
    validateSharedConfig,
} from './schema.js';
import { CONFIG_SCHEMA_VERSION } from './types.js';

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
});
