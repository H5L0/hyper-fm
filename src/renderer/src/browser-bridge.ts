import type {
    AppBridge,
    AppPreferences,
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
    ProjectRuntimeInfo,
    ProjectMetaPatch,
    ScanReport,
    ScanRoot,
    SyncApplyResult,
    SyncConfig,
    SyncConflictMergeDraft,
    SyncImportTarget,
    SyncImportResult,
    SyncPlanApplyRequest,
    SyncPlanPreviewEvent,
    SyncPlanPreview,
    SyncPlanPreviewSession,
    SyncPlanRowPage,
    SyncPlanSelectionState,
    SyncProjectRule,
    SyncPullResult,
    TagDefinition,
} from '@shared/bridge.js';
import { createDefaultDynamicTagGroups } from '@shared/dynamic-tags.js';
import {
    PRESET_COMMANDS,
    createDefaultSyncConfig,
    type CommandRunResult,
    type CustomCommand,
    type DeviceRegistry,
    type SyncFileOperation,
    type SyncFileOperationKind,
    type SyncDiff,
    type SyncManifest,
    type SyncPlanRow,
    type SyncProjectEntry,
} from '@shared/sync-types.js';
import { normalizeSyncConfig, setProjectSyncRule } from '@shared/sync-config.js';
import { finalizeManualProjectValidation } from '@shared/manual-project-validation.js';
import { describeManualProjectValidationConflict } from '@/project-import/validation-text.js';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function createMockPlanPreview(configId: string, configName: string, targetPath = 'D:/sync-targets/browser-demo'): SyncPlanPreview {
    const project = browserState.snapshot.data.projects[0];
    return {
        configId,
        configName,
        generatedAt: nowIso(),
        projects: project ? [
            {
                projectId: project.id,
                projectName: project.name,
                mode: 'two-way',
                localPath: project.path,
                targetPath,
                summary: { create: 1, update: 1, delete: 0, conflict: 1, skip: 1, total: 4 },
                operations: [
                    { relativePath: 'README.md', kind: 'create', direction: 'to-target', local: { path: 'README.md', size: 12, mtime: nowIso(), sha1: 'a' }, note: '仅本地存在' },
                    { relativePath: 'src/main.ts', kind: 'update', direction: 'to-local', target: { path: 'src/main.ts', size: 24, mtime: nowIso(), sha1: 'b' }, note: '目标修改时间更新' },
                    { relativePath: 'src/conflict.ts', kind: 'conflict', direction: 'none', local: { path: 'src/conflict.ts', size: 18, mtime: nowIso(), sha1: 'c' }, target: { path: 'src/conflict.ts', size: 22, mtime: nowIso(), sha1: 'd' }, note: '两侧都已发生变化' },
                    { relativePath: 'package.json', kind: 'skip', direction: 'none', local: { path: 'package.json', size: 30, mtime: nowIso(), sha1: 'e' }, target: { path: 'package.json', size: 30, mtime: nowIso(), sha1: 'e' }, note: '内容一致' },
                ],
            },
        ] : [],
    };
}

type MockTreeNode =
    | { kind: 'folder'; name: string; children: Map<string, MockTreeNode> }
    | { kind: 'file'; name: string; operation: SyncFileOperation };

type MockRowDefinition = Omit<SyncPlanRow, 'checked' | 'partiallyChecked' | 'muted'>;

type MockPreviewSession = {
    session: SyncPlanPreviewSession;
    rowsByProject: Record<string, MockRowDefinition[]>;
};

const mockPreviewSessions = new Map<string, MockPreviewSession>();

function isSyncableMockKind(kind: SyncFileOperationKind | 'mixed'): kind is SyncFileOperationKind {
    return kind !== 'mixed' && kind !== 'skip';
}

function createMockFolderNode(name: string): Extract<MockTreeNode, { kind: 'folder' }> {
    return { kind: 'folder', name, children: new Map() };
}

function collectMockDescendants(node: MockTreeNode): SyncFileOperation[] {
    if (node.kind === 'file') {
        return [node.operation];
    }
    return [...node.children.values()].flatMap(child => collectMockDescendants(child));
}

function sortMockNodes(left: MockTreeNode, right: MockTreeNode): number {
    if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN');
}

