import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Ellipsis, FileText, Pencil, Trash2 } from 'lucide-react';
import type { CustomAction, PresetActionDescriptor, Project } from '@shared/bridge.js';
import { matchesDynamicTag, matchesTagGroup } from '@shared/dynamic-tags.js';
import {
    type HighlightSegment,
    type MatchExplain,
    type SearchQuery,
    highlight,
    matchProject,
    parseSearchQuery,
} from '@shared/search.js';
import { ProjectCommandMenu } from '@/components/basic/project-command-menu.js';
import { cn } from '@/lib/utils';
import { useAppActions, useAppState } from '@/store/app-store.js';
import { TagPill, resolveTagColor, sortTagsByDefinition } from '@/components/basic/tag-pill.js';

function matchesTagFilter(
    project: Project,
    directoryModifiedAt: string | undefined,
    filter: ReturnType<typeof useAppState>['tagFilter'],
    tagGroups: readonly import('@shared/bridge.js').TagGroupDefinition[] | undefined,
): boolean {
    if (filter === 'ALL') return true;
    if (filter.kind === 'tag') return project.tags.includes(filter.tag);
    if (filter.kind === 'dynamic') return matchesDynamicTag({ modifiedAt: directoryModifiedAt }, filter.id);
    const group = tagGroups?.find(item => item.name === filter.group);
    if (!group || group.tags.length === 0) return false;
    return matchesTagGroup({ tags: project.tags, modifiedAt: directoryModifiedAt }, group.tags);
}

function relativeTime(iso?: string): string {
    if (!iso) return '';
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return '';
    const diff = Date.now() - time;
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
    const segments: HighlightSegment[] = useMemo(() => highlight(text, values), [text, values]);

    return (
        <span className={className}>
            {segments.map((segment, index) =>
                segment.hit ? (
                    <mark key={index} className="rounded bg-yellow-200/60 px-0.5 text-foreground dark:bg-yellow-300/30">
                        {segment.text}
                    </mark>
                ) : (
                    <span key={index}>{segment.text}</span>
                ),
            )}
        </span>
    );
}

