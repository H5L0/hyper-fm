import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EditDialogShell({
    title,
    note,
    onClose,
    children,
    footerStart,
    footerEnd,
    panelClassName,
    bodyClassName,
    bodyPaddingClassName = 'px-5 py-5',
    closeLabel = '关闭',
}: {
    title: React.ReactNode;
    note?: React.ReactNode;
    onClose: () => void;
    children: React.ReactNode;
    footerStart?: React.ReactNode;
    footerEnd?: React.ReactNode;
    panelClassName?: string;
    bodyClassName?: string;
    bodyPaddingClassName?: string;
    closeLabel?: string;
}) {
    return (
        <>
            <button
                type="button"
                aria-label={typeof closeLabel === 'string' ? closeLabel : '关闭'}
                onClick={onClose}
                className="fixed inset-0 z-[60] cursor-default bg-black/32 backdrop-blur-[1px]"
            />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'fixed top-1/2 left-1/2 z-[70] flex max-h-[min(88vh,920px)] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl',
                    panelClassName,
                )}
            >
                <div className="shrink-0 border-b border-border px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-title text-foreground">{title}</h2>
                            {note ? <p className="mt-1 text-note text-muted-foreground">{note}</p> : null}
                        </div>
                        <Button size="sm" variant="ghost" onClick={onClose}>
                            <X className="size-3.5" /> {closeLabel}
                        </Button>
                    </div>
                </div>

                <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyPaddingClassName, bodyClassName)}>{children}</div>

                {footerStart || footerEnd ? (
                    <div className="shrink-0 border-t border-border bg-card/95 px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">{footerStart}</div>
                            {footerEnd ? <div className="flex items-center justify-end gap-2">{footerEnd}</div> : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </>
    );
}

export function EditDialogField({
    label,
    note,
    children,
}: {
    label: React.ReactNode;
    note?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="flex gap-2">
                <label className="mb-2 block text-subheading">{label}</label>
                {note ? <label className="text-note text-muted-foreground">{note}</label> : null}
            </div>
            {children}
        </div>
    );
}
