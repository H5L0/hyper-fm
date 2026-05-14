import {
    Children,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from 'react';
import { GripVertical, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type AddableListStyle = CSSProperties & {
    '--addable-list-radius'?: string;
    '--addable-list-tab-height'?: string;
};

const LIST_RADIUS = 12;
const LIST_TAB_HEIGHT = 32;
const LIST_MIN_TAB_WIDTH = 32;

type SortableItemMetric = {
    top: number;
    left: number;
    width: number;
    height: number;
};

type SortableDragState = {
    activeId: string;
    order: string[];
    metrics: Record<string, SortableItemMetric>;
    gaps: number[];
    pointerStartY: number;
    pointerDeltaY: number;
    initialIndex: number;
    placeholderIndex: number;
};

type SortableItemState = {
    style?: CSSProperties;
    dragState: 'idle' | 'dragging' | 'sorted';
};

type AddableListSortableConfig = {
    itemIds: readonly string[];
    onReorder: (activeId: string, targetIndex: number) => void | Promise<void>;
    enabled?: boolean;
};

type AddableListContextValue = {
    sortable: boolean;
    registerItem: (id: string, element: HTMLDivElement | null) => void;
    startDrag: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
    getItemState: (id?: string) => SortableItemState;
};

const AddableListContext = createContext<AddableListContextValue | null>(null);

function buildProjectedOrder(order: readonly string[], activeId: string, targetIndex: number): string[] {
    const others = order.filter(id => id !== activeId);
    const safeIndex = Math.max(0, Math.min(targetIndex, others.length));
    others.splice(safeIndex, 0, activeId);
    return others;
}

function buildGapList(order: readonly string[], metrics: Record<string, SortableItemMetric>): number[] {
    return order.slice(0, -1).map((id, index) => {
        const current = metrics[id];
        const next = metrics[order[index + 1]!];
        if (!current || !next) {
            return 0;
        }
        return Math.max(0, next.top - (current.top + current.height));
    });
}

function buildProjectedTops(order: readonly string[], metrics: Record<string, SortableItemMetric>, gaps: readonly number[]): Record<string, number> {
    if (order.length === 0) {
        return {};
    }

    const tops: Record<string, number> = {};
    let cursor = Math.min(...order.map(id => metrics[id]?.top ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(cursor)) {
        cursor = 0;
    }

    order.forEach((id, index) => {
        tops[id] = cursor;
        if (index < order.length - 1) {
            cursor += metrics[id]!.height + (gaps[index] ?? gaps[gaps.length - 1] ?? 0);
        }
    });

    return tops;
}

function resolvePlaceholderIndex(order: readonly string[], activeId: string, metrics: Record<string, SortableItemMetric>, activeCenter: number): number {
    let nextIndex = 0;
    for (const id of order) {
        if (id === activeId) {
            continue;
        }
        const metric = metrics[id];
        if (metric && activeCenter > metric.top + metric.height / 2) {
            nextIndex += 1;
        }
    }
    return nextIndex;
}

function buildAddableListPath(width: number, bodyHeight: number, tabWidth: number, radius: number, tabHeight: number): string {
    const safeWidth = Math.max(width, radius * 4);
    const safeBodyHeight = Math.max(bodyHeight, radius * 2 + 8);
    const safeTabWidth = Math.min(
        Math.max(tabWidth, radius * 2 + 24),
        Math.max(radius * 2 + 24, safeWidth - radius * 2),
    );
    const totalHeight = safeBodyHeight + tabHeight;

    return [
        `M ${radius} 0`,
        `H ${safeWidth - radius}`,
        `A ${radius} ${radius} 0 0 1 ${safeWidth} ${radius}`,
        `V ${safeBodyHeight - radius}`,
        `A ${radius} ${radius} 0 0 1 ${safeWidth - radius} ${safeBodyHeight}`,
        `H ${safeTabWidth + radius}`,
        `A ${radius} ${radius} 0 0 0 ${safeTabWidth} ${safeBodyHeight + radius}`,
        `V ${totalHeight - radius}`,
        `A ${radius} ${radius} 0 0 1 ${safeTabWidth - radius} ${totalHeight}`,
        `H ${radius}`,
        `A ${radius} ${radius} 0 0 1 0 ${totalHeight - radius}`,
        `V ${radius}`,
        `A ${radius} ${radius} 0 0 1 ${radius} 0`,
        'Z',
    ].join(' ');
}

export function AddableList({
    children,
    emptyState,
    addLabel = '添加',
    addIcon,
    onAdd,
    addDisabled = false,
    footerEnd,
    addAlign = 'right',
    divided = true,
    className,
    bodyClassName,
    sortable,
}: {
    children: ReactNode;
    emptyState?: ReactNode;
    addLabel?: string;
    addIcon?: ReactNode;
    onAdd?: () => void;
    addDisabled?: boolean;
    footerEnd?: ReactNode;
    addAlign?: 'left' | 'right';
    divided?: boolean;
    className?: string;
    bodyClassName?: string;
    sortable?: AddableListSortableConfig;
}) {
    const shapeRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const tabRef = useRef<HTMLButtonElement>(null);
    const itemElementsRef = useRef(new Map<string, HTMLDivElement>());
    const dragStateRef = useRef<SortableDragState | null>(null);
    const [shapeSize, setShapeSize] = useState({ width: 0, bodyHeight: 0, tabWidth: LIST_MIN_TAB_WIDTH });
    const [dragState, setDragState] = useState<SortableDragState | null>(null);

    useEffect(() => {
        const shapeElement = shapeRef.current;
        const bodyElement = bodyRef.current;
        const tabElement = tabRef.current;
        if (!shapeElement || !bodyElement || !tabElement) {
            return;
        }

        const update = () => {
            setShapeSize({
                width: shapeElement.clientWidth,
                bodyHeight: bodyElement.offsetHeight,
                tabWidth: Math.max(tabElement.offsetWidth, LIST_MIN_TAB_WIDTH),
            });
        };

        update();

        const resizeObserver = new ResizeObserver(() => update());
        resizeObserver.observe(shapeElement);
        resizeObserver.observe(bodyElement);
        resizeObserver.observe(tabElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const style: AddableListStyle = {
        '--addable-list-radius': `${LIST_RADIUS}px`,
        '--addable-list-tab-height': `${LIST_TAB_HEIGHT}px`,
    };

    const childItems = useMemo(() => Children.toArray(children), [children]);

    const path = useMemo(
        () => buildAddableListPath(shapeSize.width, shapeSize.bodyHeight, shapeSize.tabWidth, LIST_RADIUS, LIST_TAB_HEIGHT),
        [shapeSize.bodyHeight, shapeSize.tabWidth, shapeSize.width],
    );

    const viewBox = useMemo(() => {
        const width = Math.max(shapeSize.width, LIST_RADIUS * 4);
        const bodyHeight = Math.max(shapeSize.bodyHeight, LIST_RADIUS * 2 + 8);
        const totalHeight = bodyHeight + LIST_TAB_HEIGHT;
        return `0 0 ${width} ${totalHeight}`;
    }, [shapeSize.bodyHeight, shapeSize.width]);

    const mirroredPathTransform = useMemo(() => {
        if (addAlign !== 'right') {
            return undefined;
        }
        const width = Math.max(shapeSize.width, LIST_RADIUS * 4);
        return `translate(${width} 0) scale(-1 1)`;
    }, [addAlign, shapeSize.width]);

    const sortableEnabled = Boolean(sortable?.enabled ?? sortable);

    const updateDragState = (next: SortableDragState | null) => {
        dragStateRef.current = next;
        setDragState(next);
    };

    const registerItem = (id: string, element: HTMLDivElement | null) => {
        if (!id) {
            return;
        }
        if (element) {
            itemElementsRef.current.set(id, element);
        } else {
            itemElementsRef.current.delete(id);
        }
    };

    const startDrag = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!sortableEnabled || !sortable || event.button !== 0) {
            return;
        }

        const container = bodyRef.current;
        const activeElement = itemElementsRef.current.get(id);
        if (!container || !activeElement) {
            return;
        }

        event.preventDefault();

        const order = sortable.itemIds.filter(itemId => itemElementsRef.current.has(itemId));
        const initialIndex = order.indexOf(id);
        if (initialIndex < 0) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const metrics = Object.fromEntries(order.map(itemId => {
            const rect = itemElementsRef.current.get(itemId)!.getBoundingClientRect();
            return [itemId, {
                top: rect.top - containerRect.top,
                left: rect.left - containerRect.left,
                width: rect.width,
                height: rect.height,
            } satisfies SortableItemMetric];
        })) as Record<string, SortableItemMetric>;

        const nextState: SortableDragState = {
            activeId: id,
            order,
            metrics,
            gaps: buildGapList(order, metrics),
            pointerStartY: event.clientY,
            pointerDeltaY: 0,
            initialIndex,
            placeholderIndex: initialIndex,
        };

        updateDragState(nextState);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const current = dragStateRef.current;
            if (!current) {
                return;
            }

            const activeMetric = current.metrics[current.activeId];
            if (!activeMetric) {
                return;
            }
            const pointerDeltaY = moveEvent.clientY - current.pointerStartY;
            const activeCenter = activeMetric.top + pointerDeltaY + activeMetric.height / 2;
            const placeholderIndex = resolvePlaceholderIndex(current.order, current.activeId, current.metrics, activeCenter);

            if (pointerDeltaY === current.pointerDeltaY && placeholderIndex === current.placeholderIndex) {
                return;
            }

            updateDragState({
                ...current,
                pointerDeltaY,
                placeholderIndex,
            });
        };

        const finishDrag = () => {
            const current = dragStateRef.current;
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', finishDrag);
            document.body.style.removeProperty('user-select');
            document.body.style.removeProperty('cursor');
            updateDragState(null);

            if (!current || current.placeholderIndex === current.initialIndex) {
                return;
            }

            void sortable.onReorder(current.activeId, current.placeholderIndex);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', finishDrag);
        window.addEventListener('pointercancel', finishDrag);
    };

    const projectedOrder = useMemo(
        () => dragState ? buildProjectedOrder(dragState.order, dragState.activeId, dragState.placeholderIndex) : [],
        [dragState],
    );

    const projectedTops = useMemo(
        () => dragState ? buildProjectedTops(projectedOrder, dragState.metrics, dragState.gaps) : {},
        [dragState, projectedOrder],
    );

    const placeholderStyle = useMemo<CSSProperties | null>(() => {
        if (!dragState) {
            return null;
        }
        const activeMetric = dragState.metrics[dragState.activeId];
        if (!activeMetric) {
            return null;
        }
        const top = projectedTops[dragState.activeId] ?? activeMetric.top;
        return {
            top,
            left: activeMetric.left,
            width: activeMetric.width,
            height: activeMetric.height,
        };
    }, [dragState, projectedTops]);

    const contextValue = useMemo<AddableListContextValue>(() => ({
        sortable: sortableEnabled,
        registerItem,
        startDrag,
        getItemState: (id?: string) => {
            if (!sortableEnabled || !dragState || !id) {
                return { dragState: 'idle' };
            }

            if (id === dragState.activeId) {
                return {
                    dragState: 'dragging',
                    style: {
                        transform: `translate3d(0, ${dragState.pointerDeltaY}px, 0) scale(1.01)`,
                        transition: 'none',
                        zIndex: 20,
                        pointerEvents: 'none',
                        boxShadow: '0 18px 40px color-mix(in oklab, var(--foreground) 10%, transparent)',
                    },
                };
            }

            const metric = dragState.metrics[id];
            const projectedTop = projectedTops[id];
            if (!metric || projectedTop === undefined) {
                return { dragState: 'idle' };
            }

            const deltaY = projectedTop - metric.top;
            return {
                dragState: deltaY === 0 ? 'idle' : 'sorted',
                style: {
                    transform: `translate3d(0, ${deltaY}px, 0)`,
                    transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
                },
            };
        },
    }), [dragState, projectedTops, sortableEnabled]);

    return (
        <AddableListContext.Provider value={contextValue}>
            <div className={cn('relative', className)} style={style}>
                <div ref={shapeRef} className="relative min-w-0 pb-(--addable-list-tab-height)">
                    <svg
                        aria-hidden="true"
                        viewBox={viewBox}
                        className="pointer-events-none absolute inset-0 size-full overflow-visible"
                    >
                        <path
                            d={path}
                            fill="var(--card)"
                            stroke="var(--border)"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                            transform={mirroredPathTransform}
                        />
                    </svg>

                    <div
                        ref={bodyRef}
                        className={cn(
                            'relative z-10 overflow-hidden rounded-(--addable-list-radius) space-y-1 p-1',
                            divided && 'divide-y divide-border/60',
                            bodyClassName,
                        )}
                    >
                        {placeholderStyle ? (
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute z-0 rounded-xl border border-dashed border-border/70 bg-muted/35"
                                style={placeholderStyle}
                            />
                        ) : null}
                        {childItems.length > 0
                            ? children
                            : typeof emptyState === 'string'
                                ? (
                                    <AddableListEmpty className="rounded-[calc(var(--addable-list-radius)-0.25rem)] border border-dashed border-border bg-muted/10 text-body text-foreground">
                                        {emptyState}
                                    </AddableListEmpty>
                                )
                                : emptyState}
                    </div>

                    <button
                        ref={tabRef}
                        type="button"
                        disabled={addDisabled}
                        onClick={onAdd}
                        className={cn(
                            'group absolute bottom-0 z-10 inline-flex h-(--addable-list-tab-height) min-w-2 px-1 pb-1 text-subheading text-foreground transition-colors',
                            addAlign === 'right' ? 'right-0 justify-end' : 'left-0 justify-start',
                            onAdd ? 'hover:text-foreground/80' : 'cursor-default',
                            addDisabled && 'cursor-not-allowed opacity-50',
                        )}
                    >
                        <span
                            className={cn(
                                'inline-flex items-center gap-2 rounded-[calc(var(--addable-list-radius)-2px)] px-3 py-1.5 transition-colors',
                                onAdd && !addDisabled && 'group-hover:bg-muted/80 group-focus-visible:bg-muted/80',
                            )}
                        >
                            {addIcon ?? <Plus className="size-4" />}
                            <span>{addLabel}</span>
                        </span>
                    </button>

                    {footerEnd ? (
                        <div
                            className={cn(
                                'absolute bottom-2 pt-2 z-10',
                                addAlign === 'right' ? 'left-4 text-left' : 'right-4 text-right',
                            )}
                        >
                            {footerEnd}
                        </div>
                    ) : null}
                </div>
            </div>
        </AddableListContext.Provider>
    );
}

export function AddableListItem({
    children,
    itemId,
    showGrabHandle = false,
    grabHandleLabel = '拖拽排序',
    className,
    contentClassName,
}: {
    children: ReactNode;
    itemId?: string;
    showGrabHandle?: boolean;
    grabHandleLabel?: string;
    className?: string;
    contentClassName?: string;
}) {
    const context = useContext(AddableListContext);
    const itemState = context?.getItemState(itemId);

    return (
        <div
            ref={element => {
                if (context && itemId) {
                    context.registerItem(itemId, element);
                }
            }}
            className={cn(
                'relative z-10 flex items-stretch gap-1 rounded-[calc(var(--addable-list-radius)-2px)] border border-transparent bg-transparent px-1 py-1 transition-[transform,opacity,box-shadow,border-color,background-color] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)]',
                itemState?.dragState === 'dragging'
                    ? 'border-border bg-card opacity-90'
                    : 'hover:border-border hover:bg-card/80',
                className,
            )}
            style={itemState?.style}
        >
            {showGrabHandle ? (
                <button
                    type="button"
                    aria-label={grabHandleLabel}
                    title={grabHandleLabel}
                    className={cn(
                        'inline-flex w-8 min-h-4 max-h-8 items-center justify-center rounded-sm bg-transparent text-muted-foreground touch-none transition-colors',
                        context?.sortable ? 'cursor-grab active:cursor-grabbing hover:bg-muted/50 hover:text-foreground' : 'cursor-default',
                    )}
                    onPointerDown={event => {
                        if (context?.sortable && itemId) {
                            context.startDrag(itemId, event);
                        }
                    }}
                >
                    <GripVertical className="size-4" />
                </button>
            ) : null}

            <div className={cn('min-w-0 flex-1 p-1', contentClassName)}>{children}</div>
        </div>
    );
}

export function AddableListEmpty({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('px-4 py-8 text-center text-note text-muted-foreground', className)}>
            {children}
        </div>
    );
}