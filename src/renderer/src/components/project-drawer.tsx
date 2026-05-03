// ---------------------------------------------------------------------------
// 项目详情抽屉：右侧 480px，包含元数据编辑
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  FolderOpen,
  Save,
  Terminal,
  X,
} from 'lucide-react';
import type {
  CustomCommand,
  PresetCommandDescriptor,
  Project,
  ProjectDirectoryInspection,
  ProjectMetaPatch,
  SyncConfig,
  SyncProjectRule,
} from '@shared/bridge.js';
import { getEffectiveSyncProjectState, resolveSyncProjectIds } from '@shared/sync-config.js';
import { explainMatch, matchProject, parseSearchQuery } from '@shared/search.js';
import { Button } from '@/components/ui/button';
import { TriStateRuleButton, getNextTriStateRule } from '@/components/ui/tri-state-rule-button';
import { useAppActions, useAppState } from '../store/app-store.js';
import { ProjectEditorDrawer, ProjectFileTreePanel, type ProjectEditorFormValue } from './project-editor-drawer.js';
import { SyncConfigSummaryCard, getProjectSyncStateDescription } from './sync-config-card.js';

type FormState = ProjectEditorFormValue;

function projectToForm(project: Project): FormState {
  return {
    path: project.path,
    name: project.name,
    description: project.description ?? '',
    tags: [...project.tags],
    ignore: [...project.ignore],
    fingerprint: project.fingerprint,
  };
}

function formsEqual(a: FormState, b: FormState): boolean {
  if (a.path !== b.path) return false;
  if (a.name !== b.name) return false;
  if (a.description !== b.description) return false;
  if (a.ignore.length !== b.ignore.length) return false;
  for (let i = 0; i < a.ignore.length; i++) {
    if (a.ignore[i] !== b.ignore[i]) return false;
  }
  if (!sameFingerprint(a.fingerprint, b.fingerprint)) return false;
  if (a.tags.length !== b.tags.length) return false;
  for (let i = 0; i < a.tags.length; i++) {
    if (a.tags[i] !== b.tags[i]) return false;
  }
  return true;
}

