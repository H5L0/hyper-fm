// ---------------------------------------------------------------------------
// 元数据搜索：多关键字 AND + 字段限定（tag: path:）+ 高亮分段
// 不读取项目内文件，仅基于 Project 元数据
// ---------------------------------------------------------------------------

import type { Project } from './types.js';

export interface SearchTerm {
  /** 'name' | 'description' | 'tag' | 'path' | 'any' */
  field: 'name' | 'description' | 'tag' | 'path' | 'any';
  value: string;
}

export interface SearchQuery {
  raw: string;
  terms: SearchTerm[];
}

const FIELD_PREFIX: Record<string, SearchTerm['field']> = {
  tag: 'tag',
  path: 'path',
  name: 'name',
  desc: 'description',
  description: 'description',
};

export function parseSearchQuery(input: string): SearchQuery {
  const raw = input ?? '';
  const trimmed = raw.trim();
  if (!trimmed) return { raw, terms: [] };
  const tokens = trimmed.split(/\s+/);
  const terms: SearchTerm[] = [];
  for (const tok of tokens) {
    const colon = tok.indexOf(':');
    if (colon > 0) {
      const prefix = tok.slice(0, colon).toLowerCase();
      const value = tok.slice(colon + 1);
      const field = FIELD_PREFIX[prefix];
      if (field && value.length > 0) {
        terms.push({ field, value: value.toLowerCase() });
        continue;
      }
    }
    if (tok.length > 0) terms.push({ field: 'any', value: tok.toLowerCase() });
  }
  return { raw, terms };
}

export interface MatchExplain {
  /** 'name'/'description'/'tag'/'path' 中的命中字段（去重） */
  fields: SearchTerm['field'][];
  /** 命中的具体字符串集合 */
  values: string[];
}

export function matchProject(
  project: Project,
  query: SearchQuery,
): MatchExplain | null {
  if (query.terms.length === 0) return { fields: [], values: [] };

  const fieldsHit = new Set<SearchTerm['field']>();
  const valuesHit = new Set<string>();

  const haystack = {
    name: project.name.toLowerCase(),
    description: (project.description ?? '').toLowerCase(),
    tags: project.tags.map(t => t.toLowerCase()),
    path: project.path.toLowerCase(),
  };

  for (const term of query.terms) {
    let hit: SearchTerm['field'] | null = null;
    if (term.field === 'tag') {
      if (haystack.tags.some(t => t.includes(term.value))) hit = 'tag';
    } else if (term.field === 'path') {
      if (haystack.path.includes(term.value)) hit = 'path';
    } else if (term.field === 'name') {
      if (haystack.name.includes(term.value)) hit = 'name';
    } else if (term.field === 'description') {
      if (haystack.description.includes(term.value)) hit = 'description';
    } else {
      // any
      if (haystack.name.includes(term.value)) hit = 'name';
      else if (haystack.description.includes(term.value)) hit = 'description';
      else if (haystack.tags.some(t => t.includes(term.value))) hit = 'tag';
      else if (haystack.path.includes(term.value)) hit = 'path';
    }
    if (!hit) return null;
    fieldsHit.add(hit);
    valuesHit.add(term.value);
  }

  return { fields: [...fieldsHit], values: [...valuesHit] };
}

// ---------------------------------------------------------------------------
// 高亮分段：把 text 切成 [{text, hit}]，hit=true 表示匹配片段
// ---------------------------------------------------------------------------

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

export function highlight(text: string, values: readonly string[]): HighlightSegment[] {
  if (!text) return [];
  const lowers = values.filter(v => v.length > 0).map(v => v.toLowerCase());
  if (lowers.length === 0) return [{ text, hit: false }];
  const result: HighlightSegment[] = [];
  let cursor = 0;
  const lower = text.toLowerCase();
  while (cursor < text.length) {
    let nextIdx = -1;
    let nextLen = 0;
    for (const v of lowers) {
      const idx = lower.indexOf(v, cursor);
      if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) {
        nextIdx = idx;
        nextLen = v.length;
      }
    }
    if (nextIdx === -1) {
      result.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (nextIdx > cursor) result.push({ text: text.slice(cursor, nextIdx), hit: false });
    result.push({ text: text.slice(nextIdx, nextIdx + nextLen), hit: true });
    cursor = nextIdx + nextLen;
  }
  return result;
}

const FIELD_LABEL: Record<SearchTerm['field'], string> = {
  name: '名称',
  description: '描述',
  tag: '标签',
  path: '路径',
  any: '任意',
};

export function explainMatch(explain: MatchExplain): string {
  if (explain.fields.length === 0) return '';
  const fields = explain.fields.map(f => FIELD_LABEL[f]).join(' + ');
  const values = explain.values.map(v => `"${v}"`).join(', ');
  return `在 ${fields} 中匹配 ${values}`;
}