function buildMockPreviewRows(operations: readonly SyncFileOperation[]): MockRowDefinition[] {
    const root = createMockFolderNode('__root__');

    for (const operation of operations) {
        const segments = operation.relativePath.split('/').filter(Boolean);
        let current = root;
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index]!;
            const isLeaf = index === segments.length - 1;
            if (isLeaf) {
                current.children.set(segment, { kind: 'file', name: segment, operation });
                continue;
            }
            const existing = current.children.get(segment);
            if (existing?.kind === 'folder') {
                current = existing;
                continue;
            }
            const next = createMockFolderNode(segment);
            current.children.set(segment, next);
            current = next;
        }
    }

    const rows: MockRowDefinition[] = [];

    const renderNode = (node: MockTreeNode, depth: number, parentPath = ''): void => {
        if (node.kind === 'file') {
            const segments = node.operation.relativePath.split('/').filter(Boolean);
            const index = rows.length;
            rows.push({
                index,
                kind: 'file',
                depth,
                label: node.name,
                folderPath: segments.slice(0, -1).join('/'),
                aggregateKind: node.operation.kind,
                subtreeEndIndex: index,
                relativePath: node.operation.relativePath,
            });
            return;
        }

        let currentNode = node;
        let fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
        while (currentNode.children.size === 1) {
            const onlyChild = [...currentNode.children.values()][0]!;
            if (onlyChild.kind !== 'folder') {
                break;
            }
            fullPath = `${fullPath}/${onlyChild.name}`;
            currentNode = onlyChild;
        }

        const descendants = collectMockDescendants(currentNode);
        const descendantKinds = [...new Set(descendants.map(item => item.kind))];
        const rowIndex = rows.length;
        rows.push({
            index: rowIndex,
            kind: 'folder',
            depth,
            label: `${fullPath}/`,
            folderPath: fullPath,
            aggregateKind: descendantKinds.length === 1 ? descendantKinds[0]! : 'mixed',
            subtreeEndIndex: rowIndex,
        });

        for (const child of [...currentNode.children.values()].sort(sortMockNodes)) {
            renderNode(child, depth + 1, fullPath);
        }

        rows[rowIndex] = {
            ...rows[rowIndex]!,
            subtreeEndIndex: rows.length - 1,
        };
    };

    for (const child of [...root.children.values()].sort(sortMockNodes)) {
        renderNode(child, 0);
    }

    return rows;
}

type MockPreparedProjectSelection = {
    operationsByPath: Map<string, SyncPlanApplyRequest['operations'][number] & { sequence: number }>;
    ranges: Array<SyncPlanSelectionState['ranges'][number]>;
};

function prepareMockSelection(selection?: SyncPlanSelectionState): Map<string, MockPreparedProjectSelection> {
    const byProject = new Map<string, MockPreparedProjectSelection>();

    const ensureProject = (projectId: string): MockPreparedProjectSelection => {
        const existing = byProject.get(projectId);
        if (existing) {
            return existing;
        }
        const next: MockPreparedProjectSelection = {
            operationsByPath: new Map(),
            ranges: [],
        };
        byProject.set(projectId, next);
        return next;
    };

    for (const [index, operation] of (selection?.operations ?? []).entries()) {
        const project = ensureProject(operation.projectId);
        project.operationsByPath.set(operation.relativePath, {
            ...operation,
            sequence: operation.sequence ?? index,
        });
    }

    for (const range of selection?.ranges ?? []) {
        ensureProject(range.projectId).ranges.push(range);
    }

    for (const project of byProject.values()) {
        project.ranges.sort((left, right) => left.sequence - right.sequence);
    }

    return byProject;
}

function resolveMockFileEnabled(
    projectId: string,
    row: MockRowDefinition,
    selectionByProject: Map<string, MockPreparedProjectSelection>,
): boolean {
    if (!row.relativePath || !isSyncableMockKind(row.aggregateKind)) {
        return false;
    }

    const projectSelection = selectionByProject.get(projectId);
    if (!projectSelection) {
        return true;
    }

    let enabled = true;
    let sequence = -1;

    for (const range of projectSelection.ranges) {
        if (row.index < range.startIndex || row.index > range.endIndex) {
            continue;
        }
        if (range.sequence >= sequence) {
            enabled = range.enabled;
            sequence = range.sequence;
        }
    }

    const explicit = projectSelection.operationsByPath.get(row.relativePath);
    if (explicit && explicit.sequence >= sequence) {
        enabled = explicit.enabled;
    }

    return enabled;
}

