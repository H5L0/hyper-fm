import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { inspectProjectDirectory } from './project-matcher.js';
import { writeMetaFile } from './meta-file.js';

async function createProjectDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-inspect-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules', 'demo'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main.ts'), 'console.log("ok")\n');
    await fs.writeFile(path.join(root, 'README.md'), '# demo\n');
    await fs.writeFile(path.join(root, 'node_modules', 'demo', 'index.js'), 'module.exports = {}\n');
    await writeMetaFile(root, { projectId: 'pj-demo01', name: 'demo' });
    return root;
}

describe('project-matcher', () => {
    test('[inspectProjectDirectory] 应返回忽略态文件树并过滤可选文件', async () => {
        const dir = await createProjectDir();
        const inspection = await inspectProjectDirectory(dir, {
            globalIgnore: ['node_modules'],
            projectIgnore: ['README.md'],
        });

        expect(inspection.hasMetaFile).toBe(true);
        expect(inspection.metaProjectId).toBe('pj-demo01');
        expect(inspection.files).toEqual(['.meta-data', 'src/main.ts']);

        const nodeModules = inspection.tree.find(item => item.path === 'node_modules');
        const readme = inspection.tree.find(item => item.path === 'README.md');
        const src = inspection.tree.find(item => item.path === 'src');

        expect(nodeModules?.ignoredBy).toBe('global');
        expect(nodeModules?.children).toBeUndefined();
        expect(readme?.ignoredBy).toBe('project');
        expect(src?.children?.[0]?.path).toBe('src/main.ts');
    });
});