// ---------------------------------------------------------------------------
// 配置 Schema：默认值、校验、规范化与 shared/local 合并
// 纯函数；可在 main / renderer 共用
// ---------------------------------------------------------------------------

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
    type ProjectSyncState,
    type ProjectFingerprint,
    type ScanRoot,
    type ScanWarning,
    type SharedConfig,
    type SharedProject,
    type SyncBaselineFile,
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
        syncStates: validateProjectSyncStates(value.syncStates, `${base}.syncStates`, errors),
    };
}

function validateSyncBaselineFile(
    value: unknown,
    base: string,
    errors: ValidationError[],
): SyncBaselineFile | null {
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    if (!isString(value.path)) pushError(errors, `${base}.path`, '缺少 path');
    if (!isString(value.sha1)) pushError(errors, `${base}.sha1`, '缺少 sha1');
    if (!isString(value.path) || !isString(value.sha1)) {
        return null;
    }
    return {
        path: value.path.replace(/\\/g, '/'),
        sha1: value.sha1,
    };
}

function validateProjectSyncState(
    value: unknown,
    base: string,
    errors: ValidationError[],
): ProjectSyncState | null {
    if (!isObject(value)) {
        pushError(errors, base, '必须为对象');
        return null;
    }
    if (!isString(value.configId)) pushError(errors, `${base}.configId`, '缺少 configId');
    if (!isString(value.lastSyncedAt)) pushError(errors, `${base}.lastSyncedAt`, '缺少 lastSyncedAt');
    if (!isString(value.baselineHash)) pushError(errors, `${base}.baselineHash`, '缺少 baselineHash');
    if (!Array.isArray(value.baselineFiles)) pushError(errors, `${base}.baselineFiles`, '必须为数组');
    if (
        !isString(value.configId) ||
        !isString(value.lastSyncedAt) ||
        !isString(value.baselineHash) ||
        !Array.isArray(value.baselineFiles)
    ) {
        return null;
    }
    return {
        configId: value.configId,
        lastSyncedAt: value.lastSyncedAt,
        baselineHash: value.baselineHash,
        baselineFiles: value.baselineFiles
            .map((item, index) => validateSyncBaselineFile(item, `${base}.baselineFiles[${index}]`, errors))
            .filter((item): item is SyncBaselineFile => item !== null),
        targetPath: isString(value.targetPath) ? value.targetPath : undefined,
    };
}

function validateProjectSyncStates(
    value: unknown,
    base: string,
    errors: ValidationError[],
): ProjectSyncState[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        pushError(errors, base, '必须为数组');
        return undefined;
    }
    return value
        .map((item, index) => validateProjectSyncState(item, `${base}[${index}]`, errors))
        .filter((item): item is ProjectSyncState => item !== null);
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
    const ignore = validateIgnore(input.ignore, errors);
    const projects = (Array.isArray(input.projects) ? input.projects : [])
        .map((p, i) => validateSharedProject(p, i, errors))
        .filter((p): p is SharedProject => p !== null);
    const tags = validateTags(input.tags, errors);
    const tagGroups = validateTagGroups(input.tagGroups, errors);
    const syncConfigs = validateSyncConfigs(input.syncConfigs, 'shared', errors);
    const config: SharedConfig = {
        version: CONFIG_SCHEMA_VERSION,
        name: isString(input.name) && input.name.trim() ? input.name.trim() : 'fm',
        description: isString(input.description) && input.description.trim() ? input.description.trim() : undefined,
        ignore,
        projects,
        ...(tags ? { tags } : {}),
        ...(tagGroups ? { tagGroups } : {}),
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
    const syncConfigs = validateSyncConfigs(input.syncConfigs, 'local', errors)
        ?? migrateLegacySyncSettings(input.sync);
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
    const errors: ValidationError[] = [];
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
        sharedConfigPath: undefined,
        scanRoots: input.scanRoots,
        bindings: Array.isArray(input.projects)
            ? input.projects.map((project, index) => ({
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
                syncStates: isObject(project)
                    ? validateProjectSyncStates(project.syncStates, `projects[${index}].syncStates`, errors)
                    : undefined,
            }))
            : [],
        ui: input.ui,
        warnings: input.warnings,
        ignoredPaths: input.ignoredPaths,
        devices: input.devices,
        syncConfigs: input.syncConfigs,
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
            syncRespectGitignore: sharedProject.syncRespectGitignore,
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
        ...(shared.tagGroups
            ? {
                tagGroups: shared.tagGroups.map(group => ({
                    ...group,
                    tags: [...group.tags],
                })),
            }
            : {}),
        ...(local.devices ? { devices: local.devices } : {}),
        ...((shared.syncConfigs?.length || local.syncConfigs?.length)
            ? {
                syncConfigs: [
                    ...(shared.syncConfigs ?? []).map(normalizeSyncConfig),
                    ...(local.syncConfigs ?? []).map(normalizeSyncConfig),
                ],
            }
            : {}),
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
        ...(appConfig.tagGroups
            ? {
                tagGroups: appConfig.tagGroups.map(group => cloneTagGroup(group)),
            }
            : {}),
        ...(appConfig.syncConfigs
            ? {
                syncConfigs: appConfig.syncConfigs
                    .filter(config => config.scope === 'shared')
                    .map(normalizeSyncConfig),
            }
            : {}),
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
            syncStates: project.syncStates?.map(state => ({
                configId: state.configId,
                lastSyncedAt: state.lastSyncedAt,
                baselineHash: state.baselineHash,
                baselineFiles: state.baselineFiles.map(file => ({ path: file.path, sha1: file.sha1 })),
                targetPath: state.targetPath,
            })),
        })),
        ui: { ...appConfig.ui },
        warnings: [...appConfig.warnings],
        ignoredPaths: [...appConfig.ignoredPaths],
        ...(appConfig.devices ? { devices: appConfig.devices } : {}),
        ...(appConfig.syncConfigs
            ? {
                syncConfigs: appConfig.syncConfigs
                    .filter(config => config.scope === 'local')
                    .map(normalizeSyncConfig),
            }
            : {}),
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
