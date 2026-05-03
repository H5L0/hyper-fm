// ---------------------------------------------------------------------------
// 共享数据模型类型
// 跨进程使用：main / preload / renderer 均直接 import 本文件
// ---------------------------------------------------------------------------

export const CONFIG_SCHEMA_VERSION = 2;
export const META_FILE_NAME = '.meta-data';
export const META_SCHEMA = 'fm.meta/v1';
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
  id: string;
  path: string;
  rootId: string;
  hasMetaFile: boolean;
  lastScannedAt: string;
  lastModifiedAt?: string;
  /** 上次同步成功的时间（推送或拉取） */
  syncedAt?: string;
  /** 上次同步时该项目的内容指纹 */
  syncedHash?: string;
  /** 上次拉取来源设备 ID */
  syncedFrom?: string;
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
  fingerprint: ProjectFingerprint;
}

export interface Project extends ProjectBinding {
  name: string;
  description?: string;
  tags: string[];
  ignore: string[];
  fingerprint: ProjectFingerprint;
}

export interface ScanWarning {
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

export type ThemePreference = 'light' | 'dark' | 'system';
export type ViewMode = 'grid' | 'list';

export interface UiPreferences {
  theme: ThemePreference;
  view: ViewMode;
}

export interface SharedConfig {
  version: number;
  name: string;
  description?: string;
  ignore: IgnoreRules;
  projects: SharedProject[];
  /** 标签注册表：可在项目详情和侧边栏中显示颜色，未在此处注册的标签按默认色渲染 */
  tags?: TagDefinition[];
  /** 共享同步配置 */
  syncConfigs?: import('./sync-types.js').SyncConfig[];
}

export interface LocalConfig {
  version: number;
  sharedConfigPath: string;
  scanRoots: ScanRoot[];
  bindings: ProjectBinding[];
  ui: UiPreferences;
  warnings?: ScanWarning[];
  /** 本机忽略的具体目录路径（优先于扫描发现） */
  ignoredPaths?: string[];
  /** M2：设备身份与已知对端 */
  devices?: import('./sync-types.js').DeviceRegistry;
  /** 同步配置（仅本机生效） */
  syncConfigs?: import('./sync-types.js').SyncConfig[];
  /** M3：自定义命令列表 */
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
}

// ---------------------------------------------------------------------------
// 操作输入与结果
// ---------------------------------------------------------------------------

export interface ProjectMetaPatch {
  name?: string;
  description?: string;
  tags?: string[];
  ignore?: string[];
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
}

export interface ConfigSnapshot {
  paths: ConfigPaths;
  data: AppConfig;
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
