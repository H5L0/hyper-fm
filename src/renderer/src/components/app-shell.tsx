// ---------------------------------------------------------------------------
// AppShell：组合所有子组件
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { Sidebar } from './view/sidebar.js';
import { ScanSettingsPanel, SettingsPanel, SyncSettingsPanel } from './view/settings-panel.js';
import { TitleBar } from './view/title-bar.js';
import { Toolbar } from './view/toolbar.js';
import { ProjectBrowserView } from './view/project-browser-view.js';
import { ProjectInfoPanel } from './view/project-info-panel/project-info-panel.js';
import { Toaster } from './view/toaster.js';
import { ThemeEffect } from './theme-effect.js';
import { WarningsPanel } from './view/warnings-panel.js';
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
          ) : route === 'warnings' ? (
            <WarningsPanel />
          ) : route === 'scan-settings' ? (
            <ScanSettingsPanel />
          ) : route === 'sync-settings' ? (
            <SyncSettingsPanel />
          ) : route === 'settings' ? (
            <SettingsPanel />
          ) : (
            <>
              <Toolbar />
              <ProjectBrowserView />
            </>
          )}
        </main>
      </div>
      <ProjectInfoPanel />
      <Toaster />
    </div>
  );
}
