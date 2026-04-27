// ---------------------------------------------------------------------------
// 主进程会话状态：当前已加载配置 + 路径
// 串行化所有改动以避免竞态写盘
// ---------------------------------------------------------------------------

import { createLogger } from '../shared/logger.js';
import type { AppConfig, ConfigSnapshot } from '../shared/types.js';
import { loadConfig, loadOrInitConfig, saveConfig } from './config-store.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:session');

interface SessionState {
  filePath: string;
  config: AppConfig;
}

let state: SessionState | null = null;
let writeChain: Promise<void> = Promise.resolve();

export async function initSession(filePath: string): Promise<ConfigSnapshot> {
  const snapshot = await loadOrInitConfig(filePath);
  state = { filePath: snapshot.path, config: snapshot.data };
  logger.info('会话已初始化', { filePath: snapshot.path });
  return snapshot;
}

export async function switchConfigFile(filePath: string): Promise<ConfigSnapshot> {
  const snapshot = await loadConfig(filePath);
  state = { filePath: snapshot.path, config: snapshot.data };
  logger.info('已切换配置', { filePath: snapshot.path });
  return snapshot;
}

export function requireSession(): SessionState {
  if (!state) throw new FmError('INTERNAL', '会话尚未初始化');
  return state;
}

export function getSnapshot(): ConfigSnapshot {
  const s = requireSession();
  return { path: s.filePath, data: s.config };
}

/**
 * 串行执行写操作：mutator 接收当前 config 返回新 config，自动写盘并更新内存。
 */
export function mutate<T>(
  mutator: (config: AppConfig) => Promise<{ next: AppConfig; result: T }> | { next: AppConfig; result: T },
): Promise<T> {
  const run = async (): Promise<T> => {
    const session = requireSession();
    const out = await mutator(session.config);
    await saveConfig(session.filePath, out.next);
    state = { filePath: session.filePath, config: out.next };
    return out.result;
  };
  const queued = writeChain.then(run, run);
  writeChain = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}
