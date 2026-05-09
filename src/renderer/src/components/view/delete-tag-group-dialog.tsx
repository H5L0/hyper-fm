import { useMemo, useState } from 'react';
import { findDynamicTagByLabel } from '@shared/dynamic-tags.js';
import { Button } from '@/components/ui/button';
import { EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { TagPill, resolveTagColor } from '@/components/basic/tag-pill.js';
import { useAppActions, useAppState } from '../../store/app-store.js';

export function DeleteTagGroupDialog({
    name,
    tags,
    onClose,
}: {
    name: string;
    tags: string[];
    onClose: () => void;
}) {
    const { config } = useAppState();
    const actions = useAppActions();
    const [busy, setBusy] = useState(false);

    const tagPills = useMemo(() => tags.map(tag => ({
        name: tag,
        color: findDynamicTagByLabel(tag)?.color ?? resolveTagColor(tag, config.tags),
    })), [config.tags, tags]);

    const confirmDelete = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await actions.removeTagGroup(name);
            actions.toast('success', `已删除标签组 ${name}`);
            onClose();
        } catch {
            // 错误提示已由 store 统一处理
        } finally {
            setBusy(false);
        }
    };

    return (
        <EditDialogShell
            title="删除标签组"
            note="删除后不会影响项目本身的标签，只会移除这个筛选组合。"
            onClose={onClose}
            panelClassName="w-[min(560px,calc(100vw-2rem))]"
            bodyClassName="space-y-5"
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>
                        确认删除
                    </Button>
                </>
            )}
        >
            <div className="space-y-3 rounded-xl border border-border bg-background px-3 py-3">
                <p className="text-subheading text-foreground">{name}</p>
                {tagPills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {tagPills.map(tag => (
                            <TagPill key={tag.name} name={tag.name} color={tag.color} />
                        ))}
                    </div>
                ) : (
                    <p className="text-note text-muted-foreground">当前标签组没有筛选条件</p>
                )}
            </div>
        </EditDialogShell>
    );
}