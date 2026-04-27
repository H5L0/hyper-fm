// ---------------------------------------------------------------------------
// 配置 Schema：默认值、校验、规范化
// 纯函数；可在 main / renderer 共用
// ---------------------------------------------------------------------------

import {
  type AppConfig,
  type Category,
  type IgnoreRules,
  type Project,
  type ScanRoot,
  type UiPreferences,
  CONFIG_SCHEMA_VERSION,
} from './types.js';

// ---------------------------------------------------------------------------
// 默认值
// ---------------------------------------------------------------------------

export function createDefaultIgnore(): IgnoreRules {
  return {
    respectGitignore: true,
    globs: ['node_modules', '.git', 'dist', 'build', '.cache', '.venv', '__pycache__'],
  };
}

export function createDefaultUi(): UiPreferences {
  return { theme: 'system', view: 'grid' };
}

export function createDefaultConfig(): AppConfig {
  return {
    version: CONFIG_SCHEMA_VERSION,
    scanRoots: [],
    ignore: createDefaultIgnore(),
    categories: [],
    projects: [],
    ui: createDefaultUi(),
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  message: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function pushError(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message });
}

function validateScanRoot(value: unknown, idx: number, errors: ValidationError[]): ScanRoot | null {
  const base = `scanRoots[${idx}]`;
  if (!isObject(value)) {
    pushError(errors, base, '必须为对象');
    return null;
  }
  const { id, path: p, label, maxDepth, enabled } = value;
  if (!isString(id)) pushError(errors, `${base}.id`, '缺少 id');
  if (!isString(p)) pushError(errors, `${base}.path`, '缺少 path');
  if (typeof maxDepth !== 'number' || !Number.isFinite(maxDepth) || maxDepth < 1) {
    pushError(errors, `${base}.maxDepth`, '必须为 >= 1 的数字');
  }
  if (typeof enabled !== 'boolean') pushError(errors, `${base}.enabled`, '必须为布尔');
  if (label !== undefined && !isString(label)) pushError(errors, `${base}.label`, '必须为字符串');

  if (!isString(id) || !isString(p) || typeof maxDepth !== 'number' || typeof enabled !== 'boolean') {
    return null;
  }

  return {
    id,
    path: p,
    label: isString(label) ? label : undefined,
    maxDepth,
    enabled,
  };
}

function validateCategory(value: unknown, idx: number, errors: ValidationError[]): Category | null {
  const base = `categories[${idx}]`;
  if (!isObject(value)) {
    pushError(errors, base, '必须为对象');
    return null;
  }
  const { id, name, color } = value;
  if (!isString(id)) pushError(errors, `${base}.id`, '缺少 id');
  if (!isString(name)) pushError(errors, `${base}.name`, '缺少 name');
  if (color !== undefined && !isString(color)) pushError(errors, `${base}.color`, '必须为字符串');
  if (!isString(id) || !isString(name)) return null;
  return { id, name, color: isString(color) ? color : undefined };
}

function validateProject(value: unknown, idx: number, errors: ValidationError[]): Project | null {
  const base = `projects[${idx}]`;
  if (!isObject(value)) {
    pushError(errors, base, '必须为对象');
    return null;
  }
  const v = value;
  if (!isString(v.id)) pushError(errors, `${base}.id`, '缺少 id');
  if (!isString(v.path)) pushError(errors, `${base}.path`, '缺少 path');
  if (!isString(v.rootId)) pushError(errors, `${base}.rootId`, '缺少 rootId');
  if (!isString(v.name)) pushError(errors, `${base}.name`, '缺少 name');
  const tags = isStringArray(v.tags) ? v.tags : [];
  const hasMetaFile = typeof v.hasMetaFile === 'boolean' ? v.hasMetaFile : false;
  const lastScannedAt = isString(v.lastScannedAt) ? v.lastScannedAt : new Date(0).toISOString();

  if (!isString(v.id) || !isString(v.path) || !isString(v.rootId) || !isString(v.name)) {
    return null;
  }

  return {
    id: v.id,
    path: v.path,
    rootId: v.rootId,
    name: v.name,
    categoryId: isString(v.categoryId) ? v.categoryId : undefined,
    description: isString(v.description) ? v.description : undefined,
    tags,
    hasMetaFile,
    lastScannedAt,
    lastModifiedAt: isString(v.lastModifiedAt) ? v.lastModifiedAt : undefined,
  };
}

function validateUi(value: unknown, errors: ValidationError[]): UiPreferences {
  if (value === undefined) return createDefaultUi();
  if (!isObject(value)) {
    pushError(errors, 'ui', '必须为对象');
    return createDefaultUi();
  }
  const theme = value.theme;
  const view = value.view;
  return {
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
    view: view === 'grid' || view === 'list' ? view : 'grid',
  };
}

function validateIgnore(value: unknown, errors: ValidationError[]): IgnoreRules {
  if (value === undefined) return createDefaultIgnore();
  if (!isObject(value)) {
    pushError(errors, 'ignore', '必须为对象');
    return createDefaultIgnore();
  }
  const respectGitignore =
    typeof value.respectGitignore === 'boolean' ? value.respectGitignore : true;
  const globs = isStringArray(value.globs) ? value.globs : createDefaultIgnore().globs;
  return { respectGitignore, globs };
}

export interface ValidationResult {
  config: AppConfig;
  errors: ValidationError[];
}

/**
 * 宽松校验：尽可能恢复，未通过校验的字段使用默认值；致命错误（version 不兼容、根不是对象）抛出。
 */
export function validateConfig(input: unknown): ValidationResult {
  if (!isObject(input)) {
    throw new Error('配置文件根必须为 JSON 对象');
  }
  const errors: ValidationError[] = [];

  const versionRaw = input.version;
  const version = typeof versionRaw === 'number' ? versionRaw : CONFIG_SCHEMA_VERSION;
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `配置 schema 版本 ${version} 高于本程序支持的 ${CONFIG_SCHEMA_VERSION}，请升级应用`,
    );
  }

  const scanRootsRaw = Array.isArray(input.scanRoots) ? input.scanRoots : [];
  const scanRoots = scanRootsRaw
    .map((r, i) => validateScanRoot(r, i, errors))
    .filter((r): r is ScanRoot => r !== null);

  const categoriesRaw = Array.isArray(input.categories) ? input.categories : [];
  const categories = categoriesRaw
    .map((c, i) => validateCategory(c, i, errors))
    .filter((c): c is Category => c !== null);

  const projectsRaw = Array.isArray(input.projects) ? input.projects : [];
  const projects = projectsRaw
    .map((p, i) => validateProject(p, i, errors))
    .filter((p): p is Project => p !== null);

  const ignore = validateIgnore(input.ignore, errors);
  const ui = validateUi(input.ui, errors);

  const config: AppConfig = {
    version: CONFIG_SCHEMA_VERSION,
    scanRoots,
    ignore,
    categories,
    projects,
    ui,
  };
  return { config, errors };
}
