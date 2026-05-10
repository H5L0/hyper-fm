// ---------------------------------------------------------------------------
// 配置 Schema：默认值、校验、规范化与 shared/local 合并
// 纯函数；可在 main / renderer 共用
// ---------------------------------------------------------------------------

import { generateId, ID_PREFIX } from './id.js';
import {
    type AppConfig,
    type FingerprintConflictWarning,
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
    type SyncConflictWarning,
    type SyncErrorWarning,
    type TagDefinition,
    type TagGroupDefinition,
    type UiPreferences,
    CONFIG_SCHEMA_VERSION,
} from './types.js';
import {
    type CustomCommand,
    type DeviceRegistry,
    type KnownDevice,
    type LegacySyncSettings,
    type LocalSyncConfigEntry,
    type LocalSyncConfigOverride,
    type LocalSyncConfigStandalone,
    SYNC_FIELD_CONTRACTS,
    type SyncConfig,
    type SyncConfigScope,
    type SyncNetworkSettings,
    createDefaultSyncNetwork,
    DEFAULT_SYNC_LISTEN_PORT,
    createDefaultFolderSyncSettings,
    createDefaultSharedDirSyncSettings,
    createDefaultSyncConfig,
    createDefaultZipSyncSettings,
} from './sync-types.js';
import { normalizeSyncConfig, normalizeSyncTargeting } from './sync-config.js';
import { createDefaultDynamicTagGroups, ensureRequiredTagGroups } from './dynamic-tags.js';

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
        configId: generateId(ID_PREFIX.config),
        name: meta?.name?.trim() || 'fm',
        description: meta?.description?.trim() || undefined,
        ignore: createDefaultIgnore(),
        projects: [],
        tagGroups: createDefaultDynamicTagGroups(),
    };
}

