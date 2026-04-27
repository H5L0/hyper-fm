import { useEffect, useState } from 'react';
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
    <div className="AppRoot">
      <header className="AppHeader">
        <h1>Electron Template</h1>
        {info && (
          <p className="AppMeta">
            {info.appName} · v{info.appVersion} · {info.platform} · Electron {info.electronVersion}
          </p>
        )}
      </header>
      <main className="AppMain">
        <button className="Button" type="button" onClick={handlePing}>
          Ping IPC
        </button>
        {pong && <pre className="OutputBox">{pong}</pre>}
      </main>
    </div>
  );
}
