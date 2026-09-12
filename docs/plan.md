# 重构计划

本文件记录 `hyper-fm` 的重构规划与目标架构设计，回答三个问题：

1. 当前架构里哪些是本质、哪些是偶然复杂度；
2. 消融掉偶然复杂度后，更精简、更高复用的架构长什么样；
3. 按什么顺序、用什么护栏把现状迁移过去。

与 `docs/development.md` 的分工：`development.md` 描述**现状**的设计与实现，本文件描述**目标**与迁移路径。任务完成后，现状变化应回写到 `development.md`。

---

## 一、背景与判断

起因是一次 `commands → actions` 重命名遗留的兼容补丁导致 `tsc` 编译失败（`project-matcher.ts` 里把 `ProjectBinding` 强转 `Record<string, unknown>`，TS2352）。修复过程中暴露出更系统的问题：类型逃逸、跨层重复实现、信任边界缺校验、契约多处声明。

**核心判断：问题根因不是"文件太大"或"抽象太少"，而是四条不变量没有单一归属。** 因此本计划明确不做整体重写——现有代码包含大量隐性领域知识（指纹匹配边界、同步边角情况、Windows 原子写兜底），重写会丢失它们，而收益实际只来自下述四条根因。采用绞杀者模式分阶段收敛。

**已决策**：旧 `commands` 字段的数据不兼容、不转换、不检查。相关分支已从 `schema.ts`、`project-matcher.ts` 删除。

---

## 二、第一性分析：四个核心关切

剥离 UI 与同步细节后，这个应用只剩四条不可再分的关切：

| # | 关切 | 含义 | 现状失守点 |
|---|------|------|-----------|
| 1 | **身份 Identity** | 项目跨设备稳定识别：`projectId` + fingerprint | `sameFingerprint` 4 份实现，语义可能分叉 |
| 2 | **真相 Truth** | shared（跨设备）与 local（本机）两层配置如何组合、迁移、持久化 | 项目合并 2 份且行为不同；无迁移机制；IO 原语 7 份 |
| 3 | **边界 Boundary** | 磁盘 / IPC / 网络 / 共享目录进来的数据一律不可信 | 磁盘加载有校验，IPC 与同步入口没有 |
| 4 | **契约 Contract** | main / preload / renderer 之间调用形状的单一来源 | 81 通道手写 4 遍，字符串无共享常量 |

所有已发现的问题都可归因到这四条。重构目标即让每条不变量**只有一个归属**。

---

## 三、消融设计

### 3.1 消融判据

对每个现有结构只问一个问题：**去掉它，会丢失哪条不变量？**

- 丢掉了 → 它是本质，保留并收拢到唯一归属；
- 没丢掉 → 它是偶然复杂度，消融。

"消融"不是删除功能，而是删除同一不变量的重复表达，只保留一个权威实现。

### 3.2 消融清单

