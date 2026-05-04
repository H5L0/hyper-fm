import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { webContents } from 'electron';
import { createLogger } from '../../shared/logger.js';
import type { AppConfig } from '../../shared/types.js';
import type {
    SyncApplyResult,
    SyncConfig,
    SyncPlanApplyRequest,
    SyncPlanPreviewEvent,
    SyncPlanPreviewProjectSummary,
    SyncPlanPreviewSession,
    SyncPlanRowPage,
    SyncPlanSelectionState,
} from '../../shared/sync-types.js';
import { FmError } from '../fm-error.js';
import {
    EncodedProjectPreviewView,
    expandApplyRequestWithPreview,
    readProjectPreviewRows,
    type EncodedProjectPreview,
} from './preview-session-codec.js';

const logger = createLogger('main:sync:preview-session');

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

interface PreviewSessionProject {
    summary: SyncPlanPreviewProjectSummary;
    encoded?: EncodedProjectPreview;
    view?: EncodedProjectPreviewView;
}

interface PendingApplyRequest {
    resolve: (value: { result: SyncApplyResult; nextConfig: AppConfig }) => void;
    reject: (reason?: unknown) => void;
}

interface PreviewSessionEntry {
    worker: Worker;
    ownerWebContentsId: number;
    session: SyncPlanPreviewSession;
    projects: Map<string, PreviewSessionProject>;
    createdAt: number;
    closed: boolean;
    pendingApply?: PendingApplyRequest;
}

const previewSessions = new Map<string, PreviewSessionEntry>();

function createSessionId(): string {
    return `sync-preview-${randomUUID()}`;
}

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

