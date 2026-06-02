import { describe, expect, test } from 'vitest';
import {
    addIgnoredPath,
    addProjectManual,
    addScanRoot,
    applyProjectActionsPatch,
    applyProjectPatch,
    buildProjects,
    mergeScanResult,
    removeProject,
    removeScanRoot,
    updateScanRoot,
} from './project-repo.js';
import { createDefaultLocalConfig, createDefaultSharedConfig } from '../shared/schema.js';
import type { ScanCandidate } from './scanner.js';

function createBase() {
    return {
        shared: createDefaultSharedConfig(),
        local: createDefaultLocalConfig(),
    };
}

describe('project-repo / scan roots', () => {
    test('[addScanRoot] 重复路径应抛错', () => {
        const { local } = createBase();
        const { nextLocal } = addScanRoot(local, { path: 'D:/p' });
        expect(() => addScanRoot(nextLocal, { path: 'd:/p' })).toThrow();
    });

    test('[updateScanRoot] 应能修改 maxDepth 与 enabled', () => {
        const { local } = createBase();
        const { nextLocal } = addScanRoot(local, { path: 'D:/p' });
        const id = nextLocal.scanRoots[0]!.id;
        const out = updateScanRoot(nextLocal, id, { maxDepth: 5, enabled: false });
        expect(out.root.maxDepth).toBe(5);
        expect(out.root.enabled).toBe(false);
    });

    test('[removeScanRoot] 应级联删除 root 下本地绑定与告警', () => {
        const { local } = createBase();
        const { nextLocal } = addScanRoot(local, { path: 'D:/p' });
        const id = nextLocal.scanRoots[0]!.id;
        const updated = {
            ...nextLocal,
            bindings: [
                {
                    projectId: 'pj-aaaaaa',
                    id: 'pj-aaaaaa',
                    path: 'D:/p/x',
                    rootId: id,
                    hasMetaFile: false,
                    lastScannedAt: '2026-01-01T00:00:00Z',
                },
            ],
            warnings: [
                {
                    id: 'warn_1',
                    kind: 'fingerprint-conflict' as const,
                    scanRootId: id,
                    projectId: 'pj-aaaaaa',
                    projectName: 'X',
                    fingerprint: { kind: 'folder-name' as const, folderName: 'X' },
                    candidatePaths: ['D:/p/x', 'D:/p/y'],
                    message: '冲突',
                    createdAt: '2026-01-01T00:00:00Z',
                },
            ],
        };
        const result = removeScanRoot(updated, id);
        expect(result.bindings).toHaveLength(0);
        expect(result.scanRoots).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
    });
});

