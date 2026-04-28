// ---------------------------------------------------------------------------
// 标签对话框：新建/编辑共用，名称 + 颜色
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';
import { DEFAULT_TAG_COLOR, TagPill } from './tag-pill.js';

const TAG_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#94a3b8', '#64748b',
];

export function NewTagDialog({
  initial,
  onClose,
  onCreated,
}: {
  /** 提供则进入编辑模式 */
  initial?: { name: string; color: string };
  onClose: () => void;
  onCreated?: (name: string) => void;
}) {
  const { config } = useAppState();
  const actions = useAppActions();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_TAG_COLOR);
  const [busy, setBusy] = useState(false);

  const dirty = editing
    ? name.trim() !== initial!.name || color !== initial!.color
    : name.trim().length > 0;

  const submit = async () => {
    const n = name.trim().replace(/^#/, '');
    if (!n || busy) return;
    setBusy(true);
    try {
      if (editing) {
        const oldName = initial!.name;
        if (n !== oldName) {
          // 检查重名
          if ((config.tags ?? []).some(t => t.name === n)) {
            actions.toast('error', `标签已存在：${n}`);
            return;
          }
          await actions.renameTag(oldName, n);
        }
        if (color !== initial!.color || n !== oldName) {
          await actions.upsertTag({ name: n, color });
        }
        actions.toast('success', `已更新标签 ${n}`);
      } else {
        const exists = (config.tags ?? []).some(t => t.name === n);
        await actions.upsertTag({ name: n, color });
        actions.toast('success', exists ? `已更新标签 ${n}` : `已添加标签 ${n}`);
      }
      onCreated?.(n);
      onClose();
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
        className="fixed top-1/2 left-1/2 z-50 w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      >
        <div className="flex h-11 items-center justify-between border-b border-border px-3">
          <h2 className="text-heading">{editing ? '修改标签' : '新建标签'}</h2>
          <Button size="icon-xs" variant="ghost" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="text-subheading mb-1.5 block text-muted-foreground">
              名称
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder="如：unity"
              className="h-9 w-full rounded-md border border-border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          <div>
            <label className="text-subheading mb-1.5 block text-muted-foreground">
              颜色
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TAG_COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  aria-label={`选择颜色 ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-6 rounded-full border transition-transform',
                    color === c
                      ? 'border-foreground/60 ring-2 ring-ring/50'
                      : 'border-border hover:scale-110',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label
                className="relative inline-flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border text-caption text-muted-foreground hover:text-foreground"
                title="自定义颜色"
              >
                #
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <span className="text-caption text-muted-foreground">预览：</span>
            <TagPill name={name.trim() || '示例'} color={color} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/80 px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={!dirty || busy} onClick={() => void submit()}>
            {editing ? '保存' : '添加'}
          </Button>
        </div>
      </div>
    </>
  );
}
