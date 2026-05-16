import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, PencilLine, X } from 'lucide-react';
import type {
    ManualProjectValidationResult,
    ProjectDirectoryInspection,
    TagDefinition,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { DrawerPanelShell } from '@/components/basic/drawer-panel-shell.js';
import { IgnoreRulesEditor } from '@/components/basic/ignore-rules-editor.js';
import { TagSelector } from '@/components/basic/tag-selector.js';
import { describeInspectionHint, ProjectDetailsView, type ProjectFormValue } from './project-details-view.js';
import type { BatchImportItem } from '@/project-import/types.js';
import {
    hasEmptyFileFingerprint,
    isBatchItemAlreadyAdded,
    isBatchItemReady,
} from '@/project-import/helpers.js';
import {
    describeManualProjectValidationConflict,
    getManualProjectValidationTitle,
} from '@/project-import/validation-text.js';
import { ProjectFilesSidePanel } from './project-files-view.js';
import { ProjectFilesPanelToggle } from './project-info-panel.js';

type ProjectFilePanelMode = 'browse' | 'select-fingerprint' | null;

export function BatchImportPanel({
    open,
    items,
    busy,
    tagDefs,
    templateTags,
    templateIgnoreText,
    onTemplateIgnoreTextChange,
    onAddTemplateTag,
    onRemoveTemplateTag,
    onApplyTemplate,
    onClose,
    onImportAll,
    onImportOne,
    onRemoveOne,
    onOpenOverride,
    stacked = false,
}: {
    open: boolean;
    items: BatchImportItem[];
    busy: boolean;
    tagDefs: readonly TagDefinition[] | undefined;
    templateTags: string[];
    templateIgnoreText: string;
    onTemplateIgnoreTextChange: (value: string) => void;
    onAddTemplateTag: (tag: string) => void;
    onRemoveTemplateTag: (tag: string) => void;
    onApplyTemplate: () => void;
    onClose: () => void;
    onImportAll: () => void;
    onImportOne: (id: string) => void;
    onRemoveOne: (id: string) => void;
    onOpenOverride: (id: string) => void;
    stacked?: boolean;
}) {
    if (!open) return null;

    const importingItems = items.filter(item => item.status === 'importing');
    const readyItems = items.filter(item => !isBatchItemAlreadyAdded(item) && item.status !== 'importing' && isBatchItemReady(item));
    const warningItems = items.filter(item => !isBatchItemAlreadyAdded(item) && item.status !== 'importing' && !isBatchItemReady(item));
    const importedItems = items.filter(isBatchItemAlreadyAdded);

    const readyCount = readyItems.length;
    const importedCount = importedItems.length;
    const warningCount = warningItems.length;

    return (
        <DrawerPanelShell
            title="批量添加项目"
            headerActions={<p>共 {items.length} 个文件夹</p>}
            onClose={onClose}
            showBackdrop={!stacked}
            panelOffsetRight={stacked ? 50 : 0}
            panelZIndex={40}
            backdropZIndex={30}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <p className="text-note text-muted-foreground">
                        已添加 {importedCount} 个，可直接添加 {readyCount} 个，警告 {warningCount} 个。
                    </p>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={onClose}>
                            关闭
                        </Button>
                        <Button size="sm" disabled={busy || readyCount === 0} onClick={onImportAll}>
                            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                            添加全部可用项
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-8 px-5 py-5">
                <section className="space-y-4 border-b border-border pb-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                            <h3 className="text-subheading text-foreground">批量模板</h3>
                            <p className="text-note text-muted-foreground">把公共标签和忽略规则一次性套用到所有未添加项。</p>
                        </div>
                        <Button size="sm" variant="outline" disabled={busy || items.length === 0} onClick={onApplyTemplate}>
                            应用到未添加项
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <p className="mb-2 text-subheading text-muted-foreground">模板标签</p>
                            <TagSelector
                                mode="editable"
                                selectedTags={templateTags}
                                tagDefs={tagDefs}
                                onAdd={onAddTemplateTag}
                                onRemove={onRemoveTemplateTag}
                                emptySelectedLabel="未设置批量标签"
                                availableLabel="可追加到模板的标签"
                            />
                        </div>

                        <div>
                            <p className="mb-2 text-subheading text-muted-foreground">模板忽略规则</p>
                            <IgnoreRulesEditor
                                value={templateIgnoreText}
                                onChange={onTemplateIgnoreTextChange}
                                rows={4}
                                placeholder="# 这些规则会覆盖到所有未添加项\nnode_modules\ndist"
                            />
                        </div>
                    </div>
                </section>

                {items.length === 0 ? (
                    <div className="px-4 py-8 text-center text-note text-muted-foreground">
                        当前没有待添加的文件夹。
                    </div>
                ) : (
                    <div className="space-y-8">
                        <BatchImportGroup title="导入中" items={importingItems}>
                            {item => <BatchImportRow item={item} busy={busy} onImportOne={onImportOne} onRemoveOne={onRemoveOne} onOpenOverride={onOpenOverride} />}
                        </BatchImportGroup>

                        <BatchImportGroup title="可直接添加" items={readyItems}>
                            {item => <BatchImportRow item={item} busy={busy} onImportOne={onImportOne} onRemoveOne={onRemoveOne} onOpenOverride={onOpenOverride} />}
                        </BatchImportGroup>

                        <BatchImportGroup title="有警告" items={warningItems}>
                            {item => <BatchImportRow item={item} busy={busy} onImportOne={onImportOne} onRemoveOne={onRemoveOne} onOpenOverride={onOpenOverride} />}
                        </BatchImportGroup>

                        <BatchImportGroup title="已添加" items={importedItems}>
                            {item => <BatchImportRow item={item} busy={busy} onImportOne={onImportOne} onRemoveOne={onRemoveOne} onOpenOverride={onOpenOverride} />}
                        </BatchImportGroup>
                    </div>
                )}
            </div>
        </DrawerPanelShell>
    );
}

export function BatchImportOverridePanel({
    item,
    tagDefs,
    busy,
    onClose,
    onSubmit,
    onFormChange,
}: {
    item: BatchImportItem | null;
    tagDefs: readonly TagDefinition[] | undefined;
    busy: boolean;
    onClose: () => void;
    onSubmit: () => void;
    onFormChange: (next: ProjectFormValue) => void;
}) {
    const [filePanelMode, setFilePanelMode] = useState<ProjectFilePanelMode>(null);

    useEffect(() => {
        setFilePanelMode(null);
    }, [item?.id]);

    if (!item) return null;

    const effectiveInspection = item.inspection ?? createInspectionFallback(item.form);

    return (
        <>
            <DrawerPanelShell
                title={`手动添加：${item.form.name || item.inspection?.suggestedName || '未命名项目'}`}
                onClose={onClose}
                showBackdrop
                panelClassName={filePanelMode ? 'shadow-xl' : undefined}
                edgeAccessory={filePanelMode === null ? (
                    <ProjectFilesPanelToggle onClick={() => setFilePanelMode('browse')} />
                ) : null}
                panelZIndex={50}
                backdropZIndex={45}
                footer={
                    <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={onClose}>
                            返回批量列表
                        </Button>
                        <Button size="sm" disabled={busy || !item.validation.valid || hasEmptyFileFingerprint(item.form)} onClick={onSubmit}>
                            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                            仅添加这个项目
                        </Button>
                    </div>
                }
            >
                <ProjectDetailsView
                    form={item.form}
                    onFormChange={onFormChange}
                    tagDefs={tagDefs}
                    inspection={effectiveInspection}
                    pathEditable={false}
                    pathHint={renderInspectionHint(item.inspection)}
                    validation={renderAddProjectValidation(item.validation, hasEmptyFileFingerprint(item.form))}
                    onAddTag={tag => onFormChange({
                        ...item.form,
                        tags: item.form.tags.includes(tag) ? item.form.tags : [...item.form.tags, tag],
                    })}
                    onRemoveTag={tag => onFormChange({
                        ...item.form,
                        tags: item.form.tags.filter(current => current !== tag),
                    })}
                    onEditFileFingerprint={() => setFilePanelMode('select-fingerprint')}
                />
            </DrawerPanelShell>

            {filePanelMode ? (
                <ProjectFilesSidePanel
                    mode={filePanelMode}
                    path={item.form.path}
                    projectIgnore={item.form.ignore}
                    initialInspection={effectiveInspection}
                    selectedPaths={item.form.fingerprint.kind === 'file-paths' ? item.form.fingerprint.paths : []}
                    favoriteFiles={item.form.favoriteFiles}
                    onFavoriteFilesChange={paths => onFormChange({
                        ...item.form,
                        favoriteFiles: paths,
                    })}
                    onClose={() => setFilePanelMode(null)}
                    onConfirmSelection={paths => {
                        onFormChange({
                            ...item.form,
                            fingerprint: { kind: 'file-paths', paths },
                        });
                        setFilePanelMode(null);
                    }}
                />
            ) : null}
        </>
    );
}

function renderInspectionHint(inspection: ProjectDirectoryInspection | null) {
    const text = describeInspectionHint(inspection);
    if (!text) return null;
    return (
        <p className="text-note text-muted-foreground">
            {text}
        </p>
    );
}

function createInspectionFallback(form: ProjectFormValue): ProjectDirectoryInspection | null {
    const path = form.path.trim();
    if (!path) return null;
    return {
        path,
        suggestedName: path.split(/[\\/]/).filter(Boolean).pop() ?? form.name,
        hasMetaFile: false,
        tree: [],
        files: form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : [],
        filesComplete: false,
    };
}

function renderConflictValidation(validation: ManualProjectValidationResult) {
    if (validation.valid || validation.conflicts.length === 0) return null;
    return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
            <p className="font-medium">{getManualProjectValidationTitle(validation, 'batch')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.conflicts.map(conflict => (
                    <li key={`${conflict.projectId}-${conflict.kind}-${conflict.detail ?? ''}`}>
                        {conflict.projectName}：{describeManualProjectValidationConflict(conflict)}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function renderEmptyFingerprintValidation() {
    return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
            文件列表指纹至少需要选择一个文件。
        </div>
    );
}

function renderAddProjectValidation(validation: ManualProjectValidationResult, missingFingerprintFile: boolean) {
    const conflictValidation = renderConflictValidation(validation);
    if (!conflictValidation && !missingFingerprintFile) return null;
    return (
        <div className="space-y-3">
            {conflictValidation}
            {missingFingerprintFile ? renderEmptyFingerprintValidation() : null}
        </div>
    );
}

function describeFingerprint(fingerprint: ProjectFormValue['fingerprint']): string {
    if (fingerprint.kind === 'metadata') return 'metadata';
    if (fingerprint.kind === 'folder-name') return `文件夹名称（${fingerprint.folderName || '未命名'}）`;
    return `文件列表（${fingerprint.paths.length} 个文件）`;
}

function BatchImportGroup({
    title,
    items,
    children,
}: {
    title: string;
    items: BatchImportItem[];
    children: (item: BatchImportItem) => ReactNode;
}) {
    if (items.length === 0) return null;
    return (
        <section className="space-y-3">
            <h3 className="text-subheading text-foreground">{title}</h3>
            <div className="divide-y divide-border border-t border-border">
                {items.map(item => children(item))}
            </div>
        </section>
    );
}

function BatchImportRow({
    item,
    busy,
    onImportOne,
    onRemoveOne,
    onOpenOverride,
}: {
    item: BatchImportItem;
    busy: boolean;
    onImportOne: (id: string) => void;
    onRemoveOne: (id: string) => void;
    onOpenOverride: (id: string) => void;
}) {
    const ready = isBatchItemReady(item);
    const alreadyAdded = isBatchItemAlreadyAdded(item);
    const removable = !alreadyAdded && item.status !== 'importing';

    return (
        <div className="space-y-3 py-4 first:pt-3 last:pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <h4 className="truncate text-subheading text-foreground">{item.form.name || item.inspection?.suggestedName || '未命名项目'}</h4>
                    <p className="break-all text-note text-muted-foreground">{item.form.path}</p>
                    <p className="text-note text-muted-foreground">当前识别方式：{describeFingerprint(item.form.fingerprint)}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {alreadyAdded ? null : (
                        <>
                            {ready ? (
                                <Button size="sm" variant="outline" disabled={busy || item.status === 'importing'} onClick={() => onImportOne(item.id)}>
                                    {item.status === 'importing' ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                                    添加
                                </Button>
                            ) : (
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => onOpenOverride(item.id)}>
                                    <PencilLine className="size-3.5" /> 单独重写添加
                                </Button>
                            )}

                            {removable ? (
                                <Button size="icon-xs" variant="ghost" disabled={busy} onClick={() => onRemoveOne(item.id)}>
                                    <X className="size-3.5" />
                                </Button>
                            ) : null}
                        </>
                    )}
                </div>
            </div>

            {alreadyAdded ? (
                <StatusBlock
                    tone="success"
                    title="已添加"
                    description={item.status === 'imported' ? '这个文件夹已经成功加入项目列表。' : '该目录已经在项目列表中，无需重复添加。'}
                />
            ) : null}

            {item.error ? (
                <StatusBlock tone="error" title="添加失败" description={item.error} />
            ) : null}

            {!alreadyAdded && !item.validation.valid ? renderConflictValidation(item.validation) : null}
            {hasEmptyFileFingerprint(item.form) ? renderEmptyFingerprintValidation() : null}
        </div>
    );
}

function StatusBlock({
    tone,
    title,
    description,
}: {
    tone: 'success' | 'error';
    title: string;
    description: string;
}) {
    const icon = tone === 'success'
        ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        : <AlertTriangle className="mt-0.5 size-4 shrink-0" />;
    const className = tone === 'success'
        ? 'rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-3 text-note text-emerald-700 dark:text-emerald-300'
        : 'rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-note text-destructive';
    return (
        <div className={className}>
            <div className="flex items-start gap-2">
                {icon}
                <div>
                    <p className="font-medium">{title}</p>
                    <p className="mt-1">{description}</p>
                </div>
            </div>
        </div>
    );
}