function toMockPreviewRow(
    projectId: string,
    row: MockRowDefinition,
    allRows: MockRowDefinition[],
    selectionByProject: Map<string, MockPreparedProjectSelection>,
): SyncPlanRow {
    if (row.kind === 'file') {
        const checked = isSyncableMockKind(row.aggregateKind)
            && resolveMockFileEnabled(projectId, row, selectionByProject);
        return {
            ...row,
            checked,
            partiallyChecked: false,
            muted: !checked,
        };
    }

    let totalSyncable = 0;
    let enabledCount = 0;
    for (let index = row.index + 1; index <= row.subtreeEndIndex; index += 1) {
        const child = allRows[index];
        if (!child || child.kind !== 'file' || !isSyncableMockKind(child.aggregateKind)) {
            continue;
        }
        totalSyncable += 1;
        if (resolveMockFileEnabled(projectId, child, selectionByProject)) {
            enabledCount += 1;
        }
    }

    return {
        ...row,
        checked: totalSyncable > 0 && enabledCount === totalSyncable,
        partiallyChecked: enabledCount > 0 && enabledCount < totalSyncable,
        muted: enabledCount === 0,
    };
}

function getMockPreviewRows(
    sessionId: string,
    projectId: string,
    startIndex: number,
    length: number,
    selection?: SyncPlanSelectionState,
): SyncPlanRowPage {
    const session = mockPreviewSessions.get(sessionId);
    const allRows = session?.rowsByProject[projectId] ?? [];
    const total = allRows.length;
    const safeStart = Math.max(0, Math.min(startIndex, Math.max(total - 1, 0)));
    const safeLength = Math.max(0, length);
    const selectionByProject = prepareMockSelection(selection);
    const slice = safeLength === 0
        ? []
        : allRows.slice(safeStart, safeStart + safeLength).map(row =>
            toMockPreviewRow(projectId, row, allRows, selectionByProject),
        );

    return {
        sessionId,
        projectId,
        startIndex: safeStart,
        total,
        rows: slice,
    };
}

function closeMockPreviewSession(sessionId: string): void {
    mockPreviewSessions.delete(sessionId);
}

function createMockPreviewSession(configId: string, configName: string, targetPath: string): SyncPlanPreviewSession {
    const preview = createMockPlanPreview(configId, configName, targetPath);
    const sessionId = `browser-preview-${Math.random().toString(36).slice(2, 10)}`;
    const updatedAt = preview.generatedAt;
    const rowsByProject = Object.fromEntries(
        preview.projects.map(project => [project.projectId, buildMockPreviewRows(project.operations)]),
    );
    const session: SyncPlanPreviewSession = {
        sessionId,
        configId: preview.configId,
        configName: preview.configName,
        generatedAt: preview.generatedAt,
        updatedAt,
        stage: 'watching',
        progress: {
            totalProjects: preview.projects.length,
            processedProjects: preview.projects.length,
            watched: true,
            applying: false,
        },
        projects: preview.projects.map(project => ({
            projectId: project.projectId,
            projectName: project.projectName,
            mode: project.mode,
            localPath: project.localPath,
            targetPath: project.targetPath,
            summary: project.summary,
            rowCount: rowsByProject[project.projectId]?.length ?? 0,
            status: 'ready',
            updatedAt,
        })),
    };

    mockPreviewSessions.set(sessionId, {
        session,
        rowsByProject,
    });

    return session;
}

function createMockApplyResult(configId: string, configName: string): SyncApplyResult {
    const project = browserState.snapshot.data.projects[0];
    return {
        configId,
        configName,
        executedAt: nowIso(),
        projects: project ? [
            {
                projectId: project.id,
                projectName: project.name,
                localPath: project.path,
                targetPath: 'D:/sync-targets/browser-demo',
                applied: { create: 1, update: 1, delete: 0, conflict: 1, skip: 1 },
                conflictPaths: ['src/conflict.ts'],
            },
        ] : [],
    };
}

