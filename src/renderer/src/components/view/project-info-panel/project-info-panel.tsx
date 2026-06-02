import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, FolderOpen, Save, Terminal, X } from 'lucide-react';
import type {
    CustomAction,
    ManualProjectValidationResult,
    PresetActionDescriptor,
    Project,
    ProjectDirectoryInspection,
    ProjectMetaPatch,
    ScanRoot,
    SyncConfig,
    SyncProjectRule,
    TagDefinition,
} from '@shared/bridge.js';
import { explainMatch, matchProject, parseSearchQuery } from '@shared/search.js';
import type { ScopedActionDraft } from '@/components/basic/command-list-editor.js';
import { ProjectCommandMenu } from '@/components/basic/project-command-menu.js';
import { Button } from '@/components/ui/button';
import { DrawerPanelShell } from '@/components/basic/drawer-panel-shell.js';
import {
    describeManualProjectValidationConflict,
    getManualProjectValidationTitle,
} from '@/project-import/validation-text.js';
import { useAppActions, useAppState } from '@/store/app-store.js';
import { ProjectActionsView } from './project-commands-view.js';
import { describeInspectionHint, ProjectFormValue, ProjectDetailsView } from './project-details-view.js';
import { ProjectFilesSidePanel } from './project-files-view.js';
import { ProjectSyncView, readProjectRule } from './project-sync-view.js';
import { cn } from '@/lib/utils.js';

export type ProjectInfoPanelViewId = 'info' | 'sync' | 'commands';
type ProjectFilePanelMode = 'browse' | 'select-fingerprint' | null;

type SyncRuleOverrides = Partial<Record<string, SyncProjectRule>>;

const PROJECT_CREATE_PANEL_VIEWS: ReadonlyArray<{ id: Exclude<ProjectInfoPanelViewId, 'commands'>; label: string }> = [
    { id: 'info', label: '信息' },
    { id: 'sync', label: '同步' },
];

const PROJECT_INFO_PANEL_VIEWS: ReadonlyArray<{ id: ProjectInfoPanelViewId; label: string }> = [
    ...PROJECT_CREATE_PANEL_VIEWS,
    { id: 'commands', label: '动作' },
];

type FormState = ProjectFormValue;

function projectToForm(project: Project): FormState {
    return {
        path: project.path,
        name: project.name,
        description: project.description ?? '',
        tags: [...project.tags],
        ignore: [...project.ignore],
        favoriteFiles: [...(project.favoriteFiles ?? [])],
        syncRespectGitignore: project.syncRespectGitignore ?? false,
        fingerprint: project.fingerprint,
    };
}

function formsEqual(a: FormState, b: FormState): boolean {
    if (a.path !== b.path) return false;
    if (a.name !== b.name) return false;
    if (a.description !== b.description) return false;
    if (a.ignore.length !== b.ignore.length) return false;
    for (let index = 0; index < a.ignore.length; index++) {
        if (a.ignore[index] !== b.ignore[index]) return false;
    }
    if (a.favoriteFiles.length !== b.favoriteFiles.length) return false;
    for (let index = 0; index < a.favoriteFiles.length; index++) {
        if (a.favoriteFiles[index] !== b.favoriteFiles[index]) return false;
    }
    if (a.syncRespectGitignore !== b.syncRespectGitignore) return false;
    if (!sameFingerprint(a.fingerprint, b.fingerprint)) return false;
    if (a.tags.length !== b.tags.length) return false;
    for (let index = 0; index < a.tags.length; index++) {
        if (a.tags[index] !== b.tags[index]) return false;
    }
    return true;
}

function cloneAction(a: CustomAction): CustomAction {
    return {
        ...a,
        ...(a.args ? { args: [...a.args] } : {}),
    };
}

function projectToActionDrafts(project: Project): ScopedActionDraft[] {
    return [
        ...(project.actions ?? []).map(a => ({ ...cloneAction(a), scope: 'local' as const })),
        ...(project.sharedActions ?? []).map(a => ({ ...cloneAction(a), scope: 'shared' as const })),
    ];
}

