// ---------------------------------------------------------------------------
// 顶栏：显示当前配置路径，支持切换
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppActions, useAppState } from '../../store/app-store.js';
import { ConfigMetaDialog } from './config-meta-dialog.js';

export function TitleBar() {
  const { config, configPaths, hasLoadedConfig } = useAppState();
  const actions = useAppActions();
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);

  const configName = hasLoadedConfig ? (config.name?.trim() || '未命名配置') : '未加载配置';

  return (
    <header className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 text-muted-foreground select-none">
      <div className="flex items-center gap-1.5">
        <span className="text-foreground font-semibold tracking-tight">fm</span>
        <span className="text-border">/</span>
        <div className="group relative min-w-0">
          <button
            type="button"
            className="max-w-90 truncate rounded px-1 py-0.5 text-note text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {configName}
          </button>
          <div className="pointer-events-none absolute top-full left-0 z-50 mt-2 hidden w-130 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover px-3 py-3 text-left shadow-lg group-hover:block group-focus-within:block">
            <p className="text-subheading text-foreground">{configName}</p>
            {config.description ? (
              <p className="mt-1 text-note text-muted-foreground">{config.description}</p>
            ) : null}
            <div className="mt-3 space-y-2 text-note text-muted-foreground">
              <div>
                <span className="text-foreground">共享配置</span>
                <p className="mt-0.5 break-all">{configPaths.sharedPath || '未加载'}</p>
              </div>
              <div>
                <span className="text-foreground">本地配置</span>
                <p className="mt-0.5 break-all">{configPaths.localPath || '未加载'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button size="xs" variant="ghost" onClick={() => void actions.pickAndLoadConfig()}>
          打开…
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void actions.pickAndCreateConfig()}>
          新建…
        </Button>
        <Button size="xs" variant="ghost" disabled={!hasLoadedConfig} onClick={() => setMetaDialogOpen(true)}>
          编辑…
        </Button>
      </div>

      {metaDialogOpen && hasLoadedConfig ? (
        <ConfigMetaDialog
          initialName={config.name}
          initialDescription={config.description ?? ''}
          onClose={() => setMetaDialogOpen(false)}
          onSave={async (name, description) => {
            try {
              await actions.saveConfigMeta(name, description);
              actions.toast('success', '已保存配置元信息');
              setMetaDialogOpen(false);
            } catch (error) {
              actions.toast('error', error instanceof Error ? error.message : '保存失败');
            }
          }}
        />
      ) : null}
    </header>
  );
}
