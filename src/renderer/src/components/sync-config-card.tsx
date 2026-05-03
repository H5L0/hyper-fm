import { PenLine, Trash2 } from 'lucide-react';
import type { SyncConfig } from '@shared/bridge.js';
import { getSyncConfigTypeLabel, getSyncModeLabel } from '@shared/sync-types.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SyncConfigSummaryCard({
    syncConfig,
    includedProjectCount,
    leading,
    detailText,
    busy = false,
    onEdit,
    onDelete,
    footer,
    className,
}: {
    syncConfig: SyncConfig;
    includedProjectCount: number;
    leading?: React.ReactNode;
    detailText?: string;
    busy?: boolean;
    onEdit?: () => void;
    onDelete?: () => void;
    footer?: React.ReactNode;
    className?: string;
}) {
    const resolvedDetailTexts = detailText ? [detailText] : getSyncConfigLines(syncConfig);

    return (
        <div className={cn('rounded-lg border border-border bg-card px-4 py-4', className)}>
            <div className="flex items-start gap-3">
                {leading ? <div>{leading}</div> : null}

                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-start gap-3">
                        <h3 className="min-w-0 truncate text-body text-foreground font-medium">{syncConfig.name}</h3>
                        <div className="max-w-[260px] text-left text-note text-muted-foreground">
                            {getSyncConfigTypeLabel(syncConfig.type)} · {getSyncScopeLabel(syncConfig.scope)} · 包含 {includedProjectCount} 个项目
                        </div>

                        <div className="flex flex-1 items-center justify-end">
                            {onEdit || onDelete ? (
                                <div className="flex gap-2">
                                    {onEdit ? (
                                        <Button size="icon-xs" variant="ghost" title="修改同步配置" onClick={onEdit}>
                                            <PenLine className="size-4" />
                                        </Button>
                                    ) : null}
                                    {onDelete ? (
                                        <Button size="icon-xs" variant="ghost" title="删除同步配置" disabled={busy} onClick={onDelete}>
                                            <Trash2 className="size-4" />
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {resolvedDetailTexts.map((line, index) => (
                        <p key={index} className="mt-1 text-note text-muted-foreground">
                            {line}
                        </p>
                    ))}
                </div>
            </div>

            {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
    );
}

export function getSyncScopeLabel(scope: SyncConfig['scope']): string {
    return scope === 'shared' ? '共享' : '本地';
}

export function getSyncConfigLines(syncConfig: SyncConfig): string[] {
    const lines: string[] = [];
    switch (syncConfig.type) {
        case 'folder':
            lines.push(`${getSyncModeLabel(syncConfig.mode)}：${syncConfig.folder.targetDir || '未设置目标目录'}`);
            if (syncConfig.folder.intervalMinutes) {
                lines.push(`自动同步：每 ${syncConfig.folder.intervalMinutes} 分钟`);
            }
            break;
        case 'shared-dir':
            lines.push(`${getSyncModeLabel(syncConfig.mode)}：${syncConfig.sharedDir.bundleDir || '未设置共享目录'}`);
            break;
        case 'zip':
            lines.push(`${getSyncModeLabel(syncConfig.mode)}：${syncConfig.zip.exportFile || '每次手动选择导出文件'}`);
            break;
        case 'p2p':
            lines.push(`${getSyncModeLabel(syncConfig.mode)}：端口 ${syncConfig.network.listenPort}`);
            lines.push(syncConfig.network.relayMode ? '中转模式' : '直连模式');
            break;
    }
    return lines;
}

export function getProjectSyncStateDescription(
    state: 'selected' | 'ignored' | 'default-selected' | 'default-excluded',
): string {
    if (state === 'default-selected') {
        return '默认纳入同步范围';
    }
    if (state === 'default-excluded') {
        return '默认排除同步范围';
    }
    if (state === 'ignored') {
        return '忽略同步';
    }
    return '纳入同步';
}