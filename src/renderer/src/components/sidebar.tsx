// ---------------------------------------------------------------------------
// 侧边栏：分类筛选 + 设置入口
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { Folder, FolderOpen, Inbox, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

export function Sidebar() {
  const { config, categoryFilter, route } = useAppState();
  const actions = useAppActions();

  const counts = useMemo(() => {
    const base = { all: 0, uncategorized: 0 } as Record<string, number>;
    for (const p of config.projects) {
      base.all = (base.all ?? 0) + 1;
      if (!p.categoryId) base.uncategorized = (base.uncategorized ?? 0) + 1;
      else base[p.categoryId] = (base[p.categoryId] ?? 0) + 1;
    }
    return base;
  }, [config.projects]);

  const isActive = (filter: string) => route === 'browse' && categoryFilter === filter;

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <SidebarItem
          icon={<Inbox className="size-3.5" />}
          label="全部"
          count={counts.all ?? 0}
          active={isActive('ALL')}
          onClick={() => {
            actions.setRoute('browse');
            actions.setCategoryFilter('ALL');
          }}
        />
        <SidebarItem
          icon={<Folder className="size-3.5" />}
          label="未分类"
          count={counts.uncategorized ?? 0}
          active={isActive('UNCATEGORIZED')}
          onClick={() => {
            actions.setRoute('browse');
            actions.setCategoryFilter('UNCATEGORIZED');
          }}
        />

        <div className="mt-4 mb-1 px-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/70 uppercase">
          分类
        </div>

        {config.categories.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">尚无分类</p>
        ) : (
          config.categories.map(cat => (
            <SidebarItem
              key={cat.id}
              icon={
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: cat.color ?? 'var(--muted-foreground)' }}
                />
              }
              label={cat.name}
              count={counts[cat.id] ?? 0}
              active={isActive(cat.id)}
              onClick={() => {
                actions.setRoute('browse');
                actions.setCategoryFilter(cat.id);
              }}
            />
          ))
        )}
      </div>

      <div className="border-t border-border p-2">
        <Button
          size="sm"
          variant={route === 'settings' ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          onClick={() => actions.setRoute('settings')}
        >
          <Settings className="size-3.5" /> 设置
        </Button>
      </div>
    </aside>
  );
}

interface ItemProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function SidebarItem({ icon, label, count, active, onClick }: ItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-7 items-center gap-2 rounded-md px-2 text-left text-[0.8rem] transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="flex size-4 items-center justify-center text-muted-foreground">
        {active ? <FolderOpenSwap fallback={icon} /> : icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[0.7rem] text-muted-foreground/80 tabular-nums">{count}</span>
    </button>
  );
}

// 仅在 active 时把 Folder 图标换成 FolderOpen，否则保留传入图标
function FolderOpenSwap({ fallback }: { fallback: React.ReactNode }) {
  if (
    typeof fallback === 'object' &&
    fallback &&
    (fallback as { type?: unknown }).type === Folder
  ) {
    return <FolderOpen className="size-3.5" />;
  }
  return <>{fallback}</>;
}
