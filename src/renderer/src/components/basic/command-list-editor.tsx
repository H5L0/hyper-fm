import { useCallback, useEffect, useState } from 'react';
import { PenLine, Plus, Trash2 } from 'lucide-react';
import type { CustomAction } from '@shared/bridge.js';
import { generateId, ID_PREFIX } from '@shared/id.js';
import { useAppActions } from '@/store/app-store.js';
import { AddableList, AddableListItem } from '@/components/ui/addable-list';
import { Button } from '@/components/ui/button';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { SegmentedToggleGroup } from '@/components/ui/segmented-toggle-group';

export interface ActionListEditorController {
    load(): Promise<CustomAction[]>;
    add(input: Omit<CustomAction, 'id'>): Promise<CustomAction>;
    update(id: string, patch: Partial<Omit<CustomAction, 'id'>>): Promise<CustomAction>;
    replace(actions: CustomAction[]): Promise<CustomAction[]>;
    remove(id: string): Promise<void>;
}

export type ActionStorageScope = 'local' | 'shared';

export interface ScopedActionDraft extends CustomAction {
    scope?: ActionStorageScope;
}

function moveItemToIndex<T extends { id: string }>(items: readonly T[], activeId: string, targetIndex: number): T[] | null {
    if (!activeId) {
        return null;
    }

    const fromIndex = items.findIndex(item => item.id === activeId);
    if (fromIndex < 0) {
        return null;
    }

    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    const insertIndex = Math.max(0, Math.min(targetIndex, next.length));
    if (fromIndex === insertIndex) {
        return null;
    }
    next.splice(insertIndex, 0, moved!);
    return next;
}

export function ActionListEditor({
    controller,
    emptyState = '尚未添加自定义动作',
    addLabel = '添加动作',
    onListChange,
    showScopeSelector = false,
    allowLocalScope = true,
    allowSharedScope = true,
}: {
    controller: ActionListEditorController;
    emptyState?: string;
    addLabel?: string;
    onListChange?: (actions: CustomAction[]) => void;
    showScopeSelector?: boolean;
    allowLocalScope?: boolean;
    allowSharedScope?: boolean;
}) {
    const appActions = useAppActions();
    const [list, setList] = useState<CustomAction[]>([]);
    const [editingAction, setEditingAction] = useState<CustomAction | null>(null);
    const [creatingAction, setCreatingAction] = useState(false);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        const nextList = await controller.load();
        setList(nextList);
        onListChange?.(nextList);
        return nextList;
    }, [controller, onListChange]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const saveAction = async ({
        id,
        label,
        command,
        cwd,
        description,
        scope,
    }: {
        id?: string;
        label: string;
        command: string;
        cwd: CustomAction['cwd'];
        description: string;
        scope?: ActionStorageScope;
    }) => {
        if (busy) return;
        const nextLabel = label.trim();
        const nextCommandLine = command.trim();
        if (!nextLabel || !nextCommandLine) return;

        setBusy(true);
        try {
            const payload = {
                label: nextLabel,
                command: nextCommandLine,
                args: undefined,
                cwd: cwd ?? 'project',
                description: description.trim() || undefined,
                scope,
            } satisfies Omit<CustomAction, 'id'>;

            if (id) {
                await controller.update(id, payload);
            } else {
                await controller.add(payload);
            }

            await refresh();
            setEditingAction(null);
            setCreatingAction(false);
            appActions.toast('success', id ? '已更新动作' : '已添加动作');
        } catch (error) {
            appActions.toast('error', error instanceof Error ? error.message : id ? '更新失败' : '添加失败');
        } finally {
            setBusy(false);
        }
    };

    const removeAction = async (id: string) => {
        if (busy) return;
        setBusy(true);
        try {
            await controller.remove(id);
            await refresh();
            appActions.toast('success', '已删除动作');
        } catch (error) {
            appActions.toast('error', error instanceof Error ? error.message : '删除失败');
        } finally {
            setBusy(false);
        }
    };

    const reorderActions = async (activeId: string, targetIndex: number) => {
        if (busy) return;
        const nextActions = moveItemToIndex(list, activeId, targetIndex);
        if (!nextActions) return;

        setBusy(true);
        try {
            await controller.replace(nextActions);
            await refresh();
            appActions.toast('success', '已调整动作顺序');
        } catch (error) {
            appActions.toast('error', error instanceof Error ? error.message : '调整顺序失败');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ActionListView
                list={list}
                addLabel={addLabel}
                emptyState={emptyState}
                onAdd={() => setCreatingAction(true)}
                onEdit={a => setEditingAction(a)}
                onRemove={a => void removeAction(a.id)}
                onReorder={(activeId, targetIndex) => void reorderActions(activeId, targetIndex)}
            />

            {creatingAction ? (
                <ActionDialog
                    showScopeSelector={showScopeSelector}
                    allowLocalScope={allowLocalScope}
                    allowSharedScope={allowSharedScope}
                    defaultScope={resolveScope(undefined, allowLocalScope, allowSharedScope) ?? 'local'}
                    onClose={() => setCreatingAction(false)}
                    onSave={draft => void saveAction(draft)}
                    busy={busy}
                />
            ) : null}

            {editingAction ? (
                <ActionDialog
                    initial={editingAction}
                    showScopeSelector={showScopeSelector}
                    allowLocalScope={allowLocalScope}
                    allowSharedScope={allowSharedScope}
                    defaultScope={resolveScope(editingAction.scope, allowLocalScope, allowSharedScope) ?? 'local'}
                    onClose={() => setEditingAction(null)}
                    onSave={draft => void saveAction(draft)}
                    busy={busy}
                />
            ) : null}
        </>
    );
}

