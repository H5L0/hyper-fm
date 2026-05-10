import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TagDefinition } from '@shared/bridge.js';
import { cn } from '@/lib/utils';

export const DEFAULT_TAG_COLOR = '#94a3b8';

export function resolveTagColor(name: string, tags: readonly TagDefinition[] | undefined): string {
    return tags?.find(tag => tag.name === name)?.color ?? DEFAULT_TAG_COLOR;
}

export function sortTagsByDefinition(tagNames: readonly string[], tagDefs: readonly TagDefinition[] | undefined): string[] {
    if (!tagDefs || tagDefs.length === 0) return [...tagNames];
    const indexMap = new Map(tagDefs.map((def, i) => [def.name, i]));
    return [...tagNames].sort((a, b) => {
        const ai = indexMap.get(a) ?? Infinity;
        const bi = indexMap.get(b) ?? Infinity;
        return ai - bi;
    });
}

interface TagPillProps {
    name: string;
    color: string;
    size?: 'sm' | 'md';
    onRemove?: () => void;
    children?: ReactNode;
}

export function TagPill({ name, color, size = 'md', onRemove, children }: TagPillProps) {
    const sizeClassName = size === 'sm' ? 'h-6 text-note pl-2 pr-2' : 'h-7 text-note pl-2.5 pr-2.5';

    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary text-secondary-foreground',
                sizeClassName,
                onRemove && 'pr-1',
            )}
        >
            <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
            />
            <span className="truncate">{children ?? name}</span>
            {onRemove ? (
                <button
                    type="button"
                    aria-label={`删除标签 ${name}`}
                    onClick={onRemove}
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </span>
    );
}
