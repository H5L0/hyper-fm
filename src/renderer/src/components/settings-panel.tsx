// ---------------------------------------------------------------------------
// 设置面板：配置切换、扫描根、忽略规则、主题、同步、命令
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { ExternalLink, FolderPlus, FolderRoot, PenLine, Plus, Trash2 } from 'lucide-react';
import type { CustomCommand } from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { EditDialogField, EditDialogShell } from '@/components/ui/edit-dialog-shell';
import { SegmentedToggleGroup } from '@/components/ui/segmented-toggle-group';
import { useAppActions, useAppState } from '../store/app-store.js';
import { IgnoreRulesEditor } from './ignore-rules-editor';
import { AddScanRootDialog } from './scan-root-dialog.js';
import { SyncConfigPanel } from './sync-config-panel.js';

const APP_GITHUB_URL = 'https://github.com/H5L0/electron-template';
const APP_DESCRIPTION = '一个文件夹管理和同步软件。';

export function SettingsPanel() {
  const { config, configPaths } = useAppState();
  const actions = useAppActions();
  const ignoreGlobsValue = config.ignore.globs.join('\n');
  const configDisplayName = config.name.trim() || '未命名配置';
  const configDescription = (config.description ?? '').trim();
  const [globsDraft, setGlobsDraft] = useState(config.ignore.globs.join('\n'));
  const [respectGitignoreDraft, setRespectGitignoreDraft] = useState(config.ignore.respectGitignore);
  const [scanRootDraftPath, setScanRootDraftPath] = useState<string | null>(null);
  const [editingScanRootId, setEditingScanRootId] = useState<string | null>(null);
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);

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

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-10">
        <h1 className="text-display">设置</h1>

        <Section title="配置文件" hint="当前使用的配置文件信息。">
          <div className="rounded-2xl border border-border bg-card px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-title text-foreground">{configDisplayName}</p>
                <p className="mt-1 text-note text-muted-foreground">{configDescription || '未填写描述'}</p>

                <div className="mt-4 space-y-2 text-note text-muted-foreground">
                  <div>
                    <span className="text-foreground">共享配置</span>
                    <p className="mt-0.5 break-all">{configPaths.sharedPath || '未加载'}</p>
                  </div>
                  <div>
                    <span className="text-foreground">本地配置</span>
                    <p className="mt-0.5 break-all">{configPaths.localPath || '未加载'}</p>
                  </div>
                </div>
              </div>
              <Button size="icon-xs" variant="ghost" title="编辑配置元信息" onClick={() => setMetaDialogOpen(true)}>
                <PenLine className="size-4" />
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void actions.pickAndLoadConfig()}>
                打开…
              </Button>
              <Button size="sm" variant="outline" onClick={() => void actions.pickAndCreateConfig()}>
                新建…
              </Button>
            </div>
          </div>
        </Section>

        {metaDialogOpen ? (
          <ConfigMetaDialog
            initialName={config.name}
            initialDescription={config.description ?? ''}
            onClose={() => setMetaDialogOpen(false)}
            onSave={async (name, description) => {
              try {
                await actions.saveConfigMeta(name, description);
                actions.toast('success', '已保存配置元信息');
                setMetaDialogOpen(false);
              } catch (error) {
                actions.toast('error', error instanceof Error ? error.message : '保存失败');
              }
            }}
          />
        ) : null}

        <Section title="扫描根目录" hint="将从以下目录查找项目。">
          <div className="space-y-2">
            {config.scanRoots.length === 0 ? (
              <p className="text-note text-muted-foreground">尚未添加扫描根目录。</p>
            ) : (
              config.scanRoots.map(root => (
                <div key={root.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
                  <FolderRoot className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
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
              ))
            )}
            <Button size="sm" variant="outline" onClick={() => void handleAddRoot()}>
              <FolderPlus className="size-4" /> 添加扫描目录
            </Button>
          </div>
        </Section>

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

        <Section title="全局忽略规则" hint="扫描项目时将遵守以下忽略规则。">
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
              rows={4}
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
        </Section>

        <SyncConfigPanel />

        <CommandsSection />

        <Section title="主题">
          <SegmentedToggleGroup
            ariaLabel="选择主题模式"
            value={config.ui.theme}
            onValueChange={nextValue => void actions.saveTheme(nextValue as typeof config.ui.theme)}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            optionMinWidth={112}
          />
        </Section>

        <Section title="关于">
          <div className="rounded-2xl border border-border bg-card px-4 py-4">
            <p className="text-title text-foreground">fm</p>
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
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-heading text-foreground">{title}</h2>
      {hint ? <p className="mt-1 text-note text-muted-foreground">{hint}</p> : null}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 自定义命令
// ---------------------------------------------------------------------------

function CommandsSection() {
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

  return (
    <Section title="命令" hint="可对项目运行的自定义命令。">
      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="text-note text-muted-foreground">尚未配置自定义命令。</p>
        ) : (
          list.map(c => (
            <div
              key={c.id}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
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
          ))
        )}

        <Button size="sm" variant="outline" onClick={() => setCreatingCommand(true)}>
          <Plus className="size-4" /> 添加命令
        </Button>
      </div>

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
    </Section>
  );
}

function ConfigMetaDialog({
  initialName,
  initialDescription,
  onClose,
  onSave,
}: {
  initialName: string;
  initialDescription: string;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);

  return (
    <EditDialogShell
      title="编辑配置元信息"
      note="这里只修改当前配置的名称与描述，配置文件路径保持不变。"
      onClose={onClose}
      panelClassName="w-[min(520px,calc(100vw-2rem))]"
      bodyClassName="space-y-4"
      footerEnd={(
        <>
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(name, description);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存
          </Button>
        </>
      )}
    >
      <EditDialogField label="名称">
        <input
          value={name}
          onChange={event => setName(event.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>

      <EditDialogField label="描述">
        <textarea
          rows={3}
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="可选，用于标题栏悬浮信息说明"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </EditDialogField>
    </EditDialogShell>
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
