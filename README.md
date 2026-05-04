# fm

`fm` 是一个面向个人开发者的 **项目文件夹管理器**：把散落在不同硬盘、不同工作目录里的项目整理到同一个视图中，并通过 `.meta-data` 与双配置文件机制，在“可同步的项目身份”与“仅属于本机的路径信息”之间做好分层。

> 基于 Electron + React + Vite + TypeScript 的桌面应用。现在它已经不只是模板了，是真开始管项目了。

## 核心特性

- **shared / local 双配置**：
  - `fm.shared.json` 保存可跨机器共享的项目身份、标签注册表与公共忽略规则。
  - `fm.local.json` 保存当前机器的扫描根、本地路径绑定、UI 偏好、扫描告警与同步设置。
- **项目指纹**：手动添加项目时可选择三种身份锚点：
  - `metadata`：使用项目根 `.meta-data.projectId`
  - `folder-name`：使用文件夹名
  - `file-paths`：使用所选相对文件路径集合
- **扫描只做匹配，不自动新增**：扫描器只会尝试把候选目录匹配到已有 shared 项目；未登记项目不会被悄悄塞进数据库。
- **冲突可见化**：若扫描发现任意指纹冲突，不会写入本地绑定，而是生成 warning，供用户在设置面板中处理。
- **`.meta-data` 优先**：项目根可携带自描述信息，便于迁移与跨机器识别。
- **轻量 UI**：优先用结构与间距表达信息，避免堆叠显而易见的 note 与多余卡片包裹，保持界面简洁直接。

详细设计见 [docs/](docs/README.md)。

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 严格模式 |
| 桌面端 | Electron |
| 渲染层 | React + Vite + Tailwind v4 + shadcn |
| 测试 | Vitest |

## 目录结构

```text
src/
  main/        # Electron 主进程：配置、会话、匹配、扫描、IPC、同步
    config-store.ts      meta-file.ts         project-repo.ts
    project-matcher.ts   scanner.ts           ignore-matcher.ts
    session.ts           ipc.ts               fm-error.ts
  preload/     # contextBridge：window.app + window.fm
  renderer/    # React 前端
    src/
      components/ # Sidebar / Toolbar / ProjectGrid / Drawer / Settings / ...
      store/      # 全局状态（useReducer + Context）
  shared/      # 跨进程共享：types / schema / bridge / id / path-utils / logger

docs/          # 架构、数据模型、IPC、同步设计、路线图
```

## 快速开始

```bash
npm install
npm run dev
```

常用脚本：

```bash
npm run dev:renderer
npm run build
npm run start
npm run typecheck
npm test
```

## 默认配置文件

首启时，主进程会在可执行文件同级（开发模式下为当前工作目录）创建：

- `fm.shared.json`
- `fm.local.json`

在设置页中可以切换或新建 shared 配置路径；local 配置路径会自动推导到同目录下的 `fm.local.json`。

## 配置文件简介

### `fm.shared.json`

```jsonc
{
  "version": 2,
  "ignore": {
    "respectGitignore": true,
    "globs": ["node_modules", ".git", "dist"]
  },
  "tags": [
    { "name": "electron", "color": "#60a5fa" },
    { "name": "tooling", "color": "#34d399" }
  ],
  "projects": [
    {
      "id": "pj-1a2b3c",
      "name": "fm",
      "description": "项目文件夹管理器",
      "tags": ["electron", "tooling"],
      "fingerprint": { "kind": "metadata" }
    }
  ]
}
```

### `fm.local.json`

```jsonc
{
  "version": 2,
  "scanRoots": [
    {
      "id": "root_ab12cd",
      "path": "D:/projects",
      "label": "主代码盘",
      "maxDepth": 3,
      "enabled": true
    }
  ],
  "bindings": [
    {
      "projectId": "pj-1a2b3c",
      "id": "pj-1a2b3c",
      "path": "D:/projects/fm",
      "rootId": "root_ab12cd",
      "hasMetaFile": true,
      "lastScannedAt": "2026-04-27T12:34:56Z"
    }
  ],
  "warnings": [],
  "ignoredPaths": [],
  "ui": { "theme": "system", "view": "grid" }
}
```

### 项目根 `.meta-data`

```jsonc
{
  "schema": "fm.meta/v1",
  "projectId": "pj-1a2b3c",
  "name": "fm",
  "description": "项目文件夹管理器",
  "tags": ["electron", "tooling"]
}
```

更多字段与合并规则见 [docs/02-data-model.md](docs/02-data-model.md)。

## 扫描与手动添加规则

- 扫描阶段只匹配已有 shared 项目，不会自动新增。
- 若候选目录命中多个相同指纹，或一个指纹对应多个候选目录：
  - 不写入本地绑定。
  - 生成 warning，显示在设置页的“扫描告警”区域。
  - 用户可选择“加入忽略名单后重扫”或“修复后重扫”。
- 手动添加项目时：
  - 会先检查目录、已有 `.meta-data` 与可选文件列表。
  - 若所选指纹与现有项目冲突，添加按钮会被禁用。

## IPC 通道概览

| 命名空间 | 说明 |
|----------|------|
| `app:*` | 模板基础能力：应用信息、ping |
| `fm:config:*` | shared/local 配置加载、创建、保存、选择 |
| `fm:scanRoots:*` | 扫描根管理 |
| `fm:scan:*` | 触发扫描、忽略冲突目录、推送扫描进度 |
| `fm:projects:*` | 项目查询、目录检查、手动添加、`.meta-data` 写入与删除 |
| `fm:tags:*` | 标签注册表维护 |
| `fm:sync:*` | M2 同步设置、diff、push/pull、zip 导入导出、TCP 服务 |
| `fm:commands:*` | M3 自定义命令 |

renderer 通过 `window.fm.*` 调用，类型定义位于 `src/shared/bridge.ts`。完整契约见 [docs/03-ipc-contract.md](docs/03-ipc-contract.md)。

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_DEV_SERVER_URL` | 主进程优先加载该 URL，而非本地文件；由 `dev` 脚本自动设置 |
| `APP_LOG_LEVEL` | 控制 `createLogger` 输出级别，默认 `info` |

## 测试

```bash
npm test
npm run test:watch
npm run test:coverage
```
