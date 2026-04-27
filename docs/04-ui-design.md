# UI 设计

风格基调：**Linear / Raycast 极简**。中性灰、细线分隔、克制留白、暗色支持。文字优先、图标辅助；动画轻、过渡 120–180ms。

## 色彩与排版

直接复用 [src/renderer/index.css](../src/renderer/index.css) 中的 shadcn 调色板：`background / foreground / muted / border / accent / primary`。仅需补充：

```css
--fm-shadow-card: 0 1px 0 rgb(0 0 0 / 0.02), 0 1px 2px rgb(0 0 0 / 0.04);
--fm-radius-card: var(--radius-md);
```

字体：Geist Variable（已在模板中），数字使用 tabular-nums。

## 主布局

```
┌──────────────────────────────────────────────────────────────────┐
│ TitleBar  fm  ·  D:/projects/fm.config.json   [选择…]  ⌕  ⚙       │ 36px
├────────────┬─────────────────────────────────────────────────────┤
│ Sidebar    │ Toolbar  [搜索]  [视图▾]  [刷新扫描]                  │ 44px
│            ├─────────────────────────────────────────────────────┤
│ ▸ 全部 42  │                                                     │
│ ▸ 游戏 12  │   ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│ ▸ Node  8  │   │ MyGame  │  │ ApiSrv  │  │ DocsHub │             │
│ ▸ C# 工具5 │   │ #unity  │  │ #node   │  │ #notes  │             │
│ ▸ 文档  6  │   │ 2 天前  │  │ 昨天    │  │ 上月    │             │
│            │   └─────────┘  └─────────┘  └─────────┘             │
│ + 新建分类 │                                                     │
│            │                                                     │
│ ─────────  │                                                     │
│ ⚙ 设置     │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

- **Sidebar** 240px，可折叠到 56px（仅图标）。分类条目右侧显示数量徽标。
- **主区** 默认网格视图（`grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`），可切到密集列表视图。
- **TitleBar** 自定义；右侧固定显示当前配置文件路径，点击可切换/新建。

## 项目卡片（Grid）

```
┌─────────────────────┐
│ ● MyGame            │   左侧 6px 圆点 = 分类色
│ Unity 小游戏原型    │   描述截断 1 行
│ #unity #prototype   │   标签前 3 个 + 余数
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ D:/projects/MyGame  │   路径 + mtime 灰字
│ 2 天前              │
└─────────────────────┘
```

hover 时浮起 + `border-foreground/15`，点击打开右侧抽屉。

## 详情抽屉 / 全屏

第一版采用 **右侧 480px 抽屉**（基于 base-ui Drawer 或自实现 Dialog 变体），保留主区上下文。包含：

1. **基本信息**（名称 / 路径 / 来源根 / 分类下拉 / 描述 textarea）
2. **标签编辑**（tag input，回车添加，退格删除）
3. **元数据来源条**：`已从 .meta-data 加载` / `仅存数据库` 状态徽标
4. **底部操作**：
   - `保存到数据库`（默认 primary）
   - `写入 .meta-data`（secondary）
   - `在资源管理器中显示`（ghost）

## 设置面板

独立路由（侧边栏「⚙ 设置」），垂直分节：

- 配置文件：当前路径、`切换…`、`新建…`
- 扫描根：列表（路径 / 标签 / 深度 / 启用开关 / 删除），底部 `+ 添加`
- 忽略规则：`respectGitignore` 开关 + 全局 globs 文本域
- 主题：light / dark / system

## 状态空间（zustand 风格 store）

```ts
interface AppStore {
  configPath: string;
  config: AppConfig;
  projects: Project[];
  selection: { projectId?: string; categoryId?: string | 'ALL' };
  view: 'grid' | 'list';
  scanProgress?: { rootId: string; scanned: number; found: number };
  // actions
  loadConfig(path?: string): Promise<void>;
  refreshProjects(): Promise<void>;
  runScan(rootId?: string): Promise<void>;
  ...
}
```

## 可访问性 / 交互细节

- 全部交互可键盘操作：`/` 聚焦搜索，`G` 切视图，`R` 触发扫描，`Esc` 关闭抽屉。
- 长路径用 `text-ellipsis` + title。
- 空状态插画用纯文字 + 操作按钮，避免引入图片资源。
