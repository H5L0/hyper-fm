import type { AppBridge } from '../../shared/bridge.js';

declare global {
  interface Window {
    app: AppBridge;
  }
}

export {};
