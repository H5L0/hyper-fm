# Workspace Instructions

本文件用于规范 AI 代理在本仓库中的默认行为。

## 文档汇总

- `README.md`：面向普通用户，包括软件简介、使用方式、下载入口与贡献说明。
- `AGENTS.md`：面向 AI 代理、维护者与贡献者，包含开发规范、验证流程。
- `docs/development.md`：面向维护者与贡献者，着重记录项目设计和实现，例如数据模型、架构与模块、同步细节。

**当用户可见行为、开发规则、目录结构、配置结构或文档分工发生变化时，应同步更新对应文档。**

## 项目信息

本项目（`fm`）是一个项目文件夹管理器，基于 Electron + React + Vite + TypeScript 构建。
它负责扫描和整理本机项目目录、维护项目元数据、管理标签与本地绑定，并为多设备同步提供稳定的数据基础。

### 环境约束

- 运行时：Node.js >= 22，ESM（package.json: type=module）。
- 语言：TypeScript 严格模式（strict 与 noUnused 系列规则开启）。
- UI：Electron + React + Vite + Tailwind v4 + shadcn（base-ui）。

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 Electron + Vite 开发环境 |
| `npm run dev:renderer` | 单独启动渲染层开发服务器 |
| `npm run build` | 构建主进程、preload 与渲染层 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |
| `npm run test` | 运行 Vitest 测试 |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run test:coverage` | 生成测试覆盖率 |
| `npm run release:win` | 生成 Windows 打包产物 |
| `npm run start` | 以构建后的入口启动 Electron |

## 目录与模块

项目四层结构：

| 路径 | 职责 |
|------|------|
| `src/main/` | 主进程：配置、扫描、同步、文件系统、IPC |
| `src/preload/` | 受控桥接层，向渲染层暴露 `window.app` / `window.fm` |
| `src/renderer/` | React 界面、状态管理、交互逻辑 |
| `src/shared/` | 跨进程共享的类型、schema、桥接契约、工具函数 |

### `src/main/`

- `config-store.ts`：shared/local 双配置原子读写。
- `app-config-store.ts`：通用应用级持久化存储，当前使用用户目录下的 `.fm.json` 保存最近打开配置等偏好。
- `meta-file.ts`：项目根 `.meta-data` 读写。
- `ignore-matcher.ts` + `scanner.ts`：递归扫描与忽略规则。
- `project-matcher.ts`：项目目录检查、指纹匹配、冲突检测。
- `project-repo.ts`：shared 项目与本地 binding 合并、标签/扫描根操作。
- `session.ts`：当前已加载配置与串行写盘会话。
- `ipc.ts`：`app:*` 与 `fm:*` IPC 通道注册。
- `fm-error.ts`：跨进程结构化错误。
- `commands/runner.ts`：自定义命令执行。
- `sync/`：同步相关实现，当前包含：
  - `diff.ts` / `snapshot.ts`：差异与快照计算。
  - `file-sync.ts`：文件同步执行。
  - `dir-bundle.ts` / `zip-bundle.ts`：目录 bundle 与 zip 导入导出。
  - `tcp-transport.ts`：TCP 传输。
  - `preview-session.ts` / `preview-session-codec.ts` / `preview-session-worker.ts`：同步预览会话与 worker。
  - `manager.ts` / `auto-sync.ts` / `device.ts`：同步管理、自动同步与设备信息。

### `src/preload/`

- 负责隔离渲染层与 Node/Electron 高危 API。
- 对外暴露 `window.app` 与 `window.fm`。

### `src/renderer/src/`

- `App.tsx`：应用根组件与页面编排。
- `store/`：全局状态与交互入口。
- `components/ui/`：通用基础控件，主要是 shadcn / base-ui 导入的组件或自行实现的原子控件。
- `components/basic/`：简单且可复用的业务控件，例如 tag、项目表单、抽屉壳、规则编辑器等。
- `components/view/`：页面级或大区域组件，不以高复用为目标，例如项目浏览视图、项目信息面板及其子视图。
- `components/` 根目录：保留未分层迁移完成的业务组件与各类对话框、设置面板等。
- `browser-bridge.ts`：渲染层桥接辅助。

### `src/shared/`

- `bridge.ts`：preload / renderer 的桥接契约。
- `types.ts` / `schema.ts`：核心数据模型与 schema。
- `sync-types.ts` / `sync-config.ts`：同步相关共享类型与配置。
- `id.ts` / `path-utils.ts` / `search.ts` / `logger.ts`：基础工具。

如果一段逻辑会在多个进程复用，优先放到 `src/shared/`，不要在 `main`、`preload`、`renderer` 中重复实现。

## 数据模型要点

- `shared` 关注“这个项目是谁”：项目 ID、名称、标签、描述、指纹、共享忽略规则等。
- `local` 关注“这个项目在这台机器上在哪里”：扫描根、本地路径 binding、warning、ignoredPaths、UI 偏好、同步状态等。
- 默认运行时配置位于工作目录 `.local/` 下的 `fm.shared.json` / `fm.local.json`，不应提交到 Git。
- 最近一次成功打开的 shared 配置路径等应用偏好保存在用户个人目录下的 `.fm.json`，启动时优先恢复。
- 若最近配置和工作目录 `.local/` 下的默认配置都不存在，应用应进入欢迎页等待用户显式打开或创建配置，而不是自动创建文件。
- `.meta-data` 是项目根目录中的自描述文件；存在时，展示层优先使用其中的名称、描述、标签与 `projectId`。
- 项目身份通过 `projectId` + 指纹识别，当前支持：
  - `metadata`
  - `folder-name`
  - `file-paths`
- 扫描只做匹配，不自动新增项目；匹配冲突会写入 warning，而不是静默覆盖。
- 所有内部路径都使用正斜杠绝对路径。

## 开发流程

推荐按下面的顺序工作：

1. 理清用户需求。特别是当源文件处于混乱修改的状态时，应当从用户修改中理清意图再决定修改方向。
2. 构建修改计划，按依赖关系落实为TODO列表。注意判断改动主要落在 `main/preload/renderer/shared` 那一层，在最合适的一层实现改动，避免跨层耦合扩散。
3. 为功能改动补充或更新测试。
4. 运行类型检查、构建与测试。
5. 若改动涉及主进程、桥接、IPC、同步、worker 或文件系统，再启动真实应用手测。
6. 如果用户可见行为、开发规则、配置结构或文档结构发生变化，同步更新 `README.md`、`AGENTS.md` 与 `docs/项目文档.md`。
7. 修改完成后进行自我反思，推断潜在问题和可优化点，使用 ask question tool 询问用户继续迭代。

## 核心开发规则

### 模块边界

- 跨进程共用的逻辑、类型、常量统一放在 `src/shared/`，避免 `main` / `preload` / `renderer` 重复实现。
- 渲染层不直接访问 Node 高危 API，统一经由 preload 暴露的受控接口（`window.app` / `window.fm`）。
- 主进程通过 `ipcMain.handle` 注册 IPC 通道；基础模板能力使用 `app:*`，业务能力统一使用 `fm:*`。
- 跨进程类型契约统一定义在 `src/shared/bridge.ts`、`src/shared/types.ts` 与相关 shared 模块中。

### 编码约定

- 使用 ESM `import` / `export`，禁止引入 CommonJS 风格写法。
- 命名约定：
  - 类型、类：PascalCase
  - 变量、函数：camelCase
  - 常量：UPPER_SNAKE_CASE
- 优先使用 `path.resolve` / `path.join`，避免手写分隔符路径。
- 当文件内容较多时，按统一分隔符划分区块：

```
// ---------------------------------------------------------------------------
// 区块名称
// ---------------------------------------------------------------------------
```

### 错误处理

- 不吞异常；要么抛出可定位错误，要么返回结构化错误对象。
- 可恢复错误优先暴露给界面或调用方，不做静默失败。

### UI 约定

- 全站统一 Geist 字体，不使用等宽字体。
- UI 中禁止随意硬编码字号，统一复用 `src/renderer/index.css` 中的语义化字号 token。
- UI 中优先使用 tailwind spacing token（`p-4`、`gap-2` 等）表达间距，避免使用 `px` 等单位直接写死。
- 渲染层组件默认按 `ui / basic / view` 三层组织：原子控件放 `ui/`，可复用小组件放 `basic/`，大界面或大区域放 `view/`。
- 优先使用间距和留白表达结构，避免不必要的层次、卡片包裹、分割线与说明性废话。
- 不添加“显而易见”的 note 文本；若界面结构本身已能表达含义，则不要再重复解释。

### 日志

- 统一使用 `src/shared/logger.ts` 提供的 `createLogger(scope)`。
- 通过环境变量 `APP_LOG_LEVEL` 控制最低输出级别（`debug` / `info` / `warn` / `error`）。

## 测试与验证

- 每次修改功能后，应运行相关测试，并在必要时补充测试。
- 测试用中文描述：`describe` 写类名或功能名，`test` 写“什么情况应该如何”。
- 单元测试与源码同级放置。。

### 默认验证流程

#### 常规改动

至少执行：

1. `npm run typecheck`
2. `npm run build`
3. `npm run test`

#### 底层改动

如果修改涉及Electron 主进程 / preload / IPC / worker / 文件系统监听 / 真实同步链路等功能时，不能只依赖浏览器 mock，应该按照如下流程验证：
  1. 先执行 `npm run typecheck`、`npm run build` 与相关测试。
  2. 再执行 `npm run dev` 启动真实 Electron 应用。
  3. 使用 ask question 工具向用户说明手测步骤，并收集实际操作结果。
  4. 根据用户反馈继续迭代，直到真实应用行为正确为止

## 文档变更检查清单

提交以下变更前需要自查文档是否同步：

- 新增或修改用户可见功能、默认行为、首次使用流程。
- 新增配置项、环境变量、配置文件路径或持久化规则。
- 调整 IPC 通道、桥接接口、同步流程、扫描规则或项目识别策略。
- 调整目录结构、开发命令、测试流程、贡献约定或文档分工。
