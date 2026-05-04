import type {
    SyncFileOperation,
    SyncFileOperationKind,
    SyncPlanApplyRequest,
    SyncPlanOperationSelection,
    SyncPlanPreviewProjectSummary,
    SyncPlanRow,
    SyncPlanRowPage,
    SyncPlanSelectionState,
    SyncProjectPlan,
} from '../../shared/sync-types.js';

const STRING_ENCODER = new TextEncoder();
const STRING_DECODER = new TextDecoder();
const ROW_FIELD_COUNT = 7;
const OPERATION_KIND_CODES = ['create', 'update', 'delete', 'conflict', 'skip', 'mixed'] as const;

type EncodedOperationKind = (typeof OPERATION_KIND_CODES)[number];

enum StoredRowKind {
    Folder = 0,
    File = 1,
}

interface FolderTreeNode {
    kind: 'folder';
    name: string;
    children: Map<string, TreeNode>;
}

interface FileTreeNode {
    kind: 'file';
    name: string;
    operation: SyncFileOperation;
}

type TreeNode = FolderTreeNode | FileTreeNode;

interface RowDraft {
    kind: 'folder' | 'file';
    depth: number;
    label: string;
    folderPath: string;
    aggregateKind: SyncFileOperationKind | 'mixed';
    subtreeEndIndex: number;
    relativePath?: string;
}

interface DecodedRow {
    index: number;
    kind: 'folder' | 'file';
    depth: number;
    label: string;
    folderPath: string;
    aggregateKind: SyncFileOperationKind | 'mixed';
    subtreeEndIndex: number;
    relativePath?: string;
}

interface PreparedSelectionProjectState {
    operationsByPath: Map<string, SyncPlanOperationSelection & { sequence: number }>;
    ranges: Array<{ startIndex: number; endIndex: number; enabled: boolean; sequence: number }>;
}

interface PreparedSelectionState {
    byProject: Map<string, PreparedSelectionProjectState>;
}

export interface EncodedProjectPreview {
    summary: SyncPlanPreviewProjectSummary;
    rowsBuffer: SharedArrayBuffer;
    stringOffsetsBuffer: SharedArrayBuffer;
    stringsBuffer: SharedArrayBuffer;
}

function createFolderNode(name: string): FolderTreeNode {
    return { kind: 'folder', name, children: new Map() };
}

function isSyncableKind(kind: SyncFileOperationKind | 'mixed'): kind is SyncFileOperationKind {
    return kind !== 'mixed' && kind !== 'skip';
}

function collectDescendantOperations(node: TreeNode): SyncFileOperation[] {
    if (node.kind === 'file') {
        return [node.operation];
    }
    return [...node.children.values()].flatMap(child => collectDescendantOperations(child));
}

function sortTreeNodes(left: TreeNode, right: TreeNode): number {
    if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN');
}

function buildPreviewRows(operations: readonly SyncFileOperation[]): RowDraft[] {
    const root = createFolderNode('__root__');

    for (const operation of operations) {
        const segments = operation.relativePath.split('/').filter(Boolean);
        let current = root;
        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index]!;
            const isLeaf = index === segments.length - 1;
            if (isLeaf) {
                current.children.set(segment, {
                    kind: 'file',
                    name: segment,
                    operation,
                });
                continue;
            }

            const existing = current.children.get(segment);
            if (existing?.kind === 'folder') {
                current = existing;
                continue;
            }

            const nextNode = createFolderNode(segment);
            current.children.set(segment, nextNode);
            current = nextNode;
        }
    }

    const rows: RowDraft[] = [];

    const renderNode = (node: TreeNode, depth: number, parentPath = ''): void => {
        if (node.kind === 'file') {
            const segments = node.operation.relativePath.split('/').filter(Boolean);
            const index = rows.length;
            rows.push({
                kind: 'file',
                depth,
                label: node.name,
                folderPath: segments.slice(0, -1).join('/'),
                aggregateKind: node.operation.kind,
                subtreeEndIndex: index,
                relativePath: node.operation.relativePath,
            });
            return;
        }

        let currentNode = node;
        let fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
        while (currentNode.children.size === 1) {
            const onlyChild = [...currentNode.children.values()][0]!;
            if (onlyChild.kind !== 'folder') {
                break;
            }
            fullPath = `${fullPath}/${onlyChild.name}`;
            currentNode = onlyChild;
        }

        const descendants = collectDescendantOperations(currentNode);
        const descendantKinds = [...new Set(descendants.map(item => item.kind))];
        const rowIndex = rows.length;
        rows.push({
            kind: 'folder',
            depth,
            label: `${fullPath}/`,
            folderPath: fullPath,
            aggregateKind: descendantKinds.length === 1 ? descendantKinds[0]! : 'mixed',
            subtreeEndIndex: rowIndex,
        });

        const sortedChildren = [...currentNode.children.values()].sort(sortTreeNodes);
        for (const child of sortedChildren) {
            renderNode(child, depth + 1, fullPath);
        }

        rows[rowIndex]!.subtreeEndIndex = rows.length - 1;
    };

    const sortedRootChildren = [...root.children.values()].sort(sortTreeNodes);
    for (const child of sortedRootChildren) {
        renderNode(child, 0);
    }

    return rows;
}

