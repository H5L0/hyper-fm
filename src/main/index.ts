import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import type { AppPreferences } from '../shared/types.js';
import { createLogger } from '../shared/logger.js';
import { registerIpcHandlers } from './ipc.js';
import { initSession } from './session.js';
import { resolveDefaultSharedConfigPath } from './config-store.js';
import {
  createAppConfigStore,
  DEFAULT_APP_PREFERENCES,
  loadAppPreferences,
  pathExists,
  resolveAppConfigFilePath,
  resolveStartupSharedConfigPath,
  saveLastSharedConfigId,
  addKnownConfig,
} from './app-config-store.js';
import { syncLoginItemSettings } from './login-item.js';
import { disposeAutoSyncSchedules, refreshAutoSyncSchedules } from './sync/auto-sync.js';
import { createTrayController, type TrayController } from './tray-controller.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const logger = createLogger('main');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;
let trayController: TrayController | null = null;
let isQuitting = false;
let currentAppPreferences: AppPreferences = DEFAULT_APP_PREFERENCES;

function createWindow(preloadPath: string): BrowserWindow {
  const iconPath = path.resolve(app.getAppPath(), 'assets', 'icons', 'icon.ico');
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 540,
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    logger.info('加载 Vite 开发服务器', { devServerUrl });
    void window.loadURL(devServerUrl);
  } else {
    const indexPath = path.resolve(__dirname, '../renderer/index.html');
    logger.info('加载本地 renderer', { indexPath });
    void window.loadFile(indexPath);
  }

  return window;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function defaultConfigDir(): string {
  // 打包后 process.execPath 指向可执行文件；开发模式下是 electron 自身，
  // 此时退回到 cwd（项目根）以满足「默认配置放在 .local/」的语义。
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return process.cwd();
}

async function initializeConfigSession(
  appConfigStore: ReturnType<typeof createAppConfigStore>,
  defaultSharedPath: string,
): Promise<void> {
  const startupSharedPath = await resolveStartupSharedConfigPath(appConfigStore, defaultSharedPath);

  if (!startupSharedPath) {
    logger.info('未找到可自动加载的配置，等待用户在欢迎页中手动打开或创建');
    return;
  }

  try {
    const snapshot = await initSession(startupSharedPath);
    await saveLastSharedConfigId(appConfigStore, snapshot.paths.configId);
    await addKnownConfig(appConfigStore, snapshot.paths.configId, snapshot.paths.sharedPath);
    refreshAutoSyncSchedules();
  } catch (error) {
    if (startupSharedPath !== defaultSharedPath) {
      logger.warn('最近打开的配置初始化失败，回退到默认配置', {
        startupSharedPath,
        defaultSharedPath,
        error,
      });
      if (await pathExists(defaultSharedPath)) {
        const snapshot = await initSession(defaultSharedPath);
        await saveLastSharedConfigId(appConfigStore, snapshot.paths.configId);
        await addKnownConfig(appConfigStore, snapshot.paths.configId, snapshot.paths.sharedPath);
        refreshAutoSyncSchedules();
      }
      return;
    }
    throw error;
  }
}

function showMainWindow(preloadPath: string): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const window = createWindow(preloadPath);
  window.on('close', event => {
    if (isQuitting || !currentAppPreferences.trayEnabled || !trayController?.hasTray()) {
      return;
    }
    event.preventDefault();
    logger.info('主窗口关闭时保留托盘');
    window.hide();
    trayController.handleWindowHidden();
  });
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  mainWindow = window;
  return window;
}

async function bootstrap(): Promise<void> {
  logger.info('Electron 主进程启动');
  await app.whenReady();

  const appConfigStore = createAppConfigStore({ filePath: resolveAppConfigFilePath(app.getPath('home')) });
  currentAppPreferences = await loadAppPreferences(appConfigStore);
  syncLoginItemSettings(app, currentAppPreferences);

  const defaultSharedPath = resolveDefaultSharedConfigPath(defaultConfigDir());
  try {
    await initializeConfigSession(appConfigStore, defaultSharedPath);
  } catch (error) {
    logger.error('初始化配置失败', error);
  }

  const preloadPath = path.resolve(__dirname, '../preload/index.js');
  trayController = createTrayController({
    showMainWindow: () => showMainWindow(preloadPath),
    requestQuit: () => {
      isQuitting = true;
      app.quit();
    },
    openNewProject: () => {
      const win = showMainWindow(preloadPath);
      win.webContents.send('fm:open-new-project-dialog');
    },
  });
  await trayController.applyPreferences(currentAppPreferences);
  showMainWindow(preloadPath);
  registerIpcHandlers({
    appConfigStore,
    onAppPreferencesChanged: preferences => {
      currentAppPreferences = preferences;
      syncLoginItemSettings(app, preferences);
      void trayController?.applyPreferences(preferences);
    },
    onConfigChanged: () => {
      trayController?.refreshContextMenu();
    },
  });
  logger.info('主进程初始化完成');

  app.on('activate', () => {
    logger.info('activate 事件触发，显示主窗口');
    showMainWindow(preloadPath);
  });
}

void bootstrap().catch(error => {
  logger.error('主进程初始化失败', error);
  process.exitCode = 1;
});

app.on('window-all-closed', () => {
  logger.info('所有窗口关闭');
  if (currentAppPreferences.trayEnabled && !isQuitting && trayController?.hasTray()) {
    logger.info('托盘模式下保留后台运行');
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  trayController?.destroy();
  disposeAutoSyncSchedules();
});
