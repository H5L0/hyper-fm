import { Check, X } from 'lucide-react';
import type { SyncProjectRule } from '@shared/bridge.js';
import { cn } from '@/lib/utils';

export interface TriStateRuleButtonProps {
  state: SyncProjectRule;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function TriStateRuleButton({
  state,
  label,
  onClick,
  disabled = false,
  className,
}: TriStateRuleButtonProps) {
  const stateLabel = disabled ? `${label} 当前不可直接设置` : `${label}：${getTriStateRuleLabel(state)}`;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={stateLabel}
      aria-label={stateLabel}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border transition-colors',
        state === 'selected'
          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : state === 'ignored'
            ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            : 'border-border bg-background text-muted-foreground',
        disabled ? 'cursor-default opacity-50' : 'hover:bg-background',
        className,
      )}
    >
      {state === 'selected' ? <Check className="size-3.5" /> : null}
      {state === 'ignored' ? <X className="size-3.5" /> : null}
    </button>
  );
}

export function getNextTriStateRule(state: SyncProjectRule): SyncProjectRule {
  if (state === 'default') return 'selected';
  if (state === 'selected') return 'ignored';
  return 'default';
}

export function getTriStateRuleLabel(state: SyncProjectRule): string {
  if (state === 'selected') return '包含';
  if (state === 'ignored') return '排除';
  return '默认';
}
