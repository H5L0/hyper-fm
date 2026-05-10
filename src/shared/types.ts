// ---------------------------------------------------------------------------
// 共享数据模型类型
// 跨进程使用：main / preload / renderer 均直接 import 本文件
// ---------------------------------------------------------------------------

export const CONFIG_SCHEMA_VERSION = 2;
export const META_FILE_NAME = '.meta-data';
export const META_SCHEMA = 'fm.meta/v1';
export const DEFAULT_CONFIG_DIRECTORYNAME = '.local';
export const DEFAULT_SHARED_CONFIG_FILENAME = 'fm.shared.json';
export const DEFAULT_LOCAL_CONFIG_FILENAME = 'fm.local.json';

// ---------------------------------------------------------------------------
// 配置实体
// ---------------------------------------------------------------------------

export interface ScanRoot {
  id: string;
  path: string;
  label?: string;
  maxDepth: number;
  enabled: boolean;
}

export interface IgnoreRules {
  respectGitignore: boolean;
  globs: string[];
}

export interface ProjectBinding {
  projectId: string;
  path: string;
  rootId: string;
  hasMetaFile: boolean;
  lastScannedAt: string;
}

export interface MetadataFingerprint {
  kind: 'metadata';
}

export interface FolderNameFingerprint {
  kind: 'folder-name';
  folderName: string;
}

export interface FilePathsFingerprint {
  kind: 'file-paths';
  paths: string[];
}

export type ProjectFingerprint =
  | MetadataFingerprint
  | FolderNameFingerprint
  | FilePathsFingerprint;

export interface SharedProject {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  ignore: string[];
  /** 同步项目文件时是否额外遵循项目目录中的 .gitignore（含嵌套目录） */
  syncRespectGitignore?: boolean;
  fingerprint: ProjectFingerprint;
}

export interface Project extends ProjectBinding {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  ignore: string[];
  syncRespectGitignore?: boolean;
  fingerprint: ProjectFingerprint;
}

export interface ProjectRuntimeInfo {
  projectId: string;
  /** 项目目录当前的运行时修改时间；按需实时读取，不写入 shared/local 配置 */
  directoryModifiedAt?: string;
}

export interface FingerprintConflictWarning {
  id: string;
  kind: 'fingerprint-conflict';
  scanRootId: string;
  projectId: string;
  projectName: string;
  fingerprint: ProjectFingerprint;
  candidatePaths: string[];
  message: string;
  createdAt: string;
}

export interface SyncConflictWarning {
  id: string;
  kind: 'sync-conflict';
  configId: string;
  configName: string;
  projectId: string;
  projectName: string;
  mode: import('./sync-types.js').SyncMode;
  filePaths: string[];
  message: string;
  createdAt: string;
}

export interface SyncErrorWarning {
  id: string;
  kind: 'sync-error';
  configId: string;
  configName: string;
  projectId?: string;
  projectName?: string;
  message: string;
  createdAt: string;
}

export type ScanWarning =
  | FingerprintConflictWarning
  | SyncConflictWarning
  | SyncErrorWarning;

export type ThemePreference = 'light' | 'dark' | 'system';
export type ViewMode = 'grid' | 'list';

export interface UiPreferences {
  theme: ThemePreference;
  view: ViewMode;
}

export interface AppPreferences {
  trayEnabled: boolean;
  autoLaunchEnabled: boolean;
  ui: UiPreferences;
}

export interface SharedConfig {
  version: number;
  configId: string;
  name: string;
  description?: string;
  ignore: IgnoreRules;
  projects: SharedProject[];
  tags?: TagDefinition[];
  tagGroups?: TagGroupDefinition[];
  syncConfigs?: import('./sync-types.js').SyncConfig[];
}

export interface LocalConfig {
  version: number;
  sharedConfigId: string;
  scanRoots: ScanRoot[];
  bindings: ProjectBinding[];
  ui: UiPreferences;
  warnings?: ScanWarning[];
  ignoredPaths?: string[];
  devices?: import('./sync-types.js').DeviceRegistry;
  syncConfigs?: import('./sync-types.js').LocalSyncConfigEntry[];
  commands?: import('./sync-types.js').CustomCommand[];
}

export interface AppConfig {
  version: number;
  name: string;
  description?: string;
  scanRoots: ScanRoot[];
  ignore: IgnoreRules;
  projects: Project[];
  ui: UiPreferences;
  warnings: ScanWarning[];
  ignoredPaths: string[];
  /** 标签注册表：可在项目详情和侧边栏中显示颜色，未在此处注册的标签按默认色渲染 */
  tags?: TagDefinition[];
  /** 标签组：标签集合，用于按“同时拥有这些标签”的条件筛选项目 */
  tagGroups?: TagGroupDefinition[];
  /** M2：设备身份与已知对端 */
  devices?: import('./sync-types.js').DeviceRegistry;
  /** 同步配置（shared + local 合并视图） */
  syncConfigs?: import('./sync-types.js').SyncConfig[];
  /** M3：自定义命令列表 */
  commands?: import('./sync-types.js').CustomCommand[];
}

// ---------------------------------------------------------------------------
// 标签注册
// ---------------------------------------------------------------------------

export interface TagDefinition {
  /** 标签名（唯一） */
  name: string;
  /** CSS 颜色（hex 或 var） */
  color: string;
}

export interface TagGroupDefinition {
  /** 标签组名（唯一） */
  name: string;
  /** 命中条件：项目需同时拥有这些标签 */
  tags: string[];
}

// ---------------------------------------------------------------------------
// .meta-data 文件
// ---------------------------------------------------------------------------

export interface MetaFile {
  schema: typeof META_SCHEMA;
  projectId?: string;
  name?: string;
  description?: string;
  tags?: string[];
  ignore?: string[];
  syncRespectGitignore?: boolean;
}

// ---------------------------------------------------------------------------
// 操作输入与结果
// ---------------------------------------------------------------------------

export interface ProjectMetaPatch {
  name?: string;
  description?: string;
  tags?: string[];
  ignore?: string[];
  syncRespectGitignore?: boolean;
  fingerprint?: ProjectFingerprint;
}

export interface ScanReport {
  rootId: string;
  scanned: number;
  matched: number;
  added: number;
  updated: number;
  removed: number;
  warnings: number;
  durationMs: number;
}

export interface ConfigPaths {
  sharedPath: string;
  localPath: string;
  configId: string;
}

export interface ConfigSnapshot {
  paths: ConfigPaths;
  data: AppConfig;
  hasLoadedConfig: boolean;
}

export type ConfigSelectionKind = 'shared' | 'local';

export interface ConfigOpenInspection {
  selectedPath: string;
  selectedKind: ConfigSelectionKind;
  sharedPath: string;
  localPath: string;
  localExists: boolean;
}

export interface ScanProgressEvent {
  rootId: string;
  scanned: number;
  found: number;
}

// ---------------------------------------------------------------------------
// 错误码
// ---------------------------------------------------------------------------

export type FmErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'CONFIG_VERSION_UNSUPPORTED'
  | 'PATH_NOT_FOUND'
  | 'PATH_NOT_DIRECTORY'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_NOT_BOUND'
  | 'DUPLICATE_PATH'
  | 'FINGERPRINT_CONFLICT'
  | 'WRITE_FAILED'
  | 'SYNC_BUNDLE_INVALID'
  | 'SYNC_BUNDLE_DIR_MISSING'
  | 'SYNC_DEVICE_UNKNOWN'
  | 'SYNC_TRANSPORT_FAILED'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_FAILED'
  | 'INTERNAL';
