import type {
    ProjectDirectoryEntry,
    ProjectDirectoryInspection,
    ProjectDirectoryScanMode,
} from '@shared/bridge.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FilePlus2, FolderOpen, Search, Star, X } from 'lucide-react';
import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileTreeView } from '@/components/basic/file-tree';

export function filterTree(nodes: ProjectDirectoryEntry[], query: string): ProjectDirectoryEntry[] {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return nodes;
    return nodes.flatMap(node => {
        const selfMatched = node.path.toLowerCase().includes(keyword) || node.name.toLowerCase().includes(keyword);
        const filteredChildren = node.children ? filterTree(node.children, query) : undefined;
        if (selfMatched) {
            return [{ ...node, ...(filteredChildren ? { children: filteredChildren } : {}) }];
        }
        if (filteredChildren && filteredChildren.length > 0) {
            return [{ ...node, children: filteredChildren }];
        }
        return [];
    });
}

function mergeDirectoryChildren(
    nodes: readonly ProjectDirectoryEntry[],
    parentPath: string,
    entries: readonly ProjectDirectoryEntry[],
): ProjectDirectoryEntry[] {
    if (!parentPath) {
        return [...entries];
    }
    return nodes.map(node => {
        if (node.kind !== 'folder') {
            return node;
        }
        if (node.path === parentPath) {
            return {
                ...node,
                childrenLoaded: true,
                children: [...entries],
            };
        }
        if (!node.children || node.children.length === 0) {
            return node;
        }
        return {
            ...node,
            children: mergeDirectoryChildren(node.children, parentPath, entries),
        };
    });
}

function collectKnownFiles(nodes: readonly ProjectDirectoryEntry[]): string[] {
    const files = new Set<string>();
    const visit = (entries: readonly ProjectDirectoryEntry[]) => {
        for (const entry of entries) {
            if (entry.kind === 'file' && !entry.ignoredBy) {
                files.add(entry.path);
                continue;
            }
            if (entry.kind === 'folder' && entry.children && entry.children.length > 0) {
                visit(entry.children);
            }
        }
    };
    visit(nodes);
    return [...files].sort();
}

function filterFavoriteTree(nodes: readonly ProjectDirectoryEntry[], favoriteFiles: ReadonlySet<string>): ProjectDirectoryEntry[] {
    return nodes.flatMap(node => {
        if (node.kind === 'file') {
            return favoriteFiles.has(node.path) ? [node] : [];
        }
        const children = node.children ? filterFavoriteTree(node.children, favoriteFiles) : [];
        if (children.length === 0) return [];
        return [{
            ...node,
            children,
            childrenLoaded: true,
        }];
    });
}

export function useProjectDirectoryTreeBrowser({
    path,
    projectIgnore,
    initialInspection,
    includeFiles = [],
    initialMode = 'interactive',
}: {
    path: string;
    projectIgnore: readonly string[];
    initialInspection?: ProjectDirectoryInspection | null;
    includeFiles?: readonly string[];
    initialMode?: Exclude<ProjectDirectoryScanMode, 'summary'>;
}) {
    const normalizedPath = path.trim();
    const ignoreKey = useMemo(() => JSON.stringify([...projectIgnore]), [projectIgnore]);
    const includeFilesKey = useMemo(() => JSON.stringify([...includeFiles].sort()), [includeFiles]);
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(initialInspection ?? null);
    const [loadingRoot, setLoadingRoot] = useState(false);
    const [loadingFolders, setLoadingFolders] = useState<string[]>([]);
    const requestIdRef = useRef(0);

    const loadRoot = useCallback(async (mode: Exclude<ProjectDirectoryScanMode, 'summary'> | 'summary') => {
        if (!normalizedPath) {
            setInspection(null);
            return;
        }
        const requestId = ++requestIdRef.current;
        setLoadingRoot(true);
        try {
            const next = await window.fm.projects.inspectDirectory(normalizedPath, [...projectIgnore], {
                mode,
                includeFiles: [...includeFiles],
            });
            if (requestId === requestIdRef.current) {
                setInspection(next);
            }
        } catch {
            if (requestId === requestIdRef.current) {
                setInspection(null);
            }
        } finally {
            if (requestId === requestIdRef.current) {
                setLoadingRoot(false);
            }
        }
    }, [includeFiles, normalizedPath, projectIgnore]);

    useEffect(() => {
        setInspection(initialInspection ?? null);
    }, [initialInspection, ignoreKey, includeFilesKey, normalizedPath]);

    useEffect(() => {
        if (!normalizedPath) {
            setInspection(null);
            return;
        }
        void loadRoot(initialMode);
    }, [ignoreKey, includeFilesKey, initialMode, loadRoot, normalizedPath]);

    const expandFolder = useCallback(async (relativePath: string) => {
        if (!normalizedPath) return;
        if (loadingFolders.includes(relativePath)) return;
        setLoadingFolders(current => [...current, relativePath]);
        try {
            const expanded = await window.fm.projects.expandDirectory(normalizedPath, relativePath, [...projectIgnore], {
                mode: 'interactive',
                includeFiles: [...includeFiles],
            });
            setInspection(current => {
                if (!current) return current;
                const tree = mergeDirectoryChildren(current.tree, expanded.parentPath, expanded.entries);
                return {
                    ...current,
                    tree,
                    files: current.filesComplete ? current.files : collectKnownFiles(tree),
                };
            });
        } finally {
            setLoadingFolders(current => current.filter(item => item !== relativePath));
        }
    }, [includeFiles, loadingFolders, normalizedPath, projectIgnore]);

    const loadFullTree = useCallback(async () => {
        if (inspection?.filesComplete) return;
        await loadRoot('full');
    }, [inspection?.filesComplete, loadRoot]);

    return {
        inspection,
        loadingRoot,
        loadingFolders,
        expandFolder,
        loadFullTree,
    };
}