describe('project-repo / manual add', () => {
    test('[addProjectManual] 应创建共享项目与本地绑定', () => {
        const { shared, local } = createBase();
        const result = addProjectManual(
            shared,
            local,
            {
                path: 'D:/p/demo',
                name: 'Demo',
                tags: ['ts'],
                ignore: ['dist/', ' README.md ', 'dist/'],
                syncRespectGitignore: true,
                fingerprint: { kind: 'folder-name', folderName: 'demo' },
            },
            'win32',
        );
        expect(result.nextShared.projects).toHaveLength(1);
        expect(result.nextLocal.bindings).toHaveLength(1);
        expect(result.project.id).toMatch(/^pj-[a-z0-9]{6}$/);
        expect(result.project.ignore).toEqual(['README.md', 'dist/']);
        expect(result.project.favoriteFiles).toEqual([]);
        expect(result.project.syncRespectGitignore).toBe(true);
        expect(result.project.fingerprint.kind).toBe('folder-name');
    });

    test('[applyProjectPatch] 应更新共享项目元数据', () => {
        const { shared, local } = createBase();
        const added = addProjectManual(
            shared,
            local,
            {
                path: 'D:/p/demo',
                name: 'Demo',
                tags: [],
                fingerprint: { kind: 'metadata' },
            },
            'win32',
        );
        const patched = applyProjectPatch(added.nextShared, added.nextLocal, added.project.id, {
            tags: [' a ', '', 'b'],
            ignore: ['dist/', ' README.md ', ''],
            favoriteFiles: [' src/main.ts ', 'README.md', 'src\\main.ts'],
            syncRespectGitignore: true,
        });
        expect(patched.project.tags).toEqual(['a', 'b']);
        expect(patched.project.ignore).toEqual(['README.md', 'dist/']);
        expect(patched.project.favoriteFiles).toEqual(['README.md', 'src/main.ts']);
        expect(patched.project.syncRespectGitignore).toBe(true);
    });

    test('[applyProjectActionsPatch] 应分别写入本地与共享项目动作', () => {
        const { shared, local } = createBase();
        const added = addProjectManual(
            shared,
            local,
            {
                path: 'D:/p/demo',
                name: 'Demo',
                tags: [],
                fingerprint: { kind: 'metadata' },
            },
            'win32',
        );

        const patched = applyProjectActionsPatch(added.nextShared, added.nextLocal, added.project.id, {
            localActions: [{ id: 'cmd_local', label: '本地动作', command: 'echo local', cwd: 'project' }],
            sharedActions: [{ id: 'cmd_shared', label: '共享动作', command: 'echo shared', cwd: 'project' }],
        });

        expect(patched.nextLocal.bindings[0]?.actions?.map(a => a.id)).toEqual(['cmd_local']);
        expect(patched.nextShared.projects[0]?.actions?.map(a => a.id)).toEqual(['cmd_shared']);
        expect(patched.project.actions?.map(a => a.id)).toEqual(['cmd_local']);
        expect(patched.project.sharedActions?.map(a => a.id)).toEqual(['cmd_shared']);
    });

    test('[removeProject] 应删除共享项目、本地绑定与相关告警', () => {
        const { shared, local } = createBase();
        const added = addProjectManual(
            shared,
            local,
            {
                path: 'D:/p/demo',
                name: 'Demo',
                tags: [],
                fingerprint: { kind: 'metadata' },
            },
            'win32',
        );
        const withWarning = {
            ...added.nextLocal,
            warnings: [
                {
                    id: 'warn_1',
                    kind: 'fingerprint-conflict' as const,
                    scanRootId: 'root_1',
                    projectId: added.project.id,
                    projectName: added.project.name,
                    fingerprint: { kind: 'metadata' as const },
                    candidatePaths: ['D:/p/demo', 'D:/p/demo-copy'],
                    message: '冲突',
                    createdAt: '2026-01-01T00:00:00Z',
                },
            ],
        };
        const removed = removeProject(added.nextShared, withWarning, added.project.id);
        expect(removed.nextShared.projects).toHaveLength(0);
        expect(removed.nextLocal.bindings).toHaveLength(0);
        expect(removed.nextLocal.warnings).toHaveLength(0);
    });
});

