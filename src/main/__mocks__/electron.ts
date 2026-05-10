// vitest mock: electron 在 Node 环境中不可用，提供最小 mock
// 默认 isPackaged = true，测试 dev 行为时手动改为 false
export const app = {
    isPackaged: true,
    getAppPath: () => process.cwd(),
    getPath: () => '',
    whenReady: () => Promise.resolve(),
    on: () => {},
    getName: () => 'fm',
    getFileIcon: () => ({ isEmpty: () => true }),
    quit: () => {},
};

export const BrowserWindow = class {};
export const Menu = { buildFromTemplate: () => ({}) };
export const Tray = class {
    setToolTip() {}
    setContextMenu() {}
    on() {}
    destroy() {}
    displayBalloon() {}
};
export const dialog = { showOpenDialog: () => Promise.resolve({ filePaths: [] }) };
export const ipcMain = {
    handle: () => {},
    on: () => {},
};
export const ipcRenderer = {
    invoke: () => Promise.resolve(),
    on: () => {},
    off: () => {},
};
export const shell = { openPath: () => Promise.resolve() };
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) };
