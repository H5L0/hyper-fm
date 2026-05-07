// ---------------------------------------------------------------------------
// 主进程会话状态：当前已加载的 shared/local 配置 + 合并视图
// 串行化所有改动以避免竞态写盘
// ---------------------------------------------------------------------------

import { composeAppConfig, createDefaultConfig, mergeAppConfigIntoLocal, mergeAppConfigIntoShared } from '../shared/schema.js';
import { createLogger } from '../shared/logger.js';
import type { AppConfig, ConfigSnapshot, LocalConfig, SharedConfig } from '../shared/types.js';
import { loadConfig, loadLocalConfig, loadOrInitConfig, loadSharedConfig, saveConfig } from './config-store.js';
import { FmError } from './fm-error.js';

const logger = createLogger('main:session');

interface SessionState {
    sharedPath: string;
    localPath: string;
    shared: SharedConfig;
    local: LocalConfig;
    config: AppConfig;
}

let state: SessionState | null = null;
let writeChain: Promise<void> = Promise.resolve();

function buildState(snapshot: ConfigSnapshot, shared: SharedConfig, local: LocalConfig): SessionState {
    return {
        sharedPath: snapshot.paths.sharedPath,
        localPath: snapshot.paths.localPath,
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

export function getSnapshot(): ConfigSnapshot {
    const s = state;
    if (!s) {
        return {
            paths: { sharedPath: '', localPath: '' },
            data: createDefaultConfig(),
            hasLoadedConfig: false,
        };
    }
    return {
        paths: { sharedPath: s.sharedPath, localPath: s.localPath },
        data: s.config,
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
            nextLocal = mergeAppConfigIntoLocal(out.nextConfig, session.sharedPath);
        }
        nextLocal = { ...nextLocal, sharedConfigPath: session.sharedPath };
        const nextConfig = composeAppConfig(nextShared, nextLocal);

        await saveConfig(
            { sharedPath: session.sharedPath, localPath: session.localPath },
            nextShared,
            nextLocal,
        );

        state = {
            sharedPath: session.sharedPath,
            localPath: session.localPath,
            shared: nextShared,
            local: nextLocal,
            config: nextConfig,
        };
        return out.result;
    };

    const queued = writeChain.then(run, run);
    writeChain = queued.then(
        () => undefined,
        () => undefined,
    );
    return queued;
}
