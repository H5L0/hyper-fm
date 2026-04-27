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
import type {
  AppConfig,
  Category,
  Project,
  ProjectMetaPatch,
  ScanProgressEvent,
  ScanRoot,
} from '@shared/bridge.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type CategoryFilter = 'ALL' | 'UNCATEGORIZED' | string;
export type View = 'grid' | 'list';
export type Route = 'browse' | 'settings';

export interface ToastMessage {
  id: string;
  level: 'info' | 'success' | 'error';
  text: string;
}

export interface AppState {
  ready: boolean;
  configPath: string;
  config: AppConfig;
  categoryFilter: CategoryFilter;
  search: string;
  view: View;
  route: Route;
  selectedProjectId?: string;
  scanProgress?: ScanProgressEvent & { running: boolean };
  toasts: ToastMessage[];
}

const INITIAL_STATE: AppState = {
  ready: false,
  configPath: '',
  config: {
    version: 1,
    scanRoots: [],
    ignore: { respectGitignore: true, globs: [] },
    categories: [],
    projects: [],
    ui: { theme: 'system', view: 'grid' },
  },
  categoryFilter: 'ALL',
  search: '',
  view: 'grid',
  route: 'browse',
  toasts: [],
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

type Action =
  | { type: 'init'; configPath: string; config: AppConfig }
  | { type: 'config'; config: AppConfig }
  | { type: 'configPath'; configPath: string }
  | { type: 'projects'; projects: Project[] }
  | { type: 'updateProject'; project: Project }
  | { type: 'category'; category: Category }
  | { type: 'scanRoot'; root: ScanRoot }
  | { type: 'categoryFilter'; value: CategoryFilter }
  | { type: 'search'; value: string }
  | { type: 'view'; value: View }
  | { type: 'route'; value: Route }
  | { type: 'select'; id?: string }
  | { type: 'progress'; value?: ScanProgressEvent & { running: boolean } }
  | { type: 'toast:push'; toast: ToastMessage }
  | { type: 'toast:pop'; id: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'init':
      return {
        ...state,
        ready: true,
        configPath: action.configPath,
        config: action.config,
        view: action.config.ui.view,
      };
    case 'config':
      return { ...state, config: action.config };
    case 'configPath':
      return { ...state, configPath: action.configPath };
    case 'projects':
      return { ...state, config: { ...state.config, projects: action.projects } };
    case 'updateProject': {
      const projects = state.config.projects.map(p =>
        p.id === action.project.id ? action.project : p,
      );
      return { ...state, config: { ...state.config, projects } };
    }
    case 'category': {
      const categories = state.config.categories.some(c => c.id === action.category.id)
        ? state.config.categories.map(c => (c.id === action.category.id ? action.category : c))
        : [...state.config.categories, action.category];
      return { ...state, config: { ...state.config, categories } };
    }
    case 'scanRoot': {
      const roots = state.config.scanRoots.some(r => r.id === action.root.id)
        ? state.config.scanRoots.map(r => (r.id === action.root.id ? action.root : r))
        : [...state.config.scanRoots, action.root];
      return { ...state, config: { ...state.config, scanRoots: roots } };
    }
    case 'categoryFilter':
      return { ...state, categoryFilter: action.value };
    case 'search':
      return { ...state, search: action.value };
    case 'view':
      return { ...state, view: action.value };
    case 'route':
      return { ...state, route: action.value };
    case 'select':
      return { ...state, selectedProjectId: action.id };
    case 'progress':
      return { ...state, scanProgress: action.value };
    case 'toast:push':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'toast:pop':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
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
  setCategoryFilter(value: CategoryFilter): void;
  setSearch(value: string): void;
  setView(value: View): void;
  setRoute(value: Route): void;
  selectProject(id?: string): void;
  saveProject(id: string, patch: ProjectMetaPatch, writeFile: boolean): Promise<void>;
  removeMetaFile(id: string): Promise<void>;
  revealProject(id: string): Promise<void>;
  addCategory(name: string, color?: string): Promise<Category>;
  renameCategory(id: string, name: string): Promise<void>;
  setCategoryColor(id: string, color: string): Promise<void>;
  removeCategory(id: string): Promise<void>;
  addScanRoot(input: { path: string; label?: string; maxDepth?: number }): Promise<void>;
  updateScanRoot(id: string, patch: Partial<Omit<ScanRoot, 'id'>>): Promise<void>;
  removeScanRoot(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  saveIgnore(patch: Partial<AppConfig['ignore']>): Promise<void>;
  saveTheme(theme: AppConfig['ui']['theme']): Promise<void>;
  toast(level: ToastMessage['level'], text: string): void;
  dismissToast(id: string): void;
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

  const toast = useCallback((level: ToastMessage['level'], text: string) => {
    const id = `toast_${Math.random().toString(36).slice(2, 8)}`;
    dispatch({ type: 'toast:push', toast: { id, level, text } });
    setTimeout(() => dispatch({ type: 'toast:pop', id }), level === 'error' ? 6000 : 3500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    dispatch({ type: 'toast:pop', id });
  }, []);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      toast('error', message);
      console.error(error);
    },
    [toast],
  );

  const loadConfig = useCallback(
    async (filePath?: string) => {
      try {
        const snapshot = filePath
          ? await window.fm.config.load(filePath)
          : await window.fm.config.current();
        dispatch({ type: 'init', configPath: snapshot.path, config: snapshot.data });
      } catch (error) {
        handleError(error, '加载配置失败');
      }
    },
    [handleError],
  );

  const pickAndLoadConfig = useCallback(async () => {
    try {
      const filePath = await window.fm.config.pick('open');
      if (filePath) {
        const snapshot = await window.fm.config.load(filePath);
        dispatch({ type: 'init', configPath: snapshot.path, config: snapshot.data });
        toast('success', '配置已加载');
      }
    } catch (error) {
      handleError(error, '加载配置失败');
    }
  }, [handleError, toast]);

  const pickAndCreateConfig = useCallback(async () => {
    try {
      const filePath = await window.fm.config.pick('save');
      if (filePath) {
        const snapshot = await window.fm.config.create(filePath);
        dispatch({ type: 'init', configPath: snapshot.path, config: snapshot.data });
        toast('success', '已创建新配置');
      }
    } catch (error) {
      handleError(error, '创建配置失败');
    }
  }, [handleError, toast]);

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
    dispatch({ type: 'init', configPath: snap.path, config: snap.data });
  }, []);

  const runScanAll = useCallback(async () => {
    try {
      dispatch({
        type: 'progress',
        value: { rootId: '', scanned: 0, found: 0, running: true },
      });
      const reports = await window.fm.scan.runAll();
      const total = reports.reduce(
        (acc, r) => ({ added: acc.added + r.added, updated: acc.updated + r.updated }),
        { added: 0, updated: 0 },
      );
      await reloadCurrent();
      toast('success', `扫描完成：新增 ${total.added}，更新 ${total.updated}`);
    } catch (error) {
      handleError(error, '扫描失败');
    } finally {
      dispatch({ type: 'progress', value: undefined });
    }
  }, [handleError, reloadCurrent, toast]);

  const runScanOne = useCallback(
    async (rootId: string) => {
      try {
        dispatch({
          type: 'progress',
          value: { rootId, scanned: 0, found: 0, running: true },
        });
        const report = await window.fm.scan.runOne(rootId);
        await reloadCurrent();
        toast('success', `扫描完成：新增 ${report.added}，更新 ${report.updated}`);
      } catch (error) {
        handleError(error, '扫描失败');
      } finally {
        dispatch({ type: 'progress', value: undefined });
      }
    },
    [handleError, reloadCurrent, toast],
  );

  const saveProject = useCallback(
    async (id: string, patch: ProjectMetaPatch, writeFile: boolean) => {
      try {
        const project = writeFile
          ? await window.fm.projects.writeMetaFile(id, patch)
          : await window.fm.projects.updateMeta(id, patch);
        dispatch({ type: 'updateProject', project });
        toast('success', writeFile ? '已写入 .meta-data' : '已保存到数据库');
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

  const addCategoryAction = useCallback(
    async (name: string, color?: string) => {
      const category = await window.fm.categories.create({ name, color });
      dispatch({ type: 'category', category });
      return category;
    },
    [],
  );

  const renameCategoryAction = useCallback(async (id: string, name: string) => {
    const category = await window.fm.categories.rename(id, name);
    dispatch({ type: 'category', category });
  }, []);

  const setCategoryColorAction = useCallback(async (id: string, color: string) => {
    const category = await window.fm.categories.setColor(id, color);
    dispatch({ type: 'category', category });
  }, []);

  const removeCategoryAction = useCallback(
    async (id: string) => {
      await window.fm.categories.remove(id);
      await reloadCurrent();
    },
    [reloadCurrent],
  );

  const addScanRootAction = useCallback(
    async (input: { path: string; label?: string; maxDepth?: number }) => {
      const root = await window.fm.scanRoots.add(input);
      dispatch({ type: 'scanRoot', root });
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
    const next: AppConfig = {
      ...stateRef.current.config,
      ui: { ...stateRef.current.config.ui, theme },
    };
    await window.fm.config.save(next);
    dispatch({ type: 'config', config: next });
  }, []);

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

  const actions = useMemo<AppActions>(
    () => ({
      loadConfig,
      pickAndLoadConfig,
      pickAndCreateConfig,
      refreshProjects,
      runScanAll,
      runScanOne,
      setCategoryFilter: value => dispatch({ type: 'categoryFilter', value }),
      setSearch: value => dispatch({ type: 'search', value }),
      setView: value => dispatch({ type: 'view', value }),
      setRoute: value => dispatch({ type: 'route', value }),
      selectProject: id => dispatch({ type: 'select', id }),
      saveProject,
      removeMetaFile,
      revealProject,
      addCategory: addCategoryAction,
      renameCategory: renameCategoryAction,
      setCategoryColor: setCategoryColorAction,
      removeCategory: removeCategoryAction,
      addScanRoot: addScanRootAction,
      updateScanRoot: updateScanRootAction,
      removeScanRoot: removeScanRootAction,
      pickDirectory,
      saveIgnore,
      saveTheme,
      toast,
      dismissToast,
    }),
    [
      addCategoryAction,
      addScanRootAction,
      dismissToast,
      loadConfig,
      pickAndCreateConfig,
      pickAndLoadConfig,
      pickDirectory,
      refreshProjects,
      removeCategoryAction,
      removeMetaFile,
      removeScanRootAction,
      renameCategoryAction,
      revealProject,
      runScanAll,
      runScanOne,
      saveIgnore,
      saveProject,
      saveTheme,
      setCategoryColorAction,
      toast,
      updateScanRootAction,
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
