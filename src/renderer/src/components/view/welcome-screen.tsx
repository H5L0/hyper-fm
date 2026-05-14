import { FolderOpen, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppActions } from '@/store/app-store.js';

export function WelcomeScreen() {
  const actions = useAppActions();

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <div className="space-y-2">
          <h1 className="text-display">欢迎使用 fm</h1>
          <p className="text-note leading-6 text-muted-foreground">
            当前还没有可用配置。打开一份已有配置，或创建新配置。
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => void actions.pickAndLoadConfig()}>
            <FolderOpen className="size-4" /> 打开已有配置
          </Button>
          <Button variant="outline" onClick={() => void actions.pickAndCreateConfig()}>
            <FolderPlus className="size-4" /> 选择目录并创建
          </Button>
        </div>
      </div>
    </div>
  );
}
