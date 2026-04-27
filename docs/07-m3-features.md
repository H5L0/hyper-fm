# M3 功能

M3 在 M2 基础上加入「项目操作集成」与「元数据搜索增强」。

## 项目操作 / 命令

### 预设命令

由 fm 内建，所有项目通用：

| ID | 名称 | 行为 |
|----|------|------|
| `open.vscode` | 在 VS Code 中打开 | 调用 `code <path>`（依赖 PATH） |
| `open.explorer` | 在资源管理器中显示 | `shell.openPath(path)`（M1 已有） |
| `open.terminal` | 在终端中打开 | Win 下启动 `wt -d <path>` 失败回落到 `cmd /K cd <path>`；mac 下用 `open -a Terminal <path>`；linux 用 `x-terminal-emulator` |
| `copy.path` | 复制路径 | 复制规范化后的绝对路径 |
| `copy.name` | 复制名称 | 复制 `Project.name` |

### 自定义命令

存于 `AppConfig.commands`：

```ts
interface CustomCommand {
  id: string;            // cmd_xxxxxx
  label: string;         // 显示名
  command: string;       // shell 命令模板
  args?: string[];       // 参数模板（与 command 二选一传入 spawn）
  cwd?: 'project' | 'parent';  // 工作目录
  // 占位符替换：{{path}} {{name}} {{tag:foo}} {{category}}
}
```

执行：通过 `child_process.spawn` 启动，detach 后让命令独立运行；命令输出不展示（适合启动 IDE/工具，不适合长输出）。

### UI 入口

- 项目卡片右键菜单 / 详情抽屉中显示：内建命令固定排前，自定义命令按配置顺序追加。
- 设置页新增「命令」节点，可增删自定义命令。

## 元数据搜索增强

M1 已有简单 `includes` 搜索。M3 升级：

- **匹配位置高亮**：在卡片/列表中对命中的字段（名称/描述/标签/路径）下划线或加粗高亮匹配子串。
- **多关键字 AND**：以空格切分，全部命中才算匹配；以 `tag:foo` / `cat:bar` / `path:xxx` 形式做字段限定。
- **匹配解释**：详情抽屉顶部显示「在 描述 + 标签 中匹配 'xxx'」让用户知道为何被选中。
- **不做全文索引**：项目内文件不读取。

## 数据模型增量

```ts
interface AppConfig {
  // ... 原有字段
  devices?: DeviceRegistry;       // M2
  sync?: SyncSettings;            // M2
  commands?: CustomCommand[];     // M3
}
```

## 实施顺序

1. 共享类型扩展（devices / sync / commands）。
2. 主进程：snapshot/diff/打包/解包 → zip 导入导出能跑通。
3. 主进程：bundleDir 读写 + 推/拉 + index.json。
4. 主进程：TCP 协议（可选启动）。
5. 主进程：命令执行（spawn + 占位符）。
6. IPC + preload 暴露。
7. UI：同步面板、命令菜单、搜索高亮。
