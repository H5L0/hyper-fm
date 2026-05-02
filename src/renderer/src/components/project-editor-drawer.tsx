import { useMemo, useState, type ReactNode } from 'react';
import {
    ChevronDown,
    FileCode2,
    Files,
    Folder,
    FolderOpen,
    Search,
    X,
} from 'lucide-react';
import type {
    ProjectDirectoryInspection,
    ProjectFingerprint,
    TagDefinition,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TagSelector } from './tag-selector.js';

export interface ProjectEditorFormValue {
    path: string;
    name: string;
    description: string;
    tags: string[];
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
    footer,
    onClose,
}: {
    title: string;
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
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
                    <h2 className="truncate text-heading text-foreground">{title}</h2>
                    <div className="flex items-center gap-1">{headerActions}</div>
                </div>

                {banner ? (
                    <div className="border-b border-border bg-muted/35 px-4 py-2 text-caption text-muted-foreground">
                        {banner}
                    </div>
                ) : null}

                <div className="flex-1 overflow-y-auto px-5 py-5">
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

                <div className="shrink-0 border-t border-border bg-card/90 px-5 py-3">{footer}</div>
            </aside>
        </>
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
    const [dialogOpen, setDialogOpen] = useState(false);
    const folderName = inspection?.suggestedName ?? inferFolderName(path);
    const selectedPaths = fingerprint.kind === 'file-paths' ? fingerprint.paths : [];

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
        onChange({ kind: 'file-paths', paths: selectedPaths });
    };

    return (
        <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
                <FingerprintKindButton
                    active={fingerprint.kind === 'metadata'}
                    icon={<FileCode2 className="size-4" />}
                    title="metadata"
                    disabled={!editable}
                    onClick={() => setKind('metadata')}
                />
                <FingerprintKindButton
                    active={fingerprint.kind === 'folder-name'}
                    icon={<FolderOpen className="size-4" />}
                    title="文件夹名称"
                    disabled={!editable}
                    onClick={() => setKind('folder-name')}
                />
                <FingerprintKindButton
                    active={fingerprint.kind === 'file-paths'}
                    icon={<Files className="size-4" />}
                    title="文件列表"
                    disabled={!editable}
                    onClick={() => setKind('file-paths')}
                />
            </div>

            {fingerprint.kind === 'metadata' ? (
                <div className="rounded-xl border border-border bg-muted/35 px-3 py-3 text-note text-muted-foreground">
                    {inspection?.hasMetaFile
                        ? '当前目录已存在 .meta-data，保存时会继续使用 metadata 指纹。'
                        : '保存为 metadata 指纹时会写入 .meta-data 并记录稳定的 projectId。'}
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
                            <p className="mt-1 text-note text-muted-foreground">仅显示已选文件，通过弹框统一修改。</p>
                        </div>
                        <Button
                            size="default"
                            variant="outline"
                            disabled={!editable || !inspection?.files.length}
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

                    {!inspection?.files.length ? (
                        <p className="text-note text-muted-foreground">请先选择有效项目目录后再配置文件列表。</p>
                    ) : null}
                </div>
            ) : null}

            {dialogOpen && inspection ? (
                <FingerprintFileDialog
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

function FingerprintKindButton({
    active,
    icon,
    title,
    disabled,
    onClick,
}: {
    active: boolean;
    icon: ReactNode;
    title: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'flex h-11 items-center justify-center gap-2 rounded-xl border bg-background px-3 text-center transition-colors',
                active
                    ? 'border-2 border-primary/70 bg-primary/8 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                disabled && 'cursor-default opacity-100',
            )}
        >
            <span className="text-foreground">{icon}</span>
            <span className="text-subheading leading-none">{title}</span>
        </button>
    );
}

type TreeNode = {
    name: string;
    path: string;
    type: 'folder' | 'file';
    children?: TreeNode[];
};

function FingerprintFileDialog({
    files,
    selectedPaths,
    onClose,
    onConfirm,
}: {
    files: string[];
    selectedPaths: string[];
    onClose: () => void;
    onConfirm: (paths: string[]) => void;
}) {
    const [query, setQuery] = useState('');
    const [draft, setDraft] = useState<string[]>(selectedPaths);
    const visibleFiles = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return files;
        return files.filter(file => file.toLowerCase().includes(keyword));
    }, [files, query]);
    const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

    const toggleFile = (file: string, checked: boolean) => {
        setDraft(current => {
            if (checked) return [...new Set([...current, file])].sort();
            return current.filter(item => item !== file);
        });
    };

    return (
        <>
            <button
                type="button"
                aria-label="关闭文件列表选择"
                onClick={onClose}
                className="fixed inset-0 z-[60] cursor-default bg-black/36 backdrop-blur-[1px]"
            />
            <div
                role="dialog"
                aria-modal="true"
                className="fixed top-1/2 left-1/2 z-[70] flex h-[min(76vh,720px)] w-[760px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div>
                        <h3 className="text-heading text-foreground">选择指纹文件</h3>
                        <p className="mt-1 text-note text-muted-foreground">按文件列表匹配项目时，仅使用已勾选的相对路径。</p>
                    </div>
                    <Button size="icon-xs" variant="ghost" onClick={onClose}>
                        <X className="size-3.5" />
                    </Button>
                </div>

                <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
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
                        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-2 py-2">
                            {tree.length > 0 ? (
                                tree.map(node => (
                                    <TreeNodeRow
                                        key={node.path}
                                        node={node}
                                        selected={new Set(draft)}
                                        onToggleFile={toggleFile}
                                        level={0}
                                    />
                                ))
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
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border bg-card/90 px-4 py-3">
                    <Button size="default" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="default" onClick={() => onConfirm(draft)}>
                        确认
                    </Button>
                </div>
            </div>
        </>
    );
}

function TreeNodeRow({
    node,
    selected,
    onToggleFile,
    level,
}: {
    node: TreeNode;
    selected: Set<string>;
    onToggleFile: (file: string, checked: boolean) => void;
    level: number;
}) {
    if (node.type === 'file') {
        const checked = selected.has(node.path);
        return (
            <label
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-note hover:bg-muted/60"
                style={{ paddingLeft: `${level * 14 + 8}px` }}
            >
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={event => onToggleFile(node.path, event.target.checked)}
                />
                <FileCode2 className="size-3.5 text-muted-foreground" />
                <span className="break-all text-foreground/90">{node.name}</span>
            </label>
        );
    }

    return (
        <div>
            <div
                className="flex items-center gap-2 px-2 py-1.5 text-note text-muted-foreground"
                style={{ paddingLeft: `${level * 14 + 8}px` }}
            >
                <ChevronDown className="size-3.5" />
                <Folder className="size-3.5" />
                <span>{node.name}</span>
            </div>
            {node.children?.map(child => (
                <TreeNodeRow
                    key={child.path}
                    node={child}
                    selected={selected}
                    onToggleFile={onToggleFile}
                    level={level + 1}
                />
            ))}
        </div>
    );
}

function buildTree(files: string[]): TreeNode[] {
    const root: TreeNode[] = [];
    for (const file of files) {
        const segments = file.split('/').filter(Boolean);
        let currentChildren = root;
        let currentPath = '';

        segments.forEach((segment, index) => {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const isLeaf = index === segments.length - 1;
            const existing = currentChildren.find(child => child.name === segment);
            if (existing) {
                if (!isLeaf && existing.children) {
                    currentChildren = existing.children;
                }
                return;
            }
            const node: TreeNode = isLeaf
                ? { name: segment, path: currentPath, type: 'file' }
                : { name: segment, path: currentPath, type: 'folder', children: [] };
            currentChildren.push(node);
            if (!isLeaf) {
                currentChildren = node.children ?? [];
            }
        });
    }

    return sortTree(root);
}

function compareNodes(a: TreeNode, b: TreeNode): number {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
    return [...nodes]
        .sort(compareNodes)
        .map(node =>
            node.children
                ? { ...node, children: sortTree(node.children) }
                : node,
        );
}

function inferFolderName(path: string): string {
    const normalized = path.replace(/\\/g, '/').trim();
    return normalized.split('/').filter(Boolean).pop() ?? '';
}
