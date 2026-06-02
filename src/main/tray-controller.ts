import path from 'node:path';
import fs from 'node:fs';
import { Menu, Tray, app, nativeImage, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import {
    PRESET_ACTIONS,
    type CustomAction,
    type PresetActionId,
    type SyncApplyResult,
    type SyncConfig,
} from '../shared/sync-types.js';
import { resolveSyncProjectIds } from '../shared/sync-config.js';
import { FAVORITE_TAG_GROUP_NAME, findRequiredTagGroup, matchesTagGroup } from '../shared/dynamic-tags.js';
import type { AppConfig, AppPreferences } from '../shared/types.js';
import { createLogger } from '../shared/logger.js';
import { runAction } from './commands/runner.js';
import { getSnapshot, mutate } from './session.js';
import { applyFolderSync, applySharedDirSync } from './sync/file-sync.js';

const logger = createLogger('main:tray');
const TRAY_PRESET_ACTION_IDS: PresetActionId[] = ['open.explorer', 'open.vscode', 'open.terminal'];
const PRESET_LABELS = new Map(PRESET_ACTIONS.map(a => [a.id, a.label] as const));

export interface TrayProjectActionDescriptor {
    id: string;
    label: string;
    kind: 'preset' | 'custom';
}

export interface TrayProjectEntry {
    projectId: string;
    label: string;
    path: string;
    actions: TrayProjectActionDescriptor[];
}

export interface TraySyncActionDescriptor {
    configId: string;
    label: string;
    type: Extract<SyncConfig, { type: 'folder' | 'shared-dir' }>['type'];
    projectCount: number;
}

export interface TrayController {
    applyPreferences(preferences: AppPreferences): Promise<void>;
    refreshContextMenu(): void;
    handleWindowHidden(): void;
    hasTray(): boolean;
    destroy(): void;
}

interface TrayControllerOptions {
    showMainWindow(): BrowserWindow;
    requestQuit(): void;
    openNewProject(): void;
}

function buildProjectActionDescriptors(
    projectActions: readonly CustomAction[],
    sharedProjectActions: readonly CustomAction[],
    globalActions: readonly CustomAction[],
): TrayProjectActionDescriptor[] {
    return [
        ...TRAY_PRESET_ACTION_IDS.map(id => ({
            id,
            label: PRESET_LABELS.get(id) ?? id,
            kind: 'preset' as const,
        })),
        ...projectActions.map(a => ({
            id: a.id,
            label: a.label,
            kind: 'custom' as const,
        })),
        ...sharedProjectActions.map(a => ({
            id: a.id,
            label: a.label,
            kind: 'custom' as const,
        })),
        ...globalActions.map(a => ({
            id: a.id,
            label: a.label,
            kind: 'custom' as const,
        })),
    ];
}

export function listTrayProjectEntries(config: AppConfig): TrayProjectEntry[] {
    const globalActions = config.actions ?? [];
    const favoriteGroup = findRequiredTagGroup(config.tagGroups, FAVORITE_TAG_GROUP_NAME);
    if (!favoriteGroup || favoriteGroup.tags.length === 0) {
        return [];
    }
    return config.projects
        .filter(project => matchesTagGroup({
            tags: project.tags,
            modifiedAt: readProjectDirectoryModifiedAt(project.path),
        }, favoriteGroup.tags))
        .map(project => ({
            projectId: project.id,
            label: project.name.trim() || project.path,
            path: project.path,
            actions: buildProjectActionDescriptors(project.actions ?? [], project.sharedActions ?? [], globalActions),
        }));
}

function readProjectDirectoryModifiedAt(projectPath: string): string | undefined {
    try {
        return fs.statSync(projectPath).mtime?.toISOString();
    } catch {
        return undefined;
    }
}

export function listTraySyncActions(config: AppConfig): TraySyncActionDescriptor[] {
    return (config.syncConfigs ?? [])
        .filter((item): item is Extract<SyncConfig, { type: 'folder' | 'shared-dir' }> => item.type === 'folder' || item.type === 'shared-dir')
        .map(syncConfig => ({
            configId: syncConfig.id,
            label: syncConfig.name,
            type: syncConfig.type,
            projectCount: resolveSyncProjectIds(syncConfig, config.projects).length,
        }));
}

function summarizeSyncResult(result: SyncApplyResult): string {
    const projectCount = result.projects.length;
    const conflictCount = result.projects.reduce((total, project) => total + project.conflictPaths.length, 0);
    if (projectCount === 0) {
        return '没有可同步的项目。';
    }
    return conflictCount > 0
        ? `已完成 ${projectCount} 个项目同步，存在 ${conflictCount} 个冲突文件。`
        : `已完成 ${projectCount} 个项目同步。`;
}

async function runTraySync(configId: string): Promise<SyncApplyResult> {
    const snapshot = getSnapshot();
    if (!snapshot.hasLoadedConfig) {
        throw new Error('当前尚未加载配置，无法从托盘执行同步');
    }

    const config = snapshot.data;
    const syncConfig = (config.syncConfigs ?? []).find(item => item.id === configId);
    if (!syncConfig) {
        throw new Error(`同步配置不存在：${configId}`);
    }

    const projectIds = resolveSyncProjectIds(syncConfig, config.projects);
    if (syncConfig.type === 'folder') {
        const { result, nextConfig } = await applyFolderSync(config, syncConfig, projectIds);
        await mutate(() => ({ nextConfig, result: undefined as void }));
        return result;
    }

    if (syncConfig.type === 'shared-dir') {
        const { result, nextConfig } = await applySharedDirSync(config, syncConfig, projectIds);
        await mutate(() => ({ nextConfig, result: undefined as void }));
        return result;
    }

    throw new Error(`托盘暂不支持的同步类型：${syncConfig.type}`);
}

function buildProjectSubmenu(
    entry: TrayProjectEntry,
    onRunAction: (projectId: string, actionId: string) => void,
): MenuItemConstructorOptions[] {
    return [
        { label: entry.path, enabled: false },
        { type: 'separator' },
        ...entry.actions.map(a => ({
            label: a.label,
            click: () => {
                onRunAction(entry.projectId, a.id);
            },
        })),
    ];
}

export function createTrayController(options: TrayControllerOptions): TrayController {
    let tray: Tray | null = null;
    let hasShownHideHint = false;

    function notify(title: string, content: string): void {
        logger.info(title, { content });
        if (process.platform === 'win32' && tray) {
            try {
                tray.displayBalloon({ title, content });
            } catch (error) {
                logger.warn('托盘气泡提示失败', { error });
            }
        }
    }

    async function resolveTrayIcon() {
        try {
            const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.ico');
            const image = nativeImage.createFromPath(iconPath);
            if (image.isEmpty()) {
                logger.warn('托盘图标为空，回退到应用图标');
                const appIcon = await app.getFileIcon(process.execPath, { size: 'small' });
                return appIcon.isEmpty() ? nativeImage.createEmpty() : appIcon;
            }
            return image;
        } catch (error) {
            logger.warn('读取托盘图标失败，回退到空图标', { error });
            return nativeImage.createEmpty();
        }
    }

    async function runActionFromTray(projectId: string, actionId: string): Promise<void> {
        try {
            const snapshot = getSnapshot();
            if (!snapshot.hasLoadedConfig) {
                throw new Error('当前尚未加载配置，无法执行项目动作');
            }
            await runAction(snapshot.data, { projectId, actionId }, process.platform);
        } catch (error) {
            const message = error instanceof Error ? error.message : '项目动作执行失败';
            notify('托盘动作执行失败', message);
        }
    }

    async function runSyncFromTray(configId: string, label: string): Promise<void> {
        try {
            const result = await runTraySync(configId);
            notify(`同步完成：${label}`, summarizeSyncResult(result));
        } catch (error) {
            const message = error instanceof Error ? error.message : '同步失败';
            notify(`同步失败：${label}`, message);
        }
    }

    function buildContextMenu() {
        const snapshot = getSnapshot();
        const config = snapshot.hasLoadedConfig ? snapshot.data : null;
        const projectEntries = config ? listTrayProjectEntries(config) : [];
        const syncActions = config ? listTraySyncActions(config) : [];

        const projectMenuItems: MenuItemConstructorOptions[] = projectEntries.length > 0
            ? projectEntries.map(entry => ({
                label: entry.label,
                submenu: buildProjectSubmenu(entry, (projectId, actionId) => {
                    void runActionFromTray(projectId, actionId);
                }),
            }))
            : [{ label: snapshot.hasLoadedConfig ? '暂无项目' : '尚未加载配置', enabled: false }];

        const syncMenuItems: MenuItemConstructorOptions[] = syncActions.length > 0
            ? syncActions.map(action => ({
                label: `${action.label}${action.projectCount > 0 ? ` (${action.projectCount})` : ''}`,
                enabled: action.projectCount > 0,
                click: () => {
                    void runSyncFromTray(action.configId, action.label);
                },
            }))
            : [{ label: snapshot.hasLoadedConfig ? '暂无可执行同步配置' : '尚未加载配置', enabled: false }];

        return Menu.buildFromTemplate([
            {
                label: '显示主窗口',
                click: () => {
                    options.showMainWindow();
                },
            },
            {
                label: '新建项目',
                click: () => {
                    options.openNewProject();
                },
            },
            { type: 'separator' },
            ...projectMenuItems,
            { type: 'separator' },
            {
                label: '同步',
                submenu: syncMenuItems,
            },
            { type: 'separator' },
            {
                label: '退出',
                click: () => {
                    options.requestQuit();
                },
            },
        ]);
    }

    async function ensureTray(): Promise<void> {
        if (tray) {
            return;
        }

        const icon = await resolveTrayIcon();
        tray = new Tray(icon);
        tray.setToolTip(app.getName());
        tray.setContextMenu(buildContextMenu());
        tray.on('click', () => {
            options.showMainWindow();
        });
        tray.on('double-click', () => {
            options.showMainWindow();
        });
        logger.info('托盘已创建');
    }

    function disposeTray(): void {
        if (!tray) {
            return;
        }
        tray.destroy();
        tray = null;
        hasShownHideHint = false;
        logger.info('托盘已销毁');
    }

    return {
        applyPreferences: async preferences => {
            if (preferences.trayEnabled) {
                await ensureTray();
                return;
            }
            disposeTray();
        },
        refreshContextMenu: () => {
            if (!tray) return;
            tray.setContextMenu(buildContextMenu());
        },
        handleWindowHidden: () => {
            if (!tray || hasShownHideHint) {
                return;
            }
            hasShownHideHint = true;
        },
        hasTray: () => tray !== null,
        destroy: () => {
            disposeTray();
        },
    };
}
