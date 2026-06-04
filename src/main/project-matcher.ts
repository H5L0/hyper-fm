// ---------------------------------------------------------------------------
// 项目指纹匹配：目录检查、指纹冲突判断、扫描匹配结果汇总
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateId } from '../shared/id.js';
import { createLogger } from '../shared/logger.js';
import { normalizePath, basename } from '../shared/path-utils.js';
import type {
    ProjectDirectoryEntry,
    ProjectDirectoryExpandResult,
    ProjectGitignorePreview,
    ProjectDirectoryIgnoreSource,
    ProjectDirectoryScanMode,
} from '../shared/bridge.js';
import type {
    FilePathsFingerprint,
    ProjectBinding,
    ProjectFingerprint,
    ScanWarning,
    SharedProject,
} from '../shared/types.js';
import { createIgnoreMatcher } from './ignore-matcher.js';
import { readMetaFile } from './meta-file.js';

const logger = createLogger('main:project-matcher');

export interface DirectoryInspection {
    path: string;
    name: string;
    hasMetaFile: boolean;
    metaProjectId?: string;
    tree: ProjectDirectoryEntry[];
    files: string[];
    filesComplete: boolean;
    ignoreMatchers: InspectIgnoreMatchers;
}

export interface InspectProjectDirectoryOptions {
    globalIgnore?: readonly string[];
    projectIgnore?: readonly string[];
    mode?: ProjectDirectoryScanMode;
    includeFiles?: readonly string[];
}

interface InspectIgnoreMatchers {
    globalIgnore: ReturnType<typeof createIgnoreMatcher>;
    projectIgnore: ReturnType<typeof createIgnoreMatcher>;
}

interface DirectoryScanStrategy {
    maxAutoExpandDepth: number;
    fileHeavyThreshold: number;
    maxScannedDirs: number;
    maxNodes: number;
    maxFiles: number;
}

interface DirectoryScanStats {
    scannedDirs: number;
    scannedNodes: number;
    scannedFiles: number;
}

interface DirectoryLayerReadResult {
    entries: ProjectDirectoryEntry[];
    files: string[];
    folders: ProjectDirectoryFolderEntry[];
}

type ProjectDirectoryFolderEntry = ProjectDirectoryEntry & {
    kind: 'folder';
    childrenLoaded?: boolean;
    children?: ProjectDirectoryEntry[];
};

interface PendingFolderScan {
    relPath: string;
    depth: number;
    node: ProjectDirectoryFolderEntry | null;
}

const DIRECTORY_SCAN_STRATEGIES: Record<ProjectDirectoryScanMode, DirectoryScanStrategy> = {
    summary: {
        maxAutoExpandDepth: 0,
        fileHeavyThreshold: 0,
        maxScannedDirs: 1,
        maxNodes: 800,
        maxFiles: 400,
    },
    interactive: {
        maxAutoExpandDepth: 3,
        fileHeavyThreshold: 48,
        maxScannedDirs: 160,
        maxNodes: 4000,
        maxFiles: 2400,
    },
    full: {
        maxAutoExpandDepth: Number.POSITIVE_INFINITY,
        fileHeavyThreshold: Number.POSITIVE_INFINITY,
        maxScannedDirs: Number.POSITIVE_INFINITY,
        maxNodes: Number.POSITIVE_INFINITY,
        maxFiles: Number.POSITIVE_INFINITY,
    },
};

const GITIGNORE_PREVIEW_MAX_LENGTH = 16 * 1024;

function normalizeFolderName(name: string): string {
    return name.trim().toLowerCase();
}

function compareEntries(a: import('node:fs').Dirent, b: import('node:fs').Dirent): number {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
}

async function walkFiles(
    rootPath: string,
    relDir: string,
    matchers: InspectIgnoreMatchers,
): Promise<DirectoryLayerReadResult> {
    const abs = relDir ? path.join(rootPath, relDir) : rootPath;
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
        return { entries: [], files: [], folders: [] };
    }
    const layer: DirectoryLayerReadResult = {
        entries: [],
        files: [],
        folders: [],
    };
    entries.sort(compareEntries);
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
        const normalizedRel = childRel.replace(/\\/g, '/');
        const ignoredBy = resolveIgnoredBy(normalizedRel, entry.isDirectory(), matchers);
        if (entry.isDirectory()) {
            const node: ProjectDirectoryFolderEntry = {
                path: normalizedRel,
                name: entry.name,
                kind: 'folder',
                childrenLoaded: false,
                ...(ignoredBy ? { ignoredBy } : {}),
            };
            layer.entries.push(node);
            if (!ignoredBy) {
                layer.folders.push(node);
            }
            continue;
        }
        if (entry.isFile()) {
            layer.entries.push({
                path: normalizedRel,
                name: entry.name,
                kind: 'file',
                ...(ignoredBy ? { ignoredBy } : {}),
            });
            if (!ignoredBy) layer.files.push(normalizedRel);
        }
    }

    return layer;
}

