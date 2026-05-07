import type {
    ManualProjectValidationConflict,
    ManualProjectValidationResult,
} from './bridge.js';

export function finalizeManualProjectValidation(
    conflicts: readonly ManualProjectValidationConflict[],
): ManualProjectValidationResult {
    const deduped = dedupeManualProjectValidationConflicts(conflicts);
    return {
        valid: deduped.length === 0,
        conflicts: deduped,
    };
}

export function dedupeManualProjectValidationConflicts(
    conflicts: readonly ManualProjectValidationConflict[],
): ManualProjectValidationConflict[] {
    const duplicatePathProjectIds = new Set(
        conflicts
            .filter(conflict => conflict.kind === 'duplicate-path')
            .map(conflict => conflict.projectId),
    );

    const filtered = conflicts.filter(conflict => {
        if (conflict.kind === 'conflict-fingerprint') {
            return !duplicatePathProjectIds.has(conflict.projectId);
        }
        return true;
    });

    const unique = new Map<string, ManualProjectValidationConflict>();
    for (const conflict of filtered) {
        unique.set(createManualProjectValidationConflictKey(conflict), conflict);
    }

    return [...unique.values()].sort(compareManualProjectValidationConflicts);
}

export function createManualProjectValidationConflictKey(
    conflict: ManualProjectValidationConflict,
): string {
    return `${conflict.projectId}::${conflict.kind}::${conflict.detail ?? ''}`;
}

function compareManualProjectValidationConflicts(
    left: ManualProjectValidationConflict,
    right: ManualProjectValidationConflict,
): number {
    return getManualProjectValidationConflictPriority(left.kind)
        - getManualProjectValidationConflictPriority(right.kind);
}

function getManualProjectValidationConflictPriority(
    kind: ManualProjectValidationConflict['kind'],
): number {
    switch (kind) {
        case 'duplicate-path':
            return 0;
        case 'validation-failed':
            return 1;
        case 'conflict-fingerprint':
            return 2;
        case 'batch-duplicate-path':
            return 3;
        case 'batch-duplicate-fingerprint':
            return 4;
        default:
            return 99;
    }
}