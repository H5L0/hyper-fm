// ---------------------------------------------------------------------------
// 工具栏：搜索、视图切换、扫描、添加项目
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { Files, FolderPlus, LayoutGrid, List, Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../../store/app-store.js';
import { useProjectImportController } from '@/project-import/use-project-import-controller.js';
import { AddScanRootDialog } from './scan-root-dialog.js';
import { AddProjectInfoPanel } from './project-info-panel/project-info-panel.js';
import { BatchImportOverridePanel, BatchImportPanel } from './project-info-panel/batch-import-panel.js';
import { SplitMenuButton, SplitMenuEntry } from '../ui/split-menu-button.js';

export function Toolbar() {
    const { search, view, scanProgress, config, pendingNewProject } = useAppState();
    const actions = useAppActions();
    const scanning = !!scanProgress?.running;
    const projectImport = useProjectImportController();
    const [scanRootDraftPath, setScanRootDraftPath] = useState<string | null>(null);

    useEffect(() => {
        if (pendingNewProject > 0) {
            projectImport.addProject.openNew();
        }
    }, [pendingNewProject]);

    const openScanRootDialog = async () => {
        const dir = await actions.pickDirectory();
        if (!dir) return;
        setScanRootDraftPath(dir);
    };

    const combinedMenuItems: SplitMenuEntry[] = [
        {
            type: 'item' as const,
            key: 'import-project',
            label: '导入项目',
            icon: <FolderPlus className="size-3.5" />,
            onSelect: () => void projectImport.addProject.open(),
            disabled: projectImport.addProject.busy,
        },
        {
            type: 'item' as const,
            key: 'batch-import-projects',
            label: '批量导入项目',
            icon: <Files className="size-3.5" />,
            onSelect: () => void projectImport.batchProject.open(),
            disabled: projectImport.batchProject.busy,
        },
        { type: 'divider' as const, key: 'div-1' },
        {
            type: 'item' as const,
            key: 'rescan',
            label: scanning ? '扫描中…' : '重新扫描',
            icon: <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />,
            onSelect: () => void actions.runScanAll(),
            disabled: scanning,
        },
        {
            type: 'item' as const,
            key: 'add-scan-root',
            label: '添加扫描根目录',
            icon: <FolderPlus className="size-3.5" />,
            onSelect: () => void openScanRootDialog(),
        },
    ];

    return (
        <>
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card/35 px-4">
                <div className="flex h-8 items-center gap-0.5 rounded-lg border border-border bg-background px-1">
                    <ViewButton
                        active={view === 'grid'}
                        onClick={() => actions.setView('grid')}
                        icon={<LayoutGrid className="size-3.5" />}
                    />
                    <ViewButton
                        active={view === 'list'}
                        onClick={() => actions.setView('list')}
                        icon={<List className="size-3.5" />}
                    />
                </div>

                <div className="min-w-0 flex-1 px-1">
                    <input
                        type="text"
                        placeholder="搜索项目名、标签、路径"
                        value={search}
                        onChange={event => actions.setSearch(event.target.value)}
                        className="h-8 w-full max-w-[24rem] rounded-lg border border-border bg-background px-3 outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <SplitMenuButton
                        label="新建项目"
                        icon={<Plus className="size-3.5" />}
                        primaryDisabled={projectImport.addProject.busy || projectImport.batchProject.busy}
                        menuDisabled={projectImport.batchProject.busy}
                        onPrimaryClick={() => void projectImport.addProject.openNew()}
                        items={combinedMenuItems}
                        align="right"
                        menuLabel="打开附加菜单"
                    />
                </div>
            </div>

            <AddProjectInfoPanel
                open={projectImport.addProject.isOpen}
                mode={projectImport.addProject.mode}
                form={projectImport.addProject.form}
                onFormChange={projectImport.addProject.setForm}
                tagDefs={config.tags}
                inspection={projectImport.addProject.inspection}
                validation={projectImport.addProject.validation}
                allProjects={config.projects}
                syncConfigs={config.syncConfigs ?? []}
                draftProjectRootId={projectImport.addProject.draftProjectRootId}
                syncRuleOverrides={projectImport.addProject.draftSyncRules}
                busy={projectImport.addProject.busy}
                onClose={projectImport.addProject.close}
                onSubmit={() => void projectImport.addProject.submit()}
                onPickPath={() => void projectImport.addProject.browsePath()}
                onPathCommit={() => void projectImport.addProject.commitPath()}
                onPickParentPath={() => void projectImport.addProject.browseParentPath()}
                onSetPathFromScanRoot={(rootPath: string) => projectImport.addProject.setPathFromScanRoot(rootPath)}
                scanRoots={config.scanRoots}
                onSyncRuleChange={projectImport.addProject.setSyncRule}
                onAddTag={projectImport.addProject.addTag}
                onRemoveTag={projectImport.addProject.removeTag}
            />

            <BatchImportPanel
                open={projectImport.batchProject.isOpen}
                items={projectImport.batchProject.items}
                busy={projectImport.batchProject.busy}
                tagDefs={config.tags}
                templateTags={projectImport.batchProject.templateTags}
                templateIgnoreText={projectImport.batchProject.templateIgnoreText}
                onTemplateIgnoreTextChange={projectImport.batchProject.setTemplateIgnoreText}
                onAddTemplateTag={projectImport.batchProject.addTemplateTag}
                onRemoveTemplateTag={projectImport.batchProject.removeTemplateTag}
                onApplyTemplate={() => void projectImport.batchProject.applyTemplate()}
                onClose={projectImport.batchProject.close}
                onImportAll={() => void projectImport.batchProject.importAll()}
                onImportOne={itemId => void projectImport.batchProject.importOne(itemId)}
                onRemoveOne={projectImport.batchProject.removeOne}
                onOpenOverride={projectImport.batchProject.openOverride}
                stacked={projectImport.batchProject.editingItem !== null}
            />

            <BatchImportOverridePanel
                item={projectImport.batchProject.editingItem}
                tagDefs={config.tags}
                busy={projectImport.batchProject.busy}
                onClose={projectImport.batchProject.closeOverride}
                onSubmit={() => projectImport.batchProject.editingItem ? void projectImport.batchProject.importOne(projectImport.batchProject.editingItem.id) : undefined}
                onFormChange={projectImport.batchProject.updateOverrideForm}
            />

            {scanRootDraftPath ? (
                <AddScanRootDialog
                    directoryPath={scanRootDraftPath}
                    onClose={() => setScanRootDraftPath(null)}
                />
            ) : null}
        </>
    );
}

function ViewButton({
    icon,
    active,
    onClick,
}: {
    icon: React.ReactNode;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex size-6 items-center justify-center rounded-md transition-colors',
                active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
        >
            {icon}
        </button>
    );
}
