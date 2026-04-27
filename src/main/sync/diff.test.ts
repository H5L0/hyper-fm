import { describe, expect, test } from 'vitest';
import { diffManifests, diffLocalOnly } from './diff.js';
import type { SyncManifest, SyncProjectEntry } from '../../shared/sync-types.js';

function entry(id: string, hash: string, modifiedAt: string): SyncProjectEntry {
  return {
    id,
    slug: `${id}-slug`,
    meta: { name: id, tags: [] },
    files: [],
    hash,
    modifiedAt,
  };
}

function manifest(deviceId: string, projects: SyncProjectEntry[]): SyncManifest {
  return {
    schema: 'fm.sync/v1',
    generatedAt: '2026-01-01T00:00:00Z',
    device: { id: deviceId, name: deviceId },
    projects,
  };
}

describe('diff', () => {
  test('[diffManifests] hash 一致应标记 identical', () => {
    const local = manifest('A', [entry('p1', 'h1', '2026-01-01T00:00:00Z')]);
    const remote = manifest('B', [entry('p1', 'h1', '2026-01-01T00:00:00Z')]);
    const d = diffManifests(local, remote);
    expect(d.entries[0]?.status).toBe('identical');
  });

  test('[diffManifests] hash 不同 mtime 较新应判定方向', () => {
    const local = manifest('A', [entry('p1', 'h1', '2026-02-01T00:00:00Z')]);
    const remote = manifest('B', [entry('p1', 'h2', '2026-01-01T00:00:00Z')]);
    expect(diffManifests(local, remote).entries[0]?.status).toBe('local-newer');
    expect(diffManifests(remote, local).entries[0]?.status).toBe('remote-newer');
  });

  test('[diffManifests] mtime 相同 hash 不同应标记 conflict', () => {
    const local = manifest('A', [entry('p1', 'h1', '2026-01-01T00:00:00Z')]);
    const remote = manifest('B', [entry('p1', 'h2', '2026-01-01T00:00:00Z')]);
    expect(diffManifests(local, remote).entries[0]?.status).toBe('conflict');
  });

  test('[diffManifests] 仅一侧应标记 local-only / remote-only', () => {
    const local = manifest('A', [entry('p1', 'h1', '2026-01-01T00:00:00Z')]);
    const remote = manifest('B', [entry('p2', 'h2', '2026-01-01T00:00:00Z')]);
    const d = diffManifests(local, remote);
    const map = Object.fromEntries(d.entries.map(e => [e.projectId, e.status]));
    expect(map.p1).toBe('local-only');
    expect(map.p2).toBe('remote-only');
  });

  test('[diffLocalOnly] 所有项目应为 local-only', () => {
    const local = manifest('A', [
      entry('p1', 'h1', '2026-01-01T00:00:00Z'),
      entry('p2', 'h2', '2026-01-01T00:00:00Z'),
    ]);
    const d = diffLocalOnly(local);
    expect(d.entries.every(e => e.status === 'local-only')).toBe(true);
  });
});