function resolveIgnoredBy(
    relativePath: string,
    isDir: boolean,
    options: InspectIgnoreMatchers,
): ProjectDirectoryIgnoreSource | undefined {
    if (options.globalIgnore.isIgnored(relativePath, isDir)) return 'global';
    if (options.projectIgnore.isIgnored(relativePath, isDir)) return 'project';
    return undefined;
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
}

function buildForcedFolderPathSet(includeFiles: readonly string[]): Set<string> {
    const folders = new Set<string>();
    for (const file of includeFiles) {
        const normalizedFile = normalizeRelativePath(file);
        if (!normalizedFile) continue;
        const segments = normalizedFile.split('/');
        for (let index = 1; index < segments.length; index += 1) {
            folders.add(segments.slice(0, index).join('/'));
        }
    }
    return folders;
}

function hasScanBudgetRemaining(stats: DirectoryScanStats, strategy: DirectoryScanStrategy): boolean {
    return stats.scannedDirs < strategy.maxScannedDirs
        && stats.scannedNodes < strategy.maxNodes
        && stats.scannedFiles < strategy.maxFiles;
}

function shouldPreloadChildFolders(
    depth: number,
    visibleFileCount: number,
    stats: DirectoryScanStats,
    strategy: DirectoryScanStrategy,
): boolean {
    if (!hasScanBudgetRemaining(stats, strategy)) return false;
    if (depth >= strategy.maxAutoExpandDepth) return false;
    return visibleFileCount <= strategy.fileHeavyThreshold;
}

async function scanDirectoryTree(
    rootPath: string,
    startRelPath: string,
    matchers: InspectIgnoreMatchers,
    mode: ProjectDirectoryScanMode,
    includeFiles: readonly string[] = [],
): Promise<{ entries: ProjectDirectoryEntry[]; files: string[]; filesComplete: boolean }> {
    const strategy = DIRECTORY_SCAN_STRATEGIES[mode];
    const forcedFolderPaths = buildForcedFolderPathSet(includeFiles);
    const stats: DirectoryScanStats = {
        scannedDirs: 0,
        scannedNodes: 0,
        scannedFiles: 0,
    };
    const files = new Set<string>();
    const rootEntries: ProjectDirectoryEntry[] = [];
    const pending: PendingFolderScan[] = [{ relPath: normalizeRelativePath(startRelPath), depth: 0, node: null }];
    let filesComplete = true;

    while (pending.length > 0) {
        const current = pending.shift()!;
        const layer = await walkFiles(rootPath, current.relPath, matchers);
        const targetEntries = current.node ? (current.node.children = []) : rootEntries;
        if (current.node) {
            current.node.childrenLoaded = true;
        }
        targetEntries.push(...layer.entries);
        for (const file of layer.files) {
            files.add(file);
        }

        stats.scannedDirs += 1;
        stats.scannedNodes += layer.entries.length;
        stats.scannedFiles += layer.files.length;

        const visibleFileCount = layer.entries.reduce((count, entry) => (
            entry.kind === 'file' && !entry.ignoredBy ? count + 1 : count
        ), 0);
        const autoPreload = shouldPreloadChildFolders(current.depth, visibleFileCount, stats, strategy);

        for (const folder of layer.folders) {
            const shouldForceExpand = forcedFolderPaths.has(folder.path);
            if (shouldForceExpand || autoPreload) {
                pending.push({ relPath: folder.path, depth: current.depth + 1, node: folder });
                continue;
            }
            filesComplete = false;
        }

        if (!hasScanBudgetRemaining(stats, strategy) && pending.length > 0) {
            filesComplete = false;
            break;
        }
    }

    return {
        entries: rootEntries,
        files: [...files].sort(),
        filesComplete,
    };
}

async function isSelectableFilePresent(
    rootPath: string,
    relativePath: string,
    matchers: InspectIgnoreMatchers,
): Promise<boolean> {
    const normalizedRel = normalizeRelativePath(relativePath);
    if (!normalizedRel) return false;
    if (resolveIgnoredBy(normalizedRel, false, matchers)) {
        return false;
    }
    try {
        const stat = await fs.stat(path.join(rootPath, normalizedRel));
        return stat.isFile();
    } catch {
        return false;
    }
}

