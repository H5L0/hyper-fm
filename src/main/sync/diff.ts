// ---------------------------------------------------------------------------
// SyncManifest 比对：生成 SyncDiff
// ---------------------------------------------------------------------------

import {
  type SyncDiff,
  type SyncDiffEntry,
  type SyncDiffStatus,
  type SyncManifest,
  type SyncProjectEntry,
} from '../../shared/sync-types.js';

function compareEntries(
  local: SyncProjectEntry | undefined,
  remote: SyncProjectEntry | undefined,
): SyncDiffStatus {
  if (local && !remote) return 'local-only';
  if (!local && remote) return 'remote-only';
  if (!local || !remote) return 'identical';
  if (local.hash === remote.hash) return 'identical';
  const lt = Date.parse(local.modifiedAt);
  const rt = Date.parse(remote.modifiedAt);
  if (!Number.isFinite(lt) || !Number.isFinite(rt) || lt === rt) return 'conflict';
  return lt > rt ? 'local-newer' : 'remote-newer';
}

export function diffManifests(
  local: SyncManifest,
  remote: SyncManifest,
): SyncDiff {
  const ids = new Set<string>();
  for (const p of local.projects) ids.add(p.id);
  for (const p of remote.projects) ids.add(p.id);

  const localById = new Map(local.projects.map(p => [p.id, p]));
  const remoteById = new Map(remote.projects.map(p => [p.id, p]));

  const entries: SyncDiffEntry[] = [];
  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    entries.push({ projectId: id, status: compareEntries(l, r), local: l, remote: r });
  }

  return {
    generatedAt: new Date().toISOString(),
    local: { device: local.device },
    remote: { device: remote.device },
    entries,
  };
}

/**
 * 仅本地有 manifest 时（zip 导出场景），所有项目视为 local-only
 */
export function diffLocalOnly(local: SyncManifest): SyncDiff {
  return {
    generatedAt: new Date().toISOString(),
    local: { device: local.device },
    remote: { device: { id: '-', name: '-' } },
    entries: local.projects.map(p => ({ projectId: p.id, status: 'local-only', local: p })),
  };
}
