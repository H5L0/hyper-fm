import { ipcMain, app } from 'electron';
import { createLogger } from '../shared/logger.js';
import type { AppInfo } from '../shared/bridge.js';

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

const logger = createLogger('main:ipc');

function wrap<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => Promise<TResult> | TResult,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    logger.debug(`IPC 调用 ${channel}`);
    try {
      const result = await handler(...args);
      logger.debug(`IPC 完成 ${channel}`);
      return result;
    } catch (error) {
      logger.error(`IPC 失败 ${channel}`, error);
      throw error;
    }
  };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(
    'app:get-info',
    wrap('get-info', (): AppInfo => ({
      appName: app.getName(),
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron ?? '',
    })),
  );

  ipcMain.handle(
    'app:ping',
    wrap('ping', async (_event, message: string) => `pong: ${message}`),
  );

  logger.info('IPC 处理器已注册');
}
