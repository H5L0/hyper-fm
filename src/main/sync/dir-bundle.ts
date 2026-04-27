// ---------------------------------------------------------------------------
// 共享目录（bundleDir）：维护 index.json + devices/<id>/manifest.json + projects/<slug>.zip
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type BundleIndex,
  type BundleIndexEntry,
  type SyncManifest,
  type SyncProjectEntry,
  SYNC_BUNDLE_FILENAME,
  SYNC_INDEX_FILENAME,
  SYNC_SCHEMA,
  createEmptyBundleIndex,
} from '../../shared/sync-types.js';
import { FmError } from '../fm-error.js';

// ---------------------------------------------------------------------------
// 路径布局
// ---------------------------------------------------------------------------

export function devicesDir(bundleDir: string): string {
  return path.join(bundleDir, 'devices');
}

export function deviceDir(bundleDir: string, deviceId: string): string {
  return path.join(devicesDir(bundleDir), deviceId);
}

export function deviceManifestPath(bundleDir: string, deviceId: string): string {
  return path.join(deviceDir(bundleDir, deviceId), SYNC_BUNDLE_FILENAME);
}

export function deviceProjectsDir(bundleDir: string, deviceId: string): string {
  return path.join(deviceDir(bundleDir, deviceId), 'projects');
}

export function deviceProjectZipPath(bundleDir: string, deviceId: string, slug: string): string {
  return path.join(deviceProjectsDir(bundleDir, deviceId), `${slug}.zip`);
}

export function indexPath(bundleDir: string): string {
  return path.join(bundleDir, SYNC_INDEX_FILENAME);
}

// ---------------------------------------------------------------------------
// 原子写
// ---------------------------------------------------------------------------

async function writeAtomic(target: string, data: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, target);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(file, 'utf-8');
    return JSON.parse(buf) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new FmError('SYNC_BUNDLE_INVALID', `读取失败：${file}`, err);
  }
}

// ---------------------------------------------------------------------------
// index.json 读写
// ---------------------------------------------------------------------------

export async function ensureBundleDir(bundleDir: string): Promise<void> {
  if (!bundleDir) throw new FmError('SYNC_BUNDLE_DIR_MISSING', '未配置共享目录');
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.mkdir(devicesDir(bundleDir), { recursive: true });
}

export async function readBundleIndex(bundleDir: string): Promise<BundleIndex> {
  const data = await readJson<BundleIndex>(indexPath(bundleDir));
  if (!data) return createEmptyBundleIndex();
  if (data.schema !== SYNC_SCHEMA) {
    throw new FmError('SYNC_BUNDLE_INVALID', `index.schema 不匹配：${data.schema}`);
  }
  return data;
}

export async function writeBundleIndex(bundleDir: string, index: BundleIndex): Promise<void> {
  // 备份旧 index
  const filePath = indexPath(bundleDir);
  try {
    const old = await fs.readFile(filePath);
    await fs.writeFile(`${filePath}.bak`, old);
  } catch {
    /* 无旧文件 */
  }
  const text = JSON.stringify(index, null, 2);
  await writeAtomic(filePath, Buffer.from(text, 'utf-8'));
}

// ---------------------------------------------------------------------------
// 写入设备 manifest + 项目 zip
// ---------------------------------------------------------------------------

export async function writeDeviceManifest(
  bundleDir: string,
  manifest: SyncManifest,
): Promise<void> {
  const target = deviceManifestPath(bundleDir, manifest.device.id);
  const text = JSON.stringify(manifest, null, 2);
  await writeAtomic(target, Buffer.from(text, 'utf-8'));
}

export async function writeProjectZip(
  bundleDir: string,
  deviceId: string,
  slug: string,
  zipBytes: Uint8Array,
): Promise<void> {
  const target = deviceProjectZipPath(bundleDir, deviceId, slug);
  await writeAtomic(target, zipBytes);
}

export async function readDeviceManifest(
  bundleDir: string,
  deviceId: string,
): Promise<SyncManifest | null> {
  const data = await readJson<SyncManifest>(deviceManifestPath(bundleDir, deviceId));
  if (!data) return null;
  if (data.schema !== SYNC_SCHEMA) {
    throw new FmError('SYNC_BUNDLE_INVALID', `manifest.schema 不匹配：${data.schema}`);
  }
  return data;
}

export async function readProjectZip(
  bundleDir: string,
  deviceId: string,
  slug: string,
): Promise<Uint8Array> {
  const file = deviceProjectZipPath(bundleDir, deviceId, slug);
  try {
    const buf = await fs.readFile(file);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    throw new FmError('SYNC_BUNDLE_INVALID', `项目 zip 读取失败：${file}`, err);
  }
}

// ---------------------------------------------------------------------------
// 高层：推送当前设备 manifest + 项目集合到 bundleDir
// ---------------------------------------------------------------------------

export interface PushPlanItem {
  entry: SyncProjectEntry;
  zip: Uint8Array;
}

export interface PushResult {
  pushed: string[];
  index: BundleIndex;
}

export async function publishToBundleDir(
  bundleDir: string,
  manifest: SyncManifest,
  items: PushPlanItem[],
): Promise<PushResult> {
  await ensureBundleDir(bundleDir);
  await writeDeviceManifest(bundleDir, manifest);

  const pushedAt = new Date().toISOString();
  const index = await readBundleIndex(bundleDir);
  index.devices[manifest.device.id] = { name: manifest.device.name, updatedAt: pushedAt };

  const pushed: string[] = [];
  for (const item of items) {
    await writeProjectZip(bundleDir, manifest.device.id, item.entry.slug, item.zip);
    const indexEntry: BundleIndexEntry = {
      deviceId: manifest.device.id,
      slug: item.entry.slug,
      hash: item.entry.hash,
      modifiedAt: item.entry.modifiedAt,
      pushedAt,
    };
    index.latest[item.entry.id] = indexEntry;
    pushed.push(item.entry.id);
  }
  await writeBundleIndex(bundleDir, index);
  return { pushed, index };
}

/**
 * 列出共享目录中所有设备的 manifest（含本地设备）
 */
export async function listDeviceManifests(bundleDir: string): Promise<SyncManifest[]> {
  await ensureBundleDir(bundleDir);
  const dir = devicesDir(bundleDir);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: SyncManifest[] = [];
  for (const id of names) {
    const m = await readDeviceManifest(bundleDir, id);
    if (m) out.push(m);
  }
  return out;
}

/**
 * 把 bundleDir 中所有设备的最新 entry 合并成单个「远端汇总 manifest」。
 * 若同一 projectId 多个设备都有，取 index.latest 中记录的设备版本。
 */
export async function aggregateRemoteManifest(
  bundleDir: string,
  ownDeviceId: string,
): Promise<SyncManifest> {
  const index = await readBundleIndex(bundleDir);
  const manifests = await listDeviceManifests(bundleDir);
  const byDevice = new Map(manifests.map(m => [m.device.id, m]));
  const projects: SyncProjectEntry[] = [];
  for (const [projectId, latest] of Object.entries(index.latest)) {
    const m = byDevice.get(latest.deviceId);
    if (!m) continue;
    const entry = m.projects.find(p => p.id === projectId);
    if (entry) projects.push(entry);
  }
  return {
    schema: SYNC_SCHEMA,
    generatedAt: new Date().toISOString(),
    device: { id: '__bundle__', name: 'bundleDir' },
    projects: projects.filter(p => {
      const latest = index.latest[p.id];
      return latest ? latest.deviceId !== ownDeviceId : true;
    }),
  };
}
