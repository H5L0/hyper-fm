import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AppBridge,
  CommandRunResult,
  ConfigSnapshot,
  CustomCommand,
  DeviceRegistry,
  FmBridge,
  ManualProjectInput,
  ManualProjectValidationResult,
  PresetCommandDescriptor,
  ProjectDirectoryInspection,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanReport,
  ScanRoot,
  SyncDiff,
  SyncImportItem,
  SyncImportResult,
  SyncManifest,
  SyncProjectEntry,
  SyncPullItem,
  SyncPullResult,
  SyncSettings,
  TagDefinition,
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
    save: data => ipcRenderer.invoke('fm:config:save', data) as Promise<void>,
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
    ignorePath: path => ipcRenderer.invoke('fm:scan:ignorePath', path) as Promise<void>,
    revealPath: path => ipcRenderer.invoke('fm:scan:revealPath', path) as Promise<void>,
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
    inspectDirectory: path =>
      ipcRenderer.invoke('fm:projects:inspectDirectory', path) as Promise<ProjectDirectoryInspection>,
    validateNew: input =>
      ipcRenderer.invoke('fm:projects:validateNew', input as ManualProjectInput) as Promise<ManualProjectValidationResult>,
    add: input => ipcRenderer.invoke('fm:projects:add', input as ManualProjectInput) as Promise<Project>,
    remove: id => ipcRenderer.invoke('fm:projects:remove', id) as Promise<void>,
    pickDirectory: () =>
      ipcRenderer.invoke('fm:projects:pickDirectory') as Promise<string | null>,
  },
  tags: {
    list: () => ipcRenderer.invoke('fm:tags:list') as Promise<TagDefinition[]>,
    upsert: tag => ipcRenderer.invoke('fm:tags:upsert', tag) as Promise<TagDefinition[]>,
    remove: name => ipcRenderer.invoke('fm:tags:remove', name) as Promise<TagDefinition[]>,
    rename: (oldName, newName) =>
      ipcRenderer.invoke('fm:tags:rename', oldName, newName) as Promise<TagDefinition[]>,
  },
  sync: {
    getDevice: () => ipcRenderer.invoke('fm:sync:getDevice') as Promise<DeviceRegistry>,
    setSelfName: name => ipcRenderer.invoke('fm:sync:setSelfName', name) as Promise<DeviceRegistry>,
    getSettings: () => ipcRenderer.invoke('fm:sync:getSettings') as Promise<SyncSettings>,
    setSettings: settings =>
      ipcRenderer.invoke('fm:sync:setSettings', settings) as Promise<SyncSettings>,
    pickBundleDir: () => ipcRenderer.invoke('fm:sync:pickBundleDir') as Promise<string | null>,
    diffBundleDir: projectIds =>
      ipcRenderer.invoke('fm:sync:diffBundleDir', projectIds) as Promise<SyncDiff>,
    pushBundleDir: projectIds =>
      ipcRenderer.invoke('fm:sync:pushBundleDir', projectIds) as Promise<{ pushed: string[] }>,
    pullBundleDir: items =>
      ipcRenderer.invoke('fm:sync:pullBundleDir', items as SyncPullItem[]) as Promise<SyncPullResult[]>,
    exportZip: (projectIds, outputFile) =>
      ipcRenderer.invoke('fm:sync:exportZip', projectIds, outputFile) as Promise<{
        outputFile: string;
        projects: number;
      }>,
    pickExportFile: () =>
      ipcRenderer.invoke('fm:sync:pickExportFile') as Promise<string | null>,
    pickImportFile: () =>
      ipcRenderer.invoke('fm:sync:pickImportFile') as Promise<string | null>,
    previewZip: file =>
      ipcRenderer.invoke('fm:sync:previewZip', file) as Promise<{
        manifest: SyncManifest;
        entries: SyncProjectEntry[];
      }>,
    applyZip: (file, plan) =>
      ipcRenderer.invoke('fm:sync:applyZip', file, plan as SyncImportItem[]) as Promise<SyncImportResult[]>,
    startServer: () => ipcRenderer.invoke('fm:sync:startServer') as Promise<{ port: number }>,
    stopServer: () => ipcRenderer.invoke('fm:sync:stopServer') as Promise<void>,
    isServerRunning: () => ipcRenderer.invoke('fm:sync:isServerRunning') as Promise<boolean>,
  },
  commands: {
    presets: () => ipcRenderer.invoke('fm:commands:presets') as Promise<PresetCommandDescriptor[]>,
    list: () => ipcRenderer.invoke('fm:commands:list') as Promise<CustomCommand[]>,
    add: input => ipcRenderer.invoke('fm:commands:add', input) as Promise<CustomCommand>,
    update: (id, patch) =>
      ipcRenderer.invoke('fm:commands:update', id, patch) as Promise<CustomCommand>,
    remove: id => ipcRenderer.invoke('fm:commands:remove', id) as Promise<void>,
    run: (commandId, projectId) =>
      ipcRenderer.invoke('fm:commands:run', commandId, projectId) as Promise<CommandRunResult>,
  },
};

contextBridge.exposeInMainWorld('fm', fmApi);
