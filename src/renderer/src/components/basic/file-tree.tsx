import { cn } from "@/lib/utils";
import { ProjectDirectoryEntry } from "@shared/bridge";
import { FileCode2, ChevronDown, Folder, LoaderCircle, Star } from "lucide-react";
import { MouseEvent, useState, useEffect, useRef } from "react";
import { Checkbox } from "../ui/checkbox";


export function FileTreeView({
    tree,
    selected,
    favoriteFiles,
    onToggleFile,
    onFileContextMenu,
    onFolderContextMenu,
    onExpandFolder,
    loadingFolders,
    expandAll = false,
}: {
    tree: ProjectDirectoryEntry[];
    selected?: Set<string>;
    favoriteFiles?: Set<string>;
    onToggleFile?: (file: string, checked: boolean) => void;
    onFileContextMenu?: (event: MouseEvent, file: string) => void;
    onFolderContextMenu?: (event: MouseEvent, folder: string) => void;
    onExpandFolder?: (path: string) => void | Promise<void>;
    loadingFolders?: readonly string[];
    expandAll?: boolean;
}) {
    const [collapsedPaths, setCollapsedPaths] = useState<string[]>(() => collectFolderPaths(tree));
    const knownFolderPathsRef = useRef<Set<string>>(new Set(collectFolderPaths(tree)));

    useEffect(() => {
        const nextFolderPaths = collectFolderPaths(tree);
        const nextFolderSet = new Set(nextFolderPaths);

        setCollapsedPaths(current => {
            const preserved = current.filter(path => nextFolderSet.has(path));
            const nextCollapsed = new Set(preserved);

            for (const path of nextFolderPaths) {
                if (!knownFolderPathsRef.current.has(path)) {
                    nextCollapsed.add(path);
                }
            }

            return [...nextCollapsed];
        });

        knownFolderPathsRef.current = nextFolderSet;
    }, [tree]);

    const toggleFolder = (path: string) => {
        setCollapsedPaths(current => current.includes(path)
            ? current.filter(item => item !== path)
            : [...current, path]);
    };

    return (
        <>
            {tree.map(node => (
                <FileTreeNodeRow
                    key={node.path}
                    node={node}
                    selected={selected}
                    favoriteFiles={favoriteFiles}
                    onToggleFile={onToggleFile}
                    onFileContextMenu={onFileContextMenu}
                    onFolderContextMenu={onFolderContextMenu}
                    onExpandFolder={onExpandFolder}
                    loadingFolders={loadingFolders ?? []}
                    collapsedPaths={expandAll ? [] : collapsedPaths}
                    onToggleFolder={toggleFolder}
                    level={0}
                />
            ))}
        </>
    );
}

