// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function readEnvLevel(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.APP_LOG_LEVEL;
}

function resolveMinLevel(): LogLevel {
  const raw = (readEnvLevel() ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatPrefix(level: LogLevel, scope: string): string {
  return `[${timestamp()}] [${level.toUpperCase()}] [${scope}]`;
}

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

export interface Logger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  child(subScope: string): Logger;
}

function emit(level: LogLevel, scope: string, message: string, details?: unknown): void {
  if (!shouldLog(level, resolveMinLevel())) {
    return;
  }

  const prefix = formatPrefix(level, scope);
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (details === undefined) {
    sink(`${prefix} ${message}`);
    return;
  }

  if (details instanceof Error) {
    sink(`${prefix} ${message}`, details.stack ?? details.message);
    return;
  }

  sink(`${prefix} ${message}`, details);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, details) => emit('debug', scope, message, details),
    info: (message, details) => emit('info', scope, message, details),
    warn: (message, details) => emit('warn', scope, message, details),
    error: (message, details) => emit('error', scope, message, details),
    child: subScope => createLogger(`${scope}:${subScope}`),
  };
}
