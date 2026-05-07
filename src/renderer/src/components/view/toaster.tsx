// ---------------------------------------------------------------------------
// Toast 列表
// ---------------------------------------------------------------------------

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../../store/app-store.js';

export function Toaster() {
  const { toasts } = useAppState();
  const actions = useAppActions();
  if (toasts.length === 0) return null;

  const stackedToasts = [...toasts].reverse();
  const stackGap = 16;
  const containerHeight = 88 + Math.max(0, stackedToasts.length - 1) * stackGap;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="relative w-full max-w-90" style={{ height: `${containerHeight}px` }}>
        {stackedToasts.map((t, index) => {
          const translateY = index * stackGap;
          const scale = Math.max(0.88, 1 - index * 0.04);
          const opacity = Math.max(0.42, 1 - index * 0.18);
          return (
            <div
              key={t.id}
              style={{
                zIndex: stackedToasts.length - index,
                transform: `translateY(-${translateY}px) scale(${scale})`,
                opacity,
              }}
              className={cn(
                'pointer-events-auto absolute inset-x-0 bottom-0 flex items-start gap-2 rounded-xl border bg-card/96 px-3 py-2.5 text-note shadow-xl backdrop-blur-sm transition-[transform,opacity] duration-200',
                'animate-in slide-in-from-bottom-8 fade-in-0 duration-200',
                t.level === 'error'
                  ? 'border-destructive/40 text-destructive'
                  : t.level === 'success'
                    ? 'border-border text-foreground'
                    : 'border-border text-muted-foreground',
              )}
            >
              <span className="mt-0.5 flex-1 wrap-break-word">{t.text}</span>
              <button
                type="button"
                onClick={() => actions.dismissToast(t.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