export async function inspectProjectDirectory(
    projectPath: string,
    options: InspectProjectDirectoryOptions = {},
): Promise<DirectoryInspection> {
    const normalized = normalizePath(projectPath);
    const ignoreMatchers: InspectIgnoreMatchers = {
        globalIgnore: createIgnoreMatcher(options.globalIgnore ?? []),
        projectIgnore: createIgnoreMatcher(options.projectIgnore ?? []),
    };
    const scan = await scanDirectoryTree(
        normalized,
        '',
        ignoreMatchers,
        options.mode ?? 'summary',
        options.includeFiles ?? [],
    );
    const meta = await readMetaFile(normalized);
    return {
        path: normalized,
        name: basename(normalized),
        hasMetaFile: meta !== null,
        metaProjectId: meta?.projectId,
        tree: scan.entries,
        files: scan.files,
        filesComplete: scan.filesComplete,
        ignoreMatchers,
    };
}

export async function expandProjectDirectory(
    projectPath: string,
    relativePath: string,
    options: InspectProjectDirectoryOptions = {},
): Promise<ProjectDirectoryExpandResult> {
    const normalized = normalizePath(projectPath);
    const parentPath = normalizeRelativePath(relativePath);
    const ignoreMatchers: InspectIgnoreMatchers = {
        globalIgnore: createIgnoreMatcher(options.globalIgnore ?? []),
        projectIgnore: createIgnoreMatcher(options.projectIgnore ?? []),
    };
    const scan = await scanDirectoryTree(
        normalized,
        parentPath,
        ignoreMatchers,
        options.mode ?? 'interactive',
        options.includeFiles ?? [],
    );
    return {
        parentPath,
        entries: scan.entries,
    };
}