function createMockZipBundle(): { manifest: SyncManifest; entries: SyncProjectEntry[] } {
    const entries: SyncProjectEntry[] = [
        {
            id: 'pj-demo01',
            slug: 'fm-browser-demo',
            meta: {
                name: 'fm',
                description: '浏览器 mock 的 ZIP 导入示例项目。',
                tags: ['electron', 'tooling'],
                ignore: ['README.md'],
                fingerprint: { kind: 'metadata' },
            },
            files: [
                { path: 'README.md', size: 12, mtime: nowIso(), sha1: 'zip-a' },
                { path: 'src/main.ts', size: 24, mtime: nowIso(), sha1: 'zip-b' },
            ],
            hash: 'zip-hash-1',
            modifiedAt: nowIso(),
        },
        {
            id: 'pj-demo03',
            slug: 'fm-browser-imported',
            meta: {
                name: 'fm-imported-demo',
                description: '用于演示 ZIP 导入目标路径分配。',
                tags: ['sync'],
                ignore: [],
                fingerprint: { kind: 'folder-name', folderName: 'fm-imported-demo' },
            },
            files: [
                { path: 'package.json', size: 36, mtime: nowIso(), sha1: 'zip-c' },
            ],
            hash: 'zip-hash-2',
            modifiedAt: nowIso(),
        },
    ];

    return {
        manifest: {
            schema: 'fm.sync/v1',
            generatedAt: nowIso(),
            device: { id: 'dev-browser', name: 'Browser Preview' },
            projects: entries,
        },
        entries,
    };
}

function updateMockSyncWarnings(configId: string, configName: string): void {
    const project = browserState.snapshot.data.projects[0];
    if (!project) return;
    const warnings = browserState.snapshot.data.warnings.filter(warning => {
        if (warning.kind !== 'sync-conflict' && warning.kind !== 'sync-error') return true;
        return warning.configId !== configId;
    });
    warnings.push({
        id: `warn-sync-${Date.now().toString(36)}`,
        kind: 'sync-conflict',
        configId,
        configName,
        projectId: project.id,
        projectName: project.name,
        mode: 'two-way',
        filePaths: ['src/conflict.ts'],
        message: `${configName} 检测到 1 个冲突文件，已跳过该文件。`,
        createdAt: nowIso(),
    });
    updateConfig({ ...browserState.snapshot.data, warnings });
}

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

