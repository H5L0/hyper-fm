import { useState } from 'react';
import { type TagReferenceSummary } from '@shared/tag-utils.js';
import { Button } from '@/components/ui/button';
import { EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { TagPill } from '@/components/basic/tag-pill.js';
import { useAppActions } from '../../store/app-store.js';

export function DeleteTagDialog({
    name,
    color,
    references,
    onClose,
}: {
    name: string;
    color: string;
    references: TagReferenceSummary;
    onClose: () => void;
}) {
    const actions = useAppActions();
    const [busy, setBusy] = useState(false);
    const referenceCount = references.projects.length + references.tagGroups.length;

    const confirmDelete = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await actions.removeTag(name);
            actions.toast('success', `已删除标签 ${name}`);
            onClose();
        } catch {
            // 错误提示已由 store 统一处理
        } finally {
            setBusy(false);
        }
    };

    return (
        <EditDialogShell
            title="删除标签"
            note={referenceCount > 0
                ? '删除时也会移除项目和标签组中的引用，并删除因此为空的标签组。'
                : undefined}
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
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3">
                <span className="text-note text-muted-foreground">即将删除：</span>
                <TagPill name={name} color={color} />
            </div>

            {referenceCount > 0 ? (
                <div className="space-y-4">
                    {references.projects.length > 0 ? (
                        <div className="space-y-2">
                            <p className="text-subheading text-foreground">项目（{references.projects.length}）</p>
                            <ul className="space-y-1 rounded-xl border border-border bg-background px-3 py-3 text-note text-foreground">
                                {references.projects.map(project => (
                                    <li key={project.id} className="break-all">{project.name}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    {references.tagGroups.length > 0 ? (
                        <div className="space-y-2">
                            <p className="text-subheading text-foreground">标签组（{references.tagGroups.length}）</p>
                            <ul className="space-y-1 rounded-xl border border-border bg-background px-3 py-3 text-note text-foreground">
                                {references.tagGroups.map(group => (
                                    <li key={group.name} className="break-all">{group.name}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            ) : (
                <p className="text-note leading-6 text-muted-foreground">当前没有项目或标签组引用这个标签。</p>
            )}
        </EditDialogShell>
    );
}