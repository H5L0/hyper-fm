// ---------------------------------------------------------------------------
// 设置面板：按扫描 / 同步 / 软件设置拆分
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderPlus, FolderRoot, PenLine, Trash2 } from 'lucide-react';
import { ActionListEditor, type ActionListEditorController } from '@/components/basic/command-list-editor.js';
import { IgnoreRulesEditor } from '@/components/basic/ignore-rules-editor.js';
import { AddableList, AddableListItem } from '@/components/ui/addable-list';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
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
            emptyState="尚未添加扫描根目录"
            footerEnd={<ListMetaBadge>{config.scanRoots.length} 个扫描根</ListMetaBadge>}
            divided={false}
            sortable={{
              itemIds: config.scanRoots.map(root => root.id),
              onReorder: (activeId, targetIndex) => reorderScanRoots(activeId, targetIndex),
            }}
          >
            {config.scanRoots.map(root => (
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
            ))}
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

        <SettingSection title="通用">
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card px-4 py-4">
            <CheckboxField
              checked={appPreferences.autoLaunchEnabled}
              onCheckedChange={checked => void actions.saveAppPreferences({ autoLaunchEnabled: checked })}
              label="开机后自动启动 hyper-fm"
              className="items-center"
            />
            <CheckboxField
              checked={appPreferences.trayEnabled}
              onCheckedChange={checked => void actions.saveAppPreferences({ trayEnabled: checked })}
              label="关闭窗口后显示托盘"
              className="items-center"
            />
          </div>
        </SettingSection>

        <ActionsSection />

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
// 自定义动作
// ---------------------------------------------------------------------------

function ActionsSection() {
  const controller = useMemo<ActionListEditorController>(() => ({
    load: () => window.fm.actions.list(),
    add: input => window.fm.actions.add(input),
    update: (id, patch) => window.fm.actions.update(id, patch),
    replace: actions => window.fm.actions.replace(actions),
    remove: id => window.fm.actions.remove(id),
  }), []);

  return (
    <SettingSection title="动作" hint="所有项目可用的自定义动作。">
      <ActionListEditor controller={controller} showScopeSelector />
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
