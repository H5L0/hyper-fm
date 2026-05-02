// ---------------------------------------------------------------------------
// 短 ID 生成
// 项目形如 "pj-a1b2c3"；其它实体默认沿用 "prefix_body"
// ---------------------------------------------------------------------------

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomChar(): string {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!;
}

export function generateId(prefix: string, length = 6, separator = '_'): string {
  let body = '';
  for (let i = 0; i < length; i++) {
    body += randomChar();
  }
  return `${prefix}${separator}${body}`;
}

export function generateProjectId(length = 6): string {
  return generateId(ID_PREFIX.project, length, '-');
}

export const ID_PREFIX = {
  project: 'pj',
  category: 'cat',
  scanRoot: 'root',
  device: 'dev',
  command: 'cmd',
} as const;
