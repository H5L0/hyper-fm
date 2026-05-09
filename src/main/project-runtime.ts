import { promises as fs } from 'node:fs';
import type { ProjectRuntimeInfo } from '../shared/types.js';

export async function listProjectRuntimeInfo(
    projects: ReadonlyArray<{ id: string; path: string }>,
): Promise<ProjectRuntimeInfo[]> {
    return Promise.all(projects.map(async project => {
        const stat = await fs.stat(project.path).catch(() => null);
        return {
            projectId: project.id,
            directoryModifiedAt: stat?.mtime?.toISOString(),
        } satisfies ProjectRuntimeInfo;
    }));
}