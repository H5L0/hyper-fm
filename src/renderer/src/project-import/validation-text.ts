import type {
    ManualProjectValidationConflict,
    ManualProjectValidationResult,
} from '@shared/bridge.js';

export function describeManualProjectValidationConflict(conflict: ManualProjectValidationConflict): string {
    switch (conflict.kind) {
        case 'duplicate-path':
            return '该目录已经添加过了。';
        case 'conflict-fingerprint':
            return '当前识别方式与已添加项目冲突。';
        case 'batch-duplicate-path':
            return '该目录和本次列表中的另一项是同一个路径。';
        case 'batch-duplicate-fingerprint':
            return '当前识别方式和本次列表中的另一项重复。';
        case 'validation-failed':
            return conflict.detail?.trim() || '校验失败，请稍后重试。';
        default:
            return '存在未识别的冲突。';
    }
}

export function getManualProjectValidationTitle(validation: ManualProjectValidationResult, mode: 'single' | 'batch'): string {
    if (validation.valid || validation.conflicts.length === 0) {
        return mode === 'single' ? '当前配置可添加。' : '当前配置可添加。';
    }
    return mode === 'single'
        ? '当前配置需要调整后才能添加：'
        : '当前项目需要调整后才能继续添加：';
}