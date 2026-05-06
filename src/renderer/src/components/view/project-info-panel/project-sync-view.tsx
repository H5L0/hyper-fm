import type { Project, SyncConfig, SyncProjectRule } from '@shared/bridge.js';
import { getEffectiveSyncProjectState, resolveSyncProjectIds, setProjectSyncRule } from '@shared/sync-config.js';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { TriStateRuleButton, getNextTriStateRule } from '@/components/ui/tri-state-rule-button';
import { SyncConfigSummaryCard, getProjectSyncStateDescription } from '@/components/view/sync-config-card.js';

export function ProjectSyncView({
    syncRespectGitignore,
    onSyncRespectGitignoreChange,
    project,
    allProjects,
    syncConfigs,
    ruleOverrides,
    busyId,
    onChangeRule,
}: {
    syncRespectGitignore: boolean;
    onSyncRespectGitignoreChange: (checked: boolean) => void;
    project: Pick<Project, 'id' | 'rootId'>;
    allProjects: Array<Pick<Project, 'id' | 'rootId'>>;
    syncConfigs: SyncConfig[];
    ruleOverrides?: Partial<Record<string, SyncProjectRule>>;
    busyId: string | null;
    onChangeRule: (configId: string, rule: SyncProjectRule) => Promise<void> | void;
}) {
    return (
        <div className="h-full overflow-y-auto flex flex-col px-5 py-5 gap-5">
            <div>
                <label className="mb-2 block text-subheading text-muted-foreground">同步行为</label>
                <CheckboxField
                    checked={syncRespectGitignore}
                    onCheckedChange={onSyncRespectGitignoreChange}
                    label="同步时遵循项目目录中的 .gitignore"
                    className="items-center"
                    checkboxClassName="mt-0"
                    contentClassName="pt-0"
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

export function readProjectRule(syncConfig: SyncConfig, projectId: string): SyncProjectRule {
    if (syncConfig.targets.ignoredProjectIds.includes(projectId)) return 'ignored';
    if (syncConfig.targets.projectIds.includes(projectId)) return 'selected';
    return 'default';
}
