# M2 同步设计

M2 在 M1 基础上引入跨机同步。同步范围 = 一个或多个项目目录 + 它们对应的 fm 元数据（DB 中的 `Project` 记录与可选 `.meta-data` 内容）。

## 设计原则

- **零服务器**：核心传输是设备直连或经用户自管的「中转设备」，不依赖 fm 项目维护任何在线服务。
- **手动触发**：M2 不做实时同步与定时同步；用户在 UI 中显式点击「推送」/「拉取」/「导出」/「导入」。
- **冲突让用户判断**：传输前先比对元数据差异并展示，用户决定哪些项目推/拉。不做静默合并。
- **可携带**：导入/导出 zip 必须自描述，可在没有 fm 的机器上检查内容；网络协议消息也使用 JSON 头。

## 同步载体

提供两条互补路径，复用同一份「打包/解包」核心：

| 载体 | 适用场景 | 特点 |
|------|---------|------|
| **zip 包** | 偶尔搬运、U 盘、邮件 | 一次性，单文件；包内含 manifest |
| **共享目录** | OneDrive / Dropbox / 中转设备 | 持续同步源；按设备分文件夹，记录每个项目的最新版本 |
| **TCP P2P** | 局域网两台设备直连 | 同款消息协议；可选 |
| **中转设备** | 非局域网跨机 | 等同于「TCP P2P + 共享目录」组合：所有设备都向同一台中转设备推/拉 |

## 数据模型扩展

### `AppConfig.devices`

```ts
{
  selfId: 'dev_xxxxxx',        // 当前设备 ID
  selfName: 'My Laptop',
  known: [                      // 已知的对端设备（自动添加）
    { id: 'dev_yyyyyy', name: 'Desktop', lastSeenAt: '2026-04-27T...' }
  ]
}
```

### `AppConfig.sync`

```ts
{
  bundleDir?: string,           // 共享目录路径（OneDrive/Dropbox/中转设备的挂载点）
  network?: {
    listenPort: number,         // TCP 监听端口（默认 41555）
    autoStart: boolean,         // 启动时自动监听
    relayMode: boolean,         // 当前设备作为中转：接收并默认推到 bundleDir
  }
}
```

### 项目内的同步元数据

DB 中的 `Project` 增加：

```ts
{
  syncedAt?: string,           // 上一次成功推送/拉取的时间
  syncedHash?: string,         // 上一次同步时的内容指纹（sha1，详见下文）
  syncedFrom?: string,         // 上一次拉取来源（设备 ID）
}
```

## SyncManifest（同步清单）

每次「打包」生成一个 manifest，是同步交互的统一交换格式：

```ts
interface SyncManifest {
  schema: 'fm.sync/v1';
  generatedAt: string;        // ISO
  device: { id: string; name: string };
  projects: SyncProjectEntry[];
}

interface SyncProjectEntry {
  /** 项目逻辑 ID（DB 中的 Project.id），跨设备稳定 */
  id: string;
  /** 项目相对路径名（取自 path 的 basename + 短哈希，避免重名冲突） */
  slug: string;
  meta: {
    name: string;
    category?: string;          // 用 name，不传 ID
    description?: string;
    tags: string[];
  };
  /** 文件清单（用于 diff、不传输内容） */
  files: SyncFileEntry[];
  /** 整个项目的内容指纹（基于 files 的 sha1 之和） */
  hash: string;
  /** 项目根目录的 mtime（加入打包时即时取） */
  modifiedAt: string;
}

interface SyncFileEntry {
  /** 项目内相对路径（正斜杠） */
  path: string;
  size: number;
  mtime: string;
  sha1: string;
}
```

## 流程

### 推送（push to bundleDir 或对端 device）

1. 用户在 UI 选择源项目集合（默认全部）。
2. fm 生成本地 SyncManifest。
3. 询问对端 manifest（zip 模式无对端，跳过此步）。
4. 在 UI 中展示 diff：
   - 新增（仅本地有）
   - 更新（hash 不同）
   - 一致（隐藏）
   - 反向更新（仅对端较新，提示「忽略 / 改为拉取」）
5. 用户确认后开始打包：每个被选中的项目生成一个 `<slug>.zip` + 写入索引。
6. 写到 bundleDir / 通过 TCP 传给对端。
7. 成功后更新本地 `Project.syncedAt / syncedHash`。

### 拉取（pull from bundleDir 或对端 device）

镜像流程：从 bundleDir 读取索引 / 向对端请求 manifest，比对差异，用户挑选要落地的项目，解包到本地 fm 中相同路径或新建路径。

### zip 导入/导出

- **导出**：选定项目 → 生成单个 `.fm-bundle.zip`，根含 `manifest.json`，每个项目占一个目录。
- **导入**：选择 `.fm-bundle.zip` → 展示 manifest → 用户为每个项目选择「跳过 / 新建（指定根目录） / 覆盖到已有项目」。

### 中转设备

把任意一台经常在线的机器设为中转：

- 启用 `network.relayMode = true` 后，TCP 服务器允许任何认证设备推送 zip 到本机的 `bundleDir`，并在收到时把它合并到本地 manifest 索引中。
- 其他设备启动后从 `bundleDir`（如挂载到本地）或直接通过 TCP 拉取最新。
- 不做认证 token，仅基于「连接对端必须在本机已知设备列表中」的简单白名单（首次握手时显示「接受新设备」对话框）。

## 文件布局

`bundleDir/`：

```
bundleDir/
  index.json                    # 顶级索引：{ schema, devices, latest: { [projectId]: { device, slug, hash, mtime } } }
  devices/
    dev_xxxxxx/
      manifest.json             # 该设备最新一次推送的 manifest
      projects/
        <slug>.zip              # 单项目 zip：内含 .fm-meta.json + 项目原始文件
```

zip 包结构 `<slug>.zip`：

```
.fm-meta.json                   # 单项目 manifest entry（含 hash、files）
files/
  <项目原始内容>
```

## TCP 协议（P2P / 中转）

行分隔 JSON 帧：每帧 = 一行 JSON，二进制载荷紧随其后并以 `Content-Length` 字段约定字节数。

```
HELLO    { device: { id, name }, version: 'fm.sync/v1' }
LIST     -> 服务端返回当前 manifest（同 SyncManifest）
GET id   -> 服务端按项目 ID 返回 BUNDLE { len } + zip bytes
PUT id   { len, manifestEntry } + zip bytes -> 服务端写入 bundleDir 并更新 index
BYE
```

第一次握手收到未知设备时，UI 弹窗确认是否加入白名单，加入后写入 `devices.known`。

## 失败与回滚

- zip 写入：先写 `.zip.tmp` 再 rename。
- index.json：原子写入；同时写一份 `.bak`。
- 拉取：解包到 `.tmp/` 子目录，确认 hash 后再 rename 替换；失败保留 `.tmp/` 不污染主目录。
- 上述任一步失败均向 UI 抛 `FmError`，不做静默重试。

## 安全限度

M2 不实现端到端加密。文档中明确：网络传输基于本地局域网或用户信任的中转设备；如经公网请使用 VPN。

## 不实现（留 M3+）

- 增量补丁（rsync 风格）：当前每个项目变化即整包传输。
- 实时观察文件变更：手动触发即可满足个人开发场景。
- 多人协作合并：fm 是单人工具。
