// ---------------------------------------------------------------------------
// 侧边栏：标签筛选 + 设置入口
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AlertTriangle, FolderRoot, GitCompareArrows, Inbox, Pencil, Plus, Settings, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveTagColor } from '@/components/basic/tag-pill.js';
import {
  useAppActions,
  useAppState,
  type TagFilter,
} from '../../store/app-store.js';
import { NewTagDialog } from './new-tag-dialog.js';
import { TagGroupDialog } from './tag-group-dialog.js';

function isSameFilter(a: TagFilter, b: TagFilter): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object') {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag;
    if (a.kind === 'group' && b.kind === 'group') return a.group === b.group;
    return false;
  }
  return false;
}

export function Sidebar() {
  const { config, tagFilter, route } = useAppState();
  const actions = useAppActions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tagGroupDialogOpen, setTagGroupDialogOpen] = useState(false);
  const [editTag, setEditTag] = useState<{ name: string; color: string } | null>(null);
  const [editTagGroup, setEditTagGroup] = useState<{ name: string; tags: string[] } | null>(null);
  const [menu, setMenu] = useState<
    | { kind: 'tag'; x: number; y: number; tag: string; color: string }
    | { kind: 'group'; x: number; y: number; group: string; tags: string[] }
    | null
  >(null);
  const warningCount = config.warnings.length;

  const { allCount, tagCounts, tagGroupCounts } = useMemo(() => {
    let all = 0;
    const counts = new Map<string, number>();
    for (const p of config.projects) {
      all += 1;
      for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    // 合并已注册但项目中暂无的标签
    for (const def of config.tags ?? []) {
      if (!counts.has(def.name)) counts.set(def.name, 0);
    }
    const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const groupCounts = (config.tagGroups ?? [])
      .map(group => [
        group,
        group.tags.length === 0
          ? 0
          : config.projects.filter(project => group.tags.every(tag => project.tags.includes(tag))).length,
      ] as const)
      .sort((a, b) => a[0].name.localeCompare(b[0].name));
    return { allCount: all, tagCounts: sorted, tagGroupCounts: groupCounts };
  }, [config.projects, config.tags, config.tagGroups]);

  const isActive = (filter: TagFilter) =>
    route === 'browse' && isSameFilter(tagFilter, filter);

  const openTagMenu = (e: MouseEvent, tag: string) => {
    e.preventDefault();
    setMenu({
      kind: 'tag',
      x: e.clientX,
      y: e.clientY,
      tag,
      color: resolveTagColor(tag, config.tags),
    });
  };

  const openTagGroupMenu = (e: MouseEvent, group: { name: string; tags: string[] }) => {
    e.preventDefault();
    setMenu({
      kind: 'group',
      x: e.clientX,
      y: e.clientY,
      group: group.name,
      tags: group.tags,
    });
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <SidebarItem
          icon={<Inbox className="size-4" />}
          label="全部"
          count={allCount}
          active={isActive('ALL')}
          onClick={() => {
            actions.setRoute('browse');
            actions.setTagFilter('ALL');
          }}
        />

        <div className="mt-5 mb-1.5 flex items-center justify-between px-2">
          <span className="text-subheading text-muted-foreground/80">
            标签
          </span>
          <button
            type="button"
            aria-label="新建标签"
            onClick={() => setDialogOpen(true)}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {tagCounts.length === 0 ? (
          <p className="px-2 py-3 text-note text-muted-foreground">尚无标签</p>
        ) : (
          tagCounts.map(([tag, count]) => (
            <SidebarItem
              key={tag}
              icon={
                <Tag
                  className="size-4"
                  style={{ color: resolveTagColor(tag, config.tags) }}
                />
              }
              label={tag}
              count={count}
              active={isActive({ kind: 'tag', tag })}
              onClick={() => {
                actions.setRoute('browse');
                actions.setTagFilter({ kind: 'tag', tag });
              }}
              onContextMenu={e => openTagMenu(e, tag)}
            />
          ))
        )}

        <div className="mt-5 mb-1.5 flex items-center justify-between px-2">
          <span className="text-subheading text-muted-foreground/80">
            标签组
          </span>
          <button
            type="button"
            aria-label="新建标签组"
            onClick={() => setTagGroupDialogOpen(true)}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {tagGroupCounts.length === 0 ? (
          <p className="px-2 py-3 text-note text-muted-foreground">尚无标签组</p>
        ) : (
          tagGroupCounts.map(([group, count]) => (
            <SidebarItem
              key={group.name}
              icon={<Tag className="size-4 text-muted-foreground" />}
              label={group.name}
              count={count}
              title={group.tags.join(' · ')}
              active={isActive({ kind: 'group', group: group.name })}
              onClick={() => {
                actions.setRoute('browse');
                actions.setTagFilter({ kind: 'group', group: group.name });
              }}
              onContextMenu={e => openTagGroupMenu(e, group)}
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border p-2">
        {warningCount > 0 || route === 'warnings' ? (
          <SidebarFooterItem
            icon={<AlertTriangle className="size-4" />}
            label="警告"
            active={route === 'warnings'}
            badge={
              <span
                className={cn(
                  'ml-auto inline-flex items-center justify-center rounded-full bg-amber-500/15 text-caption tabular-nums text-amber-700 dark:text-amber-300',
                  warningCount < 10 ? 'size-5' : 'h-5 min-w-5 px-1.5',
                )}
              >
                {warningCount}
              </span>
            }
            onClick={() => actions.setRoute('warnings')}
          />
        ) : null}
        <SidebarFooterItem
          icon={<FolderRoot className="size-4" />}
          label="扫描设置"
          active={route === 'scan-settings'}
          onClick={() => actions.setRoute('scan-settings')}
        />
        <SidebarFooterItem
          icon={<GitCompareArrows className="size-4" />}
          label="同步设置"
          active={route === 'sync-settings'}
          onClick={() => actions.setRoute('sync-settings')}
        />
        <SidebarFooterItem
          icon={<Settings className="size-4" />}
          label="软件设置"
          active={route === 'settings'}
          onClick={() => actions.setRoute('settings')}
        />
      </div>

      {dialogOpen ? <NewTagDialog onClose={() => setDialogOpen(false)} /> : null}
      {editTag ? (
        <NewTagDialog initial={editTag} onClose={() => setEditTag(null)} />
      ) : null}
      {tagGroupDialogOpen ? <TagGroupDialog onClose={() => setTagGroupDialogOpen(false)} /> : null}
      {editTagGroup ? (
        <TagGroupDialog initial={editTagGroup} onClose={() => setEditTagGroup(null)} />
      ) : null}
      {menu ? (
        <SidebarContextMenu
          x={menu.x}
          y={menu.y}
          editLabel={menu.kind === 'tag' ? '修改标签' : '修改标签组'}
          onClose={() => setMenu(null)}
          onEdit={() => {
            if (menu.kind === 'tag') {
              setEditTag({ name: menu.tag, color: menu.color });
            } else {
              setEditTagGroup({ name: menu.group, tags: [...menu.tags] });
            }
            setMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
}

interface ItemProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  title?: string;
}

function SidebarItem({ icon, label, count, active, onClick, onContextMenu, title }: ItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={cn(
        'group flex h-8 items-center gap-2 rounded-md px-2 text-left transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-caption text-muted-foreground/80 tabular-nums">{count}</span>
    </button>
  );
}

function SidebarFooterItem({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 标签 / 标签组右键菜单
// ---------------------------------------------------------------------------

function SidebarContextMenu({
  x,
  y,
  editLabel,
  onClose,
  onEdit,
}: {
  x: number;
  y: number;
  editLabel: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: globalThis.MouseEvent) => {
      // 点击/右键到菜单以外的位置则关闭；事件不阻止，让目标继续接收原生交互
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onDown, true);
    };
  }, [onClose]);

  // 视口边界纠正
  const style: React.CSSProperties = { top: y, left: x };
  if (typeof window !== 'undefined') {
    const margin = 8;
    if (x + 180 + margin > window.innerWidth) style.left = window.innerWidth - 180 - margin;
    if (y + 80 + margin > window.innerHeight) style.top = window.innerHeight - 80 - margin;
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
      style={style}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onEdit}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
      >
        <Pencil className="size-4 text-muted-foreground" />
        {editLabel}
      </button>
    </div>
  );
}
