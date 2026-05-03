import type {
    AppBridge,
    AppConfig,
    ConfigOpenInspection,
    ConfigSnapshot,
    FmBridge,
    ManualProjectInput,
    ManualProjectValidationResult,
    Project,
    ProjectDirectoryEntry,
    ProjectDirectoryInspection,
    ProjectFingerprint,
    ProjectMetaPatch,
    ScanReport,
    ScanRoot,
    SyncConfig,
    SyncImportResult,
    SyncProjectRule,
    SyncPullResult,
    TagDefinition,
} from '@shared/bridge.js';
import {
    PRESET_COMMANDS,
    createDefaultSyncConfig,
    type CommandRunResult,
    type CustomCommand,
    type DeviceRegistry,
    type SyncDiff,
    type SyncManifest,
    type SyncProjectEntry,
} from '@shared/sync-types.js';
import { normalizeSyncConfig, setProjectSyncRule } from '@shared/sync-config.js';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deriveLocalPath(sharedPath: string): string {
    if (!sharedPath) return 'browser://fm.local.json';
    if (/\.shared\.json$/iu.test(sharedPath)) {
        return sharedPath.replace(/\.shared\.json$/iu, '.local.json');
    }
    if (/\.json$/iu.test(sharedPath)) {
        return sharedPath.replace(/\.json$/iu, '.local.json');
    }
    return `${sharedPath}.local.json`;
}

function nowIso(): string {
    return new Date().toISOString();
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').trim();
}

function lastSegment(path: string): string {
    return normalizePath(path).split('/').filter(Boolean).pop() ?? 'untitled-project';
}

function sameFingerprint(a: ProjectFingerprint, b: ProjectFingerprint): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'metadata') return true;
    if (a.kind === 'folder-name' && b.kind === 'folder-name') {
        return a.folderName.trim().toLowerCase() === b.folderName.trim().toLowerCase();
    }
    if (a.kind === 'file-paths' && b.kind === 'file-paths') {
        return a.paths.length === b.paths.length && a.paths.every((item, index) => item === b.paths[index]);
    }
    return false;
}

