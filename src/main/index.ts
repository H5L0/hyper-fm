import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createLogger } from '../shared/logger.js';
import { registerIpcHandlers } from './ipc.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const logger = createLogger('main');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow(preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#f5f5f5',
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

async function bootstrap(): Promise<void> {
  logger.info('Electron 主进程启动');
  await app.whenReady();

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
