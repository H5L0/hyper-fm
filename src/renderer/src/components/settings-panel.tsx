// ---------------------------------------------------------------------------
// 设置面板：配置切换、扫描根、忽略规则、主题、同步、命令
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Download, FolderPlus, FolderRoot, Plus, Server, Settings2, Trash2, Upload } from 'lucide-react';
import type {
  CustomCommand,
  DeviceRegistry,
  SyncSettings,
} from '@shared/bridge.js';
import { Button } from '@/components/ui/button';
import { useAppActions, useAppState } from '../store/app-store.js';
import { IgnoreRulesEditor } from './ignore-rules-editor';
import { AddScanRootDialog } from './scan-root-dialog.js';

export function SettingsPanel() {
  const { config, configPaths } = useAppState();
  const actions = useAppActions();
  const [globsDraft, setGlobsDraft] = useState(config.ignore.globs.join('\n'));
  const [configNameDraft, setConfigNameDraft] = useState(config.name);
  const [configDescriptionDraft, setConfigDescriptionDraft] = useState(config.description ?? '');
  const [scanRootDraftPath, setScanRootDraftPath] = useState<string | null>(null);
  const [editingScanRootId, setEditingScanRootId] = useState<string | null>(null);

  useEffect(() => {
    setConfigNameDraft(config.name);
    setConfigDescriptionDraft(config.description ?? '');
  }, [config.description, config.name]);

  const handleAddRoot = async () => {
    const dir = await actions.pickDirectory();
    if (!dir) return;
    setScanRootDraftPath(dir);
  };

  const handleSaveConfigMeta = async () => {
    try {
      await actions.saveConfigMeta(configNameDraft, configDescriptionDraft);
      actions.toast('success', '已保存配置元信息');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '保存失败');
    }
  };

  const handleSaveIgnore = async () => {
    const globs = globsDraft
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    try {
      await actions.saveIgnore({ globs });
      actions.toast('success', '已保存忽略规则');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '保存失败');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-10">
        <h1 className="text-display">设置</h1>

        <Section title="配置文件" hint="加载或新建一份 fm 配置 JSON。">
          <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
            <div>
              <label className="text-subheading mb-1.5 block text-muted-foreground">名称</label>
              <input
                value={configNameDraft}
                onChange={e => setConfigNameDraft(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>

            <div>
              <label className="text-subheading mb-1.5 block text-muted-foreground">描述</label>
              <textarea
                rows={2}
                value={configDescriptionDraft}
                onChange={e => setConfigDescriptionDraft(e.target.value)}
                placeholder="可选，用于标题栏悬浮信息说明"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>

            <div>
              <label className="text-subheading mb-1.5 block text-muted-foreground">共享文件路径</label>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5 text-note text-muted-foreground">
                <p className="break-all">{configPaths.sharedPath || '未加载'}</p>
              </div>
            </div>

            <div>
              <label className="text-subheading mb-1.5 block text-muted-foreground">本地文件路径</label>
              <div className="rounded-lg border border-border bg-background px-3 py-2.5 text-note text-muted-foreground">
                <p className="break-all">{configPaths.localPath || '未加载'}</p>
              </div>
            </div>

            <div className="mt-1 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleSaveConfigMeta()}>
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={() => void actions.pickAndLoadConfig()}>
                打开…
              </Button>
              <Button size="sm" variant="outline" onClick={() => void actions.pickAndCreateConfig()}>
                新建…
              </Button>
            </div>
          </div>
        </Section>

        <Section title="扫描根目录" hint="指定包含项目的目录。">
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
                    <Settings2 className="size-4" />
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

        <Section title="全局忽略规则" hint="支持精确名称、目录后缀 / 等极简 glob；建议保留 node_modules、.git 等。">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.ignore.respectGitignore}
              onChange={e => void actions.saveIgnore({ respectGitignore: e.target.checked })}
            />
            扫描时遵守 .gitignore
          </label>
          <div className="mt-2">
            <IgnoreRulesEditor
              value={globsDraft}
              onChange={setGlobsDraft}
              rows={8}
              placeholder="# 全局忽略规则\nnode_modules\n.git\ndist/"
            />
          </div>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void handleSaveIgnore()}>
            保存忽略规则
          </Button>
        </Section>

        <Section title="主题">
          <div className="flex gap-2">
            {(['system', 'light', 'dark'] as const).map(t => (
              <Button
                key={t}
                size="sm"
                variant={config.ui.theme === t ? 'default' : 'outline'}
                onClick={() => void actions.saveTheme(t)}
              >
                {t === 'system' ? '跟随系统' : t === 'light' ? '浅色' : '深色'}
              </Button>
            ))}
          </div>
        </Section>

        <SyncSection />

        <CommandsSection />
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
// 同步
// ---------------------------------------------------------------------------

function SyncSection() {
  const { config } = useAppState();
  const actions = useAppActions();
  const [device, setDevice] = useState<DeviceRegistry | null>(null);
  const [settings, setSettings] = useState<SyncSettings>({});
  const [serverRunning, setServerRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.fm.sync.getDevice().then(setDevice);
    void window.fm.sync.getSettings().then(setSettings);
    void window.fm.sync.isServerRunning().then(setServerRunning);
  }, []);

  const updateSettings = async (patch: Partial<SyncSettings>) => {
    const next = { ...settings, ...patch };
    const saved = await window.fm.sync.setSettings(next);
    setSettings(saved);
  };

  const updateNetwork = async (patch: Partial<NonNullable<SyncSettings['network']>>) => {
    const network = {
      listenPort: settings.network?.listenPort ?? 41555,
      autoStart: settings.network?.autoStart ?? false,
      relayMode: settings.network?.relayMode ?? false,
      ...patch,
    };
    await updateSettings({ network });
  };

  const handlePickBundleDir = async () => {
    const dir = await window.fm.sync.pickBundleDir();
    if (dir) await updateSettings({ bundleDir: dir });
  };

  const handlePush = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ids = config.projects.map(p => p.id);
      const r = await window.fm.sync.pushBundleDir(ids);
      actions.toast('success', `已推送 ${r.pushed.length} 个项目`);
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '推送失败');
    } finally {
      setBusy(false);
    }
  };

  const handleExportZip = async () => {
    if (busy) return;
    const file = await window.fm.sync.pickExportFile();
    if (!file) return;
    setBusy(true);
    try {
      const ids = config.projects.map(p => p.id);
      const r = await window.fm.sync.exportZip(ids, file);
      actions.toast('success', `已导出 ${r.projects} 个项目到 ${r.outputFile}`);
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy(false);
    }
  };

  const handleImportZip = async () => {
    if (busy) return;
    const file = await window.fm.sync.pickImportFile();
    if (!file) return;
    setBusy(true);
    try {
      const preview = await window.fm.sync.previewZip(file);
      actions.toast('info', `bundle 含 ${preview.entries.length} 个项目；导入逻辑待 UI 完善`);
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '预览失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleServer = async () => {
    try {
      if (serverRunning) {
        await window.fm.sync.stopServer();
        setServerRunning(false);
        actions.toast('success', '已停止 TCP 监听');
      } else {
        const r = await window.fm.sync.startServer();
        setServerRunning(true);
        actions.toast('success', `TCP 监听已启动：端口 ${r.port}`);
      }
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <Section title="同步" hint="跨设备同步项目元数据与文件。">
      <div className="space-y-3">
        <div className="rounded-md border border-border bg-card px-3 py-3">
          <p className="text-subheading text-muted-foreground">本机设备</p>
          {device ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                defaultValue={device.selfName}
                onBlur={async e => {
                  const name = e.target.value.trim();
                  if (name && name !== device.selfName) {
                    const next = await window.fm.sync.setSelfName(name);
                    setDevice(next);
                  }
                }}
                className="h-8 flex-1 rounded-md border border-border bg-background px-2 outline-none"
              />
              <span className="text-note text-muted-foreground">{device.selfId}</span>
            </div>
          ) : (
            <p className="mt-2 text-note text-muted-foreground">加载中…</p>
          )}
        </div>

        <div className="rounded-md border border-border bg-card px-3 py-3">
          <p className="text-subheading text-muted-foreground">共享目录（OneDrive/Dropbox 或中转设备挂载点）</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 truncate text-note text-foreground" title={settings.bundleDir}>
              {settings.bundleDir || '未设置'}
            </span>
            <Button size="sm" variant="outline" onClick={() => void handlePickBundleDir()}>
              选择
            </Button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!settings.bundleDir || busy} onClick={() => void handlePush()}>
              <Upload className="size-4" /> 推送全部
            </Button>
            <span className="text-note text-muted-foreground">
              拉取请通过项目详情发起（M2 后续完善）
            </span>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card px-3 py-3">
          <p className="text-subheading text-muted-foreground">zip 导入 / 导出</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleExportZip()}>
              <Upload className="size-4" /> 导出 zip
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleImportZip()}>
              <Download className="size-4" /> 导入 zip
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card px-3 py-3">
          <p className="text-subheading text-muted-foreground">TCP P2P</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-muted-foreground">
              端口
              <input
                type="number"
                min={1}
                max={65535}
                defaultValue={settings.network?.listenPort ?? 41555}
                onBlur={e => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0 && n < 65536) void updateNetwork({ listenPort: n });
                }}
                className="h-7 w-24 rounded border border-border bg-background px-1 text-center tabular-nums outline-none"
              />
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">
              <input
                type="checkbox"
                checked={settings.network?.relayMode ?? false}
                onChange={e => void updateNetwork({ relayMode: e.target.checked })}
              />
              中转模式
            </label>
            <Button size="sm" variant={serverRunning ? 'default' : 'outline'} onClick={() => void toggleServer()}>
              <Server className="size-4" /> {serverRunning ? '停止监听' : '启动监听'}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 自定义命令
