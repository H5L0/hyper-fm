# 数据模型

## 文件布局

```text
fm.shared.json                    # 共享配置：项目身份、标签、公共忽略规则
fm.local.json                     # 本地配置：扫描根、路径绑定、UI、warning、同步设置
<project-root>/.meta-data         # 项目自描述（可选，JSON）
```

设计目标是把“跨设备稳定的项目身份”和“当前机器上的实际路径”拆开：

- `shared` 关注 **这个项目是谁**。
- `local` 关注 **这个项目在这台机器上在哪里**。

## `fm.shared.json`

```jsonc
{
  "version": 2,
  "ignore": {
    "respectGitignore": true,
    "globs": ["node_modules", ".git", "dist", "build", ".cache", ".venv"]
  },
  "tags": [
    { "name": "unity", "color": "#a78bfa" },
    { "name": "electron", "color": "#60a5fa" }
  ],
  "projects": [
    {
      "id": "pj-2f3a9c",
      "name": "MyGame",
      "description": "Unity 小游戏原型",
      "tags": ["unity", "prototype"],
      "fingerprint": { "kind": "metadata" }
    }
  ]
}
```

### 字段说明

- `version`：当前 schema 版本，现为 `2`。
- `ignore`：全局忽略规则，会参与扫描过滤。
- `tags`：标签注册表，记录标签名与颜色。
- `projects`：共享项目定义，不包含本机路径。

### `projects[].id`

- 格式：`pj-xxxxxx`
- 只作为逻辑项目 ID 使用。
- 不再兼容旧的 `prj_*` 前缀。

### `projects[].fingerprint`

项目身份锚点，三选一：

```ts
type ProjectFingerprint =
  | { kind: 'metadata' }
  | { kind: 'folder-name'; folderName: string }
  | { kind: 'file-paths'; paths: string[] };
```

含义如下：

| 类型 | 含义 | 适用场景 |
|------|------|----------|
| `metadata` | 使用 `.meta-data.projectId` 作为稳定身份 | 最稳，推荐 |
| `folder-name` | 使用目录名识别 | 小型项目、命名稳定时 |
| `file-paths` | 使用一组相对文件路径识别 | 没有 metadata、但目录结构稳定时 |

## `fm.local.json`

```jsonc
{
  "version": 2,
  "scanRoots": [
    {
      "id": "root_a1b2c3",
      "path": "D:/projects",
      "label": "主代码盘",
      "maxDepth": 3,
      "enabled": true
    }
  ],
  "bindings": [
    {
      "projectId": "pj-2f3a9c",
      "id": "pj-2f3a9c",
      "path": "D:/projects/MyGame",
      "rootId": "root_a1b2c3",
      "hasMetaFile": true,
      "lastScannedAt": "2026-04-27T12:34:56Z",
      "lastModifiedAt": "2026-04-26T08:00:00Z"
    }
  ],
  "warnings": [
    {
      "id": "warn_ab12cd",
      "kind": "fingerprint-conflict",
      "scanRootId": "root_a1b2c3",
      "projectId": "pj-2f3a9c",
      "projectName": "MyGame",
      "fingerprint": { "kind": "folder-name", "folderName": "MyGame" },
      "candidatePaths": ["D:/projects/MyGame", "D:/backup/MyGame"],
      "message": "扫描发现多个候选目录命中同一指纹",
      "createdAt": "2026-04-27T12:40:00Z"
    }
  ],
  "ignoredPaths": ["D:/projects/archive/old-demo"],
  "ui": {
    "theme": "system",
    "view": "grid"
  }
}
```

### 字段说明

- `scanRoots`：当前机器会扫描哪些根目录。
- `bindings`：共享项目 ID 与本机真实路径的绑定关系。
- `warnings`：扫描期发现的告警，目前主要是指纹冲突。
- `ignoredPaths`：本机明确忽略的具体目录路径。
- `ui`：当前机器的显示偏好。
- `devices` / `sync` / `commands`：分别用于 M2 同步与 M3 自定义命令。

## 运行时聚合 `AppConfig`

renderer 侧消费的是聚合视图：

- `AppConfig.projects = shared.projects + local.bindings` 按 `projectId` 合并。
- `AppConfig.tags` 来自 shared。
- `AppConfig.scanRoots / warnings / ignoredPaths / ui / sync / commands` 来自 local。

因此 UI 不需要直接理解 shared/local 两层存储细节，但主进程写盘时必须拆回两份配置。

## `.meta-data`

```jsonc
{
  "schema": "fm.meta/v1",
  "projectId": "pj-2f3a9c",
  "name": "MyGame",
  "description": "Unity 小游戏原型",
  "tags": ["unity", "prototype"],
  "ignore": ["Build/", "Logs/"]
}
```

### 字段说明

- `projectId`：仅在 `metadata` 指纹或已写入身份时使用，是最稳定的跨机识别方式。
- `name` / `description` / `tags`：项目自描述。
- `ignore`：项目级附加忽略规则。

## 合并规则

### 项目展示字段

| 字段 | 来源 |
|------|------|
| `id` | `shared.projects[].id` |
| `path` | `local.bindings[].path` |
| `name` | `.meta-data.name` ?? `shared.name` ?? 目录名 |
| `description` | `.meta-data.description` ?? `shared.description` |
| `tags` | `.meta-data.tags` ?? `shared.tags` |
| `hasMetaFile` | `local.bindings[].hasMetaFile` |

### 忽略规则

扫描时使用下列规则的并集：

1. `shared.ignore.globs`
2. `.meta-data.ignore`
3. `local.ignoredPaths`（精确路径忽略，优先级最高）

## 扫描规则

### 1. 扫描只做匹配

扫描器会发现候选目录，但不会自动创建 shared 项目。只有手动添加操作才会新增 `shared.projects[]`。

### 2. 匹配成功才更新 binding

若候选目录与某个现有项目指纹唯一匹配：

- 更新或创建本地 `binding`
- 刷新 `lastScannedAt`
- 刷新 `hasMetaFile`

### 3. 指纹冲突生成 warning

若扫描时发生任意指纹冲突：

- 不写入 `binding`
- 写入 `warnings[]`
- 由 UI 提供“加入忽略名单后重扫”或“修复后重扫”入口

### 4. 手动添加必须先过校验

手动添加项目时，若新指纹与已有项目冲突：

- `validateNew()` 返回 `valid = false`
- UI 禁用“添加”按钮
- 用户需改用其他指纹类型或调整目录结构

## 不变量与校验

- 所有路径统一保存为正斜杠绝对路径。
- `scanRoots[].path` 必须是绝对路径。
- `shared.projects[].id` 在 shared 配置内唯一。
- `tags[].name` 在 shared 配置内唯一。
- `bindings[].projectId` 在 local 配置内唯一。
- `bindings[].path` 在 local 配置内唯一。
- `warnings[]` 仅描述可恢复问题，不自动修复。
- 写配置时走原子替换，避免崩溃造成损坏。
