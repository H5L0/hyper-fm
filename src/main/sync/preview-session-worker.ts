import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import type { AppConfig } from '../../shared/types.js';
import type { SyncApplyResult, SyncConfig, SyncPlanApplyRequest, SyncPlanPreviewSession } from '../../shared/sync-types.js';
import { normalizePath } from '../../shared/path-utils.js';
import { FmError } from '../fm-error.js';
import {
    applyFolderSync,
    applySharedDirSync,
    previewFolderSync,
    previewSharedDirSync,
} from './file-sync.js';
import {
    EncodedProjectPreviewView,
    encodeProjectPreview,
    expandApplyRequestWithPreview,
    type EncodedProjectPreview,
} from './preview-session-codec.js';

type PreviewKind = 'folder' | 'shared-dir';
type PreviewableSyncConfig = Extract<SyncConfig, { type: PreviewKind }>;

interface PreviewWorkerStartMessage {
    type: 'start';
    kind: PreviewKind;
    config: AppConfig;
    syncConfig: PreviewableSyncConfig;
    projectIds: string[];
    sessionId: string;
}

interface PreviewWorkerApplyMessage {
    type: 'apply';
    request: SyncPlanApplyRequest;
}

interface PreviewWorkerDisposeMessage {
    type: 'dispose';
}

type PreviewWorkerCommand = PreviewWorkerStartMessage | PreviewWorkerApplyMessage | PreviewWorkerDisposeMessage;

interface PreviewWorkerSessionUpdatedEvent {
    type: 'session-updated';
    session: SyncPlanPreviewSession;
    changedProjectIds?: string[];
    project?: EncodedProjectPreview;
}

interface PreviewWorkerApplyCompletedEvent {
    type: 'apply-completed';
    session: SyncPlanPreviewSession;
    result: SyncApplyResult;
    nextConfig: AppConfig;
}

interface PreviewWorkerErrorEvent {
    type: 'error';
    message: string;
    stack?: string;
}

type PreviewWorkerEvent = PreviewWorkerSessionUpdatedEvent | PreviewWorkerApplyCompletedEvent | PreviewWorkerErrorEvent;

interface WatchRegistration {
    watcher: fs.FSWatcher;
    rootPath: string;
}

interface PreviewWorkerRuntime {
    sessionId: string;
    kind: PreviewKind;
    config: AppConfig;
    syncConfig: PreviewableSyncConfig;
    projectIds: string[];
    session: SyncPlanPreviewSession;
    encodedProjects: Map<string, EncodedProjectPreview>;
    disposed: boolean;
    watchers: WatchRegistration[];
    refreshTimers: Map<string, NodeJS.Timeout>;
    refreshChain: Promise<void>;
}

let runtime: PreviewWorkerRuntime | null = null;

function createEmptySummary() {
    return {
        create: 0,
        update: 0,
        delete: 0,
        conflict: 0,
        skip: 0,
        total: 0,
    };
}

function selectedProjects(config: AppConfig, projectIds: string[]): AppConfig['projects'] {
    return projectIds
        .map(projectId => config.projects.find(project => project.id === projectId))
        .filter((project): project is AppConfig['projects'][number] => Boolean(project));
}

function createInitialSession(input: PreviewWorkerStartMessage): SyncPlanPreviewSession {
    const generatedAt = new Date().toISOString();
    const projects = selectedProjects(input.config, input.projectIds).map(project => ({
        projectId: project.id,
        projectName: project.name,
        mode: input.syncConfig.mode,
        localPath: project.path,
        targetPath: '',
        summary: createEmptySummary(),
        rowCount: 0,
        status: 'queued' as const,
        updatedAt: generatedAt,
    }));

    return {
        sessionId: input.sessionId,
        configId: input.syncConfig.id,
        configName: input.syncConfig.name,
        generatedAt,
        updatedAt: generatedAt,
        stage: projects.length === 0 ? 'watching' : 'preparing',
        progress: {
            totalProjects: projects.length,
            processedProjects: 0,
            watched: projects.length === 0,
            applying: false,
        },
        projects,
    };
}

