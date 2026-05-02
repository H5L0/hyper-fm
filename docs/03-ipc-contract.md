# IPC 契约

renderer 通过 preload 暴露的 `window.fm` 对象与主进程通信。模板基础能力仍保留在 `window.app`，业务能力统一走 `fm:*` 命名空间。

## 类型契约概览（`src/shared/bridge.ts`）

```ts
export interface FmBridge {
  config: FmConfigBridge;
  scanRoots: FmScanRootsBridge;
  scan: FmScanBridge;
  projects: FmProjectsBridge;
  tags: FmTagsBridge;
  sync: FmSyncBridge;
  commands: FmCommandsBridge;
}
```

## `config`

```ts
interface FmConfigBridge {
  current(): Promise<ConfigSnapshot>;
  load(filePath: string): Promise<ConfigSnapshot>;
  create(filePath: string): Promise<ConfigSnapshot>;
  save(data: AppConfig): Promise<void>;
  pick(mode: 'open' | 'save'): Promise<string | null>;
}
```

### 说明

- `ConfigSnapshot.paths.sharedPath`：当前 shared 配置文件路径。
- `ConfigSnapshot.paths.localPath`：当前 local 配置文件路径。
- `save(data)`：renderer 仍传递聚合 `AppConfig`，主进程负责拆回 shared/local 两份配置。

## `scanRoots`

```ts
interface FmScanRootsBridge {
  add(input: { path: string; label?: string; maxDepth?: number }): Promise<ScanRoot>;
  update(id: string, patch: Partial<Omit<ScanRoot, 'id'>>): Promise<ScanRoot>;
  remove(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
}
```

## `scan`

```ts
interface FmScanBridge {
  runAll(): Promise<ScanReport[]>;
  runOne(rootId: string): Promise<ScanReport>;
  ignorePath(path: string): Promise<void>;
  onProgress(handler: (event: ScanProgressEvent) => void): () => void;
}
```

### 说明

- `runAll()`：扫描全部启用的根。
- `runOne(rootId)`：扫描指定根。
- `ignorePath(path)`：把某个冲突目录加入 local `ignoredPaths`。
- `onProgress()`：订阅 `fm:scan:progress` 事件。

## `projects`

```ts
interface FmProjectsBridge {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  updateMeta(id: string, patch: ProjectMetaPatch): Promise<Project>;
  writeMetaFile(id: string, patch: ProjectMetaPatch): Promise<Project>;
  removeMetaFile(id: string): Promise<Project>;
  revealInOs(id: string): Promise<void>;
  inspectDirectory(path: string): Promise<ProjectDirectoryInspection>;
  validateNew(input: ManualProjectInput): Promise<ManualProjectValidationResult>;
  add(input: ManualProjectInput): Promise<Project>;
  remove(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
}
```

### 新增结构

```ts
interface ManualProjectInput {
  path: string;
  name?: string;
  description?: string;
  tags?: string[];
  fingerprint: ProjectFingerprint;
}

interface ProjectDirectoryInspection {
  path: string;
  suggestedName: string;
  hasMetaFile: boolean;
  metaProjectId?: string;
  files: string[];
}

interface ManualProjectValidationResult {
  valid: boolean;
  conflicts: Array<{
    projectId: string;
    projectName: string;
    reason: string;
  }>;
}
```

### 说明

- `inspectDirectory(path)`：用于手动添加项目前的预检查，返回候选目录信息与可选文件列表。
- `validateNew(input)`：验证所选指纹是否与现有项目冲突。
- `add(input)`：创建 shared 项目，并同步写入本地 binding；若指纹为 `metadata`，会在 `.meta-data` 中写入 `projectId`。
- `writeMetaFile()` / `removeMetaFile()`：修改项目根目录的 `.meta-data` 文件，并同步刷新聚合项目视图。

## `tags`

