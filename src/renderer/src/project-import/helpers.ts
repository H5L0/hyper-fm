import type {
    ManualProjectInput,
    ManualProjectValidationResult,
    ProjectFingerprint,
    ProjectDirectoryInspection,
} from '@shared/bridge.js';
import { mergeBatchManualProjectValidations } from '@shared/manual-project-batch.js';
import type { ProjectFormValue } from '@/components/view/project-info-panel/project-details-view.js';
import type { BatchImportItem } from './types.js';

export function createEmptyProjectForm(): ProjectFormValue {
    return {
        path: '',
        name: '',
        description: '',
        tags: [],
        ignore: [],
        syncRespectGitignore: false,
        fingerprint: { kind: 'folder-name', folderName: '' },
    };
}

export function normalizeForCompare(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function resolveDraftRootId(projectPath: string, scanRoots: readonly { id: string; path: string }[]): string {
    const normalizedPath = normalizeForCompare(projectPath.trim());
    if (!normalizedPath) return 'manual';
    const matchedRoot = scanRoots.find(root => {
        const normalizedRoot = normalizeForCompare(root.path);
        return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
    });
    return matchedRoot?.id ?? 'manual';
}

export function normalizeBatchPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').trim();
}

export function createBatchImportId(path: string): string {
    return normalizeBatchPath(path);
}

export function parseIgnoreRules(value: string): string[] {
    return [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
}

export function toManualProjectInput(form: ProjectFormValue): ManualProjectInput {
    return {
        path: form.path.trim(),
        name: form.name.trim() || undefined,
        description: form.description.trim() || undefined,
        tags: form.tags,
        ignore: form.ignore,
        syncRespectGitignore: form.syncRespectGitignore,
        fingerprint: form.fingerprint,
    };
}

export function createBatchProjectForm(inspection: ProjectDirectoryInspection): ProjectFormValue {
    return {
        path: inspection.path,
        name: inspection.suggestedName,
        description: '',
        tags: [],
        ignore: [],
        syncRespectGitignore: false,
        fingerprint: { kind: 'folder-name', folderName: inspection.suggestedName },
    };
}

export function createValidationFailure(itemId: string, projectName: string, detail: string): ManualProjectValidationResult {
    return {
        valid: false,
        conflicts: [{ kind: 'validation-failed', projectId: itemId, projectName, detail }],
    };
}

export function updateBatchItem(
    items: readonly BatchImportItem[],
    itemId: string,
    patch: Partial<BatchImportItem>,
): BatchImportItem[] {
    return items.map(item => (item.id === itemId ? { ...item, ...patch } : item));
}

export function sameFingerprint(a: ProjectFingerprint, b: ProjectFingerprint): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'metadata' && b.kind === 'metadata') return true;
    if (a.kind === 'folder-name' && b.kind === 'folder-name') return a.folderName === b.folderName;
    if (a.kind === 'file-paths' && b.kind === 'file-paths') {
        return a.paths.length === b.paths.length && a.paths.every((item, index) => item === b.paths[index]);
    }
    return false;
}

export function affectsValidation(current: ProjectFormValue, next: ProjectFormValue): boolean {
    if (current.path !== next.path) return true;
    if (current.ignore.length !== next.ignore.length) return true;
    if (current.ignore.some((item, index) => item !== next.ignore[index])) return true;
    return !sameFingerprint(current.fingerprint, next.fingerprint);
}

export function hasEmptyFileFingerprint(form: ProjectFormValue): boolean {
    return form.fingerprint.kind === 'file-paths' && form.fingerprint.paths.length === 0;
}

export function isBatchItemReady(item: BatchImportItem): boolean {
    return item.status !== 'imported' && item.validation.valid && !hasEmptyFileFingerprint(item.form);
}

export function isBatchItemAlreadyAdded(item: BatchImportItem): boolean {
    return item.status === 'imported'
        || item.validation.conflicts.some(conflict => conflict.kind === 'duplicate-path');
}

export async function createBatchImportItem(directoryPath: string): Promise<BatchImportItem> {
    const normalizedPath = normalizeBatchPath(directoryPath);
    const itemId = createBatchImportId(normalizedPath);
    try {
        const inspection = await window.fm.projects.inspectDirectory(normalizedPath, []);
        const form = createBatchProjectForm(inspection);
        const validation = await window.fm.projects.validateNew(toManualProjectInput(form));
        return {
            id: itemId,
            form,
            inspection,
            validation,
            status: 'pending',
        };
    } catch (error) {
        const projectName = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
        const message = error instanceof Error ? error.message : '目录检查失败';
        return {
            id: itemId,
            form: {
                path: normalizedPath,
                name: projectName,
                description: '',
                tags: [],
                ignore: [],
                syncRespectGitignore: false,
                fingerprint: { kind: 'folder-name', folderName: projectName },
            },
            inspection: null,
            validation: createValidationFailure(itemId, projectName, message),
            status: 'failed',
            error: message,
        };
    }
}

export async function refreshBatchItemSnapshot(item: BatchImportItem, nextForm: ProjectFormValue): Promise<BatchImportItem> {
    try {
        const inspection = await window.fm.projects.inspectDirectory(nextForm.path.trim(), nextForm.ignore);
        const fingerprint: ProjectFingerprint = nextForm.fingerprint.kind === 'file-paths'
            ? { kind: 'file-paths', paths: nextForm.fingerprint.paths.filter(file => inspection.files.includes(file)) }
            : nextForm.fingerprint.kind === 'folder-name' && !nextForm.fingerprint.folderName.trim()
                ? { kind: 'folder-name', folderName: inspection.suggestedName }
                : nextForm.fingerprint;
        return {
            ...item,
            inspection,
            error: undefined,
            form: {
                ...nextForm,
                path: inspection.path,
                fingerprint,
            },
        };
    } catch (error) {
        return {
            ...item,
            inspection: null,
            error: error instanceof Error ? error.message : '目录检查失败',
            form: nextForm,
        };
    }
}

export async function refreshBatchItemsValidation(items: readonly BatchImportItem[]): Promise<BatchImportItem[]> {
    const hydrated = await Promise.all(items.map(async item => {
        if (item.status === 'imported') {
            return {
                item,
                externalValidation: { valid: true, conflicts: [] } satisfies ManualProjectValidationResult,
            };
        }
        try {
            const externalValidation = await window.fm.projects.validateNew(toManualProjectInput(item.form));
            return { item, externalValidation };
        } catch (error) {
            const message = error instanceof Error ? error.message : '校验失败';
            return {
                item,
                externalValidation: createValidationFailure(
                    item.id,
                    item.form.name || item.inspection?.suggestedName || item.form.path,
                    message,
                ),
            };
        }
    }));

    const merged = mergeBatchManualProjectValidations(
        hydrated.map(({ item, externalValidation }) => ({
            id: item.id,
            name: item.form.name || item.inspection?.suggestedName || item.form.path,
            path: item.form.path,
            fingerprint: item.form.fingerprint,
            externalValidation,
            status: item.status === 'imported'
                ? 'imported'
                : item.status === 'failed'
                    ? 'failed'
                    : 'pending',
        })),
    );

    return hydrated.map(({ item, externalValidation }) => ({
        ...item,
        validation: merged[item.id] ?? externalValidation,
    }));
}