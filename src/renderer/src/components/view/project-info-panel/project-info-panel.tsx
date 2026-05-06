import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FolderOpen, Save, Terminal, X } from 'lucide-react';
import type {
    CustomCommand,
    ManualProjectValidationResult,
    PresetCommandDescriptor,
    Project,
    ProjectDirectoryInspection,
    ProjectMetaPatch,
    SyncConfig,
    SyncProjectRule,
    TagDefinition,
} from '@shared/bridge.js';
import { explainMatch, matchProject, parseSearchQuery } from '@shared/search.js';
import { Button } from '@/components/ui/button';
import { DrawerPanelShell } from '@/components/basic/drawer-panel-shell.js';
import { useAppActions, useAppState } from '@/store/app-store.js';
import { ProjectFormValue, ProjectDetailsView } from './project-details-view.js';
import { ProjectFilesView } from './project-files-view.js';
import { ProjectSyncView, readProjectRule } from './project-sync-view.js';

export type ProjectInfoPanelViewId = 'info' | 'files' | 'sync';

type SyncRuleOverrides = Partial<Record<string, SyncProjectRule>>;

const PROJECT_INFO_PANEL_VIEWS: ReadonlyArray<{ id: ProjectInfoPanelViewId; label: string }> = [
    { id: 'info', label: '信息' },
    { id: 'files', label: '文件' },
    { id: 'sync', label: '同步' },
];

type FormState = ProjectFormValue;

