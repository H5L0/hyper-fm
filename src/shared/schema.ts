// ---------------------------------------------------------------------------
// 配置 Schema：默认值、校验、规范化与 shared/local 合并
// 纯函数；可在 main / renderer 共用
// ---------------------------------------------------------------------------

import {
    type AppConfig,
    type FilePathsFingerprint,
    type FolderNameFingerprint,
    type IgnoreRules,
    type LocalConfig,
    type MetaFile,
    type Project,
    type ProjectBinding,
    type ProjectFingerprint,
    type ScanRoot,
    type ScanWarning,
    type SharedConfig,
    type SharedProject,
    type TagDefinition,
    type UiPreferences,
    CONFIG_SCHEMA_VERSION,
} from './types.js';
import {
    type CustomCommand,
    type DeviceRegistry,
    type KnownDevice,
    type SyncSettings,
    type SyncNetworkSettings,
    createDefaultSyncNetwork,
    DEFAULT_SYNC_LISTEN_PORT,
} from './sync-types.js';

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

export function createDefaultSharedConfig(meta?: { name?: string; description?: string }): SharedConfig {
    return {
        version: CONFIG_SCHEMA_VERSION,
        name: meta?.name?.trim() || 'fm',
        description: meta?.description?.trim() || undefined,
        ignore: createDefaultIgnore(),
        projects: [],
    };
}

export function createDefaultLocalConfig(sharedConfigPath = ''): LocalConfig {
    return {
        version: CONFIG_SCHEMA_VERSION,
        sharedConfigPath,
        scanRoots: [],
        bindings: [],
        ui: createDefaultUi(),
        warnings: [],
        ignoredPaths: [],
    };
}

