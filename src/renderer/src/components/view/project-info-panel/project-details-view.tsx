import type { ProjectDirectoryEntry, ProjectDirectoryInspection, ProjectFingerprint, ScanRoot, TagDefinition } from '@shared/bridge.js';
import { FileTreeView } from '@/components/basic/file-tree';
import { TagSelector } from '@/components/basic/tag-selector';
import { EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { SegmentedToggleGroup } from '@/components/ui/segmented-toggle-group';
import { cn } from '@/lib/utils';
import { useAppActions } from '@/store/app-store';
import { META_FILE_NAME } from '@shared/types';
import { ChevronDown, FileCode2, FolderOpen, Files, FileMinus, FolderPlus, FolderTree, Search, X } from 'lucide-react';
import { ReactNode, useState, useMemo, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { filterTree } from './project-files-view';

type TagSelectorMode = 'alwaysEdit' | 'editable' | 'readonly';


export interface ProjectFormValue {
    path: string;
    name: string;
    description: string;
    tags: string[];
    ignore: string[];
    syncRespectGitignore: boolean;
    fingerprint: ProjectFingerprint;
}

function inferFolderName(path: string): string {
    const normalized = path.replace(/\\/g, '/').trim();
    return normalized.split('/').filter(Boolean).pop() ?? '';
}

export function ProjectInfoForm({
    form,
    onFormChange,
    tagDefs,
    inspection,
    pathEditable = true,
    fingerprintEditable = true,
    pathHint,
    validation,
    extraSections,
    tagSelectorMode = 'editable',
    onPickPath,
    onPathCommit,
    onPickParentPath,
    onSetPathFromScanRoot,
    scanRoots,
    mode = 'import',
    onAddTag,
    onRemoveTag,
}: {
    form: ProjectFormValue;
    onFormChange: (next: ProjectFormValue) => void;
    tagDefs: readonly TagDefinition[] | undefined;
    inspection: ProjectDirectoryInspection | null;
    pathEditable?: boolean;
    fingerprintEditable?: boolean;
    pathHint?: ReactNode;
    validation?: ReactNode;
    extraSections?: ReactNode;
    tagSelectorMode?: TagSelectorMode;
    onPickPath?: () => void;
    onPathCommit?: () => void;
    onPickParentPath?: () => void;
    onSetPathFromScanRoot?: (rootPath: string) => void;
    scanRoots?: readonly ScanRoot[];
    mode?: 'new' | 'import';
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
}) {
    return (
        <div className="px-5 py-5">
            <div className="space-y-5">
                <Field label="路径">
                    <div className="flex items-center gap-2">
                        <input
                            value={form.path}
                            disabled={!pathEditable}
                            onChange={event => onFormChange({ ...form, path: event.target.value })}
                            onBlur={() => onPathCommit?.()}
                            placeholder={mode === 'new' ? '输入路径或通过右侧菜单选择' : '选择或粘贴项目目录'}
                            className={cn(
                                'h-9 flex-1 rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
                                !pathEditable && 'cursor-default bg-muted/40 text-muted-foreground',
                            )}
                        />
                        {pathEditable && onPickPath && mode === 'import' ? (
                            <Button size="default" variant="outline" onClick={onPickPath}>
                                浏览…
                            </Button>
                        ) : null}
                        {pathEditable && mode === 'new' ? (
                            <PathMenuButton
                                scanRoots={scanRoots}
                                onPickPath={onPickPath}
                                onPickParentPath={onPickParentPath}
                                onSetPathFromScanRoot={onSetPathFromScanRoot}
                            />
                        ) : null}
                    </div>
                    {pathHint ? <div className="mt-2">{pathHint}</div> : null}
                </Field>

                <Field label="名称">
                    <input
                        value={form.name}
                        onChange={event => onFormChange({ ...form, name: event.target.value })}
                        className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                </Field>

                <Field label="描述">
                    <textarea
                        rows={2}
                        value={form.description}
                        onChange={event => onFormChange({ ...form, description: event.target.value })}
                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                </Field>

                <Field label="标签">
                    <TagSelector
                        mode={tagSelectorMode}
                        selectedTags={form.tags}
                        tagDefs={tagDefs}
                        onAdd={onAddTag}
                        onRemove={onRemoveTag}
                    />
                </Field>

                <Field label="识别方式">
                    <FingerprintEditor
                        inspection={inspection}
                        fingerprint={form.fingerprint}
                        editable={fingerprintEditable}
                        path={form.path}
                        onChange={fingerprint => onFormChange({ ...form, fingerprint })}
                    />
                </Field>

                {extraSections ? <div>{extraSections}</div> : null}
                {validation ? <div>{validation}</div> : null}
            </div>
        </div>
    );
}



function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <label className="mb-2 block text-subheading text-muted-foreground">{label}</label>
            {children}
        </div>
    );
}

