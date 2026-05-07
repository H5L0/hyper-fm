import { describe, expect, test } from 'vitest';
import { finalizeManualProjectValidation } from './manual-project-validation.js';

describe('manual-project-validation', () => {
    test('存在 duplicate-path 时应隐藏同项目的 conflict-fingerprint', () => {
        const result = finalizeManualProjectValidation([
            {
                kind: 'duplicate-path',
                projectId: 'pj-alpha',
                projectName: 'alpha',
            },
            {
                kind: 'conflict-fingerprint',
                projectId: 'pj-alpha',
                projectName: 'alpha',
            },
        ]);

        expect(result).toEqual({
            valid: false,
            conflicts: [
                {
                    kind: 'duplicate-path',
                    projectId: 'pj-alpha',
                    projectName: 'alpha',
                },
            ],
        });
    });

    test('同项目的 conflict-fingerprint 应自动去重', () => {
        const result = finalizeManualProjectValidation([
            {
                kind: 'conflict-fingerprint',
                projectId: 'pj-alpha',
                projectName: 'alpha',
            },
            {
                kind: 'conflict-fingerprint',
                projectId: 'pj-alpha',
                projectName: 'alpha',
            },
        ]);

        expect(result).toEqual({
            valid: false,
            conflicts: [
                {
                    kind: 'conflict-fingerprint',
                    projectId: 'pj-alpha',
                    projectName: 'alpha',
                },
            ],
        });
    });

    test('应按 kind + detail 去重', () => {
        const result = finalizeManualProjectValidation([
            {
                kind: 'batch-duplicate-fingerprint',
                projectId: 'batch-a',
                projectName: 'alpha',
            },
            {
                kind: 'batch-duplicate-fingerprint',
                projectId: 'batch-a',
                projectName: 'alpha',
            },
        ]);

        expect(result).toEqual({
            valid: false,
            conflicts: [
                {
                    kind: 'batch-duplicate-fingerprint',
                    projectId: 'batch-a',
                    projectName: 'alpha',
                },
            ],
        });
    });
});