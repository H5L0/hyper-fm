# IPC 契约

renderer 通过 preload 暴露的 `window.fm` 对象与主进程通信。所有通道使用 `fm:*` 命名空间，保留原模板的 `app:*` 通道用于运行时元信息。

## 类型契约（src/shared/bridge.ts）

```ts
export interface FmBridge {
  // ── 配置 ──────────────────────────────────────────────
  config: {
    /** 返回当前已加载配置的路径与内容 */
    current(): Promise<{ path: string; data: AppConfig }>;
    /** 加载指定路径配置（不存在则报错） */
    load(filePath: string): Promise<{ path: string; data: AppConfig }>;
    /** 在指定路径创建一份默认配置 */
    create(filePath: string): Promise<{ path: string; data: AppConfig }>;
    /** 整份覆写当前配置（自动原子替换） */
    save(data: AppConfig): Promise<void>;
    /** 弹原生对话框选择/新建配置文件 */
    pick(mode: 'open' | 'save'): Promise<string | null>;
  };

  // ── 扫描根 ────────────────────────────────────────────
  scanRoots: {
    add(input: { path: string; label?: string; maxDepth?: number }): Promise<ScanRoot>;
    update(id: string, patch: Partial<Omit<ScanRoot, 'id'>>): Promise<ScanRoot>;
    remove(id: string): Promise<void>;
    /** 弹原生目录选择 */
    pickDirectory(): Promise<string | null>;
  };

  // ── 扫描 ──────────────────────────────────────────────
  scan: {
    /** 扫描全部启用的根，返回新增/更新摘要 */
    runAll(): Promise<ScanReport>;
    /** 扫描指定根 */
    runOne(rootId: string): Promise<ScanReport>;
  };

  // ── 项目 ──────────────────────────────────────────────
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<ProjectDetail>;
    /** 仅更新 DB 中的元数据 */
    updateMeta(id: string, patch: ProjectMetaPatch): Promise<Project>;
    /** 将元数据写回 .meta-data，同步更新 DB */
    writeMetaFile(id: string, patch: ProjectMetaPatch): Promise<Project>;
    /** 删除 .meta-data，仅保留 DB 记录 */
    removeMetaFile(id: string): Promise<Project>;
    /** 在系统资源管理器中显示 */
    revealInOs(id: string): Promise<void>;
  };

  // ── 分类 ──────────────────────────────────────────────
  categories: {
    create(input: { name: string; color?: string }): Promise<Category>;
    rename(id: string, name: string): Promise<Category>;
    setColor(id: string, color: string): Promise<Category>;
    remove(id: string): Promise<void>;
  };
}
```

## 通道列表

| 通道 | 方向 | 说明 |
|------|------|------|
| `fm:config:current` | invoke | 返回当前配置 |
| `fm:config:load` | invoke | 加载指定路径 |
| `fm:config:create` | invoke | 创建默认配置 |
| `fm:config:save` | invoke | 写回当前配置 |
| `fm:config:pick` | invoke | 调起 dialog |
| `fm:scanRoots:add/update/remove/pickDirectory` | invoke | 管理扫描根 |
| `fm:scan:runAll` / `fm:scan:runOne` | invoke | 执行扫描 |
| `fm:scan:progress` | event (renderer←main) | 进度推送：`{ rootId, scanned, found }` |
| `fm:projects:list/get/updateMeta/writeMetaFile/removeMetaFile/revealInOs` | invoke | 项目操作 |
| `fm:categories:create/rename/setColor/remove` | invoke | 分类操作 |

## 错误处理

主进程将异常包装为：

```ts
class FmError extends Error {
  code: 'CONFIG_NOT_FOUND' | 'CONFIG_INVALID' | 'PATH_NOT_FOUND' | 'WRITE_FAILED' | 'INTERNAL';
  details?: unknown;
}
```

renderer 在 IPC `catch` 中读取 `error.message` 与（透传的）`code` 字段以决定 UI 表现。
