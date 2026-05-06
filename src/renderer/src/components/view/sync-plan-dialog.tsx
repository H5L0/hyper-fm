import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    FilePlus2,
    FolderTree,
    GitCompareArrows,
    LoaderCircle,
    MinusCircle,
    RefreshCw,
    Trash2,
    X,
    type LucideIcon,
} from 'lucide-react';
import type {
    SyncConflictMergeDraft,
    SyncFileOperationKind,
    SyncPlanApplyRequest,
    SyncPlanPreviewSession,
    SyncPlanRangeSelection,
    SyncPlanRow,
    SyncPlanSummary,
} from '@shared/sync-types.js';
import { Button } from '@/components/ui/button';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const FILTER_ORDER: SyncFileOperationKind[] = ['create', 'update', 'delete', 'conflict', 'skip'];
const FILTER_LABELS: Record<SyncFileOperationKind, string> = {
    create: '新增',
    update: '更新',
    delete: '删除',
    conflict: '冲突',
    skip: '跳过',
};
const PROJECT_STATUS_LABELS = {
    queued: '等待扫描',
    scanning: '扫描中',
    ready: '已就绪',
    updating: '更新中',
    applying: '执行中',
    error: '异常',
} as const;
const ROOT_FOLDER_LABEL = '项目根目录';
const TREE_GUIDE_SPACING = 32;
const ROW_HEIGHT = 32;
const SCROLLBAR_TRACK_INSET = 6;

interface OperationTone {
    icon: LucideIcon;
    className: string;
    textClassName: string;
}

interface PreparedSelectionProjectState {
    operationsByPath: Map<string, SyncPlanApplyRequest['operations'][number] & { sequence: number }>;
    ranges: Array<SyncPlanRangeSelection>;
}

interface PreparedSelectionState {
    byProject: Map<string, PreparedSelectionProjectState>;
}

interface DerivedRowState {
    checked: boolean;
    partiallyChecked: boolean;
    muted: boolean;
    toggleable: boolean;
}

const OPERATION_TONES: Record<SyncFileOperationKind | 'mixed', OperationTone> = {
    create: {
        icon: FilePlus2,
        className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
        textClassName: 'text-emerald-700 dark:text-emerald-300',
    },
    update: {
        icon: RefreshCw,
        className: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
        textClassName: 'text-sky-700 dark:text-sky-300',
    },
    delete: {
        icon: Trash2,
        className: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
        textClassName: 'text-rose-700 dark:text-rose-300',
    },
    conflict: {
        icon: AlertTriangle,
        className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
        textClassName: 'text-amber-700 dark:text-amber-300',
    },
    skip: {
        icon: MinusCircle,
        className: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
        textClassName: 'text-slate-700 dark:text-slate-300',
    },
    mixed: {
        icon: FolderTree,
        className: 'bg-muted text-muted-foreground',
        textClassName: 'text-muted-foreground',
    },
};

function operationKey(projectId: string, relativePath: string): string {
    return `${projectId}:${relativePath}`;
}

