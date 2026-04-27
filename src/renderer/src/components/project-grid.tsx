// ---------------------------------------------------------------------------
// 项目卡片网格 / 列表
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Copy, ExternalLink, FileText, Pencil, Terminal, Trash2 } from 'lucide-react';
import type { Category, PresetCommandDescriptor, Project } from '@shared/bridge.js';
import {
  type HighlightSegment,
  type MatchExplain,
  type SearchQuery,
  highlight,
  matchProject,
  parseSearchQuery,
} from '@shared/search.js';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '../store/app-store.js';

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60_000) return '刚刚';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} 月前`;
  return `${Math.floor(diff / (365 * day))} 年前`;
}

function HighlightedText({
  text,
  values,
  className,
}: {
  text: string;
  values: readonly string[];
  className?: string;
}) {
  const segs: HighlightSegment[] = useMemo(() => highlight(text, values), [text, values]);
  return (
    <span className={className}>
      {segs.map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded bg-yellow-200/60 px-0.5 text-foreground dark:bg-yellow-300/30">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

export function ProjectGrid() {
  const { config, categoryFilter, search, view, selectedProjectId } = useAppState();
  const actions = useAppActions();
  const [menu, setMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [presets, setPresets] = useState<PresetCommandDescriptor[]>([]);

  useEffect(() => {
    void window.fm.commands.presets().then(setPresets);
  }, []);

  const openMenu = (e: MouseEvent, project: Project) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, project });
  };

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of config.categories) map.set(c.id, c);
    return map;
  }, [config.categories]);

  const query: SearchQuery = useMemo(() => parseSearchQuery(search), [search]);

  const filtered = useMemo(() => {
    type Row = { project: Project; category: Category | undefined; explain: MatchExplain };
    const rows: Row[] = [];
    for (const p of config.projects) {
      if (categoryFilter === 'UNCATEGORIZED' && p.categoryId) continue;
      if (categoryFilter !== 'ALL' && categoryFilter !== 'UNCATEGORIZED' && p.categoryId !== categoryFilter) continue;
      const cat = p.categoryId ? categoryById.get(p.categoryId) : undefined;
      const explain = matchProject(p, query, { category: cat });
      if (!explain) continue;
      rows.push({ project: p, category: cat, explain });
    }
    rows.sort((a, b) =>
      (b.project.lastModifiedAt ?? '').localeCompare(a.project.lastModifiedAt ?? ''),
    );
    return rows;
  }, [config.projects, categoryFilter, query, categoryById]);

  if (config.scanRoots.length === 0) {
    return (
      <EmptyState
        title="尚未配置扫描根"
        hint="前往「设置」添加包含项目的目录后，点击「扫描」来发现项目。"
      />
    );
  }

  if (config.projects.length === 0) {
    return (
      <EmptyState
        title="还没有项目"
        hint="点击右上角「扫描」开始发现项目，或在 .meta-data 中描述项目。"
      />
    );
  }

  if (filtered.length === 0) {
    return <EmptyState title="无匹配项目" hint="试试调整筛选或清空搜索。" />;
  }

  const menuOverlay = menu ? (
    <ProjectContextMenu
      x={menu.x}
      y={menu.y}
      project={menu.project}
      presets={presets}
      onClose={() => setMenu(null)}
    />
  ) : null;

  if (view === 'list') {
    return (
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-background text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="py-2 pl-4 text-left">名称</th>
              <th className="py-2 text-left">分类</th>
              <th className="py-2 text-left">标签</th>
              <th className="py-2 text-left">路径</th>
              <th className="py-2 pr-4 text-right">修改时间</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ project: p, category: cat, explain }) => {
              return (
                <tr
                  key={p.id}
                  onClick={() => actions.selectProject(p.id)}
                  onContextMenu={e => openMenu(e, p)}
                  className={cn(
                    'cursor-pointer border-b border-border/60 hover:bg-muted/40',
                    selectedProjectId === p.id && 'bg-muted/60',
                  )}
                >
                  <td className="py-2 pl-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: cat?.color ?? 'var(--border)' }}
                      />
                      <HighlightedText
                        text={p.name}
                        values={explain.values}
                        className="font-medium text-foreground"
                      />
                    </div>
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {cat ? <HighlightedText text={cat.name} values={explain.values} /> : '—'}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {p.tags.length > 0 ? (
                      <HighlightedText
                        text={p.tags.slice(0, 3).join(', ')}
                        values={explain.values}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 max-w-md truncate text-xs text-muted-foreground" title={p.path}>
                    <HighlightedText text={p.path} values={explain.values} />
                  </td>
                  <td className="py-2 pr-4 text-right text-xs tabular-nums text-muted-foreground">
                    {relativeTime(p.lastModifiedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {menuOverlay}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {filtered.map(({ project: p, category: cat, explain }) => {
          return (
            <ProjectCard
              key={p.id}
              project={p}
              category={cat}
              selected={selectedProjectId === p.id}
              onSelect={() => actions.selectProject(p.id)}
              onContextMenu={e => openMenu(e, p)}
              highlightValues={explain.values}
            />
          );
        })}
      </div>
      {menuOverlay}
    </div>
  );
}

function ProjectCard({
  project,
  category,
  selected,
  onSelect,
  onContextMenu,
  highlightValues,
}: {
  project: Project;
  category?: Category;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
  highlightValues: readonly string[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex h-32 flex-col rounded-lg border bg-card px-3 py-2.5 text-left transition-all',
        'hover:border-foreground/20 hover:shadow-sm',
        selected ? 'border-foreground/30 ring-1 ring-foreground/10' : 'border-border',
      )}
    >
      <span
        aria-hidden
        className="absolute top-2.5 left-0 h-4 w-1 rounded-r"
        style={{ backgroundColor: category?.color ?? 'transparent' }}
      />
      <div className="flex items-start justify-between gap-2 pl-1.5">
        <HighlightedText
          text={project.name}
          values={highlightValues}
          className="truncate text-sm font-medium text-foreground"
        />
        {project.hasMetaFile ? (
          <span
            title="使用 .meta-data"
            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"
          >
            meta
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 pl-1.5 text-xs text-muted-foreground">
        {project.description ? (
          <HighlightedText text={project.description} values={highlightValues} />
        ) : (
          category?.name || '—'
        )}
      </p>
      <div className="mt-auto flex items-center gap-1.5 overflow-hidden pl-1.5">
        {project.tags.slice(0, 3).map(t => (
          <span
            key={t}
            className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"
          >
            #<HighlightedText text={t} values={highlightValues} />
          </span>
        ))}
        {project.tags.length > 3 ? (
          <span className="text-[0.65rem] text-muted-foreground">+{project.tags.length - 3}</span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 pl-1.5 text-[0.65rem] text-muted-foreground/80">
        <HighlightedText
          text={project.path}
          values={highlightValues}
          className="truncate"
        />
        <span className="shrink-0 tabular-nums">{relativeTime(project.lastModifiedAt)}</span>
      </div>
    </button>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ProjectContextMenu({
  x,
  y,
  project,
  presets,
  onClose,
}: {
  x: number;
  y: number;
  project: Project;
  presets: PresetCommandDescriptor[];
  onClose: () => void;
}) {
  const actions = useAppActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (commandId: string) => {
    onClose();
    try {
      const r = await window.fm.commands.run(commandId, project.id);
      if (r.clipboard) actions.toast('success', `已复制：${r.clipboard}`);
      else actions.toast('success', '命令已启动');
    } catch (err) {
      actions.toast('error', err instanceof Error ? err.message : '命令执行失败');
    }
  };

  const iconOf = (id: string) => {
    if (id.startsWith('open.')) return id === 'open.terminal' ? Terminal : ExternalLink;
    if (id.startsWith('copy.')) return Copy;
    return FileText;
  };

  // 视口边界纠正
  const style: React.CSSProperties = { top: y, left: x };
  if (typeof window !== 'undefined') {
    const margin = 8;
    if (x + 220 + margin > window.innerWidth) style.left = window.innerWidth - 220 - margin;
    if (y + 280 + margin > window.innerHeight) style.top = window.innerHeight - 280 - margin;
  }

  return (
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        onContextMenu={e => {
          e.preventDefault();
          onClose();
        }}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        role="menu"
        className="fixed z-50 min-w-[200px] overflow-hidden rounded-md border border-border bg-popover py-1 text-sm shadow-md"
        style={style}
      >
        <MenuItem
          onClick={() => {
            actions.selectProject(project.id);
            onClose();
          }}
          icon={<Pencil className="size-3.5" />}
        >
          编辑详情…
        </MenuItem>
        <MenuSep />
        {presets.map(p => {
          const Icon = iconOf(p.id);
          return (
            <MenuItem key={p.id} onClick={() => void run(p.id)} icon={<Icon className="size-3.5" />}>
              {p.label}
            </MenuItem>
          );
        })}
        <MenuSep />
        <MenuItem
          onClick={() => {
            onClose();
            if (confirm(`从列表移除项目 “${project.name}”？（不会删除磁盘文件）`)) {
              void actions.removeProject(project.id);
            }
          }}
          icon={<Trash2 className="size-3.5" />}
        >
          从列表移除
        </MenuItem>
      </div>
    </>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </button>
  );
}

function MenuSep() {
  return <div className="my-1 border-t border-border" />;
}
