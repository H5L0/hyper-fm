import { AppStoreProvider } from './store/app-store.js';
import { AppShell } from './components/app-shell.js';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  return (
    <AppStoreProvider>
      <AppShell />
    </AppStoreProvider>
  );
}
