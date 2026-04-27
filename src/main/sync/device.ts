// ---------------------------------------------------------------------------
// 设备身份：保证 AppConfig.devices 存在，提供查询/更新已知设备
// ---------------------------------------------------------------------------

import os from 'node:os';
import type { AppConfig } from '../../shared/types.js';
import {
  type DeviceRegistry,
  type KnownDevice,
} from '../../shared/sync-types.js';
import { generateId, ID_PREFIX } from '../../shared/id.js';

export function createDeviceRegistry(displayName?: string): DeviceRegistry {
  const name = displayName?.trim() || os.hostname() || 'unknown-device';
  return {
    selfId: generateId(ID_PREFIX.device),
    selfName: name,
    known: [],
  };
}

/**
 * 若 config.devices 不存在则补全；否则原样返回
 */
export function ensureDeviceRegistry(config: AppConfig): {
  config: AppConfig;
  changed: boolean;
} {
  if (config.devices && config.devices.selfId && config.devices.selfName) {
    return { config, changed: false };
  }
  return {
    config: { ...config, devices: createDeviceRegistry() },
    changed: true,
  };
}

export function setSelfName(config: AppConfig, name: string): AppConfig {
  const trimmed = name.trim();
  if (!trimmed) return config;
  const reg = config.devices ?? createDeviceRegistry(trimmed);
  return {
    ...config,
    devices: { ...reg, selfName: trimmed },
  };
}

export function upsertKnownDevice(config: AppConfig, device: KnownDevice): AppConfig {
  const reg = config.devices ?? createDeviceRegistry();
  if (device.id === reg.selfId) return { ...config, devices: reg };
  const idx = reg.known.findIndex(d => d.id === device.id);
  const merged: KnownDevice =
    idx >= 0
      ? { ...reg.known[idx]!, ...device, lastSeenAt: device.lastSeenAt ?? new Date().toISOString() }
      : { ...device, lastSeenAt: device.lastSeenAt ?? new Date().toISOString() };
  const known =
    idx >= 0
      ? reg.known.map((d, i) => (i === idx ? merged : d))
      : [...reg.known, merged];
  return { ...config, devices: { ...reg, known } };
}

export function removeKnownDevice(config: AppConfig, id: string): AppConfig {
  if (!config.devices) return config;
  return {
    ...config,
    devices: { ...config.devices, known: config.devices.known.filter(d => d.id !== id) },
  };
}
