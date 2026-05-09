// ---------------------------------------------------------------------------
// 设置面板：按扫描 / 同步 / 软件设置拆分
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { ExternalLink, FolderPlus, FolderRoot, PenLine, Plus, Trash2 } from 'lucide-react';
import type { CustomCommand } from '@shared/bridge.js';
import { IgnoreRulesEditor } from '@/components/basic/ignore-rules-editor.js';
import { AddableList, AddableListEmpty, AddableListItem } from '@/components/ui/addable-list';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { SegmentedToggleGroup } from '@/components/ui/segmented-toggle-group';
import { SettingSection } from '@/components/ui/setting-section';
import { useAppActions, useAppState } from '../../store/app-store.js';
import { AddScanRootDialog } from './scan-root-dialog.js';
import { SyncConfigPanel } from './sync-config-panel.js';

const APP_NAME = 'hyper-fm';
const APP_DESCRIPTION = `${APP_NAME} 是一个文件夹管理及同步软件。`;
const APP_GITHUB_URL = `https://github.com/H5L0/${APP_NAME}`;

function moveItemToIndex<T extends { id: string }>(items: readonly T[], activeId: string, targetIndex: number): T[] | null {
  if (!activeId) {
    return null;
  }

  const fromIndex = items.findIndex(item => item.id === activeId);
  if (fromIndex < 0) {
    return null;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  const insertIndex = Math.max(0, Math.min(targetIndex, next.length));
  if (fromIndex === insertIndex) {
    return null;
  }
  next.splice(insertIndex, 0, moved!);
  return next;
}

export function ScanSettingsPanel() {
  const { config } = useAppState();
  const actions = useAppActions();
  const ignoreGlobsValue = config.ignore.globs.join('\n');
  const [globsDraft, setGlobsDraft] = useState(config.ignore.globs.join('\n'));
  const [respectGitignoreDraft, setRespectGitignoreDraft] = useState(config.ignore.respectGitignore);
  const [scanRootDraftPath, setScanRootDraftPath] = useState<string | null>(null);
  const [editingScanRootId, setEditingScanRootId] = useState<string | null>(null);
  useEffect(() => {
    setGlobsDraft(ignoreGlobsValue);
    setRespectGitignoreDraft(config.ignore.respectGitignore);
  }, [config.ignore.respectGitignore, ignoreGlobsValue]);

  const ignoreDirty = globsDraft !== ignoreGlobsValue || respectGitignoreDraft !== config.ignore.respectGitignore;

  const handleAddRoot = async () => {
    const dir = await actions.pickDirectory();
    if (!dir) return;
    setScanRootDraftPath(dir);
  };

  const handleSaveIgnore = async () => {
    const globs = globsDraft
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    try {
      await actions.saveIgnore({ globs, respectGitignore: respectGitignoreDraft });
      actions.toast('success', '已保存忽略规则');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '保存失败');
    }
  };

  const reorderScanRoots = async (activeId: string, targetIndex: number) => {
    const nextRoots = moveItemToIndex(config.scanRoots, activeId, targetIndex);
    if (!nextRoots) return;

    try {
      await window.fm.config.save({ ...config, scanRoots: nextRoots });
      await actions.loadConfig();
      actions.toast('success', '已调整扫描目录顺序');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '调整顺序失败');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-10">
        <h1 className="text-display">扫描设置</h1>

        <SettingSection title="扫描根目录" hint="将从以下目录查找项目。">
          <AddableList
            addIcon={<FolderPlus className="size-4" />}
            addLabel="添加扫描目录"
            onAdd={() => void handleAddRoot()}
            footerEnd={<ListMetaBadge>{config.scanRoots.length} 个扫描根</ListMetaBadge>}
            divided={false}
            sortable={{
              itemIds: config.scanRoots.map(root => root.id),
              onReorder: (activeId, targetIndex) => reorderScanRoots(activeId, targetIndex),
            }}
          >
            {config.scanRoots.length === 0 ? (
              <AddableListEmpty>尚未添加扫描根目录。</AddableListEmpty>
            ) : (
              config.scanRoots.map(root => (
                <AddableListItem
                  key={root.id}
                  itemId={root.id}
                  showGrabHandle
                >
                  <div className="flex items-center gap-2.5">
                    <FolderRoot className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-note text-foreground" title={root.path}>{root.path}</p>
                    </div>
                    <Button size="icon-xs" variant="ghost" title="扫描目录设置" onClick={() => {
                      setEditingScanRootId(root.id);
                      setScanRootDraftPath(root.path);
                    }}>
                      <PenLine className="size-4" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="删除扫描目录"
                      onClick={() => void actions.removeScanRoot(root.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </AddableListItem>
              ))
            )}
          </AddableList>
        </SettingSection>

        {scanRootDraftPath ? (
          <AddScanRootDialog
            directoryPath={scanRootDraftPath}
            existingRoot={editingScanRootId ? (() => {
              const root = config.scanRoots.find(item => item.id === editingScanRootId);
              return root ? { id: root.id, maxDepth: root.maxDepth } : undefined;
            })() : undefined}
            onClose={() => {
              setScanRootDraftPath(null);
              setEditingScanRootId(null);
            }}
          />
        ) : null}

        <SettingSection title="全局忽略规则" hint="扫描项目时将遵守以下忽略规则。">
          <CheckboxField
            checked={respectGitignoreDraft}
            onCheckedChange={setRespectGitignoreDraft}
            label="扫描时遵守 .gitignore"
            className="items-center"
          />
          <div className="mt-2">
            <IgnoreRulesEditor
              value={globsDraft}
              onChange={setGlobsDraft}
              rows={8}
              placeholder="# 全局忽略规则\nnode_modules\n.git\ndist/"
            />
          </div>
          <Button
            size="sm"
            variant={ignoreDirty ? 'default' : 'outline'}
            className="mt-2"
            disabled={!ignoreDirty}
            onClick={() => void handleSaveIgnore()}
          >
            保存
          </Button>
        </SettingSection>

      </div>
    </div>
  );
}

export function SyncSettingsPanel() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-display">同步设置</h1>
        <div className="mt-10">
          <SyncConfigPanel />
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const { appPreferences } = useAppState();
  const actions = useAppActions();

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-10">
        <h1 className="text-display">软件设置</h1>

        <SettingSection title="主题">
          <SegmentedToggleGroup
            ariaLabel="选择主题模式"
            value={appPreferences.ui.theme}
            onValueChange={nextValue => void actions.saveTheme(nextValue as typeof appPreferences.ui.theme)}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            optionMinWidth={112}
          />
        </SettingSection>

        <SettingSection title="托盘">
          <CheckboxField
            checked={appPreferences.trayEnabled}
            onCheckedChange={checked => void actions.saveAppPreferences({ trayEnabled: checked })}
            label="关闭窗口后显示托盘"
            className="items-center"
          />
        </SettingSection>

        <SettingSection title="开机启动">
          <CheckboxField
            checked={appPreferences.autoLaunchEnabled}
            onCheckedChange={checked => void actions.saveAppPreferences({ autoLaunchEnabled: checked })}
            label="开机后自动启动 hyper-fm"
            description="仅对打包后的桌面应用生效；开发模式不会注册系统启动项。"
            className="items-center"
          />
        </SettingSection>

        <CommandsSection />

        <SettingSection title="关于">
          <div className="rounded-2xl border border-border bg-card px-4 py-4">
            <p className="text-title text-foreground">{APP_NAME}</p>
            <p className="text-note leading-6 text-muted-foreground">{APP_DESCRIPTION}</p>
            <a
              href={APP_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-note text-foreground/90 transition-colors hover:text-foreground hover:underline"
            >
              <span className="break-all">{APP_GITHUB_URL}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          </div>
        </SettingSection>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 自定义命令
// ---------------------------------------------------------------------------

function CommandsSection() {
  const { config } = useAppState();
  const actions = useAppActions();
  const [list, setList] = useState<CustomCommand[]>([]);
  const [editingCommand, setEditingCommand] = useState<CustomCommand | null>(null);
  const [creatingCommand, setCreatingCommand] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setList(await window.fm.commands.list());

  useEffect(() => {
    void refresh();
  }, []);

  const saveCommand = async ({
    id,
    label,
    command,
    args,
    cwd,
    description,
  }: {
    id?: string;
    label: string;
    command: string;
    args: string;
    cwd: CustomCommand['cwd'];
    description: string;
  }) => {
    if (busy) return;
    const nextLabel = label.trim();
    const nextCommand = command.trim();
    if (!nextLabel || !nextCommand) return;

    setBusy(true);
    try {
      const payload = {
        label: nextLabel,
        command: nextCommand,
        args: args.trim() ? args.trim().split(' ').filter(Boolean) : undefined,
        cwd: cwd ?? 'project',
        description: description.trim() || undefined,
      } satisfies Omit<CustomCommand, 'id'>;

      if (id) {
        await window.fm.commands.update(id, payload);
      } else {
        await window.fm.commands.add(payload);
      }

      await refresh();
      setEditingCommand(null);
      setCreatingCommand(false);
      actions.toast('success', id ? '已更新命令' : '已添加命令');
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : id ? '更新失败' : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const removeCommand = async (id: string) => {
    try {
      await window.fm.commands.remove(id);
      await refresh();
      actions.toast('success', '已删除命令');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '删除失败');
    }
  };

  const reorderCommands = async (activeId: string, targetIndex: number) => {
    const source = list.length > 0 ? list : (config.commands ?? []);
    const nextCommands = moveItemToIndex(source, activeId, targetIndex);
    if (!nextCommands) return;

    try {
      await window.fm.config.save({ ...config, commands: nextCommands });
      setList(nextCommands);
      await actions.loadConfig();
      actions.toast('success', '已调整命令顺序');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '调整顺序失败');
    }
  };

  return (
    <SettingSection title="命令" hint="可对项目运行的自定义命令。">
      <AddableList
        addIcon={<Plus className="size-4" />}
        addLabel="添加命令"
        onAdd={() => setCreatingCommand(true)}
        footerEnd={<ListMetaBadge>{list.length} 条命令</ListMetaBadge>}
        divided={false}
        sortable={{
          itemIds: list.map(command => command.id),
          onReorder: (activeId, targetIndex) => reorderCommands(activeId, targetIndex),
        }}
      >
        {list.length === 0 ? (
          <AddableListEmpty>尚未配置自定义命令。</AddableListEmpty>
        ) : (
          list.map(c => (
            <AddableListItem
              key={c.id}
              itemId={c.id}
              showGrabHandle
            >
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-foreground">{c.label}</p>
                  <p className="mt-1 truncate text-note text-muted-foreground">
                    {c.command}
                    {c.args?.length ? ` ${c.args.join(' ')}` : ''}
                  </p>
                  {c.description ? (
                    <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">{c.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon-xs" variant="ghost" title="编辑命令" onClick={() => setEditingCommand(c)}>
                    <PenLine className="size-4" />
                  </Button>
                  <Button size="icon-xs" variant="ghost" title="删除命令" onClick={() => void removeCommand(c.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </AddableListItem>
          ))
        )}
      </AddableList>

      {creatingCommand ? (
        <CommandDialog
          onClose={() => setCreatingCommand(false)}
          onSave={draft => void saveCommand(draft)}
          busy={busy}
        />
      ) : null}

      {editingCommand ? (
        <CommandDialog
          initial={editingCommand}
          onClose={() => setEditingCommand(null)}
          onSave={draft => void saveCommand(draft)}
          busy={busy}
        />
      ) : null}
    </SettingSection>
  );
}

function ListMetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-note text-muted-foreground">
      {children}
    </span>
  );
}

function CommandDialog({
  initial,
  onClose,
  onSave,
  busy,
}: {
  initial?: CustomCommand;
  onClose: () => void;
  onSave: (draft: {
    id?: string;
    label: string;
    command: string;
    args: string;
    cwd: CustomCommand['cwd'];
    description: string;
  }) => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial?.args?.join(' ') ?? '');
  const [cwd, setCwd] = useState<CustomCommand['cwd']>(initial?.cwd ?? 'project');
  const [description, setDescription] = useState(initial?.description ?? '');

  return (
    <EditDialogShell
      title={initial ? '编辑命令' : '添加命令'}
      note="占位符：{{path}} {{name}} {{tag:foo}}。参数使用空格分隔输入。"
      onClose={onClose}
      panelClassName="w-[min(620px,calc(100vw-2rem))]"
      bodyClassName="space-y-4"
      footerEnd={(
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy || !label.trim() || !command.trim()}
            onClick={() => onSave({ id: initial?.id, label, command, args, cwd, description })}
          >
            {initial ? '保存' : '添加'}
          </Button>
        </>
      )}
    >
      <EditDialogField label="名称">
        <input
          value={label}
          onChange={event => setLabel(event.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>

      <EditDialogField label="命令">
        <input
          value={command}
          onChange={event => setCommand(event.target.value)}
          placeholder="如 idea64 或 code"
          className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>

      <EditDialogField label="参数" note="使用空格分隔，例如 --reuse-window {{path}}。">
        <input
          value={args}
          onChange={event => setArgs(event.target.value)}
          placeholder="如 {{path}}"
          className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>

      <EditDialogField label="工作目录">
        <SegmentedToggleGroup
          ariaLabel="选择命令工作目录"
          value={cwd ?? 'project'}
          onValueChange={nextValue => setCwd(nextValue as CustomCommand['cwd'])}
          options={[
            { value: 'project', label: '项目目录', description: '以项目根目录作为 cwd' },
            { value: 'parent', label: '上级目录', description: '以项目所在目录作为 cwd' },
          ]}
          optionMinWidth={180}
          align="start"
        />
      </EditDialogField>

      <EditDialogField label="备注">
        <textarea
          rows={2}
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="可选，用于补充命令用途"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>
    </EditDialogShell>
  );
}
