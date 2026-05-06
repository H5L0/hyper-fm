import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, FolderOpen, FolderRoot, GitCompareArrows, Plus, Server, Upload } from 'lucide-react';
import type {
    DeviceRegistry,
    Project,
    ScanRoot,
    SyncApplyResult,
    SyncConfig,
    SyncImportTarget,
    SyncPlanApplyRequest,
    SyncPlanPreview,
    SyncPlanPreviewSession,
    SyncProjectEntry,
    SyncProjectRule,
} from '@shared/bridge.js';
import { createScopedSyncConfig, normalizeSyncConfig, resolveSyncProjectIds } from '@shared/sync-config.js';
import {
    type SyncConfigScope,
    type SyncConfigType,
    type SyncMode,
} from '@shared/sync-types.js';
import { AddableList, AddableListEmpty, AddableListItem } from '@/components/ui/addable-list';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import {
    SegmentedToggleGroup,
    type SegmentedToggleOption,
} from '@/components/ui/segmented-toggle-group';
import { SettingSection } from '@/components/ui/setting-section';
import { TriStateRuleButton, getNextTriStateRule } from '@/components/ui/tri-state-rule-button';
import { SyncConfigSummaryCard } from './sync-config-card.js';
import { SyncPlanDialog } from './sync-plan-dialog.js';
import { SyncPlanStaticDialog } from './sync-plan-static-dialog.js';
import { useAppActions, useAppState } from '../../store/app-store.js';

const SCOPE_OPTIONS: SegmentedToggleOption[] = [
    {
        value: 'shared',
        label: '共享配置',
        description: '写入 fm.shared.json',
    },
    {
        value: 'local',
        label: '本地配置',
        description: '写入 fm.local.json',
    },
];

const TYPE_OPTIONS: SegmentedToggleOption[] = [
    {
        value: 'folder',
        label: '文件夹',
        description: '适合本机或挂载目录镜像',
        icon: <FolderOpen className="size-4" />,
    },
    {
        value: 'zip',
        label: 'ZIP',
        description: '适合备份与离线导入',
        icon: <Download className="size-4" />,
    },
    {
        value: 'shared-dir',
        label: '共享目录',
        description: '适合共享盘同步',
        icon: <Upload className="size-4" />,
    },
    {
        value: 'p2p',
        label: 'P2P',
        description: '适合局域网持续同步',
        icon: <Server className="size-4" />,
    },
];

const MODE_OPTIONS: SegmentedToggleOption[] = [
    {
        value: 'two-way',
        label: '双向同步',
        description: '两侧互相合并变化',
    },
    {
        value: 'mirror-local-to-target',
        label: '本地到目标',
        description: '以本地为准镜像覆盖',
    },
    {
        value: 'mirror-target-to-local',
        label: '目标到本地',
        description: '以目标为准镜像覆盖',
    },
];

type TargetListKey = 'projectIds' | 'ignoredProjectIds' | 'rootIds' | 'ignoredRootIds';
type PreviewableSyncConfig = Extract<SyncConfig, { type: 'folder' }> | Extract<SyncConfig, { type: 'shared-dir' }>;
type ActiveSyncPlanPreview = {
    config: PreviewableSyncConfig;
    session: SyncPlanPreviewSession;
    persistOnApply: boolean;
};

function moveItemToIndex<T extends { id: string }>(items: readonly T[], activeId: string, targetIndex: number): T[] | null {
    if (!activeId) {
        return null;
    }

    const fromIndex = items.findIndex(item => item.id === activeId);
    if (fromIndex < 0) {
        return null;
    }

    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    const insertIndex = Math.max(0, Math.min(targetIndex, next.length));
    if (fromIndex === insertIndex) {
        return null;
    }
    next.splice(insertIndex, 0, moved!);
    return next;
}

