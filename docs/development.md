# 项目文档

本文档记录了这个项目的核心设计与实现细节，包括：

1. 这个项目到底在管理什么数据；
2. 代码是按什么边界组织起来的；
3. 同步设计的原则和实现细节；

## 一、整体认知

`hyper-fm` 是一个桌面端项目文件夹管理器，项目里最重要的不是路径，而是：

- 这个项目是谁；
- 这台机器上它在哪；
- 哪些信息可以跨设备共享；
- 哪些信息必须只留在本机。

因此，这个仓库真正的核心不是文件浏览，而是：

- 项目身份管理
- 本地路径 binding
- `.meta-data` 与配置文件的合并
- 扫描匹配与冲突检测
- 为同步准备稳定的数据基础

## 二、数据模型

### 2.1 文件布局

```text
.local/fm.shared.json     # 默认共享配置：项目身份、标签、共享忽略规则
.local/fm.local.json      # 默认本地配置：扫描根、绑定、warning、UI、本机同步状态
<project-root>/.meta-data # 项目自描述（可选）
```

这套布局的设计目标很直接：把“可跨设备稳定存在的东西”和“只对当前机器有意义的东西”拆开。

默认配置会落在工作目录的 `.local/` 中，避免把运行时配置混进仓库提交；如果用户手动打开了其他共享配置文件，应用会通过 `app-config-store.ts` 把最近一次成功打开的 shared 配置路径写入 Windows 注册表 `HKCU\Software\hyper-fm\Prefs`，并在下次启动时优先恢复，失败后再回退到 `.local/fm.shared.json`。

应用启动时不会在缺少配置的情况下自动创建文件：如果最近打开的 shared 配置存在则优先恢复；否则如果工作目录 `.local/` 下已有默认配置则直接加载；若两者都不存在，则进入欢迎页，由用户显式选择已有配置，或先选一个目录创建 `fm.shared.json` / `fm.local.json`。

- `shared` 关注：**这个项目是谁**
- `local` 关注：**这个项目在这台机器上是什么状态**

### 2.2 `fm.shared.json`

`fm.shared.json` 负责保存稳定且可共享的数据，例如：

- 项目 ID
- 项目名称 / 描述 / 标签
- 项目身份指纹
- 共享忽略规则
- 标签注册表（删除标签时会同步清理项目与标签组中的对应引用）

一个最小化的 mental model 可以理解成：

```jsonc
{
	"version": 2,
	"ignore": {
		"respectGitignore": true,
		"globs": ["node_modules", ".git", "dist"]
	},
	"tags": [
		{ "name": "electron", "color": "#60a5fa" }
	],
	"projects": [
		{
			"id": "pj-1a2b3c",
			"name": "fm",
			"description": "项目文件夹管理器",
			"tags": ["electron"],
			"fingerprint": { "kind": "metadata" }
		}
	]
}
```

这里最重要的是：**shared 里没有“这台机器上的绝对路径”**。

### 2.3 `fm.local.json`

`fm.local.json` 保存本机状态，主要包括：

- `scanRoots`：从哪里开始扫
- `bindings`：`projectId` 和本机真实路径之间的关系
- `warnings`：扫描时遇到的冲突与告警
- `ignoredPaths`：本机明确忽略的目录
- `ui`：当前机器的视图、主题等偏好
- 同步相关本机状态与设备信息

它描述的是“这个 shared 项目在当前设备上长什么样”。

```jsonc
{
	"version": 2,
	"scanRoots": [
		{
			"id": "root_a1b2c3",
			"path": "D:/projects",
			"label": "主代码盘",
			"maxDepth": 3,
			"enabled": true
		}
	],
	"bindings": [
		{
			"projectId": "pj-1a2b3c",
			"id": "pj-1a2b3c",
			"path": "D:/projects/fm",
			"rootId": "root_a1b2c3",
			"hasMetaFile": true,
			"lastScannedAt": "2026-04-27T12:34:56Z"
		}
	],
	"warnings": [],
	"ignoredPaths": [],
	"ui": {
		"theme": "system",
		"view": "grid"
	}
}
```

### 2.4 `.meta-data`

项目根目录中的 `.meta-data` 是目录自描述文件，用来表达“这个项目自己怎么介绍自己”。

```jsonc
{
	"schema": "fm.meta/v1",
	"projectId": "pj-1a2b3c",
	"name": "fm",
	"description": "项目文件夹管理器",
	"tags": ["electron", "tooling"]
}
```

它的意义有两层：

1. 让项目目录本身具备可迁移的身份描述；
2. 让跨设备识别时不依赖脆弱的路径或目录名。

### 2.5 项目身份与指纹

项目当前支持三种指纹：

