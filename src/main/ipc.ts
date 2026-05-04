// ---------------------------------------------------------------------------
// IPC 处理器注册：保留原 app:* 通道，新增 fm:* 通道
// ---------------------------------------------------------------------------

import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { createLogger } from '../shared/logger.js';
import {
  type AppConfig,
  type AppInfo,
  type ConfigSnapshot,
  type ManualProjectInput,
  type ManualProjectValidationResult,
  type ProjectDirectoryInspection,
  type Project,
  type ProjectMetaPatch,
  type ScanReport,
  type SyncConfig,
  type SyncPlanApplyRequest,
  type SyncImportItem,
  type SyncImportTarget,
  type SyncPullItem,
} from '../shared/bridge.js';
import {
  type CustomCommand,
  getSyncConfigTypeLabel,
} from '../shared/sync-types.js';
import {
  normalizeSyncConfig,
  resolveSyncProjectIds,
  setProjectSyncRule,
} from '../shared/sync-config.js';
import {
  addIgnoredPath,
  addProjectManual,
  addScanRoot,
  applyProjectPatch,
  buildProjects,
  findProjectById,
  findProjectByPath,
  mergeScanResult,
  removeProject,
  removeScanRoot,
  setProjectMetaFlag,
  updateScanRoot,
} from './project-repo.js';
import { switchConfigFile, getSnapshot, mutate, requireSession } from './session.js';
import {
  createConfig as createConfigFile,
  createLocalConfigForShared,
  inspectOpenConfig,
} from './config-store.js';
import { scanRoot } from './scanner.js';
import { readMetaFile, removeMetaFile, writeMetaFile } from './meta-file.js';
import { FmError, toFmError } from './fm-error.js';
import {
  findFingerprintConflicts,
  findMatchingProjectsForDirectory,
  inspectProjectDirectory,
  normalizeFingerprint,
} from './project-matcher.js';
import {
  ensureDeviceRegistry,
  setSelfName,
  upsertKnownDevice,
} from './sync/device.js';
import {
  diffAgainstBundleDir,
  pushToBundleDir,
  pullFromBundleDir,
  exportBundleZip,
  previewBundleZip,
  applyBundleZip,
} from './sync/manager.js';
import {
  applySharedDirSync,
  applyFolderSync,
  applyZipImport,
  openConflictMerge,
  openSyncDiff,
  previewSharedDirSync,
  previewFolderSync,
  previewZipImport,
} from './sync/file-sync.js';
import {
  applySyncPreviewSession,
  closeSyncPreviewSession,
  expandSyncPlanApplyRequest,
  getSyncPreviewRows,
  openFolderSyncPreviewSession,
  openSharedDirSyncPreviewSession,
} from './sync/preview-session.js';
import { refreshAutoSyncSchedules } from './sync/auto-sync.js';
import {
  startSyncServer,
  type SyncServer,
  type ServerHandlers,
} from './sync/tcp-transport.js';
import {
  publishToBundleDir,
  readDeviceManifest,
  readProjectZip as readBundleProjectZip,
} from './sync/dir-bundle.js';
import { buildLocalManifest } from './sync/manager.js';
import { unpackProjectZip } from './sync/zip-bundle.js';
import {
  PRESET_COMMANDS,
} from '../shared/sync-types.js';
import {
  addCustomCommand,
  removeCustomCommand,
  runCommand,
  updateCustomCommand,
} from './commands/runner.js';

const logger = createLogger('main:ipc');

// ---------------------------------------------------------------------------
// 模块状态：TCP 服务端实例
// ---------------------------------------------------------------------------

const activeServers = new Map<string, SyncServer>();

// ---------------------------------------------------------------------------
// 包装：统一日志与错误归一化
// ---------------------------------------------------------------------------

type Handler<T> = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T;

function wrap<T>(channel: string, handler: Handler<T>): Handler<T> {
  return async (event, ...args) => {
    logger.debug(`IPC 调用 ${channel}`);
    try {
      const result = await handler(event, ...args);
      logger.debug(`IPC 完成 ${channel}`);
      return result;
    } catch (error) {
      const fm = toFmError(error);
      logger.error(`IPC 失败 ${channel} [${fm.code}] ${fm.message}`);
      throw fm;
    }
  };
}