export function SyncConfigPanel() {
    const { config } = useAppState();
    const actions = useAppActions();
    const syncConfigs = config.syncConfigs ?? [];
    const [device, setDevice] = useState<DeviceRegistry | null>(null);
    const [deviceNameDraft, setDeviceNameDraft] = useState('');
    const [editingConfig, setEditingConfig] = useState<SyncConfig | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [serverRunning, setServerRunning] = useState<Record<string, boolean>>({});
    const [syncPlanPreview, setSyncPlanPreview] = useState<ActiveSyncPlanPreview | null>(null);
    const [zipImportSetup, setZipImportSetup] = useState<{
        config: Extract<SyncConfig, { type: 'zip' }>;
        file: string;
        entries: SyncProjectEntry[];
    } | null>(null);
    const [zipImportPlanPreview, setZipImportPlanPreview] = useState<{
        config: Extract<SyncConfig, { type: 'zip' }>;
        file: string;
        targets: SyncImportTarget[];
        preview: SyncPlanPreview;
    } | null>(null);

    useEffect(() => {
        void window.fm.sync.getDevice().then(setDevice);
    }, []);

    useEffect(() => {
        setDeviceNameDraft(device?.selfName ?? '');
    }, [device?.selfName]);

    useEffect(() => {
        const p2pConfigs = syncConfigs.filter(item => item.type === 'p2p');
        if (p2pConfigs.length === 0) {
            setServerRunning({});
            return;
        }
        void Promise.all(
            p2pConfigs.map(async item => [item.id, await window.fm.sync.isServerRunning(item.id)] as const),
        ).then(entries => {
            setServerRunning(Object.fromEntries(entries));
        });
    }, [syncConfigs]);

    useEffect(() => window.fm.sync.onSyncPreviewEvent(event => {
        setSyncPlanPreview(current => {
            if (!current || current.session.sessionId !== event.sessionId) {
                return current;
            }
            if (event.type === 'session-closed') {
                return null;
            }
            if (!event.session) {
                return current;
            }
            return {
                ...current,
                session: event.session,
            };
        });
    }), []);

    const existingConfigIds = useMemo(() => new Set(syncConfigs.map(item => item.id)), [syncConfigs]);
    const syncConfigById = useMemo(() => new Map(syncConfigs.map(item => [item.id, item])), [syncConfigs]);
    const includedProjectCounts = useMemo(
        () => Object.fromEntries(syncConfigs.map(item => [item.id, resolveSyncProjectIds(item, config.projects).length])),
        [config.projects, syncConfigs],
    );

    const refreshConfig = async () => {
        await actions.loadConfig();
    };

    const saveSyncConfig = async (draft: SyncConfig) => {
        const normalized = normalizeSyncConfig(draft);
        setBusyKey(`save:${normalized.id}`);
        try {
            await window.fm.sync.upsertConfig(normalized);
            await refreshConfig();
            setEditingConfig(null);
            actions.toast('success', existingConfigIds.has(normalized.id) ? '已更新同步配置' : '已添加同步配置');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '保存同步配置失败');
        } finally {
            setBusyKey(null);
        }
    };

    const removeSyncConfig = async (syncConfig: SyncConfig) => {
        if (!window.confirm(`确认删除同步配置“${syncConfig.name}”？`)) return;
        setBusyKey(`remove:${syncConfig.id}`);
        try {
            await window.fm.sync.removeConfig(syncConfig.id);
            await refreshConfig();
            actions.toast('success', '已删除同步配置');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '删除同步配置失败');
        } finally {
            setBusyKey(null);
        }
    };

    const pickDirectoryForConfig = async (syncConfig: SyncConfig) => {
        const title = syncConfig.type === 'folder' ? '选择目标目录' : '选择共享目录';
        const dir = await window.fm.sync.pickDirectory(title);
        if (!dir) return;
        if (syncConfig.type === 'folder') {
            await saveSyncConfig({
                ...syncConfig,
                folder: { ...syncConfig.folder, targetDir: dir },
            });
            return;
        }
        if (syncConfig.type === 'shared-dir') {
            await saveSyncConfig({
                ...syncConfig,
                sharedDir: { ...syncConfig.sharedDir, bundleDir: dir },
            });
        }
    };

    const exportZip = async (syncConfig: Extract<SyncConfig, { type: 'zip' }>) => {
        const file = await window.fm.sync.pickExportFile();
        if (!file) return;
        setBusyKey(`export:${syncConfig.id}`);
        try {
            const result = await window.fm.sync.exportZip(syncConfig.id, config.projects.map(item => item.id), file);
            await refreshConfig();
            actions.toast('success', `已导出 ${result.projects} 个项目到 ${result.outputFile}`);
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '导出失败');
        } finally {
            setBusyKey(null);
        }
    };

    const importZip = async (syncConfig: Extract<SyncConfig, { type: 'zip' }>) => {
        const file = await window.fm.sync.pickImportFile();
        if (!file) return;
        setBusyKey(`import:${syncConfig.id}`);
        try {
            const preview = await window.fm.sync.previewZip(file);
            setZipImportSetup({
                config: syncConfig,
                file,
                entries: preview.entries,
            });
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '预览失败');
        } finally {
            setBusyKey(null);
        }
    };

    const toggleServer = async (syncConfig: Extract<SyncConfig, { type: 'p2p' }>) => {
        setBusyKey(`server:${syncConfig.id}`);
        try {
            if (serverRunning[syncConfig.id]) {
                await window.fm.sync.stopServer(syncConfig.id);
                setServerRunning(current => ({ ...current, [syncConfig.id]: false }));
                actions.toast('success', '已停止监听');
            } else {
                const result = await window.fm.sync.startServer(syncConfig.id);
                setServerRunning(current => ({ ...current, [syncConfig.id]: true }));
                actions.toast('success', `监听已启动：端口 ${result.port}`);
            }
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '启动失败');
        } finally {
            setBusyKey(null);
        }
    };

    const previewSyncPlan = async (syncConfig: PreviewableSyncConfig) => {
        setBusyKey(`preview:${syncConfig.id}`);
        try {
            if (syncPlanPreview) {
                await window.fm.sync.closeSyncPreview(syncPlanPreview.session.sessionId);
            }
            const savedConfig = syncConfigById.get(syncConfig.id);
            const persistOnApply = !savedConfig || !areSyncConfigValuesEqual(savedConfig, syncConfig);
            const session = syncConfig.type === 'folder'
                ? await window.fm.sync.openFolderSyncPreview(syncConfig.id, undefined, syncConfig)
                : await window.fm.sync.openSharedDirSyncPreview(syncConfig.id, undefined, syncConfig);
            setSyncPlanPreview({ config: syncConfig, session, persistOnApply });
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '预览失败');
        } finally {
            setBusyKey(null);
        }
    };

    const reorderSyncConfigs = async (activeId: string, targetIndex: number) => {
        const nextConfigs = moveItemToIndex(syncConfigs, activeId, targetIndex);
        if (!nextConfigs) return;

        setBusyKey(`reorder:${activeId}`);
        try {
            await window.fm.config.save({ ...config, syncConfigs: nextConfigs });
            await refreshConfig();
            actions.toast('success', '已调整同步配置顺序');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '调整顺序失败');
        } finally {
            setBusyKey(null);
        }
    };

    const closeSyncPlanPreview = async (state: ActiveSyncPlanPreview | null) => {
        if (!state) return;
        setSyncPlanPreview(current => (current?.session.sessionId === state.session.sessionId ? null : current));
        try {
            await window.fm.sync.closeSyncPreview(state.session.sessionId);
        } catch {
            // 关闭预览失败时不阻塞 UI，最多只是留下一次性会话缓存。
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-10">
            <SettingSection title="本机设备">
                <div className="flex flex-wrap items-center gap-2.5">
                    <input
                        disabled={!device}
                        value={device ? deviceNameDraft : ''}
                        autoComplete="off"
                        onChange={event => setDeviceNameDraft(event.target.value)}
                        onBlur={async event => {
                            if (!device) {
                                return;
                            }
                            const name = event.target.value.trim();
                            if (!name) {
                                setDeviceNameDraft(device.selfName);
                                return;
                            }
                            if (name !== device.selfName) {
                                const next = await window.fm.sync.setSelfName(name);
                                setDevice(next);
                                await refreshConfig();
                            }
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.currentTarget.blur();
                            }
                        }}
                        className="h-9 min-w-55 flex-1 rounded-lg border border-border bg-background px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                    <span className="text-note text-muted-foreground">{device ? device.selfId : '加载中…'}</span>
                </div>
            </SettingSection>

            <SettingSection title="同步配置">
                <AddableList
                    addIcon={<Plus className="size-4" />}
                    addLabel="添加同步配置"
                    onAdd={() => setEditingConfig(createScopedSyncConfig('shared-dir', 'local'))}
                    footerEnd={<ListMetaBadge>{syncConfigs.length} 条配置</ListMetaBadge>}
                    divided={false}
                    sortable={{
                        itemIds: syncConfigs.map(syncConfig => syncConfig.id),
                        onReorder: (activeId, targetIndex) => reorderSyncConfigs(activeId, targetIndex),
                    }}
                >
                    {syncConfigs.length === 0 ? (
                        <AddableListEmpty className="rounded-[calc(var(--addable-list-radius)-0.25rem)] border border-dashed border-border bg-muted/10">
                            <p className="text-body text-foreground">还没有同步配置</p>
                            <p className="mt-1 text-note text-muted-foreground">
                                先添加一条配置，再决定它是共享目录、ZIP、文件夹还是 P2P。
                            </p>
                        </AddableListEmpty>
                    ) : (
                        syncConfigs.map(syncConfig => {
                            const busy = busyKey?.includes(syncConfig.id) ?? false;
                            const onPickDirectory = () => void pickDirectoryForConfig(syncConfig);
                            const onCompareAndSync = syncConfig.type === 'folder' || syncConfig.type === 'shared-dir'
                                ? () => void previewSyncPlan(syncConfig)
                                : undefined;
                            const onExportZip = syncConfig.type === 'zip' ? () => void exportZip(syncConfig) : undefined;
                            const onImportZip = syncConfig.type === 'zip' ? () => void importZip(syncConfig) : undefined;
                            const onToggleServer = syncConfig.type === 'p2p' ? () => void toggleServer(syncConfig) : undefined;

                            return (
                                <AddableListItem
                                    key={syncConfig.id}
                                    itemId={syncConfig.id}
                                    showGrabHandle
                                >
                                    <SyncConfigSummaryCard
                                        syncConfig={syncConfig}
                                        includedProjectCount={includedProjectCounts[syncConfig.id] ?? 0}
                                        chromeless
                                        busy={busy}
                                        onEdit={() => setEditingConfig(syncConfig)}
                                        onDelete={() => void removeSyncConfig(syncConfig)}
                                        footer={syncConfig.type === 'p2p'
                                            ? (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <SyncConfigActionButtons
                                                        syncConfig={syncConfig}
                                                        busy={busy}
                                                        serverRunning={serverRunning[syncConfig.id] ?? false}
                                                        onPickDirectory={onPickDirectory}
                                                        onToggleServer={onToggleServer}
                                                    />
                                                    <span className="text-note text-muted-foreground">
                                                        {syncConfig.network.relayMode ? '中转模式' : '直连模式'}
                                                    </span>
                                                </div>
                                            )
                                            : (
                                                <SyncConfigActionButtons
                                                    syncConfig={syncConfig}
                                                    busy={busy}
                                                    serverRunning={serverRunning[syncConfig.id] ?? false}
                                                    onPickDirectory={onPickDirectory}
                                                    onCompareAndSync={onCompareAndSync}
                                                    onExportZip={onExportZip}
                                                    onImportZip={onImportZip}
                                                    onToggleServer={onToggleServer}
                                                />
                                            )}
                                    />
                                </AddableListItem>
                            );
                        })
                    )}
                </AddableList>
            </SettingSection>

            {
                editingConfig ? (
                    <SyncConfigDialog
                        draft={editingConfig}
                        busy={busyKey === `save:${editingConfig.id}`}
                        isNew={!existingConfigIds.has(editingConfig.id)}
                        projects={config.projects}
                        roots={config.scanRoots}
                        serverRunning={serverRunning[editingConfig.id] ?? false}
                        onChange={setEditingConfig}
                        onClose={() => setEditingConfig(null)}
                        onSave={() => void saveSyncConfig(editingConfig)}
                        onPickDirectory={() => void pickDraftDirectory(editingConfig, setEditingConfig)}
                        onCompareAndSync={editingConfig.type === 'folder' || editingConfig.type === 'shared-dir'
                            ? () => void previewSyncPlan(editingConfig)
                            : undefined}
                        onExportZip={editingConfig.type === 'zip' ? () => void exportZip(editingConfig) : undefined}
                        onImportZip={editingConfig.type === 'zip' ? () => void importZip(editingConfig) : undefined}
                        onToggleServer={editingConfig.type === 'p2p' ? () => void toggleServer(editingConfig) : undefined}
                    />
                ) : null
            }
            {
                syncPlanPreview ? (
                    <SyncPlanDialog
                        title="同步目录"
                        session={syncPlanPreview.session}
                        busy={busyKey === `${syncPlanPreview.config.type === 'folder' ? 'apply-folder' : 'apply-shared-dir'}:${syncPlanPreview.config.id}`}
                        applyLabel="执行同步"
                        onClose={() => void closeSyncPlanPreview(syncPlanPreview)}
                        onOpenDiff={(projectId: string, relativePath: string) => window.fm.sync.openSyncDiff(
                            syncPlanPreview.config.id,
                            projectId,
                            relativePath,
                            syncPlanPreview.config,
                        )}
                        onOpenConflictMerge={(projectId: string, relativePath: string) => window.fm.sync.openConflictMerge(
                            syncPlanPreview.config.id,
                            projectId,
                            relativePath,
                            syncPlanPreview.config,
                        )}
                        onApply={(request: SyncPlanApplyRequest) => void applySyncPlanPreview(
                            syncPlanPreview,
                            request,
                            setBusyKey,
                            refreshConfig,
                            actions,
                            closeSyncPlanPreview,
                        )}
                    />
                ) : null
            }

            {
                zipImportSetup ? (
                    <ZipImportSetupDialog
                        syncConfig={zipImportSetup.config}
                        file={zipImportSetup.file}
                        entries={zipImportSetup.entries}
                        existingProjects={config.projects}
                        busy={busyKey === `preview-zip-import:${zipImportSetup.config.id}`}
                        onClose={() => setZipImportSetup(null)}
                        onPreview={async targets => {
                            setBusyKey(`preview-zip-import:${zipImportSetup.config.id}`);
                            try {
                                const preview = await window.fm.sync.previewZipImport(zipImportSetup.config.id, zipImportSetup.file, targets);
                                setZipImportPlanPreview({
                                    config: zipImportSetup.config,
                                    file: zipImportSetup.file,
                                    targets,
                                    preview,
                                });
                                setZipImportSetup(null);
                            } catch (error) {
                                actions.toast('error', error instanceof Error ? error.message : 'ZIP 导入预览失败');
                            } finally {
                                setBusyKey(null);
                            }
                        }}
                    />
                ) : null
            }

            {
                zipImportPlanPreview ? (
                    <SyncPlanStaticDialog
                        title="导入目录"
                        preview={zipImportPlanPreview.preview}
                        busy={busyKey === `apply-zip-import:${zipImportPlanPreview.config.id}`}
                        applyLabel="执行导入"
                        onClose={() => setZipImportPlanPreview(null)}
                        onApply={(request: SyncPlanApplyRequest) => void applyZipImportPreview(
                            zipImportPlanPreview,
                            request,
                            setBusyKey,
                            refreshConfig,
                            actions,
                            setZipImportPlanPreview,
                        )}
                    />
                ) : null
            }
        </div>
    );
}

function ListMetaBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center text-note text-muted-foreground">
            {children}
        </span>
    );
}

async function applySyncPlanPreview(
    state: ActiveSyncPlanPreview,
    request: SyncPlanApplyRequest,
    setBusyKey: (value: string | null) => void,
    refreshConfig: () => Promise<void>,
    actions: ReturnType<typeof useAppActions>,
    close: (value: ActiveSyncPlanPreview | null) => Promise<void>,
): Promise<void> {
    const busyKey = `${state.config.type === 'folder' ? 'apply-folder' : 'apply-shared-dir'}:${state.config.id}`;
    setBusyKey(busyKey);
    let persistedDraft = false;
    try {
        if (state.persistOnApply) {
            await window.fm.sync.upsertConfig(normalizeSyncConfig(state.config));
            persistedDraft = true;
        }

        const result = state.config.type === 'folder'
            ? await window.fm.sync.applyFolderSync(state.config.id, request.projectIds, request)
            : await window.fm.sync.applySharedDirSync(state.config.id, request.projectIds, request);
        await refreshConfig();
        actions.toast('success', summarizeApplyResult(result, '同步完成'));
        await close(state);
    } catch (error) {
        if (persistedDraft) {
            await refreshConfig().catch(() => undefined);
        }
        actions.toast('error', error instanceof Error ? error.message : '执行同步失败');
    } finally {
        setBusyKey(null);
    }
}