type ProjectFilesSelectionState = {
    selectedPaths: readonly string[];
    onSelectedPathsChange: (paths: string[]) => void;
};

const EMPTY_PATHS: readonly string[] = [];

export const PROJECT_INFO_PANEL_RIGHT_OFFSET = 'min(35rem, calc(100vw - 1rem))';
const PROJECT_INFO_PANEL_MAX_WIDTH = 560;
const VIEWPORT_MARGIN = -1;
const FILE_PANEL_GAP = -1;
const PROJECT_FILES_PANEL_MIN_WIDTH = 288;
const PROJECT_FILES_PANEL_MAX_WIDTH = 480;
const PROJECT_FILES_PANEL_MIN_WIDTH_STANDALONE = 360;
const PROJECT_FILES_PANEL_MAX_WIDTH_STANDALONE = 480;

function useProjectFilesPanelLayout(attachedToInfoPanel: boolean) {
    const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return useMemo(() => {
        if (!attachedToInfoPanel) {
            const standaloneWidth = Math.min(
                PROJECT_FILES_PANEL_MAX_WIDTH_STANDALONE,
                Math.max(PROJECT_FILES_PANEL_MIN_WIDTH_STANDALONE, Math.floor(viewportWidth * 0.5)),
            );

            return {
                right: VIEWPORT_MARGIN,
                width: Math.min(standaloneWidth, Math.max(280, viewportWidth - VIEWPORT_MARGIN * 2)),
            };
        }

        const infoPanelWidth = Math.min(PROJECT_INFO_PANEL_MAX_WIDTH, Math.max(viewportWidth - 16, 0));
        const availableLeftWidth = viewportWidth - infoPanelWidth - FILE_PANEL_GAP - VIEWPORT_MARGIN;

        if (availableLeftWidth >= PROJECT_FILES_PANEL_MIN_WIDTH) {
            return {
                right: infoPanelWidth + FILE_PANEL_GAP,
                width: Math.min(PROJECT_FILES_PANEL_MAX_WIDTH, availableLeftWidth),
            };
        }

        return {
            right: VIEWPORT_MARGIN,
            width: Math.min(PROJECT_FILES_PANEL_MAX_WIDTH, Math.max(240, viewportWidth - VIEWPORT_MARGIN * 2)),
        };
    }, [attachedToInfoPanel, viewportWidth]);
}

