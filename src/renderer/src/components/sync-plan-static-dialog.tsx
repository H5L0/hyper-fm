import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, CircleOff, AlertTriangle } from 'lucide-react';
import type { SyncFileOperationKind, SyncPlanApplyRequest, SyncPlanPreview, SyncPlanSummary } from '@shared/sync-types.js';
import { EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const OPERATION_LABELS: Record<SyncFileOperationKind, string> = {
    create: '新增',
    update: '更新',
    delete: '删除',
    conflict: '冲突',
    skip: '跳过',
};

const OPERATION_ICONS = {
    create: ArrowDownToLine,
    update: ArrowRightLeft,
    delete: ArrowUpFromLine,
    conflict: AlertTriangle,
    skip: CircleOff,
};

function aggregateSummary(preview: SyncPlanPreview, selectedProjectIds: string[]): SyncPlanSummary {
    const selected = new Set(selectedProjectIds);
    return preview.projects.reduce<SyncPlanSummary>((summary, project) => {
        if (!selected.has(project.projectId)) {
            return summary;
        }
        return {
            create: summary.create + project.summary.create,
            update: summary.update + project.summary.update,
            delete: summary.delete + project.summary.delete,
            conflict: summary.conflict + project.summary.conflict,
            skip: summary.skip + project.summary.skip,
            total: summary.total + project.summary.total,
        };
    }, { create: 0, update: 0, delete: 0, conflict: 0, skip: 0, total: 0 });
}

export function SyncPlanStaticDialog({
    title,
    preview,
    busy = false,
    applyLabel = '执行',
    onApply,
    onClose,
}: {
    title: string;
    preview: SyncPlanPreview;
    busy?: boolean;
    applyLabel?: string;
    onApply: (request: SyncPlanApplyRequest) => void;
    onClose: () => void;
}) {
    const allProjectIds = useMemo(() => preview.projects.map(project => project.projectId), [preview.projects]);
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(allProjectIds);
    const [focusedProjectId, setFocusedProjectId] = useState<string | null>(allProjectIds[0] ?? null);

    useEffect(() => {
        setSelectedProjectIds(allProjectIds);
        setFocusedProjectId(allProjectIds[0] ?? null);
    }, [allProjectIds]);

    const focusedProject = useMemo(
        () => preview.projects.find(project => project.projectId === focusedProjectId) ?? preview.projects[0] ?? null,
        [focusedProjectId, preview.projects],
    );
    const selectedSummary = useMemo(
        () => aggregateSummary(preview, selectedProjectIds),
        [preview, selectedProjectIds],
    );

    return (
        <EditDialogShell
            title={title}
            onClose={onClose}
            closeLabel="关闭"
            panelClassName="w-[min(1120px,calc(100vw-2rem))] max-h-[min(92vh,960px)]"
            bodyClassName="grid min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-0"
            bodyPaddingClassName="p-0"
            footerStart={(
                <div className="flex flex-wrap items-center gap-2 text-note text-muted-foreground">
                    <span>新增 {selectedSummary.create}</span>
                    <span>更新 {selectedSummary.update}</span>
                    <span>删除 {selectedSummary.delete}</span>
                    <span>冲突 {selectedSummary.conflict}</span>
                </div>
            )}
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button
                        size="sm"
                        disabled={busy || selectedProjectIds.length === 0}
                        onClick={() => onApply({
                            projectIds: selectedProjectIds,
                            operations: [],
                            ranges: [],
                        })}
                    >
                        {applyLabel}
                    </Button>
                </>
            )}
        >
            <aside className="min-h-0 overflow-y-auto border-r border-border bg-muted/10 p-3">
                <div className="space-y-2">
                    {preview.projects.map(project => {
                        const selected = selectedProjectIds.includes(project.projectId);
                        const focused = focusedProject?.projectId === project.projectId;
                        return (
                            <div
                                key={project.projectId}
                                className={cn(
                                    'rounded-xl px-3 py-3 transition-colors',
                                    focused ? 'bg-primary/8' : 'hover:bg-muted/40',
                                )}
                            >
                                <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2">
                                    <Checkbox
                                        checked={selected}
                                        className="mt-1"
                                        onCheckedChange={checked => {
                                            setSelectedProjectIds(current => checked === true
                                                ? current.includes(project.projectId)
                                                    ? current
                                                    : [...current, project.projectId]
                                                : current.filter(id => id !== project.projectId));
                                        }}
                                    />
                                    <button type="button" className="min-w-0 text-left" onClick={() => setFocusedProjectId(project.projectId)}>
                                        <p className="truncate text-subheading text-foreground">{project.projectName}</p>
                                        <p className="mt-1 text-caption text-muted-foreground">
                                            新增 {project.summary.create} · 更新 {project.summary.update} · 删除 {project.summary.delete} · 冲突 {project.summary.conflict}
                                        </p>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-5">
                {!focusedProject ? (
                    <div className="grid min-h-full place-items-center text-note text-muted-foreground">未选择项目</div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <h3 className="text-heading text-foreground">{focusedProject.projectName}</h3>
                            <div className="mt-2 grid gap-1 text-note text-muted-foreground">
                                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                                    <span className="text-caption">项目目录</span>
                                    <span className="break-all">{focusedProject.localPath}</span>
                                </div>
                                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                                    <span className="text-caption">目标目录</span>
                                    <span className="break-all">{focusedProject.targetPath}</span>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-border">
                            <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-border px-4 py-2 text-caption text-muted-foreground">
                                <span>操作</span>
                                <span>路径</span>
                            </div>
                            <div className="divide-y divide-border">
                                {focusedProject.operations.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-note text-muted-foreground">没有可显示的条目</div>
                                ) : focusedProject.operations.map(operation => {
                                    const Icon = OPERATION_ICONS[operation.kind];
                                    return (
                                        <div key={operation.relativePath} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 px-4 py-3">
                                            <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                                                <Icon className="size-3.5" />
                                                {OPERATION_LABELS[operation.kind]}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="truncate text-body text-foreground">{operation.relativePath}</p>
                                                {operation.note ? <p className="mt-1 text-caption text-muted-foreground">{operation.note}</p> : null}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </EditDialogShell>
    );
}
