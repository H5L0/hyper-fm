import { describe, expect, test, vi } from 'vitest';
import { createDefaultConfig, createDefaultLocalConfig } from '../../shared/schema.js';
const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn(),
  })),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

import {
  addCustomAction,
  listCustomActions,
  removeCustomAction,
  replaceCustomActions,
  runAction,
  substitute,
  updateCustomAction,
} from './runner.js';

describe('runner', () => {
  test('[substitute] 应替换 path/name 占位符', () => {
    const out = substitute('open {{path}} as {{name}}', {
      path: '/tmp/x',
      name: 'demo',
      tags: [],
    });
    expect(out).toBe('open /tmp/x as demo');
  });

  test('[substitute] tag:foo 命中应返回标签名', () => {
    const out = substitute('flag={{tag:unity}}', {
      path: '/tmp/x',
      name: 'demo',
      tags: ['unity', 'godot'],
    });
    expect(out).toBe('flag=unity');
  });

  test('[substitute] tag:foo 未命中应返回空串', () => {
    const out = substitute('flag={{tag:unreal}}', {
      path: '/tmp/x',
      name: 'demo',
      tags: ['unity'],
    });
    expect(out).toBe('flag=');
  });

  test('[substitute] 未知占位符应替换为空串', () => {
    const out = substitute('x={{foo}}', { path: '/x', name: 'n', tags: [] });
    expect(out).toBe('x=');
  });

  test('[substitute] 应支持空白和多次出现', () => {
    const out = substitute('{{ name }}-{{name}}', {
      path: '/x',
      name: 'demo',
      tags: [],
    });
    expect(out).toBe('demo-demo');
  });

  test('[addCustomAction] 应支持项目级动作', () => {
    const local = createDefaultLocalConfig();
    local.bindings.push({
      projectId: 'pj-aaaaaa',
      path: 'D:/projects/demo',
      rootId: 'root_1',
      hasMetaFile: false,
      lastScannedAt: '2026-01-01T00:00:00Z',
    });

    const { local: nextLocal, action } = addCustomAction(local, {
      label: '运行项目脚本',
      command: 'pnpm',
      args: ['dev'],
      cwd: 'project',
    }, 'pj-aaaaaa');

    expect(action.id).toMatch(/^act_/);
    expect(nextLocal.bindings[0]?.actions?.[0]?.label).toBe('运行项目脚本');
  });

  test('[update/remove/replaceCustomActions] 应仅作用于指定项目的动作列表', () => {
    const local = createDefaultLocalConfig();
    local.bindings.push({
      projectId: 'pj-aaaaaa',
      path: 'D:/projects/demo',
      rootId: 'root_1',
      hasMetaFile: false,
      lastScannedAt: '2026-01-01T00:00:00Z',
      actions: [
        { id: 'cmd_a', label: 'A', command: 'echo a', cwd: 'project' },
        { id: 'cmd_b', label: 'B', command: 'echo b', cwd: 'project' },
      ],
    });

    const updated = updateCustomAction(local, 'cmd_a', { label: 'A+' }, 'pj-aaaaaa');
    expect(updated.action.label).toBe('A+');

    const replaced = replaceCustomActions(updated.local, [
      { id: 'cmd_b', label: 'B', command: 'echo b', cwd: 'project' },
      { id: 'cmd_a', label: 'A+', command: 'echo a', cwd: 'project' },
    ], 'pj-aaaaaa');
    expect(replaced.bindings[0]?.actions?.map(a => a.id)).toEqual(['cmd_b', 'cmd_a']);

    const removed = removeCustomAction(replaced, 'cmd_b', 'pj-aaaaaa');
    expect(removed.bindings[0]?.actions?.map(a => a.id)).toEqual(['cmd_a']);
  });

  test('[listCustomActions] 应返回指定项目的动作列表', () => {
    const config = createDefaultConfig();
    config.actions = [{ id: 'cmd_global', label: '全局', command: 'echo global', cwd: 'project' }];
    config.projects = [
      {
        projectId: 'pj-aaaaaa',
        id: 'pj-aaaaaa',
        path: 'D:/projects/demo',
        rootId: 'root_1',
        hasMetaFile: false,
        lastScannedAt: '2026-01-01T00:00:00Z',
        name: 'Demo',
        tags: [],
        ignore: [],
        fingerprint: { kind: 'metadata' },
        actions: [{ id: 'cmd_project', label: '项目', command: 'echo project', cwd: 'project' }],
      },
    ];

    expect(listCustomActions(config).map(a => a.id)).toEqual(['cmd_global']);
    expect(listCustomActions(config, 'pj-aaaaaa').map(a => a.id)).toEqual(['cmd_project']);
  });

  test('[runAction] 应支持执行共享项目动作', async () => {
    spawnMock.mockClear();

    const config = createDefaultConfig();
    config.projects = [
      {
        projectId: 'pj-aaaaaa',
        id: 'pj-aaaaaa',
        path: 'D:/projects/demo',
        rootId: 'root_1',
        hasMetaFile: false,
        lastScannedAt: '2026-01-01T00:00:00Z',
        name: 'Demo',
        tags: [],
        ignore: [],
        fingerprint: { kind: 'metadata' },
        sharedActions: [{ id: 'cmd_shared', label: '共享', command: 'echo shared', cwd: 'project' }],
      },
    ];

    await expect(runAction(config, { projectId: 'pj-aaaaaa', actionId: 'cmd_shared' }, 'win32')).resolves.toEqual({
      started: true,
    });
    expect(spawnMock).toHaveBeenCalledWith('echo shared', [], expect.objectContaining({ cwd: 'D:/projects/demo', shell: true }));
  });
});
