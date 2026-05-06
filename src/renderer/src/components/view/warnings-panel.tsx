import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, GitCompareArrows, RefreshCw } from 'lucide-react';
import type { FingerprintConflictWarning, ScanWarning } from '@shared/types.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../../store/app-store.js';

function fingerprintLabel(warning: FingerprintConflictWarning): string {
    switch (warning.fingerprint.kind) {
        case 'metadata':
            return 'Metadata';
        case 'folder-name':
            return '文件夹名称';
        case 'file-paths':
            return `文件路径 × ${warning.fingerprint.paths.length}`;
    }
}

function warningKindMeta(kind: ScanWarning['kind']): { title: string; description: string } {
    switch (kind) {
        case 'fingerprint-conflict':
            return {
                title: '项目冲突',
                description: '扫描时发现多个目录对应同一项目，已跳过加载，请保留正确目录或修改项目配置后重新扫描。',
            };
        case 'sync-conflict':
            return {
                title: '同步冲突',
                description: '同步时发现两侧都改动过同一文件，这些文件已被保留待人工处理。',
            };
        case 'sync-error':
            return {
                title: '同步错误',
                description: '后台同步任务或手动执行中出现错误，请检查配置、路径和权限。',
            };
    }
}

export function WarningsPanel() {
    const { config } = useAppState();
    const actions = useAppActions();
    const [repairing, setRepairing] = useState<FingerprintConflictWarning | null>(null);

    const summary = useMemo(() => {
        const projectIds = new Set(
            config.warnings
                .map(warning => warning.projectId)
                .filter((projectId): projectId is string => typeof projectId === 'string' && projectId.length > 0),
        );
        return {
            warnings: config.warnings.length,
            projects: projectIds.size,
        };
    }, [config.warnings]);

    const warningGroups = useMemo(() => {
        const grouped = new Map<ScanWarning['kind'], ScanWarning[]>();
        for (const warning of config.warnings) {
            const list = grouped.get(warning.kind);
            if (list) {
                list.push(warning);
            } else {
                grouped.set(warning.kind, [warning]);
            }
        }
        return [...grouped.entries()];
    }, [config.warnings]);

    return (
        <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-display">警告</h1>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <SummaryPill label="当前警告" value={summary.warnings} />
                            <SummaryPill label="涉及项目" value={summary.projects} />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {config.warnings.length > 0 ? (
                            <Button size="sm" variant="outline" onClick={() => void actions.runScanAll()}>
                                <RefreshCw className="size-4" /> 重扫
                            </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => actions.setRoute('browse')}>
                            返回项目列表
                        </Button>
                    </div>
                </div>

                {config.warnings.length === 0 ? (
                    <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
                        <CheckCircle2 className="mx-auto size-8 text-emerald-600 dark:text-emerald-400" />
                        <p className="mt-3 text-heading text-foreground">当前没有警告</p>
                        <p className="mt-1 text-note text-muted-foreground">
                            扫描结果已经很干净，可以返回主页继续整理项目。
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {warningGroups.map(([kind, warnings]) => (
                            <WarningSection
                                key={kind}
                                kind={kind}
                                warnings={warnings}
                                onRepair={warning => {
                                    if (warning.kind === 'fingerprint-conflict') {
                                        setRepairing(warning);
                                    }
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {repairing ? (
                <RepairWarningDialog warning={repairing} onClose={() => setRepairing(null)} />
            ) : null}
        </div>
    );
}

function SummaryPill({
    label,
    value,
}: {
    label: string;
    value: number;
}) {
    return (
        <div
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-muted-foreground"
        >
            <span className="text-note text-muted-foreground">{label}</span>
            <span className="text-subheading tabular-nums text-foreground/90">{value}</span>
        </div>
    );
}

function WarningSection({
    kind,
    warnings,
    onRepair,
}: {
    kind: ScanWarning['kind'];
    warnings: ScanWarning[];
    onRepair: (warning: ScanWarning) => void;
}) {
    const meta = warningKindMeta(kind);

    return (
        <section className="space-y-3">
            <div className="px-1">
                <div className="flex items-center gap-2">
                    <h2 className="text-heading text-foreground">{meta.title}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                        {warnings.length}
                    </span>
                </div>
                <p className="mt-1 text-note text-muted-foreground">{meta.description}</p>
            </div>

            <div className="space-y-2">
                {warnings.map(warning => (
                    <WarningCard key={warning.id} warning={warning} onRepair={() => onRepair(warning)} />
                ))}
            </div>
        </section>
    );
}

function WarningCard({ warning, onRepair }: { warning: ScanWarning; onRepair: () => void }) {
    const actions = useAppActions();

    if (warning.kind === 'sync-conflict') {
        return (
            <section className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h3 className="truncate text-body font-medium text-foreground">{warning.projectName}</h3>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                            {warning.configName}
                        </span>
                    </div>
                </div>

                <p className="mt-2 text-note text-muted-foreground">{warning.message}</p>

                <div className="mt-2 space-y-1.5">
                    {warning.filePaths.map(filePath => (
                        <div key={filePath} className="rounded-md bg-muted/35 px-3 py-2 text-note text-muted-foreground">
                            {filePath}
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    if (warning.kind === 'sync-error') {
        return (
            <section className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h3 className="truncate text-body font-medium text-foreground">{warning.projectName || warning.configName}</h3>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                            {warning.configName}
                        </span>
                    </div>
                </div>

                <p className="mt-2 text-note text-muted-foreground">{warning.message}</p>
            </section>
        );
    }

    return (
        <section className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <h3 className="truncate text-body font-medium text-foreground">{warning.projectName}</h3>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                        {fingerprintLabel(warning)}
                    </span>
                </div>
                <Button size="sm" variant="outline" onClick={onRepair}>
                    修复
                </Button>
            </div>

            <div className="mt-1.5 space-y-0.5 pl-0.5">
                {warning.candidatePaths.map(candidatePath => (
                    <div
                        key={candidatePath}
                        className="group/path flex min-h-9 items-center gap-2 rounded-md px-0.5 py-1.5 hover:bg-muted/50"
                    >
                        <GitCompareArrows className="size-3.5 shrink-0 text-amber-600/80 dark:text-amber-300/80" />
                        <p className="min-w-0 flex-1 truncate text-note text-muted-foreground">{candidatePath}</p>
                        <Button
                            size="xs"
                            variant="ghost"
                            className="opacity-0 transition-opacity group-hover/path:opacity-100 group-focus-within/path:opacity-100"
                            onClick={() => void window.fm.scan.revealPath(candidatePath).catch(error => {
                                actions.toast('error', error instanceof Error ? error.message : '打开目录失败');
                            })}
                        >
                            <FolderOpen className="size-3.5" /> 打开
                        </Button>
                    </div>
                ))}
            </div>
        </section>
    );
}

function RepairWarningDialog({ warning, onClose }: { warning: FingerprintConflictWarning; onClose: () => void }) {
    const actions = useAppActions();
    const [keepPath, setKeepPath] = useState(warning.candidatePaths[0] ?? '');
    const [busy, setBusy] = useState(false);

    const confirm = async () => {
        if (!keepPath || busy) return;
        setBusy(true);
        try {
            const ignored = warning.candidatePaths.filter((candidatePath: string) => candidatePath !== keepPath);
            await Promise.all(ignored.map((candidatePath: string) => window.fm.scan.ignorePath(candidatePath)));
            await actions.runScanOne(warning.scanRootId);
            actions.toast('success', `已保留选中目录，并忽略其他 ${ignored.length} 个目录`);
            onClose();
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '修复失败');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <button
                type="button"
                aria-label="关闭修复弹框"
                onClick={onClose}
                className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[1px]"
            />
            <div
                role="dialog"
                aria-modal="true"
                className="fixed top-1/2 left-1/2 z-50 w-[640px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            >
                <div className="border-b border-border px-4 py-3">
                    <h2 className="text-heading">选择保留目录</h2>
                    <p className="mt-1 text-note text-muted-foreground">
                        请选择 {warning.projectName} 应绑定的目录。确认后会忽略其他候选目录，并立即重扫。
                    </p>
                </div>

                <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 py-4">
                    {warning.candidatePaths.map((candidatePath: string) => (
                        <label
                            key={candidatePath}
                            className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors',
                                keepPath === candidatePath
                                    ? 'border-primary/40 bg-primary/5'
                                    : 'border-border bg-background hover:bg-muted/40',
                            )}
                        >
                            <input
                                type="radio"
                                name="warning-keep-path"
                                checked={keepPath === candidatePath}
                                onChange={() => setKeepPath(candidatePath)}
                                className="mt-1"
                            />
                            <div className="min-w-0 flex-1">
                                <p className="text-subheading text-foreground">使用该目录</p>
                                <p className="mt-1 break-all text-note text-muted-foreground">{candidatePath}</p>
                            </div>
                        </label>
                    ))}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border bg-card/90 px-4 py-3">
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={!keepPath || busy} onClick={() => void confirm()}>
                        忽略其他目录并重扫
                    </Button>
                </div>
            </div>
        </>
    );
}
