# 数据模型

## 文件布局

```
fm.config.json                     # 全局配置 + 项目数据库（默认与 exe 同级）
<project-root>/.meta-data          # 项目自描述（可选，JSON）
```

## fm.config.json

```jsonc
{
  "version": 1,
  "scanRoots": [
    {
      "id": "root_a1b2",            // 内部 ID
      "path": "D:/projects",        // 绝对路径，统一正斜杠
      "label": "主代码盘",            // 可选展示名
      "maxDepth": 3,                // 递归最大深度（含根 = 1）
      "enabled": true
    }
  ],
  "ignore": {
    "respectGitignore": true,       // 扫描时合并目标目录及其祖先的 .gitignore
    "globs": [                      // 全局额外忽略
      "node_modules", ".git", "dist", "build", ".cache", ".venv"
    ]
  },
  "categories": [
    { "id": "cat_game",  "name": "游戏开发",  "color": "#a78bfa" },
    { "id": "cat_node",  "name": "Node 后端", "color": "#34d399" },
    { "id": "cat_csharp","name": "C# 工具",   "color": "#60a5fa" }
  ],
  "projects": [
    {
      "id": "prj_2f3a",             // 稳定 ID，路径变化时仍可追踪
      "path": "D:/projects/MyGame", // 绝对路径
      "rootId": "root_a1b2",        // 来自哪个扫描根
      "name": "MyGame",             // 可被 .meta-data 覆盖
      "categoryId": "cat_game",     // 可空
      "description": "Unity 小游戏原型",
      "tags": ["unity", "prototype"],
      "hasMetaFile": true,          // 缓存：根目录是否存在 .meta-data
      "lastScannedAt": "2026-04-27T12:34:56Z",
      "lastModifiedAt": "2026-04-26T08:00:00Z" // 目录 mtime 缓存
    }
  ],
  "ui": {
    "theme": "system",              // "light" | "dark" | "system"
    "view": "grid"                  // "grid" | "list"
  }
}
```

### 字段说明要点

- **路径规范化**：所有 `path` 字段统一为正斜杠绝对路径，便于跨平台展示与比较。Windows 上写入磁盘前再视情况转换。
- **ID**：`id` 一律使用短随机串（`{prefix}_{6字符 base36}`），防止重命名/移动后断链。
- **categories.color**：UI 用，供分类徽标着色；可缺省。

## .meta-data（项目自描述）

```jsonc
{
  "schema": "fm.meta/v1",
  "name": "MyGame",
  "category": "游戏开发",            // 按名称匹配 categories[].name；不存在则按需创建
  "description": "Unity 小游戏原型",
  "tags": ["unity", "prototype"],
  "ignore": ["Build/", "Logs/"]    // 可选：项目级补充忽略
}
```

### 合并规则（`.meta-data` 优先）

| 字段 | 来源 |
|------|------|
| `name` | `.meta-data.name` ?? DB.name ?? 目录名 |
| `category` | `.meta-data.category`（按 name 解析为 categoryId）?? DB.categoryId |
| `description` / `tags` | `.meta-data` ?? DB |
| `ignore` | `.meta-data.ignore` 与 `config.ignore.globs` 合集 |

写回时，UI 提供两个动作：
- **保存到数据库**：仅更新 `fm.config.json` 中对应 `projects[]` 项；不触碰文件系统。
- **写入 .meta-data**：在项目根目录创建/更新 `.meta-data`（同时也同步到 DB 作为缓存）。

## 不变量与校验

- `scanRoots[].path` 必须是绝对路径且存在。
- `projects[].path` 在同一配置内必须唯一（key）。
- `categories[].name` 在同一配置内唯一。
- 加载时若 schema `version` 高于当前实现，给出明确错误；低于时按需迁移（M1 仅 v1）。
- 所有写操作走「先写 `.tmp` 再原子替换」，避免崩溃造成损坏。
