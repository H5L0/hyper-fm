import type { AppBridge, FmBridge } from '../../shared/bridge.js';

declare global {
  interface Window {
    app: AppBridge;
    fm: FmBridge;
  }
}

export {};
