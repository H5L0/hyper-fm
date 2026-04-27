// ---------------------------------------------------------------------------
// 共享数据模型类型
// 跨进程使用：main / preload / renderer 均直接 import 本文件
// ---------------------------------------------------------------------------

export const CONFIG_SCHEMA_VERSION = 1;
export const META_FILE_NAME = '.meta-data';
export const META_SCHEMA = 'fm.meta/v1';
export const DEFAULT_CONFIG_FILENAME = 'fm.config.json';

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

export interface Category {
  id: string;
  name: string;
  color?: string;
}

export interface Project {
  id: string;
  path: string;
  rootId: string;
  name: string;
  categoryId?: string;
  description?: string;
  tags: string[];
  hasMetaFile: boolean;
  lastScannedAt: string;
  lastModifiedAt?: string;
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type ViewMode = 'grid' | 'list';

export interface UiPreferences {
  theme: ThemePreference;
  view: ViewMode;
}

export interface AppConfig {
  version: number;
  scanRoots: ScanRoot[];
  ignore: IgnoreRules;
  categories: Category[];
  projects: Project[];
  ui: UiPreferences;
}

// ---------------------------------------------------------------------------
// .meta-data 文件
// ---------------------------------------------------------------------------

export interface MetaFile {
  schema: typeof META_SCHEMA;
  name?: string;
  category?: string;
  description?: string;
  tags?: string[];
  ignore?: string[];
}

// ---------------------------------------------------------------------------
// 操作输入与结果
// ---------------------------------------------------------------------------

export interface ProjectMetaPatch {
  name?: string;
  categoryId?: string | null;
  description?: string;
  tags?: string[];
}

export interface ScanReport {
  rootId: string;
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  durationMs: number;
}

export interface ConfigSnapshot {
  path: string;
  data: AppConfig;
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
  | 'CATEGORY_NOT_FOUND'
  | 'DUPLICATE_PATH'
  | 'WRITE_FAILED'
  | 'INTERNAL';
