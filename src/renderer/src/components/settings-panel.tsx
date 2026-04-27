// ---------------------------------------------------------------------------
// 设置面板：配置切换、扫描根、忽略规则、主题、分类
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { FolderPlus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppActions, useAppState } from '../store/app-store.js';

export function SettingsPanel() {
  const { config, configPath } = useAppState();
  const actions = useAppActions();
  const [globsDraft, setGlobsDraft] = useState(config.ignore.globs.join('\n'));
  const [newCategory, setNewCategory] = useState('');

  const handleAddRoot = async () => {
    const dir = await actions.pickDirectory();
    if (!dir) return;
    try {
      await actions.addScanRoot({ path: dir, maxDepth: 3 });
      actions.toast('success', '已添加扫描根');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '添加失败');
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

  const handleAddCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    try {
      await actions.addCategory(name);
      setNewCategory('');
    } catch (error) {
      actions.toast('error', error instanceof Error ? error.message : '新建分类失败');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="text-base font-semibold">设置</h1>

        <Section title="配置文件" hint="加载或新建一份 fm 配置 JSON。">
          <div className="rounded-md border border-border bg-card px-3 py-2.5">
            <p className="font-mono text-xs break-all text-muted-foreground">{configPath}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void actions.pickAndLoadConfig()}>
                打开…
              </Button>
              <Button size="sm" variant="outline" onClick={() => void actions.pickAndCreateConfig()}>
                新建…
              </Button>
            </div>
          </div>
        </Section>

        <Section title="扫描根" hint="预指定可包含项目的目录；扫描时按 maxDepth 递归。">
          <div className="space-y-2">
            {config.scanRoots.length === 0 ? (
              <p className="text-xs text-muted-foreground">尚未添加扫描根。</p>
            ) : (
              config.scanRoots.map(root => (
                <div
                  key={root.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" title={root.path}>
                      {root.label || root.path}
                    </p>
                    {root.label ? (
                      <p className="truncate text-[0.7rem] text-muted-foreground" title={root.path}>
                        {root.path}
                      </p>
                    ) : null}
                  </div>
                  <DepthInput
                    value={root.maxDepth}
                    onChange={v => void actions.updateScanRoot(root.id, { maxDepth: v })}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={root.enabled}
                      onChange={e =>
                        void actions.updateScanRoot(root.id, { enabled: e.target.checked })
                      }
                    />
                    启用
                  </label>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="单独扫描"
                    onClick={() => void actions.runScanOne(root.id)}
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="删除"
                    onClick={() => void actions.removeScanRoot(root.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
            <Button size="sm" variant="outline" onClick={() => void handleAddRoot()}>
              <FolderPlus className="size-3.5" /> 添加扫描根
            </Button>
          </div>
        </Section>

        <Section title="分类" hint="可在项目详情中选择分类，或在 .meta-data 中按名称声明。">
          <div className="space-y-2">
            {config.categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">尚无分类。</p>
            ) : (
              config.categories.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5"
                >
                  <input
                    type="color"
                    value={c.color ?? '#888888'}
                    onChange={e => void actions.setCategoryColor(c.id, e.target.value)}
                    className="size-5 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <input
                    defaultValue={c.name}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v && v !== c.name) void actions.renameCategory(c.id, v);
                    }}
                    className="flex-1 bg-transparent text-sm outline-none"
                  />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => void actions.removeCategory(c.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
            <div className="flex items-center gap-2">
              <input
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleAddCategory();
                }}
                placeholder="新分类名称"
                className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button size="sm" variant="outline" onClick={() => void handleAddCategory()}>
                <Plus className="size-3.5" /> 添加
              </Button>
            </div>
          </div>
        </Section>

        <Section title="忽略规则" hint="支持精确名称、目录后缀 / 等极简 glob；建议保留 node_modules、.git 等。">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.ignore.respectGitignore}
              onChange={e => void actions.saveIgnore({ respectGitignore: e.target.checked })}
            />
            扫描时遵守 .gitignore
          </label>
          <textarea
            value={globsDraft}
            onChange={e => setGlobsDraft(e.target.value)}
            rows={6}
            className="mt-2 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
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
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DepthInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      深度
      <input
        type="number"
        min={1}
        max={10}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.max(1, Math.min(10, Number(draft) || value));
          if (n !== value) onChange(n);
          setDraft(String(n));
        }}
        className="h-6 w-12 rounded border border-border bg-background px-1 text-center tabular-nums outline-none"
      />
    </label>
  );
}