```ts
type ProjectFingerprint =
	| { kind: 'metadata' }
	| { kind: 'folder-name'; folderName: string }
	| { kind: 'file-paths'; paths: string[] };
```

它们的用途分别是：

| 指纹 | 含义 | 适用场景 |
|------|------|----------|
| `metadata` | 使用 `.meta-data.projectId` | 最稳定，适合长期维护与同步 |
| `folder-name` | 使用目录名 | 简单项目、目录名稳定时 |
| `file-paths` | 使用一组相对文件路径 | 没有 metadata，但目录结构稳定时 |

这里有个很重要的实现倾向：**`metadata` 是最优先、最推荐的方案**。只要项目能写 `.meta-data`，它就是最稳定的身份锚点。

### 2.6 聚合视图与合并规则

渲染层最终消费的不是 raw shared / raw local，而是主进程整理后的聚合视图。可以粗暴理解成：

- `shared.projects[]` 提供项目身份
- `local.bindings[]` 补齐本机路径
- `.meta-data` 提供高优先级展示字段

项目展示字段的优先级大致如下：

| 字段 | 优先级 |
|------|--------|
| `name` | `.meta-data.name` → `shared.name` → 目录名 |
| `description` | `.meta-data.description` → `shared.description` |
| `tags` | `.meta-data.tags` → `shared.tags` |
| `path` | `local.bindings[].path` |
| `hasMetaFile` | `local.bindings[].hasMetaFile` |

因此，UI 层不必直接处理 shared/local 的拆分细节，但主进程在写盘时必须准确地把聚合视图拆回两份配置。

### 2.7 忽略规则

扫描期使用的是多来源忽略规则并集：

1. `shared.ignore.globs`
2. `.meta-data.ignore`
3. `local.ignoredPaths`

其中：

- `shared.ignore.globs` 适合团队或多机共享的规则；
- `.meta-data.ignore` 适合某个项目自身的局部忽略；
- `local.ignoredPaths` 优先级最高，表示“这台机器上我明确不要扫这个目录”。

### 2.8 扫描规则

扫描是这个项目最容易误解的一部分。核心原则只有一句话：

> 扫描负责识别，不负责偷偷导入。

当前规则是：

- 扫描发现候选目录，但不会自动新增 shared 项目；
- 唯一匹配成功时，更新或创建本机 binding；
- 指纹冲突时，不写 binding，只写 `warnings[]`；
- 用户可以把问题目录加入 `ignoredPaths` 后重扫；
- 手动添加项目前，必须先经过目录检查与冲突校验。

这件事决定了很多行为都偏“克制”：宁可让用户多确认一步，也不静默造脏数据。

### 2.9 不变量

协作时要牢牢记住以下不变量：

- 所有内部路径统一保存为正斜杠绝对路径；
- `shared.projects[].id` 在 shared 配置内唯一；
- `tags[].name` 在 shared 配置内唯一；
- `bindings[].projectId` 与 `bindings[].path` 在 local 配置内唯一；
- `warnings[]` 只描述问题，不自动修复问题；
- 配置写盘必须走原子替换，避免中断后损坏文件。

## 三、架构与模块

### 3.1 分层结构

项目按四层组织：

| 层级 | 路径 | 主要职责 |
|------|------|----------|
| 主进程 | `src/main/` | 配置、文件系统、扫描、同步、IPC |
| 预加载层 | `src/preload/` | `contextBridge`，隔离 Node 能力 |
| 渲染层 | `src/renderer/` | React UI、状态、交互 |
| 共享层 | `src/shared/` | 类型、schema、桥接契约、工具函数 |

这个边界是整个仓库最重要的结构约束。凡是跨边界模糊的修改，后面几乎都会变得难维护。

### 3.2 主进程模块

主进程是应用的“后端”，负责所有需要 Node / Electron 权限的工作。

#### 配置与会话

- `config-store.ts`：shared/local 双配置读写与原子落盘。
- `app-config-store.ts`：通用应用级持久化存储，当前用来保存最近一次成功打开的 shared 配置路径等应用偏好。
- `session.ts`：维护当前加载配置的会话状态，负责串行写盘，避免并发写坏配置。
- `project-repo.ts`：shared 项目、本机 binding、标签、扫描根等仓库级操作。

#### 项目元数据与扫描

- `meta-file.ts`：读写项目根 `.meta-data`。
- `ignore-matcher.ts`：忽略规则匹配。
- `scanner.ts`：扫描根递归遍历、候选目录发现。
- `project-matcher.ts`：目录检查、指纹匹配、冲突判断。

#### 进程边界与错误

- `ipc.ts`：注册 `app:*` 与 `fm:*` 通道。
- `fm-error.ts`：定义跨进程错误码与错误结构。

