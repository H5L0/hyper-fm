// ---------------------------------------------------------------------------
// Preload bridge contract
// ---------------------------------------------------------------------------

import type {
  AppConfig,
  ConfigOpenInspection,
  ConfigPaths,
  ConfigSnapshot,
  ProjectFingerprint,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanReport,
  ScanRoot,
  ScanWarning,
  TagDefinition,
} from './types.js';
import type {
  CommandRunResult,
  CustomCommand,
  DeviceRegistry,
  KnownDevice,
  PresetCommandDescriptor,
  SyncApplyResult,
  SyncConfig,
  SyncConflictMergeDraft,
  SyncDiff,
  SyncManifest,
  SyncPlanApplyRequest,
  SyncPlanPreviewEvent,
  SyncPlanPreview,
  SyncPlanPreviewSession,
  SyncPlanRow,
  SyncPlanRowPage,
  SyncPlanSelectionState,
  SyncProjectEntry,
} from './sync-types.js';
import type { SyncProjectRule } from './sync-config.js';

export type {
  AppConfig,
  ConfigOpenInspection,
  ConfigPaths,
  ConfigSnapshot,
  ProjectFingerprint,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanReport,
  ScanRoot,
  ScanWarning,
  TagDefinition,
};

export type {
  CommandRunResult,
  CustomCommand,
  DeviceRegistry,
  KnownDevice,
  PresetCommandDescriptor,
  SyncApplyResult,
  SyncConfig,
  SyncConflictMergeDraft,
  SyncDiff,
  SyncManifest,
  SyncPlanApplyRequest,
  SyncPlanPreviewEvent,
  SyncPlanPreview,
  SyncPlanPreviewSession,
  SyncPlanRow,
  SyncPlanRowPage,
  SyncPlanSelectionState,
  SyncProjectEntry,
};
export type { SyncProjectRule };

export interface AppInfo {
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  electronVersion: string;
}

