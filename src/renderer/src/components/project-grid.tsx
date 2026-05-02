// ---------------------------------------------------------------------------
// 项目卡片网格 / 列表
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Copy, FileText, FolderOpen, Pencil, Terminal, Trash2 } from 'lucide-react';
import type { PresetCommandDescriptor, Project } from '@shared/bridge.js';
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
import { TagPill, resolveTagColor } from './tag-pill.js';

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
  const { config, tagFilter, search, view, selectedProjectId } = useAppState();
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

  const query: SearchQuery = useMemo(() => parseSearchQuery(search), [search]);

  const filtered = useMemo(() => {
    type Row = { project: Project; explain: MatchExplain };
    const rows: Row[] = [];
    for (const p of config.projects) {
      if (typeof tagFilter === 'object' && !p.tags.includes(tagFilter.tag)) continue;
      const explain = matchProject(p, query);
      if (!explain) continue;
      rows.push({ project: p, explain });
    }
    rows.sort((a, b) =>
      (b.project.lastModifiedAt ?? '').localeCompare(a.project.lastModifiedAt ?? ''),
    );
    return rows;
  }, [config.projects, tagFilter, query]);

  if (config.scanRoots.length === 0 && config.projects.length === 0) {
    return (
      <EmptyState
        title="尚未配置扫描根"
        hint="前往「设置」添加包含项目的目录后，点击「扫描」来发现项目，也可以从工具栏「添加项目」手动添加。"
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
        <table className="w-full border-collapse">
          <thead className="text-subheading sticky top-0 bg-background text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2.5 pl-4 text-left">名称</th>
              <th className="py-2.5 text-left">标签</th>
              <th className="py-2.5 text-left">路径</th>
              <th className="py-2.5 pr-4 text-right">修改时间</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ project: p, explain }) => {
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
                  <td className="py-2.5 pl-4">
                    <HighlightedText
                      text={p.name}
                      values={explain.values}
                      className="font-medium text-foreground"
                    />
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {p.tags.slice(0, 3).map(t => (
                        <TagPill
                          key={t}
                          name={t}
                          color={resolveTagColor(t, config.tags)}
                          size="sm"
                        >
                          <HighlightedText text={t} values={explain.values} />
                        </TagPill>
                      ))}
                      {p.tags.length > 3 ? (
                        <span className="text-caption text-muted-foreground">
                          +{p.tags.length - 3}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2.5 max-w-md truncate text-note text-muted-foreground" title={p.path}>
                    <HighlightedText text={p.path} values={explain.values} />
                  </td>
                  <td className="py-2.5 pr-4 text-right text-note tabular-nums text-muted-foreground">
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {filtered.map(({ project: p, explain }) => {
          return (
            <ProjectCard
              key={p.id}
              project={p}
              tagDefs={config.tags}
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
  tagDefs,
  selected,
  onSelect,
  onContextMenu,
  highlightValues,
}: {
  project: Project;
  tagDefs: readonly import('@shared/bridge.js').TagDefinition[] | undefined;
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
        'group relative flex min-h-[9.5rem] flex-col rounded-lg border bg-card px-3.5 py-3 text-left transition-all',
        'hover:border-foreground/20 hover:shadow-sm',
        selected ? 'border-foreground/30 ring-1 ring-foreground/10' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <HighlightedText
          text={project.name}
          values={highlightValues}
          className="truncate font-medium text-foreground"
        />
        {project.hasMetaFile ? (
          <span
            title="使用 .meta-data"
            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
          >
            meta
          </span>
        ) : null}
      </div>
      {project.description ? (
        <p className="mt-1.5 line-clamp-2 text-muted-foreground">
          <HighlightedText text={project.description} values={highlightValues} />
        </p>
      ) : null}
      {project.tags.length > 0 ? (
        <div className="mt-auto flex flex-wrap items-center gap-1 overflow-hidden pt-2.5">
          {project.tags.slice(0, 3).map(t => (
            <TagPill
              key={t}
              name={t}
              color={resolveTagColor(t, tagDefs)}
              size="sm"
            >
              <HighlightedText text={t} values={highlightValues} />
            </TagPill>
          ))}
          {project.tags.length > 3 ? (
            <span className="text-caption text-muted-foreground">
              +{project.tags.length - 3}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-auto" />
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-note text-muted-foreground/80">
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
      <p className="text-heading text-foreground">{title}</p>
      <p className="mt-2 max-w-sm text-note text-muted-foreground">{hint}</p>
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onDown, true);
    };
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
    if (id.startsWith('open.')) return id === 'open.terminal' ? Terminal : FolderOpen;
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
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[220px] overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
      style={style}
    >
      <MenuItem
        onClick={() => {
          actions.selectProject(project.id);
          onClose();
        }}
        icon={<Pencil className="size-4" />}
      >
        编辑详情…
      </MenuItem>
      <MenuSep />
      {presets.map(p => {
        const Icon = iconOf(p.id);
        return (
          <MenuItem key={p.id} onClick={() => void run(p.id)} icon={<Icon className="size-4" />}>
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
        icon={<Trash2 className="size-4" />}
      >
        从列表移除
      </MenuItem>
    </div>
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
      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </button>
  );
}

function MenuSep() {
  return <div className="my-1 border-t border-border" />;
}
