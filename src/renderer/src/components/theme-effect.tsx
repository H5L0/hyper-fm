// ---------------------------------------------------------------------------
// 主题应用：根据 ui.theme 切换 .dark class
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { useAppState } from '../store/app-store.js';

export function ThemeEffect() {
  const { appPreferences } = useAppState();
  useEffect(() => {
    const apply = () => {
      const pref = appPreferences.ui.theme;
      const wantDark =
        pref === 'dark' ||
        (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', wantDark);
    };
    apply();
    if (appPreferences.ui.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appPreferences.ui.theme]);
  return null;
}
