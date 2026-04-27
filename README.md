# fm

`fm` 是一个面向个人开发者的 **项目文件夹管理器**：扫描散落硬盘的项目目录，按类型/标签整理，配合 `.meta-data` 自描述文件实现可携带的项目元数据。

> 基于 Electron + React + Vite + TypeScript 的桌面应用模板演化而来。

## 核心特性

- **JSON 即数据库**：所有索引、分类、标签存于一份可读的 `fm.config.json`。
- **`.meta-data` 优先**：项目根目录可放置 `.meta-data` 自描述文件；存在则覆盖 DB 中相应字段。
- **可控扫描**：按预指定的「扫描根 + maxDepth」递归发现项目，自动尊重 `.gitignore` 与全局忽略规则。
- **极简界面**：Linear / Raycast 风格——侧边分类树、卡片网格、详情抽屉、深色支持。

详细设计与路线见 [docs/](docs/README.md)。

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
  main/        # Electron 主进程：会话、配置、扫描、IPC
    config-store.ts   meta-file.ts     project-repo.ts
    scanner.ts        ignore-matcher.ts session.ts
    ipc.ts            fm-error.ts      index.ts
  preload/     # contextBridge：window.app + window.fm
  renderer/    # React 前端
    src/
      components/ # AppShell / Sidebar / Toolbar / ProjectGrid / Drawer / Settings / ...
      store/      # 全局状态（useReducer + Context）
  shared/      # 跨进程共享：types / schema / bridge / id / path-utils / logger

docs/          # 架构、数据模型、IPC 契约、UI 设计、路线图
```

## 快速开始

```bash
npm install

# 开发模式（vite + electron）
npm run dev

# 仅启动 vite 渲染层
npm run dev:renderer

# 构建
npm run build

# 启动构建产物
npm run start
```

首启时，主进程会在可执行文件同级（开发模式下为 cwd）创建默认 `fm.config.json`。在「设置 → 配置文件」中可切换/新建任意路径的配置。

## 配置文件简介

`fm.config.json`：

```jsonc
{
  "version": 1,
  "scanRoots": [{ "id": "root_xxx", "path": "D:/projects", "maxDepth": 3, "enabled": true }],
  "ignore":   { "respectGitignore": true, "globs": ["node_modules", ".git"] },
  "categories": [{ "id": "cat_xxx", "name": "游戏开发", "color": "#a78bfa" }],
  "projects":   [{ "id": "prj_xxx", "path": "D:/projects/Game", "rootId": "root_xxx",
                   "name": "Game", "categoryId": "cat_xxx", "tags": ["unity"],
                   "hasMetaFile": true, "lastScannedAt": "2026-04-27T..." }],
  "ui": { "theme": "system", "view": "grid" }
}
```

项目根 `.meta-data`：

```jsonc
{
  "schema": "fm.meta/v1",
  "name": "Game",
  "category": "游戏开发",
  "description": "Unity 小游戏原型",
  "tags": ["unity", "prototype"]
}
```

详细字段语义见 [docs/02-data-model.md](docs/02-data-model.md)。

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_DEV_SERVER_URL` | 主进程优先加载该 URL 而非本地文件，由 `dev` 脚本自动设置 |
| `APP_LOG_LEVEL` | 控制 `createLogger` 输出级别，默认 `info` |

## IPC 通道概览

| 命名空间 | 说明 |
|----------|------|
| `app:*` | 模板自带：`get-info` / `ping` |
| `fm:config:*` | 配置加载/保存/切换/原生对话框选择 |
| `fm:scanRoots:*` | 扫描根管理 |
| `fm:scan:*` | 触发扫描；进度通过 `fm:scan:progress` 事件推送 |
| `fm:projects:*` | 项目元数据查询/更新；`.meta-data` 写入与删除 |
| `fm:categories:*` | 分类增删改 |

renderer 通过 `window.fm.*` 调用，类型由 `src/shared/bridge.ts` 中的 `FmBridge` 提供。完整契约见 [docs/03-ipc-contract.md](docs/03-ipc-contract.md)。

## 测试

```bash
npm test
npm run test:watch
npm run test:coverage
```

shared 与 main 模块均已覆盖单元测试（共 43 用例）。
