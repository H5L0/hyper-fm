# 实施路线（M1）

## 工作分解

按层次自下而上展开，每个里程碑都能独立 typecheck + 单元测试通过。

### 阶段 A：基础与契约

- [ ] **A1** 共享类型：`src/shared/types.ts`（`AppConfig` / `ScanRoot` / `Project` / `Category` / `MetaFile` / `ScanReport`）。
- [ ] **A2** Schema 校验与默认值：`src/shared/schema.ts`（纯函数 `validateConfig`、`createDefaultConfig`）。
- [ ] **A3** 路径与 ID 工具：`src/shared/path-utils.ts`（正斜杠化、相对化）、`src/shared/id.ts`（短 ID 生成）。
- [ ] **A4** 单元测试覆盖 A1–A3。

### 阶段 B：主进程能力

- [ ] **B1** 配置存储：`src/main/config-store.ts` —— 加载/保存/原子替换/默认路径解析（exe 同级 `fm.config.json`）。
- [ ] **B2** 元数据文件 IO：`src/main/meta-file.ts` —— 读 `.meta-data`、写 `.meta-data`、删除。
- [ ] **B3** 扫描器：`src/main/scanner.ts` —— 递归遍历，应用 `.gitignore` 与 globs，返回候选项目；支持深度限制与进度回调。
- [ ] **B4** 项目仓库：`src/main/project-repo.ts` —— 合并 DB 与 `.meta-data`，解析 categoryId，写回。
- [ ] **B5** IPC 注册：`src/main/ipc.ts` 扩展 `fm:*` 通道；统一错误包装为 `FmError`。
- [ ] **B6** 单元测试覆盖 B1–B4（用 tmp 目录）。

### 阶段 C：preload

- [ ] **C1** `src/preload/index.ts` 暴露 `window.fm`，匹配 `FmBridge`。
- [ ] **C2** `src/renderer/src/global.d.ts` 增加 `fm` 全局声明。

### 阶段 D：renderer

- [ ] **D1** 全局 store（轻量 zustand 或自实现 React context + reducer）。
- [ ] **D2** 主布局组件：`AppShell`、`Sidebar`、`Toolbar`、`TitleBar`。
- [ ] **D3** 项目卡片网格 + 列表切换。
- [ ] **D4** 项目详情抽屉（含元数据编辑、写回 `.meta-data` 操作）。
- [ ] **D5** 设置面板（配置切换、扫描根管理、忽略规则、主题）。
- [ ] **D6** 空状态、加载状态、错误 toast。
- [ ] **D7** 键盘快捷键：`/`、`G`、`R`、`Esc`。

### 阶段 E：收尾

- [ ] **E1** 端到端手测脚本（README 对应小节）。
- [ ] **E2** 更新 `README.md`、`AGENTS.md` 反映新结构。
- [ ] **E3** `npm run typecheck && npm test` 全绿。

## 不在 M1 范围

- 跨机同步、冲突合并
- 全文搜索 / README 摘要预览
- 在外部 IDE / 终端中打开
- 暗色主题自动跟随系统时间

它们在 [01-overview.md](01-overview.md) 的 M2/M3 中描述，留下扩展点而非提前实现。

## 风险与对策

| 风险 | 对策 |
|------|------|
| 大量扫描根 / 深度过大导致卡顿 | 主进程异步遍历 + 进度事件；UI 显示 toast |
| `.gitignore` 解析复杂度 | 仅做最小子集（精确匹配 + `*` glob + 目录后缀 `/`），不依赖外部库；后续按需引入 `ignore` 包 |
| 配置文件被外部编辑器同时修改 | 加载时记 mtime；保存前若 mtime 变化弹确认；仍坚持原子替换 |
| Windows 路径大小写 | 路径比较统一 `path.normalize` + 小写比较；存储仍保留原大小写 |