function matchesExistingProjectFingerprint(
    fingerprint: ProjectFingerprint,
    inspection: ProjectDirectoryInspection,
    projectId: string,
): boolean {
    if (fingerprint.kind === 'metadata') {
        return inspection.metaProjectId === projectId;
    }
    if (fingerprint.kind === 'folder-name') {
        return inspection.suggestedName.trim().toLowerCase() === fingerprint.folderName.trim().toLowerCase();
    }
    const fileSet = new Set(inspection.files);
    return fingerprint.paths.every(rel => fileSet.has(rel));
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
        tagGroups: [
            ...createDefaultDynamicTagGroups(),
            { name: '桌面工具', tags: ['electron', 'tooling'] },
            { name: '同步相关', tags: ['sync'] },
        ],
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
    appPreferences: AppPreferences;
    snapshot: ConfigSnapshot;
    runningServers: string[];
    nextProjectPick: number;
    nextScanRootPick: number;
    projectDirectoryModifiedAt: Record<string, string | undefined>;
} = {
    appPreferences: {
        trayEnabled: true,
        autoLaunchEnabled: false,
        ui: {
            theme: 'system',
            view: 'grid',
        },
    },
    snapshot: {
        paths: {
            sharedPath: 'browser://fm.shared.json',
            localPath: 'browser://fm.local.json',
            configId: '',
        },
        data: createSampleConfig(),
        hasLoadedConfig: true,
    },
    runningServers: [],
    nextProjectPick: 1,
    nextScanRootPick: 1,
    projectDirectoryModifiedAt: {
        'pj-demo01': nowIso(),
        'pj-demo02': nowIso(),
    },
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

    const validIds = new Set(next.projects.map(project => project.id));
    browserState.projectDirectoryModifiedAt = Object.fromEntries(
        Object.entries(browserState.projectDirectoryModifiedAt).filter(([projectId]) => validIds.has(projectId)),
    );
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

function listMockProjectRuntimeInfo(projectIds?: string[]): ProjectRuntimeInfo[] {
    const ids = projectIds && projectIds.length > 0
        ? projectIds
        : browserState.snapshot.data.projects.map(project => project.id);
    return ids.map(projectId => ({
        projectId,
        directoryModifiedAt: browserState.projectDirectoryModifiedAt[projectId],
    }));
}

function validateNewProject(input: ManualProjectInput): ManualProjectValidationResult {
    const path = normalizePath(input.path);
    const fingerprint = normalizeFingerprint(input.fingerprint);
    const inspection = buildMockInspection(input.path, input.ignore ?? []);
    const conflicts = browserState.snapshot.data.projects.flatMap(project => {
        const items: ManualProjectValidationResult['conflicts'] = [];
        if (normalizePath(project.path).toLowerCase() === path.toLowerCase()) {
            items.push({
                kind: 'duplicate-path',
                projectId: project.id,
                projectName: project.name,
            });
        }
        if (sameFingerprint(project.fingerprint, fingerprint)
            || matchesExistingProjectFingerprint(project.fingerprint, inspection, project.id)) {
            items.push({
                kind: 'conflict-fingerprint',
                projectId: project.id,
                projectName: project.name,
            });
        }
        return items;
    });
    return finalizeManualProjectValidation(conflicts);
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
        ignore: [...new Set((input.ignore ?? []).map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort(),
        syncRespectGitignore: input.syncRespectGitignore,
        fingerprint: normalizeFingerprint(input.fingerprint),
        hasMetaFile: input.fingerprint.kind === 'metadata',
        lastScannedAt: nowIso(),
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

function pickMockProjectDirectories(): string[] {
    return [pickMockProjectDirectory(), pickMockProjectDirectory()];
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
        app: {
            getPreferences: async (): Promise<AppPreferences> => clone(browserState.appPreferences),
            updatePreferences: async (patch: Partial<AppPreferences>): Promise<AppPreferences> => {
                browserState.appPreferences = {
                    ...browserState.appPreferences,
                    ...patch,
                };
                return clone(browserState.appPreferences);
            },
            onOpenNewProject: (_handler: () => void) => {
                return () => {};
            },
        },
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
                    configId: '',
                };
                browserState.snapshot.hasLoadedConfig = true;
                return getSnapshot();
            },
            create: async (filePath: string) => {
                browserState.snapshot = {
                    paths: {
                        sharedPath: filePath,
                        localPath: deriveLocalPath(filePath),
                        configId: '',
                    },
                    data: {
                        ...createSampleConfig(),
                        name: lastSegment(filePath).replace(/\.shared\.json$/iu, '').replace(/\.json$/iu, ''),
                    },
                    hasLoadedConfig: true,
                };
                return getSnapshot();
            },
            createLocalForShared: async (sharedPath: string) => {
                browserState.snapshot.paths = {
                    sharedPath,
                    localPath: deriveLocalPath(sharedPath),
                    configId: '',
                };
                browserState.snapshot.hasLoadedConfig = true;
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
                    if (warning.kind !== 'fingerprint-conflict') return true;
                    if (warning.scanRootId !== rootId) return true;
                    const remainingPaths = warning.candidatePaths.filter(
                        (candidatePath: string) => !browserState.snapshot.data.ignoredPaths.includes(candidatePath),
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
            listRuntimeInfo: async (projectIds?: string[]) => clone(listMockProjectRuntimeInfo(projectIds)),
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
                    syncRespectGitignore: patch.syncRespectGitignore,
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
                    syncRespectGitignore: patch.syncRespectGitignore,
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
                    throw new Error(validation.conflicts[0] ? describeManualProjectValidationConflict(validation.conflicts[0]) : '项目存在冲突');
                }
                const project = createProjectFromInput(input);
                updateConfig({
                    ...browserState.snapshot.data,
                    projects: [...browserState.snapshot.data.projects, project],
                });
                browserState.projectDirectoryModifiedAt[project.id] = nowIso();
                return clone(project);
            },
            remove: async id => {
                updateConfig({
                    ...browserState.snapshot.data,
                    projects: browserState.snapshot.data.projects.filter(project => project.id !== id),
                });
                delete browserState.projectDirectoryModifiedAt[id];
            },
            pickDirectory: async () => pickMockProjectDirectory(),
            pickDirectories: async () => pickMockProjectDirectories(),
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
                const tagGroups = (browserState.snapshot.data.tagGroups ?? [])
                    .map(group => ({
                        ...group,
                        tags: group.tags.filter(tag => tag !== name),
                    }))
                    .filter(group => group.tags.length > 0);
                updateConfig({ ...browserState.snapshot.data, tags, tagGroups });
                return clone(tags);
            },
            rename: async (oldName: string, newName: string) => {
                const tags = (browserState.snapshot.data.tags ?? []).map(tag =>
                    tag.name === oldName ? { ...tag, name: newName } : tag,
                );
                const tagGroups = (browserState.snapshot.data.tagGroups ?? []).map(group => ({
                    ...group,
                    tags: group.tags.map(tag => (tag === oldName ? newName : tag)),
                }));
                const projects = browserState.snapshot.data.projects.map(project => ({
                    ...project,
                    tags: project.tags.map(tag => (tag === oldName ? newName : tag)),
                }));
                updateConfig({ ...browserState.snapshot.data, tags, tagGroups, projects });
                return clone(tags);
            },
            reorder: async (ordered: TagDefinition[]) => {
                updateConfig({ ...browserState.snapshot.data, tags: ordered });
                return clone(ordered);
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
            previewSharedDirSync: async (configId: string): Promise<SyncPlanPreview> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                return createMockPlanPreview(configId, syncConfig?.name ?? '共享目录同步', 'D:/OneDrive/fm-sync/devices/dev-desktop/projects/fm-browser-demo.zip');
            },
            openSharedDirSyncPreview: async (configId: string): Promise<SyncPlanPreviewSession> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                return createMockPreviewSession(
                    configId,
                    syncConfig?.name ?? '共享目录同步',
                    'D:/OneDrive/fm-sync/devices/dev-desktop/projects/fm-browser-demo.zip',
                );
            },
            onSyncPreviewEvent: (_handler: (event: SyncPlanPreviewEvent) => void) => () => undefined,
            getSyncPreviewRows: async (
                sessionId: string,
                projectId: string,
                startIndex: number,
                length: number,
                selection?: SyncPlanSelectionState,
            ): Promise<SyncPlanRowPage> => getMockPreviewRows(sessionId, projectId, startIndex, length, selection),
            closeSyncPreview: async (sessionId: string): Promise<void> => {
                closeMockPreviewSession(sessionId);
            },
            applySharedDirSync: async (configId: string, _projectIds?: string[], _request?: SyncPlanApplyRequest): Promise<SyncApplyResult> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                const configName = syncConfig?.name ?? '共享目录同步';
                updateMockSyncWarnings(configId, configName);
                return createMockApplyResult(configId, configName);
            },
            previewFolderSync: async (configId: string): Promise<SyncPlanPreview> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                return createMockPlanPreview(configId, syncConfig?.name ?? '文件夹同步');
            },
            openFolderSyncPreview: async (configId: string): Promise<SyncPlanPreviewSession> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                return createMockPreviewSession(configId, syncConfig?.name ?? '文件夹同步', 'D:/sync-targets/browser-demo');
            },
            applyFolderSync: async (configId: string, _projectIds?: string[], _request?: SyncPlanApplyRequest): Promise<SyncApplyResult> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                const configName = syncConfig?.name ?? '文件夹同步';
                updateMockSyncWarnings(configId, configName);
                return createMockApplyResult(configId, configName);
            },
            openSyncDiff: async (): Promise<void> => undefined,
            openConflictMerge: async (_configId: string, projectId: string, relativePath: string): Promise<SyncConflictMergeDraft> => ({
                id: `merge-${Date.now().toString(36)}`,
                projectId,
                relativePath,
                updatedAt: nowIso(),
            }),
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
            pickImportFile: async () => 'browser://fm-bundle/mock-import.fm-bundle.zip',
            previewZip: async (): Promise<{ manifest: SyncManifest; entries: SyncProjectEntry[] }> => createMockZipBundle(),
            applyZip: async (): Promise<SyncImportResult[]> => [],
            previewZipImport: async (configId: string, _file: string, _targets: SyncImportTarget[]): Promise<SyncPlanPreview> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                return createMockPlanPreview(configId, syncConfig?.name ?? 'ZIP 导入', 'browser://zip-import');
            },
            applyZipImport: async (configId: string): Promise<SyncApplyResult> => {
                const syncConfig = (browserState.snapshot.data.syncConfigs ?? []).find(item => item.id === configId);
                const configName = syncConfig?.name ?? 'ZIP 导入';
                updateMockSyncWarnings(configId, configName);
                return createMockApplyResult(configId, configName);
            },
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