export interface AppBridge {
  getAppInfo(): Promise<AppInfo>;
  ping(message: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// fm 业务桥
// ---------------------------------------------------------------------------

export interface FmConfigBridge {
  current(): Promise<ConfigSnapshot>;
  inspectOpen(filePath: string): Promise<ConfigOpenInspection>;
  load(filePath: string): Promise<ConfigSnapshot>;
  create(filePath: string): Promise<ConfigSnapshot>;
  createLocalForShared(sharedPath: string): Promise<ConfigSnapshot>;
  save(data: AppConfig): Promise<void>;
  pick(mode: 'open' | 'save'): Promise<string | null>;
}

export interface FmScanRootsBridge {
  add(input: { path: string; label?: string; maxDepth?: number }): Promise<ScanRoot>;
  update(id: string, patch: Partial<Omit<ScanRoot, 'id'>>): Promise<ScanRoot>;
  remove(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
}

export interface FmScanBridge {
  runAll(): Promise<ScanReport[]>;
  runOne(rootId: string): Promise<ScanReport>;
  ignorePath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  /** 订阅扫描进度，返回取消订阅的函数 */
  onProgress(handler: (event: ScanProgressEvent) => void): () => void;
}

export interface FmProjectsBridge {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  updateMeta(id: string, patch: ProjectMetaPatch): Promise<Project>;
  writeMetaFile(id: string, patch: ProjectMetaPatch): Promise<Project>;
  removeMetaFile(id: string): Promise<Project>;
  revealInOs(id: string): Promise<void>;
  inspectDirectory(path: string, projectIgnore?: string[]): Promise<ProjectDirectoryInspection>;
  validateNew(input: ManualProjectInput): Promise<ManualProjectValidationResult>;
  add(input: ManualProjectInput): Promise<Project>;
  remove(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
}

export interface FmTagsBridge {
  list(): Promise<TagDefinition[]>;
  upsert(tag: TagDefinition): Promise<TagDefinition[]>;
  remove(name: string): Promise<TagDefinition[]>;
  rename(oldName: string, newName: string): Promise<TagDefinition[]>;
}

export interface ManualProjectInput {
  path: string;
  name?: string;
  description?: string;
  tags?: string[];
  syncRespectGitignore?: boolean;
  fingerprint: ProjectFingerprint;
}

export type ProjectDirectoryIgnoreSource = 'global' | 'project';

export interface ProjectDirectoryEntry {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  ignoredBy?: ProjectDirectoryIgnoreSource;
  children?: ProjectDirectoryEntry[];
}

export interface ProjectDirectoryInspection {
  path: string;
  suggestedName: string;
  hasMetaFile: boolean;
  metaProjectId?: string;
  tree: ProjectDirectoryEntry[];
  files: string[];
}

export interface ManualProjectValidationConflict {
  projectId: string;
  projectName: string;
  reason: string;
}

export interface ManualProjectValidationResult {
  valid: boolean;
  conflicts: ManualProjectValidationConflict[];
}

export interface FmBridge {
  config: FmConfigBridge;
  scanRoots: FmScanRootsBridge;
  scan: FmScanBridge;
  projects: FmProjectsBridge;
  tags: FmTagsBridge;
  sync: FmSyncBridge;
  commands: FmCommandsBridge;
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

export interface FmSyncBridge {
  /** 取/设当前设备名 */
  getDevice(): Promise<DeviceRegistry>;
  setSelfName(name: string): Promise<DeviceRegistry>;

  /** 同步配置 */
  listConfigs(): Promise<SyncConfig[]>;
  upsertConfig(config: SyncConfig): Promise<SyncConfig>;
  removeConfig(id: string): Promise<void>;
  setProjectRule(configId: string, projectId: string, rule: SyncProjectRule): Promise<SyncConfig>;
  pickDirectory(title?: string): Promise<string | null>;

  /** 共享目录：diff / push / pull */
  diffSharedDir(configId: string, projectIds?: string[]): Promise<SyncDiff>;
  pushSharedDir(configId: string, projectIds?: string[]): Promise<{ pushed: string[] }>;
  pullSharedDir(configId: string, items: SyncPullItem[]): Promise<SyncPullResult[]>;
  previewSharedDirSync(configId: string, projectIds?: string[]): Promise<SyncPlanPreview>;
  openSharedDirSyncPreview(
    configId: string,
    projectIds?: string[],
    configOverride?: Extract<SyncConfig, { type: 'shared-dir' }>,
  ): Promise<SyncPlanPreviewSession>;
  onSyncPreviewEvent(handler: (event: SyncPlanPreviewEvent) => void): () => void;
  getSyncPreviewRows(
    sessionId: string,
    projectId: string,
    startIndex: number,
    length: number,
    selection?: SyncPlanSelectionState,
  ): Promise<SyncPlanRowPage>;
  closeSyncPreview(sessionId: string): Promise<void>;
  applySharedDirSync(configId: string, projectIds?: string[], request?: SyncPlanApplyRequest): Promise<SyncApplyResult>;

  /** 文件夹同步：预览 / 执行 */
  previewFolderSync(configId: string, projectIds?: string[]): Promise<SyncPlanPreview>;
  openFolderSyncPreview(
    configId: string,
    projectIds?: string[],
    configOverride?: Extract<SyncConfig, { type: 'folder' }>,
  ): Promise<SyncPlanPreviewSession>;
  applyFolderSync(configId: string, projectIds?: string[], request?: SyncPlanApplyRequest): Promise<SyncApplyResult>;
  openSyncDiff(
    configId: string,
    projectId: string,
    relativePath: string,
    configOverride?: Extract<SyncConfig, { type: 'folder' | 'shared-dir' }>,
  ): Promise<void>;
  openConflictMerge(
    configId: string,
    projectId: string,
    relativePath: string,
    configOverride?: Extract<SyncConfig, { type: 'folder' | 'shared-dir' }>,
  ): Promise<SyncConflictMergeDraft>;

  /** zip 导入/导出 */
  exportZip(configId: string, projectIds: string[], outputFile: string): Promise<{ outputFile: string; projects: number }>;
  pickExportFile(): Promise<string | null>;
  pickImportFile(): Promise<string | null>;
  previewZip(file: string): Promise<{ manifest: SyncManifest; entries: SyncProjectEntry[] }>;
  applyZip(configId: string, file: string, plan: SyncImportItem[]): Promise<SyncImportResult[]>;
  previewZipImport(configId: string, file: string, targets: SyncImportTarget[]): Promise<SyncPlanPreview>;
  applyZipImport(configId: string, file: string, targets: SyncImportTarget[]): Promise<SyncApplyResult>;

  /** TCP 服务端 */
  startServer(configId: string): Promise<{ port: number }>;
  stopServer(configId: string): Promise<void>;
  isServerRunning(configId: string): Promise<boolean>;
}

export interface SyncPullItem {
  projectId: string;
  fromDeviceId: string;
  targetPath: string;
  overwrite: boolean;
}

export interface SyncPullResult {
  projectId: string;
  targetPath: string;
  hash: string;
  fromDeviceId: string;
}

export interface SyncImportItem {
  projectId: string;
  action: 'skip' | 'create' | 'overwrite';
  targetPath?: string;
}

export interface SyncImportResult {
  projectId: string;
  applied: boolean;
  targetPath?: string;
}

export interface SyncImportTarget {
  projectId: string;
  targetPath: string;
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

export interface FmCommandsBridge {
  presets(): Promise<PresetCommandDescriptor[]>;
  list(): Promise<CustomCommand[]>;
  add(input: Omit<CustomCommand, 'id'>): Promise<CustomCommand>;
  update(id: string, patch: Partial<Omit<CustomCommand, 'id'>>): Promise<CustomCommand>;
  remove(id: string): Promise<void>;
  run(commandId: string, projectId: string): Promise<CommandRunResult>;
}