export function ActionDraftEditor({
    list,
    onChange,
    emptyState = '尚未添加项目动作',
    addLabel = '添加动作',
    allowLocalScope = true,
    allowSharedScope = true,
}: {
    list: ScopedActionDraft[];
    onChange: (actions: ScopedActionDraft[]) => void;
    emptyState?: string;
    addLabel?: string;
    allowLocalScope?: boolean;
    allowSharedScope?: boolean;
}) {
    const [editingAction, setEditingAction] = useState<ScopedActionDraft | null>(null);
    const [creatingAction, setCreatingAction] = useState(false);

    const saveDraft = ({
        id,
        label,
        command,
        cwd,
        description,
        scope,
    }: {
        id?: string;
        label: string;
        command: string;
        cwd: CustomAction['cwd'];
        description: string;
        scope?: ActionStorageScope;
    }) => {
        const nextLabel = label.trim();
        const nextCommandLine = command.trim();
        if (!nextLabel || !nextCommandLine) return;

        const nextScope = resolveScope(scope, allowLocalScope, allowSharedScope);
        const nextAction: ScopedActionDraft = {
            id: id ?? generateId(ID_PREFIX.action),
            label: nextLabel,
            command: nextCommandLine,
            args: undefined,
            cwd: cwd ?? 'project',
            description: description.trim() || undefined,
            ...(nextScope ? { scope: nextScope } : {}),
        };

        onChange(
            id
                ? list.map(item => (item.id === id ? nextAction : item))
                : [...list, nextAction],
        );
        setEditingAction(null);
        setCreatingAction(false);
    };

    const reorderActions = (activeId: string, targetIndex: number) => {
        const nextActions = moveItemToIndex(list, activeId, targetIndex);
        if (!nextActions) return;
        onChange(nextActions);
    };

    return (
        <>
            <ActionListView
                list={list}
                addLabel={addLabel}
                emptyState={emptyState}
                onAdd={() => setCreatingAction(true)}
                onEdit={a => setEditingAction(a)}
                onRemove={a => onChange(list.filter(item => item.id !== a.id))}
                onReorder={reorderActions}
            />

            {creatingAction ? (
                <ActionDialog
                    showScopeSelector
                    allowLocalScope={allowLocalScope}
                    allowSharedScope={allowSharedScope}
                    defaultScope={resolveScope(undefined, allowLocalScope, allowSharedScope) ?? 'local'}
                    onClose={() => setCreatingAction(false)}
                    onSave={saveDraft}
                    busy={false}
                />
            ) : null}

            {editingAction ? (
                <ActionDialog
                    initial={editingAction}
                    showScopeSelector
                    allowLocalScope={allowLocalScope}
                    allowSharedScope={allowSharedScope}
                    defaultScope={resolveScope(editingAction.scope, allowLocalScope, allowSharedScope) ?? 'local'}
                    onClose={() => setEditingAction(null)}
                    onSave={saveDraft}
                    busy={false}
                />
            ) : null}
        </>
    );
}

