// ---------------------------------------------------------------------------
// 工具栏：搜索、视图切换、扫描、添加项目
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { FolderPlus, LayoutGrid, List, RefreshCw } from 'lucide-react';
import type {
    ManualProjectInput,
    ManualProjectValidationResult,
    ProjectDirectoryInspection,
    SyncProjectRule,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../../store/app-store.js';
import { AddScanRootDialog } from './scan-root-dialog.js';
import { ProjectFormValue } from './project-info-panel/project-details-view.js';
import { AddProjectInfoPanel } from './project-info-panel/project-info-panel.js';
import { SplitMenuButton, SplitMenuEntry } from '../ui/split-menu-button.js';

function createEmptyProjectForm(): ProjectFormValue {
    return {
        path: '',
        name: '',
        description: '',
        tags: [],
        ignore: [],
        syncRespectGitignore: false,
        fingerprint: { kind: 'folder-name', folderName: '' },
    };
}

function normalizeForCompare(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function resolveDraftRootId(projectPath: string, scanRoots: readonly { id: string; path: string }[]): string {
    const normalizedPath = normalizeForCompare(projectPath.trim());
    if (!normalizedPath) return 'manual';
    const matchedRoot = scanRoots.find(root => {
        const normalizedRoot = normalizeForCompare(root.path);
        return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
    });
    return matchedRoot?.id ?? 'manual';
}

export function Toolbar() {
    const { search, view, scanProgress, config } = useAppState();
    const actions = useAppActions();
    const scanning = !!scanProgress?.running;
    const [addOpen, setAddOpen] = useState(false);
    const [scanRootDraftPath, setScanRootDraftPath] = useState<string | null>(null);
    const [form, setForm] = useState<ProjectFormValue>(createEmptyProjectForm());
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
    const [validation, setValidation] = useState<ManualProjectValidationResult>({ valid: false, conflicts: [] });
    const [draftSyncRules, setDraftSyncRules] = useState<Partial<Record<string, SyncProjectRule>>>({});
    const [busy, setBusy] = useState(false);
    const draftProjectRootId = resolveDraftRootId(form.path, config.scanRoots);

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
            ignore: override?.ignore ?? form.ignore,
            syncRespectGitignore: override?.syncRespectGitignore ?? form.syncRespectGitignore,
            fingerprint: override?.fingerprint ?? form.fingerprint,
        };
        if (!payload.path) {
            setValidation({ valid: false, conflicts: [] });
            return;
        }
        setValidation(await window.fm.projects.validateNew(payload));
    };

    const inspectAndSync = async (dir: string, forceName = false, projectIgnore: string[] = form.ignore) => {
        const next = await window.fm.projects.inspectDirectory(dir, projectIgnore);
        setInspection(next);
        setForm(prev => ({
            ...prev,
            path: next.path,
            name: forceName || !prev.name.trim() ? next.suggestedName : prev.name,
            fingerprint:
                next.hasMetaFile
                    ? { kind: 'metadata' }
                    : prev.fingerprint.kind === 'file-paths'
                        ? prev.fingerprint
                        : { kind: 'folder-name', folderName: next.suggestedName },
        }));
        return next;
    };

    useEffect(() => {
        if (!inspection) return;
        setForm(current => {
            if (current.fingerprint.kind !== 'file-paths') return current;
            const nextPaths = current.fingerprint.paths.filter(item => inspection.files.includes(item));
            if (nextPaths.length === current.fingerprint.paths.length) return current;
            return {
                ...current,
                fingerprint: { kind: 'file-paths', paths: nextPaths },
            };
        });
    }, [inspection]);

    const openAddProject = async () => {
        setForm(createEmptyProjectForm());
        setInspection(null);
        setValidation({ valid: false, conflicts: [] });
        setDraftSyncRules({});
        const dir = await actions.pickProjectDirectory();
        if (!dir) return;
        const next = await inspectAndSync(dir, true, []);
        await validate({
            path: next.path,
            name: next.suggestedName,
            ignore: [],
            fingerprint: next.hasMetaFile ? { kind: 'metadata' } : { kind: 'folder-name', folderName: next.suggestedName },
        });
        setAddOpen(true);
    };

    const browseProjectDir = async () => {
        const dir = await actions.pickProjectDirectory();
        if (!dir) return;
        const next = await inspectAndSync(dir, true);
        await validate({ path: next.path, name: next.suggestedName, ignore: form.ignore });
    };

    const commitProjectPath = async () => {
        const path = form.path.trim();
        if (!path) return;
        try {
            const next = await inspectAndSync(path, !form.name.trim());
            await validate({ path: next.path, ignore: form.ignore });
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
                ignore: form.ignore,
                syncRespectGitignore: form.syncRespectGitignore,
                fingerprint: form.fingerprint,
            });
            const explicitSyncRules = Object.entries(draftSyncRules).flatMap(([configId, rule]) =>
                rule && rule !== 'default' ? [[configId, rule] as const] : [],
            );
            if (explicitSyncRules.length > 0) {
                try {
                    for (const [configId, rule] of explicitSyncRules) {
                        await window.fm.sync.setProjectRule(configId, project.id, rule);
                    }
                    await actions.loadConfig();
                } catch (error) {
                    actions.toast('error', `项目已添加，但同步规则保存失败：${error instanceof Error ? error.message : '未知错误'}`);
                    setAddOpen(false);
                    setForm(createEmptyProjectForm());
                    setInspection(null);
                    setValidation({ valid: false, conflicts: [] });
                    setDraftSyncRules({});
                    return;
                }
            }
            actions.toast('success', `已添加项目：${project.name}`);
            setAddOpen(false);
            setForm(createEmptyProjectForm());
            setInspection(null);
            setValidation({ valid: false, conflicts: [] });
            setDraftSyncRules({});
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '添加失败');
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (!addOpen || !form.path.trim()) return;
        void window.fm.projects.inspectDirectory(form.path.trim(), form.ignore).then(setInspection).catch(() => setInspection(null));
    }, [addOpen, form.path, form.ignore]);

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

            <AddProjectInfoPanel
                open={addOpen}
                form={form}
                onFormChange={setForm}
                tagDefs={config.tags}
                inspection={inspection}
                validation={validation}
                allProjects={config.projects}
                syncConfigs={config.syncConfigs ?? []}
                draftProjectRootId={draftProjectRootId}
                syncRuleOverrides={draftSyncRules}
                busy={busy}
                onClose={() => {
                    setAddOpen(false);
                    setDraftSyncRules({});
                }}
                onSubmit={() => void submitProject()}
                onPickPath={() => void browseProjectDir()}
                onPathCommit={() => void commitProjectPath()}
                onSyncRuleChange={(configId, rule) => {
                    setDraftSyncRules(current => ({
                        ...current,
                        [configId]: rule,
                    }));
                }}
                onAddTag={tag =>
                    setForm(prev => ({
                        ...prev,
                        tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
                    }))
                }
                onRemoveTag={tag => setForm(prev => ({ ...prev, tags: prev.tags.filter(item => item !== tag) }))}
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
