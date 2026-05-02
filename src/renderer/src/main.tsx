import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ensureBrowserBridge } from './browser-bridge';
import '../index.css';

ensureBrowserBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
