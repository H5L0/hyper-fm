# Workspace Instructions

本文件用于规范 AI 代理在本仓库中的默认行为。

## 项目信息

本项目是一个最小化 Electron + React + Vite + TypeScript 模板，提供主进程 / preload / renderer 三层骨架，以及共享日志模块，可作为新桌面应用的起点。

### 环境约束

- 运行时：Node.js >= 22，ESM（package.json: type=module）。
- 语言：TypeScript 严格模式（strict 与 noUnused 系列规则开启）。
- UI：Electron + React + Vite。
- 调用指令前使用 `eval "$(fnm env --shell bash)" && fnm use 22` 确保 Node 版本正确。

### 主要模块

- 主进程：`src/main/`
- 预加载层：`src/preload/`
- 渲染层：`src/renderer/`
- 共享代码（含日志模块）：`src/shared/`

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

### 日志

- 统一使用 `src/shared/logger.ts` 提供的 `createLogger(scope)`。
- 通过环境变量 `APP_LOG_LEVEL` 控制最低输出级别（`debug` / `info` / `warn` / `error`）。

### 测试规范

- 修改功能后应该及时补充或更新对应测试文件。
- 测试用中文描述且统一格式：
  - `describe` 格式：类名（如果没有则用功能简称）
  - `test` 格式：[函数名（或功能描述）] 什么情况应该如何。
- 单元测试与源码同级放置，例如：`src/shared/logger.ts => src/shared/logger.test.ts`。