#### 其他业务能力

- `commands/runner.ts`：自定义命令执行。
- `sync/`：同步相关实现，后面单独展开。

### 3.3 preload 与 IPC 边界

preload 的职责非常明确：

- 渲染层不能直接用 Node API；
- 主进程能力必须显式桥接；
- 所有调用都应该有稳定的 shared 类型契约。

当前边界大致是：

- `window.app`：基础模板能力
- `window.fm`：业务能力

命名约定：

- 基础能力：`app:*`
- 业务能力：`fm:*`

换句话说，renderer 不应该自己去“猜”某个文件路径该怎么读，也不应该偷偷碰 `fs`；正确姿势是经由 preload 调主进程接口。

### 3.4 共享层

`src/shared/` 是主进程和渲染层共同理解世界的地方，主要放：

- `bridge.ts`：桥接接口定义
- `types.ts` / `schema.ts`：配置与项目模型
- `sync-types.ts` / `sync-config.ts`：同步相关共享结构
- `id.ts` / `path-utils.ts` / `logger.ts` / `search.ts`：通用工具

一个实用判断标准是：

> 如果某个概念既出现在主进程，又出现在渲染层，那它大概率属于 `src/shared/`。

### 3.5 渲染层结构

渲染层主要位于 `src/renderer/src/`：

- `App.tsx`：应用根组件与路由/区域编排
- `store/`：全局状态与 action 组织
- `components/ui/`：通用原子控件与基础交互控件
- `components/basic/`：可复用的小型业务组件，例如 tag、项目表单、抽屉壳、忽略规则编辑器等
- `components/view/`：大界面或大区域组件，例如项目浏览视图、项目信息面板与 panel 下的 info/files/sync 子视图
- `components/` 根目录：尚未沉淀为三层结构的业务组件、对话框与设置面板
- `browser-bridge.ts`：对桥接调用做渲染层适配

从协作角度看，渲染层更像“聚合好的状态如何展示与编辑”，而不是“核心业务规则放哪”。

当前与项目浏览相关的视图组织约定如下：

- 整个右侧详情抽屉统一命名为 `project-info-panel`
- panel 内的三个区域分别拆成 `project-info-view`、`project-files-view`、`project-sync-view`
- 若某段 UI 会被多个 view 或对话框复用，应优先下沉到 `components/basic/`

### 3.6 关键链路

#### 启动与配置加载

1. Electron 主进程启动；
2. 主进程优先读取最近一次成功打开的 shared 配置路径；
3. 若最近配置不可用，则尝试加载工作目录 `.local/fm.shared.json`；
4. 若仍无可用配置，则保持“未加载配置”状态并进入欢迎页；
5. 会话层在用户打开或创建配置后再加载 shared/local 配置；
6. 主进程整理为聚合视图；
7. preload 暴露桥接接口；
8. renderer 根据快照显示欢迎页或主界面。

#### 扫描链路

1. renderer 触发扫描；
2. `scanner.ts` 按扫描根递归遍历；
3. `ignore-matcher.ts` 先过滤不该看的目录；
4. `project-matcher.ts` 检查 `.meta-data`、目录名、文件路径指纹；
5. 唯一匹配则更新 binding；冲突则写 warning；
6. renderer 刷新聚合项目视图与告警列表。

#### 手动添加项目

1. 先 `inspectDirectory()` 获取目录信息；
2. 再 `validateNew()` 检查指纹冲突；
3. 校验通过后 `add()` 创建 shared 项目；
4. 同步创建本地 binding；
5. 若指纹为 `metadata`，写入 `.meta-data.projectId`。

#### 批量添加项目

1. 通过 `pickDirectories()` 在系统文件窗口中一次选择多个目录；
2. 对每个目录执行 `inspectDirectory()` 与 `validateNew()`；
3. 批量添加默认使用 `folder-name` 指纹，项目名也以目录名为起点；
4. 渲染层会额外检查本次批量里的“内部冲突”，避免两个待添加条目互相撞指纹；
5. 无冲突条目可直接批量添加；有警告条目保持跳过，用户可单独重写识别方式后再添加。

#### 元数据编辑

这里有两个容易混淆的入口：

- `updateMeta()`：只改 shared 配置中的项目元数据；
- `writeMetaFile()`：把元数据写回项目根 `.meta-data`。

所以协作时要分清楚：当前是在改“配置里的缓存 / 共享定义”，还是在改“项目目录本身的自描述”。

### 3.7 推荐阅读顺序

如果要快速建立代码地图，建议按这个顺序读：