async function applyZipImportPreview(
    state: {
        config: Extract<SyncConfig, { type: 'zip' }>;
        file: string;
        targets: SyncImportTarget[];
        preview: SyncPlanPreview;
    },
    request: SyncPlanApplyRequest,
    setBusyKey: (value: string | null) => void,
    refreshConfig: () => Promise<void>,
    actions: ReturnType<typeof useAppActions>,
    close: (value: null) => void,
): Promise<void> {
    setBusyKey(`apply-zip-import:${state.config.id}`);
    try {
        const targetMap = new Map(state.targets.map(target => [target.projectId, target]));
        const selectedTargets = request.projectIds
            .map(projectId => targetMap.get(projectId))
            .filter((target): target is SyncImportTarget => Boolean(target));
        const result = await window.fm.sync.applyZipImport(state.config.id, state.file, selectedTargets);
        await refreshConfig();
        actions.toast('success', summarizeApplyResult(result, '导入完成'));
        close(null);
    } catch (error) {
        actions.toast('error', error instanceof Error ? error.message : 'ZIP 导入失败');
    } finally {
        setBusyKey(null);
    }
}

function summarizeApplyResult(result: SyncApplyResult, fallback: string): string {
    const summary = result.projects.reduce(
        (acc, project) => ({
            create: acc.create + project.applied.create,
            update: acc.update + project.applied.update,
            delete: acc.delete + project.applied.delete,
            conflict: acc.conflict + project.applied.conflict,
        }),
        { create: 0, update: 0, delete: 0, conflict: 0 },
    );
    return `${fallback}：新增 ${summary.create}，更新 ${summary.update}，删除 ${summary.delete}${summary.conflict > 0 ? `，冲突 ${summary.conflict}` : ''}`;
}

