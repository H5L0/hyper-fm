// ---------------------------------------------------------------------------
// 全局状态：基于 React useReducer + Context
// 不引入 zustand，避免额外依赖
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { toast as sonnerToast } from 'sonner';
import type {
  AppPreferences,
  AppConfig,
  ConfigPaths,
  DynamicTagId,
  ManualProjectInput,
  Project,
  ProjectRuntimeInfo,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanRoot,
  TagDefinition,
  TagGroupDefinition,
} from '@shared/bridge.js';
import { ensureRequiredTagGroups, isRequiredTagGroupName } from '@shared/dynamic-tags.js';

const PROJECT_RUNTIME_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_UI_PREFERENCES: AppPreferences['ui'] = {
  theme: 'system',
  view: 'grid',
};

export interface CachedProjectRuntimeInfo {
  directoryModifiedAt?: string;
  fetchedAt: number;
}

function pruneProjectRuntimeInfo(
  projectRuntimeInfo: Record<string, CachedProjectRuntimeInfo>,
  projects: readonly Project[],
): Record<string, CachedProjectRuntimeInfo> {
  const ids = new Set(projects.map(project => project.id));
  return Object.fromEntries(
    Object.entries(projectRuntimeInfo).filter(([projectId]) => ids.has(projectId)),
  );
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type TagFilter =
  | 'ALL'
  | { kind: 'tag'; tag: string }
  | { kind: 'group'; group: string }
  | { kind: 'dynamic'; id: DynamicTagId };
export type View = 'grid' | 'list';
export type Route = 'browse' | 'scan-settings' | 'sync-settings' | 'settings' | 'warnings';

export interface AppState {
  ready: boolean;
  hasLoadedConfig: boolean;
  appPreferences: AppPreferences;
  configPaths: ConfigPaths;
  config: AppConfig;
  projectRuntimeInfo: Record<string, CachedProjectRuntimeInfo>;
  tagFilter: TagFilter;
  search: string;
  view: View;
  route: Route;
  selectedProjectId?: string;
  fileViewProjectId?: string;
  scanProgress?: ScanProgressEvent & { running: boolean };
  pendingNewProject: number;
}

const INITIAL_STATE: AppState = {
  ready: false,
  hasLoadedConfig: false,
  appPreferences: {
    trayEnabled: true,
    autoLaunchEnabled: false,
    ui: DEFAULT_UI_PREFERENCES,
  },
  configPaths: { sharedPath: '', localPath: '', configId: '' },
  config: {
    version: 2,
    name: 'fm',
    description: '',
    scanRoots: [],
    ignore: { respectGitignore: true, globs: [] },
    projects: [],
    ui: { theme: 'system', view: 'grid' },
    warnings: [],
    ignoredPaths: [],
    tags: [],
    tagGroups: ensureRequiredTagGroups(),
  },
  projectRuntimeInfo: {},
  tagFilter: 'ALL',
  search: '',
  view: 'grid',
  route: 'browse',
  pendingNewProject: 0,
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

type Action =
  | { type: 'init'; configPaths: ConfigPaths; config: AppConfig; hasLoadedConfig: boolean; appPreferences: AppPreferences }
  | { type: 'config'; config: AppConfig }
  | { type: 'appPreferences'; value: AppPreferences }
  | { type: 'configPaths'; configPaths: ConfigPaths }
  | { type: 'projects'; projects: Project[] }
  | { type: 'updateProject'; project: Project }
  | { type: 'projectRuntimeInfo'; value: Record<string, CachedProjectRuntimeInfo> }
  | { type: 'scanRoot'; root: ScanRoot }
  | { type: 'tagFilter'; value: TagFilter }
  | { type: 'search'; value: string }
  | { type: 'view'; value: View }
  | { type: 'route'; value: Route }
  | { type: 'select'; id?: string }
  | { type: 'openProjectFiles'; id: string }
  | { type: 'closeProjectFiles' }
  | { type: 'progress'; value?: ScanProgressEvent & { running: boolean } }
  | { type: 'triggerNewProject' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'init':
      return {
        ...state,
        ready: true,
        hasLoadedConfig: action.hasLoadedConfig,
        appPreferences: action.appPreferences,
        configPaths: action.configPaths,
        config: action.config,
        projectRuntimeInfo: pruneProjectRuntimeInfo(state.projectRuntimeInfo, action.config.projects),
        view: action.appPreferences.ui.view,
      };
    case 'config':
      return {
        ...state,
        config: action.config,
        projectRuntimeInfo: pruneProjectRuntimeInfo(state.projectRuntimeInfo, action.config.projects),
      };
    case 'appPreferences':
      return { ...state, appPreferences: action.value, view: action.value.ui.view };
    case 'configPaths':
      return { ...state, configPaths: action.configPaths };
    case 'projects':
      return {
        ...state,
        config: { ...state.config, projects: action.projects },
        projectRuntimeInfo: pruneProjectRuntimeInfo(state.projectRuntimeInfo, action.projects),
      };
    case 'updateProject': {
      const projects = state.config.projects.map(p =>
        p.id === action.project.id ? action.project : p,
      );
      return {
        ...state,
        config: { ...state.config, projects },
        projectRuntimeInfo: pruneProjectRuntimeInfo(state.projectRuntimeInfo, projects),
      };
    }
    case 'projectRuntimeInfo':
      return {
        ...state,
        projectRuntimeInfo: { ...state.projectRuntimeInfo, ...action.value },
      };
    case 'scanRoot': {
      const roots = state.config.scanRoots.some(r => r.id === action.root.id)
        ? state.config.scanRoots.map(r => (r.id === action.root.id ? action.root : r))
        : [...state.config.scanRoots, action.root];
      return { ...state, config: { ...state.config, scanRoots: roots } };
    }
    case 'tagFilter':
      return { ...state, tagFilter: action.value };
    case 'search':
      return { ...state, search: action.value };
    case 'view':
      return { ...state, view: action.value };
    case 'route':
      return { ...state, route: action.value };
    case 'select':
      return {
        ...state,
        selectedProjectId: action.id,
        fileViewProjectId: action.id ? undefined : state.fileViewProjectId,
      };
    case 'openProjectFiles':
      return {
        ...state,
        route: 'browse',
        selectedProjectId: undefined,
        fileViewProjectId: action.id,
      };
    case 'closeProjectFiles':
      return { ...state, fileViewProjectId: undefined };
    case 'progress':
      return { ...state, scanProgress: action.value };
    case 'triggerNewProject':
      return { ...state, route: 'browse', pendingNewProject: state.pendingNewProject + 1 };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AppActions {
  loadConfig(filePath?: string): Promise<void>;
  pickAndLoadConfig(): Promise<void>;
  pickAndCreateConfig(): Promise<void>;
  refreshProjects(): Promise<void>;
  runScanAll(): Promise<void>;
  runScanOne(rootId: string): Promise<void>;
  refreshProjectRuntimeInfo(projectIds?: string[], force?: boolean): Promise<void>;
  ignorePath(path: string): Promise<void>;
  setTagFilter(value: TagFilter): void;
  setSearch(value: string): void;
  setView(value: View): void;
  setRoute(value: Route): void;
  selectProject(id?: string): void;
  openProjectFiles(id: string): void;
  closeProjectFiles(): void;
  saveProject(id: string, patch: ProjectMetaPatch, writeFile: boolean): Promise<void>;
  removeMetaFile(id: string): Promise<void>;
  revealProject(id: string): Promise<void>;
  addProject(input: ManualProjectInput): Promise<Project>;
  removeProject(id: string): Promise<void>;
  pickProjectDirectory(): Promise<string | null>;
  pickProjectDirectories(): Promise<string[]>;
  addScanRoot(input: { path: string; label?: string; maxDepth?: number }): Promise<ScanRoot>;
  updateScanRoot(id: string, patch: Partial<Omit<ScanRoot, 'id'>>): Promise<void>;
  removeScanRoot(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  saveConfigMeta(name: string, description: string): Promise<void>;
  saveAppPreferences(patch: Partial<AppPreferences>): Promise<void>;
  saveIgnore(patch: Partial<AppConfig['ignore']>): Promise<void>;
  saveTheme(theme: AppConfig['ui']['theme']): Promise<void>;
  upsertTag(tag: TagDefinition): Promise<void>;
  removeTag(name: string): Promise<void>;
  renameTag(oldName: string, newName: string): Promise<void>;
  moveTagToFront(name: string): Promise<void>;
  upsertTagGroup(group: TagGroupDefinition, previousName?: string): Promise<void>;
  removeTagGroup(name: string): Promise<void>;
  toast(level: 'info' | 'success' | 'error', text: string): void;
  triggerNewProject(): void;
}

const StateContext = createContext<AppState | undefined>(undefined);
const ActionsContext = createContext<AppActions | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const toast = useCallback((level: 'info' | 'success' | 'error', text: string) => {
    sonnerToast[level](text);
  }, []);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      toast('error', message);
      console.error(error);
    },
    [toast],
  );

  const applySnapshot = useCallback((
    snapshot: { paths: ConfigPaths; data: AppConfig; hasLoadedConfig: boolean },
    appPreferences = stateRef.current.appPreferences,
  ) => {
    dispatch({
      type: 'init',
      configPaths: snapshot.paths,
      config: snapshot.data,
      hasLoadedConfig: snapshot.hasLoadedConfig,
      appPreferences,
    });
  }, []);

  const migrateLegacyUiPreferences = useCallback(async (
    snapshot: { data: AppConfig },
    appPreferences: AppPreferences,
  ): Promise<AppPreferences> => {
    const currentUi = appPreferences.ui;
    const legacyUi = snapshot.data.ui;
    const appUiIsDefault = currentUi.theme === DEFAULT_UI_PREFERENCES.theme
      && currentUi.view === DEFAULT_UI_PREFERENCES.view;
    const legacyUiDiffers = legacyUi.theme !== DEFAULT_UI_PREFERENCES.theme
      || legacyUi.view !== DEFAULT_UI_PREFERENCES.view;

    if (!appUiIsDefault || !legacyUiDiffers) {
      return appPreferences;
    }

    return window.fm.app.updatePreferences({
      ui: {
        theme: legacyUi.theme,
        view: legacyUi.view,
      },
    });
  }, []);

  const loadConfig = useCallback(
    async (filePath?: string) => {
      try {
        const [snapshot, loadedAppPreferences] = await Promise.all([
          filePath
            ? window.fm.config.load(filePath)
            : window.fm.config.current(),
          window.fm.app.getPreferences(),
        ]);
        const appPreferences = await migrateLegacyUiPreferences(snapshot, loadedAppPreferences);
        applySnapshot(snapshot, appPreferences);
      } catch (error) {
        handleError(error, '加载配置失败');
      }
    },
    [applySnapshot, handleError, migrateLegacyUiPreferences],
  );

  const pickAndLoadConfig = useCallback(async () => {
    try {
      const filePath = await window.fm.config.pick('open');
      if (filePath) {
        const inspection = await window.fm.config.inspectOpen(filePath);
        let snapshot;

        if (inspection.selectedKind === 'shared' && !inspection.localExists) {
          const createNew = window.confirm(
            `未找到对应的本地配置：\n${inspection.localPath}\n\n确定：创建新的本地配置\n取消：手动选择已有的 local 配置`,
          );
          if (createNew) {
            snapshot = await window.fm.config.createLocalForShared(inspection.sharedPath);
          } else {
            const localPath = await window.fm.config.pick('open');
            if (!localPath) return;
            snapshot = await window.fm.config.load(localPath);
          }
        } else {
          snapshot = await window.fm.config.load(filePath);
        }

        applySnapshot(snapshot);
        toast('success', '配置已加载');
      }
    } catch (error) {
      handleError(error, '加载配置失败');
    }
  }, [applySnapshot, handleError, toast]);

  const pickAndCreateConfig = useCallback(async () => {
    try {
      const filePath = await window.fm.config.pick('save');
      if (filePath) {
        const snapshot = await window.fm.config.create(filePath);
        applySnapshot(snapshot);
        toast('success', '已创建新配置');
      }
    } catch (error) {
      handleError(error, '创建配置失败');
    }
  }, [applySnapshot, handleError, toast]);

  const refreshProjects = useCallback(async () => {
    try {
      const projects = await window.fm.projects.list();
      dispatch({ type: 'projects', projects });
    } catch (error) {
      handleError(error, '刷新项目列表失败');
    }
  }, [handleError]);

  const reloadCurrent = useCallback(async () => {
    const snap = await window.fm.config.current();
    applySnapshot(snap);
  }, [applySnapshot]);

  const refreshProjectRuntimeInfo = useCallback(async (projectIds?: string[], force = false) => {
    const allProjectIds = stateRef.current.config.projects.map(project => project.id);
    const targetIds = [...new Set((projectIds && projectIds.length > 0 ? projectIds : allProjectIds)
      .filter(projectId => allProjectIds.includes(projectId)))];
    if (targetIds.length === 0) return;

    const now = Date.now();
    const staleIds = force
      ? targetIds
      : targetIds.filter(projectId => {
        const cached = stateRef.current.projectRuntimeInfo[projectId];
        return !cached || now - cached.fetchedAt >= PROJECT_RUNTIME_CACHE_TTL_MS;
      });

    if (staleIds.length === 0) return;

    try {
      const runtimeInfos = await window.fm.projects.listRuntimeInfo(staleIds);
      dispatch({
        type: 'projectRuntimeInfo',
        value: Object.fromEntries(runtimeInfos.map((info: ProjectRuntimeInfo) => [
          info.projectId,
          {
            directoryModifiedAt: info.directoryModifiedAt,
            fetchedAt: now,
          } satisfies CachedProjectRuntimeInfo,
        ])),
      });
    } catch (error) {
      console.error('读取项目目录修改时间失败', error);
    }
  }, []);

  const runScanAll = useCallback(async () => {
    const toastId = sonnerToast.loading('扫描中…');
    dispatch({
      type: 'progress',
      value: { rootId: '', scanned: 0, found: 0, running: true },
    });
    try {
      const reports = await window.fm.scan.runAll();
      const total = reports.reduce(
        (acc, r) => ({ matched: acc.matched + r.matched, updated: acc.updated + r.updated, warnings: acc.warnings + r.warnings }),
        { matched: 0, updated: 0, warnings: 0 },
      );
      dispatch({ type: 'progress', value: undefined });
      await reloadCurrent();
      sonnerToast.success(`扫描完成：匹配 ${total.matched}，更新 ${total.updated}${total.warnings > 0 ? `，告警 ${total.warnings}` : ''}`, { id: toastId });
    } catch (error) {
      dispatch({ type: 'progress', value: undefined });
      console.error(error);
      sonnerToast.error(error instanceof Error ? error.message : '扫描失败', { id: toastId });
    }
  }, [reloadCurrent]);

  const runScanOne = useCallback(
    async (rootId: string) => {
      const toastId = sonnerToast.loading('扫描中…');
      dispatch({
        type: 'progress',
        value: { rootId, scanned: 0, found: 0, running: true },
      });
      try {
        const report = await window.fm.scan.runOne(rootId);
        dispatch({ type: 'progress', value: undefined });
        await reloadCurrent();
        sonnerToast.success(`扫描完成：匹配 ${report.matched}，更新 ${report.updated}${report.warnings > 0 ? `，告警 ${report.warnings}` : ''}`, { id: toastId });
      } catch (error) {
        dispatch({ type: 'progress', value: undefined });
        console.error(error);
        sonnerToast.error(error instanceof Error ? error.message : '扫描失败', { id: toastId });
      }
    },
    [reloadCurrent],
  );

  const ignorePathAction = useCallback(
    async (path: string) => {
      try {
        await window.fm.scan.ignorePath(path);
        await reloadCurrent();
      } catch (error) {
        handleError(error, '忽略路径失败');
      }
    },
    [handleError, reloadCurrent],
  );

  const saveProject = useCallback(
    async (id: string, patch: ProjectMetaPatch, writeFile: boolean) => {
      try {
        const shouldWriteFile = writeFile || patch.fingerprint?.kind === 'metadata';
        const project = shouldWriteFile
          ? await window.fm.projects.writeMetaFile(id, patch)
          : await window.fm.projects.updateMeta(id, patch);
        dispatch({ type: 'updateProject', project });
        toast('success', shouldWriteFile ? '已写入 .meta-data' : '已保存到数据库');
      } catch (error) {
        handleError(error, '保存项目失败');
      }
    },
    [handleError, toast],
  );

  const removeMetaFile = useCallback(
    async (id: string) => {
      try {
        const project = await window.fm.projects.removeMetaFile(id);
        dispatch({ type: 'updateProject', project });
        toast('success', '已删除 .meta-data');
      } catch (error) {
        handleError(error, '删除 .meta-data 失败');
      }
    },
    [handleError, toast],
  );

  const revealProject = useCallback(
    async (id: string) => {
      try {
        await window.fm.projects.revealInOs(id);
      } catch (error) {
        handleError(error, '打开文件夹失败');
      }
    },
    [handleError],
  );

  const addProjectAction = useCallback(
    async (input: ManualProjectInput) => {
      const project = await window.fm.projects.add(input);
      dispatch({ type: 'updateProject', project });
      // 同时插入新项目（store 中 updateProject 仅替换；新增需 reload）
      await reloadCurrent();
      return project;
    },
    [reloadCurrent],
  );

  const removeProjectAction = useCallback(
    async (id: string) => {
      try {
        await window.fm.projects.remove(id);
        await reloadCurrent();
      } catch (error) {
        handleError(error, '删除项目失败');
      }
    },
    [handleError, reloadCurrent],
  );

  const pickProjectDirectoryAction = useCallback(
    () => window.fm.projects.pickDirectory(),
    [],
  );

  const pickProjectDirectoriesAction = useCallback(
    () => window.fm.projects.pickDirectories(),
    [],
  );

  const addScanRootAction = useCallback(
    async (input: { path: string; label?: string; maxDepth?: number }) => {
      const root = await window.fm.scanRoots.add(input);
      dispatch({ type: 'scanRoot', root });
      return root;
    },
    [],
  );

  const updateScanRootAction = useCallback(
    async (id: string, patch: Partial<Omit<ScanRoot, 'id'>>) => {
      const root = await window.fm.scanRoots.update(id, patch);
      dispatch({ type: 'scanRoot', root });
    },
    [],
  );

  const removeScanRootAction = useCallback(
    async (id: string) => {
      await window.fm.scanRoots.remove(id);
      await reloadCurrent();
    },
    [reloadCurrent],
  );

  const pickDirectory = useCallback(() => window.fm.scanRoots.pickDirectory(), []);

  const saveConfigMeta = useCallback(
    async (name: string, description: string) => {
      const next: AppConfig = {
        ...stateRef.current.config,
        name: name.trim() || stateRef.current.config.name,
        description: description.trim(),
      };
      await window.fm.config.save(next);
      dispatch({ type: 'config', config: next });
    },
    [],
  );

  const saveAppPreferences = useCallback(
    async (patch: Partial<AppPreferences>) => {
      const next = await window.fm.app.updatePreferences(patch);
      dispatch({ type: 'appPreferences', value: next });
    },
    [],
  );

  const saveIgnore = useCallback(
    async (patch: Partial<AppConfig['ignore']>) => {
      const next: AppConfig = {
        ...stateRef.current.config,
        ignore: { ...stateRef.current.config.ignore, ...patch },
      };
      await window.fm.config.save(next);
      dispatch({ type: 'config', config: next });
    },
    [],
  );

  const saveTheme = useCallback(async (theme: AppConfig['ui']['theme']) => {
    const next = await window.fm.app.updatePreferences({
      ui: {
        ...stateRef.current.appPreferences.ui,
        theme,
      },
    });
    dispatch({ type: 'appPreferences', value: next });
  }, []);

  const setView = useCallback((value: View) => {
    dispatch({ type: 'view', value });
    void window.fm.app.updatePreferences({
      ui: {
        ...stateRef.current.appPreferences.ui,
        view: value,
      },
    }).then(next => {
      dispatch({ type: 'appPreferences', value: next });
    }).catch(error => {
      handleError(error, '保存视图偏好失败');
    });
  }, [handleError]);

  const upsertTag = useCallback(async (tag: TagDefinition) => {
    try {
      const tags = await window.fm.tags.upsert(tag);
      const next: AppConfig = { ...stateRef.current.config, tags };
      dispatch({ type: 'config', config: next });
    } catch (error) {
      handleError(error, '保存标签失败');
    }
  }, [handleError]);

  const removeTag = useCallback(async (name: string) => {
    try {
      const activeFilter = stateRef.current.tagFilter;
      const activeGroup = activeFilter !== 'ALL' && activeFilter.kind === 'group'
        ? (stateRef.current.config.tagGroups ?? []).find(group => group.name === activeFilter.group)
        : undefined;
      const shouldResetTagFilter = activeFilter !== 'ALL' && activeFilter.kind === 'tag' && activeFilter.tag === name;
      const shouldResetGroupFilter = Boolean(activeGroup && activeGroup.tags.includes(name) && activeGroup.tags.length === 1);
      await window.fm.tags.remove(name);
      await reloadCurrent();
      if (shouldResetTagFilter || shouldResetGroupFilter) {
        dispatch({ type: 'tagFilter', value: 'ALL' });
      }
    } catch (error) {
      handleError(error, '删除标签失败');
      throw error;
    }
  }, [handleError, reloadCurrent]);

  const renameTag = useCallback(async (oldName: string, newName: string) => {
    try {
      const activeFilter = stateRef.current.tagFilter;
      const tags = await window.fm.tags.rename(oldName, newName);
      // 标签重命名也会更新项目里的 tags 数组，重新拉一次配置
      await reloadCurrent();
      if (activeFilter !== 'ALL' && activeFilter.kind === 'tag' && activeFilter.tag === oldName) {
        dispatch({ type: 'tagFilter', value: { kind: 'tag', tag: newName } });
      }
      // reloadCurrent 已经覆盖 tags；上面这一行只是为了保证 tags 字段也被更新
      void tags;
    } catch (error) {
      handleError(error, '重命名标签失败');
    }
  }, [handleError, reloadCurrent]);

  const moveTagToFront = useCallback(async (name: string) => {
    try {
      const tags = stateRef.current.config.tags ?? [];
      const target = tags.find(t => t.name === name);
      if (!target) return;
      const reordered = [target, ...tags.filter(t => t.name !== name)];
      const nextTags = await window.fm.tags.reorder(reordered);
      const next: AppConfig = { ...stateRef.current.config, tags: nextTags };
      dispatch({ type: 'config', config: next });
    } catch (error) {
      handleError(error, '移动标签失败');
    }
  }, [handleError]);

  const upsertTagGroup = useCallback(async (group: TagGroupDefinition, previousName?: string) => {
    try {
      const normalizedName = group.name.trim();
      const normalizedTags = [...new Set(group.tags.map(tag => tag.trim()).filter(Boolean))];
      if (previousName && isRequiredTagGroupName(previousName) && previousName !== normalizedName) {
        throw new Error(`${previousName} 是系统必备标签组，不能改名`);
      }
      const groups = stateRef.current.config.tagGroups ?? [];
      const nextGroups = [
        ...groups.filter(item => item.name !== (previousName ?? normalizedName) && item.name !== normalizedName),
        { name: normalizedName, tags: normalizedTags },
      ];
      const nextConfig: AppConfig = {
        ...stateRef.current.config,
        tagGroups: ensureRequiredTagGroups(nextGroups),
      };
      await window.fm.config.save(nextConfig);
      dispatch({ type: 'config', config: nextConfig });
      if (
        previousName
        && previousName !== normalizedName
        && stateRef.current.tagFilter !== 'ALL'
        && stateRef.current.tagFilter.kind === 'group'
        && stateRef.current.tagFilter.group === previousName
      ) {
        dispatch({ type: 'tagFilter', value: { kind: 'group', group: normalizedName } });
      }
    } catch (error) {
      handleError(error, '保存标签组失败');
    }
  }, [handleError]);

  const removeTagGroup = useCallback(async (name: string) => {
    try {
      if (isRequiredTagGroupName(name)) {
        throw new Error(`${name} 是系统必备标签组，不能删除`);
      }
      const nextConfig: AppConfig = {
        ...stateRef.current.config,
        tagGroups: ensureRequiredTagGroups(
          (stateRef.current.config.tagGroups ?? []).filter(group => group.name !== name),
        ),
      };
      await window.fm.config.save(nextConfig);
      dispatch({ type: 'config', config: nextConfig });
      if (
        stateRef.current.tagFilter !== 'ALL'
        && stateRef.current.tagFilter.kind === 'group'
        && stateRef.current.tagFilter.group === name
      ) {
        dispatch({ type: 'tagFilter', value: 'ALL' });
      }
    } catch (error) {
      handleError(error, '删除标签组失败');
    }
  }, [handleError]);

  // 初始化：拉取当前会话
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // 扫描进度订阅
  useEffect(() => {
    const off = window.fm.scan.onProgress(event => {
      dispatch({
        type: 'progress',
        value: { ...event, running: true },
      });
    });
    return off;
  }, []);

  // 托盘新建项目事件订阅
  useEffect(() => {
    const off = window.fm.app.onOpenNewProject(() => {
      dispatch({ type: 'triggerNewProject' });
    });
    return off;
  }, []);

  useEffect(() => {
    if (!state.ready || state.config.projects.length === 0) return undefined;
    void refreshProjectRuntimeInfo(undefined, true);
    const timer = window.setInterval(() => {
      void refreshProjectRuntimeInfo();
    }, PROJECT_RUNTIME_CACHE_TTL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshProjectRuntimeInfo, state.ready, state.config.projects.length]);

  const actions = useMemo<AppActions>(
    () => ({
      loadConfig,
      pickAndLoadConfig,
      pickAndCreateConfig,
      refreshProjects,
      runScanAll,
      runScanOne,
      refreshProjectRuntimeInfo,
      ignorePath: ignorePathAction,
      setTagFilter: value => dispatch({ type: 'tagFilter', value }),
      setSearch: value => dispatch({ type: 'search', value }),
      setView,
      setRoute: value => dispatch({ type: 'route', value }),
      selectProject: id => dispatch({ type: 'select', id }),
      openProjectFiles: id => dispatch({ type: 'openProjectFiles', id }),
      closeProjectFiles: () => dispatch({ type: 'closeProjectFiles' }),
      saveProject,
      removeMetaFile,
      revealProject,
      addProject: addProjectAction,
      removeProject: removeProjectAction,
      pickProjectDirectory: pickProjectDirectoryAction,
      pickProjectDirectories: pickProjectDirectoriesAction,
      addScanRoot: addScanRootAction,
      updateScanRoot: updateScanRootAction,
      removeScanRoot: removeScanRootAction,
      pickDirectory,
      saveConfigMeta,
      saveAppPreferences,
      saveIgnore,
      saveTheme,
      upsertTag,
      removeTag,
      renameTag,
      moveTagToFront,
      upsertTagGroup,
      removeTagGroup,
      toast,
      triggerNewProject: () => dispatch({ type: 'triggerNewProject' }),
    }),
    [
      addProjectAction,
      addScanRootAction,
      loadConfig,
      pickAndCreateConfig,
      pickAndLoadConfig,
      pickDirectory,
      pickProjectDirectoryAction,
      pickProjectDirectoriesAction,
      refreshProjects,
      refreshProjectRuntimeInfo,
      ignorePathAction,
      removeMetaFile,
      removeProjectAction,
      removeScanRootAction,
      removeTag,
      removeTagGroup,
      renameTag,
      moveTagToFront,
      revealProject,
      runScanAll,
      runScanOne,
      saveConfigMeta,
      saveAppPreferences,
      saveIgnore,
      saveProject,
      saveTheme,
      setView,
      toast,
      updateScanRootAction,
      upsertTag,
      upsertTagGroup,
    ],
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error('useAppState 必须在 AppStoreProvider 内调用');
  return ctx;
}

export function useAppActions(): AppActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useAppActions 必须在 AppStoreProvider 内调用');
  return ctx;
}