function PathMenuButton({
    scanRoots,
    onPickPath,
    onPickParentPath,
    onSetPathFromScanRoot,
}: {
    scanRoots?: readonly ScanRoot[];
    onPickPath?: () => void;
    onPickParentPath?: () => void;
    onSetPathFromScanRoot?: (rootPath: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const hasScanRoots = scanRoots && scanRoots.length > 0 && onSetPathFromScanRoot;
    const hasActions = onPickPath || onPickParentPath;

    return (
        <div ref={ref} className="relative shrink-0">
            <Button
                size="default"
                variant="outline"
                onClick={() => setOpen(v => !v)}
                aria-label="选择路径"
            >
                <ChevronDown className="size-3.5" />
            </Button>
            {open ? (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md">
                    {hasScanRoots
                        ? scanRoots!.map(root => (
                            <button
                                key={root.id}
                                type="button"
                                onClick={() => {
                                    onSetPathFromScanRoot!(root.path);
                                    setOpen(false);
                                }}
                                className="flex w-full items-center px-3 py-2 text-left text-body text-foreground transition-colors hover:bg-muted"
                            >
                                <FolderTree className="mr-2 size-3.5 text-muted-foreground" />
                                {root.label || root.path}
                            </button>
                        ))
                        : null}
                    {hasScanRoots && hasActions ? <div className="my-1 border-t border-border" /> : null}
                    {onPickPath ? (
                        <button
                            type="button"
                            onClick={() => {
                                onPickPath();
                                setOpen(false);
                            }}
                            className="flex w-full items-center px-3 py-2 text-left text-body text-foreground transition-colors hover:bg-muted"
                        >
                            <FolderPlus className="mr-2 size-3.5 text-muted-foreground" />
                            选择项目目录
                        </button>
                    ) : null}
                    {onPickParentPath ? (
                        <button
                            type="button"
                            onClick={() => {
                                onPickParentPath();
                                setOpen(false);
                            }}
                            className="flex w-full items-center px-3 py-2 text-left text-body text-foreground transition-colors hover:bg-muted"
                        >
                            <FolderTree className="mr-2 size-3.5 text-muted-foreground" />
                            选择项目父目录
                        </button>
                    ) : null}
                </div>
            ) : null}
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
                ariaLabel="选择项目识别方式"
                value={fingerprint.kind}
                onValueChange={nextValue => setKind(nextValue as ProjectFingerprint['kind'])}
                optionMinWidth={170}
                align="start"
                options={[
                    {
                        value: 'metadata',
                        label: 'metadata',
                        description: '在原目录放置元数据文件识别项目',
                        badge: hasMetaFile ? <div className="h-2 w-2 rounded-full bg-green-500" /> : undefined,
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
                    {hasMetaFile ? (
                        <div className="flex items-center justify-between">
                            {`当前目录已有 ${META_FILE_NAME} 文件。`}
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void actions.removeMetaFile(projectId)}
                            >
                                <FileMinus className="size-3.5" /> 删除
                            </Button>
                        </div>
                    ) : `当前目录不存在 ${META_FILE_NAME} 文件，将在保存时创建。`}
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
                <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background px-2 py-2">
                    {visibleTree.length > 0 ? (
                        <FileTreeView
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
                                <div key={file} className="flex items-center justify-between gap-2 rounded-lg bg-muted/35 px-2.5 py-1">
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

export function ProjectDetailsView({
    form,
    onFormChange,
    tagDefs,
    inspection,
    pathEditable = false,
    pathHint,
    validation,
    tagSelectorMode = 'editable',
    onPickPath,
    onPathCommit,
    onPickParentPath,
    onSetPathFromScanRoot,
    scanRoots,
    mode,
    onAddTag,
    onRemoveTag,
}: {
    form: ProjectFormValue;
    onFormChange: (next: ProjectFormValue) => void;
    tagDefs: readonly TagDefinition[] | undefined;
    inspection: ProjectDirectoryInspection | null;
    pathEditable?: boolean;
    pathHint?: React.ReactNode;
    validation?: React.ReactNode;
    tagSelectorMode?: TagSelectorMode;
    onPickPath?: () => void;
    onPathCommit?: () => void;
    onPickParentPath?: () => void;
    onSetPathFromScanRoot?: (rootPath: string) => void;
    scanRoots?: readonly ScanRoot[];
    mode?: 'new' | 'import';
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
}) {
    return (
        <ProjectInfoForm
            form={form}
            onFormChange={onFormChange}
            tagDefs={tagDefs}
            inspection={inspection}
            pathEditable={pathEditable}
            pathHint={pathHint}
            validation={validation}
            tagSelectorMode={tagSelectorMode}
            onPickPath={onPickPath}
            onPathCommit={onPathCommit}
            onPickParentPath={onPickParentPath}
            onSetPathFromScanRoot={onSetPathFromScanRoot}
            scanRoots={scanRoots}
            mode={mode}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
        />
    );
}