function ZipImportSetupDialog({
    syncConfig,
    file,
    entries,
    existingProjects,
    busy,
    onClose,
    onPreview,
}: {
    syncConfig: Extract<SyncConfig, { type: 'zip' }>;
    file: string;
    entries: SyncProjectEntry[];
    existingProjects: Project[];
    busy: boolean;
    onClose: () => void;
    onPreview: (targets: SyncImportTarget[]) => Promise<void>;
}) {
    const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(
        entries.map(entry => [entry.id, existingProjects.find(project => project.id === entry.id)?.path ?? '']),
    ));

    const canPreview = entries.length > 0 && entries.every(entry => targets[entry.id]?.trim());

    return (
        <EditDialogShell
            title={`选择导入目标：${syncConfig.name}`}
            note={`源文件：${file}`}
            onClose={onClose}
            panelClassName="w-[min(860px,calc(100vw-2rem))]"
            bodyClassName="space-y-4"
            footerEnd={(
                <>
                    <Button size="sm" variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button
                        size="sm"
                        disabled={busy || !canPreview}
                        onClick={() => void onPreview(entries.map(entry => ({
                            projectId: entry.id,
                            targetPath: targets[entry.id]!.trim(),
                        })))}
                    >
                        预览导入
                    </Button>
                </>
            )}
        >
            {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-note text-muted-foreground">
                    当前 ZIP 中没有可导入的项目。
                </div>
            ) : entries.map(entry => {
                const linkedProject = existingProjects.find(project => project.id === entry.id);
                return (
                    <div key={entry.id} className="rounded-xl border border-border bg-card px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-body font-medium text-foreground">{entry.meta.name}</p>
                                <p className="mt-1 text-note text-muted-foreground">
                                    {linkedProject ? `已存在本地绑定：${linkedProject.path}` : '尚未在本机建立绑定，将导入为新项目'}
                                </p>
                            </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            <input
                                value={targets[entry.id] ?? ''}
                                onChange={event => setTargets(current => ({ ...current, [entry.id]: event.target.value }))}
                                placeholder="选择本地目标目录"
                                className="h-9 flex-1 rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                    const picked = await window.fm.sync.pickDirectory('选择导入目标目录');
                                    if (picked) {
                                        setTargets(current => ({ ...current, [entry.id]: picked }));
                                    }
                                }}
                            >
                                选择
                            </Button>
                        </div>
                    </div>
                );
            })}
        </EditDialogShell>
    );
}