function projectToForm(project: Project): FormState {
    return {
        path: project.path,
        name: project.name,
        description: project.description ?? '',
        tags: [...project.tags],
        ignore: [...project.ignore],
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
    if (a.syncRespectGitignore !== b.syncRespectGitignore) return false;
    if (!sameFingerprint(a.fingerprint, b.fingerprint)) return false;
    if (a.tags.length !== b.tags.length) return false;
    for (let index = 0; index < a.tags.length; index++) {
        if (a.tags[index] !== b.tags[index]) return false;
    }
    return true;
}

function hasEmptyFileFingerprint(form: ProjectFormValue): boolean {
    return form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.length === 0;
}

function renderInspectionHint(inspection: ProjectDirectoryInspection | null) {
    if (!inspection) return null;
    return (
        <p className="text-note text-muted-foreground">
            {inspection.hasMetaFile
                ? `检测到 .meta-data${inspection.metaProjectId ? `（projectId: ${inspection.metaProjectId}）` : ''}`
                : `共发现 ${inspection.files.length} 个文件，可用于文件列表指纹。`}
        </p>
    );
}

function renderConflictValidation(validation: ManualProjectValidationResult) {
    if (validation.valid || validation.conflicts.length === 0) return null;
    return (
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
    onSyncRuleChange,
    onAddTag,
    onRemoveTag,
}: {
    open: boolean;
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
    onSyncRuleChange: (configId: string, rule: SyncProjectRule) => void;
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
}) {
    const [activeView, setActiveView] = useState<ProjectInfoPanelViewId>('info');
    const [ignoreText, setIgnoreText] = useState(form.ignore.join('\n'));

    useEffect(() => {
        if (!open) return;
        setActiveView('info');
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
        <DrawerPanelShell
            title="添加文件夹"
            headerTabs={PROJECT_INFO_PANEL_VIEWS}
            activeTabId={activeView}
            onTabChange={tabId => setActiveView(tabId as ProjectInfoPanelViewId)}
            onClose={onClose}
            headerActions={
                <Button size="icon-xs" variant="ghost" onClick={onClose}>
                    <X className="size-3.5" />
                </Button>
            }
            footer={
                <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={submitDisabled} onClick={onSubmit}>
                        添加
                    </Button>
                </div>
            }
        >
            {activeView === 'files' ? (
                <ProjectFilesView
                    tree={effectiveInspection?.tree ?? []}
                    ignoreText={ignoreText}
                    onIgnoreTextChange={updateIgnoreText}
                />
            ) : activeView === 'sync' ? (
                <ProjectSyncView
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
                    onPickPath={onPickPath}
                    onPathCommit={onPathCommit}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                />
            )}
        </DrawerPanelShell>
    );
}

export function ProjectInfoPanel() {
    const { selectedProjectId, config, search } = useAppState();
    const actions = useAppActions();
    const project = useMemo(
        () => config.projects.find(item => item.id === selectedProjectId),
        [config.projects, selectedProjectId],
    );

    const [form, setForm] = useState<FormState | null>(project ? projectToForm(project) : null);
    const [initial, setInitial] = useState<FormState | null>(project ? projectToForm(project) : null);
    const [presets, setPresets] = useState<PresetCommandDescriptor[]>([]);
    const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);
    const [commandsOpen, setCommandsOpen] = useState(false);
    const [confirmClose, setConfirmClose] = useState(false);
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
    const [activeView, setActiveView] = useState<ProjectInfoPanelViewId>('info');
    const [ignoreText, setIgnoreText] = useState(project ? project.ignore.join('\n') : '');
    const [syncRuleOverrides, setSyncRuleOverrides] = useState<SyncRuleOverrides>({});

    useEffect(() => {
        const next = project ? projectToForm(project) : null;
        setForm(next);
        setInitial(next);
        setIgnoreText(next?.ignore.join('\n') ?? '');
    }, [project]);

    useEffect(() => {
        setCommandsOpen(false);
        setConfirmClose(false);
        setActiveView('info');
        setSyncRuleOverrides({});
    }, [project?.id]);

    useEffect(() => {
        if (!form?.path) {
            setInspection(null);
            return;
        }
        void window.fm.projects.inspectDirectory(form.path, form.ignore).then(setInspection).catch(() => setInspection(null));
    }, [form?.ignore, form?.path]);

    useEffect(() => {
        if (!inspection) return;
        setForm(current => {
            if (!current || current.fingerprint.kind !== 'file-paths') return current;
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

    const isDirty = formDirty || syncRulesDirty;

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
        void window.fm.commands.presets().then(setPresets);
        void window.fm.commands.list().then(setCustomCommands);
    }, []);

    const matchExplanation = useMemo(() => {
        if (!project || !search.trim()) return '';
        const query = parseSearchQuery(search);
        const explain = matchProject(project, query);
        return explain ? explainMatch(explain) : '';
    }, [project, search]);

    if (!project || !form) return null;

    const runCommand = async (commandId: string) => {
        try {
            const result = await window.fm.commands.run(commandId, project.id);
            setCommandsOpen(false);
            if (result.clipboard) actions.toast('success', `已复制：${result.clipboard}`);
            else actions.toast('success', '命令已启动');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '命令执行失败');
        }
    };

    const buildPatch = (): ProjectMetaPatch => ({
        name: form.name,
        description: form.description,
        tags: form.tags,
        ignore: form.ignore,
        syncRespectGitignore: form.syncRespectGitignore,
        fingerprint: form.fingerprint,
    });

    const doSave = async (writeFile: boolean, then: 'close' | 'keep') => {
        if (formDirty) {
            await actions.saveProject(project.id, buildPatch(), writeFile);
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
                await actions.loadConfig();
            } catch (error) {
                actions.toast('error', error instanceof Error ? error.message : '保存同步规则失败');
                return;
            }
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
    const effectiveInspection = inspection ?? {
        path: project.path,
        suggestedName: project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.name,
        hasMetaFile: project.hasMetaFile,
        metaProjectId: project.id,
        tree: [],
        files: project.fingerprint.kind === 'file-paths' ? project.fingerprint.paths : [],
    } satisfies ProjectDirectoryInspection;

    return (
        <>
            <DrawerPanelShell
                headerTabs={PROJECT_INFO_PANEL_VIEWS}
                activeTabId={activeView}
                onTabChange={tabId => setActiveView(tabId as ProjectInfoPanelViewId)}
                banner={matchExplanation || undefined}
                onClose={tryClose}
                headerActions={(
                    <>
                        <div className="relative">
                            <Button
                                size="icon-xs"
                                variant="ghost"
                                title="项目命令"
                                onClick={() => setCommandsOpen(value => !value)}
                            >
                                <Terminal className="size-3.5" />
                            </Button>
                            {commandsOpen ? (
                                <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
                                    {presets.map(preset => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => void runCommand(preset.id)}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                    {customCommands.length > 0 ? (
                                        <>
                                            <div className="my-1 border-t border-border" />
                                            {customCommands.map(command => (
                                                <button
                                                    key={command.id}
                                                    type="button"
                                                    onClick={() => void runCommand(command.id)}
                                                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                                    title={command.description ?? command.command}
                                                >
                                                    <ChevronDown className="size-3 shrink-0 opacity-0" />
                                                    {command.label}
                                                </button>
                                            ))}
                                        </>
                                    ) : null}
                                </div>
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
                {activeView === 'files' ? (
                    <ProjectFilesView
                        tree={inspection?.tree ?? []}
                        ignoreText={ignoreText}
                        onIgnoreTextChange={updateIgnoreText}
                    />
                ) : activeView === 'sync' ? (
                    <ProjectSyncView
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
                ) : (
                    <ProjectDetailsView
                        form={form}
                        onFormChange={setForm}
                        tagDefs={config.tags}
                        inspection={effectiveInspection}
                        validation={saveDisabled ? renderEmptyFingerprintValidation() : null}
                        onAddTag={addTag}
                        onRemoveTag={removeTag}
                    />
                )}
            </DrawerPanelShell>

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