export function createDefaultConfig(): AppConfig {
    return composeAppConfig(createDefaultSharedConfig(), createDefaultLocalConfig());
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

function normalizeStringList(values: readonly string[]): string[] {
    return values.map(v => v.trim()).filter(Boolean);
}

function normalizeFingerprintPaths(paths: readonly string[]): string[] {
    return [...new Set(normalizeStringList(paths).map(v => v.replace(/\\/g, '/')))].sort();
}

function validateScanRoot(value: unknown, idx: number, errors: ValidationError[]): ScanRoot | null {
    const base = `scanRoots[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const { id, path, label, maxDepth, enabled } = value;
    if (!isString(id)) pushError(errors, `${base}.id`, '缺少 id');
    if (!isString(path)) pushError(errors, `${base}.path`, '缺少 path');
    if (typeof maxDepth !== 'number' || !Number.isFinite(maxDepth) || maxDepth < 1) {
        pushError(errors, `${base}.maxDepth`, '必须为 >= 1 的数字');
    }
    if (typeof enabled !== 'boolean') pushError(errors, `${base}.enabled`, '必须为布尔');
    if (label !== undefined && !isString(label)) pushError(errors, `${base}.label`, '必须为字符串');
    if (!isString(id) || !isString(path) || typeof maxDepth !== 'number' || typeof enabled !== 'boolean') {
        return null;
    }
    return {
        id,
        path,
        label: isString(label) ? label : undefined,
        maxDepth: Math.max(1, Math.floor(maxDepth)),
        enabled,
    };
}

function validateFingerprint(value: unknown, base: string, errors: ValidationError[]): ProjectFingerprint | null {
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const kind = value.kind;
    if (kind === 'metadata') {
        return { kind: 'metadata' };
    }
    if (kind === 'folder-name') {
        const folderName = typeof value.folderName === 'string' ? value.folderName.trim() : '';
        if (!folderName) {
            pushError(errors, `${base}.folderName`, '缺少 folderName');
            return null;
        }
        const out: FolderNameFingerprint = { kind: 'folder-name', folderName };
        return out;
    }
    if (kind === 'file-paths') {
        const paths = isStringArray(value.paths) ? normalizeFingerprintPaths(value.paths) : [];
        if (paths.length === 0) {
            pushError(errors, `${base}.paths`, '至少需要一个相对路径');
            return null;
        }
        const out: FilePathsFingerprint = { kind: 'file-paths', paths };
        return out;
    }
    pushError(errors, `${base}.kind`, '未知指纹类型');
    return null;
}

function validateSharedProject(value: unknown, idx: number, errors: ValidationError[]): SharedProject | null {
    const base = `projects[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    if (!isString(value.id)) pushError(errors, `${base}.id`, '缺少 id');
    if (!isString(value.name)) pushError(errors, `${base}.name`, '缺少 name');
    const fingerprint = validateFingerprint(value.fingerprint, `${base}.fingerprint`, errors);
    if (!isString(value.id) || !isString(value.name) || !fingerprint) {
        return null;
    }
    return {
        id: value.id,
        name: value.name,
        description: isString(value.description) ? value.description : undefined,
        tags: isStringArray(value.tags) ? normalizeStringList(value.tags) : [],
        ignore: isStringArray(value.ignore) ? normalizeStringList(value.ignore).map(v => v.replace(/\\/g, '/')) : [],
        fingerprint,
    };
}

function validateProjectBinding(value: unknown, idx: number, errors: ValidationError[]): ProjectBinding | null {
    const base = `bindings[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    if (!isString(value.projectId)) pushError(errors, `${base}.projectId`, '缺少 projectId');
    if (!isString(value.id)) pushError(errors, `${base}.id`, '缺少 id');
    if (!isString(value.path)) pushError(errors, `${base}.path`, '缺少 path');
    if (!isString(value.rootId)) pushError(errors, `${base}.rootId`, '缺少 rootId');
    if (typeof value.hasMetaFile !== 'boolean') pushError(errors, `${base}.hasMetaFile`, '必须为布尔');
    if (!isString(value.lastScannedAt)) pushError(errors, `${base}.lastScannedAt`, '缺少 lastScannedAt');
    if (
        !isString(value.projectId) ||
        !isString(value.id) ||
        !isString(value.path) ||
        !isString(value.rootId) ||
        typeof value.hasMetaFile !== 'boolean' ||
        !isString(value.lastScannedAt)
    ) {
        return null;
    }
    return {
        projectId: value.projectId,
        id: value.id,
        path: value.path,
        rootId: value.rootId,
        hasMetaFile: value.hasMetaFile,
        lastScannedAt: value.lastScannedAt,
        lastModifiedAt: isString(value.lastModifiedAt) ? value.lastModifiedAt : undefined,
        syncedAt: isString(value.syncedAt) ? value.syncedAt : undefined,
        syncedHash: isString(value.syncedHash) ? value.syncedHash : undefined,
        syncedFrom: isString(value.syncedFrom) ? value.syncedFrom : undefined,
    };
}

function validateScanWarning(value: unknown, idx: number, errors: ValidationError[]): ScanWarning | null {
    const base = `warnings[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const fingerprint = validateFingerprint(value.fingerprint, `${base}.fingerprint`, errors);
    if (!isString(value.id)) pushError(errors, `${base}.id`, '缺少 id');
    if (value.kind !== 'fingerprint-conflict') pushError(errors, `${base}.kind`, '未知 warning 类型');
    if (!isString(value.scanRootId)) pushError(errors, `${base}.scanRootId`, '缺少 scanRootId');
    if (!isString(value.projectId)) pushError(errors, `${base}.projectId`, '缺少 projectId');
    if (!isString(value.projectName)) pushError(errors, `${base}.projectName`, '缺少 projectName');
    if (!isStringArray(value.candidatePaths)) pushError(errors, `${base}.candidatePaths`, '必须为字符串数组');
    if (!isString(value.message)) pushError(errors, `${base}.message`, '缺少 message');
    if (!isString(value.createdAt)) pushError(errors, `${base}.createdAt`, '缺少 createdAt');
    if (
        !isString(value.id) ||
        !isString(value.scanRootId) ||
        !isString(value.projectId) ||
        !isString(value.projectName) ||
        !isStringArray(value.candidatePaths) ||
        !isString(value.message) ||
        !isString(value.createdAt) ||
        !fingerprint
    ) {
        return null;
    }
    return {
        id: value.id,
        kind: 'fingerprint-conflict',
        scanRootId: value.scanRootId,
        projectId: value.projectId,
        projectName: value.projectName,
        fingerprint,
        candidatePaths: normalizeStringList(value.candidatePaths),
        message: value.message,
        createdAt: value.createdAt,
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
    return {
        respectGitignore: typeof value.respectGitignore === 'boolean' ? value.respectGitignore : true,
        globs: isStringArray(value.globs) ? normalizeStringList(value.globs) : createDefaultIgnore().globs,
    };
}

// ---------------------------------------------------------------------------
// 设备 / 同步 / 命令（可选字段）
// ---------------------------------------------------------------------------

function validateKnownDevice(value: unknown): KnownDevice | null {
    if (!isObject(value)) return null;
    const { id, name, lastSeenAt, lastEndpoint } = value;
    if (!isString(id) || !isString(name)) return null;
    return {
        id,
        name,
        lastSeenAt: isString(lastSeenAt) ? lastSeenAt : undefined,
        lastEndpoint: isString(lastEndpoint) ? lastEndpoint : undefined,
    };
}

function validateDevices(value: unknown, errors: ValidationError[]): DeviceRegistry | undefined {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
        pushError(errors, 'devices', '必须为对象');
        return undefined;
    }
    const { selfId, selfName, known } = value;
    if (!isString(selfId) || !isString(selfName)) {
        pushError(errors, 'devices', 'selfId/selfName 缺失');
        return undefined;
    }
    const list = Array.isArray(known)
        ? known.map(validateKnownDevice).filter((d): d is KnownDevice => d !== null)
        : [];
    return { selfId, selfName, known: list };
}

function validateNetworkSettings(value: unknown): SyncNetworkSettings {
    if (!isObject(value)) return createDefaultSyncNetwork();
    const { listenPort, autoStart, relayMode } = value;
    return {
        listenPort:
            typeof listenPort === 'number' && Number.isFinite(listenPort) && listenPort > 0 && listenPort < 65536
                ? Math.floor(listenPort)
                : DEFAULT_SYNC_LISTEN_PORT,
        autoStart: typeof autoStart === 'boolean' ? autoStart : false,
        relayMode: typeof relayMode === 'boolean' ? relayMode : false,
    };
}

function validateSync(value: unknown, errors: ValidationError[]): SyncSettings | undefined {
    if (value === undefined) return undefined;
    if (!isObject(value)) {
        pushError(errors, 'sync', '必须为对象');
        return undefined;
    }
    const out: SyncSettings = {};
    if (isString(value.bundleDir) && value.bundleDir.length > 0) out.bundleDir = value.bundleDir;
    if (value.network !== undefined) out.network = validateNetworkSettings(value.network);
    return out;
}

function validateCommand(value: unknown, idx: number, errors: ValidationError[]): CustomCommand | null {
    const base = `commands[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const { id, label, command, args, cwd, description } = value;
    if (!isString(id) || !isString(label) || !isString(command)) {
        pushError(errors, base, 'id/label/command 必须为字符串');
        return null;
    }
    return {
        id,
        label,
        command,
        args: isStringArray(args) ? normalizeStringList(args) : undefined,
        cwd: cwd === 'parent' || cwd === 'project' ? cwd : undefined,
        description: isString(description) ? description : undefined,
    };
}

function validateCommands(value: unknown, errors: ValidationError[]): CustomCommand[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        pushError(errors, 'commands', '必须为数组');
        return undefined;
    }
    return value
        .map((c, i) => validateCommand(c, i, errors))
        .filter((c): c is CustomCommand => c !== null);
}

function validateTagDefinition(value: unknown, idx: number, errors: ValidationError[]): TagDefinition | null {
    const base = `tags[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const { name, color } = value;
    if (!isString(name) || name.length === 0) {
        pushError(errors, `${base}.name`, '缺少 name');
        return null;
    }
    return {
        name,
        color: isString(color) && color.length > 0 ? color : '#94a3b8',
    };
}

function validateTags(value: unknown, errors: ValidationError[]): TagDefinition[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        pushError(errors, 'tags', '必须为数组');
        return undefined;
    }
    const seen = new Set<string>();
    const result: TagDefinition[] = [];
    for (let i = 0; i < value.length; i++) {
        const t = validateTagDefinition(value[i], i, errors);
        if (!t || seen.has(t.name)) continue;
        seen.add(t.name);
        result.push(t);
    }
    return result;
}

export interface ValidationResult<T> {
    config: T;
    errors: ValidationError[];
}

function validateVersion(input: Record<string, unknown>): void {
    const versionRaw = input.version;
    const version = typeof versionRaw === 'number' ? versionRaw : CONFIG_SCHEMA_VERSION;
    if (version > CONFIG_SCHEMA_VERSION) {
        throw new Error(
            `配置 schema 版本 ${version} 高于本程序支持的 ${CONFIG_SCHEMA_VERSION}，请升级应用`,
        );
    }
}

export function validateSharedConfig(input: unknown): ValidationResult<SharedConfig> {
    if (!isObject(input)) throw new Error('共享配置根必须为 JSON 对象');
    validateVersion(input);
    const errors: ValidationError[] = [];
    const ignore = validateIgnore(input.ignore, errors);
    const projects = (Array.isArray(input.projects) ? input.projects : [])
        .map((p, i) => validateSharedProject(p, i, errors))
        .filter((p): p is SharedProject => p !== null);
    const tags = validateTags(input.tags, errors);
    const config: SharedConfig = {
        version: CONFIG_SCHEMA_VERSION,
        name: isString(input.name) && input.name.trim() ? input.name.trim() : 'fm',
        description: isString(input.description) && input.description.trim() ? input.description.trim() : undefined,
        ignore,
        projects,
        ...(tags ? { tags } : {}),
    };
    return { config, errors };
}

export function validateLocalConfig(input: unknown): ValidationResult<LocalConfig> {
    if (!isObject(input)) throw new Error('本地配置根必须为 JSON 对象');
    validateVersion(input);
    const errors: ValidationError[] = [];
    const scanRoots = (Array.isArray(input.scanRoots) ? input.scanRoots : [])
        .map((r, i) => validateScanRoot(r, i, errors))
        .filter((r): r is ScanRoot => r !== null);
    const bindings = (Array.isArray(input.bindings) ? input.bindings : [])
        .map((b, i) => validateProjectBinding(b, i, errors))
        .filter((b): b is ProjectBinding => b !== null);
    const warnings = (Array.isArray(input.warnings) ? input.warnings : [])
        .map((w, i) => validateScanWarning(w, i, errors))
        .filter((w): w is ScanWarning => w !== null);
    const ignoredPaths = isStringArray(input.ignoredPaths) ? normalizeStringList(input.ignoredPaths) : [];
    const ui = validateUi(input.ui, errors);
    const devices = validateDevices(input.devices, errors);
    const sync = validateSync(input.sync, errors);
    const commands = validateCommands(input.commands, errors);
    const config: LocalConfig = {
        version: CONFIG_SCHEMA_VERSION,
        sharedConfigPath: isString(input.sharedConfigPath) ? input.sharedConfigPath : '',
        scanRoots,
        bindings,
        ui,
        warnings,
        ignoredPaths,
        ...(devices ? { devices } : {}),
        ...(sync ? { sync } : {}),
        ...(commands ? { commands } : {}),
    };
    return { config, errors };
}

/**
 * 保留给 renderer / 旧调用方的聚合校验入口。
 * 注意：此入口不会恢复 shared project 列表，只适合处理聚合视图自身的默认值。
 */
export function validateConfig(input: unknown): ValidationResult<AppConfig> {
    if (!isObject(input)) {
        throw new Error('配置文件根必须为 JSON 对象');
    }
    const sharedInput = {
        version: input.version,
        name: input.name,
        description: input.description,
        ignore: input.ignore,
        projects: Array.isArray(input.projects)
            ? input.projects.map(project => ({
                id: isObject(project) && isString(project.id) ? project.id : '',
                name: isObject(project) && isString(project.name) ? project.name : '',
                description: isObject(project) && isString(project.description) ? project.description : undefined,
                tags: isObject(project) && isStringArray(project.tags) ? project.tags : [],
                ignore: isObject(project) && isStringArray(project.ignore) ? project.ignore : [],
                fingerprint:
                    isObject(project) && isObject(project.fingerprint)
                        ? project.fingerprint
                        : { kind: 'metadata' },
            }))
            : [],
        tags: input.tags,
    };
    const localInput = {
        version: input.version,
        sharedConfigPath: undefined,
        scanRoots: input.scanRoots,
        bindings: Array.isArray(input.projects)
            ? input.projects.map(project => ({
                projectId: isObject(project) && isString(project.id) ? project.id : '',
                id: isObject(project) && isString(project.id) ? project.id : '',
                path: isObject(project) && isString(project.path) ? project.path : '',
                rootId: isObject(project) && isString(project.rootId) ? project.rootId : '',
                hasMetaFile: isObject(project) && typeof project.hasMetaFile === 'boolean' ? project.hasMetaFile : false,
                lastScannedAt:
                    isObject(project) && isString(project.lastScannedAt)
                        ? project.lastScannedAt
                        : new Date(0).toISOString(),
                lastModifiedAt: isObject(project) && isString(project.lastModifiedAt) ? project.lastModifiedAt : undefined,
                syncedAt: isObject(project) && isString(project.syncedAt) ? project.syncedAt : undefined,
                syncedHash: isObject(project) && isString(project.syncedHash) ? project.syncedHash : undefined,
                syncedFrom: isObject(project) && isString(project.syncedFrom) ? project.syncedFrom : undefined,
            }))
            : [],
        ui: input.ui,
        warnings: input.warnings,
        ignoredPaths: input.ignoredPaths,
        devices: input.devices,
        sync: input.sync,
        commands: input.commands,
    };
    const shared = validateSharedConfig(sharedInput);
    const local = validateLocalConfig(localInput);
    return {
        config: composeAppConfig(shared.config, local.config),
        errors: [...shared.errors, ...local.errors],
    };
}

// ---------------------------------------------------------------------------
// 合并 / 拆分
// ---------------------------------------------------------------------------

export function composeAppConfig(shared: SharedConfig, local: LocalConfig): AppConfig {
    const projectById = new Map(shared.projects.map(project => [project.id, project]));
    const projects: Project[] = [];
    for (const binding of local.bindings) {
        const sharedProject = projectById.get(binding.projectId);
        if (!sharedProject) continue;
        projects.push({
            ...binding,
            id: sharedProject.id,
            name: sharedProject.name,
            description: sharedProject.description,
            tags: [...sharedProject.tags],
            ignore: [...sharedProject.ignore],
            fingerprint: sharedProject.fingerprint,
        });
    }
    return {
        version: CONFIG_SCHEMA_VERSION,
        name: shared.name,
        description: shared.description,
        scanRoots: [...local.scanRoots],
        ignore: { ...shared.ignore, globs: [...shared.ignore.globs] },
        projects,
        ui: { ...local.ui },
        warnings: [...(local.warnings ?? [])],
        ignoredPaths: [...(local.ignoredPaths ?? [])],
        ...(shared.tags ? { tags: [...shared.tags] } : {}),
        ...(local.devices ? { devices: local.devices } : {}),
        ...(local.sync ? { sync: local.sync } : {}),
        ...(local.commands ? { commands: local.commands } : {}),
    };
}

export function mergeAppConfigIntoShared(current: SharedConfig, appConfig: AppConfig): SharedConfig {
    const updatedProjects = new Map<string, SharedProject>();
    for (const project of current.projects) {
        updatedProjects.set(project.id, {
            ...project,
            tags: [...project.tags],
            ignore: [...project.ignore],
            fingerprint: cloneFingerprint(project.fingerprint),
        });
    }
    for (const project of appConfig.projects) {
        const existing = updatedProjects.get(project.id);
        if (!existing) continue;
        updatedProjects.set(project.id, {
            ...existing,
            name: project.name,
            description: project.description,
            tags: [...project.tags],
            ignore: [...project.ignore],
            fingerprint: cloneFingerprint(project.fingerprint),
        });
    }
    return {
        ...current,
        version: CONFIG_SCHEMA_VERSION,
        name: appConfig.name.trim() || current.name,
        description: appConfig.description?.trim() || undefined,
        ignore: {
            respectGitignore: appConfig.ignore.respectGitignore,
            globs: [...appConfig.ignore.globs],
        },
        projects: [...updatedProjects.values()],
        ...(appConfig.tags ? { tags: [...appConfig.tags] } : {}),
    };
}

export function mergeAppConfigIntoLocal(appConfig: AppConfig, sharedConfigPath = ''): LocalConfig {
    return {
        version: CONFIG_SCHEMA_VERSION,
        sharedConfigPath,
        scanRoots: [...appConfig.scanRoots],
        bindings: appConfig.projects.map(project => ({
            projectId: project.id,
            id: project.id,
            path: project.path,
            rootId: project.rootId,
            hasMetaFile: project.hasMetaFile,
            lastScannedAt: project.lastScannedAt,
            lastModifiedAt: project.lastModifiedAt,
            syncedAt: project.syncedAt,
            syncedHash: project.syncedHash,
            syncedFrom: project.syncedFrom,
        })),
        ui: { ...appConfig.ui },
        warnings: [...appConfig.warnings],
        ignoredPaths: [...appConfig.ignoredPaths],
        ...(appConfig.devices ? { devices: appConfig.devices } : {}),
        ...(appConfig.sync ? { sync: appConfig.sync } : {}),
        ...(appConfig.commands ? { commands: appConfig.commands } : {}),
    };
}

function cloneFingerprint(fingerprint: ProjectFingerprint): ProjectFingerprint {
    if (fingerprint.kind === 'metadata') return { kind: 'metadata' };
    if (fingerprint.kind === 'folder-name') {
        return { kind: 'folder-name', folderName: fingerprint.folderName };
    }
    return { kind: 'file-paths', paths: [...fingerprint.paths] };
}

// ---------------------------------------------------------------------------
// .meta-data 工具
// ---------------------------------------------------------------------------

export function buildMetaFile(project: SharedProject, patch?: Partial<MetaFile>): MetaFile {
    return {
        schema: 'fm.meta/v1',
        projectId: project.id,
        name: patch?.name ?? project.name,
        description: patch?.description ?? project.description,
        tags: patch?.tags ?? project.tags,
        ignore: patch?.ignore ?? project.ignore,
    };
}
