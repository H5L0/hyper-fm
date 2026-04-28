// ---------------------------------------------------------------------------
// 工具栏：搜索、视图切换、扫描、添加项目
// ---------------------------------------------------------------------------

import { useState, type KeyboardEvent } from 'react';
import { FolderPlus, LayoutGrid, List, RefreshCw, Search, X } from 'lucide-react';
import type { ManualProjectInput } from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

export function Toolbar() {
  const { search, view, scanProgress } = useAppState();
  const actions = useAppActions();
  const scanning = !!scanProgress?.running;
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-2.5">
      <div className="relative flex-1 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索项目名、标签、路径"
          value={search}
          onChange={e => actions.setSearch(e.target.value)}
          className="h-7 w-full rounded-md border border-border bg-background pr-2 pl-7 outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      <div className="flex h-7 items-center gap-0.5 rounded-md border border-border bg-background p-px">
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

      <Button
        size="sm"
        variant="outline"
        disabled={scanning}
        onClick={() => void actions.runScanAll()}
      >
        <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />
        {scanning ? '扫描中…' : '扫描'}
      </Button>

      <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAddOpen(true)}>
        <FolderPlus className="size-3.5" /> 添加项目
      </Button>

      {addOpen ? <AddProjectDialog onClose={() => setAddOpen(false)} /> : null}
    </div>
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
        'flex size-6 items-center justify-center rounded-sm',
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 添加项目对话框
// ---------------------------------------------------------------------------

function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const actions = useAppActions();
  const [form, setForm] = useState<ManualProjectInput & { tagsDraft: string }>({
    path: '',
    name: '',
    description: '',
    tags: [],
    tagsDraft: '',
  });
  const [busy, setBusy] = useState(false);

  const pickDir = async () => {
    const dir = await actions.pickProjectDirectory();
    if (dir) {
      const base = dir.split(/[/\\]/).filter(Boolean).pop() ?? '';
      setForm(f => ({ ...f, path: dir, name: f.name || base }));
    }
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (!t || form.tags?.includes(t)) return;
    setForm(f => ({ ...f, tags: [...(f.tags ?? []), t] }));
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(form.tagsDraft);
      setForm(f => ({ ...f, tagsDraft: '' }));
    } else if (e.key === 'Backspace' && form.tagsDraft === '' && (form.tags?.length ?? 0) > 0) {
      setForm(f => ({ ...f, tags: f.tags?.slice(0, -1) ?? [] }));
    }
  };

  const submit = async () => {
    if (!form.path.trim() || busy) return;
    setBusy(true);
    try {
      const project = await actions.addProject({
        path: form.path.trim(),
        name: form.name?.trim() || undefined,
        description: form.description?.trim() || undefined,
        tags: form.tags,
      });
      actions.toast('success', `已添加项目：${project.name}`);
      onClose();
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex h-11 items-center justify-between border-b border-border px-3">
          <h2 className="text-heading">添加项目</h2>
          <Button size="icon-xs" variant="ghost" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <DialogField label="路径">
            <div className="flex items-center gap-2">
              <input
                value={form.path}
                onChange={e => setForm(f => ({ ...f, path: e.target.value }))}
                placeholder="选择或粘贴项目目录"
                className="h-9 flex-1 rounded-md border border-border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button size="sm" variant="outline" onClick={() => void pickDir()}>
                浏览…
              </Button>
            </div>
          </DialogField>
          <DialogField label="名称">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="h-9 w-full rounded-md border border-border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </DialogField>
          <DialogField label="描述">
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full resize-none rounded-md border border-border bg-background p-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </DialogField>
          <DialogField label="标签">
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
              {form.tags?.map(t => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-caption text-secondary-foreground"
                >
                  #{t}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setForm(f => ({ ...f, tags: f.tags?.filter(x => x !== t) ?? [] }))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={form.tagsDraft}
                onChange={e => setForm(f => ({ ...f, tagsDraft: e.target.value }))}
                onKeyDown={onTagKey}
                placeholder={form.tags?.length === 0 ? '回车添加标签' : ''}
                className="flex-1 min-w-[80px] bg-transparent outline-none placeholder:text-muted-foreground/70"
              />
            </div>
          </DialogField>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/80 px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={!form.path.trim() || busy} onClick={() => void submit()}>
            添加
          </Button>
        </div>
      </div>
    </>
  );
}

function DialogField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-subheading mb-1.5 block text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
