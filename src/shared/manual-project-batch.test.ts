import { describe, expect, test } from 'vitest';
import { mergeBatchManualProjectValidations } from './manual-project-batch.js';

describe('manual-project-batch', () => {
    test('应保留现有外部冲突', () => {
        const result = mergeBatchManualProjectValidations([
            {
                id: 'batch-a',
                name: 'alpha',
                path: 'D:/projects/alpha',
                fingerprint: { kind: 'folder-name', folderName: 'alpha' },
                externalValidation: {
                    valid: false,
                    conflicts: [
                        {
                            kind: 'conflict-fingerprint',
                            projectId: 'pj-existing',
                            projectName: 'existing-alpha',
                        },
                    ],
                },
            },
        ]);

        expect(result['batch-a']).toEqual({
            valid: false,
            conflicts: [
                {
                    kind: 'conflict-fingerprint',
                    projectId: 'pj-existing',
                    projectName: 'existing-alpha',
                },
            ],
        });
    });

    test('相同文件夹名称指纹应在批量导入中互相冲突', () => {
        const result = mergeBatchManualProjectValidations([
            {
                id: 'batch-a',
                name: 'alpha',
                path: 'D:/projects/alpha',
                fingerprint: { kind: 'folder-name', folderName: 'demo' },
                externalValidation: { valid: true, conflicts: [] },
            },
            {
                id: 'batch-b',
                name: 'beta',
                path: 'D:/archive/beta',
                fingerprint: { kind: 'folder-name', folderName: 'demo' },
                externalValidation: { valid: true, conflicts: [] },
            },
        ]);

        expect(result['batch-a']?.valid).toBe(false);
        expect(result['batch-a']?.conflicts).toContainEqual({
            kind: 'batch-duplicate-fingerprint',
            projectId: 'batch-b',
            projectName: 'beta',
        });
        expect(result['batch-b']?.conflicts).toContainEqual({
            kind: 'batch-duplicate-fingerprint',
            projectId: 'batch-a',
            projectName: 'alpha',
        });
    });

    test('重复路径应标记为批量导入内部冲突', () => {
        const result = mergeBatchManualProjectValidations([
            {
                id: 'batch-a',
                name: 'alpha',
                path: 'D:/projects/demo',
                fingerprint: { kind: 'folder-name', folderName: 'demo-a' },
                externalValidation: { valid: true, conflicts: [] },
            },
            {
                id: 'batch-b',
                name: 'beta',
                path: 'd:/projects/demo/',
                fingerprint: { kind: 'folder-name', folderName: 'demo-b' },
                externalValidation: { valid: true, conflicts: [] },
            },
        ]);

        expect(result['batch-a']?.conflicts).toContainEqual({
            kind: 'batch-duplicate-path',
            projectId: 'batch-b',
            projectName: 'beta',
        });
        expect(result['batch-b']?.conflicts).toContainEqual({
            kind: 'batch-duplicate-path',
            projectId: 'batch-a',
            projectName: 'alpha',
        });
    });

    test('已导入条目不应继续参与批量内部冲突判断', () => {
        const result = mergeBatchManualProjectValidations([
            {
                id: 'batch-a',
                name: 'alpha',
                path: 'D:/projects/alpha',
                fingerprint: { kind: 'folder-name', folderName: 'demo' },
                externalValidation: { valid: true, conflicts: [] },
                status: 'imported',
            },
            {
                id: 'batch-b',
                name: 'beta',
                path: 'D:/projects/beta',
                fingerprint: { kind: 'folder-name', folderName: 'demo' },
                externalValidation: { valid: true, conflicts: [] },
            },
        ]);

        expect(result['batch-b']).toEqual({ valid: true, conflicts: [] });
    });
});