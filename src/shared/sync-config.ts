// ---------------------------------------------------------------------------
// 同步配置通用工具：归一化、项目命中规则、文案摘要
// ---------------------------------------------------------------------------

import type { Project } from './types.js';
import {
    type FolderSyncConfig,
    type P2PSyncConfig,
    type SharedDirSyncConfig,
    type SyncConfig,
    type SyncConfigScope,
    type SyncTargeting,
    type ZipSyncConfig,
    createDefaultFolderSyncSettings,
    createDefaultSharedDirSyncSettings,
    createDefaultSyncConfig,
    createDefaultSyncNetwork,
    createDefaultSyncTargeting,
    createDefaultZipSyncSettings,
    getSyncConfigTypeLabel,
    getSyncModeLabel,
} from './sync-types.js';

export type SyncProjectRule = 'default' | 'selected' | 'ignored';

export type EffectiveSyncProjectState =
    | 'selected'
    | 'ignored'
    | 'default-selected'
    | 'default-excluded';

function unique(values: readonly string[] | undefined): string[] {
    if (!values) return [];
    return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function normalizeSyncTargeting(input?: Partial<SyncTargeting>): SyncTargeting {
    const fallback = createDefaultSyncTargeting();
    return {
        projectIds: unique(input?.projectIds ?? fallback.projectIds),
        rootIds: unique(input?.rootIds ?? fallback.rootIds),
        ignoredProjectIds: unique(input?.ignoredProjectIds ?? fallback.ignoredProjectIds),
        ignoredRootIds: unique(input?.ignoredRootIds ?? fallback.ignoredRootIds),
    };
}

function normalizeFolderConfig(config: FolderSyncConfig): FolderSyncConfig {
    const defaults = createDefaultFolderSyncSettings();
    return {
        ...config,
        name: config.name.trim() || getSyncConfigTypeLabel(config.type),
        targets: normalizeSyncTargeting(config.targets),
        folder: {
            targetDir: config.folder.targetDir?.trim() || undefined,
            compareBeforeSync: config.folder.compareBeforeSync ?? defaults.compareBeforeSync,
            autoSync: config.folder.autoSync ?? defaults.autoSync,
            intervalMinutes:
                typeof config.folder.intervalMinutes === 'number' && Number.isFinite(config.folder.intervalMinutes) && config.folder.intervalMinutes > 0
                    ? Math.floor(config.folder.intervalMinutes)
                    : undefined,
        },
    };
}

function normalizeSharedDirConfig(config: SharedDirSyncConfig): SharedDirSyncConfig {
    const defaults = createDefaultSharedDirSyncSettings();
    return {
        ...config,
        name: config.name.trim() || getSyncConfigTypeLabel(config.type),
        targets: normalizeSyncTargeting(config.targets),
        sharedDir: {
            bundleDir: config.sharedDir.bundleDir?.trim() || defaults.bundleDir,
        },
    };
}

function normalizeZipConfig(config: ZipSyncConfig): ZipSyncConfig {
    const defaults = createDefaultZipSyncSettings();
    return {
        ...config,
        name: config.name.trim() || getSyncConfigTypeLabel(config.type),
        targets: normalizeSyncTargeting(config.targets),
        zip: {
            exportFile: config.zip.exportFile?.trim() || defaults.exportFile,
        },
    };
}

function normalizeP2PConfig(config: P2PSyncConfig): P2PSyncConfig {
    const defaults = createDefaultSyncNetwork();
    return {
        ...config,
        name: config.name.trim() || getSyncConfigTypeLabel(config.type),
        targets: normalizeSyncTargeting(config.targets),
        network: {
            listenPort:
                typeof config.network.listenPort === 'number' && Number.isFinite(config.network.listenPort) && config.network.listenPort > 0 && config.network.listenPort < 65536
                    ? Math.floor(config.network.listenPort)
                    : defaults.listenPort,
            autoStart: config.network.autoStart ?? defaults.autoStart,
            relayMode: config.network.relayMode ?? defaults.relayMode,
            ownerDeviceId: config.network.ownerDeviceId?.trim() || undefined,
            accessKey: config.network.accessKey?.trim() || undefined,
        },
    };
}

export function normalizeSyncConfig(config: SyncConfig): SyncConfig {
    switch (config.type) {
        case 'folder':
            return normalizeFolderConfig(config);
        case 'shared-dir':
            return normalizeSharedDirConfig(config);
        case 'zip':
            return normalizeZipConfig(config);
        case 'p2p':
            return normalizeP2PConfig(config);
    }
}

export function createScopedSyncConfig(type: SyncConfig['type'], scope: SyncConfigScope): SyncConfig {
    return normalizeSyncConfig(createDefaultSyncConfig(type, scope));
}

export function getEffectiveSyncProjectState(
    config: Pick<SyncConfig, 'targets'>,
    project: Pick<Project, 'id' | 'rootId'>,
): EffectiveSyncProjectState {
    const targets = normalizeSyncTargeting(config.targets);
    if (targets.ignoredProjectIds.includes(project.id) || targets.ignoredRootIds.includes(project.rootId)) {
        return 'ignored';
    }
    if (targets.projectIds.includes(project.id) || targets.rootIds.includes(project.rootId)) {
        return 'selected';
    }
    if (targets.projectIds.length === 0 && targets.rootIds.length === 0) {
        return 'default-selected';
    }
    return 'default-excluded';
}

export function resolveSyncProjectIds(
    config: Pick<SyncConfig, 'targets'>,
    projects: readonly Pick<Project, 'id' | 'rootId'>[],
): string[] {
    return projects
        .filter(project => {
            const state = getEffectiveSyncProjectState(config, project);
            return state === 'selected' || state === 'default-selected';
        })
        .map(project => project.id);
}

export function setProjectSyncRule(
    config: SyncConfig,
    project: Pick<Project, 'id' | 'rootId'>,
    rule: SyncProjectRule,
): SyncConfig {
    const targets = normalizeSyncTargeting(config.targets);
    const nextTargets: SyncTargeting = {
        ...targets,
        projectIds: targets.projectIds.filter(id => id !== project.id),
        ignoredProjectIds: targets.ignoredProjectIds.filter(id => id !== project.id),
    };

    if (rule === 'selected') {
        nextTargets.projectIds = [...nextTargets.projectIds, project.id];
    }
    if (rule === 'ignored') {
        nextTargets.ignoredProjectIds = [...nextTargets.ignoredProjectIds, project.id];
    }

    return normalizeSyncConfig({
        ...config,
        targets: nextTargets,
    });
}

export function summarizeSyncConfig(config: SyncConfig): string[] {
    const summary = [getSyncModeLabel(config.mode)];
    switch (config.type) {
        case 'folder':
            summary.push(config.folder.targetDir || '未设置目标目录');
            summary.push(config.folder.autoSync ? `自动同步 / ${config.folder.intervalMinutes ?? '?'} 分钟` : '手动同步');
            break;
        case 'shared-dir':
            summary.push(config.sharedDir.bundleDir || '未设置共享目录');
            break;
        case 'zip':
            summary.push(config.zip.exportFile || '手动选择导出文件');
            break;
        case 'p2p':
            summary.push(`端口 ${config.network.listenPort}`);
            summary.push(config.network.relayMode ? '中转模式' : '直连模式');
            break;
    }
    return summary;
}

export function describeSyncTargets(config: Pick<SyncConfig, 'targets'>): string {
    const targets = normalizeSyncTargeting(config.targets);
    const includes = targets.projectIds.length + targets.rootIds.length;
    const excludes = targets.ignoredProjectIds.length + targets.ignoredRootIds.length;
    if (includes === 0 && excludes === 0) {
        return '默认作用于全部项目';
    }
    const parts: string[] = [];
    if (includes > 0) parts.push(`包含 ${includes} 条规则`);
    if (excludes > 0) parts.push(`忽略 ${excludes} 条规则`);
    return parts.join('，');
}