function normalizeFingerprint(fingerprint: ProjectFingerprint): ProjectFingerprint {
    if (fingerprint.kind === 'metadata') return { kind: 'metadata' };
    if (fingerprint.kind === 'folder-name') {
        return { kind: 'folder-name', folderName: fingerprint.folderName.trim() };
    }
    return {
        kind: 'file-paths',
        paths: [...new Set(fingerprint.paths.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort(),
    };
}

function createSampleConfig(): AppConfig {
    const baseTags: TagDefinition[] = [
        { name: 'electron', color: '#60a5fa' },
        { name: 'tooling', color: '#34d399' },
        { name: 'sync', color: '#f59e0b' },
    ];
    const rootId = 'root_demo';
    const projects: Project[] = [
        {
            projectId: 'pj-demo01',
            id: 'pj-demo01',
            path: 'D:/projects/fm',
            rootId,
            name: 'fm',
            description: '浏览器模式下的示例项目，用来检查前端布局与交互。',
            tags: ['electron', 'tooling'],
            ignore: ['README.md'],
            fingerprint: { kind: 'metadata' },
            hasMetaFile: true,
            lastScannedAt: nowIso(),
            lastModifiedAt: nowIso(),
        },
        {
            projectId: 'pj-demo02',
            id: 'pj-demo02',
            path: 'D:/projects/fm-sync-playground',
            rootId,
            name: 'fm-sync-playground',
            description: '用于展示标签、搜索和命令入口的第二个示例项目。',
            tags: ['sync'],
            ignore: [],
            fingerprint: { kind: 'folder-name', folderName: 'fm-sync-playground' },
            hasMetaFile: false,
            lastScannedAt: nowIso(),
            lastModifiedAt: nowIso(),
        },
    ];

    return {
        version: 2,
        name: 'fm 浏览器预览',
        description: '用于浏览器模式下验证 UI 交互的示例配置。',
        scanRoots: [
            {
                id: rootId,
                path: 'D:/projects',
                label: '浏览器示例根目录',
                maxDepth: 3,
                enabled: true,
            },
        ],
        ignore: {
            respectGitignore: true,
            globs: ['node_modules', '.git', 'dist'],
        },
        projects,
        ui: { theme: 'system', view: 'grid' },
        warnings: [
            {
                id: 'warn-demo-01',
                kind: 'fingerprint-conflict',
                scanRootId: rootId,
                projectId: 'pj-demo02',
                projectName: 'fm-sync-playground',
                fingerprint: { kind: 'folder-name', folderName: 'fm-sync-playground' },
                candidatePaths: ['D:/projects/fm-sync-playground', 'D:/archive/fm-sync-playground'],
                message: '浏览器模式示例：同名目录冲突不会自动绑定。',
                createdAt: nowIso(),
            },
        ],
        ignoredPaths: [],
        tags: baseTags,
        devices: {
            selfId: 'dev-browser',
            selfName: 'Browser Preview',
            known: [{ id: 'dev-desktop', name: 'Desktop', lastSeenAt: nowIso() }],
        },
        syncConfigs: [
            normalizeSyncConfig({
                ...createDefaultSyncConfig('shared-dir', 'shared'),
                name: '团队共享目录',
                sharedDir: { bundleDir: 'D:/OneDrive/fm-sync' },
            }),
            normalizeSyncConfig({
                ...createDefaultSyncConfig('zip', 'local'),
                name: '离线 ZIP 备份',
                zip: { exportFile: 'D:/exports/fm-backup.zip' },
            }),
            normalizeSyncConfig({
                ...createDefaultSyncConfig('p2p', 'local'),
                name: '局域网 P2P',
                network: {
                    ...createDefaultSyncConfig('p2p', 'local').network,
                    listenPort: 41555,
                },
            }),
        ],
        commands: [
            {
                id: 'cmd-demo-01',
                label: '运行预览命令',
                command: 'echo browser-preview',
                cwd: 'project',
                description: '浏览器 mock 命令，不会真的执行。',
            },
        ],
    };
}

const browserState: {
    snapshot: ConfigSnapshot;
    runningServers: string[];
    nextProjectPick: number;
    nextScanRootPick: number;
} = {
    snapshot: {
        paths: {
            sharedPath: 'browser://fm.shared.json',
            localPath: 'browser://fm.local.json',
        },
        data: createSampleConfig(),
    },
    runningServers: [],
    nextProjectPick: 1,
    nextScanRootPick: 1,
};

function upsertSyncConfig(syncConfig: SyncConfig): SyncConfig {
    const current = browserState.snapshot.data.syncConfigs ?? [];
    const exists = current.some(item => item.id === syncConfig.id);
    const syncConfigs = exists
        ? current.map(item => (item.id === syncConfig.id ? syncConfig : item))
        : [...current, syncConfig];
    updateConfig({ ...browserState.snapshot.data, syncConfigs });
    return clone(syncConfig);
}

function getSnapshot(): ConfigSnapshot {
    return clone(browserState.snapshot);
}

function updateConfig(next: AppConfig): void {
    browserState.snapshot = {
        ...browserState.snapshot,
        data: clone(next),
    };
}

function updateProject(id: string, patch: Partial<Project>): Project {
    const projects = browserState.snapshot.data.projects.map(project =>
        project.id === id ? { ...project, ...patch } : project,
    );
    updateConfig({ ...browserState.snapshot.data, projects });
    const project = projects.find(item => item.id === id);
    if (!project) throw new Error(`项目不存在：${id}`);
    return clone(project);
}

function validateNewProject(input: ManualProjectInput): ManualProjectValidationResult {
    const path = normalizePath(input.path);
    const fingerprint = normalizeFingerprint(input.fingerprint);
    const conflicts = browserState.snapshot.data.projects.flatMap(project => {
        const reasons: string[] = [];
        if (normalizePath(project.path).toLowerCase() === path.toLowerCase()) {
            reasons.push('该目录已绑定到现有项目。');
        }
        if (sameFingerprint(project.fingerprint, fingerprint)) {
            reasons.push('该指纹与现有项目完全相同。');
        }
        return reasons.map(reason => ({
            projectId: project.id,
            projectName: project.name,
            reason,
        }));
    });
    return { valid: conflicts.length === 0, conflicts };
}

function createProjectFromInput(input: ManualProjectInput): Project {
    const projectId = `pj-${Math.random().toString(36).slice(2, 8)}`;
    return {
        projectId,
        id: projectId,
        path: normalizePath(input.path),
        rootId: browserState.snapshot.data.scanRoots[0]?.id ?? 'manual',
        name: input.name?.trim() || lastSegment(input.path),
        description: input.description?.trim() || undefined,
        tags: input.tags?.map(tag => tag.trim()).filter(Boolean) ?? [],
        ignore: [],
        fingerprint: normalizeFingerprint(input.fingerprint),
        hasMetaFile: input.fingerprint.kind === 'metadata',
        lastScannedAt: nowIso(),
        lastModifiedAt: nowIso(),
    };
}

function buildMockInspection(path: string, projectIgnore: readonly string[] = []): ProjectDirectoryInspection {
    const normalizedPath = normalizePath(path);
    const existingProject = browserState.snapshot.data.projects.find(project => normalizePath(project.path) === normalizedPath);
    const projectIgnored = new Set(projectIgnore.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean));
    const tree: ProjectDirectoryEntry[] = [
        {
            path: 'node_modules',
            name: 'node_modules',
            kind: 'folder',
            ignoredBy: 'global',
        },
        {
            path: 'src',
            name: 'src',
            kind: 'folder',
            ...(projectIgnored.has('src') || projectIgnored.has('src/')
                ? { ignoredBy: 'project' as const }
                : {
                    children: [
                        { path: 'src/App.tsx', name: 'App.tsx', kind: 'file' as const },
                        { path: 'src/main.ts', name: 'main.ts', kind: 'file' as const },
                    ],
                }),
        },
        {
            path: 'README.md',
            name: 'README.md',
            kind: 'file',
            ...(projectIgnored.has('README.md') ? { ignoredBy: 'project' as const } : {}),
        },
        {
            path: 'package.json',
            name: 'package.json',
            kind: 'file',
        },
        {
            path: 'dist',
            name: 'dist',
            kind: 'folder',
            ignoredBy: 'global',
        },
    ];

    const files = ['package.json'];
    if (!(projectIgnored.has('src') || projectIgnored.has('src/'))) {
        files.push('src/App.tsx', 'src/main.ts');
    }
    if (!projectIgnored.has('README.md')) {
        files.push('README.md');
    }

    return {
        path: normalizedPath,
        suggestedName: lastSegment(path),
        hasMetaFile: existingProject?.hasMetaFile ?? false,
        metaProjectId: existingProject?.hasMetaFile ? existingProject.id : undefined,
        tree,
        files: files.sort(),
    };
}

function pickMockProjectDirectory(): string {
    const path = `D:/projects/browser-added-${browserState.nextProjectPick}`;
    browserState.nextProjectPick += 1;
    return path;
}

function pickMockScanRootDirectory(): string {
    const path = `D:/scan-roots/browser-root-${browserState.nextScanRootPick}`;
    browserState.nextScanRootPick += 1;
    return path;
}

export function ensureBrowserBridge(): void {
    if (typeof window === 'undefined') return;
    if (window.fm && window.app) return;

    const appApi: AppBridge = {
        getAppInfo: async () => ({
            appName: 'fm (browser preview)',
            appVersion: '0.1.0',
            platform: 'win32',
            electronVersion: 'browser-mock',
        }),
        ping: async (message: string) => `pong: ${message}`,
    };

    const fmApi: FmBridge = {
        config: {
            current: async () => getSnapshot(),
            inspectOpen: async (filePath: string): Promise<ConfigOpenInspection> => ({
                selectedPath: filePath,
                selectedKind: filePath.endsWith('.local.json') ? 'local' : 'shared',
                sharedPath: filePath.endsWith('.local.json') ? filePath.replace(/\.local\.json$/iu, '.shared.json') : filePath,
                localPath: filePath.endsWith('.local.json') ? filePath : deriveLocalPath(filePath),
                localExists: true,
            }),
            load: async (filePath: string) => {
                browserState.snapshot.paths = {
                    sharedPath: filePath.endsWith('.local.json') ? filePath.replace(/\.local\.json$/iu, '.shared.json') : filePath,
                    localPath: filePath.endsWith('.local.json') ? filePath : deriveLocalPath(filePath),
                };
                return getSnapshot();
            },
            create: async (filePath: string) => {
                browserState.snapshot = {
                    paths: {
                        sharedPath: filePath,
                        localPath: deriveLocalPath(filePath),
                    },
                    data: {
                        ...createSampleConfig(),
                        name: lastSegment(filePath).replace(/\.shared\.json$/iu, '').replace(/\.json$/iu, ''),
                    },
                };
                return getSnapshot();
            },
            createLocalForShared: async (sharedPath: string) => {
                browserState.snapshot.paths = {
                    sharedPath,
                    localPath: deriveLocalPath(sharedPath),
                };
                return getSnapshot();
            },
            save: async (data: AppConfig) => {
                updateConfig(data);
            },
            pick: async () => null,
        },
        scanRoots: {
            add: async input => {
                const root: ScanRoot = {
                    id: `root_${Math.random().toString(36).slice(2, 8)}`,
                    path: normalizePath(input.path),
                    label: input.label,
                    maxDepth: input.maxDepth ?? 3,
                    enabled: true,
                };
                updateConfig({
                    ...browserState.snapshot.data,
                    scanRoots: [...browserState.snapshot.data.scanRoots, root],
                });
                return clone(root);
            },
            update: async (id, patch) => {
                const roots = browserState.snapshot.data.scanRoots.map(root =>
                    root.id === id ? { ...root, ...patch } : root,
                );
                updateConfig({ ...browserState.snapshot.data, scanRoots: roots });
                const root = roots.find(item => item.id === id);
                if (!root) throw new Error(`扫描根不存在：${id}`);
                return clone(root);
            },
            remove: async id => {
                updateConfig({
                    ...browserState.snapshot.data,
                    scanRoots: browserState.snapshot.data.scanRoots.filter(root => root.id !== id),
                });
            },
            pickDirectory: async () => pickMockScanRootDirectory(),
        },
        scan: {
            runAll: async (): Promise<ScanReport[]> =>
                browserState.snapshot.data.scanRoots.map(root => ({
                    rootId: root.id,
                    scanned: 0,
                    matched: 0,
                    added: 0,
                    updated: 0,
                    removed: 0,
                    warnings: browserState.snapshot.data.warnings.length,
                    durationMs: 1,
                })),
            runOne: async (rootId: string): Promise<ScanReport> => {
                const warnings = browserState.snapshot.data.warnings.filter(warning => {
                    if (warning.scanRootId !== rootId) return true;
                    const remainingPaths = warning.candidatePaths.filter(
                        candidatePath => !browserState.snapshot.data.ignoredPaths.includes(candidatePath),
                    );
                    return remainingPaths.length > 1;
                });
                updateConfig({ ...browserState.snapshot.data, warnings });
                return {
                    rootId,
                    scanned: 0,
                    matched: 0,
                    added: 0,
                    updated: 0,
                    removed: 0,
                    warnings: warnings.length,
                    durationMs: 1,
                };
            },
            ignorePath: async (path: string) => {
                if (browserState.snapshot.data.ignoredPaths.includes(path)) return;
                updateConfig({
                    ...browserState.snapshot.data,
                    ignoredPaths: [...browserState.snapshot.data.ignoredPaths, path],
                });
            },
            revealPath: async () => undefined,
            onProgress: () => () => undefined,
        },
        projects: {
            list: async () => clone(browserState.snapshot.data.projects),
            get: async id => {
                const project = browserState.snapshot.data.projects.find(item => item.id === id);
                if (!project) throw new Error(`项目不存在：${id}`);
                return clone(project);
            },
            updateMeta: async (id: string, patch: ProjectMetaPatch) =>
                updateProject(id, {
                    name: patch.name?.trim() || browserState.snapshot.data.projects.find(item => item.id === id)?.name,
                    description: patch.description,
                    tags: patch.tags?.map(tag => tag.trim()).filter(Boolean),
                    ignore: patch.ignore?.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean),
                    fingerprint: patch.fingerprint ? normalizeFingerprint(patch.fingerprint) : undefined,
                    hasMetaFile: patch.fingerprint?.kind === 'metadata'
                        ? true
                        : browserState.snapshot.data.projects.find(item => item.id === id)?.hasMetaFile,
                }),
            writeMetaFile: async (id: string, patch: ProjectMetaPatch) =>
                updateProject(id, {
                    name: patch.name?.trim() || browserState.snapshot.data.projects.find(item => item.id === id)?.name,
                    description: patch.description,
                    tags: patch.tags?.map(tag => tag.trim()).filter(Boolean),
                    ignore: patch.ignore?.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean),
                    fingerprint: patch.fingerprint ? normalizeFingerprint(patch.fingerprint) : undefined,
                    hasMetaFile: true,
                }),
            removeMetaFile: async (id: string) => updateProject(id, { hasMetaFile: false }),
            revealInOs: async () => undefined,
            inspectDirectory: async (path: string, projectIgnore?: string[]) => buildMockInspection(path, projectIgnore),
            validateNew: async (input: ManualProjectInput) => validateNewProject(input),
            add: async (input: ManualProjectInput) => {
                const validation = validateNewProject(input);
                if (!validation.valid) {
                    throw new Error(validation.conflicts[0]?.reason ?? '项目指纹冲突');
                }
                const project = createProjectFromInput(input);
                updateConfig({
                    ...browserState.snapshot.data,
                    projects: [...browserState.snapshot.data.projects, project],
                });
                return clone(project);
            },
            remove: async id => {
                updateConfig({
                    ...browserState.snapshot.data,
                    projects: browserState.snapshot.data.projects.filter(project => project.id !== id),
                });
            },
            pickDirectory: async () => pickMockProjectDirectory(),
        },
        tags: {
            list: async () => clone(browserState.snapshot.data.tags ?? []),
            upsert: async (tag: TagDefinition) => {
                const tags = [...(browserState.snapshot.data.tags ?? []).filter(item => item.name !== tag.name), tag];
                updateConfig({ ...browserState.snapshot.data, tags });
                return clone(tags);
            },
            remove: async (name: string) => {
                const tags = (browserState.snapshot.data.tags ?? []).filter(tag => tag.name !== name);
                updateConfig({ ...browserState.snapshot.data, tags });
                return clone(tags);
            },
            rename: async (oldName: string, newName: string) => {
                const tags = (browserState.snapshot.data.tags ?? []).map(tag =>
                    tag.name === oldName ? { ...tag, name: newName } : tag,
                );
                const projects = browserState.snapshot.data.projects.map(project => ({
                    ...project,
                    tags: project.tags.map(tag => (tag === oldName ? newName : tag)),
                }));
                updateConfig({ ...browserState.snapshot.data, tags, projects });
                return clone(tags);
            },
        },
        sync: {
            getDevice: async (): Promise<DeviceRegistry> => clone(browserState.snapshot.data.devices ?? {
                selfId: 'dev-browser',
                selfName: 'Browser Preview',
                known: [],
            }),
            setSelfName: async (name: string): Promise<DeviceRegistry> => {
                const devices: DeviceRegistry = {
                    ...(browserState.snapshot.data.devices ?? { selfId: 'dev-browser', selfName: '', known: [] }),
                    selfName: name,
                };
                updateConfig({ ...browserState.snapshot.data, devices });
                return clone(devices);
            },
            listConfigs: async (): Promise<SyncConfig[]> => clone(browserState.snapshot.data.syncConfigs ?? []),
            upsertConfig: async (config: SyncConfig): Promise<SyncConfig> => upsertSyncConfig(clone(config)),
            removeConfig: async (id: string): Promise<void> => {
                updateConfig({
                    ...browserState.snapshot.data,
                    syncConfigs: (browserState.snapshot.data.syncConfigs ?? []).filter(item => item.id !== id),
                });
                browserState.runningServers = browserState.runningServers.filter(item => item !== id);
            },
            setProjectRule: async (configId: string, projectId: string, rule: SyncProjectRule): Promise<SyncConfig> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                const project = browserState.snapshot.data.projects.find(item => item.id === projectId);
                if (!syncConfig) throw new Error(`同步配置不存在：${configId}`);
                if (!project) throw new Error(`项目不存在：${projectId}`);
                const next = setProjectSyncRule(syncConfig, project, rule);
                return upsertSyncConfig(next);
            },
            pickDirectory: async () => `D:/sync-targets/browser-${Date.now()}`,
            diffSharedDir: async (): Promise<SyncDiff> => ({
                generatedAt: nowIso(),
                local: { device: { id: 'dev-browser', name: 'Browser Preview' } },
                remote: { device: { id: 'dev-remote', name: 'Remote Mock' } },
                entries: [],
            }),
            pushSharedDir: async (_configId: string, projectIds?: string[]) => ({ pushed: projectIds ?? [] }),
            pullSharedDir: async (): Promise<SyncPullResult[]> => [],
            exportZip: async (configId: string, projectIds: string[], outputFile: string) => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                if (syncConfig?.type === 'zip') {
                    void upsertSyncConfig(normalizeSyncConfig({
                        ...syncConfig,
                        zip: { ...syncConfig.zip, exportFile: outputFile },
                    }));
                }
                return { outputFile, projects: projectIds.length };
            },
            pickExportFile: async () => null,
            pickImportFile: async () => null,
            previewZip: async (): Promise<{ manifest: SyncManifest; entries: SyncProjectEntry[] }> => ({
                manifest: {
                    schema: 'fm.sync/v1',
                    generatedAt: nowIso(),
                    device: { id: 'dev-browser', name: 'Browser Preview' },
                    projects: [],
                },
                entries: [],
            }),
            applyZip: async (): Promise<SyncImportResult[]> => [],
            startServer: async (configId: string) => {
                if (!browserState.runningServers.includes(configId)) {
                    browserState.runningServers = [...browserState.runningServers, configId];
                }
                return { port: 41555 };
            },
            stopServer: async (configId: string) => {
                browserState.runningServers = browserState.runningServers.filter(item => item !== configId);
            },
            isServerRunning: async (configId: string) => browserState.runningServers.includes(configId),
        },
        commands: {
            presets: async () => clone(PRESET_COMMANDS),
            list: async (): Promise<CustomCommand[]> => clone(browserState.snapshot.data.commands ?? []),
            add: async input => {
                const command: CustomCommand = {
                    id: `cmd_${Math.random().toString(36).slice(2, 8)}`,
                    ...input,
                };
                updateConfig({
                    ...browserState.snapshot.data,
                    commands: [...(browserState.snapshot.data.commands ?? []), command],
                });
                return clone(command);
            },
            update: async (id, patch) => {
                const commands = (browserState.snapshot.data.commands ?? []).map(command =>
                    command.id === id ? { ...command, ...patch } : command,
                );
                updateConfig({ ...browserState.snapshot.data, commands });
                const command = commands.find(item => item.id === id);
                if (!command) throw new Error(`命令不存在：${id}`);
                return clone(command);
            },
            remove: async id => {
                updateConfig({
                    ...browserState.snapshot.data,
                    commands: (browserState.snapshot.data.commands ?? []).filter(command => command.id !== id),
                });
            },
            run: async (): Promise<CommandRunResult> => ({
                started: true,
                message: 'browser mock command started',
            }),
        },
    };

    Object.assign(window, {
        app: appApi,
        fm: fmApi,
    });
}
