# fm 文档

`fm` 是一个面向个人开发者的项目文件夹管理器（Electron + React + Vite + TypeScript）。

| 章节 | 内容 |
|------|------|
| [01-overview.md](01-overview.md) | 总览、用户旅程、范围划分、关键决策 |
| [02-data-model.md](02-data-model.md) | `fm.config.json` 与 `.meta-data` 的 schema、合并规则、不变量 |
| [03-ipc-contract.md](03-ipc-contract.md) | `window.fm.*` 与 `fm:*` IPC 通道契约 |
| [04-ui-design.md](04-ui-design.md) | 布局、组件、交互细节、状态空间 |
| [05-roadmap.md](05-roadmap.md) | 实施路线、任务分解、风险 |
| [06-sync-design.md](06-sync-design.md) | M2：zip 导入导出、共享目录、TCP P2P、中转设备 |
| [07-m3-features.md](07-m3-features.md) | M3：预设/自定义命令、元数据搜索增强 |

阅读顺序：01 → 02 → 03 → 04 → 05 → 06 → 07。
