import type { App } from 'electron';
import { createLogger } from '../shared/logger.js';
import type { AppPreferences } from '../shared/types.js';

const logger = createLogger('main:login-item');

export interface LoginItemSettings {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    path?: string;
    args?: string[];
    enabled?: boolean;
}

export interface LoginItemApi {
    isPackaged: boolean;
    setLoginItemSettings(settings: LoginItemSettings): void;
}

export function isLoginItemSupported(platform = process.platform): boolean {
    return platform === 'win32' || platform === 'darwin';
}

export function resolveLoginItemSettings(
    preferences: Pick<AppPreferences, 'autoLaunchEnabled'>,
    options: {
        platform?: NodeJS.Platform;
        execPath?: string;
        isPackaged?: boolean;
    } = {},
): LoginItemSettings | null {
    const {
        platform = process.platform,
        execPath = process.execPath,
        isPackaged = true,
    } = options;

    if (!isLoginItemSupported(platform) || !isPackaged) {
        return null;
    }

    if (platform === 'win32') {
        return {
            openAtLogin: preferences.autoLaunchEnabled,
            path: execPath,
            args: ['--tray'],
            enabled: true,
        };
    }

    return {
        openAtLogin: preferences.autoLaunchEnabled,
        openAsHidden: true,
    };
}

export function syncLoginItemSettings(
    appLike: Pick<App, 'isPackaged' | 'setLoginItemSettings'> | LoginItemApi,
    preferences: Pick<AppPreferences, 'autoLaunchEnabled'>,
    options: {
        platform?: NodeJS.Platform;
        execPath?: string;
    } = {},
): boolean {
    const settings = resolveLoginItemSettings(preferences, {
        ...options,
        isPackaged: appLike.isPackaged,
    });

    if (!settings) {
        logger.info('当前环境跳过开机启动设置同步', {
            platform: options.platform ?? process.platform,
            isPackaged: appLike.isPackaged,
        });
        return false;
    }

    appLike.setLoginItemSettings(settings);
    logger.info('已同步开机启动设置', {
        openAtLogin: settings.openAtLogin,
        platform: options.platform ?? process.platform,
    });
    return true;
}