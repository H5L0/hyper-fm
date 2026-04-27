// ---------------------------------------------------------------------------
// 忽略匹配器：极简 glob 子集
// 支持：精确名称匹配、目录后缀 "/"、单段 "*"、行注释
// 不支持：嵌套 **（在 M1 范围外），需要时再引入 `ignore` 包
// ---------------------------------------------------------------------------

interface IgnoreRule {
  /** 仅匹配目录 */
  dirOnly: boolean;
  /** 简化后的字面量段，"*" 视为通配 */
  segments: Array<{ literal?: string; star?: true }>;
  /** 是否以 / 开头（锚定根） */
  rooted: boolean;
}

function parseRule(line: string): IgnoreRule | null {
  let s = line.trim();
  if (!s || s.startsWith('#')) return null;
  // 取消否定规则的支持（M1 范围外）
  if (s.startsWith('!')) return null;

  const dirOnly = s.endsWith('/');
  if (dirOnly) s = s.slice(0, -1);

  const rooted = s.startsWith('/');
  if (rooted) s = s.slice(1);

  const segments = s.split('/').map(seg => {
    if (seg === '*') return { star: true as const };
    return { literal: seg };
  });

  return { dirOnly, segments, rooted };
}

function matchSegment(seg: { literal?: string; star?: true }, name: string): boolean {
  if (seg.star) return true;
  return seg.literal === name;
}

function matchRule(rule: IgnoreRule, relativeSegments: string[], isDir: boolean): boolean {
  if (rule.dirOnly && !isDir) return false;
  const ruleSegs = rule.segments;
  if (rule.rooted) {
    if (ruleSegs.length > relativeSegments.length) return false;
    for (let i = 0; i < ruleSegs.length; i++) {
      if (!matchSegment(ruleSegs[i]!, relativeSegments[i]!)) return false;
    }
    return ruleSegs.length === relativeSegments.length;
  }
  // 非锚定：可在任意层匹配（简化为「连续段匹配」）
  for (let start = 0; start + ruleSegs.length <= relativeSegments.length; start++) {
    let ok = true;
    for (let i = 0; i < ruleSegs.length; i++) {
      if (!matchSegment(ruleSegs[i]!, relativeSegments[start + i]!)) {
        ok = false;
        break;
      }
    }
    if (ok && start + ruleSegs.length === relativeSegments.length) return true;
  }
  return false;
}

export interface IgnoreMatcher {
  isIgnored(relativePath: string, isDir: boolean): boolean;
}

export function createIgnoreMatcher(patterns: readonly string[]): IgnoreMatcher {
  const rules = patterns
    .map(parseRule)
    .filter((r): r is IgnoreRule => r !== null);
  return {
    isIgnored(relativePath, isDir) {
      const segs = relativePath.split('/').filter(Boolean);
      if (segs.length === 0) return false;
      for (const rule of rules) {
        if (matchRule(rule, segs, isDir)) return true;
      }
      return false;
    },
  };
}
