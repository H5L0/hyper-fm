import { contextBridge, ipcRenderer } from 'electron';
import type { AppBridge } from '../shared/bridge.js';

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

const api: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  ping: (message: string) => ipcRenderer.invoke('app:ping', message),
};

contextBridge.exposeInMainWorld('app', api);
