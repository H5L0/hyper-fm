import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { expandProjectDirectory, findMatchingProjectsForDirectory, inspectProjectDirectory, listProjectGitignoreFiles } from './project-matcher.js';
import { writeMetaFile } from './meta-file.js';
import type { SharedProject } from '../shared/types.js';

async function createProjectDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-inspect-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules', 'demo'), { recursive: true });
    await fs.mkdir(path.join(root, 'packages', 'demo', 'nested'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main.ts'), 'console.log("ok")\n');
    await fs.writeFile(path.join(root, 'README.md'), '# demo\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'dist\ncoverage\n');
    await fs.writeFile(path.join(root, 'packages', 'demo', '.gitignore'), 'node_modules\n');
    await fs.writeFile(path.join(root, 'packages', 'demo', 'nested', '.gitignore'), '.cache\n');
    await fs.writeFile(path.join(root, 'node_modules', 'demo', 'index.js'), 'module.exports = {}\n');
    await writeMetaFile(root, { projectId: 'pj-demo01', name: 'demo' });
    return root;
}

describe('project-matcher', () => {
    test('[inspectProjectDirectory] summary 模式应仅预加载首层目录并保留忽略状态', async () => {
        const dir = await createProjectDir();
        const inspection = await inspectProjectDirectory(dir, {
            globalIgnore: ['node_modules'],
            projectIgnore: ['README.md'],
            mode: 'summary',
        });

        expect(inspection.hasMetaFile).toBe(true);
        expect(inspection.metaProjectId).toBe('pj-demo01');
        expect(inspection.files).toEqual(['.gitignore', '.meta-data']);
        expect(inspection.filesComplete).toBe(false);

        const nodeModules = inspection.tree.find(item => item.path === 'node_modules');
        const readme = inspection.tree.find(item => item.path === 'README.md');
        const src = inspection.tree.find(item => item.path === 'src');

        expect(nodeModules?.ignoredBy).toBe('global');
        expect(nodeModules?.childrenLoaded).toBe(false);
        expect(readme?.ignoredBy).toBe('project');
        expect(src?.childrenLoaded).toBe(false);
        expect(src?.children).toBeUndefined();
    });

    test('[inspectProjectDirectory] full 模式应完整扫描目录树并收集全部可选文件', async () => {
        const dir = await createProjectDir();
        const inspection = await inspectProjectDirectory(dir, {
            globalIgnore: ['node_modules'],
            projectIgnore: ['README.md'],
            mode: 'full',
        });

        expect(inspection.files).toEqual(['.gitignore', '.meta-data', 'packages/demo/.gitignore', 'packages/demo/nested/.gitignore', 'src/main.ts']);
        expect(inspection.filesComplete).toBe(true);

        const src = inspection.tree.find(item => item.path === 'src');
        expect(src?.childrenLoaded).toBe(true);
        expect(src?.children?.[0]?.path).toBe('src/main.ts');
    });

    test('[expandProjectDirectory] interactive 模式应按目录展开子树', async () => {
        const dir = await createProjectDir();

        const expanded = await expandProjectDirectory(dir, 'src', {
            globalIgnore: ['node_modules'],
            projectIgnore: ['README.md'],
            mode: 'interactive',
        });

        expect(expanded.parentPath).toBe('src');
        expect(expanded.entries.map(entry => entry.path)).toEqual(['src/main.ts']);
    });

    test('[findMatchingProjectsForDirectory] inspection 不完整时也应按文件指纹做定向匹配', async () => {
        const dir = await createProjectDir();
        const inspection = await inspectProjectDirectory(dir, {
            globalIgnore: ['node_modules'],
            projectIgnore: ['README.md'],
            mode: 'summary',
        });
        const projects: SharedProject[] = [{
            id: 'pj-demo01',
            name: 'demo',
            description: '',
            tags: [],
            ignore: [],
            fingerprint: { kind: 'file-paths', paths: ['src/main.ts'] },
        }];

        const matched = await findMatchingProjectsForDirectory(projects, inspection);

        expect(matched.map(project => project.id)).toEqual(['pj-demo01']);
    });

    test('[listProjectGitignoreFiles] 应递归返回所有层级的 .gitignore 预览', async () => {
        const dir = await createProjectDir();

        const previews = await listProjectGitignoreFiles(dir, {
            globalIgnore: ['node_modules'],
            projectIgnore: ['packages/demo'],
        });

        expect(previews).toEqual([
            {
                path: '.gitignore',
                content: 'dist\ncoverage\n',
                truncated: false,
            },
            {
                path: 'packages/demo/.gitignore',
                content: 'node_modules\n',
                truncated: false,
            },
            {
                path: 'packages/demo/nested/.gitignore',
                content: '.cache\n',
                truncated: false,
            },
        ]);
    });
});