import type {
    ManualProjectValidationResult,
    ProjectDirectoryInspection,
} from '@shared/bridge.js';
import type { ProjectFormValue } from '@/components/view/project-info-panel/project-details-view.js';

export type BatchImportItemStatus = 'pending' | 'importing' | 'imported' | 'failed';

export interface BatchImportItem {
    id: string;
    form: ProjectFormValue;
    inspection: ProjectDirectoryInspection | null;
    validation: ManualProjectValidationResult;
    status: BatchImportItemStatus;
    error?: string;
}