import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createLogger } from '../shared/logger.js';
import { registerIpcHandlers } from './ipc.js';
import { initSession } from './session.js';
import { resolveDefaultConfigPaths } from './config-store.js';
import { disposeAutoSyncSchedules, refreshAutoSyncSchedules } from './sync/auto-sync.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const logger = createLogger('main');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow(preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 540,
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
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
  // 此时退回到 cwd（项目根）以满足「同级 fm.config.json」的语义。
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return process.cwd();
}

async function bootstrap(): Promise<void> {
  logger.info('Electron 主进程启动');
  await app.whenReady();

  const defaultPaths = resolveDefaultConfigPaths(defaultConfigDir());
  try {
    await initSession(defaultPaths.sharedPath);
    refreshAutoSyncSchedules();
  } catch (error) {
    logger.error('初始化配置失败', error);
  }

  const preloadPath = path.resolve(__dirname, '../preload/index.js');
  createWindow(preloadPath);
  registerIpcHandlers();
  logger.info('主进程初始化完成');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('activate 事件触发，重建窗口');
      createWindow(preloadPath);
    }
  });
}

void bootstrap().catch(error => {
  logger.error('主进程初始化失败', error);
  process.exitCode = 1;
});

app.on('window-all-closed', () => {
  logger.info('所有窗口关闭');
  disposeAutoSyncSchedules();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
