import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function DrawerPanelShell({
    title,
    banner,
    edgeAccessory,
    headerActions,
    headerTabs,
    activeTabId,
    onTabChange,
    children,
    footer,
    onClose,
    showBackdrop = true,
    panelOffsetRight = 0,
    backdropZIndex = 30,
    panelZIndex = 40,
    panelClassName,
    bodyClassName,
    panelStyle,
}: {
    title?: string;
    banner?: ReactNode;
    edgeAccessory?: ReactNode;
    headerActions?: ReactNode;
    headerTabs?: ReadonlyArray<{ id: string; label: string }>;
    activeTabId?: string;
    onTabChange?: (tabId: string) => void;
    children: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
    showBackdrop?: boolean;
    panelOffsetRight?: number | string;
    backdropZIndex?: number;
    panelZIndex?: number;
    panelClassName?: string;
    bodyClassName?: string;
    panelStyle?: CSSProperties;
}) {
    const computedPanelStyle: CSSProperties = {
        zIndex: panelZIndex,
        right: typeof panelOffsetRight === 'number' ? `${panelOffsetRight}px` : panelOffsetRight,
        ...panelStyle,
    };
    const hasHeaderTabs = Boolean(headerTabs && headerTabs.length > 0);

    const renderedHeaderTabs = hasHeaderTabs ? (
        <div className="flex shrink-0 items-center gap-1">
            {headerTabs!.map(tab => {
                const active = tab.id === activeTabId;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange?.(tab.id)}
                        className={cn(
                            'rounded-lg px-3 py-1 text-note font-semibold transition-colors',
                            active
                                ? 'bg-secondary text-foreground'
                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                        )}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    ) : null;

    return (
        <>
            {showBackdrop ? (
                <button
                    type="button"
                    aria-label="关闭"
                    onClick={onClose}
                    className="fixed inset-0 bg-black/15 dark:bg-black/45 animate-in fade-in duration-100"
                    style={{ zIndex: backdropZIndex }}
                />
            ) : null}
            <aside
                className={cn(
                    'fixed top-0 flex h-full w-140 max-w-[calc(100vw-1rem)] flex-col border-l border-border bg-card shadow-2xl transition-[right] duration-150',
                    'animate-in slide-in-from-right-20 fade-in duration-100',
                    panelClassName,
                )}
                style={computedPanelStyle}
            >
                {edgeAccessory ? (
                    <div className="absolute top-0 left-px -translate-x-full">
                        {edgeAccessory}
                    </div>
                ) : null}
                <div className="shrink-0 border-b border-border px-4 py-2.5">
                    <div className="relative flex items-center justify-between gap-3">
                        {title ? (
                            <div className="flex min-w-0 items-center gap-3">
                                <h2 className="min-w-0 truncate text-heading text-foreground">{title}</h2>
                                {renderedHeaderTabs}
                            </div>
                        ) : hasHeaderTabs ? (
                            renderedHeaderTabs
                        ) : <div />}
                        <div className="flex items-center gap-1">{headerActions}</div>
                    </div>
                </div>

                {banner ? (
                    <div className="border-b border-border bg-muted/35 px-4 py-2 text-caption text-muted-foreground">
                        {banner}
                    </div>
                ) : null}

                <div className={cn('flex-1 overflow-y-auto', bodyClassName)}>{children}</div>

                {footer ? (
                    <div className="shrink-0 border-t border-border bg-card/90 px-5 py-3">{footer}</div>
                ) : null}
            </aside>
        </>
    );
}
