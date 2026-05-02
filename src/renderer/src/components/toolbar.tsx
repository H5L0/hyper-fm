// ---------------------------------------------------------------------------
// 工具栏：搜索、视图切换、扫描、添加项目
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { FolderPlus, LayoutGrid, List, RefreshCw, X } from 'lucide-react';
import type {
    ManualProjectInput,
    ManualProjectValidationResult,
    ProjectDirectoryInspection,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { SplitMenuButton, type SplitMenuEntry } from '@/components/ui/split-menu-button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';
import { ProjectEditorDrawer, type ProjectEditorFormValue } from './project-editor-drawer.js';
import { AddScanRootDialog } from './scan-root-dialog.js';

export function Toolbar() {
    const { search, view, scanProgress, config } = useAppState();
    const actions = useAppActions();
    const scanning = !!scanProgress?.running;
    const [addOpen, setAddOpen] = useState(false);
    const [scanRootDraftPath, setScanRootDraftPath] = useState<string | null>(null);
    const [form, setForm] = useState<ProjectEditorFormValue>({
        path: '',
        name: '',
        description: '',
        tags: [],
        fingerprint: { kind: 'folder-name', folderName: '' },
    });
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
    const [validation, setValidation] = useState<ManualProjectValidationResult>({ valid: false, conflicts: [] });
    const [busy, setBusy] = useState(false);

    const openScanRootDialog = async () => {
        const dir = await actions.pickDirectory();
        if (!dir) return;
        setScanRootDraftPath(dir);
    };

    const validate = async (override?: Partial<ManualProjectInput>) => {
        const payload: ManualProjectInput = {
            path: override?.path ?? form.path.trim(),
            name: override?.name ?? (form.name.trim() || undefined),
            description: override?.description ?? (form.description.trim() || undefined),
            tags: override?.tags ?? form.tags,
            fingerprint: override?.fingerprint ?? form.fingerprint,
        };
        if (!payload.path) {
            setValidation({ valid: false, conflicts: [] });
            return;
        }
        setValidation(await window.fm.projects.validateNew(payload));
    };

    const inspectAndSync = async (dir: string, forceName = false) => {
        const next = await window.fm.projects.inspectDirectory(dir);
        setInspection(next);
        setForm(prev => ({
            ...prev,
            path: next.path,
            name: forceName || !prev.name.trim() ? next.suggestedName : prev.name,
            fingerprint:
                prev.fingerprint.kind === 'file-paths'
                    ? prev.fingerprint
                    : next.hasMetaFile
                        ? { kind: 'metadata' }
                        : { kind: 'folder-name', folderName: next.suggestedName },
        }));
        return next;
    };

    const openAddProject = async () => {
        const dir = await actions.pickProjectDirectory();
        if (!dir) return;
        const next = await inspectAndSync(dir, true);
        await validate({
            path: next.path,
            name: next.suggestedName,
            fingerprint: next.hasMetaFile ? { kind: 'metadata' } : { kind: 'folder-name', folderName: next.suggestedName },
        });
        setAddOpen(true);
    };

    const browseProjectDir = async () => {
        const dir = await actions.pickProjectDirectory();
        if (!dir) return;
        const next = await inspectAndSync(dir, true);
        await validate({ path: next.path, name: next.suggestedName });
    };

    const commitProjectPath = async () => {
        const path = form.path.trim();
        if (!path) return;
        try {
            const next = await inspectAndSync(path, !form.name.trim());
            await validate({ path: next.path });
        } catch {
            setInspection(null);
            setValidation({ valid: false, conflicts: [] });
        }
    };

    const submitProject = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const project = await actions.addProject({
                path: form.path.trim(),
                name: form.name.trim() || undefined,
                description: form.description.trim() || undefined,
                tags: form.tags,
                fingerprint: form.fingerprint,
            });
            actions.toast('success', `已添加项目：${project.name}`);
            setAddOpen(false);
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '添加失败');
        } finally {
            setBusy(false);
        }
    };

    const addDisabled =
        busy ||
        !form.path.trim() ||
        !validation.valid ||
        (form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.length === 0);

    useEffect(() => {
        if (!addOpen || !form.path.trim()) return;
        void validate();
    }, [addOpen, form]);

    const scanMenuItems: SplitMenuEntry[] = [
        {
            type: 'item' as const,
            key: 'add-scan-root',
            label: '添加扫描根目录',
            icon: <FolderPlus className="size-3.5" />,
            onSelect: () => void openScanRootDialog(),
        },
        //...(config.scanRoots.length > 0
        //    ? [
        //        {
        //            type: 'divider' as const,
        //            key: 'scan-divider-1',
        //        },
        //        ...config.scanRoots.map(root => ({
        //            type: 'item' as const,
        //            key: `scan-root-${root.id}`,
        //            label: `扫描 ${root.path}`,
        //            onSelect: () => void actions.runScanOne(root.id),
        //        })),
        //    ] : []),
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
                    <Button size="default" variant="outline" onClick={() => void openAddProject()}>
                        <FolderPlus className="size-3.5" /> 添加项目
                    </Button>

                    <SplitMenuButton
                        label={scanning ? '扫描中…' : '重新扫描'}
                        icon={<RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />}
                        primaryDisabled={scanning}
                        onPrimaryClick={() => void actions.runScanAll()}
                        items={scanMenuItems}
                        align="right"
                        menuLabel="打开扫描菜单"
                    />
                </div>
            </div>

            {addOpen ? (
                <ProjectEditorDrawer
                    title="添加文件夹"
                    form={form}
                    onFormChange={setForm}
                    tagDefs={config.tags}
                    inspection={inspection}
                    pathEditable
                    onPickPath={() => void browseProjectDir()}
                    onPathCommit={() => void commitProjectPath()}
                    pathHint={
                        inspection ? (
                            <p className="text-note text-muted-foreground">
                                {inspection.hasMetaFile
                                    ? `检测到 .meta-data${inspection.metaProjectId ? `（projectId: ${inspection.metaProjectId}）` : ''}`
                                    : `共发现 ${inspection.files.length} 个文件，可用于文件列表指纹。`}
                            </p>
                        ) : null
                    }
                    validation={
                        !validation.valid && validation.conflicts.length > 0 ? (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
                                <p className="font-medium">当前配置与现有项目冲突，无法添加：</p>
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    {validation.conflicts.map(conflict => (
                                        <li key={`${conflict.projectId}-${conflict.reason}`}>
                                            {conflict.projectName}：{conflict.reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null
                    }
                    onAddTag={tag =>
                        setForm(prev => ({
                            ...prev,
                            tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
                        }))
                    }
                    onRemoveTag={tag => setForm(prev => ({ ...prev, tags: prev.tags.filter(item => item !== tag) }))}
                    onClose={() => setAddOpen(false)}
                    headerActions={
                        <Button size="icon-xs" variant="ghost" onClick={() => setAddOpen(false)}>
                            <X className="size-3.5" />
                        </Button>
                    }
                    footer={
                        <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setAddOpen(false)}>
                                取消
                            </Button>
                            <Button size="sm" disabled={addDisabled} onClick={() => void submitProject()}>
                                添加
                            </Button>
                        </div>
                    }
                />
            ) : null}

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