function SyncConfigDialog({
    draft,
    busy,
    isNew,
    projects,
    roots,
    serverRunning,
    onChange,
    onClose,
    onSave,
    onPickDirectory,
    onCompareAndSync,
    onExportZip,
    onImportZip,
    onToggleServer,
}: {
    draft: SyncConfig;
    busy: boolean;
    isNew: boolean;
    projects: Project[];
    roots: ScanRoot[];
    serverRunning: boolean;
    onChange: (next: SyncConfig) => void;
    onClose: () => void;
    onSave: () => void;
    onPickDirectory: () => void;
    onCompareAndSync?: () => void;
    onExportZip?: () => void;
    onImportZip?: () => void;
    onToggleServer?: () => void;
}) {
    const includedProjectCount = useMemo(() => resolveSyncProjectIds(draft, projects).length, [draft, projects]);

    const setTargetState = (kind: 'project' | 'root', id: string, nextState: SyncProjectRule) => {
        const selectedKey: TargetListKey = kind === 'project' ? 'projectIds' : 'rootIds';
        const ignoredKey: TargetListKey = kind === 'project' ? 'ignoredProjectIds' : 'ignoredRootIds';
        const nextTargets = {
            ...draft.targets,
            [selectedKey]: draft.targets[selectedKey].filter(item => item !== id),
            [ignoredKey]: draft.targets[ignoredKey].filter(item => item !== id),
        };

        if (nextState === 'selected') {
            nextTargets[selectedKey] = [...nextTargets[selectedKey], id];
        }
        if (nextState === 'ignored') {
            nextTargets[ignoredKey] = [...nextTargets[ignoredKey], id];
        }

        onChange(normalizeSyncConfig({
            ...draft,
            targets: nextTargets,
        }));
    };

    return (
        <EditDialogShell
            title={isNew ? '添加同步配置' : '修改同步配置'}
            onClose={onClose}
            panelClassName="w-[min(860px,calc(100vw-2rem))]"
            bodyClassName="space-y-6"
            footerStart={(
                <div>
                    <p className="text-subheading text-foreground">
                        同步范围包含 {includedProjectCount} 个项目
                    </p>
                </div>
            )}
            footerEnd={(
                <>
                    <Button size="sm" variant="ghost" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={busy} onClick={onSave}>
                        保存配置
                    </Button>
                </>
            )}
        >
            <EditDialogField label="名称">
                <input
                    value={draft.name}
                    onChange={event => onChange(normalizeSyncConfig({ ...draft, name: event.target.value }))}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <EditDialogField label="配置归属">
                <SegmentedToggleGroup
                    ariaLabel="选择同步配置归属"
                    value={draft.scope}
                    onValueChange={nextValue => onChange(normalizeSyncConfig({ ...draft, scope: nextValue as SyncConfigScope }))}
                    options={SCOPE_OPTIONS}
                    optionMinWidth={180}
                />
            </EditDialogField>

            <EditDialogField label="同步类型">
                <SegmentedToggleGroup
                    ariaLabel="选择同步类型"
                    value={draft.type}
                    onValueChange={nextValue => onChange(retypeSyncConfig(draft, nextValue as SyncConfigType))}
                    options={TYPE_OPTIONS}
                    optionMinWidth={156}
                    align="start"
                />
            </EditDialogField>

            <EditDialogField label="同步模式">
                <SegmentedToggleGroup
                    ariaLabel="选择同步模式"
                    value={draft.mode}
                    onValueChange={nextValue => onChange(normalizeSyncConfig({ ...draft, mode: nextValue as SyncMode }))}
                    options={MODE_OPTIONS}
                    optionMinWidth={180}
                    align="start"
                />
            </EditDialogField>

            <TypeSpecificEditor
                draft={draft}
                busy={busy}
                allowSyncActions={!isNew}
                onChange={onChange}
                onPickDirectory={onPickDirectory}
                onCompareAndSync={onCompareAndSync}
            />

            {draft.type === 'zip' || draft.type === 'p2p' ? (
                <div>
                    <SyncConfigActionButtons
                        syncConfig={draft}
                        busy={busy}
                        serverRunning={serverRunning}
                        allowSyncActions={!isNew}
                        showDirectoryPicker={false}
                        onPickDirectory={onPickDirectory}
                        onCompareAndSync={onCompareAndSync}
                        onExportZip={onExportZip}
                        onImportZip={onImportZip}
                        onToggleServer={onToggleServer}
                    />
                </div>
            ) : null}

            <EditDialogField label="同步范围">
                <SyncTargetTree
                    draft={draft}
                    projects={projects}
                    roots={roots}
                    onStateChange={setTargetState}
                />
            </EditDialogField>
        </EditDialogShell>
    );
}

