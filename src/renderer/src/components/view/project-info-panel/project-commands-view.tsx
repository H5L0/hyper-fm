import type { ScopedActionDraft } from '@/components/basic/command-list-editor.js';
import { ActionDraftEditor } from '@/components/basic/command-list-editor.js';

export function ProjectActionsView({
    actions,
    projectBound,
    onActionsChange,
}: {
    actions: ScopedActionDraft[];
    projectBound: boolean;
    onActionsChange: (actions: ScopedActionDraft[]) => void;
}) {
    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto px-5 py-5">
            <div className="space-y-1">
                <label className="block text-subheading text-muted-foreground">项目动作</label>
                <p className="text-note text-muted-foreground">修改会先保存在当前面板草稿中，点击底部保存后才会真正生效。</p>
            </div>

            {!projectBound ? (
                <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-3 text-note text-muted-foreground">
                    当前设备尚未绑定该项目，因此只能编辑共享动作，暂时不能新增"本地"动作。
                </div>
            ) : null}

            <ActionDraftEditor
                list={actions}
                onChange={onActionsChange}
                emptyState="尚未添加项目动作"
                allowLocalScope={projectBound}
                allowSharedScope
            />
        </div>
    );
}
