# M2 同步设计

M2 在 M1 基础上引入跨机同步。当前数据模型已经为同步做了关键铺垫：

- `shared` 保存稳定的项目身份（`projectId` + 指纹 + 标签/描述）
- `local` 保存每台机器自己的路径绑定与同步状态

这意味着：**同步的逻辑主键是 `projectId`，不是路径。** 路径只在本地机器上有意义。

## 设计原则

- **零服务器**：核心传输是设备直连或经用户自管中转目录/设备，不依赖 fm 官方服务。
- **手动触发**：不做自动同步与后台守护。
- **冲突显式展示**：传输前先比对差异，用户决定推送或拉取。
- **可携带**：zip 与 bundle 都是自描述格式。
- **路径本地化**：同步协议永远不假设两台机器上有相同目录结构。

## 为什么 shared/local 拆分对同步重要

旧模型把路径直接塞进项目主记录里，会让以下场景很别扭：

- 台式机路径是 `D:/projects/fm`
- 笔记本路径是 `E:/code/fm`
- 两边其实是同一个项目，但路径不同

现在通过：

- `SharedProject.id = pj-xxxxxx`
- `LocalConfig.bindings[].path = 当前机器路径`

可以稳定地表达“同一个项目，在不同机器上有不同落点”。

## 同步范围

同步范围包括：

1. shared 项目元数据
   - `projectId`
   - `name`
   - `description`
   - `tags`
   - `fingerprint`
2. 项目目录内容
3. 可选 `.meta-data`
4. 设备级状态（只保留在本地，不跨设备覆盖）

不跨设备共享的内容：

- `scanRoots`
- 本机 `bindings[].path`
- `warnings`
- `ignoredPaths`
- `ui`
- 本机监听端口、bundleDir 等本地偏好

## 数据模型扩展

### `LocalConfig.devices`

```ts
{
  selfId: 'dev_xxxxxx',
  selfName: 'My Laptop',
  known: [
    { id: 'dev_yyyyyy', name: 'Desktop', lastSeenAt: '2026-04-27T12:34:56Z' }
  ]
}
```

### `LocalConfig.sync`

```ts
{
  bundleDir?: string,
  network?: {
    listenPort: number,
    autoStart: boolean,
    relayMode: boolean
  }
}
```

### `LocalConfig.bindings[]` 中的同步状态

```ts
{
  projectId: 'pj-abc123',
  path: 'D:/projects/fm',
  syncedAt?: '2026-04-27T12:34:56Z',
  syncedHash?: 'sha1:...',
  syncedFrom?: 'dev_xxxxxx'
}
```

这些字段是**本机观察结果**，不应回写到 shared。

## SyncManifest

每次推送、拉取、导出、导入都围绕统一 manifest 运作：

```ts
interface SyncManifest {
  schema: 'fm.sync/v1';
  generatedAt: string;
  device: { id: string; name: string };
  projects: SyncProjectEntry[];
}

interface SyncProjectEntry {
  id: string;              // shared projectId（pj-xxxxxx）
  slug: string;            // 传输层目录/zip 名，避免重名
  meta: {
    name: string;
    description?: string;
    tags: string[];
    fingerprint: ProjectFingerprint;
  };
  files: SyncFileEntry[];
  hash: string;
  modifiedAt: string;
}
```

## 指纹与同步的关系

同步时 projectId 是第一主键，但指纹仍然重要：

- `metadata`：导入到新机器后最容易自动重新识别
- `folder-name`：适合简单项目，但易发生重名冲突
- `file-paths`：适合无 metadata 项目，可作为补充识别锚点

当用户把 zip 导入到一台新机器时：

1. 若目标目录已有同 `projectId` 绑定，可视为同项目更新。
2. 若没有绑定，但目录匹配某项目指纹，可提示建立绑定。
3. 若出现指纹冲突，则应阻止静默绑定，由用户手动选择。

## 推送流程

1. 用户选择要推送的项目（按 `projectId`）。
2. 系统读取本机 `bindings`，找到真实路径。
3. 生成本地 `SyncManifest`。
4. 与对端 manifest 或 bundleDir 索引比较差异。
5. UI 展示：
   - 仅本地有
   - hash 不同
   - 对端较新
6. 用户确认后打包并推送。
7. 成功后更新本机 binding 中的 `syncedAt / syncedHash`。

## 拉取流程

1. 从 bundleDir、zip 或 TCP 对端读取 manifest。
2. 用户为每个项目选择：
   - 跳过
   - 新建到某路径
   - 覆盖已有本地绑定路径
3. 解包到目标目录的临时路径。
4. 校验 hash。
5. 成功后建立或更新本机 binding。

注意：拉取流程里“目标路径”是用户在本机决定的，而不是从远端硬搬路径。

## bundleDir 布局

```text
bundleDir/
  index.json
  devices/
    dev_xxxxxx/
      manifest.json
      projects/
        <slug>.zip
```

## zip 包结构

```text
manifest.json                  # 整包 manifest（导出多个项目时）
projects/
  <slug>/
    .fm-meta.json              # 单项目 manifest entry
    files/
      <项目原始内容>
```

## TCP 协议（P2P / 中转）

仍采用行分隔 JSON 帧 + 二进制载荷：

```text
HELLO    { device: { id, name }, version: 'fm.sync/v1' }
LIST     -> 返回 SyncManifest
GET id   -> 返回 BUNDLE { len } + zip bytes
PUT id   { len, manifestEntry } + zip bytes
BYE
```

首次连接未知设备时，应让用户决定是否加入 `devices.known`。

## 失败与回滚

- zip：先写 `.tmp` 再 rename。
- `index.json`：原子写入，并保留 `.bak`。
- 拉取解包：先落到临时目录，hash 校验通过后再替换。
- 建立本地 binding 前若发现指纹冲突，应停止自动落地。

## 不实现（留 M3+）

- 增量补丁（rsync 风格）
- 实时监听文件系统变化
- 多人协作合并
- 自动同步冲突裁决
