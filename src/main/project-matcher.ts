// ---------------------------------------------------------------------------
// 项目指纹匹配：目录检查、指纹冲突判断、扫描匹配结果汇总
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateId } from '../shared/id.js';
import { createLogger } from '../shared/logger.js';
import { normalizePath, basename } from '../shared/path-utils.js';
import type {
    FilePathsFingerprint,
    ProjectBinding,
    ProjectFingerprint,
    ScanWarning,
    SharedProject,
} from '../shared/types.js';
import { readMetaFile } from './meta-file.js';

const logger = createLogger('main:project-matcher');

export interface DirectoryInspection {
    path: string;
    name: string;
    hasMetaFile: boolean;
    metaProjectId?: string;
    files: string[];
}

function normalizeFolderName(name: string): string {
    return name.trim().toLowerCase();
}

async function walkFiles(rootPath: string, relDir: string, out: string[]): Promise<void> {
    const abs = relDir ? path.join(rootPath, relDir) : rootPath;
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            await walkFiles(rootPath, childRel, out);
            continue;
        }
        if (entry.isFile()) out.push(childRel.replace(/\\/g, '/'));
    }
}

export async function inspectProjectDirectory(projectPath: string): Promise<DirectoryInspection> {
    const normalized = normalizePath(projectPath);
    const files: string[] = [];
    await walkFiles(normalized, '', files);
    files.sort();
    const meta = await readMetaFile(normalized);
    return {
        path: normalized,
        name: basename(normalized),
        hasMetaFile: meta !== null,
        metaProjectId: meta?.projectId,
        files,
    };
}

function matchesFingerprint(fingerprint: ProjectFingerprint, inspection: DirectoryInspection, projectId: string): boolean {
    if (fingerprint.kind === 'metadata') {
        return inspection.metaProjectId === projectId;
    }
    if (fingerprint.kind === 'folder-name') {
        return normalizeFolderName(inspection.name) === normalizeFolderName(fingerprint.folderName);
    }
    const fileSet = new Set(inspection.files);
    return fingerprint.paths.every(rel => fileSet.has(rel));
}

export async function findMatchingProjectsForDirectory(
    projects: readonly SharedProject[],
    inspection: DirectoryInspection,
): Promise<SharedProject[]> {
    return projects.filter(project => matchesFingerprint(project.fingerprint, inspection, project.id));
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

function buildBinding(project: SharedProject, inspection: DirectoryInspection, rootId: string): ProjectBinding {
    const now = new Date().toISOString();
    return {
        projectId: project.id,
        id: project.id,
        path: inspection.path,
        rootId,
        hasMetaFile: inspection.hasMetaFile,
        lastScannedAt: now,
        lastModifiedAt: now,
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
        const binding = buildBinding(project, hits[0]!, ctx.rootId);
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
