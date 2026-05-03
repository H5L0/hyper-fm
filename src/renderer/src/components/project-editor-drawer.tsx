import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    ChevronDown,
    FileCode2,
    FileMinus,
    Files,
    Folder,
    FolderOpen,
    Search,
    X,
} from 'lucide-react';
import type {
    ProjectDirectoryEntry,
    ProjectDirectoryInspection,
    ProjectFingerprint,
    TagDefinition,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { SegmentedToggleGroup } from '@/components/ui/segmented-toggle-group';
import { cn } from '@/lib/utils';
import { IgnoreRulesEditor } from './ignore-rules-editor';
import { TagSelector } from './tag-selector.js';
import { META_FILE_NAME } from '@shared/types';
import { useAppActions } from '@/store/app-store';

export interface ProjectEditorFormValue {
    path: string;
    name: string;
    description: string;
    tags: string[];
    ignore: string[];
    fingerprint: ProjectFingerprint;
}

export function ProjectEditorDrawer({
    title,
    form,
    onFormChange,
    tagDefs,
    inspection,
    pathEditable = true,
    fingerprintEditable = true,
    pathHint,
    banner,
    validation,
    onPickPath,
    onPathCommit,
    onAddTag,
    onRemoveTag,
    headerActions,
    headerTabs,
    activeTabId,
    onTabChange,
    body,
    footer,
    onClose,
}: {
    title?: string;
    form: ProjectEditorFormValue;
    onFormChange: (next: ProjectEditorFormValue) => void;
    tagDefs: readonly TagDefinition[] | undefined;
    inspection: ProjectDirectoryInspection | null;
    pathEditable?: boolean;
    fingerprintEditable?: boolean;
    pathHint?: ReactNode;
    banner?: ReactNode;
    validation?: ReactNode;
    onPickPath?: () => void;
    onPathCommit?: () => void;
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
    headerActions?: ReactNode;
    headerTabs?: ReadonlyArray<{ id: string; label: string }>;
    activeTabId?: string;
    onTabChange?: (tabId: string) => void;
    body?: ReactNode;
    footer: ReactNode;
    onClose: () => void;
}) {
    return (
        <>
            <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="fixed inset-0 z-30 bg-black/18 backdrop-blur-[1px] dark:bg-black/42"
            />
            <aside
                className={cn(
                    'fixed top-0 right-0 z-40 flex h-full w-[560px] max-w-[calc(100vw-1rem)] flex-col border-l border-border bg-card shadow-2xl',
                    'animate-in slide-in-from-right duration-150',
                )}
            >
                <div className="shrink-0 border-b border-border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        {headerTabs && headerTabs.length > 0 && !title ? (
                            <div className="flex items-center gap-1">
                                {headerTabs.map(tab => {
                                    const active = tab.id === activeTabId;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => onTabChange?.(tab.id)}
                                            className={cn(
                                                'rounded-lg px-3 py-1.5 text-note font-semibold transition-colors',
                                                active
                                                    ? 'bg-secondary text-foreground'
                                                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                            )}
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : title ? (
                            <h2 className="truncate text-heading text-foreground">{title}</h2>
                        ) : <div />}
                        <div className="flex items-center gap-1">{headerActions}</div>
                    </div>
                    {headerTabs && headerTabs.length > 0 && title ? (
                        <div className="mt-3 flex items-center gap-1">
                            {headerTabs.map(tab => {
                                const active = tab.id === activeTabId;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => onTabChange?.(tab.id)}
                                        className={cn(
                                            'rounded-lg px-3 py-1.5 text-note font-semibold transition-colors',
                                            active
                                                ? 'bg-secondary text-foreground'
                                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                {banner ? (
                    <div className="border-b border-border bg-muted/35 px-4 py-2 text-caption text-muted-foreground">
                        {banner}
                    </div>
                ) : null}

                <div className="flex-1 overflow-y-auto">
                    {body ?? (
                        <div className="px-5 py-5">
                            <div className="space-y-5">
                                <DrawerField label="路径">
                                    <div className="flex items-center gap-2">
                                        <input
                                            value={form.path}
                                            disabled={!pathEditable}
                                            onChange={event => onFormChange({ ...form, path: event.target.value })}
                                            onBlur={() => onPathCommit?.()}
                                            placeholder="选择或粘贴项目目录"
                                            className={cn(
                                                'h-9 flex-1 rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
                                                !pathEditable && 'cursor-default bg-muted/40 text-muted-foreground',
                                            )}
                                        />
                                        {pathEditable && onPickPath ? (
                                            <Button size="default" variant="outline" onClick={onPickPath}>
                                                浏览…
                                            </Button>
                                        ) : null}
                                    </div>
                                    {pathHint ? <div className="mt-2">{pathHint}</div> : null}
                                </DrawerField>

                                <DrawerField label="名称">
                                    <input
                                        value={form.name}
                                        onChange={event => onFormChange({ ...form, name: event.target.value })}
                                        className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                                    />
                                </DrawerField>

                                <DrawerField label="描述">
                                    <textarea
                                        rows={2}
                                        value={form.description}
                                        onChange={event => onFormChange({ ...form, description: event.target.value })}
                                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                                    />
                                </DrawerField>

                                <DrawerField label="标签">
                                    <TagSelector
                                        selectedTags={form.tags}
                                        tagDefs={tagDefs}
                                        onAdd={onAddTag}
                                        onRemove={onRemoveTag}
                                        selectedContainerClassName="flex min-h-[2rem] flex-wrap items-center gap-1.5 border-0 bg-transparent px-0 py-0"
                                    />
                                </DrawerField>

                                <DrawerField label="项目指纹">
                                    <FingerprintEditor
                                        inspection={inspection}
                                        fingerprint={form.fingerprint}
                                        editable={fingerprintEditable}
                                        path={form.path}
                                        onChange={fingerprint => onFormChange({ ...form, fingerprint })}
                                    />
                                </DrawerField>

                                {validation ? <div>{validation}</div> : null}
                            </div>
                        </div>
                    )}
                </div>

                <div className="shrink-0 border-t border-border bg-card/90 px-5 py-3">{footer}</div>
            </aside>
        </>
    );
}

export function ProjectFileTreePanel({
    tree,
    ignoreText,
    onIgnoreTextChange,
}: {
    tree: ProjectDirectoryEntry[];
    ignoreText: string;
    onIgnoreTextChange: (value: string) => void;
}) {
    const [query, setQuery] = useState('');
    const visibleTree = useMemo(() => filterTree(tree, query), [tree, query]);

    return (
        <div className="flex h-full min-h-0 flex-col px-5 py-5">
            <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="搜索文件或目录"
                    className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-9 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-2 py-2">
                {visibleTree.length > 0 ? (
                    <DirectoryTreeContent tree={visibleTree} expandAll={query.trim().length > 0} />
                ) : (
                    <div className="px-2 py-6 text-note text-muted-foreground">没有匹配的文件。</div>
                )}
            </div>

            <div className="mt-4 space-y-2">
                <div>
                    <p className="text-subheading text-foreground">忽略规则</p>
                    <p className="mt-1 text-note text-muted-foreground">忽略同步的文件列表，格式与 .gitignore 相同。</p>
                </div>
                <IgnoreRulesEditor
                    value={ignoreText}
                    onChange={onIgnoreTextChange}
                    rows={3}
                />
            </div>
        </div>
    );
}

function DrawerField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <label className="mb-2 block text-subheading text-muted-foreground">{label}</label>
            {children}
        </div>
    );
}

function FingerprintEditor({
    inspection,
    fingerprint,
    editable,
    path,
    onChange,
}: {
    inspection: ProjectDirectoryInspection | null;
    fingerprint: ProjectFingerprint;
    editable: boolean;
    path: string;
    onChange: (fingerprint: ProjectFingerprint) => void;
}) {
    const actions = useAppActions();
    const [dialogOpen, setDialogOpen] = useState(false);
    const folderName = inspection?.suggestedName ?? inferFolderName(path);
    const projectId = inspection?.metaProjectId ?? '';
    const selectedPaths = fingerprint.kind === 'file-paths' ? fingerprint.paths : [];
    const hasMetaFile = inspection?.hasMetaFile ?? false;

    const setKind = (kind: ProjectFingerprint['kind']) => {
        if (!editable) return;
        if (kind === 'metadata') {
            onChange({ kind: 'metadata' });
            return;
        }
        if (kind === 'folder-name') {
            onChange({ kind: 'folder-name', folderName });
            return;
        }
        onChange({ kind: 'file-paths', paths: selectedPaths.filter(file => inspection?.files.includes(file)) });
    };

    return (
        <div className="space-y-3">
            <SegmentedToggleGroup
                ariaLabel="选择项目指纹类型"
                value={fingerprint.kind}
                onValueChange={nextValue => setKind(nextValue as ProjectFingerprint['kind'])}
                optionMinWidth={170}
                align="start"
                options={[
                    {
                        value: 'metadata',
                        label: 'metadata',
                        description: '在原目录放置元数据文件识别项目',
                        badge: <div className="rounded-full bg-green-500 w-2 h-2"></div>,
                        icon: <FileCode2 className="size-4" />,
                        disabled: !editable,
                    },
                    {
                        value: 'folder-name',
                        label: '文件夹名称',
                        description: '使用目录名识别项目',
                        icon: <FolderOpen className="size-4" />,
                        disabled: !editable,
                    },
                    {
                        value: 'file-paths',
                        label: '文件列表',
                        description: '使用相对文件路径集合识别项目',
                        icon: <Files className="size-4" />,
                        disabled: !editable,
                    },
                ]}
            />

            {fingerprint.kind === 'metadata' ? (
                <div className="flex-col items-start gap-2 rounded-xl border border-border bg-muted/35 px-3 py-3 text-note text-muted-foreground">
                    {hasMetaFile
                        ? <div className="flex items-center justify-between">
                            {`当前目录已有 ${META_FILE_NAME} 文件。`}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void actions.removeMetaFile(projectId)}
                            >
                                <FileMinus className="size-3.5" /> 删除
                            </Button>
                        </div>
                        : `当前目录不存在 ${META_FILE_NAME} 文件，将在保存时创建。`}
                </div>
            ) : null}

            {fingerprint.kind === 'folder-name' ? (
                <div className="rounded-xl border border-border bg-background px-3 py-3 text-note text-muted-foreground">
                    <p className="text-foreground">文件夹名称</p>
                    <p className="mt-1 break-all">{fingerprint.folderName || folderName || '未检测到目录名'}</p>
                </div>
            ) : null}

            {fingerprint.kind === 'file-paths' ? (
                <div className="space-y-3 rounded-xl border border-border bg-background px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="text-subheading text-foreground">选中文件路径</p>
                            <p className="mt-1 text-note text-muted-foreground">灰色条目已被忽略，无法作为文件列表指纹。</p>
                        </div>
                        <Button
                            size="default"
                            variant="outline"
                            disabled={!editable || !inspection?.tree.length}
                            onClick={() => setDialogOpen(true)}
                        >
                            修改文件列表
                        </Button>
                    </div>

                    {selectedPaths.length > 0 ? (
                        <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-3">
                            {selectedPaths.map(file => (
                                <div key={file} className="break-all text-note text-foreground/90">
                                    {file}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-note text-muted-foreground">尚未选择任何文件。</p>
                    )}

                    {!inspection?.tree.length ? (
                        <p className="text-note text-muted-foreground">请先选择有效项目目录后再配置文件列表。</p>
                    ) : null}
                </div>
            ) : null}

            {dialogOpen && inspection ? (
                <FingerprintFileDialog
                    tree={inspection.tree}
                    files={inspection.files}
                    selectedPaths={selectedPaths}
                    onClose={() => setDialogOpen(false)}
                    onConfirm={paths => {
                        onChange({ kind: 'file-paths', paths });
                        setDialogOpen(false);
                    }}
                />
            ) : null}
        </div>
    );
}

function FingerprintFileDialog({
    tree,
    files,
    selectedPaths,
    onClose,
    onConfirm,
}: {
    tree: ProjectDirectoryEntry[];
    files: string[];
    selectedPaths: string[];
    onClose: () => void;
    onConfirm: (paths: string[]) => void;
}) {
    const [query, setQuery] = useState('');
    const [draft, setDraft] = useState<string[]>(selectedPaths.filter(file => files.includes(file)));
    const visibleTree = useMemo(() => filterTree(tree, query), [tree, query]);

    const toggleFile = (file: string, checked: boolean) => {
        setDraft(current => {
            if (checked) return [...new Set([...current, file])].sort();
            return current.filter(item => item !== file);
        });
    };

    return (
        <EditDialogShell
            title="选择指纹文件"
            note="按文件列表匹配项目时，仅使用已勾选的相对路径。"
            onClose={onClose}
            panelClassName="h-[min(76vh,720px)] w-[min(760px,calc(100vw-2rem))]"
            bodyPaddingClassName="p-0"
            bodyClassName="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]"
            footerEnd={(
                <>
                    <Button size="default" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="default" onClick={() => onConfirm(draft)}>
                        确认
                    </Button>
                </>
            )}
        >
            <div className="flex min-h-0 flex-col border-r border-border px-4 py-4">
                <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索文件路径"
                        className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-9 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                </div>
                <div className="mt-3 rounded-lg bg-muted/30 px-3 py-2 text-note text-muted-foreground">
                    灰色条目已被忽略，不可勾选。
                </div>
                <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-2 py-2">
                    {visibleTree.length > 0 ? (
                        <DirectoryTreeContent
                            tree={visibleTree}
                            selected={new Set(draft)}
                            onToggleFile={toggleFile}
                            expandAll={query.trim().length > 0}
                        />
                    ) : (
                        <div className="px-2 py-6 text-note text-muted-foreground">没有匹配的文件。</div>
                    )}
                </div>
            </div>

            <div className="flex min-h-0 flex-col px-4 py-4">
                <p className="text-subheading text-foreground">选中文件</p>
                <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-3 py-3">
                    {draft.length > 0 ? (
                        <div className="space-y-1.5">
                            {draft.map(file => (
                                <div key={file} className="flex items-start justify-between gap-2 rounded-lg bg-muted/35 px-2.5 py-2">
                                    <span className="break-all text-note text-foreground/90">{file}</span>
                                    <button
                                        type="button"
                                        onClick={() => toggleFile(file, false)}
                                        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                                        aria-label={`移除 ${file}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-note text-muted-foreground">尚未选择任何文件。</p>
                    )}
                </div>
            </div>
        </EditDialogShell>
    );
}

function DirectoryTreeContent({
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
                <TreeNodeRow
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

function TreeNodeRow({
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
                <TreeNodeRow
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

function filterTree(nodes: ProjectDirectoryEntry[], query: string): ProjectDirectoryEntry[] {
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

function inferFolderName(path: string): string {
    const normalized = path.replace(/\\/g, '/').trim();
    return normalized.split('/').filter(Boolean).pop() ?? '';
}
