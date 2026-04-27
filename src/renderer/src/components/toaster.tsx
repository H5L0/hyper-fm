// ---------------------------------------------------------------------------
// Toast 列表
// ---------------------------------------------------------------------------

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

export function Toaster() {
  const { toasts } = useAppState();
  const actions = useAppActions();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[320px] flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-xs shadow-md',
            t.level === 'error'
              ? 'border-destructive/40 text-destructive'
              : t.level === 'success'
                ? 'border-border text-foreground'
                : 'border-border text-muted-foreground',
          )}
        >
          <span className="mt-0.5 flex-1 break-words">{t.text}</span>
          <button
            type="button"
            onClick={() => actions.dismissToast(t.id)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