function rangeKey(projectId: string, startIndex: number, endIndex: number): string {
    return `${projectId}:${startIndex}:${endIndex}`;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function aggregateSummary(session: SyncPlanPreviewSession, selectedProjectIds: string[]): SyncPlanSummary {
    const selected = new Set(selectedProjectIds);
    return session.projects.reduce<SyncPlanSummary>((summary, project) => {
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

function isSyncableKind(kind: SyncFileOperationKind | 'mixed'): kind is SyncFileOperationKind {
    return kind !== 'mixed' && kind !== 'skip';
}

function operationLabel(kind: SyncFileOperationKind | 'mixed'): string {
    if (kind === 'mixed') return '混合';
    return FILTER_LABELS[kind];
}

function formatProjectSummary(summary: SyncPlanSummary): string {
    return `新增 ${summary.create} · 更新 ${summary.update} · 删除 ${summary.delete} · 冲突 ${summary.conflict}`;
}

function buildPathSegments(path: string): string[] {
    return path.split('/').filter(Boolean);
}

function createVisibleKindsState(): Record<SyncFileOperationKind, boolean> {
    return {
        create: true,
        update: true,
        delete: true,
        conflict: true,
        skip: true,
    };
}

function areAllKindsVisible(visibleKinds: Record<SyncFileOperationKind, boolean>): boolean {
    return FILTER_ORDER.every(kind => visibleKinds[kind]);
}

function isProjectScanning(status: SyncPlanPreviewSession['projects'][number]['status']): boolean {
    return status === 'queued' || status === 'scanning' || status === 'updating';
}

function useViewportHeight(ref: React.RefObject<HTMLElement | null>, fallbackRowHeight: number): number {
    const [height, setHeight] = useState(fallbackRowHeight * 8);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        const update = () => {
            const next = node.clientHeight;
            setHeight(Math.max(fallbackRowHeight, next || fallbackRowHeight));
        };

        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, [fallbackRowHeight, ref]);

    return height;
}

function prepareSelectionState(selection: {
    operations: SyncPlanApplyRequest['operations'];
    ranges: SyncPlanRangeSelection[];
}): PreparedSelectionState {
    const byProject = new Map<string, PreparedSelectionProjectState>();

    const ensureProjectState = (projectId: string): PreparedSelectionProjectState => {
        const existing = byProject.get(projectId);
        if (existing) {
            return existing;
        }
        const next: PreparedSelectionProjectState = {
            operationsByPath: new Map(),
            ranges: [],
        };
        byProject.set(projectId, next);
        return next;
    };

    for (const [index, operation] of selection.operations.entries()) {
        const projectState = ensureProjectState(operation.projectId);
        projectState.operationsByPath.set(operation.relativePath, {
            ...operation,
            sequence: operation.sequence ?? index,
        });
    }

    for (const range of selection.ranges) {
        ensureProjectState(range.projectId).ranges.push(range);
    }

    for (const projectState of byProject.values()) {
        projectState.ranges.sort((left, right) => left.sequence - right.sequence);
    }

    return { byProject };
}

function resolveFileEnabled(
    projectId: string,
    row: SyncPlanRow,
    selection: PreparedSelectionState,
): boolean {
    const defaultEnabled = row.kind === 'file' && isSyncableKind(row.aggregateKind);
    if (!defaultEnabled || !row.relativePath) {
        return false;
    }

    const projectState = selection.byProject.get(projectId);
    if (!projectState) {
        return true;
    }

    let enabled = true;
    let sequence = -1;

    for (const range of projectState.ranges) {
        if (row.index < range.startIndex || row.index > range.endIndex) {
            continue;
        }
        if (range.sequence >= sequence) {
            enabled = range.enabled;
            sequence = range.sequence;
        }
    }

    const explicit = projectState.operationsByPath.get(row.relativePath);
    if (explicit && explicit.sequence >= sequence) {
        enabled = explicit.enabled;
    }

    return enabled;
}

function OperationStat({
    kind,
    label,
    value,
    muted = false,
    interactive = false,
    active = true,
    onClick,
}: {
    kind: SyncFileOperationKind | 'mixed';
    label: string;
    value: number;
    muted?: boolean;
    interactive?: boolean;
    active?: boolean;
    onClick?: () => void;
}) {
    const tone = OPERATION_TONES[kind];
    const content = (
        <div className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-caption transition-colors',
            muted || !active ? 'bg-muted text-muted-foreground' : tone.className,
            interactive && 'cursor-pointer',
        )}>
            <tone.icon className="size-3.5" />
            <span>{label}</span>
            <span className="text-subheading tabular-nums">{value}</span>
        </div>
    );

    if (!interactive || !onClick) {
        return content;
    }

    return (
        <button type="button" onClick={onClick} aria-pressed={active} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {content}
        </button>
    );
}

function OperationText({ kind }: { kind: SyncFileOperationKind | 'mixed' }) {
    const tone = OPERATION_TONES[kind];
    return (
        <span className={cn('inline-flex items-center gap-1.5 text-caption font-medium', tone.textClassName)}>
            <tone.icon className="size-3.5" />
            {operationLabel(kind)}
        </span>
    );
}

function TreePrefix({ depth }: { depth: number }) {
    const levelCount = Math.max(depth + 1, 1);
    return (
        <div className="mr-1 flex shrink-0 items-center" aria-hidden="true">
            {Array.from({ length: levelCount }, (_, index) => (
                <div key={`tree-prefix:${depth}:${index}`} className="flex items-center">
                    <span className="flex h-4 w-2.5 items-center justify-center">
                        <span className="h-4 w-px rounded-full bg-border/70" />
                    </span>
                    {index < levelCount - 1 ? <span style={{ width: `${TREE_GUIDE_SPACING - 4}px` }} /> : null}
                </div>
            ))}
        </div>
    );
}

function RowPlaceholder({ top }: { top: number }) {
    return (
        <div
            className="absolute left-0 right-0 px-5"
            style={{ top: `${top}px`, height: `${ROW_HEIGHT}px` }}
        >
            <div className="grid h-full grid-cols-[32px_92px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/70">
                <div className="mx-auto h-4 w-4 rounded bg-muted" />
                <div className="h-3.5 w-16 rounded bg-muted" />
                <div className="h-3.5 w-44 max-w-full rounded bg-muted" />
            </div>
        </div>
    );
}

export function SyncPlanDialog({
    title,
    session,
    busy = false,
    applyLabel = '执行同步',
    onApply,
    onClose,
    onOpenDiff,
    onOpenConflictMerge,
}: {
    title: string;
    session: SyncPlanPreviewSession;
    busy?: boolean;
    applyLabel?: string;
    onApply: (request: SyncPlanApplyRequest) => void;
    onClose: () => void;
    onOpenDiff?: (projectId: string, relativePath: string) => Promise<void> | void;
    onOpenConflictMerge?: (projectId: string, relativePath: string) => Promise<SyncConflictMergeDraft> | SyncConflictMergeDraft;
}) {
    const allProjectIds = useMemo(() => session.projects.map(project => project.projectId), [session.projects]);
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(allProjectIds);
    const [focusedProjectId, setFocusedProjectId] = useState<string | null>(allProjectIds[0] ?? null);
    const [operationSelections, setOperationSelections] = useState<Record<string, SyncPlanApplyRequest['operations'][number]>>({});
    const [rangeSelections, setRangeSelections] = useState<Record<string, SyncPlanRangeSelection>>({});
    const [visibleKinds, setVisibleKinds] = useState<Record<SyncFileOperationKind, boolean>>(() => createVisibleKindsState());
    const [structureRowsByProject, setStructureRowsByProject] = useState<Record<string, Record<number, SyncPlanRow>>>({});
    const [loadingStructureRows, setLoadingStructureRows] = useState(false);
    const [scrollIndex, setScrollIndex] = useState(0);
    const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
    const sequenceRef = useRef(1);
    const wheelAccumulatorRef = useRef(0);
    const scrollbarDragRef = useRef<{ startY: number; startIndex: number } | null>(null);
    const viewportHostRef = useRef<HTMLDivElement | null>(null);
    const viewportHeight = useViewportHeight(viewportHostRef, ROW_HEIGHT);

    useEffect(() => {
        setSelectedProjectIds(allProjectIds);
        setFocusedProjectId(allProjectIds[0] ?? null);
        setOperationSelections({});
        setRangeSelections({});
        setVisibleKinds(createVisibleKindsState());
        setStructureRowsByProject({});
        sequenceRef.current = 1;
        wheelAccumulatorRef.current = 0;
        setScrollIndex(0);
    }, [allProjectIds, session.sessionId]);

    const selectedProjectIdSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);
    const selectedProjects = useMemo(
        () => session.projects.filter(project => selectedProjectIdSet.has(project.projectId)),
        [selectedProjectIdSet, session.projects],
    );
    const allSelected = allProjectIds.length > 0 && selectedProjectIds.length === allProjectIds.length;
    const focusedProject = useMemo(
        () => selectedProjects.find(project => project.projectId === focusedProjectId) ?? selectedProjects[0] ?? null,
        [focusedProjectId, selectedProjects],
    );
    const selectedSummary = useMemo(
        () => aggregateSummary(session, selectedProjectIds),
        [selectedProjectIds, session],
    );
    const currentSelectionState = useMemo(() => ({
        operations: Object.values(operationSelections),
        ranges: Object.values(rangeSelections),
    }), [operationSelections, rangeSelections]);
    const preparedSelection = useMemo(
        () => prepareSelectionState(currentSelectionState),
        [currentSelectionState],
    );
    const allKindsVisible = useMemo(() => areAllKindsVisible(visibleKinds), [visibleKinds]);

    useEffect(() => {
        if (selectedProjects.length === 0) {
            setFocusedProjectId(null);
            return;
        }
        if (!focusedProjectId || !selectedProjectIdSet.has(focusedProjectId)) {
            setFocusedProjectId(selectedProjects[0]!.projectId);
        }
    }, [focusedProjectId, selectedProjectIdSet, selectedProjects]);

    useEffect(() => {
        if (!focusedProjectId) return;
        wheelAccumulatorRef.current = 0;
        setScrollIndex(0);
    }, [focusedProjectId]);

    useEffect(() => {
        if (!focusedProject) return;
        setStructureRowsByProject(current => ({
            ...current,
            [focusedProject.projectId]: {},
        }));
    }, [focusedProject?.projectId, focusedProject?.updatedAt]);

    useEffect(() => {
        if (!focusedProject || focusedProject.rowCount <= 0) {
            return;
        }

        let cancelled = false;
        setLoadingStructureRows(true);

        const loadAllRows = async () => {
            const chunkSize = 400;
            for (let start = 0; start < focusedProject.rowCount; start += chunkSize) {
                if (cancelled) return;
                const page = await window.fm.sync.getSyncPreviewRows(
                    session.sessionId,
                    focusedProject.projectId,
                    start,
                    Math.min(chunkSize, focusedProject.rowCount - start),
                );
                if (cancelled) return;
                setStructureRowsByProject(current => {
                    const nextProjectRows = { ...(current[focusedProject.projectId] ?? {}) };
                    for (const row of page.rows) {
                        nextProjectRows[row.index] = row;
                    }
                    return {
                        ...current,
                        [focusedProject.projectId]: nextProjectRows,
                    };
                });
            }
        };

        void loadAllRows().finally(() => {
            if (!cancelled) {
                setLoadingStructureRows(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [focusedProject?.projectId, focusedProject?.rowCount, focusedProject?.updatedAt, session.sessionId]);

    const rowCount = focusedProject?.rowCount ?? 0;
    const structureProjectRows = focusedProject ? (structureRowsByProject[focusedProject.projectId] ?? {}) : {};
    const structureRowList = useMemo(
        () => Object.values(structureProjectRows).sort((left, right) => left.index - right.index),
        [structureProjectRows],
    );
    const isStructureReady = rowCount === 0 || structureRowList.length >= rowCount;

    const derivedRowStates = useMemo(() => {
        const stateByIndex = new Map<number, DerivedRowState>();
        if (!focusedProject) {
            return stateByIndex;
        }

        const syncablePrefix = new Array(rowCount + 1).fill(0);
        const enabledPrefix = new Array(rowCount + 1).fill(0);

        for (let index = 0; index < rowCount; index += 1) {
            syncablePrefix[index + 1] = syncablePrefix[index];
            enabledPrefix[index + 1] = enabledPrefix[index];

            const row = structureProjectRows[index];
            if (!row || row.kind !== 'file') {
                continue;
            }

            const toggleable = isSyncableKind(row.aggregateKind);
            const checked = toggleable && resolveFileEnabled(focusedProject.projectId, row, preparedSelection);
            syncablePrefix[index + 1] += toggleable ? 1 : 0;
            enabledPrefix[index + 1] += checked ? 1 : 0;

            stateByIndex.set(index, {
                checked,
                partiallyChecked: false,
                muted: !checked,
                toggleable,
            });
        }

        for (const row of structureRowList) {
            if (row.kind !== 'folder') {
                continue;
            }
            const totalSyncable = syncablePrefix[row.subtreeEndIndex + 1] - syncablePrefix[row.index + 1];
            const enabledCount = enabledPrefix[row.subtreeEndIndex + 1] - enabledPrefix[row.index + 1];
            stateByIndex.set(row.index, {
                checked: totalSyncable > 0 && enabledCount === totalSyncable,
                partiallyChecked: enabledCount > 0 && enabledCount < totalSyncable,
                muted: enabledCount === 0,
                toggleable: totalSyncable > 0,
            });
        }

        return stateByIndex;
    }, [focusedProject, preparedSelection, rowCount, structureProjectRows, structureRowList]);

    const displayRows = useMemo(() => {
        if (!focusedProject) {
            return [] as SyncPlanRow[];
        }
        if (!isStructureReady || allKindsVisible) {
            return structureRowList;
        }

        const visibleFilePrefix = new Array(rowCount + 1).fill(0);
        for (let index = 0; index < rowCount; index += 1) {
            const row = structureProjectRows[index];
            const visible = row?.kind === 'file' && visibleKinds[row.aggregateKind as SyncFileOperationKind] === true;
            visibleFilePrefix[index + 1] = visibleFilePrefix[index] + (visible ? 1 : 0);
        }

        return structureRowList.filter(row => {
            if (row.kind === 'file') {
                return visibleKinds[row.aggregateKind as SyncFileOperationKind] === true;
            }
            return visibleFilePrefix[row.subtreeEndIndex + 1] - visibleFilePrefix[row.index + 1] > 0;
        });
    }, [allKindsVisible, focusedProject, isStructureReady, rowCount, structureProjectRows, structureRowList, visibleKinds]);

    const folderDisplayIndexByPath = useMemo(() => {
        const map = new Map<string, number>();
        displayRows.forEach((row, displayIndex) => {
            if (row.kind === 'folder') {
                map.set(row.folderPath, displayIndex);
            }
        });
        return map;
    }, [displayRows]);

    const virtualRowCount = displayRows.length;
    const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT));
    const maxScrollIndex = Math.max(virtualRowCount - visibleRowCount, 0);
    const firstVisibleDisplayIndex = clamp(scrollIndex, 0, maxScrollIndex);
    const requestLength = Math.min(visibleRowCount, Math.max(virtualRowCount - firstVisibleDisplayIndex, 0));
    const renderRows = useMemo(
        () => displayRows.slice(firstVisibleDisplayIndex, firstVisibleDisplayIndex + requestLength),
        [displayRows, firstVisibleDisplayIndex, requestLength],
    );
    const scrollbarTrackHeight = Math.max(viewportHeight - SCROLLBAR_TRACK_INSET * 2, 0);
    const scrollbarThumbHeight = maxScrollIndex <= 0
        ? scrollbarTrackHeight
        : Math.max(28, (visibleRowCount / Math.max(virtualRowCount, 1)) * scrollbarTrackHeight);
    const scrollbarThumbTop = maxScrollIndex <= 0
        ? 0
        : (firstVisibleDisplayIndex / maxScrollIndex) * Math.max(scrollbarTrackHeight - scrollbarThumbHeight, 0);

    const stickyRow = displayRows[firstVisibleDisplayIndex] ?? null;
    const stickyFolderPath = stickyRow?.kind === 'folder'
        ? stickyRow.folderPath
        : stickyRow?.folderPath ?? '';
    const breadcrumbSegments = buildPathSegments(stickyFolderPath);

    useEffect(() => {
        if (scrollIndex > maxScrollIndex) {
            setScrollIndex(maxScrollIndex);
        }
    }, [maxScrollIndex, scrollIndex]);

    const focusedKindCounts = useMemo(() => {
        const summary = focusedProject?.summary ?? { create: 0, update: 0, delete: 0, conflict: 0, skip: 0, total: 0 };
        return new Map<SyncFileOperationKind, number>([
            ['create', summary.create],
            ['update', summary.update],
            ['delete', summary.delete],
            ['conflict', summary.conflict],
            ['skip', summary.skip],
        ]);
    }, [focusedProject]);

    const nextSequence = () => {
        const next = sequenceRef.current;
        sequenceRef.current += 1;
        return next;
    };

    const updateOperationSelection = (
        projectId: string,
        relativePath: string,
        updater: (current?: SyncPlanApplyRequest['operations'][number]) => SyncPlanApplyRequest['operations'][number],
    ) => {
        const key = operationKey(projectId, relativePath);
        setOperationSelections(current => ({
            ...current,
            [key]: updater(current[key]),
        }));
    };

    const updateRangeSelection = (projectId: string, startIndex: number, endIndex: number, enabled: boolean) => {
        if (endIndex < startIndex) {
            return;
        }
        const key = rangeKey(projectId, startIndex, endIndex);
        setRangeSelections(current => ({
            ...current,
            [key]: {
                projectId,
                startIndex,
                endIndex,
                enabled,
                sequence: nextSequence(),
            },
        }));
    };

    const scrollToDisplayIndex = (displayIndex: number) => {
        wheelAccumulatorRef.current = 0;
        setScrollIndex(clamp(displayIndex, 0, maxScrollIndex));
    };

    const handleListWheel = (deltaY: number) => {
        if (maxScrollIndex <= 0) {
            return;
        }
        wheelAccumulatorRef.current += deltaY;
        const threshold = 40;
        if (Math.abs(wheelAccumulatorRef.current) < threshold) {
            return;
        }
        const direction = Math.sign(wheelAccumulatorRef.current);
        const steps = Math.max(1, Math.trunc(Math.abs(wheelAccumulatorRef.current) / threshold));
        wheelAccumulatorRef.current -= direction * steps * threshold;
        scrollToDisplayIndex(firstVisibleDisplayIndex + direction * steps);
    };

    useEffect(() => {
        if (maxScrollIndex <= 0) {
            scrollbarDragRef.current = null;
            return;
        }

        const handlePointerMove = (event: PointerEvent) => {
            const drag = scrollbarDragRef.current;
            if (!drag) {
                return;
            }
            const travel = Math.max(viewportHeight - scrollbarThumbHeight, 1);
            const nextRatio = clamp((event.clientY - drag.startY) / travel, -1, 1);
            const nextIndex = Math.round(drag.startIndex + nextRatio * maxScrollIndex);
            setScrollIndex(clamp(nextIndex, 0, maxScrollIndex));
        };

        const handlePointerUp = () => {
            scrollbarDragRef.current = null;
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [maxScrollIndex, scrollbarThumbHeight, viewportHeight]);

    const applyRequest = useMemo<SyncPlanApplyRequest>(() => ({
        sessionId: session.sessionId,
        projectIds: selectedProjectIds,
        operations: Object.values(operationSelections).filter(item => selectedProjectIdSet.has(item.projectId)),
        ranges: Object.values(rangeSelections).filter(item => selectedProjectIdSet.has(item.projectId)),
    }), [operationSelections, rangeSelections, selectedProjectIdSet, selectedProjectIds, session.sessionId]);

    const canApply = selectedProjectIds.length > 0
        && session.progress.processedProjects >= session.progress.totalProjects
        && session.stage !== 'applying';
    const isSessionScanning = session.progress.processedProjects < session.progress.totalProjects;

    return (
        <>
            <button
                type="button"
                aria-label="关闭同步预览"
                onClick={onClose}
                className="fixed inset-0 z-[60] cursor-default bg-black/40 backdrop-blur-[2px]"
            />

            <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] bg-background text-foreground">
                <div className="grid h-full grid-rows-[52px_minmax(0,1fr)_64px]">
                    <header className="flex items-center justify-between gap-3 border-b border-border px-5">
                        <div className="flex min-w-0 items-center gap-3">
                            <h2 className="text-title text-foreground">{title}</h2>
                            {isSessionScanning ? (
                                <span className="inline-flex items-center gap-1.5 text-note text-muted-foreground">
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                    扫描中 {session.progress.processedProjects}/{session.progress.totalProjects}
                                </span>
                            ) : null}
                        </div>
                        <Button size="sm" variant="ghost" onClick={onClose}>
                            <X className="size-3.5" /> 关闭
                        </Button>
                    </header>

                    <div className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)]">
                        <aside className="flex min-h-0 flex-col border-r border-border bg-muted/10">
                            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                                <span className="text-heading text-foreground">项目列表</span>
                                <div className="flex items-center gap-2">
                                    <Button size="xs" variant={allSelected ? 'secondary' : 'outline'} onClick={() => setSelectedProjectIds(allProjectIds)}>
                                        全选
                                    </Button>
                                    <Button size="xs" variant="outline" onClick={() => setSelectedProjectIds(current => allProjectIds.filter(id => !current.includes(id)))}>
                                        反选
                                    </Button>
                                </div>
                            </div>

                            <div className="min-h-0 flex-1 overflow-y-auto">
                                {session.projects.map(project => {
                                    const selected = selectedProjectIdSet.has(project.projectId);
                                    const focused = focusedProject?.projectId === project.projectId;
                                    return (
                                        <div
                                            key={project.projectId}
                                            className={cn(
                                                'border-b border-border px-4 py-3 transition-colors',
                                                focused ? 'bg-primary/7' : 'hover:bg-muted/35',
                                            )}
                                        >
                                            <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2">
                                                <Checkbox
                                                    checked={selected}
                                                    onCheckedChange={checked => {
                                                        const nextChecked = checked === true;
                                                        setSelectedProjectIds(current => nextChecked
                                                            ? current.includes(project.projectId)
                                                                ? current
                                                                : [...current, project.projectId]
                                                            : current.filter(id => id !== project.projectId));
                                                        if (nextChecked) {
                                                            setFocusedProjectId(project.projectId);
                                                        }
                                                    }}
                                                    className="mt-1"
                                                />
                                                <button type="button" className="min-w-0 text-left" onClick={() => setFocusedProjectId(project.projectId)}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="truncate text-subheading text-foreground">{project.projectName}</div>
                                                        {isProjectScanning(project.status) ? (
                                                            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                                                        ) : null}
                                                    </div>
                                                    <div className="mt-1 text-caption text-muted-foreground">
                                                        {formatProjectSummary(project.summary)}
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </aside>

                        <main className="flex min-h-0 flex-col">
                            {!focusedProject ? (
                                <div className="grid min-h-0 flex-1 place-items-center text-note text-muted-foreground">未选择项目</div>
                            ) : (
                                <>
                                    <div className="border-b border-border px-5 py-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <h3 className="min-w-0 flex-1 text-heading text-foreground">{focusedProject.projectName}</h3>
                                            <div className="flex max-w-[min(100%,540px)] flex-wrap items-center justify-end gap-2">
                                                {focusedProject.status === 'error' ? (
                                                    <span className="inline-flex h-7 items-center rounded-lg bg-destructive/10 px-2.5 text-note text-destructive">
                                                        {PROJECT_STATUS_LABELS[focusedProject.status]}
                                                    </span>
                                                ) : null}
                                                {FILTER_ORDER.map(kind => (
                                                    <OperationStat
                                                        key={kind}
                                                        kind={kind}
                                                        label={FILTER_LABELS[kind]}
                                                        value={focusedKindCounts.get(kind) ?? 0}
                                                        muted={(focusedKindCounts.get(kind) ?? 0) === 0}
                                                        interactive
                                                        active={visibleKinds[kind]}
                                                        onClick={() => setVisibleKinds(current => ({
                                                            ...current,
                                                            [kind]: !current[kind],
                                                        }))}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                        <div className="mt-3 grid gap-1 text-note text-muted-foreground">
                                            <div className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-3">
                                                <span className="text-caption">项目目录</span>
                                                <span className="break-all">{focusedProject.localPath || '—'}</span>
                                            </div>
                                            <div className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-3">
                                                <span className="text-caption">目标目录</span>
                                                <span className="break-all">{focusedProject.targetPath || '正在解析…'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)]">
                                        <div className="grid grid-cols-[32px_92px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-2 text-caption text-muted-foreground">
                                            <span />
                                            <span>操作</span>
                                            <span>路径</span>
                                            <span />
                                        </div>

                                        <div className="border-b border-border bg-background/95 px-5 py-2 backdrop-blur">
                                            <div className="flex items-center gap-2 text-note text-muted-foreground h-4">
                                                <FolderTree className="size-3.5 shrink-0" />
                                                <Breadcrumb>
                                                    <BreadcrumbList>
                                                        <BreadcrumbItem>
                                                            <button
                                                                type="button"
                                                                className="transition-colors hover:text-foreground"
                                                                onClick={() => scrollToDisplayIndex(0)}
                                                            >
                                                                {breadcrumbSegments.length === 0 ? <BreadcrumbPage>{ROOT_FOLDER_LABEL}</BreadcrumbPage> : ROOT_FOLDER_LABEL}
                                                            </button>
                                                        </BreadcrumbItem>
                                                        {breadcrumbSegments.map((segment, index) => {
                                                            const nextPath = breadcrumbSegments.slice(0, index + 1).join('/');
                                                            return (
                                                                <BreadcrumbItem key={`${segment}:${index}`}>
                                                                    <BreadcrumbSeparator />
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            'truncate transition-colors hover:text-foreground',
                                                                            index === breadcrumbSegments.length - 1 && 'text-foreground',
                                                                        )}
                                                                        onClick={() => {
                                                                            const targetDisplayIndex = folderDisplayIndexByPath.get(nextPath);
                                                                            if (targetDisplayIndex !== undefined) {
                                                                                scrollToDisplayIndex(targetDisplayIndex);
                                                                            }
                                                                        }}
                                                                    >
                                                                        {index === breadcrumbSegments.length - 1 ? <BreadcrumbPage>{segment}</BreadcrumbPage> : segment}
                                                                    </button>
                                                                </BreadcrumbItem>
                                                            );
                                                        })}
                                                    </BreadcrumbList>
                                                </Breadcrumb>
                                            </div>
                                        </div>

                                        <div ref={viewportHostRef} className="min-h-0">
                                            <div
                                                className="relative h-full overflow-hidden pr-2"
                                                style={{ height: `${viewportHeight}px` }}
                                                onWheel={event => {
                                                    event.preventDefault();
                                                    handleListWheel(event.deltaY);
                                                }}
                                            >
                                                {virtualRowCount === 0 ? (
                                                    <div className="grid h-full place-items-center text-note text-muted-foreground">
                                                        {focusedProject.status === 'queued' || focusedProject.status === 'scanning' || focusedProject.status === 'updating'
                                                            ? '正在扫描该项目…'
                                                            : focusedProject.status === 'applying'
                                                                ? '正在执行同步…'
                                                                : focusedProject.status === 'error'
                                                                    ? (focusedProject.errorMessage || '该项目预览失败，请稍后重试')
                                                                    : allKindsVisible
                                                                        ? '当前预览没有条目'
                                                                        : '当前筛选下没有条目'}
                                                    </div>
                                                ) : (
                                                    <div className="relative h-full overflow-hidden">
                                                        {renderRows.map((row, offset) => {
                                                            const derived = derivedRowStates.get(row.index) ?? {
                                                                checked: row.checked,
                                                                partiallyChecked: row.partiallyChecked,
                                                                muted: row.muted,
                                                                toggleable: row.kind === 'folder' ? row.subtreeEndIndex > row.index : isSyncableKind(row.aggregateKind),
                                                            };
                                                            const rowKey = row.relativePath ? operationKey(focusedProject.projectId, row.relativePath) : `folder:${row.index}`;
                                                            const selection = row.relativePath ? operationSelections[rowKey] : undefined;
                                                            const resolution = selection?.conflictResolution;
                                                            const canOpenDiff = row.kind === 'file'
                                                                && Boolean(onOpenDiff)
                                                                && (row.aggregateKind === 'update' || row.aggregateKind === 'conflict');
                                                            const canManualMerge = row.kind === 'file'
                                                                && row.aggregateKind === 'conflict'
                                                                && Boolean(onOpenConflictMerge);
                                                            const displayLabel = row.kind === 'folder'
                                                                ? `${row.folderPath.split('/').filter(Boolean).pop() ?? ROOT_FOLDER_LABEL}/`
                                                                : row.label;

                                                            return (
                                                                <div
                                                                    key={rowKey}
                                                                    className="absolute left-0 right-0 px-5"
                                                                    style={{ top: `${offset * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                                                                >
                                                                    <div className={cn(
                                                                        'grid h-full grid-cols-[32px_92px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border',
                                                                        derived.muted && 'opacity-45',
                                                                    )}>
                                                                        <div className="flex justify-center">
                                                                            <div className="relative">
                                                                                <Checkbox
                                                                                    checked={derived.checked}
                                                                                    className={derived.partiallyChecked ? 'border-primary bg-primary/10' : undefined}
                                                                                    disabled={!derived.toggleable}
                                                                                    onCheckedChange={checked => {
                                                                                        const nextChecked = checked === true;
                                                                                        if (row.kind === 'folder') {
                                                                                            updateRangeSelection(
                                                                                                focusedProject.projectId,
                                                                                                row.index + 1,
                                                                                                row.subtreeEndIndex,
                                                                                                nextChecked,
                                                                                            );
                                                                                            return;
                                                                                        }
                                                                                        if (!row.relativePath) return;
                                                                                        updateOperationSelection(focusedProject.projectId, row.relativePath, current => ({
                                                                                            projectId: focusedProject.projectId,
                                                                                            relativePath: row.relativePath!,
                                                                                            enabled: nextChecked,
                                                                                            conflictResolution: current?.conflictResolution,
                                                                                            mergeDraftId: current?.mergeDraftId,
                                                                                            sequence: nextSequence(),
                                                                                        }));
                                                                                    }}
                                                                                />
                                                                                {derived.partiallyChecked ? (
                                                                                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                                                                                        <span className="h-0.5 w-2 rounded-full bg-primary" />
                                                                                    </span>
                                                                                ) : null}
                                                                            </div>
                                                                        </div>

                                                                        <div>
                                                                            <OperationText kind={row.aggregateKind} />
                                                                        </div>

                                                                        <div className="flex min-w-0 items-center">
                                                                            <TreePrefix depth={row.depth} />
                                                                            <span className={cn(
                                                                                'block truncate',
                                                                                row.kind === 'folder' ? 'text-subheading text-foreground' : 'text-note text-foreground',
                                                                            )}>
                                                                                {displayLabel}
                                                                            </span>
                                                                        </div>

                                                                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                                                                            {row.kind === 'file' && row.aggregateKind === 'conflict' && row.relativePath ? (
                                                                                <>
                                                                                    <Button
                                                                                        size="xs"
                                                                                        variant={resolution === 'keep-local' ? 'secondary' : 'outline'}
                                                                                        onClick={() => updateOperationSelection(focusedProject.projectId, row.relativePath!, current => ({
                                                                                            projectId: focusedProject.projectId,
                                                                                            relativePath: row.relativePath!,
                                                                                            enabled: current?.enabled ?? derived.checked,
                                                                                            conflictResolution: 'keep-local',
                                                                                            mergeDraftId: undefined,
                                                                                            sequence: current?.sequence,
                                                                                        }))}
                                                                                    >
                                                                                        保留本地
                                                                                    </Button>
                                                                                    <Button
                                                                                        size="xs"
                                                                                        variant={resolution === 'keep-target' ? 'secondary' : 'outline'}
                                                                                        onClick={() => updateOperationSelection(focusedProject.projectId, row.relativePath!, current => ({
                                                                                            projectId: focusedProject.projectId,
                                                                                            relativePath: row.relativePath!,
                                                                                            enabled: current?.enabled ?? derived.checked,
                                                                                            conflictResolution: 'keep-target',
                                                                                            mergeDraftId: undefined,
                                                                                            sequence: current?.sequence,
                                                                                        }))}
                                                                                    >
                                                                                        保留远程
                                                                                    </Button>
                                                                                    {canManualMerge ? (
                                                                                        <Button
                                                                                            size="xs"
                                                                                            variant={resolution === 'manual' ? 'secondary' : 'outline'}
                                                                                            disabled={actionBusyKey === rowKey}
                                                                                            onClick={async () => {
                                                                                                if (!onOpenConflictMerge || !row.relativePath) return;
                                                                                                setActionBusyKey(rowKey);
                                                                                                try {
                                                                                                    const draft = await onOpenConflictMerge(focusedProject.projectId, row.relativePath);
                                                                                                    updateOperationSelection(focusedProject.projectId, row.relativePath, current => ({
                                                                                                        projectId: focusedProject.projectId,
                                                                                                        relativePath: row.relativePath!,
                                                                                                        enabled: current?.enabled ?? derived.checked,
                                                                                                        conflictResolution: 'manual',
                                                                                                        mergeDraftId: draft.id,
                                                                                                        sequence: current?.sequence,
                                                                                                    }));
                                                                                                } finally {
                                                                                                    setActionBusyKey(null);
                                                                                                }
                                                                                            }}
                                                                                        >
                                                                                            {selection?.mergeDraftId ? '继续合并' : '手动合并'}
                                                                                        </Button>
                                                                                    ) : null}
                                                                                </>
                                                                            ) : null}
                                                                            {canOpenDiff && row.relativePath ? (
                                                                                <Button
                                                                                    size="xs"
                                                                                    variant="ghost"
                                                                                    disabled={actionBusyKey === rowKey}
                                                                                    onClick={async () => {
                                                                                        if (!onOpenDiff || !row.relativePath) return;
                                                                                        setActionBusyKey(rowKey);
                                                                                        try {
                                                                                            await onOpenDiff(focusedProject.projectId, row.relativePath);
                                                                                        } finally {
                                                                                            setActionBusyKey(null);
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <GitCompareArrows className="size-3.5" /> 对比
                                                                                </Button>
                                                                            ) : null}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        {loadingStructureRows ? (
                                                            <div className="pointer-events-none absolute right-4 top-3 rounded-full bg-background/90 px-2 py-1 text-caption text-muted-foreground shadow-sm">
                                                                加载中…
                                                            </div>
                                                        ) : null}
                                                        {!isStructureReady && renderRows.length === 0 ? (
                                                            Array.from({ length: visibleRowCount }).map((_, index) => (
                                                                <RowPlaceholder key={`placeholder:${index}`} top={index * ROW_HEIGHT} />
                                                            ))
                                                        ) : null}

                                                        {maxScrollIndex > 0 ? (
                                                            <div
                                                                className="absolute rounded-full bg-muted/70"
                                                                style={{
                                                                    top: `${SCROLLBAR_TRACK_INSET}px`,
                                                                    bottom: `${SCROLLBAR_TRACK_INSET}px`,
                                                                    right: '0px',
                                                                    width: '12px',
                                                                }}
                                                                onPointerDown={event => {
                                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                                    const nextRatio = clamp(
                                                                        (event.clientY - rect.top - scrollbarThumbHeight / 2) / Math.max(rect.height - scrollbarThumbHeight, 1),
                                                                        0,
                                                                        1,
                                                                    );
                                                                    scrollToDisplayIndex(Math.round(nextRatio * maxScrollIndex));
                                                                }}
                                                            >
                                                                <div
                                                                    className="absolute left-0 right-0 cursor-grab rounded-full bg-foreground/30 active:cursor-grabbing active:bg-foreground/45"
                                                                    style={{
                                                                        top: `${scrollbarThumbTop}px`,
                                                                        height: `${scrollbarThumbHeight}px`,
                                                                    }}
                                                                    onPointerDown={event => {
                                                                        event.stopPropagation();
                                                                        scrollbarDragRef.current = {
                                                                            startY: event.clientY,
                                                                            startIndex: firstVisibleDisplayIndex,
                                                                        };
                                                                    }}
                                                                />
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </main>
                    </div>

                    <footer className="flex items-center justify-between gap-4 border-t border-border px-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <OperationStat kind="create" label="新增" value={selectedSummary.create} />
                            <OperationStat kind="update" label="更新" value={selectedSummary.update} />
                            <OperationStat kind="delete" label="删除" value={selectedSummary.delete} />
                            <OperationStat kind="conflict" label="冲突" value={selectedSummary.conflict} />
                        </div>

                        <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={onClose}>
                                取消
                            </Button>
                            <Button size="sm" disabled={busy || !canApply} onClick={() => onApply(applyRequest)}>
                                {applyLabel}
                            </Button>
                        </div>
                    </footer>
                </div>
            </div>
        </>
    );
}
