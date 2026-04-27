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
  type Project,
  type ProjectMetaPatch,
  type ScanReport,
  type SyncImportItem,
  type SyncPullItem,
  type SyncSettings,
} from '../shared/bridge.js';
import {
  type CustomCommand,
} from '../shared/sync-types.js';
import {
  addCategory,
  addScanRoot,
  applyProjectPatch,
  findProjectById,
  mergeScanResult,
  removeCategory,
  removeScanRoot,
  renameCategory,
  setCategoryColor,
  setProjectMetaFlag,
  updateScanRoot,
} from './project-repo.js';
import { switchConfigFile, getSnapshot, mutate, requireSession } from './session.js';
import { createConfig as createConfigFile } from './config-store.js';
import { scanRoot } from './scanner.js';
import { readMetaFile, removeMetaFile, writeMetaFile } from './meta-file.js';
import { FmError, toFmError } from './fm-error.js';
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

let activeServer: SyncServer | null = null;

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
    'fm:config:load',
    wrap('fm:config:load', async (_e, filePath: unknown): Promise<ConfigSnapshot> => {
      assertString(filePath, 'filePath');
      return switchConfigFile(filePath);
    }),
  );

  ipcMain.handle(
    'fm:config:create',
    wrap('fm:config:create', async (_e, filePath: unknown): Promise<ConfigSnapshot> => {
      assertString(filePath, 'filePath');
      const snapshot = await createConfigFile(filePath);
      return switchConfigFile(snapshot.path);
    }),
  );

  ipcMain.handle(
    'fm:config:save',
    wrap('fm:config:save', async (_e, data: unknown): Promise<void> => {
      const config = data as AppConfig;
      await mutate(() => ({ next: config, result: undefined as void }));
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
      const defaultPath = session.filePath;
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
      return mutate(config => {
        const { config: next, root } = addScanRoot(config, i);
        return { next, result: root };
      });
    }),
  );

  ipcMain.handle(
    'fm:scanRoots:update',
    wrap('fm:scanRoots:update', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(config => {
        const { config: next, root } = updateScanRoot(config, id, patch as never);
        return { next, result: root };
      });
    }),
  );

  ipcMain.handle(
    'fm:scanRoots:remove',
    wrap('fm:scanRoots:remove', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(config => ({ next: removeScanRoot(config, id), result: undefined as void }));
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

  // ── 项目 ──
  ipcMain.handle(
    'fm:projects:list',
    wrap('fm:projects:list', (): Project[] => requireSession().config.projects),
  );

  ipcMain.handle(
    'fm:projects:get',
    wrap('fm:projects:get', (_e, id: unknown) => {
      assertString(id, 'id');
      const project = findProjectById(requireSession().config, id);
      if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
      return project;
    }),
  );

  ipcMain.handle(
    'fm:projects:updateMeta',
    wrap('fm:projects:updateMeta', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(config => {
        const { config: next, project } = applyProjectPatch(config, id, patch as ProjectMetaPatch);
        return { next, result: project };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:writeMetaFile',
    wrap('fm:projects:writeMetaFile', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(async config => {
        const { config: applied, project } = applyProjectPatch(config, id, patch as ProjectMetaPatch);
        const category = project.categoryId
          ? applied.categories.find(c => c.id === project.categoryId)
          : undefined;
        await writeMetaFile(project.path, {
          name: project.name,
          category: category?.name,
          description: project.description,
          tags: project.tags,
        });
        const next = setProjectMetaFlag(applied, id, true);
        const updated = findProjectById(next, id)!;
        return { next, result: updated };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:removeMetaFile',
    wrap('fm:projects:removeMetaFile', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(async config => {
        const project = findProjectById(config, id);
        if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
        await removeMetaFile(project.path);
        const next = setProjectMetaFlag(config, id, false);
        return { next, result: findProjectById(next, id)! };
      });
    }),
  );

  ipcMain.handle(
    'fm:projects:revealInOs',
    wrap('fm:projects:revealInOs', async (_e, id: unknown) => {
      assertString(id, 'id');
      const project = findProjectById(requireSession().config, id);
      if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
      shell.openPath(path.normalize(project.path));
      return undefined as void;
    }),
  );

  // ── 分类 ──
  ipcMain.handle(
    'fm:categories:create',
    wrap('fm:categories:create', async (_e, input: unknown) => {
      return mutate(config => {
        const { config: next, category } = addCategory(config, input as never);
        return { next, result: category };
      });
    }),
  );

  ipcMain.handle(
    'fm:categories:rename',
    wrap('fm:categories:rename', async (_e, id: unknown, name: unknown) => {
      assertString(id, 'id');
      assertString(name, 'name');
      return mutate(config => {
        const { config: next, category } = renameCategory(config, id, name);
        return { next, result: category };
      });
    }),
  );

  ipcMain.handle(
    'fm:categories:setColor',
    wrap('fm:categories:setColor', async (_e, id: unknown, color: unknown) => {
      assertString(id, 'id');
      assertString(color, 'color');
      return mutate(config => {
        const { config: next, category } = setCategoryColor(config, id, color);
        return { next, result: category };
      });
    }),
  );

  ipcMain.handle(
    'fm:categories:remove',
    wrap('fm:categories:remove', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(config => ({ next: removeCategory(config, id), result: undefined as void }));
    }),
  );

  registerSyncHandlers();
  registerCommandHandlers();

  logger.info('IPC 处理器已注册');
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

function registerSyncHandlers(): void {
  ipcMain.handle(
    'fm:sync:getDevice',
    wrap('fm:sync:getDevice', async () => {
      return mutate(config => {
        const { config: next } = ensureDeviceRegistry(config);
        return { next, result: next.devices! };
      });
    }),
  );

  ipcMain.handle(
    'fm:sync:setSelfName',
    wrap('fm:sync:setSelfName', async (_e, name: unknown) => {
      assertString(name, 'name');
      return mutate(config => {
        const next = setSelfName(config, name);
        return { next, result: next.devices! };
      });
    }),
  );

  ipcMain.handle(
    'fm:sync:getSettings',
    wrap('fm:sync:getSettings', () => requireSession().config.sync ?? {}),
  );

  ipcMain.handle(
    'fm:sync:setSettings',
    wrap('fm:sync:setSettings', async (_e, settings: unknown) => {
      const s = settings as SyncSettings;
      return mutate(config => ({ next: { ...config, sync: s }, result: s }));
    }),
  );

  ipcMain.handle(
    'fm:sync:pickBundleDir',
    wrap('fm:sync:pickBundleDir', async event => {
      const window = senderWindow(event);
      const res = window
        ? await dialog.showOpenDialog(window, {
            title: '选择共享目录',
            properties: ['openDirectory', 'createDirectory'],
          })
        : await dialog.showOpenDialog({
            title: '选择共享目录',
            properties: ['openDirectory', 'createDirectory'],
          });
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
    }),
  );

  ipcMain.handle(
    'fm:sync:diffBundleDir',
    wrap('fm:sync:diffBundleDir', async (_e, projectIds: unknown) => {
      const ids = Array.isArray(projectIds) ? (projectIds as string[]) : undefined;
      const session = requireSession();
      const dir = session.config.sync?.bundleDir;
      if (!dir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', '未配置共享目录');
      const { diff } = await diffAgainstBundleDir(session.config, dir, { projectIds: ids });
      return diff;
    }),
  );

  ipcMain.handle(
    'fm:sync:pushBundleDir',
    wrap('fm:sync:pushBundleDir', async (_e, projectIds: unknown) => {
      const ids = Array.isArray(projectIds) ? (projectIds as string[]) : [];
      const session = requireSession();
      const dir = session.config.sync?.bundleDir;
      if (!dir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', '未配置共享目录');
      const result = await pushToBundleDir(session.config, dir, ids);
      // 更新 syncedAt/syncedHash
      await mutate(async config => {
        const { entriesByProject } = await buildLocalManifest(config, { projectIds: ids });
        const now = new Date().toISOString();
        const projects = config.projects.map(p => {
          if (!ids.includes(p.id)) return p;
          const entry = entriesByProject.get(p.id);
          return entry ? { ...p, syncedAt: now, syncedHash: entry.hash } : p;
        });
        return { next: { ...config, projects }, result: undefined as void };
      });
      return result;
    }),
  );

  ipcMain.handle(
    'fm:sync:pullBundleDir',
    wrap('fm:sync:pullBundleDir', async (_e, items: unknown) => {
      const list = items as SyncPullItem[];
      const session = requireSession();
      const dir = session.config.sync?.bundleDir;
      if (!dir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', '未配置共享目录');
      return pullFromBundleDir(dir, list);
    }),
  );

  ipcMain.handle(
    'fm:sync:exportZip',
    wrap('fm:sync:exportZip', async (_e, projectIds: unknown, outputFile: unknown) => {
      const ids = Array.isArray(projectIds) ? (projectIds as string[]) : [];
      assertString(outputFile, 'outputFile');
      const session = requireSession();
      return exportBundleZip(session.config, ids, outputFile);
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
    wrap('fm:sync:applyZip', async (_e, file: unknown, plan: unknown) => {
      assertString(file, 'file');
      return applyBundleZip(file, plan as SyncImportItem[]);
    }),
  );

  ipcMain.handle(
    'fm:sync:isServerRunning',
    wrap('fm:sync:isServerRunning', () => activeServer !== null),
  );

  ipcMain.handle(
    'fm:sync:startServer',
    wrap('fm:sync:startServer', async () => {
      if (activeServer) return { port: activeServer.port };
      const session = requireSession();
      const port = session.config.sync?.network?.listenPort ?? 41555;
      const handlers = buildServerHandlers();
      activeServer = await startSyncServer({ port }, handlers);
      return { port: activeServer.port };
    }),
  );

  ipcMain.handle(
    'fm:sync:stopServer',
    wrap('fm:sync:stopServer', async () => {
      if (!activeServer) return undefined as void;
      await activeServer.close();
      activeServer = null;
      return undefined as void;
    }),
  );
}

function buildServerHandlers(): ServerHandlers {
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
      const relayMode = session.config.sync?.network?.relayMode ?? false;
      // 自动登记发送方为已知设备
      await mutate(config => ({
        next: upsertKnownDevice(config, {
          id: fromDevice.id,
          name: fromDevice.name,
          lastSeenAt: new Date().toISOString(),
        }),
        result: undefined as void,
      }));
      if (relayMode) {
        const dir = session.config.sync?.bundleDir;
        if (!dir) {
          throw new FmError('SYNC_BUNDLE_DIR_MISSING', 'relay 模式需要配置 bundleDir');
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
      return mutate(config => {
        const { config: next, command } = addCustomCommand(config, cmdInput);
        return { next, result: command };
      });
    }),
  );

  ipcMain.handle(
    'fm:commands:update',
    wrap('fm:commands:update', async (_e, id: unknown, patch: unknown) => {
      assertString(id, 'id');
      return mutate(config => {
        const { config: next, command } = updateCustomCommand(
          config,
          id,
          patch as Partial<Omit<CustomCommand, 'id'>>,
        );
        return { next, result: command };
      });
    }),
  );

  ipcMain.handle(
    'fm:commands:remove',
    wrap('fm:commands:remove', async (_e, id: unknown) => {
      assertString(id, 'id');
      return mutate(config => ({ next: removeCustomCommand(config, id), result: undefined as void }));
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

async function runScanForRoot(
  event: IpcMainInvokeEvent,
  rootId: string,
): Promise<ScanReport> {
  const session = requireSession();
  const root = session.config.scanRoots.find(r => r.id === rootId);
  if (!root) throw new FmError('CONFIG_INVALID', `扫描根不存在：${rootId}`);

  const candidates = await scanRoot({
    rootPath: root.path,
    maxDepth: root.maxDepth,
    ignoreGlobs: session.config.ignore.globs,
    respectGitignore: session.config.ignore.respectGitignore,
    onProgress: info => {
      event.sender.send('fm:scan:progress', { rootId, ...info });
    },
  });

  return mutate(async config => {
    const { config: next, report } = await mergeScanResult(
      {
        config,
        rootId,
        platform: process.platform,
        metaResolver: async projectPath => readMetaFile(projectPath),
      },
      candidates,
    );
    return { next, result: report };
  });
}

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string') {
    throw new FmError('INTERNAL', `参数 ${name} 必须为字符串`);
  }
}
