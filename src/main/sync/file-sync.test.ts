import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createDefaultConfig } from '../../shared/schema.js';
import { SYNC_SCHEMA, createDefaultSyncConfig, type SyncFileEntry, type SyncProjectEntry } from '../../shared/sync-types.js';
import type { Project, ProjectSyncState } from '../../shared/types.js';
import { normalizePath } from '../../shared/path-utils.js';
import { publishToBundleDir, readBundleIndex, readProjectZip } from './dir-bundle.js';
import { applySharedDirSync, buildProjectSyncPlan, previewFolderSync, previewSharedDirSync } from './file-sync.js';
import { buildProjectSnapshot } from './snapshot.js';
import { packProjectZip, unpackProjectZip } from './zip-bundle.js';

const textDecoder = new TextDecoder();
const tempDirs: string[] = [];

function file(path: string, sha1: string, mtime = '2026-01-01T00:00:00Z'): SyncFileEntry {
    return {
        path,
        sha1,
        size: sha1.length,
        mtime,
    };
}

function entry(id: string, files: SyncFileEntry[], hash = `hash-${id}`): SyncProjectEntry {
    return {
        id,
        slug: `${id}-slug`,
        meta: { name: id, tags: [] },
        files,
        hash,
        modifiedAt: '2026-01-01T00:00:00Z',
    };
}

function baseline(path: string, sha1: string): ProjectSyncState {
    return {
        configId: 'sync-folder',
        lastSyncedAt: '2026-01-01T00:00:00Z',
        baselineHash: 'baseline-project',
        baselineFiles: [{ path, sha1 }],
        targetPath: 'D:/target/demo',
    };
}

async function createTempDir(prefix = 'fm-file-sync-'): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

async function writeProjectFiles(rootPath: string, files: Record<string, string>): Promise<void> {
    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = path.join(rootPath, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
    }));
}

function createProject(projectPath: string, overrides: Partial<Project> = {}): Project {
    return {
        projectId: 'pj-demo',
        id: 'pj-demo',
        rootId: '__manual__',
        hasMetaFile: false,
        lastScannedAt: '2026-01-01T00:00:00Z',
        syncedAt: undefined,
        syncedHash: undefined,
        syncedFrom: undefined,
        syncStates: undefined,
        name: 'Demo',
        description: 'demo project',
        tags: [],
        ignore: [],
        fingerprint: { kind: 'metadata' },
        ...overrides,
        path: normalizePath(overrides.path ?? projectPath),
    };
}

function createSharedDirContext(project: Project, bundleDir: string) {
    const syncConfig = createDefaultSyncConfig('shared-dir', 'local');
    syncConfig.id = 'sync-shared';
    syncConfig.name = '共享目录同步';
    syncConfig.sharedDir.bundleDir = bundleDir;

    const config = createDefaultConfig();
    config.projects = [project];
    config.syncConfigs = [syncConfig];

    return { config, syncConfig };
}

