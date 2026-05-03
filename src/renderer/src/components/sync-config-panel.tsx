import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, FolderOpen, FolderRoot, Plus, Server, Upload } from 'lucide-react';
import type { DeviceRegistry, Project, ScanRoot, SyncConfig, SyncProjectRule } from '@shared/bridge.js';
import { createScopedSyncConfig, normalizeSyncConfig, resolveSyncProjectIds } from '@shared/sync-config.js';
import {
    type SyncConfigScope,
    type SyncConfigType,
    type SyncMode,
} from '@shared/sync-types.js';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import {
    SegmentedToggleGroup,
    type SegmentedToggleOption,
} from '@/components/ui/segmented-toggle-group';
import { TriStateRuleButton, getNextTriStateRule } from '@/components/ui/tri-state-rule-button';
import { SyncConfigSummaryCard } from './sync-config-card.js';
import { useAppActions, useAppState } from '../store/app-store.js';

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
        value: 'shared-dir',
        label: '共享目录',
        description: '适合共享盘同步',
        icon: <Upload className="size-4" />,
    },
    {
        value: 'zip',
        label: 'ZIP',
        description: '适合备份与离线导入',
        icon: <Download className="size-4" />,
    },
    {
        value: 'p2p',
        label: 'P2P',
        description: '适合局域网持续同步',
        icon: <Server className="size-4" />,
    },
    {
        value: 'folder',
        label: '文件夹',
        description: '适合本机或挂载目录镜像',
        icon: <FolderOpen className="size-4" />,
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

export function SyncConfigPanel() {
    const { config } = useAppState();
    const actions = useAppActions();
    const syncConfigs = config.syncConfigs ?? [];
    const [device, setDevice] = useState<DeviceRegistry | null>(null);
    const [deviceNameDraft, setDeviceNameDraft] = useState('');
    const [editingConfig, setEditingConfig] = useState<SyncConfig | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [serverRunning, setServerRunning] = useState<Record<string, boolean>>({});

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

    const existingConfigIds = useMemo(() => new Set(syncConfigs.map(item => item.id)), [syncConfigs]);
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

    const pushSharedDir = async (syncConfig: Extract<SyncConfig, { type: 'shared-dir' }>) => {
        setBusyKey(`push:${syncConfig.id}`);
        try {
            const result = await window.fm.sync.pushSharedDir(syncConfig.id, config.projects.map(item => item.id));
            await refreshConfig();
            actions.toast('success', `已推送 ${result.pushed.length} 个项目`);
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '推送失败');
        } finally {
            setBusyKey(null);
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
            actions.toast('info', `预览完成：bundle 含 ${preview.entries.length} 个项目，导入确认 UI 下一步接入。`);
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

    const previewFolderDiff = (syncConfig: Extract<SyncConfig, { type: 'folder' }>) => {
        void syncConfig;
        actions.toast('info', '文件夹对比视图会在下一步同步执行器接入；本轮先完成配置体验与界面重构。');
    };

    return (
        <section>
            <h2 className="text-heading text-foreground">同步</h2>
            <p className="mt-1 text-note text-muted-foreground">文件同步设定。</p>

            <div className="mt-3.5 space-y-3">
                <div className="space-y-2 px-1">
                    <p className="text-subheading text-muted-foreground">本机设备</p>
                    {device ? (
                        <div className="flex flex-wrap items-center gap-2.5">
                            <input
                                value={deviceNameDraft}
                                autoComplete="off"
                                onChange={event => setDeviceNameDraft(event.target.value)}
                                onBlur={async event => {
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
                                className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 text-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <span className="text-note text-muted-foreground">{device.selfId}</span>
                        </div>
                    ) : (
                        <p className="mt-2 text-note text-muted-foreground">加载中…</p>
                    )}
                </div>

                <div>
                    <p className="text-subheading text-muted-foreground">同步配置</p>
                </div>
                <div className="space-y-2">
                    {syncConfigs.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center">
                            <p className="text-body text-foreground">还没有同步配置</p>
                            <p className="mt-1 text-note text-muted-foreground">
                                先添加一条配置，再决定它是共享目录、ZIP、文件夹还是 P2P。
                            </p>
                        </div>
                    ) : (
                        syncConfigs.map(syncConfig => (
                            <SyncConfigSummaryCard
                                key={syncConfig.id}
                                syncConfig={syncConfig}
                                includedProjectCount={includedProjectCounts[syncConfig.id] ?? 0}
                                busy={busyKey?.includes(syncConfig.id) ?? false}
                                onEdit={() => setEditingConfig(syncConfig)}
                                onDelete={() => void removeSyncConfig(syncConfig)}
                                footer={(
                                    <SyncConfigActionButtons
                                        syncConfig={syncConfig}
                                        busy={busyKey?.includes(syncConfig.id) ?? false}
                                        serverRunning={serverRunning[syncConfig.id] ?? false}
                                        onPickDirectory={() => void pickDirectoryForConfig(syncConfig)}
                                        onPushSharedDir={syncConfig.type === 'shared-dir' ? () => void pushSharedDir(syncConfig) : undefined}
                                        onExportZip={syncConfig.type === 'zip' ? () => void exportZip(syncConfig) : undefined}
                                        onImportZip={syncConfig.type === 'zip' ? () => void importZip(syncConfig) : undefined}
                                        onToggleServer={syncConfig.type === 'p2p' ? () => void toggleServer(syncConfig) : undefined}
                                        onPreviewFolderDiff={syncConfig.type === 'folder' ? () => previewFolderDiff(syncConfig) : undefined}
                                    />
                                )}
                            />
                        ))
                    )}

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingConfig(createScopedSyncConfig('shared-dir', 'local'))}
                    >
                        <Plus className="size-4" /> 添加新同步配置
                    </Button>
                </div>
            </div>

            {editingConfig ? (
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
                    onPushSharedDir={editingConfig.type === 'shared-dir' ? () => void pushSharedDir(editingConfig) : undefined}
                    onExportZip={editingConfig.type === 'zip' ? () => void exportZip(editingConfig) : undefined}
                    onImportZip={editingConfig.type === 'zip' ? () => void importZip(editingConfig) : undefined}
                    onToggleServer={editingConfig.type === 'p2p' ? () => void toggleServer(editingConfig) : undefined}
                    onPreviewFolderDiff={editingConfig.type === 'folder' ? () => previewFolderDiff(editingConfig) : undefined}
                />
            ) : null}
        </section>
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
    onPushSharedDir,
    onExportZip,
    onImportZip,
    onToggleServer,
    onPreviewFolderDiff,
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
    onPushSharedDir?: () => void;
    onExportZip?: () => void;
    onImportZip?: () => void;
    onToggleServer?: () => void;
    onPreviewFolderDiff?: () => void;
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
            note="标题、归属、同步类型与手动规则都在这里统一配置；shared 会写入 fm.shared.json，local 会写入 fm.local.json。"
            onClose={onClose}
            panelClassName="w-[min(860px,calc(100vw-2rem))]"
            bodyClassName="space-y-6"
            footerStart={(
                <div>
                    <p className="text-subheading text-foreground">
                        包含 {includedProjectCount} 个项目
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

            <TypeSpecificEditor draft={draft} onChange={onChange} onPickDirectory={onPickDirectory} />

            <EditDialogField label="快捷操作">
                <SyncConfigActionButtons
                    syncConfig={draft}
                    busy={busy}
                    serverRunning={serverRunning}
                    allowSyncActions={!isNew}
                    onPickDirectory={onPickDirectory}
                    onPushSharedDir={onPushSharedDir}
                    onExportZip={onExportZip}
                    onImportZip={onImportZip}
                    onToggleServer={onToggleServer}
                    onPreviewFolderDiff={onPreviewFolderDiff}
                />
            </EditDialogField>

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
    onChange,
    onPickDirectory,
}: {
    draft: SyncConfig;
    onChange: (next: SyncConfig) => void;
    onPickDirectory: () => void;
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
                    </div>
                </EditDialogField>

                <CheckboxField
                    checked={draft.folder.compareBeforeSync}
                    onCheckedChange={checked => onChange(normalizeSyncConfig({
                        ...draft,
                        folder: { ...draft.folder, compareBeforeSync: checked },
                    }))}
                    label="手动同步前先展示一对一差异视图"
                />

                <CheckboxField
                    checked={draft.folder.autoSync}
                    onCheckedChange={checked => onChange(normalizeSyncConfig({
                        ...draft,
                        folder: { ...draft.folder, autoSync: checked },
                    }))}
                    label="自动同步"
                />

                <EditDialogField label="自动同步间隔（分钟）">
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
                        className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                    />
                </EditDialogField>
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
    onPickDirectory,
    onPushSharedDir,
    onExportZip,
    onImportZip,
    onToggleServer,
    onPreviewFolderDiff,
}: {
    syncConfig: SyncConfig;
    busy: boolean;
    serverRunning: boolean;
    allowSyncActions?: boolean;
    onPickDirectory?: () => void;
    onPushSharedDir?: () => void;
    onExportZip?: () => void;
    onImportZip?: () => void;
    onToggleServer?: () => void;
    onPreviewFolderDiff?: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {syncConfig.type === 'folder' ? (
                <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={onPickDirectory}>
                        <FolderOpen className="size-4" /> 选择目标目录
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={onPreviewFolderDiff}>
                        预览差异
                    </Button>
                </>
            ) : null}

            {syncConfig.type === 'shared-dir' ? (
                <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={onPickDirectory}>
                        <FolderOpen className="size-4" /> 选择共享目录
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !allowSyncActions || !syncConfig.sharedDir.bundleDir}
                        onClick={onPushSharedDir}
                    >
                        <Upload className="size-4" /> 推送全部
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