function encodeOperationKind(kind: SyncFileOperationKind | 'mixed'): number {
    return OPERATION_KIND_CODES.indexOf(kind as EncodedOperationKind);
}

function decodeOperationKind(code: number): SyncFileOperationKind | 'mixed' {
    return OPERATION_KIND_CODES[code] ?? 'mixed';
}

function createStringTable(strings: readonly string[]): {
    stringOffsetsBuffer: SharedArrayBuffer;
    stringsBuffer: SharedArrayBuffer;
} {
    const encoded = strings.map(value => STRING_ENCODER.encode(value));
    const totalLength = encoded.reduce((sum, value) => sum + value.length, 0);
    const offsetsBuffer = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * (strings.length + 1));
    const stringsBuffer = new SharedArrayBuffer(totalLength === 0 ? 1 : totalLength);
    const offsets = new Uint32Array(offsetsBuffer);
    const bytes = new Uint8Array(stringsBuffer);

    let cursor = 0;
    for (let index = 0; index < encoded.length; index += 1) {
        offsets[index] = cursor;
        bytes.set(encoded[index]!, cursor);
        cursor += encoded[index]!.length;
    }
    offsets[strings.length] = cursor;

    return { stringOffsetsBuffer: offsetsBuffer, stringsBuffer };
}

export function encodeProjectPreview(plan: SyncProjectPlan): EncodedProjectPreview {
    const rows = buildPreviewRows(plan.operations);
    const updatedAt = new Date().toISOString();
    const stringIndex = new Map<string, number>();
    const strings: string[] = [];

    const getStringIndex = (value: string | undefined): number => {
        if (!value) return -1;
        const existing = stringIndex.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const next = strings.length;
        stringIndex.set(value, next);
        strings.push(value);
        return next;
    };

    const rowsBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * rows.length * ROW_FIELD_COUNT);
    const rowValues = new Int32Array(rowsBuffer);

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const base = index * ROW_FIELD_COUNT;
        rowValues[base] = row.kind === 'folder' ? StoredRowKind.Folder : StoredRowKind.File;
        rowValues[base + 1] = encodeOperationKind(row.aggregateKind);
        rowValues[base + 2] = getStringIndex(row.label);
        rowValues[base + 3] = getStringIndex(row.folderPath);
        rowValues[base + 4] = getStringIndex(row.relativePath);
        rowValues[base + 5] = row.depth;
        rowValues[base + 6] = row.subtreeEndIndex;
    }

    const { stringOffsetsBuffer, stringsBuffer } = createStringTable(strings);

    return {
        summary: {
            projectId: plan.projectId,
            projectName: plan.projectName,
            mode: plan.mode,
            localPath: plan.localPath,
            targetPath: plan.targetPath,
            summary: plan.summary,
            rowCount: rows.length,
            status: 'ready',
            updatedAt,
        },
        rowsBuffer,
        stringOffsetsBuffer,
        stringsBuffer,
    };
}

export class EncodedProjectPreviewView {
    private readonly rows: Int32Array;

