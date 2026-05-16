import type { ProjectDirectoryInspection, ProjectFingerprint, ScanRoot, TagDefinition } from '@shared/bridge.js';
import { TagSelector } from '@/components/basic/tag-selector';
import { SegmentedToggleGroup } from '@/components/ui/segmented-toggle-group';
import { cn } from '@/lib/utils';
import { useAppActions } from '@/store/app-store';
import { META_FILE_NAME } from '@shared/types';
import { ChevronDown, FileCode2, FolderOpen, Files, FileMinus, FolderPlus, FolderTree } from 'lucide-react';
import { ReactNode, useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

type TagSelectorMode = 'alwaysEdit' | 'editable' | 'readonly';


export interface ProjectFormValue {
    path: string;
    name: string;
    description: string;
    tags: string[];
    ignore: string[];
    favoriteFiles: string[];
    syncRespectGitignore: boolean;
    fingerprint: ProjectFingerprint;
}

function inferFolderName(path: string): string {
    const normalized = path.replace(/\\/g, '/').trim();
    return normalized.split('/').filter(Boolean).pop() ?? '';
}

function describeInspectionHint(inspection: ProjectDirectoryInspection | null): string | null {
    if (!inspection) return null;
    if (inspection.hasMetaFile) {
        return `检测到 .meta-data${inspection.metaProjectId ? `（projectId: ${inspection.metaProjectId}）` : ''}`;
    }
    if (inspection.filesComplete) {
        return `共发现 ${inspection.files.length} 个文件，可用于文件列表指纹。`;
    }
    return `已预加载 ${inspection.files.length} 个文件；修改文件列表或切换到文件视图后会继续按需扫描。`;
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
    onEditFileFingerprint,
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
    onEditFileFingerprint?: () => void;
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
                        onEditFileFingerprint={onEditFileFingerprint}
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
    onEditFileFingerprint,
}: {
    inspection: ProjectDirectoryInspection | null;
    fingerprint: ProjectFingerprint;
    editable: boolean;
    path: string;
    onChange: (fingerprint: ProjectFingerprint) => void;
    onEditFileFingerprint?: () => void;
}) {
    const actions = useAppActions();
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
        onChange({
            kind: 'file-paths',
            paths: inspection?.filesComplete
                ? selectedPaths.filter(file => inspection.files.includes(file))
                : selectedPaths,
        });
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
                        </div>
                        <Button
                            size="default"
                            variant="outline"
                            disabled={!editable || !inspection?.tree.length}
                            onClick={onEditFileFingerprint}
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

                    {inspection && !inspection.filesComplete ? (
                        <p className="text-note text-muted-foreground">当前仅预加载了部分目录，展开文件夹或搜索时会继续扫描。</p>
                    ) : null}

                    {!inspection?.tree.length ? (
                        <p className="text-note text-muted-foreground">请先选择有效项目目录后再配置文件列表。</p>
                    ) : null}
                </div>
            ) : null}
        </div>
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
    onEditFileFingerprint,
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
    onEditFileFingerprint?: () => void;
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
            onEditFileFingerprint={onEditFileFingerprint}
        />
    );
}

export { describeInspectionHint };
