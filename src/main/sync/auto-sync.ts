import type { AppConfig, ScanWarning, SyncErrorWarning } from '../../shared/types.js';
import type { SyncConfig } from '../../shared/sync-types.js';
import { resolveSyncProjectIds } from '../../shared/sync-config.js';
import { createLogger } from '../../shared/logger.js';
import { mutate, requireSession } from '../session.js';
import { applyFolderSync } from './file-sync.js';

const logger = createLogger('main:sync:auto');

interface FolderSchedule {
    timer: NodeJS.Timeout;
    intervalMs: number;
}

const folderSchedules = new Map<string, FolderSchedule>();
const runningConfigs = new Set<string>();

function createWarningId(kind: string): string {
    return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSyncErrorWarning(
    syncConfig: Pick<SyncConfig, 'id' | 'name'>,
    message: string,
): SyncErrorWarning {
    return {
        id: createWarningId('sync-error'),
        kind: 'sync-error',
        configId: syncConfig.id,
        configName: syncConfig.name,
        message,
        createdAt: new Date().toISOString(),
    };
}

function clearConfigWarnings(config: AppConfig, configId: string): AppConfig {
    return {
        ...config,
        warnings: config.warnings.filter(warning => {
            if (warning.kind !== 'sync-conflict' && warning.kind !== 'sync-error') return true;
            return warning.configId !== configId;
        }),
    };
}

function upsertWarning(config: AppConfig, warning: ScanWarning): AppConfig {
    const filtered = clearConfigWarnings(config, warning.kind === 'fingerprint-conflict' ? '' : warning.configId);
    return {
        ...filtered,
        warnings: [...filtered.warnings, warning],
    };
}

function getAutoFolderConfigs(config: AppConfig): Array<Extract<SyncConfig, { type: 'folder' }>> {
    return (config.syncConfigs ?? []).filter(
        (item): item is Extract<SyncConfig, { type: 'folder' }> =>
            item.type === 'folder'
            && item.folder.autoSync
            && Boolean(item.folder.targetDir)
            && typeof item.folder.intervalMinutes === 'number'
            && item.folder.intervalMinutes > 0,
    );
}

async function runFolderAutoSync(configId: string): Promise<void> {
    if (runningConfigs.has(configId)) {
        logger.debug('自动同步仍在执行，跳过本轮', { configId });
        return;
    }

    runningConfigs.add(configId);
    try {
        const session = requireSession();
        const syncConfig = session.config.syncConfigs?.find(
            (item): item is Extract<SyncConfig, { type: 'folder' }> => item.id === configId && item.type === 'folder',
        );
        if (!syncConfig || !syncConfig.folder.autoSync || !syncConfig.folder.targetDir) {
            logger.debug('自动同步配置不可用，跳过', { configId });
            return;
        }

        const projectIds = resolveSyncProjectIds(syncConfig, session.config.projects);
        if (projectIds.length === 0) {
            logger.debug('自动同步没有可处理项目', { configId });
            return;
        }

        const { result, nextConfig } = await applyFolderSync(session.config, syncConfig, projectIds);
        await mutate(() => ({ nextConfig, result: undefined as void }));

        const summary = result.projects.reduce(
            (acc, project) => ({
                create: acc.create + project.applied.create,
                update: acc.update + project.applied.update,
                delete: acc.delete + project.applied.delete,
                conflict: acc.conflict + project.applied.conflict,
            }),
            { create: 0, update: 0, delete: 0, conflict: 0 },
        );
        logger.info('自动同步完成', {
            configId,
            projects: result.projects.length,
            ...summary,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '自动同步执行失败';
        logger.error('自动同步失败', error);

        try {
            await mutate(({ config }) => ({
                nextConfig: upsertWarning(
                    config,
                    createSyncErrorWarning(
                        requireSession().config.syncConfigs?.find(item => item.id === configId) ?? { id: configId, name: configId },
                        message,
                    ),
                ),
                result: undefined as void,
            }));
        } catch (warningError) {
            logger.error('写入自动同步错误警告失败', warningError);
        }
    } finally {
        runningConfigs.delete(configId);
    }
}

export function refreshAutoSyncSchedules(): void {
    const session = requireSession();
    const configs = getAutoFolderConfigs(session.config);
    const activeIds = new Set(configs.map(item => item.id));

    for (const [configId, schedule] of folderSchedules) {
        if (!activeIds.has(configId)) {
            clearInterval(schedule.timer);
            folderSchedules.delete(configId);
            logger.info('已移除自动同步计划', { configId });
        }
    }

    for (const syncConfig of configs) {
        const intervalMs = Math.max(1, syncConfig.folder.intervalMinutes ?? 1) * 60_000;
        const current = folderSchedules.get(syncConfig.id);
        if (current && current.intervalMs === intervalMs) {
            continue;
        }
        if (current) {
            clearInterval(current.timer);
        }
        const timer = setInterval(() => {
            void runFolderAutoSync(syncConfig.id);
        }, intervalMs);
        folderSchedules.set(syncConfig.id, { timer, intervalMs });
        logger.info('已注册自动同步计划', {
            configId: syncConfig.id,
            intervalMinutes: syncConfig.folder.intervalMinutes,
        });
    }
}

export function disposeAutoSyncSchedules(): void {
    for (const schedule of folderSchedules.values()) {
        clearInterval(schedule.timer);
    }
    folderSchedules.clear();
    runningConfigs.clear();
}