| 现有结构 | 承载的不变量 | 判定 | 消融动作 |
|---|---|---|---|
| `composeAppConfig` 的项目合并（`schema.ts:939`）+ `buildProjects`（`project-repo.ts:58`） | 项目视图 | 重复且已分叉（前者跳过未绑定项目，后者保留） | 收敛为 `shared/domain/projects.ts` 的唯一 `buildProjectView` |
| 7 处原子写：`config-store.atomicWriteJson` / `app-config-store.writeAppConfigFile` / `meta-file.writeMetaFile` / `dir-bundle.writeAtomic` / `manager` 内联 / `file-sync.writeBytesAtomic` / `zip-bundle.materializeProject` | 持久化原子性 + 错误语义 | 同一不变量 7 份实现，Windows rename-replace 兜底只有 1 份有 | 收敛为 `shared/io/atomic.ts` |
| `sameFingerprint` ×4、`normalizeFingerprint` ×2 | 指纹等价 | 重复 | 收敛为 `shared/domain/fingerprint.ts` |
| gitignore 两套解析：`ignore-matcher.parseRule`（`ignore-matcher.ts:16`）vs `snapshot.parseGitignoreRule`（`snapshot.ts:60`）；`readGitignoreLines` ×2（`scanner.ts:88`/`snapshot.ts:120`） | 忽略语义（扫描与同步正确性） | 重复且语义已分叉（`respectGitignore` 在两处行为可能不一致） | 收敛为 `shared/domain/gitignore.ts` |
| `schema.ts`（1131 行）混 defaults / 校验 / 迁移 / 合并 / `.meta-data` 投影 | 多条不同不变量 | 职责错位；`validateConfig:800`、`buildMetaFile:1121` 为死导出 | 拆分为 `shared/config/{defaults,validate,merge,meta}.ts`，删死导出 |
| 81 通道 ×（bridge 类型 + preload invoke + main handle + browser mock） | 跨进程调用契约 | 同一契约 4 份手写，通道字符串无共享常量，编译期无法发现漂移 | `shared/ipc/channels.ts`（`as const`）+ 从契约类型推导 handler 签名 |
| `CustomAction` 定义在 `sync-types.ts:559` | 动作是核心领域概念，与同步无关 | 位置错位（核心 `types.ts` 有 11 处内联引用） | 移到 `shared/domain/actions.ts`，`sync-types` 保留 re-export |
| `?? value.commands` 兼容分支（`schema.ts:204/241`）与 `readLegacyActions` | 无（用户已明确不兼容） | 偶然复杂度 | 已删除 |
| `CONFIG_SCHEMA_VERSION` + `validateVersion`（`schema.ts:715`，仅高版本抛错） | 配置版本门槛 | 不变量成立，但当前**无历史迁移需求** | 不过度设计：保持硬门槛，首个真实破坏性变更再引入迁移注册表 |
| `browser-bridge.ts` 重实现主进程算法（`buildMockPreviewRows:117`、`prepareMockSelection:206`、选中解析） | 无（本应复用） | 偶然重复，会随主进程漂移 | mock 改为调用 `shared/` 纯函数 |
| `file-sync.ts` 内 3 个裸 NUL 字节作 Map 组合键分隔符 | 无 | 偶然（且导致 grep/diff 视其为二进制） | 改 `\0` 转义或嵌套 Map |

### 3.3 目标架构

原则：**`shared/domain` 与 `shared/config` 是纯的（无 IO、无 Electron），三层共同复用；`shared/io` 与 `shared/ipc` 提供基础设施；main / preload / renderer 只做编排与呈现。**

```text
src/
  shared/
    domain/                  # 纯领域：无 IO、无框架，三层共享
      types.ts               #   实体与基本类型
      fingerprint.ts         #   normalizeFingerprint / fingerprintEquals
      projects.ts            #   buildProjectView：唯一的 shared+local 合并原语
      actions.ts             #   CustomAction、scope 语义、纯 CRUD + scope 路由
      tags.ts
      gitignore.ts           #   唯一的忽略规则解析与匹配
    config/                  # 配置真相
      defaults.ts
      validate.ts            #   parse 层：外部输入 -> Result
      merge.ts               #   compose / split，唯一实现
      meta.ts                #   .meta-data 投影
    ipc/
      channels.ts            #   as const 通道表（唯一字符串来源）
      contract.ts            #   由 channels 推导的跨进程调用契约
    io/
      atomic.ts              #   writeJsonAtomic / readJsonOrNull / pathExists / resolveInside
      paths.ts
    validate/
      combinators.ts         #   极简 v.object / v.string / v.array / v.record

  main/
    ipc/                     # 按域拆分的 handler，签名受契约约束
      config.ts  projects.ts  actions.ts  sync.ts  scan.ts  window.ts
    session.ts
    commands/                # 待重命名为 actions/（纯命名，见阶段 1）

  preload/index.ts           # 遍历 channels 表注册 invoke，不再手写字面量
  renderer/src/
    bridge/                  # 真实 bridge 与 mock，均复用 shared 纯函数
```

### 3.4 单一原语与复用点

| 不变量 | 消融后的唯一实现 | 现状重复数 |
|---|---|---|
| 项目视图合并 | `shared/domain/projects.ts` `buildProjectView` | 2 |
| 指纹归一 / 等价 | `shared/domain/fingerprint.ts` | 6（4 等价 + 2 归一） |
| 忽略规则 | `shared/domain/gitignore.ts` | 2 套解析 + 2 份读行 |
| 原子 JSON IO | `shared/io/atomic.ts` | 7 |
| 配置校验 | `shared/config/validate.ts` | 1（磁盘）+ 0（IPC/网络） |
| IPC 通道 | `shared/ipc/channels.ts` | 4 处声明、81 个手写字面量 |
| 动作 CRUD + scope 路由 | `shared/domain/actions.ts` | 2（`runner` + `schema` merge 分流） |
| 路径安全 | `shared/io/atomic.ts` `resolveInside` | 0（缺口） |

### 3.5 收益量化