function postMessage(message: PreviewWorkerEvent): void {
    parentPort?.postMessage(message);
}

function postError(error: unknown): void {
    postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : '同步预览生成失败',
        stack: error instanceof Error ? error.stack : undefined,
    });
}

function countProcessedProjects(session: SyncPlanPreviewSession): number {
    return session.projects.filter(project => project.status === 'ready' || project.status === 'error').length;
}

function updateProjectSummary(
    state: PreviewWorkerRuntime,
    projectId: string,
    updater: (current: SyncPlanPreviewSession['projects'][number]) => SyncPlanPreviewSession['projects'][number],
): void {
    state.session = {
        ...state.session,
        projects: state.session.projects.map(project => (project.projectId === projectId ? updater(project) : project)),
    };
}

function finalizeSessionProgress(state: PreviewWorkerRuntime, activeProjectId?: string): void {
    const finishedInitialScan = state.session.progress.watched
        || countProcessedProjects(state.session) >= state.session.progress.totalProjects;
    const processedProjects = finishedInitialScan
        ? state.session.progress.totalProjects
        : countProcessedProjects(state.session);
    state.session = {
        ...state.session,
        updatedAt: new Date().toISOString(),
        stage: state.session.progress.applying ? 'applying' : (finishedInitialScan ? 'watching' : 'preparing'),
        progress: {
            ...state.session.progress,
            processedProjects,
            activeProjectId,
            watched: finishedInitialScan,
        },
    };
}

function emitSessionUpdate(state: PreviewWorkerRuntime, changedProjectIds?: string[], project?: EncodedProjectPreview): void {
    postMessage({
        type: 'session-updated',
        session: state.session,
        changedProjectIds,
        project,
    });
}

function getProjectSummary(state: PreviewWorkerRuntime, projectId: string) {
    const summary = state.session.projects.find(project => project.projectId === projectId);
    if (!summary) {
        throw new FmError('PROJECT_NOT_FOUND', `预览项目不存在：${projectId}`);
    }
    return summary;
}

async function previewSingleProject(state: PreviewWorkerRuntime, projectId: string): Promise<EncodedProjectPreview | null> {
    const preview = state.kind === 'folder'
        ? await previewFolderSync(state.config, state.syncConfig as Extract<SyncConfig, { type: 'folder' }>, [projectId])
        : await previewSharedDirSync(state.config, state.syncConfig as Extract<SyncConfig, { type: 'shared-dir' }>, [projectId]);

    const plan = preview.projects[0];
    return plan ? encodeProjectPreview(plan) : null;
}

async function refreshProject(state: PreviewWorkerRuntime, projectId: string, reason: 'initial' | 'watch'): Promise<void> {
    if (state.disposed) {
        return;
    }

    const startedAt = new Date().toISOString();
    updateProjectSummary(state, projectId, current => ({
        ...current,
        status: reason === 'initial' || current.rowCount === 0 ? 'scanning' : 'updating',
        updatedAt: startedAt,
        errorMessage: undefined,
    }));
    finalizeSessionProgress(state, projectId);
    emitSessionUpdate(state, [projectId]);

    try {
        const encoded = await previewSingleProject(state, projectId);
        const updatedAt = new Date().toISOString();

        if (encoded) {
            state.encodedProjects.set(projectId, encoded);
            updateProjectSummary(state, projectId, () => ({
                ...encoded.summary,
                status: 'ready',
                updatedAt,
            }));
        } else {
            state.encodedProjects.delete(projectId);
            const current = getProjectSummary(state, projectId);
            updateProjectSummary(state, projectId, () => ({
                ...current,
                summary: createEmptySummary(),
                rowCount: 0,
                status: 'ready',
                updatedAt,
                errorMessage: undefined,
            }));
        }

        finalizeSessionProgress(state);
        emitSessionUpdate(state, [projectId], encoded ?? undefined);
    } catch (error) {
        const updatedAt = new Date().toISOString();
        state.encodedProjects.delete(projectId);
        updateProjectSummary(state, projectId, current => ({
            ...current,
            status: 'error',
            updatedAt,
            errorMessage: error instanceof Error ? error.message : '预览更新失败',
        }));
        finalizeSessionProgress(state);
        emitSessionUpdate(state, [projectId]);
    }
}