    private readonly offsets: Uint32Array;

    private readonly strings: Uint8Array;

    constructor(private readonly encoded: EncodedProjectPreview) {
        this.rows = new Int32Array(encoded.rowsBuffer);
        this.offsets = new Uint32Array(encoded.stringOffsetsBuffer);
        this.strings = new Uint8Array(encoded.stringsBuffer);
    }

    get rowCount(): number {
        return this.encoded.summary.rowCount;
    }

    private getString(index: number): string {
        if (index < 0) {
            return '';
        }
        const start = this.offsets[index] ?? 0;
        const end = this.offsets[index + 1] ?? start;
        return STRING_DECODER.decode(this.strings.subarray(start, end));
    }

    decodeRow(index: number): DecodedRow {
        const safeIndex = Math.max(0, Math.min(index, this.rowCount - 1));
        const base = safeIndex * ROW_FIELD_COUNT;
        return {
            index: safeIndex,
            kind: this.rows[base] === StoredRowKind.Folder ? 'folder' : 'file',
            aggregateKind: decodeOperationKind(this.rows[base + 1] ?? 0),
            label: this.getString(this.rows[base + 2] ?? -1),
            folderPath: this.getString(this.rows[base + 3] ?? -1),
            relativePath: this.getString(this.rows[base + 4] ?? -1) || undefined,
            depth: this.rows[base + 5] ?? 0,
            subtreeEndIndex: this.rows[base + 6] ?? safeIndex,
        };
    }

    *iterRows(startIndex = 0, endIndex = this.rowCount - 1): Iterable<DecodedRow> {
        const start = Math.max(0, startIndex);
        const end = Math.min(this.rowCount - 1, endIndex);
        for (let index = start; index <= end; index += 1) {
            yield this.decodeRow(index);
        }
    }
}

function prepareSelectionState(selection?: SyncPlanSelectionState): PreparedSelectionState {
    const byProject = new Map<string, PreparedSelectionProjectState>();

    const ensureProjectState = (projectId: string): PreparedSelectionProjectState => {
        const existing = byProject.get(projectId);
        if (existing) {
            return existing;
        }
        const next: PreparedSelectionProjectState = {
            operationsByPath: new Map(),
            ranges: [],
        };
        byProject.set(projectId, next);
        return next;
    };

    for (const [index, operation] of (selection?.operations ?? []).entries()) {
        const projectState = ensureProjectState(operation.projectId);
        projectState.operationsByPath.set(operation.relativePath, {
            ...operation,
            sequence: operation.sequence ?? index,
        });
    }

    for (const range of selection?.ranges ?? []) {
        const projectState = ensureProjectState(range.projectId);
        projectState.ranges.push(range);
    }

    for (const projectState of byProject.values()) {
        projectState.ranges.sort((left, right) => left.sequence - right.sequence);
    }

    return { byProject };
}

function resolveFileEnabled(
    projectId: string,
    row: DecodedRow,
    selection: PreparedSelectionState,
): boolean {
    const defaultEnabled = isSyncableKind(row.aggregateKind);
    if (!row.relativePath) {
        return false;
    }

    const projectState = selection.byProject.get(projectId);
    if (!projectState) {
        return defaultEnabled;
    }

    let enabled = defaultEnabled;
    let sequence = -1;

    for (const range of projectState.ranges) {
        if (row.index < range.startIndex || row.index > range.endIndex) {
            continue;
        }
        if (range.sequence >= sequence) {
            enabled = range.enabled;
            sequence = range.sequence;
        }
    }

    const explicit = projectState.operationsByPath.get(row.relativePath);
    if (explicit && explicit.sequence >= sequence) {
        enabled = explicit.enabled;
    }

    return defaultEnabled ? enabled : false;
}

