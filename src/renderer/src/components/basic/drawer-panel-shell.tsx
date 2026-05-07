import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function DrawerPanelShell({
    title,
    banner,
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
}: {
    title?: string;
    banner?: ReactNode;
    headerActions?: ReactNode;
    headerTabs?: ReadonlyArray<{ id: string; label: string }>;
    activeTabId?: string;
    onTabChange?: (tabId: string) => void;
    children: ReactNode;
    footer: ReactNode;
    onClose: () => void;
    showBackdrop?: boolean;
    panelOffsetRight?: number;
    backdropZIndex?: number;
    panelZIndex?: number;
}) {
    const panelStyle: CSSProperties = {
        zIndex: panelZIndex,
        right: `${panelOffsetRight}px`,
    };

    return (
        <>
            {showBackdrop ? (
                <button
                    type="button"
                    aria-label="关闭"
                    onClick={onClose}
                    className="fixed inset-0 bg-black/18 dark:bg-black/42"
                    style={{ zIndex: backdropZIndex }}
                />
            ) : null}
            <aside
                className={cn(
                    'fixed top-0 flex h-full w-140 max-w-[calc(100vw-1rem)] flex-col border-l border-border bg-card shadow-2xl transition-[right] duration-150',
                    'animate-in slide-in-from-right-20 fade-in-20 duration-100',
                )}
                style={panelStyle}
            >
                <div className="shrink-0 border-b border-border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        {headerTabs && headerTabs.length > 0 && !title ? (
                            <div className="flex items-center gap-1">
                                {headerTabs.map(tab => {
                                    const active = tab.id === activeTabId;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => onTabChange?.(tab.id)}
                                            className={cn(
                                                'rounded-lg px-3 py-1.5 text-note font-semibold transition-colors',
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
                        ) : title ? (
                            <h2 className="truncate text-heading text-foreground">{title}</h2>
                        ) : <div />}
                        <div className="flex items-center gap-1">{headerActions}</div>
                    </div>
                    {headerTabs && headerTabs.length > 0 && title ? (
                        <div className="mt-3 flex items-center gap-1">
                            {headerTabs.map(tab => {
                                const active = tab.id === activeTabId;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => onTabChange?.(tab.id)}
                                        className={cn(
                                            'rounded-lg px-3 py-1.5 text-note font-semibold transition-colors',
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
                    ) : null}
                </div>

                {banner ? (
                    <div className="border-b border-border bg-muted/35 px-4 py-2 text-caption text-muted-foreground">
                        {banner}
                    </div>
                ) : null}

                <div className="flex-1 overflow-y-auto">{children}</div>

                <div className="shrink-0 border-t border-border bg-card/90 px-5 py-3">{footer}</div>
            </aside>
        </>
    );
}
