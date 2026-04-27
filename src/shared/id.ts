// ---------------------------------------------------------------------------
// 短 ID 生成
// 形如 "prj_a1b2c3"，前缀用于一眼识别实体类型
// ---------------------------------------------------------------------------

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomChar(): string {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!;
}

export function generateId(prefix: string, length = 6): string {
  let body = '';
  for (let i = 0; i < length; i++) {
    body += randomChar();
  }
  return `${prefix}_${body}`;
}

export const ID_PREFIX = {
  project: 'prj',
  category: 'cat',
  scanRoot: 'root',
} as const;