export function ProjectDrawer() {
  const { selectedProjectId, config, search } = useAppState();
  const actions = useAppActions();
  const project = useMemo(
    () => config.projects.find(p => p.id === selectedProjectId),
    [config.projects, selectedProjectId],
  );

  const [form, setForm] = useState<FormState | null>(project ? projectToForm(project) : null);
  const [initial, setInitial] = useState<FormState | null>(
    project ? projectToForm(project) : null,
  );
  const [presets, setPresets] = useState<PresetCommandDescriptor[]>([]);
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [inspection, setInspection] = useState<ProjectDirectoryInspection | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'files' | 'sync'>('details');
  const [ignoreText, setIgnoreText] = useState(project ? project.ignore.join('\n') : '');
  const [syncBusyId, setSyncBusyId] = useState<string | null>(null);

  useEffect(() => {
    const next = project ? projectToForm(project) : null;
    setForm(next);
    setInitial(next);
    setIgnoreText(next?.ignore.join('\n') ?? '');
  }, [project]);

  useEffect(() => {
    setCommandsOpen(false);
    setConfirmClose(false);
    setActiveTab('details');
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

  const isDirty = useMemo(() => {
    if (!form || !initial) return false;
    return !formsEqual(form, initial);
  }, [form, initial]);

  const tryClose = () => {
    if (isDirty) {
      setConfirmClose(true);
    } else {
      actions.selectProject(undefined);
    }
  };

  // ESC 关闭
  useEffect(() => {
    if (!project) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
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
      const r = await window.fm.commands.run(commandId, project.id);
      setCommandsOpen(false);
      if (r.clipboard) actions.toast('success', `已复制：${r.clipboard}`);
      else actions.toast('success', '命令已启动');
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '命令执行失败');
    }
  };

  const buildPatch = (): ProjectMetaPatch => ({
    name: form.name,
    description: form.description,
    tags: form.tags,
    ignore: form.ignore,
    fingerprint: form.fingerprint,
  });

  const doSave = async (writeFile: boolean, then: 'close' | 'keep') => {
    await actions.saveProject(project.id, buildPatch(), writeFile);
    if (then === 'close') {
      setConfirmClose(false);
      actions.selectProject(undefined);
    }
  };

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter(x => x !== tag) });
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (!t || form.tags.includes(t)) return;
    setForm({ ...form, tags: [...form.tags, t] });
  };

  const updateIgnoreText = (value: string) => {
    setIgnoreText(value);
    setForm(current => current ? {
      ...current,
      ignore: parseIgnoreRules(value),
    } : current);
  };

  const saveDisabled = form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.length === 0;

  return (
    <>
      <ProjectEditorDrawer
        form={form}
        onFormChange={setForm}
        tagDefs={config.tags}
        inspection={inspection ?? {
          path: project.path,
          suggestedName: project.path.split(/[/\\]/).filter(Boolean).pop() ?? project.name,
          hasMetaFile: project.hasMetaFile,
          metaProjectId: project.id,
          tree: [],
          files: project.fingerprint.kind === 'file-paths' ? project.fingerprint.paths : [],
        }}
        headerTabs={[
          { id: 'details', label: '项目详情' },
          { id: 'files', label: '文件列表' },
          { id: 'sync', label: '同步' },
        ]}
        activeTabId={activeTab}
        onTabChange={tabId => setActiveTab(tabId as 'details' | 'files' | 'sync')}
        body={activeTab === 'files'
          ? (
            <ProjectFileTreePanel
              tree={inspection?.tree ?? []}
              ignoreText={ignoreText}
              onIgnoreTextChange={updateIgnoreText}
            />
          )
          : activeTab === 'sync'
            ? (
              <ProjectSyncPanel
                project={project}
                allProjects={config.projects}
                syncConfigs={config.syncConfigs ?? []}
                busyId={syncBusyId}
                onChangeRule={async (configId, rule) => {
                  try {
                    setSyncBusyId(configId);
                    await window.fm.sync.setProjectRule(configId, project.id, rule);
                    await actions.loadConfig();
                    actions.toast('success', '已更新项目同步规则');
                  } catch (error) {
                    actions.toast('error', error instanceof Error ? error.message : '更新失败');
                  } finally {
                    setSyncBusyId(null);
                  }
                }}
              />
            )
            : undefined}
        pathEditable={false}
        banner={matchExplanation || undefined}
        validation={
          <div className="space-y-3">
            {saveDisabled ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-note text-amber-700 dark:text-amber-300">
                文件列表指纹至少需要选择一个文件。
              </div>
            ) : null}
          </div>
        }
        onAddTag={addTag}
        onRemoveTag={removeTag}
        onClose={tryClose}
        headerActions={
          <>
            <div className="relative">
              <Button
                size="icon-xs"
                variant="ghost"
                title="项目命令"
                onClick={() => setCommandsOpen(v => !v)}
              >
                <Terminal className="size-3.5" />
              </Button>
              {commandsOpen ? (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md">
                  {presets.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void runCommand(p.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                    >
                      {p.label}
                    </button>
                  ))}
                  {customCommands.length > 0 ? (
                    <>
                      <div className="my-1 border-t border-border" />
                      {customCommands.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => void runCommand(c.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                          title={c.description ?? c.command}
                        >
                          <ChevronDown className="size-3 shrink-0 opacity-0" />
                          {c.label}
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
        }
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button size="sm" disabled={saveDisabled} onClick={() => void doSave(false, 'close')}>
              <Save className="size-3.5" /> 保存
            </Button>
          </div>
        }
      />

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

function ProjectSyncPanel({
  project,
  allProjects,
  syncConfigs,
  busyId,
  onChangeRule,
}: {
  project: Project;
  allProjects: Project[];
  syncConfigs: SyncConfig[];
  busyId: string | null;
  onChangeRule: (configId: string, rule: SyncProjectRule) => Promise<void>;
}) {
  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      <div className="space-y-3">
        {syncConfigs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-6 text-center text-note text-muted-foreground">
            当前还没有同步配置，可在设置页先添加。
          </div>
        ) : (
          syncConfigs.map(syncConfig => {
            const state = getEffectiveSyncProjectState(syncConfig, project);
            const explicitRule = readProjectRule(syncConfig, project.id);
            const busy = busyId === syncConfig.id;
            const includedProjectCount = resolveSyncProjectIds(syncConfig, allProjects).length;

            return (
              <SyncConfigSummaryCard
                key={syncConfig.id}
                syncConfig={syncConfig}
                includedProjectCount={includedProjectCount}
                detailText={getProjectSyncStateDescription(state)}
                leading={(
                  <TriStateRuleButton
                    state={explicitRule}
                    label={`${syncConfig.name} 同步规则`}
                    disabled={busy}
                    onClick={() => void onChangeRule(syncConfig.id, getNextTriStateRule(explicitRule))}
                  />
                )}
                className="bg-background"
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function readProjectRule(syncConfig: SyncConfig, projectId: string): SyncProjectRule {
  if (syncConfig.targets.ignoredProjectIds.includes(projectId)) return 'ignored';
  if (syncConfig.targets.projectIds.includes(projectId)) return 'selected';
  return 'default';
}

function parseIgnoreRules(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// 未保存确认：保存并关闭 / 不保存 / 取消
// ---------------------------------------------------------------------------

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
        className="fixed inset-0 z-[60] cursor-default bg-black/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-[70] w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-heading">尚未保存的修改</h2>
          <p className="mt-2 text-note text-muted-foreground">
            是否在关闭前保存这些修改？
          </p>
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