| 指标 | 现状 | 消融后 |
|---|---|---|
| 项目合并实现 | 2 份，行为分叉 | 1 份 |
| 指纹实现 | 6 份 | 1 份 |
| 原子写实现 | 7 份 | 1 份 |
| 通道契约声明点 | 4 份（81 通道） | 1 张表 + 类型推导 |
| `schema.ts` | 1131 行混合 5 职责 + 2 死导出 | 4 个单一职责模块 |
| `ipc.ts` | 1838 行单文件 | 6 个按域模块 |
| 信任边界校验 | 仅磁盘加载 | 磁盘 / IPC / 网络 / 共享目录全部经 parse |

---

## 四、分阶段实施计划

每个阶段都可独立发布、可独立回滚。**阶段 0 是所有后续阶段的前置条件。**

### 阶段 0：护栏（前置）

- **目标**：为将要改动的缝补特征测试。
- **动作**：补配置 shared/local 往返、全局动作 `scope` 往返、`composeAppConfig` vs `buildProjects` 一致性、sync 三个解包入口、`.meta-data` 读写。
- **验收**：新增测试全绿；现有 151 个测试保持全绿。
- **说明**：当前测试集中在纯函数上，恰好缺全部高风险缝；没有这一步，后续重构无法安全验证。

### 阶段 1：正确性修复（低风险，可立即发布）

- **动作**：
  1. `validateAction`（`schema.ts:605`）保留 `scope`；全局动作 CRUD 按 `scope` 路由到 shared/local，修"选共享、重启后退化为本地"。
  2. `composeAppConfig` 复用唯一项目合并原语，修"未绑定共享项目能按 id 取到、列表却看不到"。
  3. `project-command-menu.tsx:47` 的 `id.startsWith('cmd')` 改为 `act`，修自定义动作图标。
  4. `file-sync.ts` 的裸 NUL 分隔符改为 `\0` 转义。
- **验收**：阶段 0 的往返测试全绿；`npm run typecheck && npm run build && npm run test` 全绿。
- **风险**：低。均为局部改动。

### 阶段 2：基础设施

- **动作**：
  1. 新建 `shared/io/atomic.ts`，提供 `writeJsonAtomic` / `readJsonOrNull` / `pathExists` / `resolveInside`，迁移全部 7 处调用点，统一 Windows rename-replace 兜底。
  2. 新建 `shared/domain/fingerprint.ts`、`shared/domain/projects.ts`，main / `schema` / renderer mock / import helpers 全部复用。
  3. 新建 `shared/domain/actions.ts`，`CustomAction` 迁出 `sync-types.ts`，后者保留 re-export 过渡。
  4. 引入 `shared/validate/combinators.ts`。
- **决策点**：校验用**内部极简组合子**还是**引入 zod**。推荐内部组合子——项目当前零校验依赖，组合子足以覆盖现有手写 guard，且不增加体积与供应链面。若更看重开发速度与生态，可选 zod。
- **验收**：无重复实现残留（用 grep 校验单一实现）；测试全绿。
- **风险**：中。改动面广但机械；靠阶段 0 测试兜底。

### 阶段 3：契约单一化

- **动作**：
  1. 新建 `shared/ipc/channels.ts`（`as const`）与 `shared/ipc/contract.ts`，preload 与 main 共同消费；handler 参数/返回由契约类型约束，杜绝字面量漂移。
  2. 按域拆分 `ipc.ts` 为 `main/ipc/{config,projects,actions,sync,scan,window}.ts`。
  3. `commands/` 目录与日志 scope、视图 id、toast 文案统一为 `actions`（纯命名）。
- **验收**：通道数量与行为不变；preload / main 无硬编码通道字符串；测试全绿。
- **风险**：中。拆分 `ipc.ts` 时注意 `wrap` 错误处理与 `mutate` 串行语义保持不变。

### 阶段 4：边界加固（安全优先级最高）

- **动作**：
  1. 所有同步入口加运行时形状校验：`zip-bundle.parseJson`、`dir-bundle.readJson`、`tcp-transport` 的 `JSON.parse as SyncMessage`。
  2. `slug` / `deviceId` 做单路径段校验；落盘统一走 `resolveInside`，封堵 zip-slip 与目录穿越。
  3. `tcp-transport` 的 `contentLength` 增加符号与上界校验，防内存放大。
  4. IPC 写入口（`config:save`、项目 patch、动作 CRUD）落盘前校验，非法输入返回结构化错误而非持久化脏数据。
  5. `schema.ts:563` 的 `settings` override 按字段契约校验类型。
