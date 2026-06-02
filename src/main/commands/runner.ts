// ---------------------------------------------------------------------------
// 动作执行：预设动作 + 自定义动作
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import path from 'node:path';
import { shell, clipboard } from 'electron';
import type { AppConfig, LocalConfig, Project } from '../../shared/types.js';
import {
  type ActionRunResult,
  type CustomAction,
  type PresetActionId,
  PRESET_ACTIONS,
} from '../../shared/sync-types.js';
import { generateId, ID_PREFIX } from '../../shared/id.js';
import { FmError } from '../fm-error.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('main:commands');

// ---------------------------------------------------------------------------
// 占位符替换：{{path}} {{name}} {{tag:foo}}
// ---------------------------------------------------------------------------

export function substitute(
  template: string,
  ctx: { path: string; name: string; tags: string[] },
): string {
  return template.replace(/\{\{(.*?)\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    if (key === 'path') return ctx.path;
    if (key === 'name') return ctx.name;
    if (key.startsWith('tag:')) {
      const tag = key.slice(4).trim();
      return ctx.tags.includes(tag) ? tag : '';
    }
    return '';
  });
}

function buildContext(project: Project) {
  return { path: project.path, name: project.name, tags: project.tags };
}

function cloneActions(actions?: readonly CustomAction[]): CustomAction[] {
  return (actions ?? []).map(a => ({
    ...a,
    ...(a.args ? { args: [...a.args] } : {}),
  }));
}

function readScopedActions(local: LocalConfig, projectId?: string): CustomAction[] {
  if (!projectId) {
    return cloneActions(local.actions);
  }
  const binding = local.bindings.find(item => item.projectId === projectId);
  if (!binding) {
    throw new FmError('PROJECT_NOT_BOUND', `项目未绑定当前设备：${projectId}`);
  }
  return cloneActions(binding.actions);
}

function writeScopedActions(local: LocalConfig, actions: readonly CustomAction[], projectId?: string): LocalConfig {
  const nextActions = cloneActions(actions);
  if (!projectId) {
    return {
      ...local,
      actions: nextActions,
    };
  }

  if (!local.bindings.some(binding => binding.projectId === projectId)) {
    throw new FmError('PROJECT_NOT_BOUND', `项目未绑定当前设备：${projectId}`);
  }

  return {
    ...local,
    bindings: local.bindings.map(binding => (
      binding.projectId === projectId
        ? {
          ...binding,
          actions: nextActions,
        }
        : binding
    )),
  };
}

export function listCustomActions(config: AppConfig, projectId?: string): CustomAction[] {
  if (!projectId) {
    return cloneActions(config.actions);
  }
  const project = config.projects.find(item => item.id === projectId);
  if (!project) {
    throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${projectId}`);
  }
  return cloneActions(project.actions);
}

// ---------------------------------------------------------------------------
// 预设
// ---------------------------------------------------------------------------

function spawnDetached(
  command: string,
  args: string[],
  options: { cwd?: string; shell?: boolean } = {},
): void {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    stdio: 'ignore',
    shell: options.shell ?? false,
  });
  child.on('error', err => logger.warn('子进程启动失败', { command, message: err.message }));
  child.unref();
}

async function runPreset(
  id: PresetActionId,
  project: Project,
  platform: NodeJS.Platform,
): Promise<ActionRunResult> {
  switch (id) {
    case 'open.vscode': {
      // 'code' 通常是 shell wrapper，需要 shell:true（Win 上是 code.cmd）
      spawnDetached('code', [project.path], { shell: true });
      return { started: true };
    }
    case 'open.explorer': {
      const r = await shell.openPath(project.path);
      if (r) throw new FmError('ACTION_FAILED', r);
      return { started: true };
    }
    case 'open.terminal': {
      if (platform === 'win32') {
        try {
          spawnDetached('wt', ['-d', project.path]);
        } catch {
          spawnDetached('cmd', ['/K', `cd /d "${project.path}"`], { shell: true });
        }
      } else if (platform === 'darwin') {
        spawnDetached('open', ['-a', 'Terminal', project.path]);
      } else {
        spawnDetached('x-terminal-emulator', [], { cwd: project.path });
      }
      return { started: true };
    }
    case 'copy.path': {
      clipboard.writeText(project.path);
      return { started: true, clipboard: project.path };
    }
    case 'copy.name': {
      clipboard.writeText(project.name);
      return { started: true, clipboard: project.name };
    }
  }
}

// ---------------------------------------------------------------------------
// 自定义
// ---------------------------------------------------------------------------

async function runCustom(
  action: CustomAction,
  project: Project,
): Promise<ActionRunResult> {
  const ctx = buildContext(project);
  const cmd = substitute(action.command, ctx);
  const args = (action.args ?? []).map(a => substitute(a, ctx));
  const cwd =
    action.cwd === 'parent' ? path.dirname(project.path) : project.path;
  spawnDetached(cmd, args, { cwd, shell: true });
  return { started: true };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunActionInput {
  /** 动作 ID：预设或自定义动作 ID */
  actionId: string;
  projectId: string;
}

export async function runAction(
  config: AppConfig,
  input: RunActionInput,
  platform: NodeJS.Platform,
): Promise<ActionRunResult> {
  const project = config.projects.find(p => p.id === input.projectId);
  if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${input.projectId}`);
  const preset = PRESET_ACTIONS.find(c => c.id === input.actionId);
  if (preset) return runPreset(preset.id, project, platform);
  const projectAction = (project.actions ?? []).find(a => a.id === input.actionId);
  if (projectAction) return runCustom(projectAction, project);
  const sharedProjectAction = (project.sharedActions ?? []).find(a => a.id === input.actionId);
  if (sharedProjectAction) return runCustom(sharedProjectAction, project);
  const globalAction = (config.actions ?? []).find(a => a.id === input.actionId);
  if (globalAction) return runCustom(globalAction, project);
  throw new FmError('ACTION_NOT_FOUND', `动作不存在：${input.actionId}`);
}

// ---------------------------------------------------------------------------
// 自定义动作 CRUD（纯函数，作用于 LocalConfig）
// ---------------------------------------------------------------------------

export function addCustomAction(
  local: LocalConfig,
  input: Omit<CustomAction, 'id'>,
  projectId?: string,
): { local: LocalConfig; action: CustomAction } {
  const action: CustomAction = { id: generateId(ID_PREFIX.action), ...input };
  const current = readScopedActions(local, projectId);
  return {
    local: writeScopedActions(local, [...current, action], projectId),
    action,
  };
}

export function updateCustomAction(
  local: LocalConfig,
  id: string,
  patch: Partial<Omit<CustomAction, 'id'>>,
  projectId?: string,
): { local: LocalConfig; action: CustomAction } {
  const list = readScopedActions(local, projectId);
  const existing = list.find(c => c.id === id);
  if (!existing) throw new FmError('ACTION_NOT_FOUND', `动作不存在：${id}`);
  const next: CustomAction = { ...existing, ...patch };
  return {
    local: writeScopedActions(
      local,
      list.map(c => (c.id === id ? next : c)),
      projectId,
    ),
    action: next,
  };
}

export function replaceCustomActions(
  local: LocalConfig,
  actions: readonly CustomAction[],
  projectId?: string,
): LocalConfig {
  return writeScopedActions(local, actions, projectId);
}

export function removeCustomAction(local: LocalConfig, id: string, projectId?: string): LocalConfig {
  const list = readScopedActions(local, projectId);
  return writeScopedActions(
    local,
    list.filter(a => a.id !== id),
    projectId,
  );
}
