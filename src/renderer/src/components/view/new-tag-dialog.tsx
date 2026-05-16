// ---------------------------------------------------------------------------
// 标签对话框：新建/编辑共用，名称 + 颜色
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { isDynamicTagLabel } from '@shared/dynamic-tags.js';
import { Button } from '@/components/ui/button';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { DEFAULT_TAG_COLOR, TagPill } from '@/components/basic/tag-pill.js';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../../store/app-store.js';

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
  const normalizedColor = color.toLowerCase();
  const customColorSelected = !TAG_COLOR_PRESETS.includes(normalizedColor);

  const dirty = editing
    ? name.trim() !== initial!.name || color !== initial!.color
    : name.trim().length > 0;

  const submit = async () => {
    const n = name.trim().replace(/^#/, '');
    if (!n || busy) return;
    if (isDynamicTagLabel(n)) {
      actions.toast('error', `“${n}” 是系统内置动态标签，请换一个名称。`);
      return;
    }
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
    <EditDialogShell
      title={editing ? '修改标签' : '新建标签'}
      onClose={onClose}
      panelClassName="w-[min(420px,calc(100vw-2rem))]"
      bodyClassName="space-y-4"
      footerEnd={(
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={!dirty || busy} onClick={() => void submit()}>
            {editing ? '保存' : '添加'}
          </Button>
        </>
      )}
    >
      <EditDialogField label="名称">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="如：Game"
          className="h-9 w-full rounded-md border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>

      <EditDialogField label="颜色">
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
            className={cn(
              'relative inline-flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-transform',
              customColorSelected
                ? 'border-foreground/60 ring-2 ring-ring/50'
                : 'border-border hover:scale-110',
            )}
            title="自定义颜色"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0.5 rounded-full blur-[1px]"
              style={{
                background: 'conic-gradient(from 220deg, #fb7185, #f59e0b, #fde047, #4ade80, #22d3ee, #60a5fa, #a78bfa, #f472b6, #fb7185)',
              }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-1 rounded-full opacity-90"
              style={{
                background: 'radial-gradient(circle at 28% 28%, rgba(255,255,255,0.72), transparent 34%), radial-gradient(circle at 72% 32%, rgba(251,113,133,0.6), transparent 38%), radial-gradient(circle at 56% 72%, rgba(59,130,246,0.65), transparent 42%), radial-gradient(circle at 34% 72%, rgba(74,222,128,0.48), transparent 40%)',
                mixBlendMode: 'screen',
              }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0.75 rounded-full border border-white/20"
            />
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              aria-label="选择自定义颜色"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </EditDialogField>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <span className="text-caption text-muted-foreground">预览：</span>
        <TagPill name={name.trim() || '示例'} color={color} />
      </div>
    </EditDialogShell>
  );
}
