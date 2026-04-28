// ---------------------------------------------------------------------------
// 项目详情抽屉：右侧 480px，包含元数据编辑
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  FileMinus,
  FileText,
  Plus,
  Save,
  Terminal,
  X,
} from 'lucide-react';
import type { CustomCommand, PresetCommandDescriptor, Project, ProjectMetaPatch } from '@shared/bridge.js';
import { explainMatch, matchProject, parseSearchQuery } from '@shared/search.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';
import { TagPill, resolveTagColor } from './tag-pill.js';
import { NewTagDialog } from './new-tag-dialog.js';

interface FormState {
  name: string;
  description: string;
  tags: string[];
}

function projectToForm(project: Project): FormState {
  return {
    name: project.name,
    description: project.description ?? '',
    tags: [...project.tags],
  };
}

function formsEqual(a: FormState, b: FormState): boolean {
  if (a.name !== b.name) return false;
  if (a.description !== b.description) return false;
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

  useEffect(() => {
    const next = project ? projectToForm(project) : null;
    setForm(next);
    setInitial(next);
    setCommandsOpen(false);
    setConfirmClose(false);
  }, [project?.id, project?.lastScannedAt]);

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

  return (
    <>
      <button
        type="button"
        aria-label="关闭详情"
        onClick={tryClose}
        className="fixed inset-0 z-30 bg-black/10 backdrop-blur-[1px] dark:bg-black/40"
      />
      <aside
        className={cn(
          'fixed top-0 right-0 z-40 flex h-full w-[480px] flex-col border-l border-border bg-card shadow-xl',
          'animate-in slide-in-from-right duration-150',
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            {project.hasMetaFile ? (
              <span className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-caption text-secondary-foreground">
                <FileText className="size-3.5" /> .meta-data
              </span>
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                仅数据库
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
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
              <ExternalLink className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={tryClose}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {matchExplanation ? (
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-caption text-muted-foreground">
            {matchExplanation}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <Field label="名称">
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="h-9 w-full rounded-md border border-border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </Field>

          <Field label="路径">
            <p
              className="text-note break-all text-muted-foreground"
              title={project.path}
            >
              {project.path}
            </p>
          </Field>

          <Field label="描述">
            <textarea
              rows={4}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full resize-none rounded-md border border-border bg-background p-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </Field>

          <Field label="标签">
            <TagEditor
              tags={form.tags}
              tagDefs={config.tags}
              onRemove={removeTag}
              onAdd={addTag}
            />
          </Field>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-card/80 px-4 py-3">
          {project.hasMetaFile ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void actions.removeMetaFile(project.id)}
            >
              <FileMinus className="size-3.5" /> 删除 .meta-data
            </Button>
          ) : (
            <span className="text-note text-muted-foreground">未写入 .meta-data</span>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void doSave(true, 'close')}
            >
              <FileText className="size-3.5" /> 写入 .meta-data
            </Button>
            <Button
              size="sm"
              onClick={() => void doSave(false, 'close')}
            >
              <Save className="size-3.5" /> 保存
            </Button>
          </div>
        </div>
      </aside>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <label className="text-subheading mb-2 block text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
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

// ---------------------------------------------------------------------------
// 标签编辑：已选标签 + 未选标签 + 新增按钮（带丝滑动画）
// ---------------------------------------------------------------------------

function startTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => update());
  } else {
    update();
  }
}

function tagViewName(name: string): string {
  // 转为合法 CSS ident：仅保留字母数字与下划线，其它转十六进制
  const safe = [...name]
    .map(ch => (/[a-zA-Z0-9_]/.test(ch) ? ch : `_${ch.charCodeAt(0).toString(16)}`))
    .join('');
  return `fm-tag-${safe}`;
}

function TagEditor({
  tags,
  tagDefs,
  onAdd,
  onRemove,
}: {
  tags: string[];
  tagDefs: readonly import('@shared/bridge.js').TagDefinition[] | undefined;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(tags), [tags]);
  const available = useMemo(
    () => (tagDefs ?? []).filter(t => !selectedSet.has(t.name)),
    [tagDefs, selectedSet],
  );

  const select = (name: string) => {
    startTransition(() => onAdd(name));
  };

  const remove = (name: string) => {
    startTransition(() => onRemove(name));
  };

  return (
    <div className="space-y-3">
      {/* 已选标签 */}
      <div className="flex min-h-[2.25rem] flex-wrap items-center gap-1.5 p-0.5">
        {tags.length === 0 ? (
          <span className="px-1 text-note text-muted-foreground/70">尚未选择标签</span>
        ) : (
          tags.map(t => (
            <span
              key={`sel-${t}`}
              style={{ viewTransitionName: tagViewName(t) }}
              className="inline-block"
            >
              <TagPill
                name={t}
                color={resolveTagColor(t, tagDefs)}
                size="md"
                onRemove={() => remove(t)}
              />
            </span>
          ))
        )}
      </div>

      {/* 未选标签 + 新增 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-subheading text-muted-foreground/80">
            可选标签
          </span>
        </div>
        {available.length === 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-note text-muted-foreground/70">
              全部标签已选择。
            </p>
            <button
              type="button"
              aria-label="新建标签"
              onClick={() => setDialogOpen(true)}
              className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {available.map(t => (
              <button
                key={`opt-${t.name}`}
                type="button"
                onClick={() => select(t.name)}
                style={{ viewTransitionName: tagViewName(t.name) }}
                className="cursor-pointer rounded-full opacity-70 transition-opacity hover:opacity-100"
              >
                <TagPill name={t.name} color={t.color} size="md" />
              </button>
            ))}
            <button
              type="button"
              aria-label="新建标签"
              onClick={() => setDialogOpen(true)}
              className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {dialogOpen ? (
        <NewTagDialog
          onClose={() => setDialogOpen(false)}
          onCreated={name => {
            startTransition(() => onAdd(name));
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 新建标签对话框已移至 new-tag-dialog.tsx，与侧边栏共用
// ---------------------------------------------------------------------------

