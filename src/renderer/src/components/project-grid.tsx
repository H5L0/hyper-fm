// ---------------------------------------------------------------------------
// 项目卡片网格 / 列表
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import type { Category, Project } from '@shared/bridge.js';
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

function matchProject(p: Project, search: string): boolean {
  if (!search) return true;
  const s = search.trim().toLowerCase();
  if (!s) return true;
  return (
    p.name.toLowerCase().includes(s) ||
    p.path.toLowerCase().includes(s) ||
    (p.description?.toLowerCase().includes(s) ?? false) ||
    p.tags.some(t => t.toLowerCase().includes(s))
  );
}

export function ProjectGrid() {
  const { config, categoryFilter, search, view, selectedProjectId } = useAppState();
  const actions = useAppActions();

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of config.categories) map.set(c.id, c);
    return map;
  }, [config.categories]);

  const filtered = useMemo(() => {
    return config.projects
      .filter(p => {
        if (categoryFilter === 'ALL') return true;
        if (categoryFilter === 'UNCATEGORIZED') return !p.categoryId;
        return p.categoryId === categoryFilter;
      })
      .filter(p => matchProject(p, search))
      .sort((a, b) => (b.lastModifiedAt ?? '').localeCompare(a.lastModifiedAt ?? ''));
  }, [config.projects, categoryFilter, search]);

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
            {filtered.map(p => {
              const cat = p.categoryId ? categoryById.get(p.categoryId) : undefined;
              return (
                <tr
                  key={p.id}
                  onClick={() => actions.selectProject(p.id)}
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
                      <span className="font-medium text-foreground">{p.name}</span>
                    </div>
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">{cat?.name ?? '—'}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {p.tags.slice(0, 3).join(', ') || '—'}
                  </td>
                  <td className="py-2 max-w-md truncate text-xs text-muted-foreground" title={p.path}>
                    {p.path}
                  </td>
                  <td className="py-2 pr-4 text-right text-xs tabular-nums text-muted-foreground">
                    {relativeTime(p.lastModifiedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {filtered.map(p => {
          const cat = p.categoryId ? categoryById.get(p.categoryId) : undefined;
          return (
            <ProjectCard
              key={p.id}
              project={p}
              category={cat}
              selected={selectedProjectId === p.id}
              onSelect={() => actions.selectProject(p.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  category,
  selected,
  onSelect,
}: {
  project: Project;
  category?: Category;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
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
        <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
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
        {project.description || category?.name || '—'}
      </p>
      <div className="mt-auto flex items-center gap-1.5 overflow-hidden pl-1.5">
        {project.tags.slice(0, 3).map(t => (
          <span
            key={t}
            className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"
          >
            #{t}
          </span>
        ))}
        {project.tags.length > 3 ? (
          <span className="text-[0.65rem] text-muted-foreground">+{project.tags.length - 3}</span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 pl-1.5 text-[0.65rem] text-muted-foreground/80">
        <span className="truncate" title={project.path}>
          {project.path}
        </span>
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
