// ---------------------------------------------------------------------------
// 工具栏：搜索、视图切换、扫描
// ---------------------------------------------------------------------------

import { LayoutGrid, List, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

export function Toolbar() {
  const { search, view, scanProgress } = useAppState();
  const actions = useAppActions();
  const scanning = !!scanProgress?.running;

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card/40 px-3">
      <div className="relative flex-1 max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索项目名、标签、路径"
          value={search}
          onChange={e => actions.setSearch(e.target.value)}
          className="h-7 w-full rounded-md border border-border bg-background pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
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
        'flex size-6 items-center justify-center rounded',
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
    </button>
  );
}
