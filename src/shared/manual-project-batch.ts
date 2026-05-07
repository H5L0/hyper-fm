import type {
    ManualProjectValidationConflict,
    ManualProjectValidationResult,
    ProjectFingerprint,
} from './bridge.js';
import {
    createManualProjectValidationConflictKey,
    finalizeManualProjectValidation,
} from './manual-project-validation.js';

export type BatchManualProjectValidationStatus = 'pending' | 'imported' | 'failed';

export interface BatchManualProjectValidationCandidate {
    id: string;
    name: string;
    path: string;
    fingerprint: ProjectFingerprint;
    externalValidation: ManualProjectValidationResult;
    status?: BatchManualProjectValidationStatus;
}

export function mergeBatchManualProjectValidations(
    candidates: readonly BatchManualProjectValidationCandidate[],
): Record<string, ManualProjectValidationResult> {
    const conflictMaps = new Map<string, Map<string, ManualProjectValidationConflict>>();
    const activeCandidates = candidates.filter(candidate => candidate.status !== 'imported');

    for (const candidate of candidates) {
        const conflictMap = new Map<string, ManualProjectValidationConflict>();
        for (const conflict of candidate.externalValidation.conflicts) {
            conflictMap.set(createConflictKey(conflict), conflict);
        }
        conflictMaps.set(candidate.id, conflictMap);
    }

    for (const group of groupBy(activeCandidates, candidate => normalizePathKey(candidate.path)).values()) {
        if (group.length <= 1) continue;
        for (const candidate of group) {
            const conflictMap = conflictMaps.get(candidate.id)!;
            for (const other of group) {
                if (other.id === candidate.id) continue;
                const conflict: ManualProjectValidationConflict = {
                    kind: 'batch-duplicate-path',
                    projectId: other.id,
                    projectName: other.name,
                };
                conflictMap.set(createConflictKey(conflict), conflict);
            }
        }
    }

    for (const group of groupBy(activeCandidates, candidate => normalizeFingerprintKey(candidate.fingerprint)).values()) {
        if (group.length <= 1) continue;
        for (const candidate of group) {
            const conflictMap = conflictMaps.get(candidate.id)!;
            for (const other of group) {
                if (other.id === candidate.id) continue;
                const conflict: ManualProjectValidationConflict = {
                    kind: 'batch-duplicate-fingerprint',
                    projectId: other.id,
                    projectName: other.name,
                };
                conflictMap.set(createConflictKey(conflict), conflict);
            }
        }
    }

    return Object.fromEntries(
        candidates.map(candidate => {
            const conflicts = [...(conflictMaps.get(candidate.id)?.values() ?? [])];
            return [
                candidate.id,
                finalizeManualProjectValidation(conflicts),
            ];
        }),
    );
}

function groupBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const key = getKey(item);
        const group = groups.get(key);
        if (group) {
            group.push(item);
        } else {
            groups.set(key, [item]);
        }
    }
    return groups;
}

function normalizePathKey(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').trim().toLowerCase();
}

function normalizeFingerprintKey(fingerprint: ProjectFingerprint): string {
    if (fingerprint.kind === 'metadata') return 'metadata';
    if (fingerprint.kind === 'folder-name') {
        return `folder-name:${fingerprint.folderName.trim().toLowerCase()}`;
    }
    return `file-paths:${[...new Set(fingerprint.paths.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, 'en'))
        .join('|')}`;
}

function createConflictKey(conflict: ManualProjectValidationConflict): string {
    return createManualProjectValidationConflictKey(conflict);
}