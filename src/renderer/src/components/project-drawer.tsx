// ---------------------------------------------------------------------------
// 项目详情抽屉：右侧 480px，包含元数据编辑
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { ExternalLink, FileMinus, FileText, Save, X } from 'lucide-react';
import type { Project, ProjectMetaPatch } from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

interface FormState {
  name: string;
  categoryId: string;
  description: string;
  tags: string[];
}

function projectToForm(project: Project): FormState {
  return {
    name: project.name,
    categoryId: project.categoryId ?? '',
    description: project.description ?? '',
    tags: [...project.tags],
  };
}

export function ProjectDrawer() {
  const { selectedProjectId, config } = useAppState();
  const actions = useAppActions();
  const project = useMemo(
    () => config.projects.find(p => p.id === selectedProjectId),
    [config.projects, selectedProjectId],
  );

  const [form, setForm] = useState<FormState | null>(project ? projectToForm(project) : null);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    setForm(project ? projectToForm(project) : null);
    setTagDraft('');
  }, [project?.id, project?.lastScannedAt]);

  // ESC 关闭
  useEffect(() => {
    if (!project) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') actions.selectProject(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, actions]);

  if (!project || !form) return null;

  const buildPatch = (): ProjectMetaPatch => ({
    name: form.name,
    description: form.description,
    tags: form.tags,
    categoryId: form.categoryId === '' ? null : form.categoryId,
  });

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (!t || form.tags.includes(t)) return;
    setForm({ ...form, tags: [...form.tags, t] });
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
      setTagDraft('');
    } else if (e.key === 'Backspace' && tagDraft === '' && form.tags.length > 0) {
      setForm({ ...form, tags: form.tags.slice(0, -1) });
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭详情"
        onClick={() => actions.selectProject(undefined)}
        className="fixed inset-0 z-30 bg-black/10 backdrop-blur-[1px] dark:bg-black/40"
      />
      <aside
        className={cn(
          'fixed top-0 right-0 z-40 flex h-full w-[480px] flex-col border-l border-border bg-card shadow-xl',
          'animate-in slide-in-from-right duration-150',
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            {project.hasMetaFile ? (
              <span className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] text-secondary-foreground">
                <FileText className="size-3" /> .meta-data
              </span>
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                仅数据库
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
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
              onClick={() => actions.selectProject(undefined)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <Field label="名称">
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </Field>

          <Field label="路径">
            <p
              className="font-mono text-[0.7rem] break-all text-muted-foreground"
              title={project.path}
            >
              {project.path}
            </p>
          </Field>

          <Field label="分类">
            <select
              value={form.categoryId}
              onChange={e => setForm({ ...form, categoryId: e.target.value })}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <option value="">未分类</option>
              {config.categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="描述">
            <textarea
              rows={4}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </Field>

          <Field label="标签">
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
              {form.tags.map(t => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[0.7rem] text-secondary-foreground"
                >
                  #{t}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setForm({ ...form, tags: form.tags.filter(x => x !== t) })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={e => setTagDraft(e.target.value)}
                onKeyDown={onTagKey}
                placeholder={form.tags.length === 0 ? '回车添加标签' : ''}
                className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
              />
            </div>
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
            <span className="text-xs text-muted-foreground">未写入 .meta-data</span>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void actions.saveProject(project.id, buildPatch(), true)}
            >
              <FileText className="size-3.5" /> 写入 .meta-data
            </Button>
            <Button
              size="sm"
              onClick={() => void actions.saveProject(project.id, buildPatch(), false)}
            >
              <Save className="size-3.5" /> 保存
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