export function ProjectBrowserView() {
    const { config, projectRuntimeInfo, tagFilter, search, view, selectedProjectId } = useAppState();
    const actions = useAppActions();
    const [menu, setMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
    const [presets, setPresets] = useState<PresetActionDescriptor[]>([]);

    useEffect(() => {
        void window.fm.actions.presets().then(setPresets);
    }, []);

    const openMenu = (event: MouseEvent, project: Project) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, project });
    };

    const openMenuAt = (x: number, y: number, project: Project) => {
        setMenu({ x, y, project });
    };

    const query: SearchQuery = useMemo(() => parseSearchQuery(search), [search]);

    const filtered = useMemo(() => {
        type Row = { project: Project; explain: MatchExplain; directoryModifiedAt?: string };
        const rows: Row[] = [];
        for (const project of config.projects) {
            const directoryModifiedAt = projectRuntimeInfo[project.id]?.directoryModifiedAt;
            if (!matchesTagFilter(project, directoryModifiedAt, tagFilter, config.tagGroups)) continue;
            const explain = matchProject(project, query);
            if (!explain) continue;
            rows.push({ project, explain, directoryModifiedAt });
        }
        rows.sort((a, b) =>
            (b.directoryModifiedAt ?? '').localeCompare(a.directoryModifiedAt ?? ''),
        );
        return rows;
    }, [config.projects, config.tagGroups, projectRuntimeInfo, tagFilter, query]);

    if (config.scanRoots.length === 0 && config.projects.length === 0) {
        return (
            <EmptyState
                title="尚未添加扫描根目录"
                hint="前往「扫描设置」添加包含项目的目录后，点击「扫描」来发现项目，也可以从工具栏「添加项目」手动添加。"
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
            globalActions={config.actions ?? []}
            presets={presets}
            onClose={() => setMenu(null)}
        />
    ) : null;

    if (view === 'list') {
        return (
            <div className="flex-1 overflow-y-auto">
                <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-background text-subheading text-muted-foreground">
                        <tr className="border-b border-border">
                            <th className="py-2.5 pl-4 text-left">名称</th>
                            <th className="py-2.5 text-left">标签</th>
                            <th className="py-2.5 text-left">路径</th>
                            <th className="py-2.5 pr-4 text-right">修改时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(({ project, explain, directoryModifiedAt }) => (
                            <tr
                                key={project.id}
                                onClick={() => actions.selectProject(project.id)}
                                onContextMenu={event => openMenu(event, project)}
                                className={cn(
                                    'cursor-pointer border-b border-border/60 hover:bg-muted/40',
                                    selectedProjectId === project.id && 'bg-muted/60',
                                )}
                            >
                                <td className="py-2.5 pl-4">
                                    <HighlightedText
                                        text={project.name}
                                        values={explain.values}
                                        className="font-medium text-foreground"
                                    />
                                </td>
                                <td className="py-2.5">
                                    <div className="flex flex-wrap items-center gap-1">
                                        {sortTagsByDefinition(project.tags, config.tags).slice(0, 3).map(tag => (
                                            <TagPill
                                                key={tag}
                                                name={tag}
                                                color={resolveTagColor(tag, config.tags)}
                                                size="sm"
                                            >
                                                <HighlightedText text={tag} values={explain.values} />
                                            </TagPill>
                                        ))}
                                        {project.tags.length > 3 ? (
                                            <span className="text-caption text-muted-foreground">
                                                +{project.tags.length - 3}
                                            </span>
                                        ) : null}
                                    </div>
                                </td>
                                <td className="max-w-md py-2.5 text-note text-muted-foreground" title={project.path}>
                                    <HighlightedText text={project.path} values={explain.values} className="truncate" />
                                </td>
                                <td className="py-2.5 pr-4 text-right text-note tabular-nums text-muted-foreground">
                                    {relativeTime(directoryModifiedAt)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {menuOverlay}
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {filtered.map(({ project, explain, directoryModifiedAt }) => (
                    <ProjectCard
                        key={project.id}
                        project={project}
                        directoryModifiedAt={directoryModifiedAt}
                        tagDefs={config.tags}
                        selected={selectedProjectId === project.id}
                        onSelect={() => actions.selectProject(project.id)}
                        onContextMenu={event => openMenu(event, project)}
                        onMenuOpen={(x, y) => openMenuAt(x, y, project)}
                        highlightValues={explain.values}
                    />
                ))}
            </div>
            {menuOverlay}
        </div>
    );
}

function ProjectCard({
    project,
    directoryModifiedAt,
    tagDefs,
    selected,
    onSelect,
    onContextMenu,
    onMenuOpen,
    highlightValues,
}: {
    project: Project;
    directoryModifiedAt?: string;
    tagDefs: readonly import('@shared/bridge.js').TagDefinition[] | undefined;
    selected: boolean;
    onSelect: () => void;
    onContextMenu: (event: MouseEvent) => void;
    onMenuOpen: (x: number, y: number) => void;
    highlightValues: readonly string[];
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onContextMenu={onContextMenu}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect();
                }
            }}
            className={cn(
                'group relative flex min-h-38 flex-col rounded-lg border bg-card px-3.5 py-3 text-left transition-all',
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
                <div className="flex items-center gap-1">
                    {project.hasMetaFile ? (
                        <span
                            title="使用 .meta-data"
                            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
                        >
                            meta
                        </span>
                    ) : null}
                    <button
                        type="button"
                        aria-label={`打开 ${project.name} 的更多操作`}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={event => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            onMenuOpen(rect.left, rect.bottom + 4);
                        }}
                        onContextMenu={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            onMenuOpen(rect.right, rect.bottom + 4);
                        }}
                    >
                        <Ellipsis className="size-4" />
                    </button>
                </div>
            </div>
            {project.description ? (
                <p className="mt-1.5 line-clamp-2 text-muted-foreground">
                    <HighlightedText text={project.description} values={highlightValues} />
                </p>
            ) : null}
            {project.tags.length > 0 ? (
                <div className="mt-auto flex flex-wrap items-center gap-1 overflow-hidden pt-2.5">
                    {sortTagsByDefinition(project.tags, tagDefs).slice(0, 3).map(tag => (
                        <TagPill
                            key={tag}
                            name={tag}
                            color={resolveTagColor(tag, tagDefs)}
                            size="sm"
                        >
                            <HighlightedText text={tag} values={highlightValues} />
                        </TagPill>
                    ))}
                    {project.tags.length > 3 ? (
                        <span className="text-caption text-muted-foreground">+{project.tags.length - 3}</span>
                    ) : null}
                </div>
            ) : (
                <div className="mt-auto" />
            )}
            <div className="mt-2 flex items-center justify-between gap-2 text-note text-muted-foreground/80">
                <HighlightedText text={project.path} values={highlightValues} className="truncate" />
                <span className="shrink-0 tabular-nums">{relativeTime(directoryModifiedAt)}</span>
            </div>
        </div>
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
    globalActions,
    presets,
    onClose,
}: {
    x: number;
    y: number;
    project: Project;
    globalActions: CustomAction[];
    presets: PresetActionDescriptor[];
    onClose: () => void;
}) {
    const actions = useAppActions();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const onDown = (event: globalThis.MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) onClose();
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

    const run = async (actionId: string) => {
        onClose();
        try {
            const result = await window.fm.actions.run(actionId, project.id);
            if (result.clipboard) actions.toast('success', `已复制：${result.clipboard}`);
            else actions.toast('success', '动作已启动');
        } catch (error) {
            actions.toast('error', error instanceof Error ? error.message : '动作执行失败');
        }
    };

    const style: React.CSSProperties = { top: y, left: x };
    if (typeof window !== 'undefined') {
        const margin = 8;
        if (x + 220 + margin > window.innerWidth) style.left = window.innerWidth - 220 - margin;
        if (y + 280 + margin > window.innerHeight) style.top = window.innerHeight - 280 - margin;
    }

    return (
        <div
            ref={ref}
            className="fixed z-50"
            style={style}
        >
            <ProjectCommandMenu
                project={project}
                globalActions={globalActions}
                presets={presets}
                onRunAction={actionId => void run(actionId)}
                leadingActions={[
                    {
                        id: 'edit-project',
                        label: '编辑详情…',
                        icon: <Pencil className="size-4" />,
                        onSelect: () => {
                            actions.selectProject(project.id);
                            onClose();
                        },
                    },
                    {
                        id: 'view-files',
                        label: '查看文件',
                        icon: <FileText className="size-4" />,
                        onSelect: () => {
                            actions.openProjectFiles(project.id);
                            onClose();
                        },
                    },
                ]}
                trailingActions={[
                    {
                        id: 'remove-project',
                        label: '从列表移除',
                        icon: <Trash2 className="size-4" />,
                        onSelect: () => {
                            onClose();
                            if (confirm(`从列表移除项目 “${project.name}”？（不会删除磁盘文件）`)) {
                                void actions.removeProject(project.id);
                            }
                        },
                    },
                ]}
            />
        </div>
    );
}
