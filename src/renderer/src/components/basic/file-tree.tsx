import { cn } from "@/lib/utils";
import { ProjectDirectoryEntry } from "@shared/bridge";
import { FileCode2, ChevronDown, Folder } from "lucide-react";
import { useState, useEffect } from "react";
import { Checkbox } from "../ui/checkbox";


export function FileTreeView({
    tree,
    selected,
    onToggleFile,
    expandAll = false,
}: {
    tree: ProjectDirectoryEntry[];
    selected?: Set<string>;
    onToggleFile?: (file: string, checked: boolean) => void;
    expandAll?: boolean;
}) {
    const [collapsedPaths, setCollapsedPaths] = useState<string[]>(() => collectFolderPaths(tree));

    useEffect(() => {
        setCollapsedPaths(collectFolderPaths(tree));
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
                    onToggleFile={onToggleFile}
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
    onToggleFile,
    collapsedPaths,
    onToggleFolder,
    level,
}: {
    node: ProjectDirectoryEntry;
    selected?: Set<string>;
    onToggleFile?: (file: string, checked: boolean) => void;
    collapsedPaths: readonly string[];
    onToggleFolder: (path: string) => void;
    level: number;
}) {
    const ignored = !!node.ignoredBy;
    const hasChildren = !!node.children && node.children.length > 0;
    const collapsed = hasChildren && collapsedPaths.includes(node.path);
    const rowClassName = cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-note',
        ignored ? 'text-muted-foreground' : 'text-foreground/90',
        node.kind === 'file' && !ignored && onToggleFile ? 'hover:bg-muted/60' : 'hover:bg-muted/40',
    );

    if (node.kind === 'file') {
        const checked = selected?.has(node.path) ?? false;
        return (
            <div className={rowClassName} style={{ paddingLeft: `${level * 14 + 8}px` }}>
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
                ) : <span className="inline-block size-3.5 shrink-0" />}
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 break-all">{node.name}</span>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
                    onToggleFolder(node.path);
                }}
                className={cn(rowClassName, 'w-full')}
                style={{ paddingLeft: `${level * 14 + 8}px` }}
            >
                {hasChildren && !ignored ? (
                    <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} />
                ) : (
                    <span className="inline-block size-3.5 shrink-0" />
                )}
                <Folder className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
                {node.ignoredBy ? <IgnoreBadge ignoredBy={node.ignoredBy} /> : null}
            </button>
            {!collapsed && node.children?.map(child => (
                <FileTreeNodeRow
                    key={child.path}
                    node={child}
                    selected={selected}
                    onToggleFile={onToggleFile}
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
                'inline-flex rounded-full px-2 py-0.5 text-caption',
                ignoredBy === 'global'
                    ? 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
            )}
        >
            {ignoredBy === 'global' ? '全局忽略' : '项目忽略'}
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