function FileTreeNodeRow({
    node,
    selected,
    favoriteFiles,
    onToggleFile,
    onFileContextMenu,
    onFolderContextMenu,
    onExpandFolder,
    loadingFolders,
    collapsedPaths,
    onToggleFolder,
    level,
}: {
    node: ProjectDirectoryEntry;
    selected?: Set<string>;
    favoriteFiles?: Set<string>;
    onToggleFile?: (file: string, checked: boolean) => void;
    onFileContextMenu?: (event: MouseEvent, file: string) => void;
    onFolderContextMenu?: (event: MouseEvent, folder: string) => void;
    onExpandFolder?: (path: string) => void | Promise<void>;
    loadingFolders: readonly string[];
    collapsedPaths: readonly string[];
    onToggleFolder: (path: string) => void;
    level: number;
}) {
    const ignored = !!node.ignoredBy;
    const loading = node.kind === 'folder' && loadingFolders.includes(node.path);
    const hasChildren = node.kind === 'folder'
        && (!ignored && (node.childrenLoaded === false || Boolean(node.children && node.children.length > 0)));
    const collapsed = hasChildren && collapsedPaths.includes(node.path);
    const rowClassName = cn(
        'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-caption',
        ignored ? 'text-muted-foreground' : 'text-foreground/90',
        node.kind === 'file' && !ignored && onToggleFile ? 'hover:bg-muted/60' : 'hover:bg-muted/40',
    );

    if (node.kind === 'file') {
        const checked = selected?.has(node.path) ?? false;
        const favorite = favoriteFiles?.has(node.path) ?? false;
        return (
            <div
                className={rowClassName}
                style={{ paddingLeft: `${level * 14 + 8}px` }}
                onContextMenu={event => onFileContextMenu?.(event, node.path)}
            >
                {onToggleFile ? (
                    ignored ? (
                        <span className="inline-block size-4 shrink-0" />
                    ) : (
                        <Checkbox
                            checked={checked}
                            onCheckedChange={nextChecked => onToggleFile(node.path, nextChecked === true)}
                            className="shrink-0"
                        />
                    )
                ) : null}
                {favorite ? (
                    <Star className="size-2.75 shrink-0 fill-amber-400 text-amber-500" />
                ) : (
                    <span className="inline-block size-2.75 shrink-0" />
                )}
                <FileCode2 className="size-2.75 shrink-0" />
                <span className="min-w-0 flex-1 break-all">{node.name}</span>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {node.ignoredBy ? <IgnoreBadge ignoredBy={node.ignoredBy} /> : null}
                </div>
            </div>
        );
    }

    return (
        <div>
            <button
                type="button"
                onClick={() => {
                    if (!hasChildren || ignored) return;
                    if (collapsed && node.childrenLoaded === false) {
                        void onExpandFolder?.(node.path);
                    }
                    onToggleFolder(node.path);
                }}
                onContextMenu={event => onFolderContextMenu?.(event, node.path)}
                className={cn(rowClassName, 'w-full')}
                style={{ paddingLeft: `${level * 14 + 8}px` }}
            >
                {hasChildren && !ignored ? (
                    loading ? (
                        <LoaderCircle className="size-2.75 shrink-0 animate-spin" />
                    ) : (
                        <ChevronDown className={cn('size-2.75 shrink-0 transition-transform', collapsed && '-rotate-90')} />
                    )
                ) : (
                    <span className="inline-block size-2.75 shrink-0" />
                )}
                <Folder className="size-2.75 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
                {node.ignoredBy ? <IgnoreBadge ignoredBy={node.ignoredBy} /> : null}
            </button>
            {!collapsed && node.children?.map(child => (
                <FileTreeNodeRow
                    key={child.path}
                    node={child}
                    selected={selected}
                    favoriteFiles={favoriteFiles}
                    onToggleFile={onToggleFile}
                    onFileContextMenu={onFileContextMenu}
                    onFolderContextMenu={onFolderContextMenu}
                    onExpandFolder={onExpandFolder}
                    loadingFolders={loadingFolders}
                    collapsedPaths={collapsedPaths}
                    onToggleFolder={onToggleFolder}
                    level={level + 1}
                />
            ))}
        </div>
    );
}

function IgnoreBadge({ ignoredBy }: { ignoredBy: NonNullable<ProjectDirectoryEntry['ignoredBy']> }) {
    return (
        <span
            className={cn(
                'inline-flex rounded-lg bg-muted px-1 py-px leading-4 text-xs text-muted-foreground',
            )}
        >
            {ignoredBy === 'global' ? '全局忽略同步' : '项目忽略同步'}
        </span>
    );
}

function collectFolderPaths(nodes: readonly ProjectDirectoryEntry[]): string[] {
    const out: string[] = [];
    const visit = (entries: readonly ProjectDirectoryEntry[]) => {
        for (const entry of entries) {
            if (entry.kind !== 'folder') continue;
            out.push(entry.path);
            if (entry.children && entry.children.length > 0) {
                visit(entry.children);
            }
        }
    };
    visit(nodes);
    return out;
}
