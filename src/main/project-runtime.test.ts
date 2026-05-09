import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { listProjectRuntimeInfo } from './project-runtime.js';

const tempDirs: string[] = [];

async function createTempDir(prefix = 'fm-project-runtime-'): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('project-runtime', () => {
    test('[listProjectRuntimeInfo] 应返回目录当前修改时间', async () => {
        const dir = await createTempDir();
        const [info] = await listProjectRuntimeInfo([{ id: 'pj-demo', path: dir }]);

        expect(info).toMatchObject({ projectId: 'pj-demo' });
        expect(typeof info?.directoryModifiedAt).toBe('string');
    });

    test('[listProjectRuntimeInfo] 目录不存在时应返回 undefined', async () => {
        const dir = path.join(await createTempDir(), 'missing');
        const [info] = await listProjectRuntimeInfo([{ id: 'pj-missing', path: dir }]);

        expect(info).toEqual({ projectId: 'pj-missing', directoryModifiedAt: undefined });
    });
});