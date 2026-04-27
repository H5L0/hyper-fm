// ---------------------------------------------------------------------------
// Preload bridge contract
// ---------------------------------------------------------------------------

import type {
  AppConfig,
  Category,
  ConfigSnapshot,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanReport,
  ScanRoot,
} from './types.js';
import type {
  CommandRunResult,
  CustomCommand,
  DeviceRegistry,
  KnownDevice,
  PresetCommandDescriptor,
  SyncDiff,
  SyncManifest,
  SyncSettings,
  SyncProjectEntry,
} from './sync-types.js';

export type {
  AppConfig,
  Category,
  ConfigSnapshot,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanReport,
  ScanRoot,
};

export type {
  CommandRunResult,
  CustomCommand,
  DeviceRegistry,
  KnownDevice,
  PresetCommandDescriptor,
  SyncDiff,
  SyncManifest,
  SyncSettings,
  SyncProjectEntry,
};

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
  load(filePath: string): Promise<ConfigSnapshot>;
  create(filePath: string): Promise<ConfigSnapshot>;
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
  add(input: ManualProjectInput): Promise<Project>;
  remove(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
}

export interface ManualProjectInput {
  path: string;
  name?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
}

export interface FmCategoriesBridge {
  create(input: { name: string; color?: string }): Promise<Category>;
  rename(id: string, name: string): Promise<Category>;
  setColor(id: string, color: string): Promise<Category>;
  remove(id: string): Promise<void>;
}

export interface FmBridge {
  config: FmConfigBridge;
  scanRoots: FmScanRootsBridge;
  scan: FmScanBridge;
  projects: FmProjectsBridge;
  categories: FmCategoriesBridge;
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

  /** 同步设置 */
  getSettings(): Promise<SyncSettings>;
  setSettings(settings: SyncSettings): Promise<SyncSettings>;
  pickBundleDir(): Promise<string | null>;

  /** 共享目录：diff / push / pull */
  diffBundleDir(projectIds?: string[]): Promise<SyncDiff>;
  pushBundleDir(projectIds: string[]): Promise<{ pushed: string[] }>;
  pullBundleDir(items: SyncPullItem[]): Promise<SyncPullResult[]>;

  /** zip 导入/导出 */
  exportZip(projectIds: string[], outputFile: string): Promise<{ outputFile: string; projects: number }>;
  pickExportFile(): Promise<string | null>;
  pickImportFile(): Promise<string | null>;
  previewZip(file: string): Promise<{ manifest: SyncManifest; entries: SyncProjectEntry[] }>;
  applyZip(file: string, plan: SyncImportItem[]): Promise<SyncImportResult[]>;

  /** TCP 服务端 */
  startServer(): Promise<{ port: number }>;
  stopServer(): Promise<void>;
  isServerRunning(): Promise<boolean>;
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