function TypeSpecificEditor({
    draft,
    busy,
    allowSyncActions,
    onChange,
    onPickDirectory,
    onCompareAndSync,
}: {
    draft: SyncConfig;
    busy: boolean;
    allowSyncActions: boolean;
    onChange: (next: SyncConfig) => void;
    onPickDirectory: () => void;
    onCompareAndSync?: () => void;
}) {
    if (draft.type === 'folder') {
        return (
            <div className="space-y-4">
                <EditDialogField label="目标目录">
                    <div className="flex items-center gap-2">
                        <input
                            value={draft.folder.targetDir ?? ''}
                            onChange={event => onChange(normalizeSyncConfig({
                                ...draft,
                                folder: { ...draft.folder, targetDir: event.target.value },
                            }))}
                            placeholder="目标根目录"
                            className="h-9 flex-1 rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                        <Button size="sm" variant="outline" onClick={onPickDirectory}>
                            选择
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !allowSyncActions || !draft.folder.targetDir || !onCompareAndSync}
                            onClick={onCompareAndSync}
                        >
                            <GitCompareArrows className="size-4" /> 预览同步
                        </Button>
                    </div>
                </EditDialogField>

                <div className="rounded-xl bg-muted/20 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <CheckboxField
                            checked={draft.folder.autoSync}
                            onCheckedChange={checked => onChange(normalizeSyncConfig({
                                ...draft,
                                folder: { ...draft.folder, autoSync: checked },
                            }))}
                            label="自动同步"
                            className="items-center"
                            checkboxClassName="mt-0"
                            contentClassName="flex-none pt-0"
                        />

                        <div className="flex items-center gap-2 text-note text-muted-foreground">
                            <span>间隔</span>
                            <input
                                type="number"
                                min={1}
                                value={draft.folder.intervalMinutes ?? ''}
                                disabled={!draft.folder.autoSync}
                                onChange={event => onChange(normalizeSyncConfig({
                                    ...draft,
                                    folder: {
                                        ...draft.folder,
                                        intervalMinutes: event.target.value ? Number(event.target.value) : undefined,
                                    },
                                }))}
                                className="h-9 w-24 rounded-lg border border-border bg-background px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                            />
                            <span>分钟</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (draft.type === 'shared-dir') {
        return (
            <EditDialogField label="共享目录" note="适合 OneDrive、Dropbox、共享盘或中转设备挂载点。">
                <div className="flex items-center gap-2">
                    <input
                        value={draft.sharedDir.bundleDir ?? ''}
                        onChange={event => onChange(normalizeSyncConfig({
                            ...draft,
                            sharedDir: { bundleDir: event.target.value },
                        }))}
                        placeholder="共享目录路径"
                        className="h-9 flex-1 rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                    <Button size="sm" variant="outline" onClick={onPickDirectory}>
                        选择
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !allowSyncActions || !draft.sharedDir.bundleDir || !onCompareAndSync}
                        onClick={onCompareAndSync}
                    >
                        <GitCompareArrows className="size-4" /> 预览同步
                    </Button>
                </div>
            </EditDialogField>
        );
    }

    if (draft.type === 'zip') {
        return (
            <EditDialogField label="默认导出文件" note="留空表示每次手动选择导出位置。">
                <input
                    value={draft.zip.exportFile ?? ''}
                    onChange={event => onChange(normalizeSyncConfig({
                        ...draft,
                        zip: { exportFile: event.target.value },
                    }))}
                    placeholder="例如 D:/backup/fm.zip"
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>
        );
    }

    return (
        <div className="space-y-4">
            <EditDialogField label="监听端口">
                <input
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.network.listenPort}
                    onChange={event => onChange(normalizeSyncConfig({
                        ...draft,
                        network: {
                            ...draft.network,
                            listenPort: Number(event.target.value) || draft.network.listenPort,
                        },
                    }))}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <CheckboxField
                checked={draft.network.autoStart}
                onCheckedChange={checked => onChange(normalizeSyncConfig({
                    ...draft,
                    network: { ...draft.network, autoStart: checked },
                }))}
                label="启动时自动监听"
            />

            <CheckboxField
                checked={draft.network.relayMode}
                onCheckedChange={checked => onChange(normalizeSyncConfig({
                    ...draft,
                    network: { ...draft.network, relayMode: checked },
                }))}
                label="中转模式"
            />

            <EditDialogField label="仲裁设备 ID">
                <input
                    value={draft.network.ownerDeviceId ?? ''}
                    onChange={event => onChange(normalizeSyncConfig({
                        ...draft,
                        network: { ...draft.network, ownerDeviceId: event.target.value },
                    }))}
                    placeholder="可选"
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>

            <EditDialogField label="访问密钥">
                <input
                    value={draft.network.accessKey ?? ''}
                    onChange={event => onChange(normalizeSyncConfig({
                        ...draft,
                        network: { ...draft.network, accessKey: event.target.value },
                    }))}
                    placeholder="可选"
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
            </EditDialogField>
        </div>
    );
}

