export type DynamicTagId = 'recent-month' | 'recent-year';

import type { TagGroupDefinition } from './types.js';

export interface DynamicTagDefinition {
  id: DynamicTagId;
  label: string;
  description: string;
  rangeMs: number;
  color: string;
}

export interface DynamicTagProjectLike {
  modifiedAt?: string;
}

export interface TagGroupProjectLike extends DynamicTagProjectLike {
  tags?: readonly string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DYNAMIC_TAG_DEFINITIONS: readonly DynamicTagDefinition[] = Object.freeze([
  {
    id: 'recent-month',
    label: '最近一月',
    description: '最近 30 天内有修改的项目',
    rangeMs: 30 * DAY_MS,
    color: '#d4a853',
  },
  {
    id: 'recent-year',
    label: '最近一年',
    description: '最近 365 天内有修改的项目',
    rangeMs: 365 * DAY_MS,
    color: '#ca8a04',
  },
]);

export const FAVORITE_TAG_GROUP_NAME = '收藏';

const REQUIRED_TAG_GROUP_NAMES = new Set<string>([FAVORITE_TAG_GROUP_NAME]);

const dynamicTagsById = new Map(DYNAMIC_TAG_DEFINITIONS.map(tag => [tag.id, tag]));
const dynamicTagsByLabel = new Map(DYNAMIC_TAG_DEFINITIONS.map(tag => [tag.label, tag]));

export function getDynamicTagDefinition(id: DynamicTagId): DynamicTagDefinition {
  return dynamicTagsById.get(id)!;
}

export function createDefaultDynamicTagGroups(): TagGroupDefinition[] {
  return [{
    name: FAVORITE_TAG_GROUP_NAME,
    tags: [getDynamicTagDefinition('recent-month').label],
  }];
}

export function isRequiredTagGroupName(name: string): boolean {
  return REQUIRED_TAG_GROUP_NAMES.has(name.trim());
}

export function ensureRequiredTagGroups(tagGroups?: readonly TagGroupDefinition[]): TagGroupDefinition[] {
  const groups = (tagGroups ?? []).map(group => ({
    ...group,
    tags: [...group.tags],
  }));
  if (groups.some(group => isRequiredTagGroupName(group.name))) {
    return groups;
  }
  return [...createDefaultDynamicTagGroups(), ...groups];
}

export function findRequiredTagGroup(
  tagGroups: readonly TagGroupDefinition[] | undefined,
  name: string,
): TagGroupDefinition | undefined {
  return ensureRequiredTagGroups(tagGroups).find(group => group.name === name);
}

export function findDynamicTagByLabel(label: string): DynamicTagDefinition | undefined {
  return dynamicTagsByLabel.get(label.trim());
}

export function isDynamicTagLabel(label: string): boolean {
  return Boolean(findDynamicTagByLabel(label));
}

function parseModifiedAt(iso?: string): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

export function matchesDynamicTag(
  project: DynamicTagProjectLike,
  id: DynamicTagId,
  now = Date.now(),
): boolean {
  const modifiedAt = parseModifiedAt(project.modifiedAt);
  if (modifiedAt === null || modifiedAt > now) return false;
  const definition = getDynamicTagDefinition(id);
  return modifiedAt >= now - definition.rangeMs;
}

export function countProjectsForDynamicTag(
  projects: readonly DynamicTagProjectLike[],
  id: DynamicTagId,
  now = Date.now(),
): number {
  return projects.filter(project => matchesDynamicTag(project, id, now)).length;
}

export function matchesTagRule(
  project: TagGroupProjectLike,
  tag: string,
  now = Date.now(),
): boolean {
  const normalizedTag = tag.trim();
  if (!normalizedTag) return false;
  const dynamicTag = findDynamicTagByLabel(normalizedTag);
  if (dynamicTag) {
    return matchesDynamicTag(project, dynamicTag.id, now);
  }
  return project.tags?.includes(normalizedTag) ?? false;
}

export function matchesTagGroup(
  project: TagGroupProjectLike,
  tags: readonly string[],
  now = Date.now(),
): boolean {
  if (tags.length === 0) return false;
  return tags.every(tag => matchesTagRule(project, tag, now));
}

export function countProjectsForTagGroup(
  projects: readonly TagGroupProjectLike[],
  tags: readonly string[],
  now = Date.now(),
): number {
  if (tags.length === 0) return 0;
  return projects.filter(project => matchesTagGroup(project, tags, now)).length;
}
