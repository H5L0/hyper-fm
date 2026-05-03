import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export function CheckboxField({
    checked,
    onCheckedChange,
    label,
    description,
    disabled = false,
    className,
    checkboxClassName,
    contentClassName,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label: React.ReactNode;
    description?: React.ReactNode;
    disabled?: boolean;
    className?: string;
    checkboxClassName?: string;
    contentClassName?: string;
}) {
    return (
        <label
            className={cn(
                'flex items-start gap-2.5',
                disabled && 'cursor-not-allowed opacity-70',
                className,
            )}
        >
            <Checkbox
                checked={checked}
                onCheckedChange={nextChecked => onCheckedChange(nextChecked === true)}
                disabled={disabled}
                className={cn('mt-0.5', checkboxClassName)}
            />
            <span className={cn('min-w-0 flex-1 pt-0.5', contentClassName)}>
                <span className="block text-note text-foreground">{label}</span>
                {description ? <span className="mt-1 block text-caption text-muted-foreground">{description}</span> : null}
            </span>
        </label>
    );
}