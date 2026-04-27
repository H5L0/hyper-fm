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
}
