// ---------------------------------------------------------------------------
// FmError：跨进程传输的结构化错误
// IPC 透传时 Electron 自动序列化 message + 普通字段
// ---------------------------------------------------------------------------

import type { FmErrorCode } from '../shared/types.js';

export class FmError extends Error {
  override readonly name = 'FmError';
  readonly code: FmErrorCode;
  readonly details?: unknown;

  constructor(code: FmErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isFmError(value: unknown): value is FmError {
  return value instanceof FmError;
}

/** 将任意异常转成 FmError，便于 IPC 包装层统一处理 */
export function toFmError(error: unknown, fallbackCode: FmErrorCode = 'INTERNAL'): FmError {
  if (isFmError(error)) return error;
  if (error instanceof Error) return new FmError(fallbackCode, error.message, { stack: error.stack });
  return new FmError(fallbackCode, String(error));
}
