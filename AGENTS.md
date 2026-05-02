# Workspace Instructions

本文件用于规范 AI 代理在本仓库中的默认行为。

## 项目信息

本项目（fm）是一个面向个人开发者的 **项目文件夹管理器**：扫描散落硬盘的项目目录，按标签整理；支持项目根 `.meta-data` 自描述与 JSON 配置文件双轨持久化。基于 Electron + React + Vite + TypeScript。

### 环境约束

- 运行时：Node.js >= 22，ESM（package.json: type=module）。
- 语言：TypeScript 严格模式（strict 与 noUnused 系列规则开启）。
- UI：Electron + React + Vite + Tailwind v4 + shadcn（base-ui）。
- 调用指令前使用 `eval "$(fnm env --shell bash)" && fnm use 22` 确保 Node 版本正确。

### 主要模块

- 主进程：`src/main/`
  - `config-store.ts`：shared/local 双配置原子读写
  - `meta-file.ts`：项目根 `.meta-data` 读写
  - `scanner.ts` + `ignore-matcher.ts`：递归扫描与忽略规则
  - `project-matcher.ts`：项目目录检查、指纹匹配、冲突检测
  - `project-repo.ts`：共享项目与本地 binding 合并、标签/扫描根操作
  - `session.ts`：当前已加载配置 + 串行写盘
  - `ipc.ts`：`fm:*` IPC 通道
  - `fm-error.ts`：跨进程错误结构
  - `index.ts`：Electron 启动
- 预加载层：`src/preload/`（暴露 `window.app` 与 `window.fm`）
- 渲染层：`src/renderer/`
  - `src/store/app-store.tsx`：全局状态（useReducer + Context）
  - `src/components/`：AppShell / Sidebar / Toolbar / ProjectGrid / ProjectDrawer / SettingsPanel / Toaster / ThemeEffect / TitleBar
- 共享代码：`src/shared/`（types / schema / bridge / id / path-utils / logger）
- 文档：`docs/`（01-overview / 02-data-model / 03-ipc-contract / 04-ui-design / 05-roadmap）

### 数据模型要点

- **配置文件**：默认拆为 `fm.shared.json` 与 `fm.local.json`；用户在「设置」中切换 shared 配置，local 路径自动推导到同目录。
- **优先级**：项目根 `.meta-data` 优先，shared 项目元数据兜底，本地配置只保存路径与设备相关信息。
- **项目身份**：项目 ID 使用 `pj-xxxxxx`；项目通过 `metadata` / `folder-name` / `file-paths` 三种指纹之一识别。
- **扫描规则**：扫描只做匹配，不新增项目；冲突写入 local warnings，并允许用户忽略具体目录后重扫。
- **标签**：标签为轻量字符串，颜色与显示在 `AppConfig.tags` 注册表（`TagDefinition: name + color`）中维护。
- **路径**：内部统一存为正斜杠绝对路径。

### 更多信息

- 编译命令：`npm run build`
- 类型检查：`npm run typecheck`
- 测试命令：`npm run test`

如有必要可阅读 `README.md` 获取更多信息。

## 工作原则

- 跨进程共用的逻辑、类型、常量统一放在 `src/shared/`，避免 main/preload/renderer 重复实现。
- 当用户要求修改代码而源文件处于混乱修改状态时，应先厘清用户意图，再决定修改范围。
- 每次修改功能后，应该运行相关测试，并在必要时补充测试。
- **如果项目信息、目录结构和开发规范发生变化，应该及时更新此 AGENTS.md 文件和 README.md 文件。**

## 开发规范

### 编码风格

- 使用 ESM import/export，禁止引入 CommonJS 风格写法。
- 命名约定：
  - 类型、类：PascalCase
  - 变量、函数：camelCase
  - 常量：UPPER_SNAKE_CASE（仅用于真正常量）
- Windows 环境下优先使用 `path.resolve/path.join`，避免手写分隔符路径。
- 当一个文件内容较多时，按如下分割符划分：

```
// ---------------------------------------------------------------------------
// 区块名称
// ---------------------------------------------------------------------------
```

### 模块边界规范

- 渲染层不直接访问 Node 高危 API，统一经由 preload 暴露的受控接口（`window.app`）。
- 主进程通过 `ipcMain.handle` 注册 `app:*` 命名空间下的 IPC 通道。
- preload 通过 `contextBridge.exposeInMainWorld('app', ...)` 暴露符合 `AppBridge` 接口的对象。
- 跨进程类型契约统一定义在 `src/shared/bridge.ts`。

### 错误处理

- 不吞异常，要么抛出可定位错误，要么返回结构化错误对象。
- 可恢复错误优先展示到界面，不静默失败。

### 字体与排版规范

- 全站统一 Geist 字体（含 `font-mono`），不再引入额外等宽字体。
- 在 `src/renderer/index.css` 通过 `@layer components` 暴露语义化字号 token，UI 中**禁止使用 `text-xs`/`text-sm` 或 `text-[13px]` 之类的硬编码**：
  - `text-display`：20px / 600，页面级大标题（如「设置」）
  - `text-title`：18px / 600，重要标题
  - `text-heading`：16px / 600，区块标题（如设置组名）
  - `text-subheading`：13px / 500，小标题、表单字段标签
  - `text-body`：14px / 400，正文（默认）
  - `text-note`：13px / 400，次要说明、路径、时间等灰色备注
  - `text-caption`：12px / 400，徽标、计数等紧凑信息
- 基础字号通过 `body` 上的 `text-sm`（14px）控制，`html` 不动以保持 `1rem = 16px`。
- 按钮在 `default/xs/sm/lg` 尺寸下使用 `pt-0.5` 矫正 Geist 视觉居中。

### 日志

- 统一使用 `src/shared/logger.ts` 提供的 `createLogger(scope)`。
- 通过环境变量 `APP_LOG_LEVEL` 控制最低输出级别（`debug` / `info` / `warn` / `error`）。

### 测试规范

- 修改功能后应该及时补充或更新对应测试文件。
- 测试用中文描述且统一格式：
  - `describe` 格式：类名（如果没有则用功能简称）
  - `test` 格式：[函数名（或功能描述）] 什么情况应该如何。
- 单元测试与源码同级放置，例如：`src/shared/logger.ts => src/shared/logger.test.ts`。
