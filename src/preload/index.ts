import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AppBridge,
  AppPreferences,
  CommandRunResult,
  ConfigOpenInspection,
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
  SyncApplyResult,
  SyncConfig,
  SyncConflictMergeDraft,
  SyncDiff,
  SyncImportItem,
  SyncImportTarget,
  SyncImportResult,
  SyncManifest,
  SyncPlanApplyRequest,
  SyncPlanPreviewEvent,
  SyncPlanPreview,
  SyncPlanPreviewSession,
  SyncPlanRowPage,
  SyncPlanSelectionState,
  SyncProjectEntry,
  SyncProjectRule,
  SyncPullItem,
  SyncPullResult,
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
  app: {
    getPreferences: () => ipcRenderer.invoke('fm:app:getPreferences') as Promise<AppPreferences>,
    updatePreferences: patch => ipcRenderer.invoke('fm:app:updatePreferences', patch) as Promise<AppPreferences>,
  },
  config: {
    current: () => ipcRenderer.invoke('fm:config:current') as Promise<ConfigSnapshot>,
    inspectOpen: filePath => ipcRenderer.invoke('fm:config:inspectOpen', filePath) as Promise<ConfigOpenInspection>,
    load: filePath => ipcRenderer.invoke('fm:config:load', filePath) as Promise<ConfigSnapshot>,
    create: filePath => ipcRenderer.invoke('fm:config:create', filePath) as Promise<ConfigSnapshot>,
    createInDirectory: directoryPath => ipcRenderer.invoke('fm:config:createInDirectory', directoryPath) as Promise<ConfigSnapshot>,
    createLocalForShared: sharedPath => ipcRenderer.invoke('fm:config:createLocalForShared', sharedPath) as Promise<ConfigSnapshot>,
    save: data => ipcRenderer.invoke('fm:config:save', data) as Promise<void>,
    pick: mode => ipcRenderer.invoke('fm:config:pick', mode) as Promise<string | null>,
    pickDirectory: () => ipcRenderer.invoke('fm:config:pickDirectory') as Promise<string | null>,
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
    inspectDirectory: (path, projectIgnore) =>
      ipcRenderer.invoke('fm:projects:inspectDirectory', path, projectIgnore) as Promise<ProjectDirectoryInspection>,
    validateNew: input =>
      ipcRenderer.invoke('fm:projects:validateNew', input as ManualProjectInput) as Promise<ManualProjectValidationResult>,
    add: input => ipcRenderer.invoke('fm:projects:add', input as ManualProjectInput) as Promise<Project>,
    remove: id => ipcRenderer.invoke('fm:projects:remove', id) as Promise<void>,
    pickDirectory: () =>
      ipcRenderer.invoke('fm:projects:pickDirectory') as Promise<string | null>,
    pickDirectories: () =>
      ipcRenderer.invoke('fm:projects:pickDirectories') as Promise<string[]>,
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
    listConfigs: () => ipcRenderer.invoke('fm:sync:listConfigs') as Promise<SyncConfig[]>,
    upsertConfig: config =>
      ipcRenderer.invoke('fm:sync:upsertConfig', config as SyncConfig) as Promise<SyncConfig>,
    removeConfig: id => ipcRenderer.invoke('fm:sync:removeConfig', id) as Promise<void>,
    setProjectRule: (configId, projectId, rule) =>
      ipcRenderer.invoke('fm:sync:setProjectRule', configId, projectId, rule as SyncProjectRule) as Promise<SyncConfig>,
    pickDirectory: title => ipcRenderer.invoke('fm:sync:pickDirectory', title) as Promise<string | null>,
    diffSharedDir: (configId, projectIds) =>
      ipcRenderer.invoke('fm:sync:diffSharedDir', configId, projectIds) as Promise<SyncDiff>,
    pushSharedDir: (configId, projectIds) =>
      ipcRenderer.invoke('fm:sync:pushSharedDir', configId, projectIds) as Promise<{ pushed: string[] }>,
    pullSharedDir: (configId, items) =>
      ipcRenderer.invoke('fm:sync:pullSharedDir', configId, items as SyncPullItem[]) as Promise<SyncPullResult[]>,
    previewSharedDirSync: (configId, projectIds) =>
      ipcRenderer.invoke('fm:sync:previewSharedDirSync', configId, projectIds) as Promise<SyncPlanPreview>,
    openSharedDirSyncPreview: (configId, projectIds, configOverride) =>
      ipcRenderer.invoke('fm:sync:openSharedDirSyncPreview', configId, projectIds, configOverride) as Promise<SyncPlanPreviewSession>,
    onSyncPreviewEvent: handler => {
      const listener = (_event: IpcRendererEvent, data: SyncPlanPreviewEvent) => handler(data);
      ipcRenderer.on('fm:sync:preview-event', listener);
      return () => {
        ipcRenderer.off('fm:sync:preview-event', listener);
      };
    },
    getSyncPreviewRows: (sessionId, projectId, startIndex, length, selection) =>
      ipcRenderer.invoke(
        'fm:sync:getSyncPreviewRows',
        sessionId,
        projectId,
        startIndex,
        length,
        selection as SyncPlanSelectionState | undefined,
      ) as Promise<SyncPlanRowPage>,
    closeSyncPreview: sessionId =>
      ipcRenderer.invoke('fm:sync:closeSyncPreview', sessionId) as Promise<void>,
    applySharedDirSync: (configId, projectIds, request) =>
      ipcRenderer.invoke('fm:sync:applySharedDirSync', configId, projectIds, request as SyncPlanApplyRequest | undefined) as Promise<SyncApplyResult>,
    previewFolderSync: (configId, projectIds) =>
      ipcRenderer.invoke('fm:sync:previewFolderSync', configId, projectIds) as Promise<SyncPlanPreview>,
    openFolderSyncPreview: (configId, projectIds, configOverride) =>
      ipcRenderer.invoke('fm:sync:openFolderSyncPreview', configId, projectIds, configOverride) as Promise<SyncPlanPreviewSession>,
    applyFolderSync: (configId, projectIds, request) =>
      ipcRenderer.invoke('fm:sync:applyFolderSync', configId, projectIds, request as SyncPlanApplyRequest | undefined) as Promise<SyncApplyResult>,
    openSyncDiff: (configId, projectId, relativePath, configOverride) =>
      ipcRenderer.invoke('fm:sync:openSyncDiff', configId, projectId, relativePath, configOverride) as Promise<void>,
    openConflictMerge: (configId, projectId, relativePath, configOverride) =>
      ipcRenderer.invoke('fm:sync:openConflictMerge', configId, projectId, relativePath, configOverride) as Promise<SyncConflictMergeDraft>,
    exportZip: (configId, projectIds, outputFile) =>
      ipcRenderer.invoke('fm:sync:exportZip', configId, projectIds, outputFile) as Promise<{
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
    applyZip: (configId, file, plan) =>
      ipcRenderer.invoke('fm:sync:applyZip', configId, file, plan as SyncImportItem[]) as Promise<SyncImportResult[]>,
    previewZipImport: (configId, file, targets) =>
      ipcRenderer.invoke('fm:sync:previewZipImport', configId, file, targets as SyncImportTarget[]) as Promise<SyncPlanPreview>,
    applyZipImport: (configId, file, targets) =>
      ipcRenderer.invoke('fm:sync:applyZipImport', configId, file, targets as SyncImportTarget[]) as Promise<SyncApplyResult>,
    startServer: configId => ipcRenderer.invoke('fm:sync:startServer', configId) as Promise<{ port: number }>,
    stopServer: configId => ipcRenderer.invoke('fm:sync:stopServer', configId) as Promise<void>,
    isServerRunning: configId => ipcRenderer.invoke('fm:sync:isServerRunning', configId) as Promise<boolean>,
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
