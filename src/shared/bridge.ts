// ---------------------------------------------------------------------------
// Preload bridge contract
// ---------------------------------------------------------------------------

export interface AppInfo {
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  electronVersion: string;
}

export interface AppBridge {
  getAppInfo(): Promise<AppInfo>;
  ping(message: string): Promise<string>;
}
