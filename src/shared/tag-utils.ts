import type { SharedConfig, TagGroupDefinition } from './types.js';

interface TagProjectReference {
  id: string;
  name: string;
}

interface TaggableProjectLike {
  id: string;
  name: string;
  tags: string[];
}

export interface TagReferenceConfigLike {
  projects: TaggableProjectLike[];
  tagGroups?: TagGroupDefinition[];
}

export interface TagReferenceSummary {
  projects: TagProjectReference[];
  tagGroups: Array<{ name: string }>;
}

export function collectTagReferences(
  config: TagReferenceConfigLike,
  tagName: string,
): TagReferenceSummary {
  const normalizedName = tagName.trim();
  if (!normalizedName) {
    return { projects: [], tagGroups: [] };
  }
  return {
    projects: config.projects
      .filter(project => project.tags.includes(normalizedName))
      .map(project => ({ id: project.id, name: project.name })),
    tagGroups: (config.tagGroups ?? [])
      .filter(group => group.tags.includes(normalizedName))
      .map(group => ({ name: group.name })),
  };
}

export function removeTagFromSharedConfig(shared: SharedConfig, tagName: string): SharedConfig {
  const normalizedName = tagName.trim();
  if (!normalizedName) {
    return shared;
  }

  return {
    ...shared,
    tags: (shared.tags ?? []).filter(tag => tag.name !== normalizedName),
    projects: shared.projects.map(project => ({
      ...project,
      tags: project.tags.filter(tag => tag !== normalizedName),
    })),
    tagGroups: (shared.tagGroups ?? [])
      .map(group => ({
        ...group,
        tags: group.tags.filter(tag => tag !== normalizedName),
      }))
      .filter(group => group.tags.length > 0),
  };
}