import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SplitMenuEntry =
    | {
        type: 'item';
        key: string;
        label: ReactNode;
        icon?: ReactNode;
        onSelect: () => void;
        disabled?: boolean;
    }
    | {
        type: 'divider';
        key: string;
    }
    | {
        type: 'note';
        key: string;
        label: ReactNode;
    };

export function SplitMenuButton({
    label,
    icon,
    primaryDisabled = false,
    menuDisabled = false,
    onPrimaryClick,
    items,
    align = 'right',
    menuLabel = '打开菜单',
}: {
    label: string;
    icon?: ReactNode;
    primaryDisabled?: boolean;
    menuDisabled?: boolean;
    onPrimaryClick: () => void;
    items: SplitMenuEntry[];
    align?: 'left' | 'right';
    menuLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const visibleItems = items.filter((item, index, array) => {
        if (item.type !== 'divider') return true;
        const prev = array[index - 1];
        const next = array[index + 1];
        return !!prev && !!next && prev.type !== 'divider' && next.type !== 'divider';
    });

    return (
        <div ref={ref} className="relative shrink-0">
            <div className="flex h-8 items-stretch overflow-hidden rounded-lg border border-border bg-background">
                <button
                    type="button"
                    disabled={primaryDisabled}
                    onClick={onPrimaryClick}
                    className="inline-flex h-full items-center gap-1.5 pl-3 pr-2 text-note font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                    {icon}
                    {label}
                </button>
                <button
                    type="button"
                    disabled={menuDisabled}
                    aria-label={menuLabel}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-controls={open ? menuId : undefined}
                    onClick={() => setOpen(value => !value)}
                    className={cn(
                        'inline-flex h-8 w-6 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                        open && 'bg-muted text-foreground',
                    )}
                >
                    <ChevronDown className="size-4" />
                </button>
            </div>

            {open ? (
                <div
                    id={menuId}
                    role="menu"
                    className={cn(
                        'absolute top-full z-50 mt-1 min-w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md',
                        align === 'right' ? 'right-0' : 'left-0',
                    )}
                >
                    {visibleItems.map(item => {
                        if (item.type === 'divider') {
                            return <div key={item.key} className="my-1 border-t border-border" />;
                        }
                        if (item.type === 'note') {
                            return <div key={item.key} className="px-3 py-2">{item.label}</div>;
                        }
                        return (
                            <button
                                key={item.key}
                                type="button"
                                role="menuitem"
                                disabled={item.disabled}
                                onClick={() => {
                                    setOpen(false);
                                    item.onSelect();
                                }}
                                className="flex w-full items-center px-3 py-2 text-left text-body text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                            >
                                {item.icon && <span className="mr-2">{item.icon}</span>}
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}