function buildFolderState(
    projectId: string,
    row: DecodedRow,
    view: EncodedProjectPreviewView,
    selection: PreparedSelectionState,
): Pick<SyncPlanRow, 'checked' | 'partiallyChecked' | 'muted'> {
    let totalSyncable = 0;
    let enabledCount = 0;

    for (const childRow of view.iterRows(row.index + 1, row.subtreeEndIndex)) {
        if (childRow.kind !== 'file' || !isSyncableKind(childRow.aggregateKind)) {
            continue;
        }
        totalSyncable += 1;
        if (resolveFileEnabled(projectId, childRow, selection)) {
            enabledCount += 1;
        }
    }

    return {
        checked: totalSyncable > 0 && enabledCount === totalSyncable,
        partiallyChecked: enabledCount > 0 && enabledCount < totalSyncable,
        muted: enabledCount === 0,
    };
}

function toSyncPlanRow(
    projectId: string,
    row: DecodedRow,
    view: EncodedProjectPreviewView,
    selection: PreparedSelectionState,
): SyncPlanRow {
    if (row.kind === 'file') {
        const checked = isSyncableKind(row.aggregateKind) && resolveFileEnabled(projectId, row, selection);
        return {
            index: row.index,
            kind: row.kind,
            depth: row.depth,
            label: row.label,
            folderPath: row.folderPath,
            aggregateKind: row.aggregateKind,
            subtreeEndIndex: row.subtreeEndIndex,
            relativePath: row.relativePath,
            checked,
            partiallyChecked: false,
            muted: !checked,
        };
    }

    return {
        index: row.index,
        kind: row.kind,
        depth: row.depth,
        label: row.label,
        folderPath: row.folderPath,
        aggregateKind: row.aggregateKind,
        subtreeEndIndex: row.subtreeEndIndex,
        relativePath: undefined,
        ...buildFolderState(projectId, row, view, selection),
    };
}

export function readProjectPreviewRows(
    sessionId: string,
    projectId: string,
    view: EncodedProjectPreviewView,
    startIndex: number,
    length: number,
    selection?: SyncPlanSelectionState,
): SyncPlanRowPage {
    const total = view.rowCount;
    const safeStart = Math.max(0, Math.min(startIndex, Math.max(total - 1, 0)));
    const safeLength = Math.max(0, length);
    const endIndex = Math.min(total - 1, safeStart + safeLength - 1);
    const preparedSelection = prepareSelectionState(selection);
    const rows = safeLength === 0 || total === 0
        ? []
        : [...view.iterRows(safeStart, endIndex)].map(row => toSyncPlanRow(projectId, row, view, preparedSelection));

    return {
        sessionId,
        projectId,
        startIndex: safeStart,
        total,
        rows,
    };
}

export function expandApplyRequestWithPreview(
    projectId: string,
    view: EncodedProjectPreviewView,
    selection: SyncPlanSelectionState,
): SyncPlanOperationSelection[] {
    const preparedSelection = prepareSelectionState(selection);
    const projectState = preparedSelection.byProject.get(projectId);
    const expanded: SyncPlanOperationSelection[] = [];

    for (const row of view.iterRows()) {
        if (row.kind !== 'file' || !row.relativePath) {
            continue;
        }

        const defaultEnabled = isSyncableKind(row.aggregateKind);
        const enabled = defaultEnabled && resolveFileEnabled(projectId, row, preparedSelection);
        const explicit = projectState?.operationsByPath.get(row.relativePath);

        if (!defaultEnabled) {
            if (explicit?.conflictResolution || explicit?.mergeDraftId) {
                expanded.push({
                    projectId,
                    relativePath: row.relativePath,
                    enabled: false,
                    conflictResolution: explicit.conflictResolution,
                    mergeDraftId: explicit.mergeDraftId,
                });
            }
            continue;
        }

        if (enabled !== defaultEnabled || explicit?.conflictResolution || explicit?.mergeDraftId) {
            expanded.push({
                projectId,
                relativePath: row.relativePath,
                enabled,
                conflictResolution: explicit?.conflictResolution,
                mergeDraftId: explicit?.mergeDraftId,
            });
        }
    }

    return expanded;
}

export function mergeExpandedApplySelections(
    request: SyncPlanApplyRequest,
    expandedSelections: SyncPlanOperationSelection[],
): SyncPlanApplyRequest {
    return {
        sessionId: request.sessionId,
        projectIds: request.projectIds,
        operations: expandedSelections,
        ranges: request.ranges,
    };
}
