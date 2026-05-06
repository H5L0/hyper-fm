import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { TagDefinition } from '@shared/bridge.js';
import { cn } from '@/lib/utils';
import { NewTagDialog } from '@/components/view/new-tag-dialog.js';
import { TagPill, resolveTagColor } from './tag-pill.js';

function startTransition(update: () => void): void {
    const doc = document as Document & {
        startViewTransition?: (cb: () => void) => unknown;
    };
    if (typeof doc.startViewTransition === 'function') {
        doc.startViewTransition(() => update());
    } else {
        update();
    }
}

function tagViewName(name: string): string {
    const safe = [...name]
        .map(ch => (/[a-zA-Z0-9_]/.test(ch) ? ch : `_${ch.charCodeAt(0).toString(16)}`))
        .join('');
    return `fm-tag-${safe}`;
}

export function TagSelector({
    mode,
    selectedTags,
    tagDefs,
    onAdd,
    onRemove,
    emptySelectedLabel = '尚未选择标签',
    availableLabel = '可选标签',
    selectedContainerClassName,
    availablePanelClassName,
}: {
    mode: 'alwaysEdit' | 'editable' | 'readonly';
    selectedTags: string[];
    tagDefs: readonly TagDefinition[] | undefined;
    onAdd: (value: string) => void;
    onRemove: (value: string) => void;
    emptySelectedLabel?: string;
    availableLabel?: string;
    selectedContainerClassName?: string;
    availablePanelClassName?: string;
}) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(mode === 'alwaysEdit');

    const selectedSet = useMemo(() => new Set(selectedTags), [selectedTags]);
    const available = useMemo(
        () => (tagDefs ?? []).filter(tag => !selectedSet.has(tag.name)),
        [tagDefs, selectedSet],
    );

    const select = (name: string) => {
        startTransition(() => onAdd(name));
    };

    const remove = (name: string) => {
        startTransition(() => onRemove(name));
    };

    return (
        <div className="space-y-3">
            <div className={selectedContainerClassName ?? 'flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-popover p-2'}>
                {selectedTags.length === 0 ? (
                    <span className="h-7 px-1.5 py-1.5 text-note text-muted-foreground/70">{emptySelectedLabel}</span>
                ) : (
                    selectedTags.map(tag => (
                        <span
                            key={`sel-${tag}`}
                            style={{ viewTransitionName: tagViewName(tag) }}
                            className="inline-block"
                        >
                            <TagPill
                                name={tag}
                                color={resolveTagColor(tag, tagDefs)}
                                size="md"
                                onRemove={editing ? () => remove(tag) : undefined}
                            />
                        </span>
                    ))
                )}
                {mode === 'editable' ? (
                    <button
                        type="button"
                        aria-label={editing ? '收起标签编辑' : '展开标签编辑'}
                        title={editing ? '收起标签编辑' : '编辑标签'}
                        onClick={() => setEditing(prev => !prev)}
                        className={cn(
                            'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary transition-colors hover:bg-ring/25',
                            editing ? 'bg-ring/50' : undefined,
                        )}
                    >
                        <Pencil className="size-3.5" />
                    </button>
                ) : null}
            </div>

            {editing ? (
                <div className={availablePanelClassName ?? 'rounded-md border border-border border-dashed bg-popover p-2'}>
                    {availableLabel ? (
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-subheading text-muted-foreground/80">{availableLabel}</span>
                        </div>
                    ) : null}
                    {available.length === 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-note text-muted-foreground/70">全部标签已选择。</p>
                            <button
                                type="button"
                                aria-label="新建标签"
                                onClick={() => setDialogOpen(true)}
                                className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                            >
                                <Plus className="size-3.5" />
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {available.map(tag => (
                                <button
                                    key={`opt-${tag.name}`}
                                    type="button"
                                    onClick={() => select(tag.name)}
                                    style={{ viewTransitionName: tagViewName(tag.name) }}
                                    className="cursor-pointer rounded-full opacity-70 transition-opacity hover:opacity-100"
                                >
                                    <TagPill name={tag.name} color={tag.color} size="md" />
                                </button>
                            ))}
                            <button
                                type="button"
                                aria-label="新建标签"
                                onClick={() => setDialogOpen(true)}
                                className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                            >
                                <Plus className="size-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            ) : null}

            {dialogOpen ? (
                <NewTagDialog
                    onClose={() => setDialogOpen(false)}
                    onCreated={name => {
                        startTransition(() => onAdd(name));
                    }}
                />
            ) : null}
        </div>
    );
}
