// ---------------------------------------------------------------------------
// 顶栏：显示当前配置路径，支持切换
// ---------------------------------------------------------------------------

import { Button } from '@/components/ui/button';
import { useAppActions, useAppState } from '../store/app-store.js';

export function TitleBar() {
  const { configPath } = useAppState();
  const actions = useAppActions();

  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 text-muted-foreground select-none">
      <div className="flex items-center gap-2">
        <span className="text-foreground font-semibold tracking-tight">fm</span>
        <span className="text-border">/</span>
        <span className="truncate text-note" title={configPath}>
          {configPath || '未加载配置'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => void actions.pickAndLoadConfig()}>
          打开…
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void actions.pickAndCreateConfig()}>
          新建…
        </Button>
      </div>
    </header>
  );
}
