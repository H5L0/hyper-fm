import { describe, expect, test, vi } from 'vitest';
import {
    isLoginItemSupported,
    resolveLoginItemSettings,
    syncLoginItemSettings,
    type LoginItemSettings,
} from './login-item.js';

describe('login-item', () => {
    test('isLoginItemSupported 应只在 Windows 与 macOS 返回 true', () => {
        expect(isLoginItemSupported('win32')).toBe(true);
        expect(isLoginItemSupported('darwin')).toBe(true);
        expect(isLoginItemSupported('linux')).toBe(false);
    });

    test('resolveLoginItemSettings 在开发模式下应跳过生成设置', () => {
        expect(resolveLoginItemSettings(
            { autoLaunchEnabled: true },
            { platform: 'win32', isPackaged: false, execPath: 'C:/Apps/hyper-fm.exe' },
        )).toBeNull();
    });

    test('resolveLoginItemSettings 应为 Windows 生成带路径的启动配置', () => {
        expect(resolveLoginItemSettings(
            { autoLaunchEnabled: true },
            { platform: 'win32', isPackaged: true, execPath: 'C:/Apps/hyper-fm.exe' },
        )).toEqual({
            openAtLogin: true,
            path: 'C:/Apps/hyper-fm.exe',
            args: [],
            enabled: true,
        });
    });

    test('resolveLoginItemSettings 应为 macOS 生成基础启动配置', () => {
        expect(resolveLoginItemSettings(
            { autoLaunchEnabled: false },
            { platform: 'darwin', isPackaged: true, execPath: '/Applications/hyper-fm.app' },
        )).toEqual({
            openAtLogin: false,
        });
    });

    test('syncLoginItemSettings 应调用 Electron 登录项接口', () => {
        const setLoginItemSettings = vi.fn<(settings: LoginItemSettings) => void>();
        const applied = syncLoginItemSettings(
            { isPackaged: true, setLoginItemSettings },
            { autoLaunchEnabled: true },
            { platform: 'win32', execPath: 'C:/Apps/hyper-fm.exe' },
        );

        expect(applied).toBe(true);
        expect(setLoginItemSettings).toHaveBeenCalledWith({
            openAtLogin: true,
            path: 'C:/Apps/hyper-fm.exe',
            args: [],
            enabled: true,
        });
    });

    test('syncLoginItemSettings 在不支持的平台应跳过调用', () => {
        const setLoginItemSettings = vi.fn<(settings: LoginItemSettings) => void>();
        const applied = syncLoginItemSettings(
            { isPackaged: true, setLoginItemSettings },
            { autoLaunchEnabled: true },
            { platform: 'linux', execPath: '/usr/bin/hyper-fm' },
        );

        expect(applied).toBe(false);
        expect(setLoginItemSettings).not.toHaveBeenCalled();
    });
});