// ---------------------------------------------------------------------------
// 命令执行：预设命令 + 自定义命令
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import path from 'node:path';
import { shell, clipboard } from 'electron';
import type { AppConfig, Project } from '../../shared/types.js';
import {
  type CommandRunResult,
  type CustomCommand,
  type PresetCommandId,
  PRESET_COMMANDS,
} from '../../shared/sync-types.js';
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
  id: PresetCommandId,
  project: Project,
  platform: NodeJS.Platform,
): Promise<CommandRunResult> {
  switch (id) {
    case 'open.vscode': {
      // 'code' 通常是 shell wrapper，需要 shell:true（Win 上是 code.cmd）
      spawnDetached('code', [project.path], { shell: true });
      return { started: true };
    }
    case 'open.explorer': {
      const r = await shell.openPath(project.path);
      if (r) throw new FmError('COMMAND_FAILED', r);
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
  command: CustomCommand,
  project: Project,
): Promise<CommandRunResult> {
  const ctx = buildContext(project);
  const cmd = substitute(command.command, ctx);
  const args = (command.args ?? []).map(a => substitute(a, ctx));
  const cwd =
    command.cwd === 'parent' ? path.dirname(project.path) : project.path;
  spawnDetached(cmd, args, { cwd, shell: true });
  return { started: true };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunCommandInput {
  /** 命令 ID：预设或自定义命令 ID */
  commandId: string;
  projectId: string;
}

export async function runCommand(
  config: AppConfig,
  input: RunCommandInput,
  platform: NodeJS.Platform,
): Promise<CommandRunResult> {
  const project = config.projects.find(p => p.id === input.projectId);
  if (!project) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${input.projectId}`);
  const preset = PRESET_COMMANDS.find(c => c.id === input.commandId);
  if (preset) return runPreset(preset.id, project, platform);
  const custom = (config.commands ?? []).find(c => c.id === input.commandId);
  if (custom) return runCustom(custom, project);
  throw new FmError('COMMAND_NOT_FOUND', `命令不存在：${input.commandId}`);
}

// ---------------------------------------------------------------------------
// 自定义命令 CRUD（纯函数，作用于 AppConfig）
// ---------------------------------------------------------------------------

import { generateId, ID_PREFIX } from '../../shared/id.js';

export function addCustomCommand(
  config: AppConfig,
  input: Omit<CustomCommand, 'id'>,
): { config: AppConfig; command: CustomCommand } {
  const command: CustomCommand = { id: generateId(ID_PREFIX.command), ...input };
  return {
    config: { ...config, commands: [...(config.commands ?? []), command] },
    command,
  };
}

export function updateCustomCommand(
  config: AppConfig,
  id: string,
  patch: Partial<Omit<CustomCommand, 'id'>>,
): { config: AppConfig; command: CustomCommand } {
  const list = config.commands ?? [];
  const existing = list.find(c => c.id === id);
  if (!existing) throw new FmError('COMMAND_NOT_FOUND', `命令不存在：${id}`);
  const next: CustomCommand = { ...existing, ...patch };
  return {
    config: { ...config, commands: list.map(c => (c.id === id ? next : c)) },
    command: next,
  };
}

export function removeCustomCommand(config: AppConfig, id: string): AppConfig {
  return { ...config, commands: (config.commands ?? []).filter(c => c.id !== id) };
}
