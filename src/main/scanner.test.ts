import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRoot } from './scanner.js';
import { writeMetaFile } from './meta-file.js';

async function makeTree(spec: Record<string, string | null>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-scan-'));
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(root, rel);
    if (content === null) {
      await fs.mkdir(abs, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }
  }
  return root;
}

describe('scanner', () => {
  test('[scanRoot] 含 package.json 的目录应被识别为项目', async () => {
    const root = await makeTree({
      'projects/api/package.json': '{}',
      'projects/api/src/index.ts': '',
      'projects/notes/README.md': '#',
    });
    const candidates = await scanRoot({
      rootPath: root,
      maxDepth: 3,
      ignoreGlobs: ['node_modules'],
      respectGitignore: false,
    });
    const names = candidates.map(c => c.name).sort();
    expect(names).toContain('api');
  });

  test('[scanRoot] 应尊重 ignoreGlobs', async () => {
    const root = await makeTree({
      'projects/web/package.json': '{}',
      'projects/web/node_modules/x/index.js': '',
    });
    const candidates = await scanRoot({
      rootPath: root,
      maxDepth: 4,
      ignoreGlobs: ['node_modules'],
      respectGitignore: false,
    });
    expect(candidates.every(c => !c.path.includes('node_modules'))).toBe(true);
  });

  test('[scanRoot] 含 .meta-data 的目录应优先识别', async () => {
    const root = await makeTree({ 'projects/game/Assets/Foo.cs': 'x' });
    await writeMetaFile(path.join(root, 'projects/game'), { name: 'Game' });
    const candidates = await scanRoot({
      rootPath: root,
      maxDepth: 5,
      ignoreGlobs: [],
      respectGitignore: false,
    });
    const game = candidates.find(c => c.name === 'game');
    expect(game?.hasMetaFile).toBe(true);
  });

  test('[scanRoot] 触底无标志的目录应作为项目入库', async () => {
    const root = await makeTree({ 'projects/docs/note.md': 'x' });
    const candidates = await scanRoot({
      rootPath: root,
      maxDepth: 2,
      ignoreGlobs: [],
      respectGitignore: false,
    });
    const names = candidates.map(c => c.name);
    // maxDepth=2 时叶子是 docs，应作为项目入库
    expect(names).toContain('docs');
  });

  test('[scanRoot] 进度回调应至少触发一次', async () => {
    const root = await makeTree({ 'a/package.json': '{}' });
    let calls = 0;
    await scanRoot({
      rootPath: root,
      maxDepth: 2,
      ignoreGlobs: [],
      respectGitignore: false,
      onProgress: () => {
        calls++;
      },
    });
    expect(calls).toBeGreaterThan(0);
  });

  test('[scanRoot] 应支持精确忽略特定目录路径', async () => {
    const root = await makeTree({
      'projects/a/package.json': '{}',
      'projects/b/package.json': '{}',
    });
    const candidates = await scanRoot({
      rootPath: root,
      maxDepth: 3,
      ignoreGlobs: [],
      exactIgnorePaths: [path.join(root, 'projects/b')],
      respectGitignore: false,
    });
    expect(candidates.some(c => c.path.endsWith('/projects/b'))).toBe(false);
    expect(candidates.some(c => c.path.endsWith('/projects/a'))).toBe(true);
  });

  test('[scanRoot] 应支持精确忽略特定目录路径', async () => {
    const root = await makeTree({
      'projects/a/package.json': '{}',
      'projects/b/package.json': '{}',
    });
    const candidates = await scanRoot({
      rootPath: root,
      maxDepth: 3,
      ignoreGlobs: [],
      exactIgnorePaths: [path.join(root, 'projects/b')],
      respectGitignore: false,
    });
    expect(candidates.some(c => c.path.endsWith('/projects/b'))).toBe(false);
    expect(candidates.some(c => c.path.endsWith('/projects/a'))).toBe(true);
  });
});
