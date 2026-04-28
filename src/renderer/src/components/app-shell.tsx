// ---------------------------------------------------------------------------
// AppShell：组合所有子组件
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { Sidebar } from './sidebar.js';
import { TitleBar } from './title-bar.js';
import { Toolbar } from './toolbar.js';
import { ProjectGrid } from './project-grid.js';
import { ProjectDrawer } from './project-drawer.js';
import { SettingsPanel } from './settings-panel.js';
import { Toaster } from './toaster.js';
import { ThemeEffect } from './theme-effect.js';
import { useAppActions, useAppState } from '../store/app-store.js';

export function AppShell() {
  const { route, ready } = useAppState();
  const actions = useAppActions();

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[type="text"]');
        input?.focus();
      } else if (e.key.toLowerCase() === 'g') {
        actions.setView('grid');
      } else if (e.key.toLowerCase() === 'r') {
        void actions.runScanAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ThemeEffect />
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          {!ready ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              加载中…
            </div>
          ) : route === 'settings' ? (
            <SettingsPanel />
          ) : (
            <>
              <Toolbar />
              <ProjectGrid />
            </>
          )}
        </main>
      </div>
      <ProjectDrawer />
      <Toaster />
    </div>
  );
}