function sameActions(a: ScopedActionDraft[], b: ScopedActionDraft[]): boolean {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
        const left = a[index];
        const right = b[index];
        if (!left || !right) return false;
        if (left.id !== right.id) return false;
        if (left.label !== right.label) return false;
        if (left.command !== right.command) return false;
        if (left.cwd !== right.cwd) return false;
        if (left.description !== right.description) return false;
        if ((left.scope ?? 'local') !== (right.scope ?? 'local')) return false;
        const leftArgs = left.args ?? [];
        const rightArgs = right.args ?? [];
        if (leftArgs.length !== rightArgs.length) return false;
        for (let argsIndex = 0; argsIndex < leftArgs.length; argsIndex += 1) {
            if (leftArgs[argsIndex] !== rightArgs[argsIndex]) return false;
        }
    }
    return true;
}

function splitActionDrafts(actions: ScopedActionDraft[], allowLocalActions: boolean) {
    const localActions: CustomAction[] = [];
    const sharedActions: CustomAction[] = [];

    for (const a of actions) {
        const normalized: CustomAction = cloneAction({
            ...a,
            args: undefined,
        });
        if (a.scope === 'shared') {
            sharedActions.push(normalized);
        } else if (allowLocalActions) {
            localActions.push(normalized);
        }
    }

    return {
        ...(allowLocalActions ? { localActions } : {}),
        sharedActions,
    };
}

function hasEmptyFileFingerprint(form: ProjectFormValue): boolean {
    return form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.length === 0;
}

function renderInspectionHint(inspection: ProjectDirectoryInspection | null) {
    const text = describeInspectionHint(inspection);
    if (!text) return null;
    return (
        <p className="text-note text-muted-foreground">{text}</p>
    );
}