function SyncTargetTree({
    draft,
    projects,
    roots,
    onStateChange,
}: {
    draft: SyncConfig;
    projects: Project[];
    roots: ScanRoot[];
    onStateChange: (kind: 'project' | 'root', id: string, nextState: SyncProjectRule) => void;
}) {
    const groups = useMemo(() => {
        const rootIds = new Set(roots.map(root => root.id));
        const projectMap = new Map<string, Project[]>();

        for (const project of projects) {
            const current = projectMap.get(project.rootId) ?? [];
            current.push(project);
            projectMap.set(project.rootId, current);
        }

        const sortedRootGroups = roots.map(root => ({
            id: root.id,
            kind: 'root' as const,
            label: getScanRootLabel(root),
            description: root.path,
            projects: (projectMap.get(root.id) ?? []).slice().sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
        }));

        const orphanProjects = projects
            .filter(project => !rootIds.has(project.rootId))
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

        return orphanProjects.length > 0
            ? [
                ...sortedRootGroups,
                {
                    id: '__orphan__',
                    kind: 'virtual' as const,
                    label: '未匹配扫描根',
                    description: '这些项目当前没有可用的扫描根。',
                    projects: orphanProjects,
                },
            ]
            : sortedRootGroups;
    }, [projects, roots]);

    const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);

    useEffect(() => {
        setCollapsedGroupIds(current => current.filter(id => groups.some(group => group.id === id)));
    }, [groups]);

    if (groups.length === 0) {
        return (
            <div className="rounded-2xl bg-muted/20 px-4 py-4 text-note text-muted-foreground">
                暂无可配置的扫描根或项目。
            </div>
        );
    }

    return (
        <div className="rounded-2xl bg-muted/20 px-3 py-3">
            <div className="space-y-1">
                {groups.map(group => {
                    const collapsed = collapsedGroupIds.includes(group.id);
                    const hasChildren = group.projects.length > 0;
                    const rootState = group.kind === 'root'
                        ? readTargetState(draft, 'root', group.id)
                        : 'default';

                    return (
                        <div key={group.id}>
                            <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40">
                                {hasChildren ? (
                                    <button
                                        type="button"
                                        onClick={() => setCollapsedGroupIds(current => current.includes(group.id)
                                            ? current.filter(id => id !== group.id)
                                            : [...current, group.id])}
                                        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                        aria-label={collapsed ? `展开 ${group.label}` : `折叠 ${group.label}`}
                                    >
                                        <ChevronDown className={`size-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                                    </button>
                                ) : (
                                    <span className="inline-flex size-6 shrink-0" />
                                )}

                                <TriStateRuleButton
                                    state={rootState}
                                    disabled={group.kind !== 'root'}
                                    label={group.label}
                                    onClick={group.kind === 'root'
                                        ? () => onStateChange('root', group.id, getNextTriStateRule(rootState))
                                        : undefined}
                                />

                                <FolderRoot className="size-4 text-muted-foreground" />
                                <p className="text-subheading text-foreground">{group.label}</p>
                                <span className="text-caption text-muted-foreground">{group.projects.length} 个项目</span>
                            </div>

                            {!collapsed && hasChildren ? (
                                <div className="ml-11 border-l border-border/60 pl-4">
                                    {group.projects.map(project => {
                                        const projectState = readTargetState(draft, 'project', project.id);
                                        return (
                                            <div key={project.id} className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40">
                                                <TriStateRuleButton
                                                    state={projectState}
                                                    label={project.name}
                                                    onClick={() => onStateChange('project', project.id, getNextTriStateRule(projectState))}
                                                />
                                                <span className="text-body text-foreground">{project.name}</span>
                                                <span className="text-note text-muted-foreground">{project.path}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SyncConfigActionButtons({
    syncConfig,
    busy,
    serverRunning,
    allowSyncActions = true,
    showDirectoryPicker = true,
    onPickDirectory,
    onCompareAndSync,
    onExportZip,
    onImportZip,
    onToggleServer,
}: {
    syncConfig: SyncConfig;
    busy: boolean;
    serverRunning: boolean;
    allowSyncActions?: boolean;
    showDirectoryPicker?: boolean;
    onPickDirectory?: () => void;
    onCompareAndSync?: () => void;
    onExportZip?: () => void;
    onImportZip?: () => void;
    onToggleServer?: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {syncConfig.type === 'folder' ? (
                <>
                    {showDirectoryPicker ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={onPickDirectory}>
                            <FolderOpen className="size-4" /> 选择目标目录
                        </Button>
                    ) : null}
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !allowSyncActions || !syncConfig.folder.targetDir || !onCompareAndSync}
                        onClick={onCompareAndSync}
                    >
                        <GitCompareArrows className="size-4" /> 预览同步
                    </Button>
                </>
            ) : null}

            {syncConfig.type === 'shared-dir' ? (
                <>
                    {showDirectoryPicker ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={onPickDirectory}>
                            <FolderOpen className="size-4" /> 选择共享目录
                        </Button>
                    ) : null}
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !allowSyncActions || !syncConfig.sharedDir.bundleDir || !onCompareAndSync}
                        onClick={onCompareAndSync}
                    >
                        <GitCompareArrows className="size-4" /> 预览同步
                    </Button>
                </>
            ) : null}

            {syncConfig.type === 'zip' ? (
                <>
                    <Button size="sm" variant="outline" disabled={busy || !allowSyncActions} onClick={onExportZip}>
                        <Upload className="size-4" /> 导出 ZIP
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy || !allowSyncActions} onClick={onImportZip}>
                        <Download className="size-4" /> 导入 ZIP
                    </Button>
                </>
            ) : null}

            {syncConfig.type === 'p2p' ? (
                <Button
                    size="sm"
                    variant={serverRunning ? 'default' : 'outline'}
                    disabled={busy || !allowSyncActions}
                    onClick={onToggleServer}
                >
                    <Server className="size-4" /> {serverRunning ? '停止服务' : '启动服务'}
                </Button>
            ) : null}
        </div>
    );
}

function getScanRootLabel(root: ScanRoot): string {
    return root.label || root.path;
}

function readTargetState(draft: SyncConfig, kind: 'project' | 'root', id: string): SyncProjectRule {
    if (kind === 'project') {
        if (draft.targets.projectIds.includes(id)) return 'selected';
        if (draft.targets.ignoredProjectIds.includes(id)) return 'ignored';
        return 'default';
    }
    if (draft.targets.rootIds.includes(id)) return 'selected';
    if (draft.targets.ignoredRootIds.includes(id)) return 'ignored';
    return 'default';
}

function retypeSyncConfig(current: SyncConfig, type: SyncConfigType): SyncConfig {
    const next = createScopedSyncConfig(type, current.scope);
    return normalizeSyncConfig({
        ...next,
        id: current.id,
        name: current.name.trim() || next.name,
        scope: current.scope,
        mode: type === 'zip' && current.mode === 'two-way' ? 'mirror-local-to-target' : current.mode,
        targets: current.targets,
    });
}

function areSyncConfigValuesEqual(left: SyncConfig, right: SyncConfig): boolean {
    return JSON.stringify(normalizeSyncConfig(left)) === JSON.stringify(normalizeSyncConfig(right));
}

async function pickDraftDirectory(draft: SyncConfig, onChange: (next: SyncConfig) => void): Promise<void> {
    const title = draft.type === 'folder' ? '选择目标目录' : '选择共享目录';
    const dir = await window.fm.sync.pickDirectory(title);
    if (!dir) return;

    if (draft.type === 'folder') {
        onChange(normalizeSyncConfig({
            ...draft,
            folder: { ...draft.folder, targetDir: dir },
        }));
        return;
    }

    if (draft.type === 'shared-dir') {
        onChange(normalizeSyncConfig({
            ...draft,
            sharedDir: { ...draft.sharedDir, bundleDir: dir },
        }));
    }
}