describe('project-repo / mergeScanResult', () => {
    test('[mergeScanResult] 扫描只匹配既有项目，不新增共享项目', async () => {
        const { shared, local } = createBase();
        const withProject = addProjectManual(
            shared,
            local,
            {
                path: 'D:/seed/game',
                name: 'Game',
                tags: [],
                fingerprint: { kind: 'folder-name', folderName: 'game' },
            },
            'win32',
        );
        const { nextLocal: withRoot, root } = addScanRoot(withProject.nextLocal, { path: 'D:/scan' });
        const candidates: ScanCandidate[] = [
            {
                path: 'D:/scan/game',
                name: 'game',
                mtime: '2026-01-01T00:00:00Z',
                hasMetaFile: false,
            },
            {
                path: 'D:/scan/new-project',
                name: 'new-project',
                mtime: '2026-01-01T00:00:00Z',
                hasMetaFile: false,
            },
        ];
        const out = await mergeScanResult(
            { shared: withProject.nextShared, local: withRoot, rootId: root.id },
            candidates,
        );
        const projects = buildProjects(withProject.nextShared, out.nextLocal);
        expect(projects).toHaveLength(1);
        expect(projects[0]?.path).toBe('D:/scan/game');
        expect(out.report.added).toBe(0);
        expect(out.report.matched).toBe(1);
    });

    test('[mergeScanResult] folder-name 指纹应大小写不敏感', async () => {
        const { shared, local } = createBase();
        const added = addProjectManual(
            shared,
            local,
            {
                path: 'D:/seed/MyGame',
                name: 'MyGame',
                tags: [],
                fingerprint: { kind: 'folder-name', folderName: 'MyGame' },
            },
            'win32',
        );
        const { nextLocal: withRoot, root } = addScanRoot(added.nextLocal, { path: 'D:/scan' });
        const out = await mergeScanResult(
            { shared: added.nextShared, local: withRoot, rootId: root.id },
            [{ path: 'D:/scan/mygame', name: 'mygame', mtime: '2026-01-01T00:00:00Z', hasMetaFile: false }],
        );
        expect(out.report.matched).toBe(1);
        expect(out.nextLocal.bindings.some(binding => binding.projectId === added.project.id)).toBe(true);
    });

    test('[mergeScanResult] 多目录命中同一指纹应生成告警且不绑定', async () => {
        const { shared, local } = createBase();
        const added = addProjectManual(
            shared,
            local,
            {
                path: 'D:/seed/game',
                name: 'Game',
                tags: [],
                fingerprint: { kind: 'folder-name', folderName: 'game' },
            },
            'win32',
        );
        const { nextLocal: withRoot, root } = addScanRoot(added.nextLocal, { path: 'D:/scan' });
        const out = await mergeScanResult(
            { shared: added.nextShared, local: withRoot, rootId: root.id },
            [
                { path: 'D:/scan/game', name: 'game', mtime: '2026-01-01T00:00:00Z', hasMetaFile: false },
                { path: 'D:/scan/another/game', name: 'game', mtime: '2026-01-01T00:00:00Z', hasMetaFile: false },
            ],
        );
        expect(out.nextLocal.bindings.filter(binding => binding.rootId === root.id)).toHaveLength(0);
        expect(out.nextLocal.warnings).toHaveLength(1);
        expect(out.report.warnings).toBe(1);
    });

    test('[mergeScanResult] 项目重新匹配后应保留项目级命令', async () => {
        const { shared, local } = createBase();
        const added = addProjectManual(
            shared,
            local,
            {
                path: 'D:/seed/game',
                name: 'Game',
                tags: [],
                fingerprint: { kind: 'folder-name', folderName: 'game' },
            },
            'win32',
        );
        const localWithCommands = {
            ...added.nextLocal,
            bindings: added.nextLocal.bindings.map(binding => (
                binding.projectId === added.project.id
                    ? {
                        ...binding,
                        commands: [{ id: 'cmd_project', label: '运行脚本', command: 'pnpm', args: ['dev'], cwd: 'project' as const }],
                    }
                    : binding
            )),
        };
        const { nextLocal: withRoot, root } = addScanRoot(localWithCommands, { path: 'D:/scan' });
        const out = await mergeScanResult(
            { shared: added.nextShared, local: withRoot, rootId: root.id },
            [{ path: 'D:/scan/game', name: 'game', mtime: '2026-01-01T00:00:00Z', hasMetaFile: false }],
        );

        const rebound = out.nextLocal.bindings.find(binding => binding.projectId === added.project.id);
        expect(rebound?.rootId).toBe(root.id);
        expect(rebound?.actions?.map(a => a.id)).toEqual(['cmd_project']);
    });
});

describe('project-repo / local ignore paths', () => {
    test('[addIgnoredPath] 重复添加应保持唯一', () => {
        const { local } = createBase();
        const once = addIgnoredPath(local, 'D:/projects/demo');
        const twice = addIgnoredPath(once, 'd:/projects/demo');
        expect(twice.ignoredPaths).toEqual(['D:/projects/demo']);
    });
});
