import { describe, expect, test } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildProjectSlug,
  buildProjectSnapshot,
  computeProjectHash,
} from './snapshot.js';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fm-snapshot-'));
}

async function writeTree(root: string, tree: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

describe('snapshot', () => {
  test('[buildProjectSlug] 应包含 basename 与短哈希', () => {
    const slug = buildProjectSlug('pj-abc123', '/tmp/My Project');
    expect(slug.startsWith('My_Project-')).toBe(true);
    expect(slug.length).toBeGreaterThan('My_Project-'.length);
  });

  test('[computeProjectHash] 应顺序无关', () => {
    const a = computeProjectHash([
      { path: 'a.txt', size: 1, mtime: '2026-01-01T00:00:00Z', sha1: 'aa' },
      { path: 'b.txt', size: 1, mtime: '2026-01-01T00:00:00Z', sha1: 'bb' },
    ]);
    const b = computeProjectHash([
      { path: 'b.txt', size: 1, mtime: '2026-01-01T00:00:00Z', sha1: 'bb' },
      { path: 'a.txt', size: 1, mtime: '2026-01-01T00:00:00Z', sha1: 'aa' },
    ]);
    expect(a).toBe(b);
  });

  test('[buildProjectSnapshot] 应遍历文件并应用 ignore', async () => {
    const dir = await tmpDir();
    await writeTree(dir, {
      'src/main.ts': 'console.log(1)',
      'src/lib.ts': 'export {}',
      'node_modules/junk.js': 'noop',
      'README.md': '# hi',
    });
    const entry = await buildProjectSnapshot({
      projectId: 'pj-xyz123',
      projectPath: dir,
      meta: { name: 'demo', tags: ['t'] },
      ignorePatterns: ['node_modules'],
    });
    const paths = entry.files.map(f => f.path).sort();
    expect(paths).toEqual(['README.md', 'src/lib.ts', 'src/main.ts']);
    expect(entry.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.id).toBe('pj-xyz123');
    expect(entry.meta.name).toBe('demo');
  });
});