1. `src/shared/types.ts`、`src/shared/bridge.ts`、`src/shared/schema.ts`
2. `src/main/config-store.ts`、`src/main/session.ts`、`src/main/project-repo.ts`
3. `src/main/meta-file.ts`、`src/main/scanner.ts`、`src/main/project-matcher.ts`
4. `src/main/ipc.ts`
5. `src/preload/index.ts`
6. `src/renderer/src/App.tsx`、`src/renderer/src/store/`、主要组件
7. `src/main/sync/` 相关实现

## 四、同步设计与实现

### 4.1 为什么同步建立在 shared/local 拆分之上

同步时真正稳定的主键不是路径，而是 `projectId`。

例如同一个项目：

- 台式机：`D:/Projects/fm`
- 笔记本：`E:/Code/fm`

路径不同，但项目身份相同。如果路径直接写在主记录里，同步模型会变得非常别扭；而 shared/local 拆分天然把这个问题拆开了：

- shared 负责项目身份；
- local 负责设备落点。

### 4.2 同步原则

当前同步设计遵循这些原则：

- **零官方服务器**：核心能力基于本地目录、zip 或设备直连。
- **手动触发**：不做后台自动同步守护。
- **冲突显式展示**：先 diff，再由用户决定推送或拉取。
- **路径本地化**：远端永远不替本机决定真实目录。
- **不静默覆盖**：扫描和同步都优先暴露歧义。

### 4.3 同步范围

会参与同步的内容：

- shared 项目元数据
- 项目目录内容
- 可选 `.meta-data`
- manifest、hash、快照等传输期数据

不会跨设备覆盖的内容：

- `scanRoots`
- 本机 `bindings[].path`
- `warnings`
- `ignoredPaths`
- `ui`
- 本机设备设置与监听端口等偏好

### 4.4 当前同步模块

`src/main/sync/` 目前可以按职责这样理解：

| 模块 | 作用 |
|------|------|
| `snapshot.ts` | 生成项目快照与摘要 |
| `diff.ts` | 对比本地与目标端差异 |
| `file-sync.ts` | 执行文件级同步 |
| `dir-bundle.ts` | 目录形式的同步 bundle |
| `zip-bundle.ts` | zip 导入导出 |
| `tcp-transport.ts` | TCP 传输 |
| `preview-session.ts` | 同步预览会话组织 |
| `preview-session-codec.ts` | 预览数据编解码 |
| `preview-session-worker.ts` | 预览 worker |
| `device.ts` | 设备身份与设备侧信息 |
| `manager.ts` | 同步管理协调 |
| `auto-sync.ts` | 自动同步相关逻辑 |

如果把同步看成一条链，它大致是：

1. 找到项目
2. 生成快照
3. 计算 diff
4. 预览结果
5. 选择 bundle / zip / TCP 方式传输
6. 应用文件变更并更新本机状态

### 4.5 Manifest 与主键

同步层围绕 manifest 思维组织，而 manifest 的主键是 `projectId`。它需要回答的核心问题是：

- 这是哪个项目？
- 这个项目现在包含哪些文件与摘要？
- 与另一端相比差异在哪里？

因此，传输层的核心从来不是“把某个目录原样搬过去”，而是“按 `projectId` 对某个项目的内容做比对与落地”。

### 4.6 推送 / 拉取 / 导入导出

#### 推送

1. 用户选择要同步的项目；
2. 系统按 `projectId` 找到本机 binding；
3. 读取真实目录并生成快照；
4. 与目标端 manifest 或 bundle 计算 diff；
5. 展示差异后执行推送。

#### 拉取

1. 读取远端 manifest；
2. 用户决定每个项目拉到本机哪个路径；
3. 先解包到临时目录；
4. 校验 hash；
5. 成功后建立或更新本地 binding。

#### zip / bundle

- `bundle` 适合目录式共享或中转目录；
- `zip` 适合导入导出与手工携带；
- 两者都不应该携带“远端真实路径”这种本机无意义的信息。

### 4.7 冲突与回滚

同步和扫描共享同一条价值观：

- 发现歧义时不静默继续；
- 先暴露问题，再让用户确认；
- 先写临时文件，再做替换；
- 在建立 binding 之前就尽量完成校验。

所以，拉取和导入时通常会先落到临时目录，再做 hash 校验，再执行替换或绑定更新。这是为了把“半成功状态”压到最低。

## 五、协作时最值得记住的几件事

- 项目的核心不是 UI，而是数据模型与边界。
- `shared` / `local` 拆分是第一原则。
- `.meta-data` 是高优先级、自描述、可迁移的项目身份入口。
- 扫描是匹配流程，不是自动导入流程。
- 渲染层不能绕过 preload 直接访问 Node API。
- 涉及扫描、同步、配置写盘、IPC 的改动，都应该先理解主进程与 shared 模型再下手。