async function publishRemoteProject(bundleDir: string, sourcePath: string): Promise<SyncProjectEntry> {
    const remoteEntry = await buildProjectSnapshot({
        projectId: 'pj-demo',
        projectPath: sourcePath,
        meta: {
            name: 'Demo',
            description: 'remote project',
            tags: [],
            ignore: [],
            fingerprint: { kind: 'metadata' },
        },
        ignorePatterns: [],
    });
    const remoteZip = await packProjectZip(sourcePath, remoteEntry);

    await publishToBundleDir(
        bundleDir,
        {
            schema: SYNC_SCHEMA,
            generatedAt: '2026-01-01T00:00:00Z',
            device: { id: 'dev-remote', name: 'Remote' },
            projects: [remoteEntry],
        },
        [{ entry: remoteEntry, zip: remoteZip }],
    );

    return remoteEntry;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('file-sync', () => {
    test('[buildProjectSyncPlan] 双向同步时双方相对基线都变化应标记 conflict', () => {
        const plan = buildProjectSyncPlan({
            projectId: 'pj-demo',
            projectName: 'Demo',
            mode: 'two-way',
            localPath: 'D:/local/demo',
            targetPath: 'D:/target/demo',
            localEntry: entry('pj-demo', [file('src/index.ts', 'local-sha')]),
            targetEntry: entry('pj-demo', [file('src/index.ts', 'target-sha')]),
            baselineState: baseline('src/index.ts', 'baseline-sha'),
        });

        expect(plan.summary.conflict).toBe(1);
        expect(plan.operations[0]).toMatchObject({
            relativePath: 'src/index.ts',
            kind: 'conflict',
            direction: 'none',
        });
    });

    test('[buildProjectSyncPlan] 双向同步时仅本地变化应更新到目标', () => {
        const plan = buildProjectSyncPlan({
            projectId: 'pj-demo',
            projectName: 'Demo',
            mode: 'two-way',
            localPath: 'D:/local/demo',
            targetPath: 'D:/target/demo',
            localEntry: entry('pj-demo', [file('README.md', 'local-next')]),
            targetEntry: entry('pj-demo', [file('README.md', 'baseline-sha')]),
            baselineState: baseline('README.md', 'baseline-sha'),
        });

        expect(plan.summary.update).toBe(1);
        expect(plan.operations[0]).toMatchObject({
            relativePath: 'README.md',
            kind: 'update',
            direction: 'to-target',
        });
    });

    test('[buildProjectSyncPlan] 本地镜像到目标时目标多余文件应删除', () => {
        const plan = buildProjectSyncPlan({
            projectId: 'pj-demo',
            projectName: 'Demo',
            mode: 'mirror-local-to-target',
            localPath: 'D:/local/demo',
            targetPath: 'D:/target/demo',
            localEntry: entry('pj-demo', []),
            targetEntry: entry('pj-demo', [file('dist/old.js', 'target-only')]),
        });

        expect(plan.summary.delete).toBe(1);
        expect(plan.operations[0]).toMatchObject({
            relativePath: 'dist/old.js',
            kind: 'delete',
            direction: 'to-target',
        });
    });

    test('[previewFolderSync] 目标目录无重名时应直接使用原文件夹名', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'workspace/demo');
        const targetDir = normalizePath(path.join(tempRoot, 'target'));

        await fs.mkdir(localProjectDir, { recursive: true });
        await fs.mkdir(targetDir, { recursive: true });
        await writeProjectFiles(localProjectDir, { 'README.md': 'from local' });

        const syncConfig = createDefaultSyncConfig('folder', 'local');
        syncConfig.id = 'sync-folder';
        syncConfig.name = '文件夹同步';
        syncConfig.folder.targetDir = targetDir;

        const config = createDefaultConfig();
        config.projects = [createProject(localProjectDir, { id: 'pj-abc123', projectId: 'pj-abc123', name: '演示项目' })];

        const preview = await previewFolderSync(config, syncConfig, ['pj-abc123']);
        expect(preview.projects[0]?.targetPath).toBe(`${targetDir}/demo`);
    });

    test('[previewFolderSync] 目标目录存在同名文件夹时应切换到冲突父目录', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'workspace/demo');
        const targetDir = normalizePath(path.join(tempRoot, 'target'));

        await fs.mkdir(path.join(targetDir, 'demo'), { recursive: true });
        await fs.mkdir(localProjectDir, { recursive: true });
        await writeProjectFiles(localProjectDir, { 'README.md': 'from local' });

        const syncConfig = createDefaultSyncConfig('folder', 'local');
        syncConfig.id = 'sync-folder';
        syncConfig.name = '文件夹同步';
        syncConfig.folder.targetDir = targetDir;

        const config = createDefaultConfig();
        config.projects = [createProject(localProjectDir, { id: 'pj-abc123', projectId: 'pj-abc123', name: '演示项目' })];

        const preview = await previewFolderSync(config, syncConfig, ['pj-abc123']);
        expect(preview.projects[0]?.targetPath).toBe(`${targetDir}/[pj-abc123]演示项目/demo`);
    });

    test('[previewFolderSync] 多个同名项目时后续项目应自动避让', async () => {
        const tempRoot = await createTempDir();
        const firstProjectDir = path.join(tempRoot, 'workspace/a/demo');
        const secondProjectDir = path.join(tempRoot, 'workspace/b/demo');
        const targetDir = normalizePath(path.join(tempRoot, 'target'));

        await fs.mkdir(firstProjectDir, { recursive: true });
        await fs.mkdir(secondProjectDir, { recursive: true });
        await fs.mkdir(targetDir, { recursive: true });
        await writeProjectFiles(firstProjectDir, { 'a.txt': 'A' });
        await writeProjectFiles(secondProjectDir, { 'b.txt': 'B' });

        const syncConfig = createDefaultSyncConfig('folder', 'local');
        syncConfig.id = 'sync-folder';
        syncConfig.name = '文件夹同步';
        syncConfig.folder.targetDir = targetDir;

        const config = createDefaultConfig();
        config.projects = [
            createProject(firstProjectDir, { id: 'pj-first1', projectId: 'pj-first1', name: '第一个项目' }),
            createProject(secondProjectDir, { id: 'pj-second', projectId: 'pj-second', name: '第二个项目' }),
        ];

        const preview = await previewFolderSync(config, syncConfig, ['pj-first1', 'pj-second']);
        expect(preview.projects[0]?.targetPath).toBe(`${targetDir}/demo`);
        expect(preview.projects[1]?.targetPath).toBe(`${targetDir}/[pj-second]第二个项目/demo`);
    });

    test('[previewFolderSync] 已记录的新规则目标路径应保持稳定', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'workspace/demo');
        const targetDir = normalizePath(path.join(tempRoot, 'target'));

        await fs.mkdir(localProjectDir, { recursive: true });
        await fs.mkdir(targetDir, { recursive: true });
        await writeProjectFiles(localProjectDir, { 'README.md': 'from local' });

        const syncConfig = createDefaultSyncConfig('folder', 'local');
        syncConfig.id = 'sync-folder';
        syncConfig.name = '文件夹同步';
        syncConfig.folder.targetDir = targetDir;

        const config = createDefaultConfig();
        config.projects = [createProject(localProjectDir, {
            id: 'pj-abc123',
            projectId: 'pj-abc123',
            name: '演示项目',
            syncStates: [{
                configId: syncConfig.id,
                lastSyncedAt: '2026-01-01T00:00:00.000Z',
                baselineHash: 'hash-demo',
                baselineFiles: [],
                targetPath: `${targetDir}/[pj-abc123]演示项目/demo`,
            }],
        })];

        const preview = await previewFolderSync(config, syncConfig, ['pj-abc123']);
        expect(preview.projects[0]?.targetPath).toBe(`${targetDir}/[pj-abc123]演示项目/demo`);
    });

    test('[previewSharedDirSync] 共享目录已有最新项目时应生成拉取到本地的计划', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'local-demo');
        const remoteProjectDir = path.join(tempRoot, 'remote-demo');
        const bundleDir = path.join(tempRoot, 'bundle');

        await fs.mkdir(localProjectDir, { recursive: true });
        await fs.mkdir(remoteProjectDir, { recursive: true });
        await writeProjectFiles(remoteProjectDir, { 'README.md': 'from remote' });
        await publishRemoteProject(bundleDir, remoteProjectDir);

        const project = createProject(localProjectDir);
        const { config, syncConfig } = createSharedDirContext(project, bundleDir);
        const preview = await previewSharedDirSync(config, syncConfig);

        expect(preview.projects).toHaveLength(1);
        expect(preview.projects[0]).toMatchObject({
            projectId: 'pj-demo',
            summary: expect.objectContaining({ create: 1, total: 1 }),
        });
        expect(preview.projects[0]!.targetPath).toContain(`${normalizePath(bundleDir)}/devices/dev-remote/projects/`);
        expect(preview.projects[0]!.operations).toContainEqual(expect.objectContaining({
            relativePath: 'README.md',
            kind: 'create',
            direction: 'to-local',
        }));
    });

    test('[applySharedDirSync] 共享目录存在更新时应写回本地并更新基线', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'local-demo');
        const remoteProjectDir = path.join(tempRoot, 'remote-demo');
        const bundleDir = path.join(tempRoot, 'bundle');

        await fs.mkdir(localProjectDir, { recursive: true });
        await fs.mkdir(remoteProjectDir, { recursive: true });
        await writeProjectFiles(remoteProjectDir, {
            'README.md': 'from remote',
            'src/index.ts': 'export const remote = true;\n',
        });
        await publishRemoteProject(bundleDir, remoteProjectDir);

        const project = createProject(localProjectDir);
        const { config, syncConfig } = createSharedDirContext(project, bundleDir);
        const { result, nextConfig } = await applySharedDirSync(config, syncConfig);

        expect(result.projects).toHaveLength(1);
        expect(result.projects[0]!.applied.create).toBe(2);
        expect(await fs.readFile(path.join(localProjectDir, 'README.md'), 'utf-8')).toBe('from remote');

        const updatedProject = nextConfig.projects[0]!;
        expect(updatedProject.syncedFrom).toBe('dev-remote');
        const syncState = updatedProject.syncStates?.find(item => item.configId === syncConfig.id);
        expect(syncState?.targetPath).toContain(`${normalizePath(bundleDir)}/devices/dev-remote/projects/`);
        expect(syncState?.baselineFiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'README.md' }),
            expect.objectContaining({ path: 'src/index.ts' }),
        ]));
    });

    test('[applySharedDirSync] 首次推送本地项目时应回写共享目录索引与项目 zip', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'local-demo');
        const bundleDir = path.join(tempRoot, 'bundle');

        await fs.mkdir(localProjectDir, { recursive: true });
        await writeProjectFiles(localProjectDir, {
            'README.md': 'from local',
            'src/index.ts': 'export const local = true;\n',
        });

        const project = createProject(localProjectDir);
        const { config, syncConfig } = createSharedDirContext(project, bundleDir);
        const { result, nextConfig } = await applySharedDirSync(config, syncConfig);

        expect(result.projects).toHaveLength(1);
        expect(result.projects[0]!.applied.create).toBe(2);
        expect(nextConfig.devices?.selfId).toBeTruthy();

        const updatedProject = nextConfig.projects[0]!;
        const syncState = updatedProject.syncStates?.find(item => item.configId === syncConfig.id);
        expect(syncState?.targetPath).toContain(normalizePath(bundleDir));
        expect(syncState?.baselineFiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'README.md' }),
            expect.objectContaining({ path: 'src/index.ts' }),
        ]));

        const index = await readBundleIndex(bundleDir);
        const latest = index.latest['pj-demo'];
        expect(latest).toBeDefined();
        expect(latest?.deviceId).toBe(nextConfig.devices?.selfId);

        const zip = await readProjectZip(bundleDir, nextConfig.devices!.selfId, latest!.slug);
        const unpacked = await unpackProjectZip(zip);
        expect(textDecoder.decode(unpacked.files['README.md']!)).toBe('from local');
        expect(textDecoder.decode(unpacked.files['src/index.ts']!)).toBe('export const local = true;\n');
    });

    test('[applySharedDirSync] 禁用更新条目后再次预览仍应保持原同步方向', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'local-demo');
        const remoteProjectDir = path.join(tempRoot, 'remote-demo');
        const bundleDir = path.join(tempRoot, 'bundle');

        await fs.mkdir(localProjectDir, { recursive: true });
        await fs.mkdir(remoteProjectDir, { recursive: true });
        await writeProjectFiles(localProjectDir, { 'README.md': 'from local\n' });
        await writeProjectFiles(remoteProjectDir, { 'README.md': 'from remote\n' });
        const remoteEntry = await publishRemoteProject(bundleDir, remoteProjectDir);

        const baselineFile = remoteEntry.files.find(item => item.path === 'README.md');
        const project: Project = {
            ...createProject(localProjectDir),
            syncStates: [{
                configId: 'sync-shared',
                lastSyncedAt: '2026-01-01T00:00:00Z',
                baselineHash: remoteEntry.hash,
                baselineFiles: baselineFile ? [{ path: baselineFile.path, sha1: baselineFile.sha1 }] : [],
                targetPath: `${normalizePath(bundleDir)}/devices/dev-remote/projects/${remoteEntry.slug}`,
            }],
        };

        const { config, syncConfig } = createSharedDirContext(project, bundleDir);
        const { result, nextConfig } = await applySharedDirSync(config, syncConfig, undefined, {
            projectIds: ['pj-demo'],
            operations: [{
                projectId: 'pj-demo',
                relativePath: 'README.md',
                enabled: false,
            }],
        });

        expect(result.projects[0]!.applied.skip).toBe(1);

        const preview = await previewSharedDirSync(nextConfig, syncConfig);
        expect(preview.projects[0]!.operations).toContainEqual(expect.objectContaining({
            relativePath: 'README.md',
            kind: 'update',
            direction: 'to-target',
        }));
    });

    test('[applySharedDirSync] 冲突选择保留远程时应以远程内容覆盖本地', async () => {
        const tempRoot = await createTempDir();
        const localProjectDir = path.join(tempRoot, 'local-demo');
        const remoteProjectDir = path.join(tempRoot, 'remote-demo');
        const bundleDir = path.join(tempRoot, 'bundle');

        await fs.mkdir(localProjectDir, { recursive: true });
        await fs.mkdir(remoteProjectDir, { recursive: true });
        await writeProjectFiles(localProjectDir, { 'README.md': 'local change\n' });
        await writeProjectFiles(remoteProjectDir, { 'README.md': 'remote change\n' });
        const remoteEntry = await publishRemoteProject(bundleDir, remoteProjectDir);

        const project: Project = {
            ...createProject(localProjectDir),
            syncStates: [{
                configId: 'sync-shared',
                lastSyncedAt: '2026-01-01T00:00:00Z',
                baselineHash: 'baseline-hash',
                baselineFiles: [{ path: 'README.md', sha1: 'baseline-sha' }],
                targetPath: `${normalizePath(bundleDir)}/devices/dev-remote/projects/${remoteEntry.slug}`,
            }],
        };

        const { config, syncConfig } = createSharedDirContext(project, bundleDir);
        const { result } = await applySharedDirSync(config, syncConfig, undefined, {
            projectIds: ['pj-demo'],
            operations: [{
                projectId: 'pj-demo',
                relativePath: 'README.md',
                enabled: true,
                conflictResolution: 'keep-target',
            }],
        });

        expect(result.projects[0]!.applied.update).toBe(1);
        expect(result.projects[0]!.applied.conflict).toBe(0);
        expect(await fs.readFile(path.join(localProjectDir, 'README.md'), 'utf-8')).toBe('remote change\n');
    });
});