export async function listProjectGitignoreFiles(
    projectPath: string,
    options: InspectProjectDirectoryOptions = {},
): Promise<ProjectGitignorePreview[]> {
    const normalized = normalizePath(projectPath);
    const previews: ProjectGitignorePreview[] = [];
    const pending = [''];

    void options;

    while (pending.length > 0) {
        const current = pending.shift()!;
        const abs = current ? path.join(normalized, current) : normalized;
        let entries: import('node:fs').Dirent[];
        try {
            entries = await fs.readdir(abs, { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort(compareEntries);

        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const childRel = current ? `${current}/${entry.name}` : entry.name;
            const normalizedRel = childRel.replace(/\\/g, '/');

            if (entry.isDirectory()) {
                pending.push(normalizedRel);
                continue;
            }

            if (!entry.isFile() || entry.name !== '.gitignore') {
                continue;
            }

            let content = '';
            try {
                content = await fs.readFile(path.join(normalized, normalizedRel), 'utf8');
            } catch (error) {
                logger.debug('读取 gitignore 失败，已跳过该预览文件', {
                    path: normalizedRel,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }

            previews.push({
                path: normalizedRel,
                content: content.length > GITIGNORE_PREVIEW_MAX_LENGTH
                    ? content.slice(0, GITIGNORE_PREVIEW_MAX_LENGTH)
                    : content,
                truncated: content.length > GITIGNORE_PREVIEW_MAX_LENGTH,
            });
        }
    }

    return previews;
}

async function matchesFingerprint(
    fingerprint: ProjectFingerprint,
    inspection: DirectoryInspection,
    projectId: string,
): Promise<boolean> {
    if (fingerprint.kind === 'metadata') {
        return inspection.metaProjectId === projectId;
    }
    if (fingerprint.kind === 'folder-name') {
        return normalizeFolderName(inspection.name) === normalizeFolderName(fingerprint.folderName);
    }
    if (inspection.filesComplete) {
        const fileSet = new Set(inspection.files);
        return fingerprint.paths.every(rel => fileSet.has(rel));
    }
    const matches = await Promise.all(fingerprint.paths.map(rel => isSelectableFilePresent(
        inspection.path,
        rel,
        inspection.ignoreMatchers,
    )));
    return matches.every(Boolean);
}

export async function findMatchingProjectsForDirectory(
    projects: readonly SharedProject[],
    inspection: DirectoryInspection,
): Promise<SharedProject[]> {
    const matched = await Promise.all(projects.map(async project => ({
        project,
        matched: await matchesFingerprint(project.fingerprint, inspection, project.id),
    })));
    return matched.filter(item => item.matched).map(item => item.project);
}

function sameFingerprint(a: ProjectFingerprint, b: ProjectFingerprint): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'metadata' && b.kind === 'metadata') return true;
    if (a.kind === 'folder-name' && b.kind === 'folder-name') {
        return normalizeFolderName(a.folderName) === normalizeFolderName(b.folderName);
    }
    if (a.kind === 'file-paths' && b.kind === 'file-paths') {
        return a.paths.length === b.paths.length && a.paths.every((item, idx) => item === b.paths[idx]);
    }
    return false;
}

export function findFingerprintConflicts(
    projects: readonly SharedProject[],
    fingerprint: ProjectFingerprint,
): SharedProject[] {
    return projects.filter(project => sameFingerprint(project.fingerprint, fingerprint));
}

export interface ScanMatchContext {
    rootId: string;
    projects: readonly SharedProject[];
    existingBindings: readonly ProjectBinding[];
}

export interface ScanMatchResult {
    bindings: ProjectBinding[];
    warnings: ScanWarning[];
    matched: number;
    updated: number;
    removed: number;
}

function cloneActions(actions?: ProjectBinding['actions']): ProjectBinding['actions'] {
    if (!actions) return undefined;
    return actions.map(a => ({
        ...a,
        ...(a.args ? { args: [...a.args] } : {}),
    }));
}

function buildBinding(
    project: SharedProject,
    inspection: DirectoryInspection,
    rootId: string,
    existingBinding?: ProjectBinding,
): ProjectBinding {
    const now = new Date().toISOString();
    return {
        projectId: project.id,
        path: inspection.path,
        rootId,
        hasMetaFile: inspection.hasMetaFile,
        lastScannedAt: now,
        ...(existingBinding?.actions ? { actions: cloneActions(existingBinding.actions) } : (existingBinding as Record<string, unknown>)?.commands ? { actions: cloneActions((existingBinding as Record<string, unknown>).commands as ProjectBinding['actions']) } : {}),
    };
}

function buildConflictWarning(
    rootId: string,
    project: SharedProject,
    candidatePaths: string[],
): ScanWarning {
    return {
        id: generateId('warn'),
        kind: 'fingerprint-conflict',
        scanRootId: rootId,
        projectId: project.id,
        projectName: project.name,
        fingerprint: project.fingerprint,
        candidatePaths,
        message: `项目“${project.name}”在当前扫描根下匹配到 ${candidatePaths.length} 个目录，已跳过自动绑定。`,
        createdAt: new Date().toISOString(),
    };
}

export async function matchScanCandidates(
    ctx: ScanMatchContext,
    candidatePaths: readonly string[],
): Promise<ScanMatchResult> {
    const inspections = await Promise.all(candidatePaths.map(candidate => inspectProjectDirectory(candidate)));
    const matchesByProject = new Map<string, DirectoryInspection[]>();
    for (const project of ctx.projects) {
        matchesByProject.set(project.id, []);
    }

    for (const inspection of inspections) {
        const matched = await findMatchingProjectsForDirectory(ctx.projects, inspection);
        for (const project of matched) {
            matchesByProject.get(project.id)?.push(inspection);
        }
    }

    const bindings: ProjectBinding[] = [];
    const warnings: ScanWarning[] = [];
    let matchedCount = 0;
    let updatedCount = 0;

    for (const project of ctx.projects) {
        const hits = matchesByProject.get(project.id) ?? [];
        if (hits.length === 0) continue;
        if (hits.length > 1) {
            warnings.push(buildConflictWarning(ctx.rootId, project, hits.map(hit => hit.path)));
            continue;
        }
        const existingBinding = ctx.existingBindings.find(binding => binding.projectId === project.id);
        const binding = buildBinding(project, hits[0]!, ctx.rootId, existingBinding);
        bindings.push(binding);
        matchedCount += 1;
        if (ctx.existingBindings.some(existing => existing.projectId === project.id && existing.rootId === ctx.rootId)) {
            updatedCount += 1;
        }
    }

    const removedCount = ctx.existingBindings.filter(existing => {
        if (existing.rootId !== ctx.rootId) return false;
        return !bindings.some(binding => binding.projectId === existing.projectId);
    }).length;

    logger.debug('扫描匹配完成', {
        rootId: ctx.rootId,
        matched: matchedCount,
        updated: updatedCount,
        removed: removedCount,
        warnings: warnings.length,
    });

    return {
        bindings,
        warnings,
        matched: matchedCount,
        updated: updatedCount,
        removed: removedCount,
    };
}

export function normalizeFingerprint(fingerprint: ProjectFingerprint): ProjectFingerprint {
    if (fingerprint.kind === 'metadata') return { kind: 'metadata' };
    if (fingerprint.kind === 'folder-name') {
        return { kind: 'folder-name', folderName: fingerprint.folderName.trim() };
    }
    const normalized = [...new Set(fingerprint.paths.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort();
    return { kind: 'file-paths', paths: normalized } satisfies FilePathsFingerprint;
}