async function runInitialScan(state: PreviewWorkerRuntime): Promise<void> {
    for (const projectId of state.projectIds) {
        if (state.disposed) {
            return;
        }
        await refreshProject(state, projectId, 'initial');
    }

    if (state.disposed) {
        return;
    }

    finalizeSessionProgress(state);
    emitSessionUpdate(state);
    startWatching(state);
}

function disposeWatchers(state: PreviewWorkerRuntime): void {
    for (const item of state.watchers) {
        item.watcher.close();
    }
    state.watchers = [];
    for (const timer of state.refreshTimers.values()) {
        clearTimeout(timer);
    }
    state.refreshTimers.clear();
}

function resolveProjectsForRootChange(state: PreviewWorkerRuntime, rootPath: string, filename?: string | null): string[] {
    const normalizedFilename = normalizePath(filename ?? '');
    if (!normalizedFilename) {
        return [...state.projectIds];
    }

    const matches = state.session.projects.filter(project => {
        const targetPath = project.targetPath ? normalizePath(path.relative(rootPath, project.targetPath)) : '';
        const localPath = normalizePath(path.relative(rootPath, project.localPath));

        if (targetPath && (normalizedFilename === targetPath || normalizedFilename.startsWith(`${targetPath}/`) || targetPath.startsWith(`${normalizedFilename}/`))) {
            return true;
        }
        if (localPath && (normalizedFilename === localPath || normalizedFilename.startsWith(`${localPath}/`) || localPath.startsWith(`${normalizedFilename}/`))) {
            return true;
        }
        return false;
    }).map(project => project.projectId);

    return matches.length > 0 ? matches : [...state.projectIds];
}

function queueProjectRefresh(state: PreviewWorkerRuntime, projectId: string): void {
    if (state.disposed) {
        return;
    }

    const currentTimer = state.refreshTimers.get(projectId);
    if (currentTimer) {
        clearTimeout(currentTimer);
    }

    const timer = setTimeout(() => {
        state.refreshTimers.delete(projectId);
        state.refreshChain = state.refreshChain.then(async () => {
            await refreshProject(state, projectId, 'watch');
        }).catch(error => {
            postError(error);
        });
    }, 180);

    state.refreshTimers.set(projectId, timer);
}

function registerWatcher(state: PreviewWorkerRuntime, rootPath: string, onChange: (filename?: string | null) => void): void {
    try {
        const watcher = fs.watch(rootPath, { recursive: true }, (_eventType, filename) => {
            onChange(typeof filename === 'string' ? filename : null);
        });
        state.watchers.push({ watcher, rootPath });
        return;
    } catch {
        // 某些平台或路径不支持 recursive，退化成普通 watch。
    }

    try {
        const watcher = fs.watch(rootPath, (_eventType, filename) => {
            onChange(typeof filename === 'string' ? filename : null);
        });
        state.watchers.push({ watcher, rootPath });
    } catch {
        // 路径不存在或当前平台不可监听时忽略；预览仍可正常工作，只是没有实时更新。
    }
}

function startWatching(state: PreviewWorkerRuntime): void {
    disposeWatchers(state);

    for (const project of selectedProjects(state.config, state.projectIds)) {
        registerWatcher(state, project.path, () => {
            queueProjectRefresh(state, project.id);
        });
    }

    if (state.kind === 'folder') {
        const syncConfig = state.syncConfig as Extract<SyncConfig, { type: 'folder' }>;
        if (!syncConfig.folder.targetDir) {
            return;
        }
        const targetRoot = syncConfig.folder.targetDir;
        registerWatcher(state, targetRoot, filename => {
            for (const projectId of resolveProjectsForRootChange(state, targetRoot, filename)) {
                queueProjectRefresh(state, projectId);
            }
        });
    }

    if (state.kind === 'shared-dir') {
        const syncConfig = state.syncConfig as Extract<SyncConfig, { type: 'shared-dir' }>;
        if (!syncConfig.sharedDir.bundleDir) {
            return;
        }
        const bundleRoot = syncConfig.sharedDir.bundleDir;
        registerWatcher(state, bundleRoot, filename => {
            for (const projectId of resolveProjectsForRootChange(state, bundleRoot, filename)) {
                queueProjectRefresh(state, projectId);
            }
        });
    }
}