function normalizeIgnoreInput(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function registerIpcHandlers(): void {
  // ── 兼容原模板 ──
  ipcMain.handle(
    'app:get-info',
    wrap('app:get-info', (): AppInfo => ({
      appName: app.getName(),
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron ?? '',
    })),
  );

  ipcMain.handle(
    'app:ping',
    wrap('app:ping', async (_e, message: unknown) => `pong: ${String(message)}`),
  );

  // ── 配置 ──
  ipcMain.handle(
    'fm:config:current',
    wrap('fm:config:current', (): ConfigSnapshot => getSnapshot()),
  );

  ipcMain.handle(
    'fm:config:inspectOpen',
    wrap('fm:config:inspectOpen', async (_e, filePath: unknown) => {
      assertString(filePath, 'filePath');
      return inspectOpenConfig(filePath);
    }),
  );

  ipcMain.handle(
    'fm:config:load',
    wrap('fm:config:load', async (_e, filePath: unknown): Promise<ConfigSnapshot> => {
      assertString(filePath, 'filePath');
      const snapshot = await switchConfigFile(filePath);
      refreshAutoSyncSchedules();
      return snapshot;
    }),
  );

  ipcMain.handle(
    'fm:config:create',
    wrap('fm:config:create', async (_e, filePath: unknown): Promise<ConfigSnapshot> => {
      assertString(filePath, 'filePath');
      const snapshot = await createConfigFile(filePath);
      const next = await switchConfigFile(snapshot.paths.sharedPath);
      refreshAutoSyncSchedules();
      return next;
    }),
  );

  ipcMain.handle(
    'fm:config:createLocalForShared',
    wrap('fm:config:createLocalForShared', async (_e, sharedPath: unknown): Promise<ConfigSnapshot> => {
      assertString(sharedPath, 'sharedPath');
      const snapshot = await createLocalConfigForShared(sharedPath);
      const next = await switchConfigFile(snapshot.paths.sharedPath);
      refreshAutoSyncSchedules();
      return next;
    }),
  );

  ipcMain.handle(
    'fm:config:save',
    wrap('fm:config:save', async (_e, data: unknown): Promise<void> => {
      const config = data as AppConfig;
      await mutate(() => ({ nextConfig: config, result: undefined as void }));
      refreshAutoSyncSchedules();
    }),
  );

  ipcMain.handle(
    'fm:config:pick',
    wrap('fm:config:pick', async (event, mode: unknown): Promise<string | null> => {
      const window = senderWindow(event);
      if (mode !== 'open' && mode !== 'save') {
        throw new FmError('INTERNAL', `非法 pick mode: ${String(mode)}`);
      }
      const session = requireSession();
      const defaultPath = session.sharedPath;
      if (mode === 'open') {
        const res = window
          ? await dialog.showOpenDialog(window, {
            title: '选择配置文件',
            defaultPath,
            filters: [{ name: 'fm 配置', extensions: ['json'] }],
            properties: ['openFile'],
          })
          : await dialog.showOpenDialog({
            title: '选择配置文件',
            defaultPath,
            filters: [{ name: 'fm 配置', extensions: ['json'] }],
            properties: ['openFile'],
          });
        return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
      }
      const res = window
        ? await dialog.showSaveDialog(window, {
          title: '新建配置文件',
          defaultPath,
          filters: [{ name: 'fm 配置', extensions: ['json'] }],
        })
        : await dialog.showSaveDialog({
          title: '新建配置文件',
          defaultPath,
          filters: [{ name: 'fm 配置', extensions: ['json'] }],
        });
      return res.canceled || !res.filePath ? null : res.filePath;
    }),
  );

  // ── 扫描根 ──
  ipcMain.handle(
    'fm:scanRoots:add',
    wrap('fm:scanRoots:add', async (_e, input: unknown) => {
      const i = input as { path: string; label?: string; maxDepth?: number };
      return mutate(({ local }) => {
        const { nextLocal, root } = addScanRoot(local, i);
        return { nextLocal, result: root };
      });
    }),
  );

  ipcMain.handle(
    'fm:scanRoots:update',
    wrap('fm:scanRoots:update', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(({ local }) => {
        const { nextLocal, root } = updateScanRoot(local, id, patch as never);
        return { nextLocal, result: root };
      });
    }),
  );

  ipcMain.handle(
    'fm:scanRoots:remove',
    wrap('fm:scanRoots:remove', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(({ local }) => ({ nextLocal: removeScanRoot(local, id), result: undefined as void }));
    }),
  );

  ipcMain.handle(
    'fm:scanRoots:pickDirectory',
    wrap('fm:scanRoots:pickDirectory', async (event): Promise<string | null> => {
      const window = senderWindow(event);
      const res = window
        ? await dialog.showOpenDialog(window, {
          title: '选择扫描根目录',
          properties: ['openDirectory'],
        })
        : await dialog.showOpenDialog({
          title: '选择扫描根目录',
          properties: ['openDirectory'],
        });
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
    }),
  );

  // ── 扫描 ──
  ipcMain.handle(
    'fm:scan:runAll',
    wrap('fm:scan:runAll', async event => {
      const reports: ScanReport[] = [];
      const session = requireSession();
      for (const root of session.config.scanRoots) {
        if (!root.enabled) continue;
        reports.push(await runScanForRoot(event, root.id));
      }
      return reports;
    }),
  );

  ipcMain.handle(
    'fm:scan:runOne',
    wrap('fm:scan:runOne', async (event, rootId: unknown) => {
      assertString(rootId, 'rootId');
      return runScanForRoot(event, rootId);
    }),
  );

  ipcMain.handle(
    'fm:scan:ignorePath',
    wrap('fm:scan:ignorePath', async (_e, absPath: unknown) => {
      assertString(absPath, 'path');
      return mutate(({ local }) => ({ nextLocal: addIgnoredPath(local, absPath), result: undefined as void }));
    }),
  );

  ipcMain.handle(
    'fm:scan:revealPath',
    wrap('fm:scan:revealPath', async (_e, absPath: unknown) => {
      assertString(absPath, 'path');
      await shell.openPath(path.normalize(absPath));
      return undefined as void;
    }),
  );

  // ── 项目 ──
  ipcMain.handle(
    'fm:projects:list',
    wrap('fm:projects:list', (): Project[] => requireSession().config.projects),
  );

  ipcMain.handle(
    'fm:projects:get',
    wrap('fm:projects:get', (_e, id: unknown) => {
      assertString(id, 'id');
      const session = requireSession();
      const project = findProjectById(session.shared, session.local, id);
      if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
      return project;
    }),
  );

  ipcMain.handle(
    'fm:projects:updateMeta',
    wrap('fm:projects:updateMeta', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(({ shared, local }) => {
        const { nextShared, project } = applyProjectPatch(shared, local, id, patch as ProjectMetaPatch);
        return { nextShared, result: project };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:writeMetaFile',
    wrap('fm:projects:writeMetaFile', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(async ({ shared, local }) => {
        const { nextShared, project } = applyProjectPatch(shared, local, id, patch as ProjectMetaPatch);
        await writeMetaFile(project.path, {
          projectId: project.id,
          name: project.name,
          description: project.description,
          tags: project.tags,
          ignore: project.ignore,
          syncRespectGitignore: project.syncRespectGitignore,
        });
        const nextLocal = setProjectMetaFlag(local, id, true);
        const updated = findProjectById(nextShared, nextLocal, id)!;
        return { nextShared, nextLocal, result: updated };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:removeMetaFile',
    wrap('fm:projects:removeMetaFile', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(async ({ shared, local }) => {
        const project = findProjectById(shared, local, id);
        if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
        await removeMetaFile(project.path);
        const nextLocal = setProjectMetaFlag(local, id, false);
        return { nextLocal, result: findProjectById(shared, nextLocal, id)! };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:revealInOs',
    wrap('fm:projects:revealInOs', async (_e, id: unknown) => {
      assertString(id, 'id');
      const session = requireSession();
      const project = findProjectById(session.shared, session.local, id);
      if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
      shell.openPath(path.normalize(project.path));
      return undefined as void;
    }),
  );

  ipcMain.handle(
    'fm:projects:inspectDirectory',
    wrap('fm:projects:inspectDirectory', async (_e, projectPath: unknown, projectIgnore: unknown): Promise<ProjectDirectoryInspection> => {
      assertString(projectPath, 'path');
      const session = requireSession();
      const inspection = await inspectProjectDirectory(projectPath, {
        globalIgnore: session.config.ignore.globs,
        projectIgnore: normalizeIgnoreInput(projectIgnore),
      });
      return {
        path: inspection.path,
        suggestedName: inspection.name,
        hasMetaFile: inspection.hasMetaFile,
        metaProjectId: inspection.metaProjectId,
        tree: inspection.tree,
        files: inspection.files,
      };
    }),
  );

  ipcMain.handle(
    'fm:projects:validateNew',
    wrap('fm:projects:validateNew', async (_e, input: unknown): Promise<ManualProjectValidationResult> => {
      const i = input as ManualProjectInput;
      assertString(i?.path, 'input.path');
      const session = requireSession();
      const inspection = await inspectProjectDirectory(i.path, { globalIgnore: session.config.ignore.globs });
      const conflicts: ManualProjectValidationResult['conflicts'] = [];
      const duplicatePath = findProjectByPath(session.shared, session.local, inspection.path, process.platform);
      if (duplicatePath) {
        conflicts.push({
          projectId: duplicatePath.id,
          projectName: duplicatePath.name,
          reason: '该目录已绑定到现有项目。',
        });
      }
      const fingerprint = normalizeFingerprint(i.fingerprint);
      const exactConflicts = findFingerprintConflicts(session.shared.projects, fingerprint);
      for (const project of exactConflicts) {
        conflicts.push({
          projectId: project.id,
          projectName: project.name,
          reason: '该指纹与现有项目完全相同。',
        });
      }
      const runtimeMatches = await findMatchingProjectsForDirectory(session.shared.projects, inspection);
      for (const project of runtimeMatches) {
        if (conflicts.some(item => item.projectId === project.id)) continue;
        conflicts.push({
          projectId: project.id,
          projectName: project.name,
          reason: '当前目录会被现有项目指纹命中，添加后将产生冲突。',
        });
      }
      return { valid: conflicts.length === 0, conflicts };
    }),
  );

  ipcMain.handle(
    'fm:projects:add',
    wrap('fm:projects:add', async (_e, input: unknown) => {
      const i = input as ManualProjectInput;
      assertString(i?.path, 'input.path');
      return mutate(async ({ shared, local }) => {
        const validation = await validateManualProject(i, shared, local);
        if (!validation.valid) {
          throw new FmError('FINGERPRINT_CONFLICT', validation.conflicts[0]?.reason ?? '项目指纹冲突', validation.conflicts);
        }
        const inspection = await inspectProjectDirectory(i.path, { globalIgnore: requireSession().config.ignore.globs });
        const baseName = i.name?.trim() || inspection.name;
        const meta = inspection.hasMetaFile ? await readMetaFile(inspection.path) : null;
        const { nextShared, nextLocal, project } = addProjectManual(
          shared,
          local,
          {
            ...i,
            path: inspection.path,
            name: meta?.name ?? baseName,
            description: meta?.description ?? i.description,
            tags: meta?.tags ?? i.tags,
            ignore: meta?.ignore,
            hasMetaFile: inspection.hasMetaFile || i.fingerprint.kind === 'metadata',
          },
          process.platform,
        );

        if (i.fingerprint.kind === 'metadata') {
          await writeMetaFile(project.path, {
            projectId: project.id,
            name: project.name,
            description: project.description,
            tags: project.tags,
            ignore: project.ignore,
          });
        }

        return {
          nextShared,
          nextLocal:
            i.fingerprint.kind === 'metadata' ? setProjectMetaFlag(nextLocal, project.id, true) : nextLocal,
          result:
            i.fingerprint.kind === 'metadata'
              ? { ...project, hasMetaFile: true }
              : project,
        };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:remove',
    wrap('fm:projects:remove', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(({ shared, local }) => {
        const { nextShared, nextLocal } = removeProject(shared, local, id);
        return { nextShared, nextLocal, result: undefined as void };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:pickDirectory',
    wrap('fm:projects:pickDirectory', async (event): Promise<string | null> => {
      const window = senderWindow(event);
      const res = window
        ? await dialog.showOpenDialog(window, {
          title: '选择项目目录',
          properties: ['openDirectory'],
        })
        : await dialog.showOpenDialog({
          title: '选择项目目录',
          properties: ['openDirectory'],
        });
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
    }),
  );

  // ── 同步 ──
  registerSyncHandlers();
  registerCommandHandlers();
  registerTagHandlers();

  logger.info('IPC 处理器已注册');
}

// ---------------------------------------------------------------------------
// 标签注册表
// ---------------------------------------------------------------------------

function registerTagHandlers(): void {
  ipcMain.handle(
    'fm:tags:list',
    wrap('fm:tags:list', () => requireSession().config.tags ?? []),
  );

  ipcMain.handle(
    'fm:tags:upsert',
    wrap('fm:tags:upsert', async (_e, input: unknown) => {
      if (!input || typeof input !== 'object') {
        throw new FmError('CONFIG_INVALID', 'tag 必须为对象');
      }
      const obj = input as { name?: unknown; color?: unknown };
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      const color = typeof obj.color === 'string' && obj.color ? obj.color : '#94a3b8';
      if (!name) throw new FmError('CONFIG_INVALID', 'tag.name 不可为空');
      return mutate(({ shared }) => {
        const existing = shared.tags ?? [];
        const others = existing.filter(t => t.name !== name);
        const nextShared = { ...shared, tags: [...others, { name, color }] };
        return { nextShared, result: nextShared.tags };
      });
    }),
  );

  ipcMain.handle(
    'fm:tags:remove',
    wrap('fm:tags:remove', async (_e, name: unknown) => {
      if (typeof name !== 'string') throw new FmError('CONFIG_INVALID', 'name 必须为字符串');
      return mutate(({ shared }) => {
        const nextShared = { ...shared, tags: (shared.tags ?? []).filter(t => t.name !== name) };
        return { nextShared, result: nextShared.tags };
      });
    }),
  );

  ipcMain.handle(
    'fm:tags:rename',
    wrap('fm:tags:rename', async (_e, oldName: unknown, newName: unknown) => {
      if (typeof oldName !== 'string') throw new FmError('CONFIG_INVALID', 'oldName 必须为字符串');
      if (typeof newName !== 'string') throw new FmError('CONFIG_INVALID', 'newName 必须为字符串');
      const from = oldName.trim();
      const to = newName.trim().replace(/^#/, '');
      if (!from) throw new FmError('CONFIG_INVALID', 'oldName 不可为空');
      if (!to) throw new FmError('CONFIG_INVALID', 'newName 不可为空');
      if (from === to) {
        return (requireSession().config.tags ?? []) as readonly { name: string; color: string }[];
      }
      return mutate(async ({ shared, local }) => {
        const existing = shared.tags ?? [];
        const target = existing.find(t => t.name === from);
        if (!target) throw new FmError('CONFIG_INVALID', `标签不存在：${from}`);
        if (existing.some(t => t.name === to)) {
          throw new FmError('CONFIG_INVALID', `标签已存在：${to}`);
        }
        const tags = existing.map(t => (t.name === from ? { ...t, name: to } : t));
        const projects = shared.projects.map(p =>
          p.tags.includes(from)
            ? { ...p, tags: p.tags.map(x => (x === from ? to : x)) }
            : p,
        );
        const boundProjects = buildProjects({ ...shared, projects }, local);
        // 把 .meta-data 中的标签也同步重命名，避免下次扫描覆盖
        for (const p of boundProjects) {
          if (!p.hasMetaFile) continue;
          if (!p.tags.includes(to)) continue;
          try {
            await writeMetaFile(p.path, {
              projectId: p.id,
              name: p.name,
              description: p.description,
              tags: p.tags,
              ignore: p.ignore,
            });
          } catch (err) {
            logger.warn(
              `重命名标签时同步 .meta-data 失败：${p.path} ${(err as Error).message}`,
            );
          }
        }
        return { nextShared: { ...shared, tags, projects }, result: tags };
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

function registerSyncHandlers(): void {
  ipcMain.handle(
    'fm:sync:getDevice',
    wrap('fm:sync:getDevice', async () => {
      return mutate(({ config }) => {
        const { config: nextConfig } = ensureDeviceRegistry(config);
        return { nextConfig, result: nextConfig.devices! };
      });
    }),
  );

  ipcMain.handle(
    'fm:sync:setSelfName',
    wrap('fm:sync:setSelfName', async (_e, name: unknown) => {
      assertString(name, 'name');
      return mutate(({ config }) => {
        const nextConfig = setSelfName(config, name);
        return { nextConfig, result: nextConfig.devices! };
      });
    }),
  );

  ipcMain.handle(
    'fm:sync:listConfigs',
    wrap('fm:sync:listConfigs', () => requireSession().config.syncConfigs ?? []),
  );

  ipcMain.handle(
    'fm:sync:upsertConfig',
    wrap('fm:sync:upsertConfig', async (_e, input: unknown) => {
      if (!input || typeof input !== 'object') {
        throw new FmError('CONFIG_INVALID', '同步配置必须为对象');
      }
      const nextSyncConfig = normalizeSyncConfig(input as SyncConfig);
      const result = await mutate(({ config }) => {
        const current = config.syncConfigs ?? [];
        const exists = current.some(item => item.id === nextSyncConfig.id);
        const syncConfigs = exists
          ? current.map(item => (item.id === nextSyncConfig.id ? nextSyncConfig : item))
          : [...current, nextSyncConfig];
        return {
          nextConfig: { ...config, syncConfigs },
          result: nextSyncConfig,
        };
      });
      refreshAutoSyncSchedules();
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:removeConfig',
    wrap('fm:sync:removeConfig', async (_e, id: unknown) => {
      assertString(id, 'id');
      const result = await mutate(async ({ config }) => {
        const server = activeServers.get(id);
        if (server) {
          await server.close();
          activeServers.delete(id);
        }
        return {
          nextConfig: {
            ...config,
            syncConfigs: (config.syncConfigs ?? []).filter(item => item.id !== id),
          },
          result: undefined as void,
        };
      });
      refreshAutoSyncSchedules();
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:setProjectRule',
    wrap('fm:sync:setProjectRule', async (_e, configId: unknown, projectId: unknown, rule: unknown) => {
      assertString(configId, 'configId');
      assertString(projectId, 'projectId');
      if (rule !== 'default' && rule !== 'selected' && rule !== 'ignored') {
        throw new FmError('CONFIG_INVALID', '非法同步规则');
      }
      return mutate(({ config }) => {
        const syncConfig = getSyncConfigOrThrow(config, configId);
        const project = config.projects.find(item => item.id === projectId);
        if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${projectId}`);
        const next = setProjectSyncRule(syncConfig, project, rule);
        const syncConfigs = (config.syncConfigs ?? []).map(item => (item.id === configId ? next : item));
        return {
          nextConfig: { ...config, syncConfigs },
          result: next,
        };
      });
    }),
  );

  ipcMain.handle(
    'fm:sync:pickDirectory',
    wrap('fm:sync:pickDirectory', async (event, title: unknown) => {
      const window = senderWindow(event);
      const dialogTitle = typeof title === 'string' && title.trim() ? title : '选择目录';
      const res = window
        ? await dialog.showOpenDialog(window, {
          title: dialogTitle,
          properties: ['openDirectory', 'createDirectory'],
        })
        : await dialog.showOpenDialog({
          title: dialogTitle,
          properties: ['openDirectory', 'createDirectory'],
        });
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
    }),
  );

  ipcMain.handle(
    'fm:sync:diffSharedDir',
    wrap('fm:sync:diffSharedDir', async (_e, configId: unknown, projectIds: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'shared-dir');
      const dir = syncConfig.sharedDir.bundleDir;
      if (!dir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      const { diff } = await diffAgainstBundleDir(session.config, dir, { projectIds: ids });
      return diff;
    }),
  );

  ipcMain.handle(
    'fm:sync:pushSharedDir',
    wrap('fm:sync:pushSharedDir', async (_e, configId: unknown, projectIds: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'shared-dir');
      const dir = syncConfig.sharedDir.bundleDir;
      if (!dir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      const result = await pushToBundleDir(session.config, dir, ids);
      // 更新 syncedAt/syncedHash
      await mutate(async ({ config }) => {
        const { entriesByProject } = await buildLocalManifest(config, { projectIds: ids });
        const now = new Date().toISOString();
        const projects = config.projects.map(p => {
          if (!ids.includes(p.id)) return p;
          const entry = entriesByProject.get(p.id);
          return entry ? { ...p, syncedAt: now, syncedHash: entry.hash } : p;
        });
        return { nextConfig: { ...config, projects }, result: undefined as void };
      });
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:pullSharedDir',
    wrap('fm:sync:pullSharedDir', async (_e, configId: unknown, items: unknown) => {
      assertString(configId, 'configId');
      const list = items as SyncPullItem[];
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'shared-dir');
      const dir = syncConfig.sharedDir.bundleDir;
      if (!dir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', `${syncConfig.name} 未配置共享目录`);
      return pullFromBundleDir(dir, list);
    }),
  );

  ipcMain.handle(
    'fm:sync:previewSharedDirSync',
    wrap('fm:sync:previewSharedDirSync', async (_e, configId: unknown, projectIds: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'shared-dir');
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      return previewSharedDirSync(session.config, syncConfig, ids);
    }),
  );

  ipcMain.handle(
    'fm:sync:openSharedDirSyncPreview',
    wrap('fm:sync:openSharedDirSyncPreview', async (event, configId: unknown, projectIds: unknown, configOverride: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getPreviewableSyncConfigOfTypeOrThrow(session.config, configId, 'shared-dir', configOverride);
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      return openSharedDirSyncPreviewSession(event.sender.id, session.config, syncConfig, ids);
    }),
  );

  ipcMain.handle(
    'fm:sync:getSyncPreviewRows',
    wrap(
      'fm:sync:getSyncPreviewRows',
      async (_e, sessionId: unknown, projectId: unknown, startIndex: unknown, length: unknown, selection: unknown) => {
        assertString(sessionId, 'sessionId');
        assertString(projectId, 'projectId');
        if (typeof startIndex !== 'number' || Number.isNaN(startIndex)) {
          throw new FmError('CONFIG_INVALID', 'startIndex 必须为数字');
        }
        if (typeof length !== 'number' || Number.isNaN(length)) {
          throw new FmError('CONFIG_INVALID', 'length 必须为数字');
        }
        return getSyncPreviewRows(
          sessionId,
          projectId,
          Math.floor(startIndex),
          Math.floor(length),
          isSyncPlanSelectionState(selection) ? normalizeSyncPlanSelectionState(selection) : undefined,
        );
      },
    ),
  );

  ipcMain.handle(
    'fm:sync:closeSyncPreview',
    wrap('fm:sync:closeSyncPreview', async (_e, sessionId: unknown) => {
      assertString(sessionId, 'sessionId');
      closeSyncPreviewSession(sessionId);
      return undefined as void;
    }),
  );

  ipcMain.handle(
    'fm:sync:applySharedDirSync',
    wrap('fm:sync:applySharedDirSync', async (_e, configId: unknown, projectIds: unknown, request: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'shared-dir');
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      const normalizedRequest = isSyncPlanApplyRequest(request)
        ? normalizeSyncPlanApplyRequest(request)
        : undefined;
      const applyRequest = normalizedRequest?.sessionId
        ? normalizedRequest
        : normalizedRequest
          ? expandSyncPlanApplyRequest(normalizedRequest)
          : undefined;
      const { result, nextConfig } = normalizedRequest?.sessionId
        ? await applySyncPreviewSession(normalizedRequest.sessionId, {
          ...normalizedRequest,
          projectIds: normalizedRequest.projectIds.length > 0 ? normalizedRequest.projectIds : ids,
        })
        : await applySharedDirSync(session.config, syncConfig, ids, applyRequest);
      await mutate(() => ({ nextConfig, result: undefined as void }));
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:previewFolderSync',
    wrap('fm:sync:previewFolderSync', async (_e, configId: unknown, projectIds: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'folder');
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      return previewFolderSync(session.config, syncConfig, ids);
    }),
  );

  ipcMain.handle(
    'fm:sync:openFolderSyncPreview',
    wrap('fm:sync:openFolderSyncPreview', async (event, configId: unknown, projectIds: unknown, configOverride: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getPreviewableSyncConfigOfTypeOrThrow(session.config, configId, 'folder', configOverride);
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      return openFolderSyncPreviewSession(event.sender.id, session.config, syncConfig, ids);
    }),
  );

  ipcMain.handle(
    'fm:sync:applyFolderSync',
    wrap('fm:sync:applyFolderSync', async (_e, configId: unknown, projectIds: unknown, request: unknown) => {
      assertString(configId, 'configId');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'folder');
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      const normalizedRequest = isSyncPlanApplyRequest(request)
        ? normalizeSyncPlanApplyRequest(request)
        : undefined;
      const applyRequest = normalizedRequest?.sessionId
        ? normalizedRequest
        : normalizedRequest
          ? expandSyncPlanApplyRequest(normalizedRequest)
          : undefined;
      const { result, nextConfig } = normalizedRequest?.sessionId
        ? await applySyncPreviewSession(normalizedRequest.sessionId, {
          ...normalizedRequest,
          projectIds: normalizedRequest.projectIds.length > 0 ? normalizedRequest.projectIds : ids,
        })
        : await applyFolderSync(session.config, syncConfig, ids, applyRequest);
      await mutate(() => ({ nextConfig, result: undefined as void }));
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:openSyncDiff',
    wrap('fm:sync:openSyncDiff', async (_e, configId: unknown, projectId: unknown, relativePath: unknown, configOverride: unknown) => {
      assertString(configId, 'configId');
      assertString(projectId, 'projectId');
      assertString(relativePath, 'relativePath');
      const session = requireSession();
      const syncConfig = getPreviewableSyncConfigOrThrow(session.config, configId, configOverride);
      await openSyncDiff(session.config, syncConfig, projectId, relativePath);
    }),
  );

  ipcMain.handle(
    'fm:sync:openConflictMerge',
    wrap('fm:sync:openConflictMerge', async (_e, configId: unknown, projectId: unknown, relativePath: unknown, configOverride: unknown) => {
      assertString(configId, 'configId');
      assertString(projectId, 'projectId');
      assertString(relativePath, 'relativePath');
      const session = requireSession();
      const syncConfig = getPreviewableSyncConfigOrThrow(session.config, configId, configOverride);
      return openConflictMerge(session.config, syncConfig, projectId, relativePath);
    }),
  );

  ipcMain.handle(
    'fm:sync:exportZip',
    wrap('fm:sync:exportZip', async (_e, configId: unknown, projectIds: unknown, outputFile: unknown) => {
      assertString(configId, 'configId');
      assertString(outputFile, 'outputFile');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'zip');
      const ids = resolveConfigProjectIds(session.config, syncConfig, projectIds);
      const result = await exportBundleZip(session.config, ids, outputFile);
      await mutate(({ config }) => {
        const next = normalizeSyncConfig({
          ...syncConfig,
          zip: { ...syncConfig.zip, exportFile: result.outputFile },
        });
        return {
          nextConfig: {
            ...config,
            syncConfigs: (config.syncConfigs ?? []).map(item => (item.id === next.id ? next : item)),
          },
          result: undefined as void,
        };
      });
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:pickExportFile',
    wrap('fm:sync:pickExportFile', async event => {
      const window = senderWindow(event);
      const res = window
        ? await dialog.showSaveDialog(window, {
          title: '导出 fm bundle',
          defaultPath: 'fm-bundle.fm-bundle.zip',
          filters: [{ name: 'fm bundle', extensions: ['zip'] }],
        })
        : await dialog.showSaveDialog({
          title: '导出 fm bundle',
          defaultPath: 'fm-bundle.fm-bundle.zip',
          filters: [{ name: 'fm bundle', extensions: ['zip'] }],
        });
      return res.canceled || !res.filePath ? null : res.filePath;
    }),
  );

  ipcMain.handle(
    'fm:sync:pickImportFile',
    wrap('fm:sync:pickImportFile', async event => {
      const window = senderWindow(event);
      const res = window
        ? await dialog.showOpenDialog(window, {
          title: '选择 fm bundle',
          filters: [{ name: 'fm bundle', extensions: ['zip'] }],
          properties: ['openFile'],
        })
        : await dialog.showOpenDialog({
          title: '选择 fm bundle',
          filters: [{ name: 'fm bundle', extensions: ['zip'] }],
          properties: ['openFile'],
        });
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
    }),
  );

  ipcMain.handle(
    'fm:sync:previewZip',
    wrap('fm:sync:previewZip', async (_e, file: unknown) => {
      assertString(file, 'file');
      return previewBundleZip(file);
    }),
  );

  ipcMain.handle(
    'fm:sync:applyZip',
    wrap('fm:sync:applyZip', async (_e, configId: unknown, file: unknown, plan: unknown) => {
      assertString(configId, 'configId');
      assertString(file, 'file');
      const session = requireSession();
      getSyncConfigOrThrow(session.config, configId, 'zip');
      return applyBundleZip(file, plan as SyncImportItem[]);
    }),
  );

  ipcMain.handle(
    'fm:sync:previewZipImport',
    wrap('fm:sync:previewZipImport', async (_e, configId: unknown, file: unknown, targets: unknown) => {
      assertString(configId, 'configId');
      assertString(file, 'file');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'zip');
      return previewZipImport(session.config, syncConfig, file, Array.isArray(targets) ? targets as SyncImportTarget[] : []);
    }),
  );

  ipcMain.handle(
    'fm:sync:applyZipImport',
    wrap('fm:sync:applyZipImport', async (_e, configId: unknown, file: unknown, targets: unknown) => {
      assertString(configId, 'configId');
      assertString(file, 'file');
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'zip');
      const { result, nextConfig } = await applyZipImport(
        session.config,
        syncConfig,
        file,
        Array.isArray(targets) ? targets as SyncImportTarget[] : [],
      );
      await mutate(() => ({ nextConfig, result: undefined as void }));
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:isServerRunning',
    wrap('fm:sync:isServerRunning', (_e, configId: unknown) => {
      assertString(configId, 'configId');
      return activeServers.has(configId);
    }),
  );

  ipcMain.handle(
    'fm:sync:startServer',
    wrap('fm:sync:startServer', async (_e, configId: unknown) => {
      assertString(configId, 'configId');
      const current = activeServers.get(configId);
      if (current) return { port: current.port };
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'p2p');
      const port = syncConfig.network.listenPort;
      const handlers = buildServerHandlers(configId);
      const server = await startSyncServer({ port }, handlers);
      activeServers.set(configId, server);
      return { port: server.port };
    }),
  );

  ipcMain.handle(
    'fm:sync:stopServer',
    wrap('fm:sync:stopServer', async (_e, configId: unknown) => {
      assertString(configId, 'configId');
      const server = activeServers.get(configId);
      if (!server) return undefined as void;
      await server.close();
      activeServers.delete(configId);
      return undefined as void;
    }),
  );
}

function buildServerHandlers(configId: string): ServerHandlers {
  return {
    isAllowedDevice: device => {
      const session = requireSession();
      const known = session.config.devices?.known ?? [];
      return known.some(d => d.id === device.id);
    },
    listManifest: async () => {
      const session = requireSession();
      const { manifest } = await buildLocalManifest(session.config);
      return manifest;
    },
    getProjectBundle: async id => {
      const session = requireSession();
      const project = session.config.projects.find(p => p.id === id);
      if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
      const { entriesByProject } = await buildLocalManifest(session.config, { projectIds: [id] });
      const entry = entriesByProject.get(id);
      if (!entry) throw new FmError('PROJECT_NOT_FOUND', `项目快照失败：${id}`);
      const { packProjectZip } = await import('./sync/zip-bundle.js');
      const zip = await packProjectZip(project.path, entry);
      return { entry, zip };
    },
    acceptProjectBundle: async (fromDevice, entry, zip) => {
      const session = requireSession();
      const syncConfig = getSyncConfigOrThrow(session.config, configId, 'p2p');
      const relayMode = syncConfig.network.relayMode;
      // 自动登记发送方为已知设备
      await mutate(({ config }) => ({
        nextConfig: upsertKnownDevice(config, {
          id: fromDevice.id,
          name: fromDevice.name,
          lastSeenAt: new Date().toISOString(),
        }),
        result: undefined as void,
      }));
      if (relayMode) {
        const dir = resolveRelayBundleDir(session.config, syncConfig.scope);
        if (!dir) {
          throw new FmError('SYNC_BUNDLE_DIR_MISSING', 'relay 模式需要至少一条共享目录同步配置');
        }
        // 把单包合并写入：以发送方设备为目录
        const manifest = {
          schema: 'fm.sync/v1' as const,
          generatedAt: new Date().toISOString(),
          device: fromDevice,
          projects: [entry],
        };
        await publishToBundleDir(dir, manifest, [{ entry, zip }]);
      } else {
        // 非 relay：解包到一个临时目录，由用户后续在 UI 中决定是否落地
        // 这里采用最简策略：拒绝主动 PUT
        throw new FmError('SYNC_TRANSPORT_FAILED', '当前设备未启用 relay 模式');
      }
      // 这两行只是为了在非 relay 分支也消费引用
      void readDeviceManifest;
      void readBundleProjectZip;
      void unpackProjectZip;
    },
  };
}

function getSyncConfigOrThrow<TType extends SyncConfig['type']>(
  config: AppConfig,
  configId: string,
  type?: TType,
): TType extends SyncConfig['type'] ? Extract<SyncConfig, { type: TType }> : SyncConfig {
  const syncConfig = config.syncConfigs?.find(item => item.id === configId);
  if (!syncConfig) {
    throw new FmError('CONFIG_INVALID', `同步配置不存在：${configId}`);
  }
  if (type && syncConfig.type !== type) {
    throw new FmError('CONFIG_INVALID', `${syncConfig.name} 不是 ${getSyncConfigTypeLabel(type)} 配置`);
  }
  return syncConfig as TType extends SyncConfig['type'] ? Extract<SyncConfig, { type: TType }> : SyncConfig;
}

function resolveConfigProjectIds(
  config: AppConfig,
  syncConfig: SyncConfig,
  requestedProjectIds: unknown,
): string[] {
  const allowed = new Set(resolveSyncProjectIds(syncConfig, config.projects));
  const requested = Array.isArray(requestedProjectIds)
    ? requestedProjectIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (requested.length === 0) {
    return [...allowed];
  }
  return requested.filter(id => allowed.has(id));
}

type PreviewKind = 'folder' | 'shared-dir';
type PreviewableSyncConfig = Extract<SyncConfig, { type: PreviewKind }>;

function isSyncConfigInput(value: unknown): value is SyncConfig {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { type?: unknown }).type === 'string';
}

function getPreviewableSyncConfigOverride(configId: string, configOverride: unknown): PreviewableSyncConfig | undefined {
  if (configOverride === undefined || configOverride === null) {
    return undefined;
  }
  if (!isSyncConfigInput(configOverride)) {
    throw new FmError('CONFIG_INVALID', '同步配置草稿格式不正确');
  }

  const normalized = normalizeSyncConfig(configOverride);
  if (normalized.id !== configId) {
    throw new FmError('CONFIG_INVALID', '同步配置草稿与当前配置不匹配');
  }
  if (normalized.type !== 'folder' && normalized.type !== 'shared-dir') {
    throw new FmError('CONFIG_INVALID', `${normalized.name} 不支持目录级对比`);
  }
  return normalized;
}

function getPreviewableSyncConfigOrThrow(
  config: AppConfig,
  configId: string,
  configOverride?: unknown,
): PreviewableSyncConfig {
  getSyncConfigOrThrow(config, configId);
  const override = getPreviewableSyncConfigOverride(configId, configOverride);
  if (override) {
    return override;
  }

  const syncConfig = getSyncConfigOrThrow(config, configId);
  if (syncConfig.type !== 'folder' && syncConfig.type !== 'shared-dir') {
    throw new FmError('CONFIG_INVALID', `${syncConfig.name} 不支持目录级对比`);
  }
  return syncConfig;
}

function getPreviewableSyncConfigOfTypeOrThrow<TType extends PreviewKind>(
  config: AppConfig,
  configId: string,
  type: TType,
  configOverride?: unknown,
): Extract<SyncConfig, { type: TType }> {
  const syncConfig = getPreviewableSyncConfigOrThrow(config, configId, configOverride);
  if (syncConfig.type !== type) {
    throw new FmError('CONFIG_INVALID', `${syncConfig.name} 不是 ${getSyncConfigTypeLabel(type)} 配置`);
  }
  return syncConfig as Extract<SyncConfig, { type: TType }>;
}

function isSyncPlanApplyRequest(value: unknown): value is SyncPlanApplyRequest {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as { projectIds?: unknown }).projectIds)
    && Array.isArray((value as { operations?: unknown }).operations);
}

function isSyncPlanSelectionState(value: unknown): value is Pick<SyncPlanApplyRequest, 'operations' | 'ranges'> {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as { operations?: unknown }).operations)
    && Array.isArray((value as { ranges?: unknown }).ranges);
}

function normalizeSyncPlanApplyRequest(request: SyncPlanApplyRequest): SyncPlanApplyRequest {
  return {
    sessionId: request.sessionId,
    projectIds: request.projectIds,
    operations: request.operations,
    ranges: Array.isArray(request.ranges) ? request.ranges : [],
  };
}

function normalizeSyncPlanSelectionState(
  selection: Pick<SyncPlanApplyRequest, 'operations' | 'ranges'>,
): { operations: SyncPlanApplyRequest['operations']; ranges: NonNullable<SyncPlanApplyRequest['ranges']> } {
  return {
    operations: selection.operations,
    ranges: Array.isArray(selection.ranges) ? selection.ranges : [],
  };
}

function resolveRelayBundleDir(config: AppConfig, preferredScope: SyncConfig['scope']): string | undefined {
  const sharedDirConfig = (config.syncConfigs ?? []).find(
    (item): item is Extract<SyncConfig, { type: 'shared-dir' }> => item.type === 'shared-dir' && item.scope === preferredScope,
  ) ?? (config.syncConfigs ?? []).find(
    (item): item is Extract<SyncConfig, { type: 'shared-dir' }> => item.type === 'shared-dir',
  );
  return sharedDirConfig?.sharedDir.bundleDir;
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

function registerCommandHandlers(): void {
  ipcMain.handle(
    'fm:commands:presets',
    wrap('fm:commands:presets', () => PRESET_COMMANDS),
  );

  ipcMain.handle(
    'fm:commands:list',
    wrap('fm:commands:list', () => requireSession().config.commands ?? []),
  );

  ipcMain.handle(
    'fm:commands:add',
    wrap('fm:commands:add', async (_e, input: unknown) => {
      const cmdInput = input as Omit<CustomCommand, 'id'>;
      return mutate(({ config }) => {
        const { config: next, command } = addCustomCommand(config, cmdInput);
        return { nextConfig: next, result: command };
      });
    }),
  );

  ipcMain.handle(
    'fm:commands:update',
    wrap('fm:commands:update', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(({ config }) => {
        const { config: next, command } = updateCustomCommand(
          config,
          id,
          patch as Partial<Omit<CustomCommand, 'id'>>,
        );
        return { nextConfig: next, result: command };
      });
    }),
  );

  ipcMain.handle(
    'fm:commands:remove',
    wrap('fm:commands:remove', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(({ config }) => ({ nextConfig: removeCustomCommand(config, id), result: undefined as void }));
    }),
  );

  ipcMain.handle(
    'fm:commands:run',
    wrap('fm:commands:run', async (_e, commandId: unknown, projectId: unknown) => {
      assertString(commandId, 'commandId');
      assertString(projectId, 'projectId');
      const session = requireSession();
      return runCommand(session.config, { commandId, projectId }, process.platform);
    }),
  );
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

async function runScanForRoot(event: IpcMainInvokeEvent, rootId: string): Promise<ScanReport> {
  const session = requireSession();
  const root = session.config.scanRoots.find(r => r.id === rootId);
  if (!root) throw new FmError('CONFIG_INVALID', `扫描根不存在：${rootId}`);

  const candidates = await scanRoot({
    rootPath: root.path,
    maxDepth: root.maxDepth,
    ignoreGlobs: session.config.ignore.globs,
    exactIgnorePaths: session.config.ignoredPaths,
    respectGitignore: session.config.ignore.respectGitignore,
    onProgress: info => {
      event.sender.send('fm:scan:progress', { rootId, ...info });
    },
  });

  return mutate(async ({ shared, local }) => {
    const { nextLocal, report } = await mergeScanResult(
      {
        shared,
        local,
        rootId,
      },
      candidates,
    );
    return { nextLocal, result: report };
  });
}

async function validateManualProject(
  input: ManualProjectInput,
  shared: ReturnType<typeof requireSession>['shared'],
  local: ReturnType<typeof requireSession>['local'],
): Promise<ManualProjectValidationResult> {
  const inspection = await inspectProjectDirectory(input.path, { globalIgnore: requireSession().config.ignore.globs });
  const conflicts: ManualProjectValidationResult['conflicts'] = [];
  const duplicatePath = findProjectByPath(shared, local, inspection.path, process.platform);
  if (duplicatePath) {
    conflicts.push({
      projectId: duplicatePath.id,
      projectName: duplicatePath.name,
      reason: '该目录已绑定到现有项目。',
    });
  }
  const fingerprint = normalizeFingerprint(input.fingerprint);
  for (const project of findFingerprintConflicts(shared.projects, fingerprint)) {
    conflicts.push({
      projectId: project.id,
      projectName: project.name,
      reason: '该指纹与现有项目完全相同。',
    });
  }
  for (const project of await findMatchingProjectsForDirectory(shared.projects, inspection)) {
    if (conflicts.some(item => item.projectId === project.id)) continue;
    conflicts.push({
      projectId: project.id,
      projectName: project.name,
      reason: '当前目录会被现有项目指纹命中，添加后将产生冲突。',
    });
  }
  return { valid: conflicts.length === 0, conflicts };
}

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string') {
    throw new FmError('INTERNAL', `参数 ${name} 必须为字符串`);
  }
}
