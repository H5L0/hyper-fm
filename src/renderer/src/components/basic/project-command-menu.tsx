import type { ReactNode } from 'react';
import { Copy, FileText, FolderOpen, Terminal } from 'lucide-react';
import type { CustomAction, PresetActionDescriptor, Project } from '@shared/bridge.js';
import { cn } from '@/lib/utils.js';

export interface ProjectCommandMenuAction {
    id: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
    title?: string;
}

type ActionMenuItem = {
    id: string;
    label: string;
    title?: string;
};

function buildProjectCustomActionMenuItems(
    project: Project | undefined,
    globalActions: readonly CustomAction[],
): ActionMenuItem[] {
    return [
        ...globalActions.map(a => ({
            id: a.id,
            label: a.label,
            title: a.description ?? a.command,
        })),
        ...(project?.actions ?? []).map(a => ({
            id: a.id,
            label: a.label,
            title: a.description ?? a.command,
        })),
        ...(project?.sharedActions ?? []).map(a => ({
            id: a.id,
            label: a.label,
            title: a.description ?? a.command,
        })),
    ];
}

function iconOfAction(id: string) {
    if (id.startsWith('open.')) return id === 'open.terminal' ? Terminal : FolderOpen;
    if (id.startsWith('copy.')) return Copy;
    // if (id.startsWith('cmd')) return FileTerminal;
    if (id.startsWith('cmd')) return Terminal;
    return FileText;
}

function MenuItem({
    icon,
    children,
    title,
    onClick,
}: {
    icon: ReactNode;
    children: ReactNode;
    title?: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            title={title}
            onClick={onClick}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
        >
            <span className="text-muted-foreground">{icon}</span>
            {children}
        </button>
    );
}

function MenuSeparator() {
    return <div className="my-1 border-t border-border" />;
}

export function ProjectCommandMenu({
    project,
    globalActions = [],
    presets,
    onRunAction,
    leadingActions = [],
    trailingActions = [],
    className,
}: {
    project?: Project;
    globalActions?: readonly CustomAction[];
    presets: readonly PresetActionDescriptor[];
    onRunAction: (actionId: string) => void;
    leadingActions?: readonly ProjectCommandMenuAction[];
    trailingActions?: readonly ProjectCommandMenuAction[];
    className?: string;
}) {
    const customActionItems = buildProjectCustomActionMenuItems(project, globalActions);
    const hasLead = leadingActions.length > 0;
    const hasPresets = presets.length > 0;
    const hasCustom = customActionItems.length > 0;
    const hasTrailing = trailingActions.length > 0;

    return (
        <div role="menu" className={cn('min-w-55 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md', className)}>
            {leadingActions.map(action => (
                <MenuItem key={action.id} icon={action.icon} title={action.title} onClick={action.onSelect}>
                    {action.label}
                </MenuItem>
            ))}

            {hasPresets && hasLead ? <MenuSeparator /> : null}
            {presets.map(a => {
                const Icon = iconOfAction(a.id);
                return (
                    <MenuItem key={a.id} icon={<Icon className="size-4" />} onClick={() => onRunAction(a.id)}>
                        {a.label}
                    </MenuItem>
                );
            })}

            {hasCustom && (hasLead || hasPresets) ? <MenuSeparator /> : null}
            {customActionItems.map(a => {
                const Icon = iconOfAction(a.id);
                return (
                    <MenuItem key={a.id} icon={<Icon className="size-4" />} title={a.title} onClick={() => onRunAction(a.id)}>
                        {a.label}
                    </MenuItem>
                );
            })}

            {hasTrailing && (hasLead || hasPresets || hasCustom) ? <MenuSeparator /> : null}
            {trailingActions.map(action => (
                <MenuItem key={action.id} icon={action.icon} title={action.title} onClick={action.onSelect}>
                    {action.label}
                </MenuItem>
            ))}
        </div>
    );
}
