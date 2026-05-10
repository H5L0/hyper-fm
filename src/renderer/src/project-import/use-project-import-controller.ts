import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    ManualProjectInput,
    ManualProjectValidationResult,
    ProjectDirectoryInspection,
    SyncProjectRule,
} from '@shared/bridge.js';
import { useAppActions, useAppState } from '@/store/app-store.js';
import type { ProjectFormValue } from '@/components/view/project-info-panel/project-details-view.js';
import type { BatchImportItem } from './types.js';
import {
    affectsValidation,
    createBatchImportItem,
    createEmptyProjectForm,
    hasEmptyFileFingerprint,
    normalizeBatchPath,
    refreshBatchItemSnapshot,
    refreshBatchItemsValidation,
    resolveDraftRootId,
    toManualProjectInput,
    updateBatchItem,
    parseIgnoreRules,
} from './helpers.js';

export function useProjectImportController() {
    const { config } = useAppState();
    const actions = useAppActions();

    const [addOpen, setAddOpen] = useState(false);
    const [mode, setMode] = useState<'new' | 'import'>('new');
    const [form, setForm] = useState<ProjectFormValue>(createEmptyProjectForm());
    const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
    const [validation, setValidation] = useState<ManualProjectValidationResult>({ valid: false, conflicts: [] });
    const [draftSyncRules, setDraftSyncRules] = useState<Partial<Record<string, SyncProjectRule>>>({});
    const [busy, setBusy] = useState(false);
    const pathBaseRef = useRef<{ basePath: string } | null>(null);

    const [batchOpen, setBatchOpen] = useState(false);
    const [batchItems, setBatchItems] = useState<BatchImportItem[]>([]);
    const [batchBusy, setBatchBusy] = useState(false);
    const [editingBatchItemId, setEditingBatchItemId] = useState<string | null>(null);
    const [batchTemplateTags, setBatchTemplateTags] = useState<string[]>([]);
    const [batchTemplateIgnoreText, setBatchTemplateIgnoreText] = useState('');

    const draftProjectRootId = useMemo(
        () => resolveDraftRootId(form.path, config.scanRoots),
        [config.scanRoots, form.path],
    );

    const editingBatchItem = useMemo(
        () => editingBatchItemId ? batchItems.find(item => item.id === editingBatchItemId) ?? null : null,
        [batchItems, editingBatchItemId],
    );

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

    useEffect(() => {
        if (!addOpen || !form.path.trim()) return;
        void window.fm.projects.inspectDirectory(form.path.trim(), form.ignore).then(setInspection).catch(() => setInspection(null));
    }, [addOpen, form.path, form.ignore]);

    useEffect(() => {
        if (!addOpen || !form.path.trim()) return;
        void validate();
    }, [addOpen, form]);

    useEffect(() => {
        if (!addOpen || !pathBaseRef.current) return;
        const name = form.name.trim();
        if (!name) return;
        const basePath = pathBaseRef.current.basePath;
        const newPath = `${basePath}/${name}`;
        setForm(prev => (prev.path === newPath ? prev : { ...prev, path: newPath }));
    }, [addOpen, form.name]);

    const openAddProject = async () => {
        setForm(createEmptyProjectForm());
        setInspection(null);
        setValidation({ valid: false, conflicts: [] });
        setDraftSyncRules({});
        setMode('import');
        pathBaseRef.current = null;
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
        pathBaseRef.current = null;
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

    const openNewProject = () => {
        setForm(createEmptyProjectForm());
        setInspection(null);
        setValidation({ valid: false, conflicts: [] });
        setDraftSyncRules({});
        setMode('new');
        pathBaseRef.current = null;
        setAddOpen(true);
    };

    const browseParentDir = async () => {
        const dir = await actions.pickProjectDirectory();
        if (!dir) return;
        const basePath = dir.replace(/\/+$/, '');
        pathBaseRef.current = { basePath };
        const name = form.name.trim();
        setForm(prev => ({ ...prev, path: name ? `${basePath}/${name}` : basePath }));
    };

    const setPathFromScanRoot = (rootPath: string) => {
        const basePath = rootPath.replace(/\/+$/, '');
        pathBaseRef.current = { basePath };
        const name = form.name.trim();
        setForm(prev => ({ ...prev, path: name ? `${basePath}/${name}` : basePath }));
    };

    const closeAddProject = () => {
        setAddOpen(false);
        setDraftSyncRules({});
    };

    const submitProject = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const project = await actions.addProject(toManualProjectInput(form));
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
                    closeAddProject();
                    setForm(createEmptyProjectForm());
                    setInspection(null);
                    setValidation({ valid: false, conflicts: [] });
                    return;
                }
            }
            actions.toast('success', `已添加项目：${project.name}`);
            closeAddProject();
            setForm(createEmptyProjectForm());
            setInspection(null);
            setValidation({ valid: false, conflicts: [] });
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '添加失败');
        } finally {
            setBusy(false);
        }
    };

    const openBatchImport = async () => {
        if (batchBusy) return;
        const directories = await actions.pickProjectDirectories();
        const uniqueDirectories = [...new Set(directories.map(normalizeBatchPath).filter(Boolean))];
        if (uniqueDirectories.length === 0) return;

        setBatchBusy(true);
        setEditingBatchItemId(null);
        setBatchTemplateTags([]);
        setBatchTemplateIgnoreText('');
        try {
            const nextItems = await Promise.all(uniqueDirectories.map(directory => createBatchImportItem(directory)));
            setBatchItems(await refreshBatchItemsValidation(nextItems));
            setBatchOpen(true);
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '批量添加初始化失败');
        } finally {
            setBatchBusy(false);
        }
    };

    const importBatchItem = async (itemId: string) => {
        const target = batchItems.find(item => item.id === itemId);
        if (!target || batchBusy) return;

        setBatchBusy(true);
        let nextItems = updateBatchItem(batchItems, itemId, { status: 'importing', error: undefined });
        setBatchItems(nextItems);
        try {
            const project = await actions.addProject(toManualProjectInput(target.form));
            nextItems = updateBatchItem(nextItems, itemId, { status: 'imported', error: undefined });
            nextItems = await refreshBatchItemsValidation(nextItems);
            setBatchItems(nextItems);
            if (editingBatchItemId === itemId) {
                setEditingBatchItemId(null);
            }
            actions.toast('success', `已添加项目：${project.name}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : '添加失败';
            nextItems = updateBatchItem(nextItems, itemId, { status: 'failed', error: message });
            nextItems = await refreshBatchItemsValidation(nextItems);
            setBatchItems(nextItems);
            actions.toast('error', message);
        } finally {
            setBatchBusy(false);
        }
    };

    const importAllReadyBatchItems = async () => {
        if (batchBusy) return;

        setBatchBusy(true);
        let nextItems = await refreshBatchItemsValidation(batchItems);
        setBatchItems(nextItems);
        let importedCount = 0;
        let failedCount = 0;

        for (const candidate of nextItems) {
            const current = nextItems.find(item => item.id === candidate.id);
            if (!current) continue;
            const ready = current.status !== 'imported' && current.validation.valid && !hasEmptyFileFingerprint(current.form);
            if (!ready) continue;

            nextItems = updateBatchItem(nextItems, current.id, { status: 'importing', error: undefined });
            setBatchItems(nextItems);
            try {
                await actions.addProject(toManualProjectInput(current.form));
                importedCount += 1;
                nextItems = updateBatchItem(nextItems, current.id, { status: 'imported', error: undefined });
            } catch (error) {
                failedCount += 1;
                nextItems = updateBatchItem(nextItems, current.id, {
                    status: 'failed',
                    error: error instanceof Error ? error.message : '添加失败',
                });
            }
            nextItems = await refreshBatchItemsValidation(nextItems);
            setBatchItems(nextItems);
        }

        if (editingBatchItemId && nextItems.every(item => item.id !== editingBatchItemId || item.status === 'imported')) {
            setEditingBatchItemId(null);
        }

        if (importedCount > 0) {
            actions.toast('success', `批量添加完成：成功 ${importedCount} 个${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}`);
        } else {
            actions.toast('info', failedCount > 0 ? `没有成功添加的项目，失败 ${failedCount} 个` : '当前没有可直接添加的项目');
        }
        setBatchBusy(false);
    };

    const updateEditingBatchForm = (nextForm: ProjectFormValue) => {
        if (!editingBatchItem) return;
        const shouldRefreshValidation = affectsValidation(editingBatchItem.form, nextForm);
        const optimisticItems = batchItems.map(item => (item.id === editingBatchItem.id ? { ...item, form: nextForm, error: undefined } : item));
        setBatchItems(optimisticItems);
        if (shouldRefreshValidation) {
            void refreshBatchItemSnapshot(editingBatchItem, nextForm)
                .then(refreshedItem => optimisticItems.map(item => (item.id === refreshedItem.id ? refreshedItem : item)))
                .then(refreshBatchItemsValidation)
                .then(setBatchItems);
        }
    };

    const applyBatchTemplate = async () => {
        if (batchBusy || batchItems.length === 0) return;
        setBatchBusy(true);
        try {
            const ignore = parseIgnoreRules(batchTemplateIgnoreText);
            const nextItems = await Promise.all(batchItems.map(async item => {
                if (item.status === 'imported') return item;
                const nextForm: ProjectFormValue = {
                    ...item.form,
                    tags: [...batchTemplateTags],
                    ignore,
                };
                return refreshBatchItemSnapshot(item, nextForm);
            }));
            setBatchItems(await refreshBatchItemsValidation(nextItems));
            actions.toast('success', '已将批量模板应用到未添加项');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '应用批量模板失败');
        } finally {
            setBatchBusy(false);
        }
    };

    const removeBatchItem = (itemId: string) => {
        setBatchItems(current => current.filter(item => item.id !== itemId));
        setEditingBatchItemId(current => (current === itemId ? null : current));
    };

    const closeBatchImport = () => {
        setBatchOpen(false);
        setEditingBatchItemId(null);
        setBatchItems([]);
        setBatchTemplateTags([]);
        setBatchTemplateIgnoreText('');
    };

    return {
        addProject: {
            isOpen: addOpen,
            mode,
            form,
            inspection,
            validation,
            busy,
            draftSyncRules,
            draftProjectRootId,
            setForm,
            close: closeAddProject,
            open: openAddProject,
            openNew: openNewProject,
            browsePath: browseProjectDir,
            browseParentPath: browseParentDir,
            setPathFromScanRoot,
            commitPath: commitProjectPath,
            submit: submitProject,
            setSyncRule: (configId: string, rule: SyncProjectRule) => {
                setDraftSyncRules(current => ({
                    ...current,
                    [configId]: rule,
                }));
            },
            addTag: (tag: string) => setForm(prev => ({
                ...prev,
                tags: prev.tags.includes(tag) ? prev.tags : [...prev.tags, tag],
            })),
            removeTag: (tag: string) => setForm(prev => ({ ...prev, tags: prev.tags.filter(item => item !== tag) })),
        },
        batchProject: {
            isOpen: batchOpen,
            items: batchItems,
            busy: batchBusy,
            editingItem: editingBatchItem,
            templateTags: batchTemplateTags,
            templateIgnoreText: batchTemplateIgnoreText,
            open: openBatchImport,
            close: closeBatchImport,
            openOverride: (itemId: string) => setEditingBatchItemId(itemId),
            closeOverride: () => setEditingBatchItemId(null),
            importAll: importAllReadyBatchItems,
            importOne: importBatchItem,
            removeOne: removeBatchItem,
            updateOverrideForm: updateEditingBatchForm,
            setTemplateIgnoreText: setBatchTemplateIgnoreText,
            addTemplateTag: (tag: string) => setBatchTemplateTags(current => current.includes(tag) ? current : [...current, tag]),
            removeTemplateTag: (tag: string) => setBatchTemplateTags(current => current.filter(item => item !== tag)),
            applyTemplate: applyBatchTemplate,
        },
    };
}