- **验收**：为恶意 zip 条目名、越界 `contentLength`、畸形 IPC 载荷补充负向测试并全绿。
- **风险**：中；纯增校验，但需确认无误伤正常载荷。

### 阶段 5：拆分 schema.ts

- **动作**：按 3.3 拆为 `shared/config/{defaults,validate,merge,meta}.ts`；删除死导出 `validateConfig`、`buildMetaFile`；`schema.ts` 退化为 re-export 兼容层后移除。
- **验收**：公共 API 行为不变；测试全绿。
- **风险**：低（模块内均为纯函数）。

### 阶段 6：渲染层收敛

- **动作**：preview rows / selection / aggregate、`retypeSyncConfig` 等纯算法下沉 `shared` 或 store；`browser-bridge` 复用 shared 纯函数；大组件按 `view` 层级拆分。
- **验收**：mock 与真实实现共用同一纯函数；关键交互手测通过（`npm run dev`）。
- **风险**：中；涉及 UI 行为，需真实应用手测。

---

## 五、验收与护栏

- 每个阶段结束执行：`npm run typecheck`、`npm run build`、`npm run test`。
- 涉及主进程 / IPC / 同步 / 文件系统的阶段（1、3、4、6）额外执行 `npm run dev` 真实应用手测。
- 涉及用户可见行为、配置结构、IPC 通道或目录结构的改动，同步更新 `AGENTS.md` 与 `docs/development.md`。
- 单一实现用 grep 守护：如 `sameFingerprint`、`atomicWrite`、`ipcMain.handle` 的重复数量应在阶段 2/3 后降到各自唯一。

---

## 六、Non-goals（明确不做）

- **不整体重写**：收益来自四条根因的收敛，不来自重写；重写会丢失隐性领域知识。
- **不引入迁移框架**：当前无历史迁移需求。`validateVersion` 保持"高版本拒绝加载"的硬门槛，首个真实破坏性变更落地时再引入 `migrations` 注册表。
- **不兼容废弃的 `commands` 数据**：已删除全部读取、转换与检查分支。
- **不改技术栈**：不更换 Electron / React / Vite / 状态管理方案。
- **不追求文件行数**：拆分以职责为界，不以"每文件 N 行"为目标。

---

## 七、证据索引

| 位置 | 事实 |
|---|---|
| `schema.ts:605-623` | `validateAction` 未解构 `scope`，动作 `scope` 在校验后丢失 |
| `schema.ts:780` | 全局动作只读 `input.actions`（兼容分支已删） |
| `schema.ts:939-958` | `composeAppConfig` 仅遍历 `local.bindings`，`continue` 跳过未绑定项目 |
| `project-repo.ts:58-77` | `buildProjects` 额外保留未绑定 shared 项目（注释声明"仍然展示"） |
| `ipc.ts:512` / `ipc.ts:535` | `projects:list` 用前者，`projects:get` 用后者，两者不一致 |
| `runner.ts:52-87` | 全局动作只读写 `local.actions`，不按 `scope` 路由 |
| `config-store.ts:270-278` | `saveConfig` 直接原子写，不做校验 |
| `schema.ts:715-723` | `validateVersion` 仅高版本抛错，无迁移分发 |
| `zip-bundle.ts:122-128,197-201` | `JSON.parse as T`；`path.join(tmp, rel)` 无 `..` 校验 |
| `tcp-transport.ts:77,85-88` | `JSON.parse as SyncMessage`；`contentLength` 无上界 |
| `dir-bundle.ts:58-66,27-41` | `readJson<T>` 仅查 `schema`；`deviceId`/`slug` 直接拼路径 |
| `ipc.ts:370,439,546,557,1699,1718,1733` | 渲染层输入裸转，落盘前无校验 |
| `project-matcher.ts:440`、`browser-bridge.ts:499`、`project-import/helpers.ts:90`、`project-info-panel.tsx:867` | `sameFingerprint` 四份实现 |
| `ignore-matcher.ts:16` vs `snapshot.ts:60`；`scanner.ts:88` vs `snapshot.ts:120` | gitignore 两套解析、两份读行 |
| `sync-types.ts:559` | `CustomAction` 定义在同步模块 |
| `bridge.ts` / `preload/index.ts` / `ipc.ts` / `browser-bridge.ts` | 同一份 81 通道契约的手写声明分布于 4 处 |
| `file-sync.ts`（偏移 1972/3672/3829） | 3 个裸 NUL 字节作 Map 键分隔符 |