// ---------------------------------------------------------------------------

function CommandsSection() {
  const actions = useAppActions();
  const [list, setList] = useState<CustomCommand[]>([]);
  const [draft, setDraft] = useState({ label: '', command: '', args: '' });

  const refresh = async () => setList(await window.fm.commands.list());

  useEffect(() => {
    void refresh();
  }, []);

  const addCommand = async () => {
    const label = draft.label.trim();
    const command = draft.command.trim();
    if (!label || !command) return;
    try {
      await window.fm.commands.add({
        label,
        command,
        args: draft.args.trim() ? draft.args.split(' ').filter(Boolean) : undefined,
        cwd: 'project',
      });
      setDraft({ label: '', command: '', args: '' });
      await refresh();
      actions.toast('success', '已添加命令');
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '添加失败');
    }
  };

  const removeCommand = async (id: string) => {
    await window.fm.commands.remove(id);
    await refresh();
  };

  return (
    <Section title="命令" hint="占位符：{{path}} {{name}} {{tag:foo}}。在项目详情中可一键执行。">
      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="text-note text-muted-foreground">尚未配置自定义命令。</p>
        ) : (
          list.map(c => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-foreground">{c.label}</p>
                <p className="truncate text-note text-muted-foreground">
                  {c.command}
                  {c.args?.length ? ` ${c.args.join(' ')}` : ''}
                </p>
              </div>
              <Button size="icon-xs" variant="ghost" onClick={() => void removeCommand(c.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
        <div className="rounded-md border border-dashed border-border px-3 py-3">
          <div className="grid grid-cols-3 gap-2">
            <input
              value={draft.label}
              onChange={e => setDraft({ ...draft, label: e.target.value })}
              placeholder="名称"
              className="h-9 rounded-md border border-border bg-background px-2 outline-none"
            />
            <input
              value={draft.command}
              onChange={e => setDraft({ ...draft, command: e.target.value })}
              placeholder="命令，如 idea64"
              className="h-9 rounded-md border border-border bg-background px-2 outline-none"
            />
            <input
              value={draft.args}
              onChange={e => setDraft({ ...draft, args: e.target.value })}
              placeholder="参数（空格分隔），如 {{path}}"
              className="h-9 rounded-md border border-border bg-background px-2 outline-none"
            />
          </div>
          <Button size="sm" variant="outline" className="mt-2.5" onClick={() => void addCommand()}>
            <Plus className="size-4" /> 添加命令
          </Button>
        </div>
      </div>
    </Section>
  );
}