function expandRequestWithCurrentPreview(state: PreviewWorkerRuntime, request: SyncPlanApplyRequest): SyncPlanApplyRequest {
    const selection = {
        operations: request.operations,
        ranges: request.ranges ?? [],
    };

    const operations = request.projectIds.flatMap(projectId => {
        const encoded = state.encodedProjects.get(projectId);
        if (!encoded) {
            throw new FmError('INTERNAL', `预览项目尚未准备完成：${projectId}`);
        }
        return expandApplyRequestWithPreview(projectId, new EncodedProjectPreviewView(encoded), selection);
    });

    return {
        sessionId: request.sessionId,
        projectIds: request.projectIds,
        operations,
        ranges: request.ranges,
    };
}

async function rescanProjectsAfterApply(state: PreviewWorkerRuntime): Promise<void> {
    state.encodedProjects.clear();
    for (const projectId of state.projectIds) {
        if (state.disposed) {
            return;
        }
        await refreshProject(state, projectId, 'watch');
    }
}

async function applyCurrentPreview(state: PreviewWorkerRuntime, request: SyncPlanApplyRequest): Promise<void> {
    disposeWatchers(state);

    const startedAt = new Date().toISOString();
    state.session = {
        ...state.session,
        updatedAt: startedAt,
        stage: 'applying',
        progress: {
            ...state.session.progress,
            applying: true,
            activeProjectId: undefined,
        },
        projects: state.session.projects.map(project => request.projectIds.includes(project.projectId)
            ? {
                ...project,
                status: 'applying',
                updatedAt: startedAt,
                errorMessage: undefined,
            }
            : project),
    };
    emitSessionUpdate(state, request.projectIds);

    const expanded = expandRequestWithCurrentPreview(state, request);
    const { result, nextConfig } = state.kind === 'folder'
        ? await applyFolderSync(
            state.config,
            state.syncConfig as Extract<SyncConfig, { type: 'folder' }>,
            expanded.projectIds,
            expanded,
        )
        : await applySharedDirSync(
            state.config,
            state.syncConfig as Extract<SyncConfig, { type: 'shared-dir' }>,
            expanded.projectIds,
            expanded,
        );

    state.config = nextConfig;
    await rescanProjectsAfterApply(state);
    state.session = {
        ...state.session,
        progress: {
            ...state.session.progress,
            applying: false,
        },
    };
    finalizeSessionProgress(state);
    startWatching(state);

    postMessage({
        type: 'apply-completed',
        session: state.session,
        result,
        nextConfig,
    });
}

function disposeRuntime(): void {
    if (!runtime) {
        return;
    }
    runtime.disposed = true;
    disposeWatchers(runtime);
    runtime = null;
}

function startRuntime(input: PreviewWorkerStartMessage): void {
    disposeRuntime();
    runtime = {
        sessionId: input.sessionId,
        kind: input.kind,
        config: input.config,
        syncConfig: input.syncConfig,
        projectIds: input.projectIds,
        session: createInitialSession(input),
        encodedProjects: new Map(),
        disposed: false,
        watchers: [],
        refreshTimers: new Map(),
        refreshChain: Promise.resolve(),
    };

    emitSessionUpdate(runtime);
    void runInitialScan(runtime).catch(error => {
        postError(error);
    });
}

parentPort?.on('message', async (message: PreviewWorkerCommand) => {
    try {
        if (message.type === 'start') {
            startRuntime(message);
            return;
        }

        if (message.type === 'dispose') {
            disposeRuntime();
            return;
        }

        if (!runtime) {
            throw new FmError('INTERNAL', '同步预览 worker 尚未初始化');
        }

        await applyCurrentPreview(runtime, message.request);
    } catch (error) {
        postError(error);
    }
});