export function createDefaultLocalConfig(sharedConfigId = ''): LocalConfig {
    return {
        version: CONFIG_SCHEMA_VERSION,
        sharedConfigId,
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

function normalizeUniqueStringList(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of normalizeStringList(values)) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
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
        syncRespectGitignore: typeof value.syncRespectGitignore === 'boolean' ? value.syncRespectGitignore : undefined,
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
    if (!isString(value.path)) pushError(errors, `${base}.path`, '缺少 path');
    if (!isString(value.rootId)) pushError(errors, `${base}.rootId`, '缺少 rootId');
    if (typeof value.hasMetaFile !== 'boolean') pushError(errors, `${base}.hasMetaFile`, '必须为布尔');
    if (!isString(value.lastScannedAt)) pushError(errors, `${base}.lastScannedAt`, '缺少 lastScannedAt');
    if (
        !isString(value.projectId) ||
        !isString(value.path) ||
        !isString(value.rootId) ||
        typeof value.hasMetaFile !== 'boolean' ||
        !isString(value.lastScannedAt)
    ) {
        return null;
    }
    return {
        projectId: value.projectId,
        path: value.path,
        rootId: value.rootId,
        hasMetaFile: value.hasMetaFile,
        lastScannedAt: value.lastScannedAt,
    };
}

function validateScanWarning(value: unknown, idx: number, errors: ValidationError[]): ScanWarning | null {
    const base = `warnings[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    if (!isString(value.id)) pushError(errors, `${base}.id`, '缺少 id');
    if (!isString(value.message)) pushError(errors, `${base}.message`, '缺少 message');
    if (!isString(value.createdAt)) pushError(errors, `${base}.createdAt`, '缺少 createdAt');
    if (!isString(value.id) || !isString(value.message) || !isString(value.createdAt)) {
        return null;
    }

    if (value.kind === 'fingerprint-conflict') {
        const fingerprint = validateFingerprint(value.fingerprint, `${base}.fingerprint`, errors);
        if (!isString(value.scanRootId)) pushError(errors, `${base}.scanRootId`, '缺少 scanRootId');
        if (!isString(value.projectId)) pushError(errors, `${base}.projectId`, '缺少 projectId');
        if (!isString(value.projectName)) pushError(errors, `${base}.projectName`, '缺少 projectName');
        if (!isStringArray(value.candidatePaths)) pushError(errors, `${base}.candidatePaths`, '必须为字符串数组');
        if (
            !isString(value.scanRootId) ||
            !isString(value.projectId) ||
            !isString(value.projectName) ||
            !isStringArray(value.candidatePaths) ||
            !fingerprint
        ) {
            return null;
        }
        const warning: FingerprintConflictWarning = {
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
        return warning;
    }

    if (value.kind === 'sync-conflict') {
        if (!isString(value.configId)) pushError(errors, `${base}.configId`, '缺少 configId');
        if (!isString(value.configName)) pushError(errors, `${base}.configName`, '缺少 configName');
        if (!isString(value.projectId)) pushError(errors, `${base}.projectId`, '缺少 projectId');
        if (!isString(value.projectName)) pushError(errors, `${base}.projectName`, '缺少 projectName');
        if (!isStringArray(value.filePaths)) pushError(errors, `${base}.filePaths`, '必须为字符串数组');
        if (value.mode !== 'two-way' && value.mode !== 'mirror-local-to-target' && value.mode !== 'mirror-target-to-local') {
            pushError(errors, `${base}.mode`, '未知同步模式');
        }
        if (
            !isString(value.configId) ||
            !isString(value.configName) ||
            !isString(value.projectId) ||
            !isString(value.projectName) ||
            !isStringArray(value.filePaths) ||
            (value.mode !== 'two-way' && value.mode !== 'mirror-local-to-target' && value.mode !== 'mirror-target-to-local')
        ) {
            return null;
        }
        const warning: SyncConflictWarning = {
            id: value.id,
            kind: 'sync-conflict',
            configId: value.configId,
            configName: value.configName,
            projectId: value.projectId,
            projectName: value.projectName,
            mode: value.mode,
            filePaths: normalizeStringList(value.filePaths).map(item => item.replace(/\\/g, '/')),
            message: value.message,
            createdAt: value.createdAt,
        };
        return warning;
    }

    if (value.kind === 'sync-error') {
        if (!isString(value.configId)) pushError(errors, `${base}.configId`, '缺少 configId');
        if (!isString(value.configName)) pushError(errors, `${base}.configName`, '缺少 configName');
        if (!isString(value.configId) || !isString(value.configName)) {
            return null;
        }
        const warning: SyncErrorWarning = {
            id: value.id,
            kind: 'sync-error',
            configId: value.configId,
            configName: value.configName,
            projectId: isString(value.projectId) ? value.projectId : undefined,
            projectName: isString(value.projectName) ? value.projectName : undefined,
            message: value.message,
            createdAt: value.createdAt,
        };
        return warning;
    }

    pushError(errors, `${base}.kind`, '未知 warning 类型');
    return null;
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
    const { listenPort, autoStart, relayMode, ownerDeviceId, accessKey } = value;
    return {
        listenPort:
            typeof listenPort === 'number' && Number.isFinite(listenPort) && listenPort > 0 && listenPort < 65536
                ? Math.floor(listenPort)
                : DEFAULT_SYNC_LISTEN_PORT,
        autoStart: typeof autoStart === 'boolean' ? autoStart : false,
        relayMode: typeof relayMode === 'boolean' ? relayMode : false,
        ownerDeviceId: isString(ownerDeviceId) && ownerDeviceId.trim() ? ownerDeviceId.trim() : undefined,
        accessKey: isString(accessKey) && accessKey.trim() ? accessKey.trim() : undefined,
    };
}

function validateSyncConfigType(value: unknown): SyncConfig['type'] | null {
    return value === 'folder' || value === 'shared-dir' || value === 'zip' || value === 'p2p'
        ? value
        : null;
}

function validateSyncMode(value: unknown, fallback: SyncConfig['mode']): SyncConfig['mode'] {
    return value === 'two-way' || value === 'mirror-local-to-target' || value === 'mirror-target-to-local'
        ? value
        : fallback;
}

function validateSyncConfigEntry(
    value: unknown,
    idx: number,
    scope: SyncConfigScope,
    errors: ValidationError[],
): SyncConfig | null {
    const base = `syncConfigs[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const type = validateSyncConfigType(value.type);
    if (!type) {
        pushError(errors, `${base}.type`, '未知同步类型');
        return null;
    }

    const fallback = createDefaultSyncConfig(type, scope);
    const common = {
        ...fallback,
        id: isString(value.id) && value.id.trim() ? value.id : fallback.id,
        name: isString(value.name) ? value.name : fallback.name,
        scope,
        mode: validateSyncMode(value.mode, fallback.mode),
        targets: normalizeSyncTargeting(isObject(value.targets) ? value.targets : undefined),
    };

    switch (type) {
        case 'folder': {
            const folder = isObject(value.folder) ? value.folder : {};
            const defaults = createDefaultFolderSyncSettings();
            return normalizeSyncConfig({
                ...common,
                type,
                folder: {
                    targetDir: isString(folder.targetDir) && folder.targetDir.trim() ? folder.targetDir.trim() : undefined,
                    compareBeforeSync:
                        typeof folder.compareBeforeSync === 'boolean'
                            ? folder.compareBeforeSync
                            : defaults.compareBeforeSync,
                    autoSync: typeof folder.autoSync === 'boolean' ? folder.autoSync : defaults.autoSync,
                    intervalMinutes:
                        typeof folder.intervalMinutes === 'number' && Number.isFinite(folder.intervalMinutes) && folder.intervalMinutes > 0
                            ? Math.floor(folder.intervalMinutes)
                            : undefined,
                },
            });
        }
        case 'shared-dir': {
            const sharedDir = isObject(value.sharedDir) ? value.sharedDir : {};
            const defaults = createDefaultSharedDirSyncSettings();
            return normalizeSyncConfig({
                ...common,
                type,
                sharedDir: {
                    bundleDir:
                        isString(sharedDir.bundleDir) && sharedDir.bundleDir.trim()
                            ? sharedDir.bundleDir.trim()
                            : defaults.bundleDir,
                },
            });
        }
        case 'zip': {
            const zip = isObject(value.zip) ? value.zip : {};
            const defaults = createDefaultZipSyncSettings();
            return normalizeSyncConfig({
                ...common,
                type,
                zip: {
                    exportFile:
                        isString(zip.exportFile) && zip.exportFile.trim()
                            ? zip.exportFile.trim()
                            : defaults.exportFile,
                },
            });
        }
        case 'p2p':
            return normalizeSyncConfig({
                ...common,
                type,
                network: validateNetworkSettings(value.network),
            });
    }
}

function validateSyncConfigs(
    value: unknown,
    scope: SyncConfigScope,
    errors: ValidationError[],
): SyncConfig[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        pushError(errors, 'syncConfigs', '必须为数组');
        return undefined;
    }
    return value
        .map((entry, idx) => validateSyncConfigEntry(entry, idx, scope, errors))
        .filter((entry): entry is SyncConfig => entry !== null);
}

function validateLocalSyncConfigEntry(
    value: unknown,
    idx: number,
    errors: ValidationError[],
): LocalSyncConfigEntry | null {
    const base = `syncConfigs[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    if (value.kind === 'standalone') {
        const config = validateSyncConfigEntry(value.config, 0, 'local', errors);
        if (!config) return null;
        const entry: LocalSyncConfigStandalone = { kind: 'standalone', config };
        if (isString(value.lastSyncedAt)) entry.lastSyncedAt = value.lastSyncedAt;
        if (isStringArray(value.lastSyncedProjectIds)) entry.lastSyncedProjectIds = normalizeStringList(value.lastSyncedProjectIds);
        return entry;
    }
    if (!isString(value.configId) || !value.configId.trim()) {
        pushError(errors, `${base}.configId`, '缺少 configId');
        return null;
    }
    const entry: LocalSyncConfigOverride = {
        kind: 'override',
        configId: value.configId.trim(),
    };
    if (isObject(value.settings)) entry.settings = value.settings as Record<string, unknown>;
    if (isString(value.lastSyncedAt)) entry.lastSyncedAt = value.lastSyncedAt;
    if (isStringArray(value.lastSyncedProjectIds)) entry.lastSyncedProjectIds = normalizeStringList(value.lastSyncedProjectIds);
    return entry;
}

function validateLocalSyncConfigs(value: unknown, errors: ValidationError[]): LocalSyncConfigEntry[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        pushError(errors, 'syncConfigs', '必须为数组');
        return undefined;
    }
    return value
        .map((entry, idx) => validateLocalSyncConfigEntry(entry, idx, errors))
        .filter((entry): entry is LocalSyncConfigEntry => entry !== null);
}

function migrateLegacySyncSettings(value: unknown): SyncConfig[] | undefined {
    if (!isObject(value)) return undefined;
    const legacy = value as LegacySyncSettings;
    const configs: SyncConfig[] = [];
    if (isString(legacy.bundleDir) && legacy.bundleDir.trim()) {
        configs.push(
            normalizeSyncConfig({
                ...createDefaultSyncConfig('shared-dir', 'local'),
                name: '共享目录同步',
                sharedDir: { bundleDir: legacy.bundleDir.trim() },
            }),
        );
    }
    if (legacy.network !== undefined) {
        configs.push(
            normalizeSyncConfig({
                ...createDefaultSyncConfig('p2p', 'local'),
                name: 'P2P 同步',
                network: validateNetworkSettings(legacy.network),
            }),
        );
    }
    return configs.length > 0 ? configs : undefined;
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

function validateTagGroupDefinition(value: unknown, idx: number, errors: ValidationError[]): TagGroupDefinition | null {
    const base = `tagGroups[${idx}]`;
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    const { name, tags } = value;
    const normalizedName = isString(name) ? name.trim() : '';
    const normalizedTags = isStringArray(tags) ? normalizeUniqueStringList(tags) : [];
    if (!normalizedName) {
        pushError(errors, `${base}.name`, '缺少 name');
        return null;
    }
    if (normalizedTags.length === 0) {
        pushError(errors, `${base}.tags`, '至少需要一个标签');
        return null;
    }
    return {
        name: normalizedName,
        tags: normalizedTags,
    };
}

function validateTagGroups(value: unknown, errors: ValidationError[]): TagGroupDefinition[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        pushError(errors, 'tagGroups', '必须为数组');
        return undefined;
    }
    const seen = new Set<string>();
    const result: TagGroupDefinition[] = [];
    for (let i = 0; i < value.length; i++) {
        const group = validateTagGroupDefinition(value[i], i, errors);
        if (!group || seen.has(group.name)) continue;
        seen.add(group.name);
        result.push(group);
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
    const configId = isString(input.configId) && input.configId.trim()
        ? input.configId.trim()
        : generateId(ID_PREFIX.config);
    const ignore = validateIgnore(input.ignore, errors);
    const projects = (Array.isArray(input.projects) ? input.projects : [])
        .map((p, i) => validateSharedProject(p, i, errors))
        .filter((p): p is SharedProject => p !== null);
    const tags = validateTags(input.tags, errors);
    const tagGroups = ensureRequiredTagGroups(validateTagGroups(input.tagGroups, errors));
    const syncConfigs = validateSyncConfigs(input.syncConfigs, 'shared', errors);
    const config: SharedConfig = {
        version: CONFIG_SCHEMA_VERSION,
        configId,
        name: isString(input.name) && input.name.trim() ? input.name.trim() : 'fm',
        description: isString(input.description) && input.description.trim() ? input.description.trim() : undefined,
        ignore,
        projects,
        ...(tags ? { tags } : {}),
        tagGroups,
        ...(syncConfigs ? { syncConfigs } : {}),
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
    const validatedSyncConfigs = validateLocalSyncConfigs(input.syncConfigs, errors);
    let syncConfigs = validatedSyncConfigs;
    if (!syncConfigs) {
        const legacy = migrateLegacySyncSettings(input.sync);
        if (legacy) {
            syncConfigs = legacy.map(config => ({
                kind: 'standalone' as const,
                config: normalizeSyncConfig(config),
            }));
        }
    }
    const commands = validateCommands(input.commands, errors);
    const config: LocalConfig = {
        version: CONFIG_SCHEMA_VERSION,
        sharedConfigId: isString(input.sharedConfigId) ? input.sharedConfigId : '',
        scanRoots,
        bindings,
        ui,
        warnings,
        ignoredPaths,
        ...(devices ? { devices } : {}),
        ...(syncConfigs ? { syncConfigs } : {}),
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
                syncRespectGitignore: isObject(project) && typeof project.syncRespectGitignore === 'boolean'
                    ? project.syncRespectGitignore
                    : undefined,
                fingerprint:
                    isObject(project) && isObject(project.fingerprint)
                        ? project.fingerprint
                        : { kind: 'metadata' },
            }))
            : [],
        tags: input.tags,
        tagGroups: input.tagGroups,
    };
    const localInput = {
        version: input.version,
        sharedConfigId: isString(input.sharedConfigId) ? input.sharedConfigId : '',
        scanRoots: input.scanRoots,
        bindings: Array.isArray(input.projects)
            ? input.projects.map(project => ({
                projectId: isObject(project) && isString(project.id) ? project.id : '',
                path: isObject(project) && isString(project.path) ? project.path : '',
                rootId: isObject(project) && isString(project.rootId) ? project.rootId : '',
                hasMetaFile: isObject(project) && typeof project.hasMetaFile === 'boolean' ? project.hasMetaFile : false,
                lastScannedAt:
                    isObject(project) && isString(project.lastScannedAt)
                        ? project.lastScannedAt
                        : new Date(0).toISOString(),
            }))
            : [],
        ui: input.ui,
        warnings: input.warnings,
        ignoredPaths: input.ignoredPaths,
        devices: input.devices,
        syncConfigs: input.syncConfigs,
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

/**
 * 根据 shared 同步配置和 local override/standalone 条目计算运行时有效配置列表。
 */
export function resolveEffectiveSyncConfigs(shared: SharedConfig, local: LocalConfig): SyncConfig[] {
    const sharedConfigs = shared.syncConfigs ?? [];
    const localEntries = local.syncConfigs ?? [];

    const overrideByConfigId = new Map<string, LocalSyncConfigOverride>();
    const standalones: SyncConfig[] = [];

    for (const entry of localEntries) {
        if (entry.kind === 'override') {
            overrideByConfigId.set(entry.configId, entry);
        } else if (entry.kind === 'standalone') {
            standalones.push(normalizeSyncConfig(entry.config));
        }
    }

    const merged = sharedConfigs.map(config => {
        const override = overrideByConfigId.get(config.id);
        if (override?.settings) {
            return applySyncConfigOverride(config, override.settings);
        }
        return normalizeSyncConfig(config);
    });

    return [...merged, ...standalones];
}

function applySyncConfigOverride(config: SyncConfig, settings: Record<string, unknown>): SyncConfig {
    const result = structuredClone(config) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(settings)) {
        const dot = key.indexOf('.');
        if (dot === -1) continue;
        const section = key.slice(0, dot);
        const field = key.slice(dot + 1);
        const sectionObj = result[section];
        if (typeof sectionObj === 'object' && sectionObj !== null) {
            (sectionObj as Record<string, unknown>)[field] = value;
        }
    }
    return normalizeSyncConfig(result as unknown as SyncConfig);
}

/**
 * 将有效配置与 shared 基线对比，提取需要写入 local override 的字段差异。
 */
function diffSyncConfigOverrides(shared: SyncConfig, effective: SyncConfig): Record<string, unknown> {
    const diffs: Record<string, unknown> = {};
    const contract = SYNC_FIELD_CONTRACTS[shared.type];
    if (!contract) return diffs;

    const sharedObj = shared as unknown as Record<string, unknown>;
    const effectiveObj = effective as unknown as Record<string, unknown>;

    for (const [key, mode] of Object.entries(contract)) {
        if (mode === 'shared') continue;
        const [section, field] = key.split('.');
        const sharedSection = sharedObj[section!];
        const effectiveSection = effectiveObj[section!];
        const sv = typeof sharedSection === 'object' && sharedSection !== null
            ? (sharedSection as Record<string, unknown>)[field!]
            : undefined;
        const ev = typeof effectiveSection === 'object' && effectiveSection !== null
            ? (effectiveSection as Record<string, unknown>)[field!]
            : undefined;
        if (JSON.stringify(sv) !== JSON.stringify(ev)) {
            diffs[key] = ev;
        }
    }

    return diffs;
}

export function composeAppConfig(shared: SharedConfig, local: LocalConfig): AppConfig {
    const projectById = new Map(shared.projects.map(project => [project.id, project]));
    const projects: Project[] = [];
    for (const binding of local.bindings) {
        const sharedProject = projectById.get(binding.projectId);
        if (!sharedProject) continue;
        projects.push({
            ...binding,
            id: binding.projectId,
            name: sharedProject.name,
            description: sharedProject.description,
            tags: [...sharedProject.tags],
            ignore: [...sharedProject.ignore],
            syncRespectGitignore: sharedProject.syncRespectGitignore,
            fingerprint: sharedProject.fingerprint,
        });
    }
    const effectiveSyncConfigs = resolveEffectiveSyncConfigs(shared, local);
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
        ...(ensureRequiredTagGroups(shared.tagGroups)
            ? {
                tagGroups: ensureRequiredTagGroups(shared.tagGroups).map(group => ({
                    ...group,
                    tags: [...group.tags],
                })),
            }
            : {}),
        ...(local.devices ? { devices: local.devices } : {}),
        ...(effectiveSyncConfigs.length > 0 ? { syncConfigs: effectiveSyncConfigs } : {}),
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
        if (!existing) {
            updatedProjects.set(project.id, {
                id: project.id,
                name: project.name,
                description: project.description,
                tags: [...project.tags],
                ignore: [...project.ignore],
                syncRespectGitignore: project.syncRespectGitignore,
                fingerprint: cloneFingerprint(project.fingerprint),
            });
            continue;
        }
        updatedProjects.set(project.id, {
            ...existing,
            name: project.name,
            description: project.description,
            tags: [...project.tags],
            ignore: [...project.ignore],
            syncRespectGitignore: project.syncRespectGitignore,
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
        tagGroups: ensureRequiredTagGroups(appConfig.tagGroups).map(group => cloneTagGroup(group)),
        ...(appConfig.syncConfigs
            ? {
                syncConfigs: appConfig.syncConfigs
                    .filter(config => config.scope === 'shared')
                    .map(normalizeSyncConfig),
            }
            : {}),
    };
}

export function mergeAppConfigIntoLocal(appConfig: AppConfig, shared: SharedConfig): LocalConfig {
    const sharedSyncConfigs = shared.syncConfigs ?? [];
    const sharedConfigMap = new Map(sharedSyncConfigs.map(c => [c.id, c]));
    const localSyncConfigs: LocalSyncConfigEntry[] = [];
    for (const config of (appConfig.syncConfigs ?? [])) {
        if (config.scope === 'shared') {
            const sharedConfig = sharedConfigMap.get(config.id);
            const overrideSettings = sharedConfig
                ? diffSyncConfigOverrides(sharedConfig, config)
                : undefined;
            localSyncConfigs.push({
                kind: 'override',
                configId: config.id,
                ...(overrideSettings && Object.keys(overrideSettings).length > 0 ? { settings: overrideSettings } : {}),
            });
        } else {
            localSyncConfigs.push({
                kind: 'standalone',
                config: normalizeSyncConfig(config),
            });
        }
    }
    return {
        version: CONFIG_SCHEMA_VERSION,
        sharedConfigId: shared.configId,
        scanRoots: [...appConfig.scanRoots],
        bindings: appConfig.projects.map(project => ({
            projectId: project.id,
            path: project.path,
            rootId: project.rootId,
            hasMetaFile: project.hasMetaFile,
            lastScannedAt: project.lastScannedAt,
        })),
        ui: { ...appConfig.ui },
        warnings: [...appConfig.warnings],
        ignoredPaths: [...appConfig.ignoredPaths],
        ...(localSyncConfigs.length > 0 ? { syncConfigs: localSyncConfigs } : {}),
        ...(appConfig.devices ? { devices: appConfig.devices } : {}),
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

function cloneTagGroup(group: TagGroupDefinition): TagGroupDefinition {
    return {
        name: group.name,
        tags: [...group.tags],
    };
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
        syncRespectGitignore: patch?.syncRespectGitignore ?? project.syncRespectGitignore,
    };
}