function createInitialSession(
    sessionId: string,
    config: AppConfig,
    syncConfig: PreviewableSyncConfig,
    projectIds: string[],
): SyncPlanPreviewSession {
    const generatedAt = new Date().toISOString();
    const projects = projectIds
        .map(projectId => config.projects.find(project => project.id === projectId))
        .filter((project): project is AppConfig['projects'][number] => Boolean(project))
        .map(project => ({
            projectId: project.id,
            projectName: project.name,
            mode: syncConfig.mode,
            localPath: project.path,
            targetPath: '',
            summary: createEmptySummary(),
            rowCount: 0,
            status: 'queued' as const,
            updatedAt: generatedAt,
        }));

    return {
        sessionId,
        configId: syncConfig.id,
        configName: syncConfig.name,
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

function createSessionEntry(
    worker: Worker,
    ownerWebContentsId: number,
    session: SyncPlanPreviewSession,
): PreviewSessionEntry {
    return {
        worker,
        ownerWebContentsId,
        session,
        projects: new Map(session.projects.map(project => [project.projectId, { summary: project }])),
        createdAt: Date.now(),
        closed: false,
    };
}

function getSessionEntryOrThrow(sessionId: string): PreviewSessionEntry {
    const session = previewSessions.get(sessionId);
    if (!session) {
        throw new FmError('INTERNAL', `同步预览会话不存在：${sessionId}`);
    }
    return session;
}

function getSessionProjectOrThrow(sessionId: string, projectId: string): PreviewSessionProject {
    const session = getSessionEntryOrThrow(sessionId);
    const project = session.projects.get(projectId);
    if (!project) {
        throw new FmError('PROJECT_NOT_FOUND', `预览项目不存在：${projectId}`);
    }
    return project;
}

function postPreviewEvent(ownerWebContentsId: number, event: SyncPlanPreviewEvent): void {
    const target = webContents.fromId(ownerWebContentsId);
    if (!target || target.isDestroyed()) {
        return;
    }
    target.send('fm:sync:preview-event', event);
}

function emitSessionUpdated(entry: PreviewSessionEntry, changedProjectIds?: string[]): void {
    postPreviewEvent(entry.ownerWebContentsId, {
        type: 'session-updated',
        sessionId: entry.session.sessionId,
        session: entry.session,
        changedProjectIds,
    });
}

function emitSessionClosed(entry: PreviewSessionEntry): void {
    postPreviewEvent(entry.ownerWebContentsId, {
        type: 'session-closed',
        sessionId: entry.session.sessionId,
    });
}

function rejectPendingApply(entry: PreviewSessionEntry, error: unknown): void {
    if (!entry.pendingApply) {
        return;
    }
    const pending = entry.pendingApply;
    entry.pendingApply = undefined;
    pending.reject(error);
}

function updateSessionEntry(entry: PreviewSessionEntry, session: SyncPlanPreviewSession, project?: EncodedProjectPreview): void {
    entry.session = session;

    for (const summary of session.projects) {
        const current = entry.projects.get(summary.projectId);
        if (!current) {
            entry.projects.set(summary.projectId, { summary });
            continue;
        }
        current.summary = summary;
    }

    if (project) {
        entry.projects.set(project.summary.projectId, {
            summary: project.summary,
            encoded: project,
            view: new EncodedProjectPreviewView(project),
        });
    }
}

function handleWorkerError(entry: PreviewSessionEntry, error: Error): void {
    if (entry.closed) {
        return;
    }

    logger.error('同步预览 worker 异常', {
        sessionId: entry.session.sessionId,
        message: error.message,
    });

    const failedAt = new Date().toISOString();
    entry.session = {
        ...entry.session,
        updatedAt: failedAt,
        stage: 'error',
        progress: {
            ...entry.session.progress,
            activeProjectId: undefined,
            applying: false,
        },
        projects: entry.session.projects.map(project => ({
            ...project,
            status: project.status === 'ready' ? project.status : 'error',
            updatedAt: failedAt,
            errorMessage: project.errorMessage ?? error.message,
        })),
    };

    rejectPendingApply(entry, error);
    emitSessionUpdated(entry);
}

function bindWorker(entry: PreviewSessionEntry): void {
    entry.worker.on('message', (payload: PreviewWorkerEvent) => {
        if (entry.closed) {
            return;
        }

        if (!payload || typeof payload !== 'object' || !('type' in payload)) {
            return;
        }

        if (payload.type === 'session-updated') {
            updateSessionEntry(entry, payload.session, payload.project);
            emitSessionUpdated(entry, payload.changedProjectIds);
            return;
        }

        if (payload.type === 'apply-completed') {
            updateSessionEntry(entry, payload.session);
            emitSessionUpdated(entry);

            if (entry.pendingApply) {
                const pending = entry.pendingApply;
                entry.pendingApply = undefined;
                pending.resolve({ result: payload.result, nextConfig: payload.nextConfig });
            }
            return;
        }

        const error = new Error(payload.message);
        if (payload.stack) {
            error.stack = payload.stack;
        }
        handleWorkerError(entry, error);
    });

    entry.worker.once('error', error => {
        handleWorkerError(entry, error);
    });

    entry.worker.once('exit', code => {
        if (entry.closed || code === 0) {
            return;
        }
        handleWorkerError(entry, new Error(`同步预览 worker 异常退出：${code}`));
    });
}

function startWorker(entry: PreviewSessionEntry, message: PreviewWorkerStartMessage): void {
    bindWorker(entry);
    entry.worker.postMessage(message satisfies PreviewWorkerCommand);
}

function createWorkerEntry(
    ownerWebContentsId: number,
    kind: PreviewKind,
    config: AppConfig,
    syncConfig: PreviewableSyncConfig,
    projectIds: string[],
): PreviewSessionEntry {
    const sessionId = createSessionId();
    const session = createInitialSession(sessionId, config, syncConfig, projectIds);
    const worker = new Worker(new URL('./preview-session-worker.js', import.meta.url));
    const entry = createSessionEntry(worker, ownerWebContentsId, session);

    previewSessions.set(sessionId, entry);
    startWorker(entry, {
        type: 'start',
        kind,
        config,
        syncConfig,
        projectIds,
        sessionId,
    });

    logger.info('已创建同步预览会话', {
        sessionId,
        projects: projectIds.length,
        ownerWebContentsId,
    });

    return entry;
}

function openPreviewSession(
    ownerWebContentsId: number,
    kind: PreviewKind,
    config: AppConfig,
    syncConfig: PreviewableSyncConfig,
    projectIds: string[],
): SyncPlanPreviewSession {
    return createWorkerEntry(ownerWebContentsId, kind, config, syncConfig, projectIds).session;
}

export function openFolderSyncPreviewSession(
    ownerWebContentsId: number,
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'folder' }>,
    projectIds: string[],
): SyncPlanPreviewSession {
    return openPreviewSession(ownerWebContentsId, 'folder', config, syncConfig, projectIds);
}

export function openSharedDirSyncPreviewSession(
    ownerWebContentsId: number,
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'shared-dir' }>,
    projectIds: string[],
): SyncPlanPreviewSession {
    return openPreviewSession(ownerWebContentsId, 'shared-dir', config, syncConfig, projectIds);
}