export function ProjectFilesView({
    path,
    projectIgnore,
    initialInspection,
    includeFiles,
    selection,
    favoriteFiles,
    onFavoriteFilesChange,
    onOpenFile,
    onOpenFileWith,
    onOpenFolder,
    onOpenFolderInVscode,
}: {
    path: string;
    projectIgnore: string[];
    initialInspection?: ProjectDirectoryInspection | null;
    includeFiles?: readonly string[];
    selection?: ProjectFilesSelectionState;
    favoriteFiles?: readonly string[];
    onFavoriteFilesChange?: (paths: string[]) => void;
    onOpenFile?: (path: string) => void | Promise<void>;
    onOpenFileWith?: (path: string) => void | Promise<void>;
    onOpenFolder?: (path: string) => void | Promise<void>;
    onOpenFolderInVscode?: (path: string) => void | Promise<void>;
}) {
    const [query, setQuery] = useState('');
    const [favoriteOnly, setFavoriteOnly] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number; path: string; kind: 'file' | 'folder' } | null>(null);
    const {
        inspection,
        loadingRoot,
        loadingFolders,
        expandFolder,
        loadFullTree,
    } = useProjectDirectoryTreeBrowser({
        path,
        projectIgnore,
        initialInspection,
        includeFiles,
    });
    const favoriteFileSet = useMemo(() => new Set(favoriteFiles ?? []), [favoriteFiles]);
    const favoriteTree = useMemo(
        () => favoriteOnly ? filterFavoriteTree(inspection?.tree ?? [], favoriteFileSet) : (inspection?.tree ?? []),
        [favoriteFileSet, favoriteOnly, inspection?.tree],
    );
    const visibleTree = useMemo(() => filterTree(favoriteTree, query), [favoriteTree, query]);

    useEffect(() => {
        if (!selection || !inspection?.filesComplete) return;
        const nextPaths = selection.selectedPaths.filter(file => inspection.files.includes(file));
        if (nextPaths.length !== selection.selectedPaths.length) {
            selection.onSelectedPathsChange(nextPaths);
        }
    }, [inspection, selection]);

    useEffect(() => {
        if (!query.trim()) return;
        void loadFullTree();
    }, [loadFullTree, query]);

    useEffect(() => {
        if (!favoriteOnly || favoriteFileSet.size === 0) return;
        void loadFullTree();
    }, [favoriteFileSet, favoriteOnly, loadFullTree]);

    const toggleFile = useCallback((file: string, checked: boolean) => {
        if (!selection) return;
        const next = checked
            ? [...new Set([...selection.selectedPaths, file])].sort()
            : selection.selectedPaths.filter(item => item !== file);
        selection.onSelectedPathsChange(next);
    }, [selection]);

    const toggleFavoriteFile = useCallback((file: string) => {
        if (!onFavoriteFilesChange) return;
        const next = favoriteFileSet.has(file)
            ? [...favoriteFileSet].filter(item => item !== file)
            : [...new Set([...favoriteFileSet, file])].sort();
        onFavoriteFilesChange(next);
    }, [favoriteFileSet, onFavoriteFilesChange]);

    const openFileMenu = useCallback((event: MouseEvent, filePath: string) => {
        if (!onFavoriteFilesChange && !onOpenFile && !onOpenFileWith) {
            return;
        }
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, path: filePath, kind: 'file' });
    }, [onFavoriteFilesChange, onOpenFile, onOpenFileWith]);

    const openFolderMenu = useCallback((event: MouseEvent, folderPath: string) => {
        if (!onOpenFolder && !onOpenFolderInVscode) {
            return;
        }
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, path: folderPath, kind: 'folder' });
    }, [onOpenFolder, onOpenFolderInVscode]);

    const emptyText = !path.trim()
        ? '请先选择有效项目目录。'
        : loadingRoot
            ? '正在加载文件列表…'
            : favoriteOnly && (favoriteFiles?.length ?? 0) === 0
                ? '还没有收藏的文件。'
                : query.trim()
                    ? '没有匹配的文件。'
                    : '当前目录下没有可显示的文件。';

    return (
        <div className="flex h-full min-h-0 flex-col px-5 py-5">
            {selection ? (
                <div className="mb-3 text-note text-muted-foreground">
                    已选择 {selection.selectedPaths.length} 个文件作为指纹依据。
                </div>
            ) : null}

            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索文件或目录"
                        className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-9 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={favoriteOnly}
                    onClick={() => setFavoriteOnly(current => !current)}
                    className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-xl px-3 text-caption font-medium transition-colors',
                        favoriteOnly
                            ? 'border-2 border-amber-400/90 bg-background text-amber-600 hover:bg-amber-50 dark:border-amber-300/80 dark:text-amber-300 dark:hover:bg-amber-500/10'
                            : 'border-border border m-px bg-background text-muted-foreground hover:bg-muted/40',
                    )}
                >
                    <Star className={cn('size-3.5', favoriteOnly ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
                    <span className={cn(
                        'text-caption',
                        favoriteOnly ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground',
                    )}>只看收藏</span>
                </button>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-2 py-2">
                {visibleTree.length > 0 ? (
                    <FileTreeView
                        tree={visibleTree}
                        selected={selection ? new Set(selection.selectedPaths) : undefined}
                        favoriteFiles={favoriteFileSet}
                        onToggleFile={selection ? toggleFile : undefined}
                        onFileContextMenu={openFileMenu}
                        onFolderContextMenu={openFolderMenu}
                        onExpandFolder={expandFolder}
                        loadingFolders={loadingFolders}
                        expandAll={query.trim().length > 0}
                    />
                ) : (
                    <div className="py-1 text-note text-muted-foreground" style={{ paddingLeft: '1rem' }}>{emptyText}</div>
                )}
            </div>

            {menu ? (
                <FileContextMenu
                    x={menu.x}
                    y={menu.y}
                    filePath={menu.path}
                    kind={menu.kind}
                    isFavorite={favoriteFileSet.has(menu.path)}
                    onClose={() => setMenu(null)}
                    onOpen={menu.kind === 'file' && onOpenFile ? () => void Promise.resolve(onOpenFile(menu.path)).finally(() => setMenu(null)) : undefined}
                    onOpenWith={menu.kind === 'file' && onOpenFileWith ? () => void Promise.resolve(onOpenFileWith(menu.path)).finally(() => setMenu(null)) : undefined}
                    onOpenFolder={menu.kind === 'folder' && onOpenFolder ? () => void Promise.resolve(onOpenFolder(menu.path)).finally(() => setMenu(null)) : undefined}
                    onOpenFolderInVscode={menu.kind === 'folder' && onOpenFolderInVscode ? () => void Promise.resolve(onOpenFolderInVscode(menu.path)).finally(() => setMenu(null)) : undefined}
                    onToggleFavorite={menu.kind === 'file' && onFavoriteFilesChange ? () => {
                        toggleFavoriteFile(menu.path);
                        setMenu(null);
                    } : undefined}
                />
            ) : null}
        </div>
    );
}

