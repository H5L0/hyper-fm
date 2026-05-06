// ---------------------------------------------------------------------------
// 标签组对话框：新建/编辑共用，名称 + 标签集合
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { TagGroupDefinition } from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { TagSelector } from '@/components/basic/tag-selector.js';
import { useAppActions, useAppState } from '../../store/app-store.js';

function isSameTagList(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
}

export function TagGroupDialog({
    initial,
    onClose,
}: {
    initial?: TagGroupDefinition;
    onClose: () => void;
}) {
    const { config } = useAppState();
    const actions = useAppActions();
    const editing = !!initial;
    const [name, setName] = useState(initial?.name ?? '');
    const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
    const [busy, setBusy] = useState(false);

    const normalizedName = name.trim();
    const normalizedTags = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
    const dirty = editing
        ? normalizedName !== initial!.name || !isSameTagList(normalizedTags, initial!.tags)
        : normalizedName.length > 0 || normalizedTags.length > 0;

    const submit = async () => {
        if (!normalizedName || busy) return;
        if (normalizedTags.length === 0) {
            actions.toast('error', '请至少选择一个标签');
            return;
        }
        if ((config.tagGroups ?? []).some(group => group.name === normalizedName && group.name !== initial?.name)) {
            actions.toast('error', `标签组已存在：${normalizedName}`);
            return;
        }

        setBusy(true);
        try {
            await actions.upsertTagGroup(
                {
                    name: normalizedName,
                    tags: normalizedTags,
                },
                initial?.name,
            );
            actions.toast('success', editing ? `已更新标签组 ${normalizedName}` : `已添加标签组 ${normalizedName}`);
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <EditDialogShell
            title={editing ? '修改标签组' : '新建标签组'}
            note="标签组会筛选同时拥有这些标签的项目。"
            onClose={onClose}
            panelClassName="w-[min(560px,calc(100vw-2rem))]"
            bodyClassName="space-y-4"
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={!dirty || busy} onClick={() => void submit()}>
                        {editing ? '保存' : '添加'}
                    </Button>
                </>
            )}
        >
            <EditDialogField label="名称">
                <input
                    autoFocus
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') void submit();
                    }}
                    placeholder="如：游戏开发"
                    className="h-9 w-full rounded-md border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <EditDialogField label="标签组">
                <TagSelector
                    mode="alwaysEdit"
                    selectedTags={normalizedTags}
                    tagDefs={config.tags}
                    onAdd={tag => setTags(prev => (prev.includes(tag) ? prev : [...prev, tag]))}
                    onRemove={tag => setTags(prev => prev.filter(item => item !== tag))}
                    emptySelectedLabel="至少选择一个标签"
                    availableLabel="可加入标签组的标签"
                />
            </EditDialogField>
        </EditDialogShell>
    );
}