export function getSyncPreviewRows(
    sessionId: string,
    projectId: string,
    startIndex: number,
    length: number,
    selection?: SyncPlanSelectionState,
): SyncPlanRowPage {
    const project = getSessionProjectOrThrow(sessionId, projectId);
    if (!project.view) {
        const total = project.summary.rowCount;
        return {
            sessionId,
            projectId,
            startIndex: Math.max(0, Math.min(startIndex, Math.max(total - 1, 0))),
            total,
            rows: [],
        };
    }
    return readProjectPreviewRows(sessionId, projectId, project.view, startIndex, length, selection);
}

export async function applySyncPreviewSession(
    sessionId: string,
    request: SyncPlanApplyRequest,
): Promise<{ result: SyncApplyResult; nextConfig: AppConfig }> {
    const entry = getSessionEntryOrThrow(sessionId);
    if (entry.pendingApply) {
        throw new FmError('WRITE_FAILED', '同步预览正在执行，请稍后再试。');
    }

    return new Promise((resolve, reject) => {
        entry.pendingApply = { resolve, reject };
        entry.worker.postMessage({ type: 'apply', request } satisfies PreviewWorkerCommand);
    });
}

export function closeSyncPreviewSession(sessionId: string): void {
    const entry = previewSessions.get(sessionId);
    if (!entry) {
        return;
    }

    previewSessions.delete(sessionId);
    entry.closed = true;
    rejectPendingApply(entry, new Error('同步预览会话已关闭'));
    emitSessionClosed(entry);

    entry.worker.removeAllListeners();
    try {
        entry.worker.postMessage({ type: 'dispose' } satisfies PreviewWorkerCommand);
    } catch {
        // worker 可能已经退出；忽略即可。
    }
    void entry.worker.terminate();

    logger.info('已关闭同步预览会话', { sessionId });
}

export function expandSyncPlanApplyRequest(request: SyncPlanApplyRequest): SyncPlanApplyRequest {
    if (!request.sessionId) {
        return request;
    }

    const selection: SyncPlanSelectionState = {
        operations: request.operations,
        ranges: request.ranges ?? [],
    };

    const operations = request.projectIds.flatMap(projectId => {
        const project = getSessionProjectOrThrow(request.sessionId!, projectId);
        if (!project.view) {
            throw new FmError('INTERNAL', `预览项目尚未准备完成：${projectId}`);
        }
        return expandApplyRequestWithPreview(projectId, project.view, selection);
    });

    return {
        sessionId: request.sessionId,
        projectIds: request.projectIds,
        operations,
        ranges: request.ranges,
    };
}

export function disposeSyncPreviewSessions(): void {
    for (const sessionId of [...previewSessions.keys()]) {
        closeSyncPreviewSession(sessionId);
    }
}

export function getSyncPreviewSessionStats(): { count: number; oldestAgeMs: number } {
    const values = [...previewSessions.values()];
    const oldest = values.reduce<number>((age, session) => Math.max(age, Date.now() - session.createdAt), 0);
    return {
        count: values.length,
        oldestAgeMs: oldest,
    };
}