function FileContextMenu({
    x,
    y,
    filePath,
    kind,
    isFavorite,
    onClose,
    onOpen,
    onOpenWith,
    onOpenFolder,
    onOpenFolderInVscode,
    onToggleFavorite,
}: {
    x: number;
    y: number;
    filePath: string;
    kind: 'file' | 'folder';
    isFavorite: boolean;
    onClose: () => void;
    onOpen?: () => void;
    onOpenWith?: () => void;
    onOpenFolder?: () => void;
    onOpenFolderInVscode?: () => void;
    onToggleFavorite?: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const onDown = (event: globalThis.MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) onClose();
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('contextmenu', onDown, true);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('mousedown', onDown, true);
            window.removeEventListener('contextmenu', onDown, true);
        };
    }, [onClose]);

    const style: CSSProperties = { top: y, left: x };
    if (typeof window !== 'undefined') {
        const margin = 8;
        if (x + 180 + margin > window.innerWidth) style.left = window.innerWidth - 180 - margin;
        if (y + 132 + margin > window.innerHeight) style.top = window.innerHeight - 132 - margin;
    }

    return (
        <div
            ref={ref}
            role="menu"
            className="fixed z-60 min-w-45 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
            style={style}
        >
            <div className="border-b border-border px-3 py-2 text-caption text-muted-foreground">{filePath}</div>
            {kind === 'file' && onOpen ? (
                <FileMenuItem icon={<FolderOpen className="size-4" />} onClick={onOpen}>
                    打开
                </FileMenuItem>
            ) : null}
            {kind === 'file' && onOpenWith ? (
                <FileMenuItem icon={<FilePlus2 className="size-4" />} onClick={onOpenWith}>
                    打开方式
                </FileMenuItem>
            ) : null}
            {kind === 'folder' && onOpenFolder ? (
                <FileMenuItem icon={<FolderOpen className="size-4" />} onClick={onOpenFolder}>
                    打开文件夹
                </FileMenuItem>
            ) : null}
            {kind === 'folder' && onOpenFolderInVscode ? (
                <FileMenuItem icon={<FilePlus2 className="size-4" />} onClick={onOpenFolderInVscode}>
                    在 VS Code 中打开
                </FileMenuItem>
            ) : null}
            {kind === 'file' && onToggleFavorite ? (
                <FileMenuItem icon={<Star className={cn('size-4', isFavorite && 'fill-amber-400 text-amber-500')} />} onClick={onToggleFavorite}>
                    {isFavorite ? '取消收藏' : '收藏'}
                </FileMenuItem>
            ) : null}
        </div>
    );
}

