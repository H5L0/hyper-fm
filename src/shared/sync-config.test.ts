import { describe, expect, test } from 'vitest';
import { getEffectiveSyncProjectState, setProjectSyncRule } from './sync-config.js';
import { createDefaultSyncConfig } from './sync-types.js';

describe('sync-config', () => {
    test('[getEffectiveSyncProjectState] 忽略规则应高于选定规则', () => {
        const config = {
            ...createDefaultSyncConfig('shared-dir', 'local'),
            targets: {
                projectIds: ['pj-demo'],
                rootIds: ['root-demo'],
                ignoredProjectIds: ['pj-demo'],
                ignoredRootIds: [],
            },
        };
        const state = getEffectiveSyncProjectState(config, { id: 'pj-demo', rootId: 'root-demo' } as never);
        expect(state).toBe('ignored');
    });

    test('[setProjectSyncRule] 应能在选定 / 忽略 / 默认之间切换项目规则', () => {
        const base = createDefaultSyncConfig('zip', 'local');
        const project = { id: 'pj-demo', rootId: 'root-demo' } as never;
        const selected = setProjectSyncRule(base, project, 'selected');
        expect(selected.targets.projectIds).toContain('pj-demo');

        const ignored = setProjectSyncRule(selected, project, 'ignored');
        expect(ignored.targets.projectIds).not.toContain('pj-demo');
        expect(ignored.targets.ignoredProjectIds).toContain('pj-demo');

        const reset = setProjectSyncRule(ignored, project, 'default');
        expect(reset.targets.projectIds).not.toContain('pj-demo');
        expect(reset.targets.ignoredProjectIds).not.toContain('pj-demo');
    });
});