function ActionListView({
    list,
    addLabel,
    emptyState,
    onAdd,
    onEdit,
    onRemove,
    onReorder,
}: {
    list: readonly ScopedActionDraft[];
    addLabel: string;
    emptyState: string;
    onAdd: () => void;
    onEdit: (a: ScopedActionDraft) => void;
    onRemove: (a: ScopedActionDraft) => void;
    onReorder: (activeId: string, targetIndex: number) => void;
}) {
    return (
        <AddableList
            addIcon={<Plus className="size-4" />}
            addLabel={addLabel}
            onAdd={onAdd}
            emptyState={emptyState}
            footerEnd={<ListMetaBadge>{list.length} 条动作</ListMetaBadge>}
            divided={false}
            sortable={{
                itemIds: list.map(a => a.id),
                onReorder,
            }}
        >
            {list.map(a => (
                <AddableListItem
                    key={a.id}
                    itemId={a.id}
                    showGrabHandle
                >
                    <div className="flex items-start gap-2.5">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <p className="truncate text-body text-foreground">{a.label}</p>
                            </div>
                            <p className="mt-1 truncate text-note text-muted-foreground">
                                {formatActionLine(a)}
                            </p>
                            {a.description ? (
                                <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">{a.description}</p>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                            <Button size="icon-xs" variant="ghost" title="编辑动作" onClick={() => onEdit(a)}>
                                <PenLine className="size-4" />
                            </Button>
                            <Button size="icon-xs" variant="ghost" title="删除动作" onClick={() => onRemove(a)}>
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    </div>
                </AddableListItem>
            ))}
        </AddableList>
    );
}

function formatActionLine(a: Pick<CustomAction, 'command' | 'args'>): string {
    return a.args?.length ? `${a.command} ${a.args.join(' ')}` : a.command;
}

function resolveScope(
    scope: ActionStorageScope | undefined,
    allowLocalScope: boolean,
    allowSharedScope: boolean,
): ActionStorageScope | undefined {
    if (scope === 'shared' && allowSharedScope) return 'shared';
    if (scope === 'local' && allowLocalScope) return 'local';
    if (allowLocalScope) return 'local';
    if (allowSharedScope) return 'shared';
    return undefined;
}

function ListMetaBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center text-note text-muted-foreground">
            {children}
        </span>
    );
}

function ActionDialog({
    initial,
    showScopeSelector = false,
    allowLocalScope = true,
    allowSharedScope = true,
    defaultScope = 'local',
    onClose,
    onSave,
    busy,
}: {
    initial?: ScopedActionDraft;
    showScopeSelector?: boolean;
    allowLocalScope?: boolean;
    allowSharedScope?: boolean;
    defaultScope?: ActionStorageScope;
    onClose: () => void;
    onSave: (draft: {
        id?: string;
        label: string;
        command: string;
        cwd: CustomAction['cwd'];
        description: string;
        scope?: ActionStorageScope;
    }) => void;
    busy: boolean;
}) {
    const [label, setLabel] = useState(initial?.label ?? '');
    const [command, setCommand] = useState(formatActionLine(initial ?? { command: '', args: undefined }));
    const [cwd, setCwd] = useState<CustomAction['cwd']>(initial?.cwd ?? 'project');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [scope, setScope] = useState<ActionStorageScope>(
        resolveScope(initial?.scope, allowLocalScope, allowSharedScope) ?? defaultScope,
    );

    const scopeOptions = [
        allowLocalScope ? { value: 'local', label: '本地', description: '仅在当前设备生效' } : null,
        allowSharedScope ? { value: 'shared', label: '共享', description: '跟随项目数据一起共享' } : null,
    ].filter(option => option !== null);

    return (
        <EditDialogShell
            title={initial ? '编辑动作' : '添加动作'}
            note="定义项目可用的指令。"
            onClose={onClose}
            panelClassName="w-[min(620px,calc(100vw-2rem))]"
            bodyClassName="space-y-4"
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button
                        size="sm"
                        disabled={busy || !label.trim() || !command.trim()}
                        onClick={() => onSave({ id: initial?.id, label, command, cwd, description, scope })}
                    >
                        {initial ? '保存' : '添加'}
                    </Button>
                </>
            )}
        >
            <EditDialogField label="名称">
                <input
                    value={label}
                    onChange={event => setLabel(event.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <EditDialogField label="指令" note="例如：code {{path}}、pnpm dev、cmd /c start notepad.exe">
                <input
                    value={command}
                    onChange={event => setCommand(event.target.value)}
                    placeholder="整条指令统一填写在这里"
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <EditDialogField label="工作目录">
                <SegmentedToggleGroup
                    ariaLabel="选择动作工作目录"
                    value={cwd ?? 'project'}
                    onValueChange={nextValue => setCwd(nextValue as CustomAction['cwd'])}
                    options={[
                        { value: 'project', label: '项目目录', description: '以项目目录作为 cwd' },
                        { value: 'parent', label: '上级目录', description: '以项目的上级目录作为 cwd' },
                    ]}
                    optionMinWidth={180}
                    align="start"
                />
            </EditDialogField>

            {showScopeSelector && scopeOptions.length > 1 ? (
                <EditDialogField label="存储位置">
                    <SegmentedToggleGroup
                        ariaLabel="选择动作存储位置"
                        value={scope}
                        onValueChange={nextValue => setScope(nextValue as ActionStorageScope)}
                        options={scopeOptions}
                        optionMinWidth={160}
                        align="start"
                    />
                </EditDialogField>
            ) : null}

            <EditDialogField label="备注">
                <textarea
                    rows={2}
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                    placeholder="可选，用于补充动作用途"
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>
        </EditDialogShell>
    );
}
