import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AppBridge,
  AppConfig,
  Category,
  ConfigSnapshot,
  FmBridge,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanReport,
  ScanRoot,
} from '../shared/bridge.js';

// ---------------------------------------------------------------------------
// app:* 兼容桥
// ---------------------------------------------------------------------------

const appApi: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  ping: (message: string) => ipcRenderer.invoke('app:ping', message),
};

contextBridge.exposeInMainWorld('app', appApi);

// ---------------------------------------------------------------------------
// fm:* 业务桥
// ---------------------------------------------------------------------------

const fmApi: FmBridge = {
  config: {
    current: () => ipcRenderer.invoke('fm:config:current') as Promise<ConfigSnapshot>,
    load: filePath => ipcRenderer.invoke('fm:config:load', filePath) as Promise<ConfigSnapshot>,
    create: filePath => ipcRenderer.invoke('fm:config:create', filePath) as Promise<ConfigSnapshot>,
    save: (data: AppConfig) => ipcRenderer.invoke('fm:config:save', data) as Promise<void>,
    pick: mode => ipcRenderer.invoke('fm:config:pick', mode) as Promise<string | null>,
  },
  scanRoots: {
    add: input => ipcRenderer.invoke('fm:scanRoots:add', input) as Promise<ScanRoot>,
    update: (id, patch) => ipcRenderer.invoke('fm:scanRoots:update', id, patch) as Promise<ScanRoot>,
    remove: id => ipcRenderer.invoke('fm:scanRoots:remove', id) as Promise<void>,
    pickDirectory: () =>
      ipcRenderer.invoke('fm:scanRoots:pickDirectory') as Promise<string | null>,
  },
  scan: {
    runAll: () => ipcRenderer.invoke('fm:scan:runAll') as Promise<ScanReport[]>,
    runOne: rootId => ipcRenderer.invoke('fm:scan:runOne', rootId) as Promise<ScanReport>,
    onProgress: handler => {
      const listener = (_event: IpcRendererEvent, data: ScanProgressEvent) => handler(data);
      ipcRenderer.on('fm:scan:progress', listener);
      return () => {
        ipcRenderer.off('fm:scan:progress', listener);
      };
    },
  },
  projects: {
    list: () => ipcRenderer.invoke('fm:projects:list') as Promise<Project[]>,
    get: id => ipcRenderer.invoke('fm:projects:get', id) as Promise<Project>,
    updateMeta: (id, patch: ProjectMetaPatch) =>
      ipcRenderer.invoke('fm:projects:updateMeta', id, patch) as Promise<Project>,
    writeMetaFile: (id, patch: ProjectMetaPatch) =>
      ipcRenderer.invoke('fm:projects:writeMetaFile', id, patch) as Promise<Project>,
    removeMetaFile: id =>
      ipcRenderer.invoke('fm:projects:removeMetaFile', id) as Promise<Project>,
    revealInOs: id => ipcRenderer.invoke('fm:projects:revealInOs', id) as Promise<void>,
  },
  categories: {
    create: input => ipcRenderer.invoke('fm:categories:create', input) as Promise<Category>,
    rename: (id, name) =>
      ipcRenderer.invoke('fm:categories:rename', id, name) as Promise<Category>,
    setColor: (id, color) =>
      ipcRenderer.invoke('fm:categories:setColor', id, color) as Promise<Category>,
    remove: id => ipcRenderer.invoke('fm:categories:remove', id) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('fm', fmApi);