```ts
interface FmTagsBridge {
  list(): Promise<TagDefinition[]>;
  upsert(tag: TagDefinition): Promise<TagDefinition[]>;
  remove(name: string): Promise<TagDefinition[]>;
  rename(oldName: string, newName: string): Promise<TagDefinition[]>;
}
```

标签注册表位于 shared 配置，因此会跨机器共享颜色和名称。

## `sync`

```ts
interface FmSyncBridge {
  getDevice(): Promise<DeviceRegistry>;
  setSelfName(name: string): Promise<DeviceRegistry>;
  getSettings(): Promise<SyncSettings>;
  setSettings(settings: SyncSettings): Promise<SyncSettings>;
  pickBundleDir(): Promise<string | null>;
  diffBundleDir(projectIds?: string[]): Promise<SyncDiff>;
  pushBundleDir(projectIds: string[]): Promise<{ pushed: string[] }>;
  pullBundleDir(items: SyncPullItem[]): Promise<SyncPullResult[]>;
  exportZip(projectIds: string[], outputFile: string): Promise<{ outputFile: string; projects: number }>;
  pickExportFile(): Promise<string | null>;
  pickImportFile(): Promise<string | null>;
  previewZip(file: string): Promise<{ manifest: SyncManifest; entries: SyncProjectEntry[] }>;
  applyZip(file: string, plan: SyncImportItem[]): Promise<SyncImportResult[]>;
  startServer(): Promise<{ port: number }>;
  stopServer(): Promise<void>;
  isServerRunning(): Promise<boolean>;
}
```

## `commands`

```ts
interface FmCommandsBridge {
  presets(): Promise<PresetCommandDescriptor[]>;
  list(): Promise<CustomCommand[]>;
  add(input: Omit<CustomCommand, 'id'>): Promise<CustomCommand>;
  update(id: string, patch: Partial<Omit<CustomCommand, 'id'>>): Promise<CustomCommand>;
  remove(id: string): Promise<void>;
  run(commandId: string, projectId: string): Promise<CommandRunResult>;
}
```

## 通道列表

| 通道 | 方向 | 说明 |
|------|------|------|
| `fm:config:current` | invoke | 返回当前 `ConfigSnapshot` |
| `fm:config:load` | invoke | 加载指定 shared 配置，并自动推导 local 配置 |
| `fm:config:create` | invoke | 创建 shared/local 默认配置 |
| `fm:config:save` | invoke | 覆写当前聚合配置 |
| `fm:config:pick` | invoke | 调起系统文件对话框 |
| `fm:scanRoots:add/update/remove/pickDirectory` | invoke | 管理扫描根 |
| `fm:scan:runAll` / `fm:scan:runOne` | invoke | 执行扫描 |
| `fm:scan:ignorePath` | invoke | 把目录加入 local ignore list |
| `fm:scan:progress` | event | 推送进度 `{ rootId, scanned, found }` |
| `fm:projects:list/get` | invoke | 查询项目 |
| `fm:projects:updateMeta` | invoke | 仅更新 shared 项目元数据 |
| `fm:projects:writeMetaFile` / `removeMetaFile` | invoke | 修改 `.meta-data` |
| `fm:projects:inspectDirectory` | invoke | 检查待添加目录 |
| `fm:projects:validateNew` | invoke | 校验手动添加输入 |
| `fm:projects:add/remove/revealInOs/pickDirectory` | invoke | 手动添加、删除、打开目录 |
| `fm:tags:list/upsert/remove/rename` | invoke | 标签注册表操作 |
| `fm:sync:*` | invoke | 同步设备、bundle、zip、TCP 服务 |
| `fm:commands:*` | invoke | 自定义命令管理与执行 |

## 错误处理

主进程通过 `FmError` 抛出结构化错误，`code` 可能包括：

```ts
type FmErrorCode =
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
```

renderer 应根据 `code` 与 `message` 决定 toast、禁用态或表单提示。
