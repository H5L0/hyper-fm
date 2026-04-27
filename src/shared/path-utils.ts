// ---------------------------------------------------------------------------
// 路径工具
// 内部统一使用正斜杠绝对路径，比较时按平台决定是否大小写敏感
// ---------------------------------------------------------------------------

/** 将任意分隔符替换为正斜杠 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 移除尾部多余斜杠（保留单字符根） */
export function trimTrailingSlash(p: string): string {
  if (p.length <= 1) return p;
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

/** 规范化为内部存储格式：正斜杠 + 去尾斜杠 */
export function normalizePath(p: string): string {
  return trimTrailingSlash(toPosix(p));
}

/** 平台敏感比较 */
export function pathEquals(a: string, b: string, platform: NodeJS.Platform): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

/** 取目录名（最后一段） */
export function basename(p: string): string {
  const n = normalizePath(p);
  const idx = n.lastIndexOf('/');
  return idx === -1 ? n : n.slice(idx + 1);
}

/** 拼接（输入应已是 posix 风格） */
export function joinPosix(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}
