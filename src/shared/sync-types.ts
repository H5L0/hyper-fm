// ---------------------------------------------------------------------------
// 同步与命令模块的共享数据模型
// 跨进程使用：main / preload / renderer 均直接 import 本文件
// 详细设计见 docs/06-sync-design.md 与 docs/07-m3-features.md
// ---------------------------------------------------------------------------

export const SYNC_SCHEMA = 'fm.sync/v1';
export const SYNC_BUNDLE_FILENAME = 'manifest.json';
export const SYNC_INDEX_FILENAME = 'index.json';
export const SYNC_PROJECT_META_FILENAME = '.fm-meta.json';
export const SYNC_BUNDLE_EXT = '.fm-bundle.zip';
export const DEFAULT_SYNC_LISTEN_PORT = 41555;

// ---------------------------------------------------------------------------
// 设备
// ---------------------------------------------------------------------------

export interface KnownDevice {
  id: string;
  name: string;
  /** ISO 时间，最近一次握手成功时间 */
  lastSeenAt?: string;
  /** 最近一次连接的端点（可选缓存，仅供 UI 提示） */
  lastEndpoint?: string;
}

export interface DeviceRegistry {
  /** 当前设备 ID（持久化） */
  selfId: string;
  /** 当前设备显示名（用户可改） */
  selfName: string;
  /** 已知对端设备 */
  known: KnownDevice[];
}

// ---------------------------------------------------------------------------
// 同步设置
// ---------------------------------------------------------------------------

export interface SyncNetworkSettings {
  /** TCP 监听端口 */
  listenPort: number;
  /** 启动时自动开启监听 */
  autoStart: boolean;
  /** 中转模式：自动把收到的推送写入 bundleDir，并允许其他设备拉取 */
  relayMode: boolean;
}

export interface SyncSettings {
  /** 共享目录路径（OneDrive / Dropbox / 中转设备挂载点）；为空表示未配置 */
  bundleDir?: string;
  network?: SyncNetworkSettings;
}

export function createDefaultSyncNetwork(): SyncNetworkSettings {
  return {
    listenPort: DEFAULT_SYNC_LISTEN_PORT,
    autoStart: false,
    relayMode: false,
  };
}

export function createDefaultSyncSettings(): SyncSettings {
  return {
    network: createDefaultSyncNetwork(),
  };
}

// ---------------------------------------------------------------------------
// SyncManifest
// ---------------------------------------------------------------------------

export interface SyncFileEntry {
  /** 项目内相对路径，正斜杠 */
  path: string;
  size: number;
  /** ISO 时间 */
  mtime: string;
  /** 文件 sha1（hex） */
  sha1: string;
}

export interface SyncProjectMeta {
  name: string;
  description?: string;
  tags: string[];
}

export interface SyncProjectEntry {
  /** 项目逻辑 ID（DB 中的 Project.id），跨设备稳定 */
  id: string;
  /** 项目落盘 slug（basename + 短哈希），用于 zip 文件名/目录名 */
  slug: string;
  meta: SyncProjectMeta;
  /** 文件清单（用于 diff，不传内容） */
  files: SyncFileEntry[];
  /** 整体内容指纹（基于 files.sha1） */
  hash: string;
  /** 项目根目录的 mtime */
  modifiedAt: string;
}

export interface SyncManifest {
  schema: typeof SYNC_SCHEMA;
  generatedAt: string;
  device: { id: string; name: string };
  projects: SyncProjectEntry[];
}

// ---------------------------------------------------------------------------
// SyncDiff
// ---------------------------------------------------------------------------

export type SyncDiffStatus =
  /** 仅本地有 */
  | 'local-only'
  /** 仅对端有 */
  | 'remote-only'
  /** 两侧都有，hash 一致 */
  | 'identical'
  /** 两侧都有，本地较新（hash 不同，本地 modifiedAt > 对端） */
  | 'local-newer'
  /** 两侧都有，对端较新 */
  | 'remote-newer'
  /** 两侧都有但 mtime 相同 hash 不同（无法判定方向） */
  | 'conflict';

export interface SyncDiffEntry {
  projectId: string;
  status: SyncDiffStatus;
  local?: SyncProjectEntry;
  remote?: SyncProjectEntry;
}

export interface SyncDiff {
  /** diff 计算时间 */
  generatedAt: string;
  local: { device: { id: string; name: string } };
  remote: { device: { id: string; name: string } };
  entries: SyncDiffEntry[];
}

// ---------------------------------------------------------------------------
// 共享目录索引
// ---------------------------------------------------------------------------

export interface BundleIndexEntry {
  /** 由哪个设备最近一次写入 */
  deviceId: string;
  slug: string;
  hash: string;
  modifiedAt: string;
  /** 上传时间 */
  pushedAt: string;
}

export interface BundleIndex {
  schema: typeof SYNC_SCHEMA;
  /** 每个设备最近一次推送的 manifest 时间戳 */
  devices: Record<string, { name: string; updatedAt: string }>;
  /** 每个 projectId 的最新版本来自哪个设备 */
  latest: Record<string, BundleIndexEntry>;
}

export function createEmptyBundleIndex(): BundleIndex {
  return { schema: SYNC_SCHEMA, devices: {}, latest: {} };
}

// ---------------------------------------------------------------------------
// 自定义命令（M3）
// ---------------------------------------------------------------------------

export type CommandCwdMode = 'project' | 'parent';

export interface CustomCommand {
  id: string;
  /** 显示名 */
  label: string;
  /** 可执行命令；占位符 {{path}} {{name}} {{tag:foo}} */
  command: string;
  /** 参数列表；与 command 二选一传给 spawn；同样支持占位符 */
  args?: string[];
  /** 工作目录：项目根 / 项目所在目录；默认 project */
  cwd?: CommandCwdMode;
  /** 备注（可选） */
  description?: string;
}

export type PresetCommandId =
  | 'open.vscode'
  | 'open.explorer'
  | 'open.terminal'
  | 'copy.path'
  | 'copy.name';

export interface PresetCommandDescriptor {
  id: PresetCommandId;
  label: string;
}

export const PRESET_COMMANDS: PresetCommandDescriptor[] = [
  { id: 'open.explorer', label: '在资源管理器中显示' },
  { id: 'open.vscode', label: '在 VS Code 中打开' },
  { id: 'open.terminal', label: '在终端中打开' },
  { id: 'copy.path', label: '复制路径' },
  { id: 'copy.name', label: '复制名称' },
];

export interface CommandRunResult {
  /** 命令是否成功启动；不等待退出 */
  started: boolean;
  /** 仅 copy.* 命令使用 */
  clipboard?: string;
  message?: string;
}
