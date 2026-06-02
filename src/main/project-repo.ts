// ---------------------------------------------------------------------------
// 项目仓库：在 SharedConfig / LocalConfig 之上封装查询/写入操作
// 所有操作返回新的配置（不可变更新），由调用方决定何时写盘
// ---------------------------------------------------------------------------

import {
    type LocalConfig,
    type Project,
    type ProjectActionListsPatch,
    type ProjectFingerprint,
    type ProjectMetaPatch,
    type ScanReport,
    type ScanRoot,
    type SharedConfig,
    type SharedProject,
} from '../shared/types.js';
import type { CustomAction } from '../shared/sync-types.js';
import { generateId, generateProjectId, ID_PREFIX } from '../shared/id.js';
import { normalizePath, pathEquals, basename } from '../shared/path-utils.js';
import { FmError } from './fm-error.js';
import type { ScanCandidate } from './scanner.js';
import { matchScanCandidates, normalizeFingerprint } from './project-matcher.js';

function cloneActions(actions?: readonly CustomAction[]): CustomAction[] | undefined {
    if (!actions) return undefined;
    return actions.map(a => ({
        ...a,
        ...(a.args ? { args: [...a.args] } : {}),
    }));
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export function buildProjects(shared: SharedConfig, local: LocalConfig): Project[] {
    const sharedMap = new Map(shared.projects.map(project => [project.id, project]));
    const boundIds = new Set<string>();
    const projects: Project[] = [];
    for (const binding of local.bindings) {
        const sharedProject = sharedMap.get(binding.projectId);
        if (!sharedProject) continue;
        boundIds.add(sharedProject.id);
        projects.push({
            ...binding,
            id: sharedProject.id,
            name: sharedProject.name,
            description: sharedProject.description,
            tags: [...sharedProject.tags],
            ignore: [...sharedProject.ignore],
            favoriteFiles: [...(sharedProject.favoriteFiles ?? [])],
            syncRespectGitignore: sharedProject.syncRespectGitignore,
            fingerprint: sharedProject.fingerprint,
            ...(sharedProject.actions ? { sharedActions: cloneActions(sharedProject.actions) } : {}),
            ...(binding.actions ? { actions: cloneActions(binding.actions) } : {}),
        });
    }
    // 未绑定的 shared 项目：路径不在本机或尚未扫描到，仍然展示
    for (const sharedProject of shared.projects) {
        if (boundIds.has(sharedProject.id)) continue;
        projects.push({
            projectId: sharedProject.id,
            id: sharedProject.id,
            path: '',
            rootId: '',
            hasMetaFile: false,
            lastScannedAt: '',
            name: sharedProject.name,
            description: sharedProject.description,
            tags: [...sharedProject.tags],
            ignore: [...sharedProject.ignore],
            favoriteFiles: [...(sharedProject.favoriteFiles ?? [])],
            syncRespectGitignore: sharedProject.syncRespectGitignore,
            fingerprint: sharedProject.fingerprint,
            ...(sharedProject.actions ? { sharedActions: cloneActions(sharedProject.actions) } : {}),
        });
    }
    return projects;
}

export function findProjectById(shared: SharedConfig, local: LocalConfig, id: string): Project | undefined {
    return buildProjects(shared, local).find(project => project.id === id);
}

export function findProjectByPath(
    shared: SharedConfig,
    local: LocalConfig,
    absPath: string,
    platform: NodeJS.Platform,
): Project | undefined {
    return buildProjects(shared, local).find(project => pathEquals(project.path, absPath, platform));
}

function findSharedProjectById(shared: SharedConfig, id: string): SharedProject | undefined {
    return shared.projects.find(project => project.id === id);
}

// ---------------------------------------------------------------------------
// 项目：扫描合并
// ---------------------------------------------------------------------------

interface MergeContext {
    shared: SharedConfig;
    local: LocalConfig;
    rootId: string;
}

export async function mergeScanResult(
    ctx: MergeContext,
    candidates: readonly ScanCandidate[],
): Promise<{ nextLocal: LocalConfig; report: ScanReport }> {
    const start = Date.now();
    const candidatePaths = candidates.map(candidate => candidate.path);
    const matched = await matchScanCandidates(
        {
            rootId: ctx.rootId,
            projects: ctx.shared.projects,
            existingBindings: ctx.local.bindings,
        },
        candidatePaths,
    );

    const bindingsOutsideRoot = ctx.local.bindings.filter(
        binding => binding.rootId !== ctx.rootId && !matched.bindings.some(next => next.projectId === binding.projectId),
    );
    const warningsOutsideRoot = (ctx.local.warnings ?? []).filter(
        warning => warning.kind !== 'fingerprint-conflict' || warning.scanRootId !== ctx.rootId,
    );

    const nextLocal: LocalConfig = {
        ...ctx.local,
        bindings: [...bindingsOutsideRoot, ...matched.bindings],
        warnings: [...warningsOutsideRoot, ...matched.warnings],
    };

    const report: ScanReport = {
        rootId: ctx.rootId,
        scanned: candidates.length,
        matched: matched.matched,
        added: 0,
        updated: matched.updated,
        removed: matched.removed,
        warnings: matched.warnings.length,
        durationMs: Date.now() - start,
    };
    return { nextLocal, report };
}

// ---------------------------------------------------------------------------
// 项目元数据更新
// ---------------------------------------------------------------------------

export function applyProjectPatch(
    shared: SharedConfig,
    local: LocalConfig,
    id: string,
    patch: ProjectMetaPatch,
): { nextShared: SharedConfig; project: Project } {
    const existing = findSharedProjectById(shared, id);
    const binding = local.bindings.find(item => item.projectId === id);
    if (!existing || !binding) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);

    const nextProject: SharedProject = {
        ...existing,
        name: patch.name?.trim() || existing.name,
        description: patch.description !== undefined ? patch.description : existing.description,
        tags: patch.tags ? patch.tags.map(t => t.trim()).filter(Boolean) : existing.tags,
        ignore: patch.ignore
            ? [...new Set(patch.ignore.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort()
            : existing.ignore,
        favoriteFiles: patch.favoriteFiles
            ? [...new Set(patch.favoriteFiles.map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort()
            : existing.favoriteFiles,
        syncRespectGitignore:
            patch.syncRespectGitignore !== undefined
                ? patch.syncRespectGitignore
                : existing.syncRespectGitignore,
        fingerprint: patch.fingerprint ? normalizeFingerprint(patch.fingerprint) : existing.fingerprint,
    };

    return {
        nextShared: {
            ...shared,
            projects: shared.projects.map(project => (project.id === id ? nextProject : project)),
        },
        project: {
            ...binding,
            id: nextProject.id,
            name: nextProject.name,
            description: nextProject.description,
            tags: nextProject.tags,
            ignore: nextProject.ignore,
            favoriteFiles: nextProject.favoriteFiles,
            syncRespectGitignore: nextProject.syncRespectGitignore,
            fingerprint: nextProject.fingerprint,
            ...(nextProject.actions ? { sharedActions: cloneActions(nextProject.actions) } : {}),
        },
    };
}

export function applyProjectActionsPatch(
    shared: SharedConfig,
    local: LocalConfig,
    id: string,
    patch: ProjectActionListsPatch,
): { nextShared: SharedConfig; nextLocal: LocalConfig; project: Project } {
    const existing = findSharedProjectById(shared, id);
    if (!existing) throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);

    const nextShared: SharedConfig = patch.sharedActions === undefined
        ? shared
        : {
            ...shared,
            projects: shared.projects.map(project => (
                project.id === id
                    ? {
                        ...project,
                        actions: cloneActions(patch.sharedActions),
                    }
                    : project
            )),
        };

    const nextLocal: LocalConfig = patch.localActions === undefined
        ? local
        : {
            ...local,
            bindings: local.bindings.map(binding => (
                binding.projectId === id
                    ? {
                        ...binding,
                        actions: cloneActions(patch.localActions),
                    }
                    : binding
            )),
        };

    if (patch.localActions !== undefined && !nextLocal.bindings.some(binding => binding.projectId === id)) {
        throw new FmError('PROJECT_NOT_BOUND', `项目未绑定当前设备：${id}`);
    }

    const project = findProjectById(nextShared, nextLocal, id);
    if (!project) {
        throw new FmError('PROJECT_NOT_FOUND', `项目不存在：${id}`);
    }

    return {
        nextShared,
        nextLocal,
        project,
    };
}

export function setProjectMetaFlag(local: LocalConfig, id: string, hasMetaFile: boolean): LocalConfig {
    return {
        ...local,
        bindings: local.bindings.map(binding =>
            binding.projectId === id ? { ...binding, hasMetaFile } : binding,
        ),
    };
}

// ---------------------------------------------------------------------------
// 手动添加项目
// ---------------------------------------------------------------------------

export const MANUAL_ROOT_ID = 'manual';

export interface AddProjectInput {
    path: string;
    name?: string;
    description?: string;
    tags?: string[];
    ignore?: string[];
    syncRespectGitignore?: boolean;
    fingerprint: ProjectFingerprint;
    hasMetaFile?: boolean;
    mtime?: string;
}

function resolveRootId(local: LocalConfig, normalizedPath: string): string {
    const root = local.scanRoots.find(scanRoot => {
        const scanPath = normalizePath(scanRoot.path).toLowerCase();
        return normalizedPath.toLowerCase().startsWith(`${scanPath}/`) || normalizedPath.toLowerCase() === scanPath;
    });
    return root?.id ?? MANUAL_ROOT_ID;
}

export function addProjectManual(
    shared: SharedConfig,
    local: LocalConfig,
    input: AddProjectInput,
    platform: NodeJS.Platform,
): { nextShared: SharedConfig; nextLocal: LocalConfig; project: Project } {
    const normalizedPath = normalizePath(input.path);
    if (findProjectByPath(shared, local, normalizedPath, platform)) {
        throw new FmError('DUPLICATE_PATH', `项目已存在：${normalizedPath}`);
    }

    const projectId = generateProjectId();
    const name = input.name?.trim() || basename(normalizedPath) || normalizedPath;
    const sharedProject: SharedProject = {
        id: projectId,
        name,
        description: input.description,
        tags: input.tags?.map(tag => tag.trim()).filter(Boolean) ?? [],
        ignore: [...new Set((input.ignore ?? []).map(item => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort(),
        favoriteFiles: [],
        syncRespectGitignore: input.syncRespectGitignore,
        fingerprint: normalizeFingerprint(input.fingerprint),
    };
    const binding = {
        projectId,
        id: projectId,
        path: normalizedPath,
        rootId: resolveRootId(local, normalizedPath),
        hasMetaFile: input.hasMetaFile ?? false,
        lastScannedAt: new Date().toISOString(),
    };
    const nextShared: SharedConfig = { ...shared, projects: [...shared.projects, sharedProject] };
    const nextLocal: LocalConfig = { ...local, bindings: [...local.bindings, binding] };
    return {
        nextShared,
        nextLocal,
        project: {
            ...binding,
            id: projectId,
            name: sharedProject.name,
            description: sharedProject.description,
            tags: sharedProject.tags,
            ignore: sharedProject.ignore,
            favoriteFiles: sharedProject.favoriteFiles,
            syncRespectGitignore: sharedProject.syncRespectGitignore,
            fingerprint: sharedProject.fingerprint,
        },
    };
}

export function removeProject(shared: SharedConfig, local: LocalConfig, id: string): { nextShared: SharedConfig; nextLocal: LocalConfig } {
    return {
        nextShared: { ...shared, projects: shared.projects.filter(project => project.id !== id) },
        nextLocal: {
            ...local,
            bindings: local.bindings.filter(binding => binding.projectId !== id),
            warnings: (local.warnings ?? []).filter(warning => warning.projectId !== id),
        },
    };
}

// ---------------------------------------------------------------------------
// 扫描根 / 本地忽略路径
// ---------------------------------------------------------------------------

export function addScanRoot(
    local: LocalConfig,
    input: { path: string; label?: string; maxDepth?: number },
): { nextLocal: LocalConfig; root: ScanRoot } {
    const normalized = normalizePath(input.path);
    if (local.scanRoots.some(root => normalizePath(root.path).toLowerCase() === normalized.toLowerCase())) {
        throw new FmError('DUPLICATE_PATH', `扫描根已存在：${normalized}`);
    }
    const root: ScanRoot = {
        id: generateId(ID_PREFIX.scanRoot),
        path: normalized,
        label: input.label,
        maxDepth: input.maxDepth && input.maxDepth >= 1 ? Math.floor(input.maxDepth) : 3,
        enabled: true,
    };
    return { nextLocal: { ...local, scanRoots: [...local.scanRoots, root] }, root };
}

export function updateScanRoot(
    local: LocalConfig,
    id: string,
    patch: Partial<Omit<ScanRoot, 'id'>>,
): { nextLocal: LocalConfig; root: ScanRoot } {
    const existing = local.scanRoots.find(root => root.id === id);
    if (!existing) throw new FmError('CONFIG_INVALID', `扫描根不存在：${id}`);
    const next: ScanRoot = {
        ...existing,
        ...patch,
        path: patch.path ? normalizePath(patch.path) : existing.path,
        maxDepth: patch.maxDepth && patch.maxDepth >= 1 ? Math.floor(patch.maxDepth) : existing.maxDepth,
    };
    return {
        nextLocal: { ...local, scanRoots: local.scanRoots.map(root => (root.id === id ? next : root)) },
        root: next,
    };
}

export function removeScanRoot(local: LocalConfig, id: string): LocalConfig {
    return {
        ...local,
        scanRoots: local.scanRoots.filter(root => root.id !== id),
        bindings: local.bindings.filter(binding => binding.rootId !== id),
        warnings: (local.warnings ?? []).filter(
            warning => warning.kind !== 'fingerprint-conflict' || warning.scanRootId !== id,
        ),
    };
}

export function addIgnoredPath(local: LocalConfig, absPath: string): LocalConfig {
    const normalized = normalizePath(absPath);
    if ((local.ignoredPaths ?? []).some(path => path.toLowerCase() === normalized.toLowerCase())) {
        return local;
    }
    return {
        ...local,
        ignoredPaths: [...(local.ignoredPaths ?? []), normalized],
    };
}