function renderConflictValidation(validation: ManualProjectValidationResult) {
    if (validation.valid || validation.conflicts.length === 0) return null;
    return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
            <p className="font-medium">{getManualProjectValidationTitle(validation, 'single')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
                {validation.conflicts.map(conflict => (
                    <li key={`${conflict.projectId}-${conflict.kind}-${conflict.detail ?? ''}`}>
                        {conflict.projectName}：{describeManualProjectValidationConflict(conflict)}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function renderEmptyFingerprintValidation() {
    return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
            文件列表指纹至少需要选择一个文件。
        </div>
    );
}

function renderAddProjectValidation(validation: ManualProjectValidationResult, missingFingerprintFile: boolean) {
    const conflictValidation = renderConflictValidation(validation);
    if (!conflictValidation && !missingFingerprintFile) return null;
    return (
        <div className="space-y-3">
            {conflictValidation}
            {missingFingerprintFile ? renderEmptyFingerprintValidation() : null}
        </div>
    );
}

export function ProjectFilesPanelToggle({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title="查看文件"
            className={cn(
                'group inline-flex mt-2 mr-3 h-8 pl-2 pr-3 items-center gap-1.5 rounded-xl border border-border bg-card',
                'text-note font-semibold text-foreground shadow-lg',
                'transition-[background-color,color,transform] duration-150 hover:bg-muted/60',
            )}
        >
            <ChevronLeft className="size-3.5 text-muted-foreground transition-transform duration-150 group-hover:-translate-x-0.5" />
            <span>文件</span>
        </button>
    );
}

function createInspectionFallback(project: Pick<Project, 'id' | 'name' | 'path' | 'hasMetaFile' | 'fingerprint'>): ProjectDirectoryInspection {
    return {
        path: project.path,
        suggestedName: project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.name,
        hasMetaFile: project.hasMetaFile,
        metaProjectId: project.id,
        tree: [],
        files: project.fingerprint.kind === 'file-paths' ? project.fingerprint.paths : [],
        filesComplete: false,
    };
}

function hasSyncRuleOverrides(ruleOverrides: SyncRuleOverrides): boolean {
    return Object.keys(ruleOverrides).length > 0;
}

function updateSyncRuleOverrides(
    current: SyncRuleOverrides,
    syncConfigs: readonly SyncConfig[],
    projectId: string,
    configId: string,
    rule: SyncProjectRule,
): SyncRuleOverrides {
    const syncConfig = syncConfigs.find(item => item.id === configId);
    if (!syncConfig) return current;
    const initialRule = readProjectRule(syncConfig, projectId);
    if (rule === initialRule) {
        const { [configId]: _removed, ...rest } = current;
        return rest;
    }
    return {
        ...current,
        [configId]: rule,
    };
}

export function AddProjectInfoPanel({
    open,
    mode,
    form,
    onFormChange,
    tagDefs,
    inspection,
    validation,
    allProjects,
    syncConfigs,
    draftProjectRootId,
    syncRuleOverrides,
    busy,
    onClose,
    onSubmit,
    onPickPath,
    onPathCommit,
    onPickParentPath,
    onSetPathFromScanRoot,
    scanRoots,
    onSyncRuleChange,
    onAddTag,
    onRemoveTag,
}: {
    open: boolean;
    mode: 'new' | 'import';
    form: ProjectFormValue;
    onFormChange: (next: ProjectFormValue) => void;
    tagDefs: readonly TagDefinition[] | undefined;
    inspection: ProjectDirectoryInspection | null;
    validation: ManualProjectValidationResult;
    allProjects: Project[];
    syncConfigs: SyncConfig[];
    draftProjectRootId: string;
    syncRuleOverrides: Partial<Record<string, SyncProjectRule>>;
    busy: boolean;
    onClose: () => void;
    onSubmit: () => void;
    onPickPath: () => void;
    onPathCommit: () => void;
    onPickParentPath?: () => void;
    onSetPathFromScanRoot?: (rootPath: string) => void;
    scanRoots?: ScanRoot[];
    onSyncRuleChange: (configId: string, rule: SyncProjectRule) => void;
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
}) {
    const [activeView, setActiveView] = useState<ProjectInfoPanelViewId>('info');
    const [filePanelMode, setFilePanelMode] = useState<ProjectFilePanelMode>(null);
    const [ignoreText, setIgnoreText] = useState(form.ignore.join('\n'));

    useEffect(() => {
        if (!open) return;
        setActiveView('info');
        setFilePanelMode(null);
    }, [open]);

    useEffect(() => {
        setIgnoreText(form.ignore.join('\n'));
    }, [form.ignore]);

    if (!open) return null;

    const submitDisabled = busy || !form.path.trim() || !validation.valid || hasEmptyFileFingerprint(form);
    const effectiveInspection = inspection ?? (form.path.trim()
        ? {
            path: form.path.trim(),
            suggestedName: form.path.trim().split(/[\\/]/).filter(Boolean).pop() ?? form.name,
            hasMetaFile: false,
            tree: [],
            files: form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : [],
            filesComplete: false,
        }
        : null);
    const draftProject = {
        id: '__draft_project__',
        rootId: draftProjectRootId,
    };

    const updateIgnoreText = (value: string) => {
        setIgnoreText(value);
        onFormChange({
            ...form,
            ignore: parseIgnoreRules(value),
        });
    };

    return (
        <>
            <DrawerPanelShell
                title={mode === 'new' ? '新建项目' : '导入项目'}
                headerTabs={PROJECT_CREATE_PANEL_VIEWS}
                activeTabId={activeView}
                onTabChange={tabId => setActiveView(tabId as ProjectInfoPanelViewId)}
                onClose={onClose}
                panelClassName={filePanelMode ? 'shadow-xl' : undefined}
                edgeAccessory={filePanelMode === null ? (
                    <ProjectFilesPanelToggle onClick={() => setFilePanelMode('browse')} />
                ) : null}
                headerActions={(
                    <Button size="icon-xs" variant="ghost" onClick={onClose}>
                        <X className="size-3.5" />
                    </Button>
                )}
                footer={(
                    <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={onClose}>
                            取消
                        </Button>
                        <Button size="sm" disabled={submitDisabled} onClick={onSubmit}>
                            添加
                        </Button>
                    </div>
                )}
            >
                {activeView === 'sync' ? (
                    <ProjectSyncView
                        path={form.path}
                        projectIgnore={form.ignore}
                        ignoreText={ignoreText}
                        onIgnoreTextChange={updateIgnoreText}
                        syncRespectGitignore={form.syncRespectGitignore}
                        onSyncRespectGitignoreChange={checked => onFormChange({
                            ...form,
                            syncRespectGitignore: checked,
                        })}
                        project={draftProject}
                        allProjects={allProjects}
                        syncConfigs={syncConfigs}
                        ruleOverrides={syncRuleOverrides}
                        busyId={null}
                        onChangeRule={onSyncRuleChange}
                    />
                ) : (
                    <ProjectDetailsView
                        form={form}
                        onFormChange={onFormChange}
                        tagDefs={tagDefs}
                        inspection={effectiveInspection}
                        pathEditable
                        pathHint={renderInspectionHint(inspection)}
                        validation={renderAddProjectValidation(validation, hasEmptyFileFingerprint(form))}
                        tagSelectorMode="alwaysEdit"
                        onPickPath={onPickPath}
                        onPathCommit={onPathCommit}
                        onPickParentPath={onPickParentPath}
                        onSetPathFromScanRoot={onSetPathFromScanRoot}
                        scanRoots={scanRoots}
                        mode={mode}
                        onAddTag={onAddTag}
                        onRemoveTag={onRemoveTag}
                        onEditFileFingerprint={() => setFilePanelMode('select-fingerprint')}
                    />
                )}
            </DrawerPanelShell>

            {filePanelMode ? (
                <ProjectFilesSidePanel
                    mode={filePanelMode}
                    path={form.path}
                    projectIgnore={form.ignore}
                    initialInspection={effectiveInspection}
                    selectedPaths={form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : []}
                    favoriteFiles={form.favoriteFiles}
                    onFavoriteFilesChange={paths => onFormChange({
                        ...form,
                        favoriteFiles: paths,
                    })}
                    onClose={() => setFilePanelMode(null)}
                    onConfirmSelection={paths => {
                        onFormChange({
                            ...form,
                            fingerprint: { kind: 'file-paths', paths },
                        });
                        setFilePanelMode(null);
                    }}
                />
            ) : null}
        </>
    );
}

export function ProjectInfoPanel() {
    const { selectedProjectId, fileViewProjectId, config, search } = useAppState();
    const actions = useAppActions();
    const project = useMemo(
        () => config.projects.find(item => item.id === selectedProjectId),
        [config.projects, selectedProjectId],
    );
    const standaloneFileProject = useMemo(
        () => selectedProjectId ? undefined : config.projects.find(item => item.id === fileViewProjectId),
        [config.projects, fileViewProjectId, selectedProjectId],
    );
    const standaloneFileInspection = useMemo(
        () => standaloneFileProject ? createInspectionFallback(standaloneFileProject) : null,
        [standaloneFileProject],
    );

    const [form, setForm] = useState<FormState | null>(project ? projectToForm(project) : null);
    const [initial, setInitial] = useState<FormState | null>(project ? projectToForm(project) : null);
    const [presets, setPresets] = useState<PresetActionDescriptor[]>([]);
    const [globalActions, setGlobalActions] = useState<CustomAction[]>([]);
    const [actionDrafts, setActionDrafts] = useState<ScopedActionDraft[]>(project ? projectToActionDrafts(project) : []);
    const [initialActionDrafts, setInitialActionDrafts] = useState<ScopedActionDraft[]>(project ? projectToActionDrafts(project) : []);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
    const [activeView, setActiveView] = useState<ProjectInfoPanelViewId>('info');
    const [filePanelMode, setFilePanelMode] = useState<ProjectFilePanelMode>(null);
    const [ignoreText, setIgnoreText] = useState(project ? project.ignore.join('\n') : '');
    const [syncRuleOverrides, setSyncRuleOverrides] = useState<SyncRuleOverrides>({});

    useEffect(() => {
        const next = project ? projectToForm(project) : null;
        const nextActions = project ? projectToActionDrafts(project) : [];
        setForm(next);
        setInitial(next);
        setActionDrafts(nextActions);
        setInitialActionDrafts(nextActions);
        setIgnoreText(next?.ignore.join('\n') ?? '');
    }, [project]);

    useEffect(() => {
        setActionsOpen(false);
        setConfirmClose(false);
        setActiveView('info');
        setFilePanelMode(null);
        setSyncRuleOverrides({});
    }, [project?.id]);

    useEffect(() => {
        if (fileViewProjectId && !standaloneFileProject) {
            actions.closeProjectFiles();
        }
    }, [actions, fileViewProjectId, standaloneFileProject]);

    useEffect(() => {
        if (!form?.path) {
            setInspection(null);
            return;
        }
        void window.fm.projects.inspectDirectory(form.path, form.ignore, {
            mode: 'summary',
            includeFiles: form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : [],
        }).then(setInspection).catch(() => setInspection(null));
    }, [form?.fingerprint, form?.ignore, form?.path]);

    useEffect(() => {
        if (!inspection) return;
        setForm(current => {
            if (!current || current.fingerprint.kind !== 'file-paths') return current;
            if (!inspection.filesComplete) return current;
            const nextPaths = current.fingerprint.paths.filter(item => inspection.files.includes(item));
            if (nextPaths.length === current.fingerprint.paths.length) return current;
            return {
                ...current,
                fingerprint: { kind: 'file-paths', paths: nextPaths },
            };
        });
    }, [inspection]);

    const formDirty = useMemo(() => {
        if (!form || !initial) return false;
        return !formsEqual(form, initial);
    }, [form, initial]);

    const syncRulesDirty = useMemo(() => hasSyncRuleOverrides(syncRuleOverrides), [syncRuleOverrides]);

    const commandsDirty = useMemo(
        () => !sameActions(actionDrafts, initialActionDrafts),
        [actionDrafts, initialActionDrafts],
    );

    const isDirty = formDirty || syncRulesDirty || commandsDirty;

    const tryClose = () => {
        if (isDirty) {
            setConfirmClose(true);
        } else {
            actions.selectProject(undefined);
        }
    };

    useEffect(() => {
        if (!project) return;
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (confirmClose) {
                    setConfirmClose(false);
                } else {
                    tryClose();
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project, isDirty, confirmClose]);

    useEffect(() => {
        void window.fm.actions.presets().then(setPresets);
        void window.fm.actions.list().then(setGlobalActions);
    }, []);

    const matchExplanation = useMemo(() => {
        if (!project || !search.trim()) return '';
        const query = parseSearchQuery(search);
        const explain = matchProject(project, query);
        return explain ? explainMatch(explain) : '';
    }, [project, search]);

    const effectiveInspection = useMemo(
        () => project ? (inspection ?? createInspectionFallback(project)) : null,
        [inspection, project],
    );

    const saveStandaloneFavoriteFiles = async (paths: string[]) => {
        if (!standaloneFileProject) return;
        try {
            const patch: ProjectMetaPatch = { favoriteFiles: paths };
            if (standaloneFileProject.hasMetaFile) {
                await window.fm.projects.writeMetaFile(standaloneFileProject.id, patch);
            } else {
                await window.fm.projects.updateMeta(standaloneFileProject.id, patch);
            }
            await actions.loadConfig();
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '保存收藏文件失败');
        }
    };

    if (!project || !form) {
        if (!standaloneFileProject) return null;
        return (
            <ProjectFilesSidePanel
                mode="browse"
                path={standaloneFileProject.path}
                projectIgnore={standaloneFileProject.ignore}
                initialInspection={standaloneFileInspection}
                favoriteFiles={standaloneFileProject.favoriteFiles}
                onFavoriteFilesChange={paths => void saveStandaloneFavoriteFiles(paths)}
                attachedToInfoPanel={false}
                onClose={() => actions.closeProjectFiles()}
                onOpenFile={relativePath => void window.fm.projects.openFile(standaloneFileProject.id, relativePath)}
                onOpenFileWith={relativePath => void window.fm.projects.openFileWith(standaloneFileProject.id, relativePath)}
                onOpenFolder={relativePath => void window.fm.projects.openFolder(standaloneFileProject.id, relativePath)}
                onOpenFolderInVscode={relativePath => void window.fm.projects.openFolderInVscode(standaloneFileProject.id, relativePath)}
            />
        );
    }

    const runAction = async (actionId: string) => {
        try {
            const result = await window.fm.actions.run(actionId, project.id);
            setActionsOpen(false);
            if (result.clipboard) actions.toast('success', `已复制：${result.clipboard}`);
            else actions.toast('success', '动作已启动');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '命令执行失败');
        }
    };

    const buildPatch = (): ProjectMetaPatch => ({
        name: form.name,
        description: form.description,
        tags: form.tags,
        ignore: form.ignore,
        favoriteFiles: form.favoriteFiles,
        syncRespectGitignore: form.syncRespectGitignore,
        fingerprint: form.fingerprint,
    });

    const doSave = async (writeFile: boolean, then: 'close' | 'keep') => {
        if (formDirty) {
            await actions.saveProject(project.id, buildPatch(), writeFile);
        }
        let shouldReload = false;
        if (commandsDirty) {
            try {
                await window.fm.projects.updateActions(
                    project.id,
                    splitActionDrafts(actionDrafts, Boolean(project.path.trim())),
                );
                shouldReload = true;
            } catch (error) {
                actions.toast('error', error instanceof Error ? error.message : '保存命令失败');
                return;
            }
        }
        if (syncRulesDirty) {
            try {
                const pendingRules = Object.entries(syncRuleOverrides).flatMap(([configId, rule]) =>
                    rule ? [[configId, rule] as const] : [],
                );
                for (const [configId, rule] of pendingRules) {
                    await window.fm.sync.setProjectRule(configId, project.id, rule);
                }
                setSyncRuleOverrides({});
                shouldReload = true;
            } catch (error) {
                actions.toast('error', error instanceof Error ? error.message : '保存同步规则失败');
                return;
            }
        }
        if (shouldReload) {
            await actions.loadConfig();
        }
        if (then === 'close') {
            setConfirmClose(false);
            actions.selectProject(undefined);
        }
    };

    const removeTag = (tag: string) => {
        setForm({ ...form, tags: form.tags.filter(item => item !== tag) });
    };

    const addTag = (raw: string) => {
        const tag = raw.trim().replace(/^#/, '');
        if (!tag || form.tags.includes(tag)) return;
        setForm({ ...form, tags: [...form.tags, tag] });
    };

    const updateIgnoreText = (value: string) => {
        setIgnoreText(value);
        setForm(current => current ? {
            ...current,
            ignore: parseIgnoreRules(value),
        } : current);
    };

    const saveDisabled = hasEmptyFileFingerprint(form);
    const saveButtonDisabled = saveDisabled || !isDirty;

    return (
        <>
            <DrawerPanelShell
                headerTabs={PROJECT_INFO_PANEL_VIEWS}
                activeTabId={activeView}
                onTabChange={tabId => setActiveView(tabId as ProjectInfoPanelViewId)}
                banner={matchExplanation || undefined}
                onClose={tryClose}
                panelClassName={filePanelMode ? 'shadow-xl' : undefined}
                edgeAccessory={filePanelMode === null ? (
                    <ProjectFilesPanelToggle onClick={() => setFilePanelMode('browse')} />
                ) : null}
                headerActions={(
                    <>
                        <div className="relative">
                            <Button
                                size="icon-xs"
                                variant="ghost"
                                title="项目命令"
                                onClick={() => setActionsOpen(value => !value)}
                            >
                                <Terminal className="size-3.5" />
                            </Button>
                            {actionsOpen ? (
                                <ProjectCommandMenu
                                    className="absolute right-0 top-full z-50 mt-1 w-56"
                                    project={project}
                                    globalActions={globalActions}
                                    presets={presets}
                                    onRunAction={actionId => void runAction(actionId)}
                                />
                            ) : null}
                        </div>
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            title="在资源管理器中显示"
                            onClick={() => void actions.revealProject(project.id)}
                        >
                            <FolderOpen className="size-3.5" />
                        </Button>
                        <Button size="icon-xs" variant="ghost" onClick={tryClose}>
                            <X className="size-3.5" />
                        </Button>
                    </>
                )}
                footer={(
                    <div className="flex items-center justify-end gap-3">
                        <Button size="sm" variant="outline" onClick={tryClose}>
                            取消
                        </Button>
                        <Button
                            size="sm"
                            variant={saveButtonDisabled ? 'outline' : 'default'}
                            disabled={saveButtonDisabled}
                            onClick={() => void doSave(false, 'close')}
                        >
                            <Save className="size-3.5" /> 保存
                        </Button>
                    </div>
                )}
            >
                {activeView === 'sync' ? (
                    <ProjectSyncView
                        path={form.path}
                        projectIgnore={form.ignore}
                        ignoreText={ignoreText}
                        onIgnoreTextChange={updateIgnoreText}
                        syncRespectGitignore={form.syncRespectGitignore}
                        onSyncRespectGitignoreChange={checked => setForm({
                            ...form,
                            syncRespectGitignore: checked,
                        })}
                        project={project}
                        allProjects={config.projects}
                        syncConfigs={config.syncConfigs ?? []}
                        ruleOverrides={syncRuleOverrides}
                        busyId={null}
                        onChangeRule={(configId, rule) => {
                            setSyncRuleOverrides(current =>
                                updateSyncRuleOverrides(current, config.syncConfigs ?? [], project.id, configId, rule),
                            );
                        }}
                    />
                ) : activeView === 'commands' ? (
                    <ProjectActionsView
                        actions={actionDrafts}
                        projectBound={Boolean(project.path.trim())}
                        onActionsChange={setActionDrafts}
                    />
                ) : (
                    <ProjectDetailsView
                        form={form}
                        onFormChange={setForm}
                        tagDefs={config.tags}
                        inspection={effectiveInspection}
                        validation={saveDisabled ? renderEmptyFingerprintValidation() : null}
                        tagSelectorMode={form.tags.length === 0 ? 'alwaysEdit' : 'editable'}
                        onAddTag={addTag}
                        onRemoveTag={removeTag}
                        onEditFileFingerprint={() => setFilePanelMode('select-fingerprint')}
                    />
                )}
            </DrawerPanelShell>

            {filePanelMode ? (
                <ProjectFilesSidePanel
                    mode={filePanelMode}
                    path={form.path}
                    projectIgnore={form.ignore}
                    initialInspection={inspection ?? effectiveInspection}
                    selectedPaths={form.fingerprint.kind === 'file-paths' ? form.fingerprint.paths : []}
                    favoriteFiles={form.favoriteFiles}
                    onFavoriteFilesChange={paths => setForm(current => current ? {
                        ...current,
                        favoriteFiles: paths,
                    } : current)}
                    onClose={() => setFilePanelMode(null)}
                    onOpenFile={relativePath => void window.fm.projects.openFile(project.id, relativePath)}
                    onOpenFileWith={relativePath => void window.fm.projects.openFileWith(project.id, relativePath)}
                    onOpenFolder={relativePath => void window.fm.projects.openFolder(project.id, relativePath)}
                    onOpenFolderInVscode={relativePath => void window.fm.projects.openFolderInVscode(project.id, relativePath)}
                    onConfirmSelection={paths => {
                        setForm(current => current ? {
                            ...current,
                            fingerprint: { kind: 'file-paths', paths },
                        } : current);
                        setFilePanelMode(null);
                    }}
                />
            ) : null}

            {confirmClose ? (
                <UnsavedConfirmDialog
                    onCancel={() => setConfirmClose(false)}
                    onDiscard={() => {
                        setConfirmClose(false);
                        actions.selectProject(undefined);
                    }}
                    onSave={() => void doSave(project.hasMetaFile, 'close')}
                />
            ) : null}
        </>
    );
}

function parseIgnoreRules(value: string): string[] {
    return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
}

function UnsavedConfirmDialog({
    onCancel,
    onDiscard,
    onSave,
}: {
    onCancel: () => void;
    onDiscard: () => void;
    onSave: () => void;
}) {
    return (
        <>
            <button
                type="button"
                aria-label="取消"
                onClick={onCancel}
                className="fixed inset-0 z-60 cursor-default bg-black/40 backdrop-blur-[1px]"
            />
            <div
                role="dialog"
                aria-modal="true"
                className="fixed top-1/2 left-1/2 z-70 w-90 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            >
                <div className="px-4 pt-4 pb-2">
                    <h2 className="text-heading">尚未保存的修改</h2>
                    <p className="mt-2 text-note text-muted-foreground">是否在关闭前保存这些修改？</p>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border bg-card/80 px-4 py-3">
                    <Button size="sm" variant="ghost" onClick={onDiscard}>
                        不保存
                    </Button>
                    <Button size="sm" variant="outline" onClick={onCancel}>
                        取消
                    </Button>
                    <Button size="sm" onClick={onSave}>
                        保存
                    </Button>
                </div>
            </div>
        </>
    );
}

function sameFingerprint(a: ProjectMetaPatch['fingerprint'], b: ProjectMetaPatch['fingerprint']): boolean {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'metadata' && b.kind === 'metadata') return true;
    if (a.kind === 'folder-name' && b.kind === 'folder-name') return a.folderName === b.folderName;
    if (a.kind === 'file-paths' && b.kind === 'file-paths') {
        return a.paths.length === b.paths.length && a.paths.every((item, index) => item === b.paths[index]);
    }
    return false;
}