function FileMenuItem({
    icon,
    onClick,
    children,
}: {
    icon: ReactNode;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
        >
            <span className="text-muted-foreground">{icon}</span>
            {children}
        </button>
    );
}

export function ProjectFilesSidePanel({
    mode,
    path,
    projectIgnore,
    initialInspection,
    selectedPaths = EMPTY_PATHS,
    favoriteFiles = EMPTY_PATHS,
    onFavoriteFilesChange,
    onOpenFile,
    onOpenFileWith,
    onOpenFolder,
    onOpenFolderInVscode,
    attachedToInfoPanel = true,
    onClose,
    onConfirmSelection,
}: {
    mode: 'browse' | 'select-fingerprint';
    path: string;
    projectIgnore: string[];
    initialInspection?: ProjectDirectoryInspection | null;
    selectedPaths?: readonly string[];
    favoriteFiles?: readonly string[];
    onFavoriteFilesChange?: (paths: string[]) => void;
    onOpenFile?: (path: string) => void | Promise<void>;
    onOpenFileWith?: (path: string) => void | Promise<void>;
    onOpenFolder?: (path: string) => void | Promise<void>;
    onOpenFolderInVscode?: (path: string) => void | Promise<void>;
    attachedToInfoPanel?: boolean;
    onClose: () => void;
    onConfirmSelection?: (paths: string[]) => void;
}) {
    const [draftPaths, setDraftPaths] = useState<string[]>([...selectedPaths]);
    const panelLayout = useProjectFilesPanelLayout(attachedToInfoPanel);

    useEffect(() => {
        if (mode !== 'select-fingerprint') return;
        setDraftPaths([...selectedPaths]);
    }, [selectedPaths, mode, path]);

    return (
        <>
            {!attachedToInfoPanel ? (
                <button
                    type="button"
                    aria-label="关闭文件视图"
                    onClick={onClose}
                    className="fixed inset-0 z-30 bg-black/15 dark:bg-black/45 animate-in fade-in duration-100"
                />
            ) : null}

            <aside
                className="fixed top-0 flex h-full max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-l-2xl border border-border bg-card shadow-2xl animate-in slide-in-from-right-8 fade-in duration-150"
                style={{ zIndex: 35, right: `${panelLayout.right}px`, width: `${panelLayout.width}px` }}
            >
                <div className="h-12 shrink-0 border-b border-border px-4">
                    <div className="flex h-full items-center justify-between gap-3">
                        <h2 className="truncate text-heading text-foreground">{mode === 'browse' ? '文件视图' : '选择指纹文件'}</h2>
                        <Button size="icon-xs" variant="ghost" onClick={onClose}>
                            <X className="size-3.5" />
                        </Button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                    <ProjectFilesView
                        path={path}
                        projectIgnore={projectIgnore}
                        initialInspection={initialInspection}
                        includeFiles={selectedPaths}
                        favoriteFiles={favoriteFiles}
                        onFavoriteFilesChange={onFavoriteFilesChange}
                        onOpenFile={onOpenFile}
                        onOpenFileWith={onOpenFileWith}
                        onOpenFolder={onOpenFolder}
                        onOpenFolderInVscode={onOpenFolderInVscode}
                        selection={mode === 'select-fingerprint'
                            ? {
                                selectedPaths: draftPaths,
                                onSelectedPathsChange: setDraftPaths,
                            }
                            : undefined}
                    />
                </div>

                {mode === 'select-fingerprint' ? (
                    <div className="shrink-0 border-t border-border bg-card/90 px-5 py-3">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-note text-muted-foreground">已选 {draftPaths.length} 个文件</span>
                            <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={onClose}>
                                    取消
                                </Button>
                                <Button size="sm" onClick={() => onConfirmSelection?.(draftPaths)}>
                                    确认
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </aside>
        </>
    );
}
