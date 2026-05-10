// ---------------------------------------------------------------------------
// 主进程会话状态：当前已加载的 shared/local 配置 + 合并视图
// 串行化所有改动以避免竞态写盘
// ---------------------------------------------------------------------------

import { composeAppConfig, createDefaultConfig, mergeAppConfigIntoLocal, mergeAppConfigIntoShared } from '../shared/schema.js';
import { createLogger } from '../shared/logger.js';
import type { AppConfig, ConfigPaths, ConfigSnapshot, LocalConfig, SharedConfig } from '../shared/types.js';
import { loadConfig, loadLocalConfig, loadOrInitConfig, loadSharedConfig, saveConfig } from './config-store.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:session');

interface SessionState {
    sharedPath: string;
    localPath: string;
    configId: string;
    shared: SharedConfig;
    local: LocalConfig;
    config: AppConfig;
}

let state: SessionState | null = null;
let writeChain: Promise<void> = Promise.resolve();
let onConfigChanged: (() => void) | null = null;

export function setOnConfigChanged(listener: (() => void) | null): void {
    onConfigChanged = listener;
}

function buildState(snapshot: ConfigSnapshot, shared: SharedConfig, local: LocalConfig): SessionState {
    return {
        sharedPath: snapshot.paths.sharedPath,
        localPath: snapshot.paths.localPath,
        configId: snapshot.paths.configId,
        shared,
        local,
        config: snapshot.data,
    };
}

export async function initSession(sharedPath: string): Promise<ConfigSnapshot> {
    const snapshot = await loadOrInitConfig(sharedPath);
    const [shared, local] = await Promise.all([
        loadSharedConfig(snapshot.paths.sharedPath),
        loadLocalConfig(snapshot.paths.localPath),
    ]);
    state = buildState(snapshot, shared, local);
    logger.info('会话已初始化', { paths: snapshot.paths });
    return snapshot;
}

export async function switchConfigFile(sharedPath: string): Promise<ConfigSnapshot> {
    const snapshot = await loadConfig(sharedPath);
    const [shared, local] = await Promise.all([
        loadSharedConfig(snapshot.paths.sharedPath),
        loadLocalConfig(snapshot.paths.localPath),
    ]);
    state = buildState(snapshot, shared, local);
    logger.info('已切换配置', { paths: snapshot.paths });
    return snapshot;
}

export function requireSession(): SessionState {
    if (!state) throw new FmError('INTERNAL', '会话尚未初始化');
    return state;
}

function getPaths(): ConfigPaths {
    const s = state;
    return {
        sharedPath: s?.sharedPath ?? '',
        localPath: s?.localPath ?? '',
        configId: s?.configId ?? '',
    };
}

export function getSnapshot(): ConfigSnapshot {
    if (!state) {
        return {
            paths: { sharedPath: '', localPath: '', configId: '' },
            data: createDefaultConfig(),
            hasLoadedConfig: false,
        };
    }
    return {
        paths: getPaths(),
        data: state.config,
        hasLoadedConfig: true,
    };
}

/**
 * 串行执行写操作：mutator 接收当前 shared/local/config 视图并返回更新结果。
 */
export function mutate<T>(
    mutator: (input: {
        shared: SharedConfig;
        local: LocalConfig;
        config: AppConfig;
    }) => Promise<{
        nextShared?: SharedConfig;
        nextLocal?: LocalConfig;
        nextConfig?: AppConfig;
        result: T;
    }> | {
        nextShared?: SharedConfig;
        nextLocal?: LocalConfig;
        nextConfig?: AppConfig;
        result: T;
    },
): Promise<T> {
    const run = async (): Promise<T> => {
        const session = requireSession();
        const out = await mutator({
            shared: session.shared,
            local: session.local,
            config: session.config,
        });

        let nextShared = out.nextShared ?? session.shared;
        let nextLocal = out.nextLocal ?? session.local;
        if (out.nextConfig) {
            nextShared = mergeAppConfigIntoShared(nextShared, out.nextConfig);
            nextLocal = mergeAppConfigIntoLocal(out.nextConfig, nextShared);
        }
        const nextConfig = composeAppConfig(nextShared, nextLocal);

        await saveConfig(getPaths(), nextShared, nextLocal);

        state = {
            sharedPath: session.sharedPath,
            localPath: session.localPath,
            configId: session.configId,
            shared: nextShared,
            local: nextLocal,
            config: nextConfig,
        };
        onConfigChanged?.();
        return out.result;
    };

    const queued = writeChain.then(run, run);
    writeChain = queued.then(
        () => undefined,
        () => undefined,
    );
    return queued;
}
