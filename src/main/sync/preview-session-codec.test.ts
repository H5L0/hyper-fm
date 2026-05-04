import { describe, expect, test } from 'vitest';
import type { SyncProjectPlan } from '../../shared/sync-types.js';
import {
    EncodedProjectPreviewView,
    encodeProjectPreview,
    expandApplyRequestWithPreview,
    readProjectPreviewRows,
} from './preview-session-codec.js';

function createPlan(operations: SyncProjectPlan['operations']): SyncProjectPlan {
    return {
        projectId: 'pj-demo',
        projectName: '演示项目',
        mode: 'two-way',
        localPath: 'C:/projects/demo',
        targetPath: 'D:/sync/demo',
        summary: {
            create: operations.filter(item => item.kind === 'create').length,
            update: operations.filter(item => item.kind === 'update').length,
            delete: operations.filter(item => item.kind === 'delete').length,
            conflict: operations.filter(item => item.kind === 'conflict').length,
            skip: operations.filter(item => item.kind === 'skip').length,
            total: operations.length,
        },
        operations,
    };
}

describe('preview-session-codec', () => {
    test('[readProjectPreviewRows] 多级文件应压平成带文件夹行的分页结果', () => {
        const encoded = encodeProjectPreview(createPlan([
            { relativePath: 'root.md', kind: 'create', direction: 'to-target' },
            { relativePath: 'src/conflict.ts', kind: 'conflict', direction: 'none' },
            { relativePath: 'src/main.ts', kind: 'update', direction: 'to-local' },
            { relativePath: 'zzz.json', kind: 'skip', direction: 'none' },
        ]));
        const view = new EncodedProjectPreviewView(encoded);

        const page = readProjectPreviewRows('session-demo', 'pj-demo', view, 0, 8, {
            operations: [],
            ranges: [],
        });

        expect(page.total).toBe(5);
        expect(page.rows.map(row => row.label)).toEqual([
            'src/',
            'conflict.ts',
            'main.ts',
            'root.md',
            'zzz.json',
        ]);
        expect(page.rows[0]).toMatchObject({
            kind: 'folder',
            subtreeEndIndex: 2,
            checked: true,
            partiallyChecked: false,
        });
        expect(page.rows[4]).toMatchObject({
            kind: 'file',
            aggregateKind: 'skip',
            checked: false,
            muted: true,
        });
    });

    test('[expandApplyRequestWithPreview] range 关闭后显式重新开启冲突文件应保留最终状态', () => {
        const encoded = encodeProjectPreview(createPlan([
            { relativePath: 'src/a.ts', kind: 'create', direction: 'to-target' },
            { relativePath: 'src/b.ts', kind: 'conflict', direction: 'none' },
        ]));
        const view = new EncodedProjectPreviewView(encoded);
        const selection = {
            operations: [{
                projectId: 'pj-demo',
                relativePath: 'src/b.ts',
                enabled: true,
                sequence: 2,
                conflictResolution: 'manual' as const,
                mergeDraftId: 'draft-demo',
            }],
            ranges: [{
                projectId: 'pj-demo',
                startIndex: 1,
                endIndex: 2,
                enabled: false,
                sequence: 1,
            }],
        };

        const page = readProjectPreviewRows('session-demo', 'pj-demo', view, 0, 3, selection);
        expect(page.rows[0]).toMatchObject({ checked: false, partiallyChecked: true, muted: false });
        expect(page.rows[1]).toMatchObject({ checked: false, muted: true });
        expect(page.rows[2]).toMatchObject({ checked: true, muted: false });

        const expanded = expandApplyRequestWithPreview('pj-demo', view, selection);
        expect(expanded).toEqual([
            {
                projectId: 'pj-demo',
                relativePath: 'src/a.ts',
                enabled: false,
                conflictResolution: undefined,
                mergeDraftId: undefined,
            },
            {
                projectId: 'pj-demo',
                relativePath: 'src/b.ts',
                enabled: true,
                conflictResolution: 'manual',
                mergeDraftId: 'draft-demo',
            },
        ]);
    });
});
