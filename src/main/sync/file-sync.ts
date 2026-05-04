// ---------------------------------------------------------------------------
// 文件级同步：生成计划、执行文件夹同步与 ZIP 导入
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
    SyncApplyProjectResult,
    SyncApplyResult,
    SyncConfig,
    SyncConflictMergeDraft,
    SyncConflictResolution,
    SyncFileEntry,
    SyncFileOperation,
    SyncPlanApplyRequest,
    SyncPlanPreview,
    SyncPlanSummary,
    SyncProjectEntry,
    SyncProjectPlan,
} from '../../shared/sync-types.js';
import type {
    AppConfig,
    Project,
    ProjectFingerprint,
    ProjectSyncState,
    ScanWarning,
    SyncConflictWarning,
    SyncErrorWarning,
} from '../../shared/types.js';
import { buildProjectSnapshot, buildProjectSlug } from './snapshot.js';
import { deviceProjectZipPath, listDeviceManifests, publishToBundleDir, readBundleIndex, readProjectZip } from './dir-bundle.js';
import { ensureDeviceRegistry } from './device.js';
import { packProjectZip, unpackBundle, unpackProjectZip } from './zip-bundle.js';
import { FmError } from '../fm-error.js';
import { readMetaFile } from '../meta-file.js';
import { normalizePath } from '../../shared/path-utils.js';
import { MANUAL_ROOT_ID } from '../project-repo.js';

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function createWarningId(kind: string): string {
    return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseIsoTime(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function buildFileMap(files: readonly SyncFileEntry[] | undefined): Map<string, SyncFileEntry> {
    return new Map((files ?? []).map(file => [file.path, file]));
}

function buildBaselineMap(state: ProjectSyncState | undefined): Map<string, string> {
    return new Map((state?.baselineFiles ?? []).map(file => [file.path, file.sha1]));
}

function createEmptyApplySummary(): SyncApplyProjectResult['applied'] {
    return { create: 0, update: 0, delete: 0, conflict: 0, skip: 0 };
}

function summarizeOperations(operations: readonly SyncFileOperation[]): SyncPlanSummary {
    const summary: SyncPlanSummary = {
        create: 0,
        update: 0,
        delete: 0,
        conflict: 0,
        skip: 0,
        total: operations.length,
    };
    for (const operation of operations) {
        summary[operation.kind] += 1;
    }
    return summary;
}

function resolveProjectSyncState(project: Pick<Project, 'syncStates'>, configId: string): ProjectSyncState | undefined {
    return project.syncStates?.find(item => item.configId === configId);
}

function updateProjectSyncState(project: Project, configId: string, state: ProjectSyncState): Project {
    const syncStates = project.syncStates ?? [];
    const exists = syncStates.some(item => item.configId === configId);
    return {
        ...project,
        syncStates: exists
            ? syncStates.map(item => (item.configId === configId ? state : item))
            : [...syncStates, state],
    };
}

function isRootInsideScanRoot(scanRootPath: string, candidatePath: string): boolean {
    const root = normalizePath(scanRootPath).toLowerCase();
    const candidate = normalizePath(candidatePath).toLowerCase();
    return candidate === root || candidate.startsWith(`${root}/`);
}

function resolveProjectRootId(config: AppConfig, targetPath: string): string {
    const root = config.scanRoots.find(scanRoot => isRootInsideScanRoot(scanRoot.path, targetPath));
    return root?.id ?? MANUAL_ROOT_ID;
}

function hasMetadataFile(entry: SyncProjectEntry | undefined): boolean {
    return (entry?.files ?? []).some(file => file.path === '.meta-data');
}

function toBaselineState(configId: string, targetPath: string, entry: SyncProjectEntry): ProjectSyncState {
    return {
        configId,
        lastSyncedAt: new Date().toISOString(),
        baselineHash: entry.hash,
        baselineFiles: entry.files.map(file => ({ path: file.path, sha1: file.sha1 })),
        targetPath,
    };
}

function buildFingerprintFallback(): ProjectFingerprint {
    return { kind: 'metadata' };
}

function createSyncConflictWarning(
    syncConfig: Pick<SyncConfig, 'id' | 'name' | 'mode'>,
    project: Pick<Project, 'id' | 'name'>,
    filePaths: string[],
): SyncConflictWarning {
    return {
        id: createWarningId('sync-conflict'),
        kind: 'sync-conflict',
        configId: syncConfig.id,
        configName: syncConfig.name,
        projectId: project.id,
        projectName: project.name,
        mode: syncConfig.mode,
        filePaths,
        message: `${syncConfig.name} 检测到 ${filePaths.length} 个冲突文件，已跳过这些文件。`,
        createdAt: new Date().toISOString(),
    };
}

function createSyncErrorWarning(
    syncConfig: Pick<SyncConfig, 'id' | 'name'>,
    message: string,
    project?: Pick<Project, 'id' | 'name'>,
): SyncErrorWarning {
    return {
        id: createWarningId('sync-error'),
        kind: 'sync-error',
        configId: syncConfig.id,
        configName: syncConfig.name,
        projectId: project?.id,
        projectName: project?.name,
        message,
        createdAt: new Date().toISOString(),
    };
}

function clearSyncWarnings(config: AppConfig, configId: string, projectId?: string): AppConfig {
    return {
        ...config,
        warnings: config.warnings.filter(warning => {
            if (warning.kind !== 'sync-conflict' && warning.kind !== 'sync-error') return true;
            if (warning.configId !== configId) return true;
            if (projectId && warning.projectId !== projectId) return true;
            return false;
        }),
    };
}

function upsertWarning(config: AppConfig, warning: ScanWarning): AppConfig {
    const filtered = clearSyncWarnings(
        config,
        warning.kind === 'fingerprint-conflict' ? '' : warning.configId,
        'projectId' in warning ? warning.projectId : undefined,
    );
    return {
        ...filtered,
        warnings: [...filtered.warnings, warning],
    };
}

async function ignorePatternsFor(
    config: AppConfig,
    project: Pick<Project, 'path' | 'ignore' | 'hasMetaFile' | 'syncRespectGitignore'>,
): Promise<{ ignorePatterns: string[]; respectGitignore: boolean }> {
    const base = config.ignore?.globs ?? [];
    const local = project.ignore ?? [];
    if (!project.hasMetaFile) {
        return {
            ignorePatterns: [...base, ...local],
            respectGitignore: project.syncRespectGitignore === true,
        };
    }
    try {
        const meta = await readMetaFile(project.path);
        const extra = meta?.ignore ?? [];
        return {
            ignorePatterns: [...base, ...local, ...extra],
            respectGitignore: (meta?.syncRespectGitignore ?? project.syncRespectGitignore) === true,
        };
    } catch {
        return {
            ignorePatterns: [...base, ...local],
            respectGitignore: project.syncRespectGitignore === true,
        };
    }
}

async function snapshotForPath(
    config: AppConfig,
    project: Pick<Project, 'id' | 'name' | 'description' | 'tags' | 'ignore' | 'fingerprint' | 'path' | 'hasMetaFile' | 'syncRespectGitignore'>,
    projectPath: string,
    metaOverride?: Partial<SyncProjectEntry['meta']>,
): Promise<SyncProjectEntry | null> {
    try {
        const stat = await fs.stat(projectPath);
        if (!stat.isDirectory()) return null;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return null;
        throw error;
    }

    const { ignorePatterns, respectGitignore } = await ignorePatternsFor(config, project);
    return buildProjectSnapshot({
        projectId: project.id,
        projectPath,
        meta: {
            name: metaOverride?.name ?? project.name,
            description: metaOverride?.description ?? project.description,
            tags: metaOverride?.tags ?? project.tags,
            ignore: metaOverride?.ignore ?? project.ignore,
            syncRespectGitignore: metaOverride?.syncRespectGitignore ?? respectGitignore,
            fingerprint: metaOverride?.fingerprint ?? project.fingerprint,
        },
        ignorePatterns,
        respectGitignore: metaOverride?.syncRespectGitignore !== undefined
            ? metaOverride.syncRespectGitignore === true
            : respectGitignore,
    });
}

async function ensureParentDirectory(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeBytesAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
    await ensureParentDirectory(filePath);
    const tmp = `${filePath}.fm-sync-tmp-${Date.now().toString(36)}`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, filePath);
}

async function removeEmptyParents(startPath: string, rootPath: string): Promise<void> {
    let current = path.dirname(startPath);
    const normalizedRoot = path.resolve(rootPath);
    while (current.startsWith(normalizedRoot) && current !== normalizedRoot) {
        try {
            const entries = await fs.readdir(current);
            if (entries.length > 0) return;
            await fs.rmdir(current);
            current = path.dirname(current);
        } catch {
            return;
        }
    }
}

async function deleteFileAndPrune(filePath: string, rootPath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
    await removeEmptyParents(filePath, rootPath);
}

interface SideIo {
    rootPath: string;
    readBytes(relativePath: string): Promise<Uint8Array>;
    writeBytes(relativePath: string, bytes: Uint8Array): Promise<void>;
    deletePath(relativePath: string): Promise<void>;
}

interface MutableMemorySide extends SideIo {
    files: Record<string, Uint8Array>;
}

interface AppliedPlanResult extends SyncApplyProjectResult {
    targetChanged: boolean;
    localChanged: boolean;
    hadDeferredOperations: boolean;
}

interface SyncOperationSelectionState {
    enabled: boolean;
    conflictResolution?: SyncConflictResolution;
    mergeDraftId?: string;
}

interface SyncConflictDraftRecord extends SyncConflictMergeDraft {
    configId: string;
    mergedFilePath: string;
    localFilePath: string;
    targetFilePath: string;
}

interface SyncOperationContext {
    project: Project;
    plan: SyncProjectPlan;
    operation: SyncFileOperation;
    localBytes?: Uint8Array;
    targetBytes?: Uint8Array;
}

type PreviewableSyncConfig = Extract<SyncConfig, { type: 'folder' }> | Extract<SyncConfig, { type: 'shared-dir' }>;

const conflictMergeDrafts = new Map<string, SyncConflictDraftRecord>();
const conflictMergeDraftIdsByKey = new Map<string, string>();

function createMergeDraftId(): string {
    return `merge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildOperationSelectionKey(projectId: string, relativePath: string): string {
    return `${projectId}\u0000${relativePath}`;
}

function buildConflictDraftKey(configId: string, projectId: string, relativePath: string): string {
    return `${configId}\u0000${projectId}\u0000${relativePath}`;
}

function isSyncPlanApplyRequest(value: unknown): value is SyncPlanApplyRequest {
    return Boolean(value)
        && typeof value === 'object'
        && Array.isArray((value as { projectIds?: unknown }).projectIds)
        && Array.isArray((value as { operations?: unknown }).operations);
}

function normalizeApplyRequest(
    projectIdsOrRequest?: string[] | SyncPlanApplyRequest,
    request?: SyncPlanApplyRequest,
): { projectIds?: string[]; operationSelections: Map<string, SyncOperationSelectionState> } {
    const applyRequest = isSyncPlanApplyRequest(projectIdsOrRequest)
        ? projectIdsOrRequest
        : request;
    const projectIds = applyRequest?.projectIds ?? (Array.isArray(projectIdsOrRequest) ? projectIdsOrRequest : undefined);
    const operationSelections = new Map<string, SyncOperationSelectionState>();

    for (const selection of applyRequest?.operations ?? []) {
        operationSelections.set(buildOperationSelectionKey(selection.projectId, selection.relativePath), {
            enabled: selection.enabled,
            conflictResolution: selection.conflictResolution,
            mergeDraftId: selection.mergeDraftId,
        });
    }

    return { projectIds, operationSelections };
}

function sanitizeTempName(relativePath: string): string {
    const baseName = path.basename(relativePath) || 'file';
    return baseName.replace(/[^A-Za-z0-9._-]+/g, '_') || 'file';
}

function spawnDetachedEditor(args: string[]): void {
    const child = spawn('code', args, {
        detached: true,
        stdio: 'ignore',
        shell: true,
    });
    child.unref();
}

async function readBytesFromFile(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

async function writeTempBytes(directory: string, fileName: string, bytes: Uint8Array): Promise<string> {
    const filePath = path.join(directory, fileName);
    await ensureParentDirectory(filePath);
    await fs.writeFile(filePath, bytes);
    return filePath;
}

function getConflictDraftRecord(
    configId: string,
    projectId: string,
    relativePath: string,
    mergeDraftId: string,
): SyncConflictDraftRecord {
    const record = conflictMergeDrafts.get(mergeDraftId);
    if (!record) {
        throw new FmError('WRITE_FAILED', `找不到 ${relativePath} 的手动合并结果，请重新打开合并编辑器。`);
    }
    if (record.configId !== configId || record.projectId !== projectId || record.relativePath !== relativePath) {
        throw new FmError('WRITE_FAILED', `手动合并结果与当前冲突文件不匹配：${relativePath}`);
    }
    return record;
}

function createFileSystemSide(rootPath: string): SideIo {
    return {
        rootPath,
        async readBytes(relativePath) {
            const absolutePath = path.join(rootPath, relativePath);
            const buffer = await fs.readFile(absolutePath);
            return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        },
        async writeBytes(relativePath, bytes) {
            const absolutePath = path.join(rootPath, relativePath);
            await writeBytesAtomic(absolutePath, bytes);
        },
        async deletePath(relativePath) {
            const absolutePath = path.join(rootPath, relativePath);
            await deleteFileAndPrune(absolutePath, rootPath);
        },
    };
}

function createMemorySide(label: string, files: Record<string, Uint8Array>): SideIo {
    return {
        rootPath: label,
        async readBytes(relativePath) {
            const bytes = files[relativePath];
            if (!bytes) {
                throw new FmError('PROJECT_NOT_FOUND', `导入源缺少文件：${relativePath}`);
            }
            return bytes;
        },
        async writeBytes() {
            throw new FmError('WRITE_FAILED', '当前同步源不支持写入');
        },
        async deletePath() {
            throw new FmError('WRITE_FAILED', '当前同步源不支持删除');
        },
    };
}

function createMutableMemorySide(label: string, files: Record<string, Uint8Array>): MutableMemorySide {
    const store = Object.fromEntries(
        Object.entries(files).map(([relativePath, bytes]) => [relativePath, new Uint8Array(bytes)]),
    );

    return {
        rootPath: label,
        files: store,
        async readBytes(relativePath) {
            const bytes = store[relativePath];
            if (!bytes) {
                throw new FmError('PROJECT_NOT_FOUND', `共享目录缺少文件：${relativePath}`);
            }
            return new Uint8Array(bytes);
        },
        async writeBytes(relativePath, bytes) {
            store[relativePath] = new Uint8Array(bytes);
        },
        async deletePath(relativePath) {
            delete store[relativePath];
        },
    };
}

async function writeProjectFiles(rootPath: string, files: Record<string, Uint8Array>): Promise<void> {
    for (const [relativePath, bytes] of Object.entries(files)) {
        const absolutePath = path.join(rootPath, relativePath);
        await ensureParentDirectory(absolutePath);
        await fs.writeFile(absolutePath, bytes);
    }
}

async function packProjectFilesToZip(
    config: AppConfig,
    project: Project,
    files: Record<string, Uint8Array>,
): Promise<{ entry: SyncProjectEntry; zip: Uint8Array }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-sync-shared-'));

    try {
        await writeProjectFiles(tempDir, files);
        const entry = await snapshotForPath(config, project, tempDir);
        if (!entry) {
            throw new FmError('SYNC_BUNDLE_INVALID', `无法为项目 ${project.name} 生成共享目录快照`);
        }
        const zip = await packProjectZip(tempDir, entry);
        return { entry, zip };
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

interface SharedDirTargetSnapshot {
    deviceId: string;
    slug: string;
    targetPath: string;
    entry: SyncProjectEntry;
}

async function loadSharedDirTargets(bundleDir: string): Promise<Map<string, SharedDirTargetSnapshot>> {
    try {
        await fs.access(bundleDir);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return new Map();
        throw error;
    }

    const index = await readBundleIndex(bundleDir);
    const manifests = await listDeviceManifests(bundleDir);
    const byDevice = new Map(manifests.map(manifest => [manifest.device.id, manifest]));
    const targets = new Map<string, SharedDirTargetSnapshot>();

    for (const [projectId, latest] of Object.entries(index.latest)) {
        const manifest = byDevice.get(latest.deviceId);
        const entry = manifest?.projects.find(project => project.id === projectId);
        if (!entry) continue;
        targets.set(projectId, {
            deviceId: latest.deviceId,
            slug: latest.slug,
            targetPath: normalizePath(deviceProjectZipPath(bundleDir, latest.deviceId, latest.slug)),
            entry,
        });
    }

    return targets;
}

function buildPendingSharedDirTargetPath(
    bundleDir: string,
    deviceId: string,
    project: Pick<Project, 'id' | 'path'>,
): string {
    return normalizePath(deviceProjectZipPath(bundleDir, deviceId, buildProjectSlug(project.id, project.path)));
}

async function readSharedDirProjectFiles(target: SharedDirTargetSnapshot | undefined, bundleDir: string): Promise<Record<string, Uint8Array>> {
    if (!target) return {};
    const zipBytes = await readProjectZip(bundleDir, target.deviceId, target.slug);
    const { files } = await unpackProjectZip(zipBytes);
    return files;
}

async function loadSyncOperationContext(
    config: AppConfig,
    syncConfig: PreviewableSyncConfig,
    projectId: string,
    relativePath: string,
): Promise<SyncOperationContext> {
    if (syncConfig.type === 'folder') {
        const project = config.projects.find(item => item.id === projectId);
        if (!project) {
            throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${projectId}`);
        }

        const plan = await planFolderProject(config, syncConfig, project);
        const operation = plan.operations.find(item => item.relativePath === relativePath);
        if (!operation) {
            throw new FmError('PROJECT_NOT_FOUND', `同步条目不存在：${relativePath}`);
        }

        return {
            project,
            plan,
            operation,
            localBytes: operation.local ? await createFileSystemSide(project.path).readBytes(relativePath) : undefined,
            targetBytes: operation.target ? await createFileSystemSide(plan.targetPath).readBytes(relativePath) : undefined,
        };
    }

    if (!syncConfig.sharedDir.bundleDir) {
        throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
    }

    const { config: ensuredConfig } = ensureDeviceRegistry(config);
    if (!ensuredConfig.devices) {
        throw new FmError('INTERNAL', '设备注册失败');
    }

    const project = ensuredConfig.projects.find(item => item.id === projectId);
    if (!project) {
        throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${projectId}`);
    }

    const targets = await loadSharedDirTargets(syncConfig.sharedDir.bundleDir);
    const target = targets.get(projectId);
    const plan = await planSharedDirProject(ensuredConfig, syncConfig, project, targets, ensuredConfig.devices.selfId);
    const operation = plan.operations.find(item => item.relativePath === relativePath);
    if (!operation) {
        throw new FmError('PROJECT_NOT_FOUND', `同步条目不存在：${relativePath}`);
    }

    const targetFiles = await readSharedDirProjectFiles(target, syncConfig.sharedDir.bundleDir);
    return {
        project,
        plan,
        operation,
        localBytes: operation.local ? await createFileSystemSide(project.path).readBytes(relativePath) : undefined,
        targetBytes: operation.target ? targetFiles[relativePath] : undefined,
    };
}

export async function openSyncDiff(
    config: AppConfig,
    syncConfig: PreviewableSyncConfig,
    projectId: string,
    relativePath: string,
): Promise<void> {
    const context = await loadSyncOperationContext(config, syncConfig, projectId, relativePath);
    if (!context.localBytes || !context.targetBytes) {
        throw new FmError('CONFIG_INVALID', `当前条目不支持双侧差异对比：${relativePath}`);
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-sync-diff-'));
    const fileName = sanitizeTempName(relativePath);
    const localFilePath = await writeTempBytes(tempDir, `local-${fileName}`, context.localBytes);
    const targetFilePath = await writeTempBytes(tempDir, `target-${fileName}`, context.targetBytes);
    spawnDetachedEditor(['--diff', localFilePath, targetFilePath]);
}

export async function openConflictMerge(
    config: AppConfig,
    syncConfig: PreviewableSyncConfig,
    projectId: string,
    relativePath: string,
): Promise<SyncConflictMergeDraft> {
    const context = await loadSyncOperationContext(config, syncConfig, projectId, relativePath);
    if (context.operation.kind !== 'conflict' || !context.localBytes || !context.targetBytes) {
        throw new FmError('CONFIG_INVALID', `当前条目不是可手动解决的冲突文件：${relativePath}`);
    }

    const draftKey = buildConflictDraftKey(syncConfig.id, projectId, relativePath);
    const existingDraftId = conflictMergeDraftIdsByKey.get(draftKey);
    let draft = existingDraftId ? conflictMergeDrafts.get(existingDraftId) : undefined;

    if (!draft) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-sync-merge-'));
        const fileName = sanitizeTempName(relativePath);
        const mergeDraftId = createMergeDraftId();
        draft = {
            id: mergeDraftId,
            configId: syncConfig.id,
            projectId,
            relativePath,
            updatedAt: new Date().toISOString(),
            localFilePath: await writeTempBytes(tempDir, `local-${fileName}`, context.localBytes),
            targetFilePath: await writeTempBytes(tempDir, `target-${fileName}`, context.targetBytes),
            mergedFilePath: await writeTempBytes(tempDir, `merged-${fileName}`, context.localBytes),
        };
        conflictMergeDraftIdsByKey.set(draftKey, mergeDraftId);
        conflictMergeDrafts.set(mergeDraftId, draft);
    }

    draft.updatedAt = new Date().toISOString();
    conflictMergeDrafts.set(draft.id, draft);
    spawnDetachedEditor(['--diff', draft.localFilePath, draft.targetFilePath]);
    spawnDetachedEditor([draft.mergedFilePath]);

    return {
        id: draft.id,
        projectId: draft.projectId,
        relativePath: draft.relativePath,
        updatedAt: draft.updatedAt,
    };
}

// ---------------------------------------------------------------------------
// 计划生成
// ---------------------------------------------------------------------------

function createMirrorOperation(
    relativePath: string,
    source: SyncFileEntry | undefined,
    target: SyncFileEntry | undefined,
    direction: SyncFileOperation['direction'],
): SyncFileOperation {
    if (!source && target) {
        return {
            relativePath,
            kind: 'delete',
            direction,
            local: direction === 'to-target' ? source : target,
            target: direction === 'to-target' ? target : source,
            // note: '镜像模式会删除目标侧多余文件',
        };
    }
    if (source && !target) {
        return {
            relativePath,
            kind: 'create',
            direction,
            local: direction === 'to-target' ? source : target,
            target: direction === 'to-target' ? target : source,
            // note: '目标侧缺少文件',
        };
    }
    if (!source || !target) {
        return { relativePath, kind: 'skip', direction: 'none', local: source, target };
    }
    if (source.sha1 === target.sha1) {
        return { relativePath, kind: 'skip', direction: 'none', local: source, target, /* note: '内容一致' */ };
    }
    return {
        relativePath,
        kind: 'update',
        direction,
        local: direction === 'to-target' ? source : target,
        target: direction === 'to-target' ? target : source,
        // note: '镜像模式以源侧内容覆盖目标侧',
    };
}

function createTwoWayOperation(
    relativePath: string,
    local: SyncFileEntry | undefined,
    target: SyncFileEntry | undefined,
    baselineHash: string | undefined,
): SyncFileOperation {
    if (local && !target) {
        return {
            relativePath,
            kind: 'create',
            direction: 'to-target',
            local,
            target,
            note: baselineHash ? '目标侧缺失，将从本地恢复' : '仅本地存在',
        };
    }
    if (!local && target) {
        return {
            relativePath,
            kind: 'create',
            direction: 'to-local',
            local,
            target,
            note: baselineHash ? '本地缺失，将从目标恢复' : '仅目标存在',
        };
    }
    if (!local || !target) {
        return { relativePath, kind: 'skip', direction: 'none', local, target };
    }
    if (local.sha1 === target.sha1) {
        return { relativePath, kind: 'skip', direction: 'none', local, target, note: '内容一致' };
    }

    if (baselineHash) {
        const localChanged = local.sha1 !== baselineHash;
        const targetChanged = target.sha1 !== baselineHash;
        if (localChanged && targetChanged) {
            return {
                relativePath,
                kind: 'conflict',
                direction: 'none',
                local,
                target,
                note: '两侧都已相对上次同步发生变化',
            };
        }
        if (localChanged) {
            return {
                relativePath,
                kind: 'update',
                direction: 'to-target',
                local,
                target,
                note: '仅本地发生变化',
            };
        }
        if (targetChanged) {
            return {
                relativePath,
                kind: 'update',
                direction: 'to-local',
                local,
                target,
                note: '仅目标发生变化',
            };
        }
    }

    const localTime = parseIsoTime(local.mtime);
    const targetTime = parseIsoTime(target.mtime);
    if (localTime !== null && targetTime !== null && localTime !== targetTime) {
        return {
            relativePath,
            kind: 'update',
            direction: localTime > targetTime ? 'to-target' : 'to-local',
            local,
            target,
            note: localTime > targetTime ? '本地修改时间更新' : '目标修改时间更新',
        };
    }

    return {
        relativePath,
        kind: 'conflict',
        direction: 'none',
        local,
        target,
        note: '无法安全判断更新方向',
    };
}

export function buildProjectSyncPlan({
    projectId,
    projectName,
    mode,
    localPath,
    targetPath,
    localEntry,
    targetEntry,
    baselineState,
}: {
    projectId: string;
    projectName: string;
    mode: SyncConfig['mode'];
    localPath: string;
    targetPath: string;
    localEntry: SyncProjectEntry | null;
    targetEntry: SyncProjectEntry | null;
    baselineState?: ProjectSyncState;
}): SyncProjectPlan {
    const localByPath = buildFileMap(localEntry?.files);
    const targetByPath = buildFileMap(targetEntry?.files);
    const baselineByPath = buildBaselineMap(baselineState);
    const relativePaths = [...new Set([...localByPath.keys(), ...targetByPath.keys()])].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const operations = relativePaths.map(relativePath => {
        const local = localByPath.get(relativePath);
        const target = targetByPath.get(relativePath);
        if (mode === 'mirror-local-to-target') {
            return createMirrorOperation(relativePath, local, target, 'to-target');
        }
        if (mode === 'mirror-target-to-local') {
            return createMirrorOperation(relativePath, target, local, 'to-local');
        }
        return createTwoWayOperation(relativePath, local, target, baselineByPath.get(relativePath));
    });

    return {
        projectId,
        projectName,
        mode,
        localPath,
        targetPath,
        summary: summarizeOperations(operations),
        operations,
    };
}

function buildFolderTargetPath(syncConfig: Extract<SyncConfig, { type: 'folder' }>, project: Project): string {
    if (!syncConfig.folder.targetDir) {
        throw new FmError('CONFIG_INVALID', `${syncConfig.name} 未配置目标目录`);
    }
    return normalizePath(path.resolve(syncConfig.folder.targetDir, buildProjectSlug(project.id, project.path)));
}

async function planFolderProject(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'folder' }>,
    project: Project,
): Promise<SyncProjectPlan> {
    const targetPath = buildFolderTargetPath(syncConfig, project);
    const localEntry = await snapshotForPath(config, project, project.path);
    const targetEntry = await snapshotForPath(config, project, targetPath, {
        name: project.name,
        description: project.description,
        tags: project.tags,
        ignore: project.ignore,
        fingerprint: project.fingerprint,
    });
    return buildProjectSyncPlan({
        projectId: project.id,
        projectName: project.name,
        mode: syncConfig.mode,
        localPath: project.path,
        targetPath,
        localEntry,
        targetEntry,
        baselineState: resolveProjectSyncState(project, syncConfig.id),
    });
}

export async function previewFolderSync(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'folder' }>,
    projectIds?: string[],
): Promise<SyncPlanPreview> {
    const allowedProjectIds = new Set(projectIds ?? config.projects.map(project => project.id));
    const projects = config.projects.filter(project => allowedProjectIds.has(project.id));
    const plans = await Promise.all(projects.map(project => planFolderProject(config, syncConfig, project)));
    return {
        configId: syncConfig.id,
        configName: syncConfig.name,
        generatedAt: new Date().toISOString(),
        projects: plans,
    };
}

async function planSharedDirProject(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'shared-dir' }>,
    project: Project,
    targets: Map<string, SharedDirTargetSnapshot>,
    selfDeviceId: string,
): Promise<SyncProjectPlan> {
    if (!syncConfig.sharedDir.bundleDir) {
        throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
    }

    const target = targets.get(project.id);
    const localEntry = await snapshotForPath(config, project, project.path);

    return buildProjectSyncPlan({
        projectId: project.id,
        projectName: project.name,
        mode: syncConfig.mode,
        localPath: project.path,
        targetPath: target?.targetPath ?? buildPendingSharedDirTargetPath(syncConfig.sharedDir.bundleDir, selfDeviceId, project),
        localEntry,
        targetEntry: target?.entry ?? null,
        baselineState: resolveProjectSyncState(project, syncConfig.id),
    });
}

export async function previewSharedDirSync(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'shared-dir' }>,
    projectIds?: string[],
): Promise<SyncPlanPreview> {
    if (!syncConfig.sharedDir.bundleDir) {
        throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
    }

    const { config: ensuredConfig } = ensureDeviceRegistry(config);
    if (!ensuredConfig.devices) {
        throw new FmError('INTERNAL', '设备注册失败');
    }

    const targets = await loadSharedDirTargets(syncConfig.sharedDir.bundleDir);
    const allowedProjectIds = new Set(projectIds ?? ensuredConfig.projects.map(project => project.id));
    const projects = ensuredConfig.projects.filter(project => allowedProjectIds.has(project.id));
    const plans = await Promise.all(
        projects.map(project => planSharedDirProject(ensuredConfig, syncConfig, project, targets, ensuredConfig.devices!.selfId)),
    );

    return {
        configId: syncConfig.id,
        configName: syncConfig.name,
        generatedAt: new Date().toISOString(),
        projects: plans,
    };
}

async function applyPlannedOperations(
    plan: SyncProjectPlan,
    localSide: SideIo,
    targetSide: SideIo,
    syncConfigId: string,
    operationSelections = new Map<string, SyncOperationSelectionState>(),
): Promise<AppliedPlanResult> {
    const applied = createEmptyApplySummary();
    const conflictPaths: string[] = [];
    let targetChanged = false;
    let localChanged = false;
    let hadDeferredOperations = false;

    for (const operation of plan.operations) {
        const selection = operationSelections.get(buildOperationSelectionKey(plan.projectId, operation.relativePath));

        if (operation.kind !== 'skip' && selection?.enabled === false) {
            applied.skip += 1;
            hadDeferredOperations = true;
            continue;
        }

        if (operation.kind === 'conflict') {
            if (selection?.conflictResolution === 'keep-local') {
                const bytes = await localSide.readBytes(operation.relativePath);
                await targetSide.writeBytes(operation.relativePath, bytes);
                applied.update += 1;
                targetChanged = true;
                continue;
            }

            if (selection?.conflictResolution === 'keep-target') {
                const bytes = await targetSide.readBytes(operation.relativePath);
                await localSide.writeBytes(operation.relativePath, bytes);
                applied.update += 1;
                localChanged = true;
                continue;
            }

            if (selection?.conflictResolution === 'manual') {
                if (!selection.mergeDraftId) {
                    throw new FmError('WRITE_FAILED', `缺少 ${operation.relativePath} 的手动合并结果。`);
                }
                const draft = getConflictDraftRecord(syncConfigId, plan.projectId, operation.relativePath, selection.mergeDraftId);
                const bytes = await readBytesFromFile(draft.mergedFilePath);
                await localSide.writeBytes(operation.relativePath, bytes);
                await targetSide.writeBytes(operation.relativePath, bytes);
                applied.update += 1;
                localChanged = true;
                targetChanged = true;
                continue;
            }

            applied.conflict += 1;
            conflictPaths.push(operation.relativePath);
            continue;
        }

        if (operation.kind === 'skip' || operation.direction === 'none') {
            applied.skip += 1;
            continue;
        }

        if (operation.direction === 'to-target') {
            if (operation.kind === 'delete') {
                await targetSide.deletePath(operation.relativePath);
            } else {
                const bytes = await localSide.readBytes(operation.relativePath);
                await targetSide.writeBytes(operation.relativePath, bytes);
            }
            applied[operation.kind] += 1;
            targetChanged = true;
            continue;
        }

        if (operation.kind === 'delete') {
            await localSide.deletePath(operation.relativePath);
        } else {
            const bytes = await targetSide.readBytes(operation.relativePath);
            await localSide.writeBytes(operation.relativePath, bytes);
        }
        applied[operation.kind] += 1;
        localChanged = true;
    }

    return {
        projectId: plan.projectId,
        projectName: plan.projectName,
        localPath: plan.localPath,
        targetPath: plan.targetPath,
        applied,
        conflictPaths,
        targetChanged,
        localChanged,
        hadDeferredOperations,
    };
}

function updateProjectInConfig(config: AppConfig, nextProject: Project): AppConfig {
    const exists = config.projects.some(project => project.id === nextProject.id);
    return {
        ...config,
        projects: exists
            ? config.projects.map(project => (project.id === nextProject.id ? nextProject : project))
            : [...config.projects, nextProject],
    };
}

async function buildFinalSnapshotAfterFolderSync(
    config: AppConfig,
    project: Project,
): Promise<SyncProjectEntry> {
    const finalEntry = await snapshotForPath(config, project, project.path);
    if (!finalEntry) {
        throw new FmError('PROJECT_NOT_FOUND', `同步后项目目录不存在：${project.path}`);
    }
    return finalEntry;
}

export async function applyFolderSync(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'folder' }>,
    projectIdsOrRequest?: string[] | SyncPlanApplyRequest,
    request?: SyncPlanApplyRequest,
): Promise<{ result: SyncApplyResult; nextConfig: AppConfig }> {
    const applyRequest = normalizeApplyRequest(projectIdsOrRequest, request);
    const preview = await previewFolderSync(config, syncConfig, applyRequest.projectIds);
    let nextConfig = clearSyncWarnings(config, syncConfig.id);
    const results: SyncApplyProjectResult[] = [];

    for (const plan of preview.projects) {
        const project = nextConfig.projects.find(item => item.id === plan.projectId);
        if (!project) continue;

        try {
            const applied = await applyPlannedOperations(
                plan,
                createFileSystemSide(project.path),
                createFileSystemSide(plan.targetPath),
                syncConfig.id,
                applyRequest.operationSelections,
            );
            results.push(applied);

            if (applied.conflictPaths.length > 0) {
                nextConfig = upsertWarning(nextConfig, createSyncConflictWarning(syncConfig, project, applied.conflictPaths));
                continue;
            }

            nextConfig = clearSyncWarnings(nextConfig, syncConfig.id, project.id);
            if (applied.hadDeferredOperations) {
                continue;
            }

            const finalEntry = await buildFinalSnapshotAfterFolderSync(nextConfig, project);
            const updatedProject = updateProjectSyncState(
                {
                    ...project,
                    syncedAt: new Date().toISOString(),
                    syncedHash: finalEntry.hash,
                },
                syncConfig.id,
                toBaselineState(syncConfig.id, plan.targetPath, finalEntry),
            );
            nextConfig = updateProjectInConfig(nextConfig, updatedProject);
        } catch (error) {
            results.push({
                projectId: project.id,
                projectName: project.name,
                localPath: project.path,
                targetPath: plan.targetPath,
                applied: createEmptyApplySummary(),
                conflictPaths: [],
            });
            nextConfig = upsertWarning(
                nextConfig,
                createSyncErrorWarning(
                    syncConfig,
                    error instanceof Error ? error.message : '文件夹同步失败',
                    project,
                ),
            );
        }
    }

    return {
        result: {
            configId: syncConfig.id,
            configName: syncConfig.name,
            executedAt: new Date().toISOString(),
            projects: results,
        },
        nextConfig,
    };
}

export async function applySharedDirSync(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'shared-dir' }>,
    projectIdsOrRequest?: string[] | SyncPlanApplyRequest,
    request?: SyncPlanApplyRequest,
): Promise<{ result: SyncApplyResult; nextConfig: AppConfig }> {
    if (!syncConfig.sharedDir.bundleDir) {
        throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
    }

    const { config: ensuredConfig } = ensureDeviceRegistry(config);
    if (!ensuredConfig.devices) {
        throw new FmError('INTERNAL', '设备注册失败');
    }

    const applyRequest = normalizeApplyRequest(projectIdsOrRequest, request);
    const preview = await previewSharedDirSync(ensuredConfig, syncConfig, applyRequest.projectIds);
    const targets = await loadSharedDirTargets(syncConfig.sharedDir.bundleDir);
    let nextConfig = clearSyncWarnings(ensuredConfig, syncConfig.id);
    const pushedItems: Array<{ entry: SyncProjectEntry; zip: Uint8Array }> = [];
    const results: SyncApplyProjectResult[] = [];

    for (const plan of preview.projects) {
        const project = nextConfig.projects.find(item => item.id === plan.projectId);
        if (!project) continue;

        try {
            const target = targets.get(project.id);
            const targetSide = createMutableMemorySide(
                plan.targetPath,
                await readSharedDirProjectFiles(target, syncConfig.sharedDir.bundleDir),
            );
            const applied = await applyPlannedOperations(
                plan,
                createFileSystemSide(project.path),
                targetSide,
                syncConfig.id,
                applyRequest.operationSelections,
            );
            results.push(applied);

            let targetPath = target?.targetPath ?? plan.targetPath;
            if (applied.targetChanged) {
                const packed = await packProjectFilesToZip(nextConfig, project, targetSide.files);
                pushedItems.push(packed);
                targetPath = normalizePath(deviceProjectZipPath(syncConfig.sharedDir.bundleDir, ensuredConfig.devices.selfId, packed.entry.slug));
            }

            if (applied.conflictPaths.length > 0) {
                nextConfig = upsertWarning(nextConfig, createSyncConflictWarning(syncConfig, project, applied.conflictPaths));
                continue;
            }

            nextConfig = clearSyncWarnings(nextConfig, syncConfig.id, project.id);
            if (applied.hadDeferredOperations) {
                continue;
            }

            const finalEntry = await buildFinalSnapshotAfterFolderSync(nextConfig, project);
            const updatedProject = updateProjectSyncState(
                {
                    ...project,
                    syncedAt: new Date().toISOString(),
                    syncedHash: finalEntry.hash,
                    syncedFrom: target?.deviceId,
                },
                syncConfig.id,
                toBaselineState(syncConfig.id, targetPath, finalEntry),
            );
            nextConfig = updateProjectInConfig(nextConfig, updatedProject);
        } catch (error) {
            results.push({
                projectId: project.id,
                projectName: project.name,
                localPath: project.path,
                targetPath: plan.targetPath,
                applied: createEmptyApplySummary(),
                conflictPaths: [],
            });
            nextConfig = upsertWarning(
                nextConfig,
                createSyncErrorWarning(
                    syncConfig,
                    error instanceof Error ? error.message : '共享目录同步失败',
                    project,
                ),
            );
        }
    }

    if (pushedItems.length > 0) {
        await publishToBundleDir(
            syncConfig.sharedDir.bundleDir,
            {
                schema: 'fm.sync/v1',
                generatedAt: new Date().toISOString(),
                device: {
                    id: ensuredConfig.devices.selfId,
                    name: ensuredConfig.devices.selfName,
                },
                projects: pushedItems.map(item => item.entry),
            },
            pushedItems,
        );
    }

    return {
        result: {
            configId: syncConfig.id,
            configName: syncConfig.name,
            executedAt: new Date().toISOString(),
            projects: results,
        },
        nextConfig,
    };
}

// ---------------------------------------------------------------------------
// ZIP 导入
// ---------------------------------------------------------------------------

export interface ZipImportTarget {
    projectId: string;
    targetPath: string;
}

function resolveZipImportMode(mode: SyncConfig['mode']): SyncConfig['mode'] {
    return mode === 'mirror-local-to-target' ? 'mirror-target-to-local' : mode;
}

function projectFromEntry(config: AppConfig, entry: SyncProjectEntry, targetPath: string): Project {
    const existing = config.projects.find(project => project.id === entry.id);
    if (existing) {
        return {
            ...existing,
            path: normalizePath(targetPath),
            rootId: resolveProjectRootId(config, targetPath),
        };
    }
    return {
        projectId: entry.id,
        id: entry.id,
        path: normalizePath(targetPath),
        rootId: resolveProjectRootId(config, targetPath),
        hasMetaFile: hasMetadataFile(entry),
        lastScannedAt: new Date(0).toISOString(),
        lastModifiedAt: undefined,
        syncedAt: undefined,
        syncedHash: undefined,
        syncedFrom: undefined,
        syncStates: undefined,
        name: entry.meta.name,
        description: entry.meta.description,
        tags: [...entry.meta.tags],
        ignore: [...(entry.meta.ignore ?? [])],
        syncRespectGitignore: entry.meta.syncRespectGitignore,
        fingerprint: entry.meta.fingerprint ?? buildFingerprintFallback(),
    };
}

async function planZipImportProject(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'zip' }>,
    entry: SyncProjectEntry,
    targetPath: string,
): Promise<SyncProjectPlan> {
    const effectiveMode = resolveZipImportMode(syncConfig.mode);
    const project = projectFromEntry(config, entry, targetPath);
    const localEntry = await snapshotForPath(config, project, targetPath, entry.meta);
    const rawPlan = buildProjectSyncPlan({
        projectId: entry.id,
        projectName: entry.meta.name,
        mode: effectiveMode,
        localPath: normalizePath(targetPath),
        targetPath: `${normalizePath(syncConfig.zip.exportFile ?? 'zip-import')}/${entry.slug}`,
        localEntry,
        targetEntry: entry,
    });

    const adjustedOperations = rawPlan.operations.map(operation => operation.direction === 'to-target'
        ? {
            ...operation,
            kind: 'skip' as const,
            direction: 'none' as const,
            note: operation.note ?? '导入流程不会回写 ZIP 源',
        }
        : operation);

    return {
        ...rawPlan,
        operations: adjustedOperations,
        summary: summarizeOperations(adjustedOperations),
    };
}

export async function previewZipImport(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'zip' }>,
    zipFile: string,
    targets: ZipImportTarget[],
): Promise<SyncPlanPreview> {
    const buffer = await fs.readFile(zipFile);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const { projects } = await unpackBundle(bytes);
    const targetMap = new Map(targets.map(item => [item.projectId, normalizePath(item.targetPath)]));
    const plans: SyncProjectPlan[] = [];

    for (const { entry } of Object.values(projects)) {
        const targetPath = targetMap.get(entry.id);
        if (!targetPath) continue;
        plans.push(await planZipImportProject(config, syncConfig, entry, targetPath));
    }

    return {
        configId: syncConfig.id,
        configName: syncConfig.name,
        generatedAt: new Date().toISOString(),
        projects: plans,
    };
}

export async function applyZipImport(
    config: AppConfig,
    syncConfig: Extract<SyncConfig, { type: 'zip' }>,
    zipFile: string,
    targets: ZipImportTarget[],
): Promise<{ result: SyncApplyResult; nextConfig: AppConfig }> {
    const buffer = await fs.readFile(zipFile);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const { projects } = await unpackBundle(bytes);
    const targetMap = new Map(targets.map(item => [item.projectId, normalizePath(item.targetPath)]));
    let nextConfig = clearSyncWarnings(config, syncConfig.id);
    const results: SyncApplyProjectResult[] = [];

    for (const { entry, files } of Object.values(projects)) {
        const targetPath = targetMap.get(entry.id);
        if (!targetPath) continue;

        const project = projectFromEntry(nextConfig, entry, targetPath);
        try {
            const plan = await planZipImportProject(nextConfig, syncConfig, entry, targetPath);
            const applied = await applyPlannedOperations(
                plan,
                createFileSystemSide(normalizePath(targetPath)),
                createMemorySide(`${zipFile}#${entry.slug}`, files),
                syncConfig.id,
            );
            results.push(applied);

            if (applied.conflictPaths.length > 0) {
                nextConfig = upsertWarning(nextConfig, createSyncConflictWarning(syncConfig, project, applied.conflictPaths));
                continue;
            }

            const updatedSnapshot = await snapshotForPath(nextConfig, project, targetPath, entry.meta);
            if (!updatedSnapshot) {
                nextConfig = upsertWarning(nextConfig, createSyncErrorWarning(syncConfig, `导入后找不到项目目录：${targetPath}`, project));
                continue;
            }

            const nextProject: Project = {
                ...project,
                path: normalizePath(targetPath),
                rootId: resolveProjectRootId(nextConfig, targetPath),
                hasMetaFile: hasMetadataFile(updatedSnapshot),
                lastScannedAt: new Date().toISOString(),
                lastModifiedAt: updatedSnapshot.modifiedAt,
                syncedAt: new Date().toISOString(),
                syncedHash: updatedSnapshot.hash,
                syncedFrom: 'zip-import',
                name: entry.meta.name,
                description: entry.meta.description,
                tags: [...entry.meta.tags],
                ignore: [...(entry.meta.ignore ?? [])],
                syncRespectGitignore: entry.meta.syncRespectGitignore,
                fingerprint: entry.meta.fingerprint ?? buildFingerprintFallback(),
            };
            nextConfig = clearSyncWarnings(nextConfig, syncConfig.id, nextProject.id);
            nextConfig = updateProjectInConfig(nextConfig, nextProject);
        } catch (error) {
            results.push({
                projectId: entry.id,
                projectName: entry.meta.name,
                localPath: normalizePath(targetPath),
                targetPath: `${zipFile}#${entry.slug}`,
                applied: createEmptyApplySummary(),
                conflictPaths: [],
            });
            nextConfig = upsertWarning(
                nextConfig,
                createSyncErrorWarning(syncConfig, error instanceof Error ? error.message : 'ZIP 导入失败', project),
            );
        }
    }

    return {
        result: {
            configId: syncConfig.id,
            configName: syncConfig.name,
            executedAt: new Date().toISOString(),
            projects: results,
        },
        nextConfig,
    };
}
