import type { Project, ProjectGitignorePreview, SyncConfig, SyncProjectRule } from '@shared/bridge.js';
import { getEffectiveSyncProjectState, resolveSyncProjectIds, setProjectSyncRule } from '@shared/sync-config.js';
import { IgnoreRulesEditor } from '@/components/basic/ignore-rules-editor';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { TriStateRuleButton, getNextTriStateRule } from '@/components/ui/tri-state-rule-button';
import { SyncConfigSummaryCard, getProjectSyncStateDescription } from '@/components/view/sync-config-card.js';
import { cn } from '@/lib/utils';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function ProjectSyncView({
    path,
    projectIgnore,
    ignoreText,
    onIgnoreTextChange,
    syncRespectGitignore,
    onSyncRespectGitignoreChange,
    project,
    allProjects,
    syncConfigs,
    ruleOverrides,
    busyId,
    onChangeRule,
}: {
    path: string;
    projectIgnore: string[];
    ignoreText: string;
    onIgnoreTextChange: (value: string) => void;
    syncRespectGitignore: boolean;
    onSyncRespectGitignoreChange: (checked: boolean) => void;
    project: Pick<Project, 'id' | 'rootId'>;
    allProjects: Array<Pick<Project, 'id' | 'rootId'>>;
    syncConfigs: SyncConfig[];
    ruleOverrides?: Partial<Record<string, SyncProjectRule>>;
    busyId: string | null;
    onChangeRule: (configId: string, rule: SyncProjectRule) => Promise<void> | void;
}) {
    const [gitignoreFiles, setGitignoreFiles] = useState<ProjectGitignorePreview[]>([]);
    const [loadingGitignoreFiles, setLoadingGitignoreFiles] = useState(false);
    const [expandedGitignorePaths, setExpandedGitignorePaths] = useState<string[]>([]);
    const ignoreKey = useMemo(() => JSON.stringify([...projectIgnore]), [projectIgnore]);
    const normalizedProjectIgnore = useMemo(() => [...projectIgnore], [ignoreKey]);

    useEffect(() => {
        if (!path.trim()) {
            setGitignoreFiles([]);
            setExpandedGitignorePaths([]);
            return;
        }
        let cancelled = false;
        setLoadingGitignoreFiles(true);
        void window.fm.projects.listGitignoreFiles(path, normalizedProjectIgnore)
            .then(files => {
                if (cancelled) return;
                setGitignoreFiles(files);
                setExpandedGitignorePaths(current => current.filter(item => files.some(file => file.path === item)));
            })
            .catch(() => {
                if (cancelled) return;
                setGitignoreFiles([]);
                setExpandedGitignorePaths([]);
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingGitignoreFiles(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [ignoreKey, normalizedProjectIgnore, path]);

    const toggleGitignorePath = (targetPath: string) => {
        setExpandedGitignorePaths(current => current.includes(targetPath)
            ? current.filter(item => item !== targetPath)
            : [...current, targetPath]);
    };

    return (
        <div className="h-full overflow-y-auto flex flex-col px-5 py-5 gap-5">
            <div>
                <label className="mb-2 block text-subheading text-muted-foreground">同步行为</label>
                <div className="space-y-3">
                    <CheckboxField
                        checked={syncRespectGitignore}
                        onCheckedChange={onSyncRespectGitignoreChange}
                        label="同步时遵循项目目录中的 .gitignore"
                        className="items-center"
                        checkboxClassName="mt-0"
                        contentClassName="pt-0"
                    />

                    <div>
                        {loadingGitignoreFiles ? (
                            <GitignoreStatusCard
                                tone="loading"
                                title="正在扫描 .gitignore…"
                            />
                        ) : gitignoreFiles.length === 0 ? (
                            <GitignoreStatusCard
                                tone="empty"
                                title={'没有 ".gitignore" 文件。'}
                            />
                        ) : (
                            <div className="space-y-2">
                                {gitignoreFiles.map(file => {
                                    const expanded = expandedGitignorePaths.includes(file.path);
                                    return (
                                        <div key={file.path} className="overflow-hidden rounded-xl border border-border bg-muted/35">
                                            <button
                                                type="button"
                                                onClick={() => toggleGitignorePath(file.path)}
                                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/55"
                                            >
                                                <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-note font-medium text-foreground">{file.path}</div>
                                                </div>
                                                {file.truncated ? (
                                                    <span className="shrink-0 text-caption text-muted-foreground">已截断</span>
                                                ) : null}
                                            </button>
                                            <div className={cn(
                                                'grid transition-[grid-template-rows] duration-200 ease-out',
                                                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                                            )}>
                                                <div className="overflow-hidden">
                                                    <div className="border-t border-border bg-background px-3 py-3">
                                                        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-note text-foreground/85">{file.content || '# 空文件'}</pre>
                                                        {file.truncated ? (
                                                            <p className="mt-2 text-caption text-muted-foreground">仅预览前 16 KB 内容。</p>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div>
                    <label className="mb-2 block text-subheading text-muted-foreground">忽略规则</label>
                    <p className="text-note text-muted-foreground">忽略同步的文件列表，格式与 .gitignore 相同。</p>
                </div>
                <IgnoreRulesEditor
                    value={ignoreText}
                    onChange={onIgnoreTextChange}
                    rows={3}
                />
            </div>

            <div>
                <label className="mb-2 block text-subheading text-muted-foreground">同步目标</label>
                <div className="space-y-3">
                    {syncConfigs.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-6 text-center text-note text-muted-foreground">
                            当前还没有同步配置，可在设置页先添加。
                        </div>
                    ) : (
                        syncConfigs.map(syncConfig => {
                            const hasOverride = Object.prototype.hasOwnProperty.call(ruleOverrides ?? {}, syncConfig.id);
                            const explicitRule = hasOverride
                                ? ruleOverrides?.[syncConfig.id] ?? 'default'
                                : readProjectRule(syncConfig, project.id);
                            const effectiveConfig = hasOverride
                                ? setProjectSyncRule(syncConfig, project, explicitRule)
                                : syncConfig;
                            const state = getEffectiveSyncProjectState(effectiveConfig, project);
                            const busy = busyId === syncConfig.id;
                            const includedProjectCount = resolveSyncProjectIds(effectiveConfig, allProjects).length;

                            return (
                                <SyncConfigSummaryCard
                                    key={syncConfig.id}
                                    syncConfig={syncConfig}
                                    includedProjectCount={includedProjectCount}
                                    detailText={getProjectSyncStateDescription(state)}
                                    leading={(
                                        <TriStateRuleButton
                                            state={explicitRule}
                                            label={`${syncConfig.name} 同步规则`}
                                            disabled={busy}
                                            onClick={() => void onChangeRule(syncConfig.id, getNextTriStateRule(explicitRule))}
                                        />
                                    )}
                                    className="bg-background"
                                />
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

function GitignoreStatusCard({
    tone,
    title,
}: {
    tone: 'loading' | 'empty';
    title: string;
}) {
    const loading = tone === 'loading';

    return (
        <div
            className={cn(
                'flex h-10 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left',
                'border-border/80 bg-muted/20 text-muted-foreground',
            )}
        >
            {loading ? (
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <div className="min-w-0 flex-1">
                <div className="truncate text-caption font-medium text-muted-foreground">
                    {title}
                </div>
            </div>
        </div>
    );
}

export function readProjectRule(syncConfig: SyncConfig, projectId: string): SyncProjectRule {
    if (syncConfig.targets.ignoredProjectIds.includes(projectId)) return 'ignored';
    if (syncConfig.targets.projectIds.includes(projectId)) return 'selected';
    return 'default';
}
