import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AppInfo } from '../../shared/bridge.js';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [pong, setPong] = useState<string>('');

  useEffect(() => {
    void window.app.getAppInfo().then(setInfo);
  }, []);

  const handlePing = async () => {
    const reply = await window.app.ping(new Date().toISOString());
    setPong(reply);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Electron Template</h1>
        {info ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {info.appName} · v{info.appVersion} · {info.platform} · Electron {info.electronVersion}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Loading runtime info…</p>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-4 p-6">
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-medium text-foreground">IPC 演示</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            点击下方按钮触发 <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">app:ping</code> 通道。
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handlePing}>Ping IPC</Button>
            {pong ? (
              <span className="text-xs text-muted-foreground">最近一次响应已更新</span>
            ) : null}
          </div>
          {pong ? (
            <pre className="mt-4 overflow-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground">
              {pong}
            </pre>
          ) : null}
        </section>
      </main>
    </div>
  );
}
