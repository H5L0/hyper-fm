# Electron Template

一个最小化的 Electron + React + Vite + TypeScript 模板，开箱即用提供：

- 主进程 / preload / renderer 三层骨架
- 严格模式 TypeScript 与 ESM 配置
- 基于 `window.app` + `ipcMain.handle('app:*', ...)` 的受控 IPC 通道
- 共享日志模块（`src/shared/logger.ts`，环境变量 `APP_LOG_LEVEL` 控制）
- Vite 开发服务器与 Electron 联动启动

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 严格模式 |
| 桌面端 | Electron |
| 渲染层 | React + Vite |
| 测试 | Vitest |

## 目录结构

```text
src/
  main/        # Electron 主进程入口与 IPC 处理
  preload/     # contextBridge 受控桥接
  renderer/    # React 前端
    index.html
    src/
  shared/      # 跨进程共享代码（logger、bridge 类型契约等）
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式

```bash
npm run dev
```

该命令会先编译主进程与 preload，然后并行启动 Vite dev server 与 Electron。

### 3. 仅启动 Vite

```bash
npm run dev:renderer
```

### 4. 构建

```bash
npm run build
```

### 5. 启动已构建产物

```bash
npm run start
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_DEV_SERVER_URL` | 主进程优先加载该 URL 而非本地文件，由 `dev` 脚本自动设置 |
| `APP_LOG_LEVEL` | 控制 `createLogger` 输出级别，默认 `info` |

## IPC 约定

| 通道 | 方法 | 说明 |
|------|------|------|
| `app:get-info` | invoke | 返回 `AppInfo`（应用名、版本、平台、Electron 版本） |
| `app:ping` | invoke | 回送一段消息，用于演示双向通信 |

renderer 中通过 `window.app.getAppInfo()` / `window.app.ping(msg)` 调用，类型由 `src/shared/bridge.ts` 中的 `AppBridge` 提供。

## 测试

```bash
npm test
npm run test:watch
npm run test:coverage
```
