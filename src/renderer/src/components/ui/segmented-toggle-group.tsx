import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { cn } from '@/lib/utils';

export type SegmentedToggleOption = {
    value: string;
    label: React.ReactNode;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
    disabled?: boolean;
    ariaLabel?: string;
};

export function SegmentedToggleGroup({
    value,
    onValueChange,
    options,
    ariaLabel,
    className,
    itemClassName,
    optionMinWidth = 120,
    align = 'center',
    allowEmpty = false,
}: {
    value: string;
    onValueChange: (nextValue: string) => void;
    options: SegmentedToggleOption[];
    ariaLabel: string;
    className?: string;
    itemClassName?: string;
    optionMinWidth?: number;
    align?: 'center' | 'start';
    allowEmpty?: boolean;
}) {
    const handleValueChange = (groupValue: string[]) => {
        const nextValue = groupValue[0];
        if (nextValue) {
            onValueChange(nextValue);
            return;
        }
        if (allowEmpty) {
            onValueChange('');
        }
    };

    return (
        <ToggleGroup
            aria-label={ariaLabel}
            value={value ? [value] : []}
            onValueChange={handleValueChange}
            className={cn('grid gap-2', className)}
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${optionMinWidth}px, 100%), 1fr))` }}
        >
            {options.map(option => (
                <Toggle
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    aria-label={option.ariaLabel}
                    className={cn(
                        'flex min-h-11 gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[pressed]:border-primary/40 data-[pressed]:bg-primary/10 data-[pressed]:text-foreground',
                        align === 'start' ? 'items-start text-left' : 'items-center justify-center text-center',
                        itemClassName,
                    )}
                >
                    {option.icon ? <span className="mt-0.5 shrink-0 text-muted-foreground">{option.icon}</span> : null}
                    <span className={cn('min-w-0 flex-1', align === 'start' ? 'text-left' : 'text-center')}>
                        <span className={cn('flex items-center gap-2', align === 'start' ? 'justify-start' : 'justify-center')}>
                            <span className="text-subheading leading-none">{option.label}</span>
                            {option.badge ? <span className="shrink-0">{option.badge}</span> : null}
                        </span>
                        {option.description ? (
                            <span className="mt-1 block text-caption leading-5 text-muted-foreground">
                                {option.description}
                            </span>
                        ) : null}
                    </span>
                </Toggle>
            ))}
        </ToggleGroup>
    );
}
